#!/usr/bin/env node
/* ============================================================
   SEED THE DEMO COLLEGE  (command line)
   ------------------------------------------------------------
   Loads "Demo Institute of Technology" — 200 students across four CSE
   specialisations and four year-groups, with drives, a placement funnel,
   90 days of snapshots, a roster and tasks — into the database named by
   MONGODB_URI.

   The same world is available over HTTP at POST /api/admin/demo/seed, but
   that route needs an authenticated admin session, which is awkward to
   arrange against a fresh deployment. This script talks to the database
   directly, so it can be pointed at a production URI from a laptop before
   anyone has signed in at all.

   USAGE
     MONGODB_URI="mongodb+srv://..." node scripts/seed-demo.mjs [options]

     --reset            wipe the existing demo college first (safe: it only
                        ever deletes records tagged demo / @demo-institute.test)
     --per-branch=N     students per specialisation (default 50 → 200 total)
     --tpo=EMAIL        also grant EMAIL placement-cell access to the demo
                        college, so signing in with that Google account lands
                        straight in the command centre
     --status           report what is currently in the database, change nothing

   WHY --tpo MATTERS
     Seeding alone is not enough to SEE the data. Every /api/college/* route is
     scoped to the caller's own college, so signing in with a personal account
     puts you in a different (empty) tenant. --tpo binds your real address to
     the demo college as a verified college_admin. Sign-in preserves those
     fields, so Google OAuth still works normally afterwards and you do not
     need ALLOW_DEV_LOGIN enabled in production.
   ============================================================ */

import process from 'node:process';
import dotenv from 'dotenv';

dotenv.config();

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (name, fallback = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

if (has('--help') || has('-h')) {
  console.log(String.raw`
Seed the demo college into MONGODB_URI.

  node scripts/seed-demo.mjs                  seed (no-op if already seeded)
  node scripts/seed-demo.mjs --reset          wipe the demo college and rebuild
  node scripts/seed-demo.mjs --per-branch=25  100 students instead of 200
  node scripts/seed-demo.mjs --tpo=you@x.com  grant an account TPO access
  node scripts/seed-demo.mjs --status         report only, change nothing
`.trim());
  process.exit(0);
}

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set.\n');
  console.error('Set it to the same connection string the deployment uses, e.g.');
  console.error('  MONGODB_URI="mongodb+srv://user:pass@cluster/dbname" node scripts/seed-demo.mjs --reset\n');
  console.error('Without a database there is nothing to seed: the in-memory demo cohort');
  console.error('(DEMO_MODE=1) is a separate, DB-free path and is not written anywhere.');
  process.exit(1);
}

/* db.js reads MONGODB_URI at module scope, so dotenv has to run first —
   hence the dynamic import rather than a static one at the top of the file. */
const db = await import('../db.js');
const mongoose = (await import('mongoose')).default;

const KEY = db.DEMO_COLLEGE_KEY;

async function status() {
  await db.connectDB();
  const college = await db.College.findOne({ key: KEY }).lean();
  if (!college) return { seeded: false };
  const students = await db.User.countDocuments({ collegeId: KEY, accountType: 'student' });
  const admins = await db.User.countDocuments({ collegeId: KEY, accountType: 'college_admin' });
  const GenericDoc = mongoose.models.GenericDoc
    || mongoose.model('GenericDoc', new mongoose.Schema({ kind: String, collegeId: String, data: Object }, { timestamps: true }));
  const [drives, outcomes, snapshots] = await Promise.all([
    GenericDoc.countDocuments({ kind: 'placement_drive', collegeId: KEY }),
    GenericDoc.countDocuments({ kind: 'placement_outcome', collegeId: KEY }),
    GenericDoc.countDocuments({ kind: 'college_snapshot', collegeId: KEY }),
  ]);
  return { seeded: true, students, admins, drives, outcomes, snapshots, joinCode: college.joinCode };
}

