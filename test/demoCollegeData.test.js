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
  BRANCH_LIST, YEAR_LIST, BATCH_LIST,
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

test('the cohort is 200 students — 50 in each of four CSE specialisations', () => {
  const rows = demoStudents();
  assert.equal(rows.length, 200);
  assert.equal(DEMO_STUDENT_COUNT, 200);
  const perBranch = {};
  for (const s of rows) perBranch[s.branch] = (perBranch[s.branch] || 0) + 1;
  assert.deepEqual(Object.keys(perBranch).sort(), [...BRANCH_LIST].sort());
  for (const [branch, n] of Object.entries(perBranch)) {
    assert.equal(n, 50, `${branch} has ${n} students, expected 50`);
  }
});

test('all four academic years are represented in every branch', () => {
  const rows = demoStudents();
  for (const branch of BRANCH_LIST) {
    const years = new Set(rows.filter((s) => s.branch === branch).map((s) => s.year));
    assert.equal(years.size, 4, `${branch} covers ${years.size} years, expected 4`);
  }
  assert.deepEqual([...new Set(rows.map((s) => s.year))].sort(), [...YEAR_LIST].sort());
  assert.deepEqual([...new Set(rows.map((s) => s.batch))].sort(), [...BATCH_LIST].sort());
});

/* Seniority has to be visible in the numbers, or the year filter is decoration.
   A cohort where a first-year looks like a final-year would also make the
   readiness engine look like it is not measuring anything. */
test('readiness climbs with academic year', () => {
  const rows = demoStudents();
  const avgFor = (year) => {
    const r = rows.filter((s) => s.year === year);
    return r.reduce((a, s) => a + s.readinessScore, 0) / r.length;
  };
  const avgs = YEAR_LIST.map(avgFor);
  for (let i = 1; i < avgs.length; i++) {
    assert.ok(avgs[i] > avgs[i - 1],
      `${YEAR_LIST[i]} (${avgs[i].toFixed(1)}) should out-score ${YEAR_LIST[i - 1]} (${avgs[i - 1].toFixed(1)})`);
  }
});

test('no first-year is recruiter-ready — that would read as fabricated', () => {
  for (const s of demoStudents().filter((x) => x.year === '1st year')) {
    assert.equal(s.recruiterReadyProjects, 0, `${s.id} is a first-year with recruiter-ready projects`);
  }
});

/* The whole point of four specialisations is that they are actually different.
   If every branch carried the same skills, the team-project skill matching
   would have nothing to match on. */
test('each specialisation carries skills the others do not', () => {
  const rows = demoStudents();
  const skillsOf = (branch) => new Set(rows.filter((s) => s.branch === branch).flatMap((s) => s.skills));
  const sets = Object.fromEntries(BRANCH_LIST.map((b) => [b, skillsOf(b)]));
  for (const branch of BRANCH_LIST) {
    const others = new Set(BRANCH_LIST.filter((b) => b !== branch).flatMap((b) => [...sets[b]]));
    const unique = [...sets[branch]].filter((s) => !others.has(s));
    assert.ok(unique.length >= 2, `${branch} has only ${unique.length} distinctive skills`);
  }
});

test('a student carries the academic fields a placement report needs', () => {
  for (const s of demoStudents()) {
    assert.ok(s.rollNo, `${s.id} has no roll number`);
    assert.ok(s.cgpa >= 6 && s.cgpa <= 10, `${s.id} has an implausible CGPA`);
    assert.ok(Number.isInteger(s.backlogs) && s.backlogs >= 0);
  }
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
  assert.equal(new Set(rows.map((s) => s.branch)).size, 4);
  assert.equal(new Set(rows.map((s) => s.batch)).size, 4);
});

/* ---------------- determinism ---------------- */

test('the cohort is identical across calls — a re-recorded take looks the same', () => {
  assert.deepEqual(demoStudents(), demoStudents());
  assert.deepEqual(demoStudents().map((s) => s.name), demoStudents().map((s) => s.name));
});

/* ---------------- filters ---------------- */

test('filters narrow the cohort correctly', () => {
  const aiml = demoStudents({ filters: { branch: 'CSE (AI & ML)' } });
  assert.equal(aiml.length, 50);
  assert.ok(aiml.every((s) => s.branch === 'CSE (AI & ML)'));

  const finalYear = demoStudents({ filters: { year: '4th year' } });
  assert.ok(finalYear.length > 0);
  assert.ok(finalYear.every((s) => s.year === '4th year'));

  const batch2026 = demoStudents({ filters: { batch: '2026' } });
  assert.ok(batch2026.every((s) => s.batch === '2026'));

  const spark = demoStudents({ filters: { skill: 'Spark' } });
  assert.ok(spark.length > 0, 'no Big Data student lists Spark');
  assert.ok(spark.every((s) => s.skills.some((k) => k.toLowerCase().includes('spark'))));

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
  assert.equal(rows.length, 200);
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
  assert.equal(demoStudentDetail('demo_9999'), null);
  assert.equal(demoStudentDetail(''), null);
});

