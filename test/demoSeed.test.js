// Tests for seedDemoCollege — the DB-backed demo world.
//
// Why this exists: there used to be two unrelated demo cohorts. The rich one
// (four CSE specialisations, four year-groups, 200 students) lived in memory
// and was served ONLY when DEMO_MODE=1 and no MONGODB_URI was set — a
// combination config.js refuses to boot in production. The one that actually
// reached MongoDB was a different, thinner generator. So a deployed instance
// showed an empty command center no matter what was configured.
//
// seedDemoCollege now persists the in-memory world. The property that matters
// is a ROUND TRIP: the documents written must reproduce the same cohort when
// read back through the aggregation db.collegeStudentsDeep performs. This file
// stubs the Mongo driver, captures every write, and replays that aggregation
// over the captured documents.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import demo from '../server/utils/demoCollegeData.js';

/* ---------------- in-memory stand-in for the collections ---------------- */

const store = {
  users: [], states: [], xp: [], subs: [], resumes: [],
  activity: [], roster: [], tasks: [], generic: [], colleges: [],
};

/** Minimal chainable stub: only the shapes seedDemoCollege actually calls. */
function stubModel(bucket) {
  return {
    insertMany: async (docs) => { store[bucket].push(...docs); return docs; },
    create: async (doc) => { store[bucket].push(doc); return doc; },
    countDocuments: async () => store[bucket].length,
    findOne: () => ({ lean: async () => null, select: () => ({ lean: async () => null }) }),
    deleteMany: async () => ({ deletedCount: 0 }),
    find: () => ({ select: () => ({ lean: async () => [] }), lean: async () => [] }),
  };
}

let db;

before(async () => {
  // A URI must be present for the DB branch of every helper to be taken, but
  // nothing may actually dial out — connectDB is short-circuited.
  process.env.MONGODB_URI = 'mongodb://stub.invalid/demo-seed-test';
  // Stays stubbed for the whole file: seedDemoCollege calls connectDB itself,
  // and a real connect would try to init the stub models and blow up.
  mongoose.connect = async () => mongoose;

  /* db.js resolves every model as `mongoose.models.X || mongoose.model(X, …)`.
     Registering the stubs BEFORE importing it means the module body binds to
     these instead of compiling real ones — ESM namespace exports are frozen,
     so patching db.User after the fact is not possible. */
  for (const [name, bucket] of [
    ['User', 'users'], ['UserState', 'states'], ['SkillXp', 'xp'],
    ['ProjectSubmission', 'subs'], ['ResumeAnalysis', 'resumes'],
    ['Activity', 'activity'], ['RosterEntry', 'roster'],
    ['CollegeTask', 'tasks'], ['College', 'colleges'], ['GenericDoc', 'generic'],
  ]) mongoose.models[name] = stubModel(bucket);

  db = await import('../db.js');
});

test('seed writes the full demo world', async () => {
  const result = await db.seedDemoCollege({});
  assert.equal(result.ok, true, result.error || '');
  assert.equal(result.seeded, true);
  assert.equal(result.students, demo.DEMO_STUDENT_COUNT);
  assert.equal(result.drives, 8);
  assert.equal(result.snapshots, 90);
  assert.equal(result.tasks, 5);
  assert.equal(result.pendingJoinRequests, 3);
  assert.ok(result.outcomes > 0, 'placement funnel must not be empty');
});

test('every student is bound to the demo college and obviously synthetic', () => {
  const students = store.users.filter((u) => u.accountType === 'student');
  assert.equal(students.length, demo.DEMO_STUDENT_COUNT + 3); // + pending join requests
  for (const u of students) {
    assert.equal(u.collegeId, 'demo-institute-of-technology');
    assert.equal(u.provider, 'demo');
    assert.ok(u.email.endsWith('@demo-institute.test'), `real-looking address: ${u.email}`);
  }
});

test('all four specialisations and all four batches are represented', () => {
  const branches = new Set(store.states.map((s) => s.profile.branch));
  const batches = new Set(store.states.map((s) => s.profile.batch));
  assert.deepEqual([...branches].sort(), [...demo.BRANCH_LIST].sort());
  assert.deepEqual([...batches].sort(), [...demo.BATCH_LIST].sort());
  for (const b of branches) {
    assert.equal(store.states.filter((s) => s.profile.branch === b).length, demo.DEMO_PER_BRANCH);
  }
});

