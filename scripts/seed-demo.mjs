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
     --recruiter=EMAIL  grant EMAIL verified-recruiter access to the demo
                        hiring org, so the recruiter console shows the bridge
     --no-talent        seed the college only, skip the recruiter world
     --talent-only      seed only the recruiter world against a cohort that
                        is already in the database

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
  node scripts/seed-demo.mjs --recruiter=you@x.com   grant recruiter access
  node scripts/seed-demo.mjs --talent-only    recruiter world only
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
  const recruiter = await db.demoTalentStatus().catch(() => ({ seeded: false }));
  return { seeded: true, students, admins, drives, outcomes, snapshots, joinCode: college.joinCode, recruiter };
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

/* The recruiter-side counterpart of grantTpo. /api/recruiter/* is scoped to the
   caller's own organisation, so an account with no organisation sees an empty
   console even when the world is seeded — exactly as a personal account sees an
   empty college. This binds a real address to the demo hiring org as a verified
   recruiter, which Google sign-in preserves. */
async function grantRecruiter(email) {
  await db.connectDB();
  const r = await db.grantRecruiterAccess(email);
  if (!r.ok) {
    console.error(`  ✗ could not grant recruiter access to "${email}" (${r.reason}).`);
    return false;
  }
  return r.outcome;
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
      const r = s.recruiter || {};
      console.log(r.seeded ? '\nRecruiter bridge is seeded:' : '\nRecruiter bridge is NOT seeded.');
      if (r.seeded) {
        console.log(`  org           ${r.orgKey}`);
        console.log(`  requisitions  ${fmt(r.requisitions)}`);
        console.log(`  pipeline      ${fmt(r.pipelineRows)} rows`);
        console.log(`  interviews    ${fmt(r.interviews)}`);
        console.log(`  partners      ${fmt(r.partners)}`);
        console.log(`  talent pool   ${fmt(r.talentProfiles)} profiles`);
      }
    }
    await mongoose.disconnect();
    process.exit(0);
  }

  const perBranch = Number(valueOf('per-branch', '0')) || 0;
  const reset = has('--reset');
  const recruiterEmail = valueOf('recruiter', '');

  /* Recruiter world only — for a database seeded before the bridge existed.
     It reads the cohort back out and projects onto the ids already there, so
     it never touches the students themselves. */
  if (has('--talent-only')) {
    console.log(`Seeding the recruiter world${reset ? ' (reset)' : ''}…`);
    const t = await db.seedDemoTalent({ reset });
    if (!t.ok) {
      console.error(`\n✗ ${t.reason}${t.message ? ` — ${t.message}` : ''}`);
      await mongoose.disconnect();
      process.exit(1);
    }
    if (t.alreadySeeded) console.log('\n• Already seeded — re-run with --reset to rebuild.');
    else {
      console.log('\n✓ Recruiter bridge seeded.');
      console.log(`  talent pool   ${fmt(t.talentProfiles)} profiles`);
      console.log(`  requisitions  ${t.requisitions}`);
      console.log(`  pipeline      ${fmt(t.pipelineRows)} rows`);
      console.log(`  interviews    ${fmt(t.interviews)}`);
      console.log(`  partners      ${t.campusPartners}`);
    }
    if (recruiterEmail) {
      const outcome = await grantRecruiter(recruiterEmail);
      if (outcome) console.log(`\n✓ ${recruiterEmail} granted recruiter access to the demo hiring org.`);
    }
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`Seeding "${KEY}"${reset ? ' (reset: existing demo records will be removed)' : ''}…`);
  const result = await db.seedDemoCollege({ reset, count: perBranch, talent: !has('--no-talent') });

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

    const r = result.recruiter || {};
    if (r.failed) {
      console.log(`\n! Recruiter world failed: ${r.error}`);
      console.log('  Retry with: node scripts/seed-demo.mjs --talent-only --reset');
    } else if (!r.skipped) {
      console.log('\n✓ Recruiter bridge seeded.');
      console.log(`  talent pool   ${fmt(r.talentProfiles)} profiles`);
      console.log(`  requisitions  ${r.requisitions}`);
      console.log(`  pipeline      ${fmt(r.pipelineRows)} rows`);
      console.log(`  interviews    ${fmt(r.interviews)}`);
      console.log(`  partners      ${r.campusPartners}`);
    }
  }

  const tpo = valueOf('tpo', '');
  if (tpo) {
    const outcome = await grantTpo(tpo);
    if (outcome) {
      console.log(`\n✓ ${tpo} ${outcome === 'created' ? 'registered and ' : ''}granted placement-cell access to the demo college.`);
      console.log('  Sign in with that address and open the placement command centre.');
    }
  }

  if (recruiterEmail) {
    const outcome = await grantRecruiter(recruiterEmail);
    if (outcome) {
      console.log(`\n✓ ${recruiterEmail} ${outcome === 'created' ? 'registered and ' : ''}granted verified-recruiter access to the demo hiring org.`);
      console.log('  Sign in with that address and open the recruiter console.');
    }
  }

  if (!tpo) {
    console.log('\nNext: nothing is visible until an account is scoped to this college.');
    console.log('  Re-run with --tpo=your@email.com, or sign in as');
    console.log(`  ${result.tpoEmail || 'tpo@demo-institute.test'} (needs ALLOW_DEV_LOGIN=1).`);
    console.log('  For the recruiter console, add --recruiter=your@email.com too.');
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
