import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibilityCheck, matchDriveCohort, buildDriveFunnel, buildPlacementStats,
  summarizeDrives, median, isPlaced, hasOffer, stageDepth,
  PLACEMENT_STAGES, FUNNEL_STAGE_IDS,
} from '../server/utils/placementOutcomes.js';

const NOW = Date.parse('2026-08-01T00:00:00.000Z');

const student = (over = {}) => ({
  id: 's1', name: 'Test Student', email: 't@x.in', branch: 'CSE', batch: '2026', year: '4th',
  skills: ['React', 'Node'], verifiedSkills: [], readinessScore: 70, resumeScore: 75,
  projectsVerified: 2, recruiterReadyProjects: 1, ...over,
});

/* ================= eligibility ================= */

test('an empty eligibility object admits everyone', () => {
  const r = eligibilityCheck(student(), {});
  assert.equal(r.eligible, true);
  assert.deepEqual(r.reasons, []);
});

test('branch and batch are matched case-insensitively', () => {
  assert.equal(eligibilityCheck(student({ branch: 'cse' }), { branches: ['CSE'] }).eligible, true);
  assert.equal(eligibilityCheck(student({ branch: 'Mechanical' }), { branches: ['CSE', 'IT'] }).eligible, false);
  assert.equal(eligibilityCheck(student({ batch: '2026' }), { batches: ['2026', '2027'] }).eligible, true);
});

test('every failure carries a human-readable reason a TPO can quote back', () => {
  const r = eligibilityCheck(
    student({ branch: 'Civil', readinessScore: 30, resumeScore: 40 }),
    { branches: ['CSE'], minReadiness: 60, minResume: 70 }
  );
  assert.equal(r.eligible, false);
  assert.equal(r.reasons.length, 3);
  assert.ok(r.reasons.some((x) => x.includes('Civil')));
  assert.ok(r.reasons.some((x) => x.includes('60')));
  assert.ok(r.reasons.some((x) => x.includes('70')));
});

test('a missing resume reads as missing, not as a zero score', () => {
  const r = eligibilityCheck(student({ resumeScore: null }), { minResume: 60 });
  assert.equal(r.eligible, false);
  assert.ok(/No resume on file/.test(r.reasons[0]), r.reasons[0]);
});

test('skills can be required as declared or as verified', () => {
  const s = student({ skills: ['React', 'SQL'], verifiedSkills: ['React'] });
  assert.equal(eligibilityCheck(s, { skills: ['SQL'] }).eligible, true);
  const strict = eligibilityCheck(s, { skills: ['SQL'], requireVerifiedSkills: true });
  assert.equal(strict.eligible, false);
  assert.ok(/verified skill/.test(strict.reasons[0]), strict.reasons[0]);
});

test('a comma-separated string is accepted wherever a list is', () => {
  assert.equal(eligibilityCheck(student({ branch: 'IT' }), { branches: 'CSE, IT' }).eligible, true);
});

test('minVerifiedProjects reads either field name for verified project count', () => {
  assert.equal(eligibilityCheck({ ...student({ projectsVerified: undefined }), verifiedProjects: 3 }, { minVerifiedProjects: 2 }).eligible, true);
  assert.equal(eligibilityCheck(student({ projectsVerified: 0 }), { minVerifiedProjects: 1 }).eligible, false);
});

test('matchDriveCohort splits the cohort and ranks each side by readiness', () => {
  const rows = [
    student({ id: 'a', branch: 'CSE', readinessScore: 60 }),
    student({ id: 'b', branch: 'CSE', readinessScore: 90 }),
    student({ id: 'c', branch: 'Civil', readinessScore: 80 }),
  ];
  const { eligible, ineligible, eligibleCount, total } = matchDriveCohort(rows, { eligibility: { branches: ['CSE'] } });
  assert.equal(total, 3);
  assert.equal(eligibleCount, 2);
  assert.deepEqual(eligible.map((r) => r.id), ['b', 'a']);
  assert.equal(ineligible[0].id, 'c');
  assert.ok(ineligible[0].reasons.length > 0);
});