/* ---------------- the round trip ----------------
   Replays the aggregation in db.collegeStudentsDeep over the captured
   documents. If the seeder writes the wrong shape, the reconstructed cohort
   diverges from the source cohort and these assertions fail. */

function reconstructCohort() {
  const stateByUser = new Map(store.states.map((s) => [String(s.userId), s]));
  const rows = [];
  for (const u of store.users) {
    if (u.accountType !== 'student') continue;
    const k = String(u._id);
    const state = stateByUser.get(k);
    if (!state) continue; // pending join requests have no state — excluded by design
    const profile = state.profile || {};
    const xp = store.xp.filter((x) => String(x.userId) === k);
    const subs = store.subs.filter((s) => String(s.userId) === k);
    const byStatus = (st) => subs.filter((s) => s.verificationStatus === st);
    const resumes = store.resumes.filter((r) => String(r.userId) === k)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const lastActive = [
      ...store.activity.filter((a) => String(a.userId) === k).map((a) => a.createdAt),
      state.updatedAt, u.lastLoginAt, ...subs.map((s) => s.updatedAt),
    ].filter(Boolean).map((d) => new Date(d).getTime()).filter(Number.isFinite);

    rows.push({
      email: u.email, name: u.name,
      branch: profile.branch, batch: profile.batch, year: profile.year,
      targetRole: profile.targetRole || '',
      skills: profile.skills || [],
      totalVerifiedXp: xp.reduce((s, x) => s + (x.verifiedXp > 0 ? x.verifiedXp : 0), 0),
      totalPendingXp: xp.reduce((s, x) => s + (x.pendingXp > 0 ? x.pendingXp : 0), 0),
      projectsTotal: subs.length,
      projectsVerified: byStatus('verified').length,
      projectsPending: byStatus('pending').length,
      projectsNeedsReview: byStatus('needs_review').length,
      projectsRejected: byStatus('rejected').length,
      recruiterReadyProjects: byStatus('verified').filter((s) => s.githubUrl || s.liveDemoUrl).length,
      resumeScore: resumes.length ? resumes[0].score : (state.resume?.score ?? null),
      lastActiveAt: lastActive.length ? new Date(Math.max(...lastActive)).toISOString() : null,
    });
  }
  return rows;
}

test('round trip: seeded documents reproduce the source cohort', () => {
  const source = new Map(demo.demoStudentsDeep().rows.map((r) => [r.email, r]));
  const rebuilt = reconstructCohort();
  assert.equal(rebuilt.length, demo.DEMO_STUDENT_COUNT);

  for (const got of rebuilt) {
    const want = source.get(got.email);
    assert.ok(want, `unknown student round-tripped: ${got.email}`);
    for (const field of ['name', 'branch', 'batch', 'year', 'targetRole',
      'projectsTotal', 'projectsVerified', 'projectsPending',
      'projectsNeedsReview', 'projectsRejected', 'resumeScore',
      'totalVerifiedXp', 'totalPendingXp']) {
      assert.deepEqual(got[field], want[field], `${field} drifted for ${got.email}`);
    }
    assert.deepEqual(got.skills, want.skills, `skills drifted for ${got.email}`);
  }
});

test('recruiter-ready projects are never counted above verified ones', () => {
  for (const r of reconstructCohort()) {
    assert.ok(r.recruiterReadyProjects <= r.projectsVerified,
      `${r.email} reports proof on an unverified project`);
  }
});

/* The engagement buckets are the regression this guards. Mongoose stamps
   updatedAt at write time, which would mark all 200 students active on seed
   day and collapse the dormant/at-risk lists to nothing. */