test('drives, roster, tasks and members are populated', () => {
  assert.ok(demoDrives().length >= 3);
  assert.ok(demoDrives().some((d) => d.status === 'open'));
  assert.ok(demoRoster().rows.length > 150);
  assert.equal(demoRoster().counts.joined + demoRoster().counts.invited, demoRoster().rows.length);
  assert.ok(demoTasks().length >= 3);
  assert.ok(demoMembers().length >= 200);
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

/* ---------------- demo placement world ---------------- */
// The demo cohort IS the pilot demo, so its internal consistency is a product
// property, not a fixture detail. A TPO clicking through must never find a
// number that contradicts another number on the next screen.

test('demo drives and outcomes are deterministic across calls', async () => {
  const m = await import('../server/utils/demoCollegeData.js');
  assert.deepEqual(m.demoDrives(), m.demoDrives());
  assert.deepEqual(m.demoOutcomes(), m.demoOutcomes());
});

test('every demo outcome belongs to a real demo drive and a real demo student', async () => {
  const m = await import('../server/utils/demoCollegeData.js');
  const driveIds = new Set(m.demoDrives().map((d) => d.id));
  const studentIds = new Set(m.demoStudents().map((s) => s.id));
  for (const o of m.demoOutcomes()) {
    assert.ok(driveIds.has(o.driveId), `orphan outcome on drive ${o.driveId}`);
    assert.ok(studentIds.has(o.studentId), `outcome for unknown student ${o.studentId}`);
  }
});

test('no demo student is placed twice — one acceptance ends their season', async () => {
  const m = await import('../server/utils/demoCollegeData.js');
  const accepted = m.demoOutcomes().filter((o) => o.stage === 'accepted').map((o) => o.studentId);
  assert.equal(new Set(accepted).size, accepted.length, 'a student accepted two offers');
});

test('every demo applicant genuinely satisfies that drive\u2019s eligibility rules', async () => {
  const m = await import('../server/utils/demoCollegeData.js');
  const { eligibilityCheck } = await import('../server/utils/placementOutcomes.js');
  const byId = new Map(m.demoStudents().map((s) => [s.id, s]));
  const drives = new Map(m.demoDrives().map((d) => [d.id, d]));
  for (const o of m.demoOutcomes()) {
    const drive = drives.get(o.driveId);
    const student = byId.get(o.studentId);
    const r = eligibilityCheck(student, drive.eligibility || {});
    assert.equal(r.eligible, true, `${student.name} was in ${drive.company} but fails: ${r.reasons.join('; ')}`);
  }
});

test('the demo placement story is credible rather than perfect', async () => {
  const m = await import('../server/utils/demoCollegeData.js');
  const { buildPlacementStats } = await import('../server/utils/placementOutcomes.js');
  const rows = m.demoStudents();
  const stats = buildPlacementStats({
    rows, drives: m.demoDrives(), outcomes: m.demoOutcomes(), now: Date.now(),
  });
  const s = stats.summary;
  // A demo that shows 5% looks broken; one that shows 100% looks fake.
  assert.ok(s.placementRate >= 25 && s.placementRate <= 70, `placement rate ${s.placementRate}% is not believable`);
  assert.ok(s.recruiters >= 5, 'a real season has several recruiters, not one');
  assert.ok(s.highestCtc > s.medianCtc * 2, 'there should be a visible top-end offer');
  // Deliberately imperfect: at least one accepted offer lacks a package, so the
  // data-quality warning is exercised in the demo rather than only in tests.
  assert.ok(s.offersWithoutCtc >= 1, 'the CTC-coverage warning has nothing to show');
  assert.ok(s.ctcCoverage < 100 && s.ctcCoverage > 80);
  assert.ok(stats.readyUnplaced.length >= 1, 'the intervention list should not be empty in a demo');
});

test('every demo drive has a funnel with something in it', async () => {
  const m = await import('../server/utils/demoCollegeData.js');
  const { summarizeDrives } = await import('../server/utils/placementOutcomes.js');
  const summary = summarizeDrives({
    drives: m.demoDrives(), outcomes: m.demoOutcomes(), rows: m.demoStudents(),
  });
  for (const d of summary) {
    assert.ok(d.eligibleCount > 0, `${d.company} has nobody eligible`);
    assert.ok(d.participants > 0, `${d.company} has an empty funnel`);
    assert.ok(d.placed <= d.offered, `${d.company} placed more students than it made offers to`);
  }
});

test('demo snapshots stop before today so the live snapshot is the current value', async () => {
  const m = await import('../server/utils/demoCollegeData.js');
  const snaps = m.demoSnapshots();
  assert.ok(snaps.length >= 60, 'enough history for a 30-day baseline');
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(snaps.every((s) => s.date < today), 'demo history must not claim to be today');
  // Monotonic-ish growth: the cohort should look like it has been improving.
  assert.ok(snaps[snaps.length - 1].avgReadiness >= snaps[0].avgReadiness);
});