/* ================= funnel ================= */

test('the funnel is monotonic — each stage includes everyone deeper', () => {
  const f = buildDriveFunnel([
    { studentId: '1', stage: 'applied' },
    { studentId: '2', stage: 'shortlisted' },
    { studentId: '3', stage: 'accepted' },
  ]);
  const counts = Object.fromEntries(f.stages.map((s) => [s.id, s.count]));
  assert.equal(counts.applied, 3);
  assert.equal(counts.shortlisted, 2);
  assert.equal(counts.interviewed, 1);
  assert.equal(counts.accepted, 1);
  for (let i = 1; i < FUNNEL_STAGE_IDS.length; i++) {
    assert.ok(counts[FUNNEL_STAGE_IDS[i]] <= counts[FUNNEL_STAGE_IDS[i - 1]], 'funnel must never widen');
  }
});

test('a rejected student still counts in the rounds they actually cleared', () => {
  const f = buildDriveFunnel([{ studentId: '1', stage: 'rejected', furthestStage: 'interviewed' }]);
  const counts = Object.fromEntries(f.stages.map((s) => [s.id, s.count]));
  assert.equal(counts.applied, 1);
  assert.equal(counts.interviewed, 1);
  assert.equal(counts.offered, 0);
  assert.equal(f.rejected, 1);
});

test('an empty drive produces zeroes, not NaN or a division error', () => {
  const f = buildDriveFunnel([]);
  assert.equal(f.participants, 0);
  assert.equal(f.offerRate, 0);
  for (const s of f.stages) {
    assert.equal(s.count, 0);
    assert.equal(s.conversionFromTop, 0);
  }
});

/* ================= placement statistics ================= */

const drives = [
  { id: 'd1', title: 'Backend', company: 'Northwind', status: 'open', eligibility: { branches: ['CSE'] } },
  { id: 'd2', title: 'Analyst', company: 'Kestrel', status: 'closed', eligibility: {} },
];

const cohort = [
  student({ id: 'a', branch: 'CSE', readinessScore: 88 }),
  student({ id: 'b', branch: 'CSE', readinessScore: 74 }),
  student({ id: 'c', branch: 'IT', readinessScore: 45 }),
  student({ id: 'd', branch: 'IT', readinessScore: 91 }),
];

test('placed means accepted — an outstanding offer never inflates the rate', () => {
  const stats = buildPlacementStats({
    rows: cohort, drives, now: NOW,
    outcomes: [
      { driveId: 'd1', studentId: 'a', stage: 'accepted', ctcLpa: 12, company: 'Northwind' },
      { driveId: 'd1', studentId: 'b', stage: 'offered', ctcLpa: 11, company: 'Northwind' },
    ],
  });
  assert.equal(stats.summary.placed, 1);
  assert.equal(stats.summary.placementRate, 25); // 1 of 4
  assert.equal(stats.summary.offers, 2);
});

test('a student holding two offers is still exactly one placement', () => {
  const stats = buildPlacementStats({
    rows: cohort, drives, now: NOW,
    outcomes: [
      { driveId: 'd1', studentId: 'a', stage: 'accepted', ctcLpa: 12, company: 'Northwind' },
      { driveId: 'd2', studentId: 'a', stage: 'offered', ctcLpa: 8, company: 'Kestrel' },
    ],
  });
  assert.equal(stats.summary.placed, 1);
  assert.equal(stats.summary.multiOffer, 1);
  assert.equal(stats.summary.offers, 2);
});