test('last-active spread survives the write — students are not all active today', () => {
  const rows = reconstructCohort();
  const now = Date.now();
  const days = (iso) => (iso == null ? null : Math.round((now - new Date(iso).getTime()) / 86400000));
  const activeThisWeek = rows.filter((r) => days(r.lastActiveAt) != null && days(r.lastActiveAt) <= 7).length;
  const dormant = rows.filter((r) => days(r.lastActiveAt) != null && days(r.lastActiveAt) > 30).length;

  assert.ok(activeThisWeek > 0, 'nobody is active — the momentum chart would be flat');
  assert.ok(activeThisWeek < rows.length * 0.6, `${activeThisWeek}/${rows.length} active this week — timestamps were overwritten`);
  assert.ok(dormant > 0, 'no dormant students — the at-risk list would be empty');

  /* The in-memory cohort has a "never active" group (lastActiveAt null). That
     bucket cannot survive a database: collegeStudentsDeep takes the MAX of
     several timestamps including UserState.updatedAt, and a student with a
     profile row necessarily has one. Those students land in `dormant` with an
     age equal to how long they have been enrolled, which is the truthful
     reading — they registered and never came back. */
  assert.ok(rows.every((r) => r.lastActiveAt != null),
    'a student with a profile row cannot read back as never-active');
});

test('resume history keeps an improvement curve rather than one flat score', () => {
  const withHistory = new Map();
  for (const r of store.resumes) {
    const k = String(r.userId);
    if (!withHistory.has(k)) withHistory.set(k, []);
    withHistory.get(k).push(r);
  }
  const multi = [...withHistory.values()].filter((v) => v.length > 1);
  assert.ok(multi.length > 0, 'no student has more than one resume version');
  for (const versions of multi) {
    const sorted = [...versions].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    assert.ok(sorted[sorted.length - 1].score > sorted[0].score,
      'the latest resume version does not score above the earliest');
  }
});

/* ---------------- placement + roster wiring ---------------- */

test('placement outcomes point at real user ids, not synthetic demo ids', () => {
  const outcomes = store.generic.filter((d) => d.kind === 'placement_outcome');
  const userIds = new Set(store.users.map((u) => String(u._id)));
  assert.ok(outcomes.length > 0);
  for (const o of outcomes) {
    assert.ok(!String(o.data.studentId).startsWith('demo_'),
      'outcome still carries a synthetic student id — the placement funnel will not join');
    assert.ok(userIds.has(String(o.data.studentId)), 'outcome references a student who was never written');
  }
});

test('drive ids survive so outcomes stay attached to their drive', () => {
  const driveIds = new Set(store.generic.filter((d) => d.kind === 'placement_drive').map((d) => d.data.id));
  for (const o of store.generic.filter((d) => d.kind === 'placement_outcome')) {
    assert.ok(driveIds.has(o.data.driveId), `orphaned outcome for drive ${o.data.driveId}`);
  }
});

test('roster rows link joined students to their accounts', () => {
  const joined = store.roster.filter((r) => r.status === 'joined');
  const invited = store.roster.filter((r) => r.status === 'invited');
  assert.ok(joined.length > 0 && invited.length > 0, 'roster needs both sides of the funnel');
  for (const r of joined) assert.ok(r.joinedUserId, `joined roster row ${r.email} has no account link`);
  for (const r of invited) assert.equal(r.joinedUserId, null);
});

test('task assignments reference seeded students and respect the completed count', () => {
  const userIds = new Set(store.users.map((u) => String(u._id)));
  const source = new Map(demo.demoTasks().map((t) => [t.title, t]));
  assert.equal(store.tasks.length, 5);
  for (const t of store.tasks) {
    const want = source.get(t.title);
    assert.ok(want, `unexpected task ${t.title}`);
    assert.equal(t.assignments.length, want.assignedCount);
    assert.equal(t.assignments.filter((a) => a.status === 'done').length, want.completedCount);
    for (const a of t.assignments) assert.ok(userIds.has(String(a.userId)));
  }
});

test('snapshots cover 90 distinct days ending before today', () => {
  const snaps = store.generic.filter((d) => d.kind === 'college_snapshot');
  const dates = new Set(snaps.map((s) => s.data.date));
  assert.equal(dates.size, 90);
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(!dates.has(today), 'a snapshot for today would pre-empt the live one the app records');
});

test('readiness is persisted so the college overview has something to average', () => {
  assert.ok(store.states.every((s) => typeof s.readiness?.score === 'number'));
  const avg = store.states.reduce((a, s) => a + s.readiness.score, 0) / store.states.length;
  assert.ok(avg > 0 && avg < 100, `implausible average readiness: ${avg}`);
});
