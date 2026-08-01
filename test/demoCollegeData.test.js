// Tests for the DB-free demo college cohort (server/utils/demoCollegeData.js).
//
// Why this exists: the placement-cell command center reads every figure through
// db.listCollegeStudents / collegeStudentsDeep, both of which return [] when
// MONGODB_URI is unset. Recording a demo therefore required provisioning a
// database. The demo cohort fills that gap in memory.
//
// The safety properties matter as much as the shape: this data must never be
// servable against a real database, and must be obviously synthetic.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import demo, {
  DEMO_COLLEGE_ID, DEMO_DOMAIN, DEMO_STUDENT_COUNT,
  demoModeEnabled, demoStudents, demoStudentsDeep, demoStudentDetail,
  demoDrives, demoMembers, demoRoster, demoTasks, demoCollege,
} from '../server/utils/demoCollegeData.js';
import { computeReadiness } from '../server/utils/readinessEngine.js';

/* ---------------- gating & safety ---------------- */

test('demo mode is OFF unless explicitly enabled', () => {
  assert.equal(demoModeEnabled({}), false);
  assert.equal(demoModeEnabled({ DEMO_MODE: '0' }), false);
  assert.equal(demoModeEnabled({ DEMO_MODE: 'false' }), false);
  assert.equal(demoModeEnabled({ DEMO_MODE: '1' }), true);
  assert.equal(demoModeEnabled({ DEMO_MODE: 'true' }), true);
});

test('every record is unmistakably synthetic', () => {
  for (const s of demoStudents()) {
    assert.ok(s.email.endsWith(`@${DEMO_DOMAIN}`), `${s.email} is not a .test address`);
    assert.ok(s.id.startsWith('demo_'), `${s.id} is not demo-prefixed`);
  }
  for (const m of demoMembers()) assert.ok(m.email.endsWith(`@${DEMO_DOMAIN}`));
  for (const r of demoRoster().rows) assert.ok(r.email.endsWith(`@${DEMO_DOMAIN}`));
  assert.equal(demoCollege().key, DEMO_COLLEGE_ID);
  assert.equal(demoCollege().demo, true);
});

test('the demo domain uses a reserved TLD that cannot route', () => {
  assert.ok(DEMO_DOMAIN.endsWith('.test'), 'demo email domain must be under the reserved .test TLD');
});

/* ---------------- cohort shape ---------------- */

test('the cohort is exactly 50 students', () => {
  assert.equal(demoStudents().length, 50);
  assert.equal(DEMO_STUDENT_COUNT, 50);
});

test('student names are unique — duplicates read as fake on screen', () => {
  const names = demoStudents().map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
});

test('every student carries the fields the command center renders', () => {
  const required = ['id', 'name', 'email', 'branch', 'batch', 'year', 'skills',
    'readinessScore', 'readinessCategory', 'resumeScore', 'verifiedProjects',
    'projectsTotal', 'projectsVerified', 'projectsPending', 'recruiterReadyProjects',
    'totalVerifiedXp', 'lastActiveAt', 'memberSince', 'membership'];
  for (const s of demoStudents()) {
    for (const f of required) assert.ok(f in s, `student ${s.id} missing "${f}"`);
  }
});

test('readiness comes from the real engine, not invented numbers', () => {
  for (const s of demoStudents()) {
    const expected = computeReadiness({
      verifiedSkills: s.verifiedSkills,
      totalVerifiedXp: s.totalVerifiedXp,
      verifiedProjectCount: s.projectsVerified,
      recruiterReadyProjectCount: s.recruiterReadyProjects,
      resumeScore: s.resumeScore,
    });
    assert.equal(s.readinessScore, expected.score, `${s.id} readiness diverges from the engine`);
    assert.equal(s.readinessCategory, expected.category);
  }
});

test('the funnel is spread — not everyone ready, not everyone empty', () => {
  const rows = demoStudents();
  const ready = rows.filter((s) => s.readinessScore >= 70).length;
  const notReady = rows.filter((s) => s.readinessScore < 30).length;
  assert.ok(ready >= 5, `only ${ready} placement-ready students — the demo has nothing to show off`);
  assert.ok(notReady >= 5, `only ${notReady} low-readiness students — a cohort with no gaps makes the product look useless`);
  assert.ok(ready < rows.length * 0.6, 'too many ready students to be credible');
});