test('a missing CTC is excluded from the median, never counted as zero', () => {
  const stats = buildPlacementStats({
    rows: cohort, drives, now: NOW,
    outcomes: [
      { driveId: 'd1', studentId: 'a', stage: 'accepted', ctcLpa: 10, company: 'N' },
      { driveId: 'd1', studentId: 'b', stage: 'accepted', ctcLpa: 20, company: 'N' },
      { driveId: 'd1', studentId: 'c', stage: 'accepted', ctcLpa: null, company: 'N' },
    ],
  });
  assert.equal(stats.summary.placed, 3);
  assert.equal(stats.summary.medianCtc, 15); // NOT 10, which is what a zero would give
  assert.equal(stats.summary.offersWithoutCtc, 1);
  assert.equal(stats.summary.ctcCoverage, 67);
});

test('branch splits carry their own placement rate and package figures', () => {
  const stats = buildPlacementStats({
    rows: cohort, drives, now: NOW,
    outcomes: [{ driveId: 'd1', studentId: 'a', stage: 'accepted', ctcLpa: 12, company: 'Northwind' }],
  });
  const cse = stats.byBranch.find((b) => b.key === 'CSE');
  const it = stats.byBranch.find((b) => b.key === 'IT');
  assert.equal(cse.total, 2);
  assert.equal(cse.placed, 1);
  assert.equal(cse.placementRate, 50);
  assert.equal(cse.medianCtc, 12);
  assert.equal(it.placementRate, 0);
});

test('readyUnplaced lists prepared students with no accepted offer, best first', () => {
  const stats = buildPlacementStats({
    rows: cohort, drives, now: NOW,
    outcomes: [{ driveId: 'd1', studentId: 'a', stage: 'accepted', ctcLpa: 12 }],
  });
  const ids = stats.readyUnplaced.map((r) => r.id);
  assert.deepEqual(ids, ['d', 'b']); // 'a' placed, 'c' below the 70 line
  assert.equal(stats.readyUnplaced[0].readinessScore, 91);
  assert.equal(stats.readyUnplaced[0].applications, 0);
});

test('recruiters are ranked by hires and carry package figures', () => {
  const stats = buildPlacementStats({
    rows: cohort, drives, now: NOW,
    outcomes: [
      { driveId: 'd1', studentId: 'a', stage: 'accepted', ctcLpa: 12, company: 'Northwind' },
      { driveId: 'd1', studentId: 'b', stage: 'accepted', ctcLpa: 14, company: 'Northwind' },
      { driveId: 'd2', studentId: 'c', stage: 'accepted', ctcLpa: 30, company: 'Kestrel' },
    ],
  });
  assert.equal(stats.topRecruiters[0].company, 'Northwind');
  assert.equal(stats.topRecruiters[0].hires, 2);
  assert.equal(stats.topRecruiters[0].highestCtc, 14);
  assert.equal(stats.summary.highestCtc, 30);
});