/* Bind a real address to the demo college as a verified placement-cell user.
   Updates in place when the account already exists (the common case: you have
   already signed in once) and creates a shell record otherwise, which the next
   Google sign-in adopts by email. */
async function grantTpo(email) {
  const addr = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
    console.error(`  ✗ "${email}" is not a valid email address — skipping.`);
    return false;
  }
  await db.connectDB();
  const fields = {
    collegeId: KEY,
    accountType: 'college_admin',
    roleVerified: true,
    verificationStatus: 'approved',
    collegeMembership: { status: 'active', via: 'admin', at: new Date() },
  };
  const existing = await db.User.findOne({ email: addr });
  if (existing) {
    await db.User.updateOne({ _id: existing._id }, { $set: fields });
    return 'updated';
  }
  await db.User.create({ email: addr, name: 'Placement Cell', provider: 'google', isActive: true, ...fields });
  return 'created';
}

const fmt = (n) => new Intl.NumberFormat('en-IN').format(n);

try {
  if (has('--status')) {
    const s = await status();
    if (!s.seeded) console.log('Demo college is NOT seeded in this database.');
    else {
      console.log('Demo college is seeded:');
      console.log(`  students   ${fmt(s.students)}`);
      console.log(`  TPO users  ${fmt(s.admins)}`);
      console.log(`  drives     ${fmt(s.drives)}`);
      console.log(`  outcomes   ${fmt(s.outcomes)}`);
      console.log(`  snapshots  ${fmt(s.snapshots)}`);
      console.log(`  join code  ${s.joinCode}`);
    }
    await mongoose.disconnect();
    process.exit(0);
  }

  const perBranch = Number(valueOf('per-branch', '0')) || 0;
  const reset = has('--reset');

  console.log(`Seeding "${KEY}"${reset ? ' (reset: existing demo records will be removed)' : ''}…`);
  const result = await db.seedDemoCollege({ reset, count: perBranch });

  if (!result.ok) {
    console.error(`\n✗ Seeding failed: ${result.reason}${result.error ? ` — ${result.error}` : ''}`);
    if (result.message) console.error(`  ${result.message}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (result.alreadySeeded) {
    console.log(`\n• Already seeded — ${fmt(result.students)} members present.`);
    console.log('  Re-run with --reset to rebuild from scratch.');
  } else {
    console.log('\n✓ Seeded.');
    console.log(`  students    ${fmt(result.students)} (${result.perBranch} per specialisation)`);
    console.log(`  branches    ${result.branches.join(' · ')}`);
    console.log(`  batches     ${result.batches.join(', ')}`);
    console.log(`  drives      ${result.drives}`);
    console.log(`  outcomes    ${fmt(result.outcomes)}`);
    console.log(`  snapshots   ${result.snapshots}`);
    console.log(`  tasks       ${result.tasks}`);
    console.log(`  roster      ${fmt(result.rosterRows)} rows`);
    console.log(`  pending     ${result.pendingJoinRequests} join requests`);
    console.log(`  join code   ${result.joinCode}`);
  }

  const tpo = valueOf('tpo', '');
  if (tpo) {
    const outcome = await grantTpo(tpo);
    if (outcome) {
      console.log(`\n✓ ${tpo} ${outcome === 'created' ? 'registered and ' : ''}granted placement-cell access to the demo college.`);
      console.log('  Sign in with that address and open the placement command centre.');
    }
  } else {
    console.log('\nNext: nothing is visible until an account is scoped to this college.');
    console.log('  Re-run with --tpo=your@email.com, or sign in as');
    console.log(`  ${result.tpoEmail || 'tpo@demo-institute.test'} (needs ALLOW_DEV_LOGIN=1).`);
  }

  await mongoose.disconnect();
  process.exit(0);
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  if (/ENOTFOUND|ETIMEDOUT|ServerSelection/i.test(err.message)) {
    console.error('  The database could not be reached. Check the URI, and that this');
    console.error('  machine is allowed in the Atlas network access list.');
  }
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}