test('internal counts are self-consistent', () => {
  for (const s of demoStudents()) {
    assert.ok(s.projectsVerified <= s.projectsTotal, `${s.id}: more verified than total projects`);
    assert.ok(s.recruiterReadyProjects <= Math.max(s.projectsVerified, 0) || s.projectsVerified === 0);
    assert.ok(s.verifiedSkills.length <= s.skills.length, `${s.id}: more verified skills than skills`);
    assert.equal(s.verifiedProjects, s.projectsVerified);
    if (s.resumeScore != null) assert.ok(s.resumeScore >= 0 && s.resumeScore <= 100);
  }
});

test('multiple branches and batches so the analytics charts have bars', () => {
  const rows = demoStudents();
  assert.ok(new Set(rows.map((s) => s.branch)).size >= 3);
  assert.ok(new Set(rows.map((s) => s.batch)).size >= 2);
});

/* ---------------- determinism ---------------- */

test('the cohort is identical across calls — a re-recorded take looks the same', () => {
  assert.deepEqual(demoStudents(), demoStudents());
  assert.deepEqual(demoStudents().map((s) => s.name), demoStudents().map((s) => s.name));
});

/* ---------------- filters ---------------- */

test('filters narrow the cohort correctly', () => {
  const cse = demoStudents({ filters: { branch: 'CSE' } });
  assert.ok(cse.length > 0);
  assert.ok(cse.every((s) => s.branch === 'CSE'));

  const verified = demoStudents({ filters: { verifiedOnly: true } });
  assert.ok(verified.length > 0);
  assert.ok(verified.every((s) => s.projectsVerified > 0));

  const strong = demoStudents({ filters: { minResume: 70 } });
  assert.ok(strong.every((s) => Number(s.resumeScore) >= 70));

  assert.equal(demoStudents({ filters: { branch: 'NoSuchBranch' } }).length, 0);
});

/* ---------------- companion datasets ---------------- */

test('deep rows and activity events back the observability view', () => {
  const { rows, events } = demoStudentsDeep();
  assert.equal(rows.length, 50);
  assert.ok(events.length > 30, 'too few activity events for a momentum series');
  for (const e of events) {
    assert.ok(['verification', 'resume'].includes(e.type));
    assert.ok(!Number.isNaN(Date.parse(e.at)), 'event timestamp is not parseable');
  }
});

test('student drill-down resolves and is scoped to that student', () => {
  const detail = demoStudentDetail('demo_005');
  assert.ok(detail, 'demo_005 should resolve');
  assert.equal(detail.student.id, 'demo_005');
  assert.ok(Array.isArray(detail.projects));
  assert.ok(Array.isArray(detail.skillLedger));
  assert.equal(demoStudentDetail('demo_999'), null);
  assert.equal(demoStudentDetail(''), null);
});

test('drives, roster, tasks and members are populated', () => {
  assert.ok(demoDrives().length >= 3);
  assert.ok(demoDrives().some((d) => d.status === 'open'));
  assert.ok(demoRoster().rows.length > 30);
  assert.equal(demoRoster().counts.joined + demoRoster().counts.invited, demoRoster().rows.length);
  assert.ok(demoTasks().length >= 3);
  assert.ok(demoMembers().length >= 50);
});

test('members include pending join requests so approval controls are live', () => {
  const pending = demoMembers('pending');
  assert.ok(pending.length >= 2, 'no pending members — the approve button has nothing to act on');
  assert.ok(pending.every((m) => m.status === 'pending'));
});

test('the default export exposes the full surface', () => {
  for (const k of ['demoStudents', 'demoStudentsDeep', 'demoStudentDetail', 'demoDrives',
    'demoMembers', 'demoRoster', 'demoTasks', 'demoCollege', 'demoModeEnabled']) {
    assert.equal(typeof demo[k], 'function', `default export missing ${k}`);
  }
});

/* ---------------- regression ---------------- */

test('csvSafe.buildCsv is importable — /api/college/export used it without importing it', async () => {
  // That missing import threw an uncaught ReferenceError inside an async route
  // handler, which terminated the node process. Clicking "Export CSV" took the
  // whole server down.
  const { buildCsv } = await import('../server/utils/csvSafe.js');
  assert.equal(typeof buildCsv, 'function');
  const csv = buildCsv(['a', 'b'], [['1', '2']]);
  assert.ok(csv.includes('a,b'));
});