test('an empty college produces zeroes rather than NaN anywhere', () => {
  const stats = buildPlacementStats({ rows: [], drives: [], outcomes: [], now: NOW });
  for (const [key, v] of Object.entries(stats.summary)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${key} must be finite, got ${v}`);
  }
  assert.equal(stats.summary.placementRate, 0);
  assert.deepEqual(stats.readyUnplaced, []);
});

test('outcomes for an unknown student id are ignored, not crashed on', () => {
  const stats = buildPlacementStats({
    rows: cohort, drives, now: NOW,
    outcomes: [{ driveId: 'd1', studentId: 'ghost', stage: 'accepted', ctcLpa: 9 }],
  });
  assert.equal(stats.summary.placed, 1);
  assert.equal(stats.byBranch.reduce((a, b) => a + b.placed, 0), 0); // no branch claims a ghost
});

/* ================= drive summaries ================= */

test('summarizeDrives attaches eligibility and outcome roll-ups per drive', () => {
  const summary = summarizeDrives({
    drives, rows: cohort,
    outcomes: [
      { driveId: 'd1', studentId: 'a', stage: 'accepted', ctcLpa: 12 },
      { driveId: 'd1', studentId: 'b', stage: 'shortlisted' },
    ],
  });
  const d1 = summary.find((d) => d.id === 'd1');
  assert.equal(d1.eligibleCount, 2); // CSE only
  assert.equal(d1.participants, 2);
  assert.equal(d1.placed, 1);
  assert.equal(d1.medianCtc, 12);
  const d2 = summary.find((d) => d.id === 'd2');
  assert.equal(d2.eligibleCount, 4); // no criteria
  assert.equal(d2.participants, 0);
});

/* ================= primitives ================= */

test('median handles even, odd and empty inputs', () => {
  assert.equal(median([]), 0);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 3]), 2);
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([1, 'x', null, 3]), 2); // junk is filtered, not coerced
});

test('stage predicates and depths agree with the declared stage list', () => {
  assert.equal(isPlaced({ stage: 'accepted' }), true);
  assert.equal(isPlaced({ stage: 'offered' }), false);
  assert.equal(hasOffer({ stage: 'offered' }), true);
  assert.equal(stageDepth('rejected'), -1); // an exit, not a depth
  assert.equal(stageDepth('applied'), 0);
  assert.ok(PLACEMENT_STAGES.every((s) => typeof s.label === 'string' && s.label.length > 0));
});

/* ============================================================
   Placement rate is scoped to the graduating cohort
   ------------------------------------------------------------
   A department with four year-groups on the platform has ~75% of its
   students not yet placeable. Dividing placements by the whole roster
   reported a rate no TPO recognises (22% when the real figure was 41%)
   and that no NAAC/NBA return would accept. The graduating cohort is
   derived from the batches the college's own drives target, so it needs
   no extra configuration.
   ============================================================ */

test('placement rate is computed over the batches the drives actually target', () => {
  const rows = [
    { id: 'a', branch: 'CSE', batch: '2026', readinessScore: 80 },
    { id: 'b', branch: 'CSE', batch: '2026', readinessScore: 75 },
    // Two juniors who cannot be placed this season and must not dilute the rate.
    { id: 'c', branch: 'CSE', batch: '2028', readinessScore: 30 },
    { id: 'd', branch: 'CSE', batch: '2029', readinessScore: 20 },
  ];
  const drives = [{ id: 'd1', title: 'Campus Hire', company: 'Acme', ctcLpa: 10, status: 'open', eligibility: { batches: ['2026'] } }];
  const outcomes = [{ driveId: 'd1', studentId: 'a', stage: 'accepted', ctcLpa: 10, company: 'Acme' }];

  const s = buildPlacementStats({ rows, drives, outcomes, now: Date.now() }).summary;
  assert.equal(s.students, 4, 'the total roster is still reported');
  assert.equal(s.placementCohortSize, 2, 'only the 2026 batch is placeable');
  assert.deepEqual(s.graduatingBatches, ['2026']);
  assert.equal(s.placementRate, 50, '1 of the 2 graduating students is placed');
  assert.equal(s.placementRateAllStudents, 25, 'the all-roster figure is kept for continuity');
});

test('with no batch-scoped drive the rate falls back to the whole roster', () => {
  // A fresh college, or a single-batch pilot, must behave exactly as before.
  const rows = [
    { id: 'a', branch: 'CSE', batch: '2026', readinessScore: 80 },
    { id: 'b', branch: 'CSE', batch: '2026', readinessScore: 40 },
  ];
  const drives = [{ id: 'd1', title: 'Open Drive', company: 'Acme', ctcLpa: 8, status: 'open', eligibility: {} }];
  const outcomes = [{ driveId: 'd1', studentId: 'a', stage: 'accepted', ctcLpa: 8, company: 'Acme' }];

  const s = buildPlacementStats({ rows, drives, outcomes, now: Date.now() }).summary;
  assert.equal(s.placementCohortSize, 2);
  assert.deepEqual(s.graduatingBatches, []);
  assert.equal(s.placementRate, s.placementRateAllStudents, 'both figures agree when no batch is targeted');
});
