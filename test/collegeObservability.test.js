import test from 'node:test';
import assert from 'node:assert/strict';
import {
  funnelStage, engagementBucket, riskFlags, momentumSeries, buildObservability,
  deepStudentCsv, FUNNEL_STAGES, DEEP_EXPORT_COLUMNS,
} from '../server/utils/collegeObservability.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-01T00:00:00.000Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const baseRow = (over = {}) => ({
  id: 'u1', name: 'Test', email: 't@x.in', branch: 'CSE', batch: '2026',
  skills: ['react', 'node'], verifiedSkills: [], totalVerifiedXp: 0,
  projectsTotal: 0, projectsVerified: 0, projectsPending: 0, projectsNeedsReview: 0,
  projectsRejected: 0, recruiterReadyProjects: 0, oldestPendingAt: null,
  readinessScore: null, resumeScore: null, lastActiveAt: null, ...over,
});

/* ---- funnelStage ---- */
test('funnelStage walks registered → recruiter_ready on objective signals', () => {
  assert.equal(funnelStage(baseRow({ branch: '', batch: '', skills: [] })), 'registered');
  assert.equal(funnelStage(baseRow()), 'profile_complete');
  assert.equal(funnelStage(baseRow({ projectsTotal: 1 })), 'building');
  assert.equal(funnelStage(baseRow({ projectsTotal: 1, projectsPending: 1 })), 'submitted');
  assert.equal(funnelStage(baseRow({ projectsTotal: 1, projectsVerified: 1 })), 'verified');
  assert.equal(funnelStage(baseRow({ projectsTotal: 2, projectsVerified: 2, recruiterReadyProjects: 1, readinessScore: 70 })), 'recruiter_ready');
  // recruiter-ready requires BOTH proof-linked verified project AND readiness ≥ 65
  assert.equal(funnelStage(baseRow({ projectsTotal: 2, projectsVerified: 2, recruiterReadyProjects: 1, readinessScore: 50 })), 'verified');
});

/* ---- engagementBucket ---- */
test('engagementBucket buckets by recency and handles null', () => {
  assert.equal(engagementBucket(null, NOW), 'never');
  assert.equal(engagementBucket('not-a-date', NOW), 'never');
  assert.equal(engagementBucket(iso(2 * DAY), NOW), 'active7');
  assert.equal(engagementBucket(iso(20 * DAY), NOW), 'active30');
  assert.equal(engagementBucket(iso(90 * DAY), NOW), 'dormant');
});

/* ---- riskFlags ---- */
test('riskFlags is deterministic and reasons are explicit', () => {
  const healthy = baseRow({
    projectsVerified: 2, verifiedSkills: ['react'], readinessScore: 80,
    resumeScore: 82, lastActiveAt: iso(1 * DAY),
  });
  assert.equal(riskFlags(healthy, NOW).severity, 0);

  const risky = baseRow({ lastActiveAt: iso(60 * DAY), readinessScore: 20 });
  const r = riskFlags(risky, NOW);
  const codes = r.flags.map((f) => f.code);
  assert.ok(codes.includes('no_verified_proof'));
  assert.ok(codes.includes('low_readiness'));
  assert.ok(codes.includes('no_resume'));
  assert.ok(codes.includes('inactive_30d'));
  assert.ok(r.severity >= 8);
  // determinism: identical input → identical output
  assert.deepEqual(riskFlags(risky, NOW), r);
});

test('riskFlags catches stalled submissions past 14 days only', () => {
  const stalled = baseRow({ projectsPending: 1, oldestPendingAt: iso(20 * DAY) });
  assert.ok(riskFlags(stalled, NOW).flags.some((f) => f.code === 'stalled_submission'));
  const fresh = baseRow({ projectsPending: 1, oldestPendingAt: iso(3 * DAY) });
  assert.ok(!riskFlags(fresh, NOW).flags.some((f) => f.code === 'stalled_submission'));
});

/* ---- momentumSeries ---- */
test('momentumSeries counts events into trailing ISO weeks and ignores out-of-window', () => {
  const events = [
    { type: 'verification', at: iso(1 * DAY) },
    { type: 'verification', at: iso(2 * DAY) },
    { type: 'resume', at: iso(10 * DAY) },
    { type: 'verification', at: iso(100 * DAY) }, // outside 8-week window
    { type: 'other', at: iso(1 * DAY) },          // unknown type ignored
  ];
  const series = momentumSeries(events, { now: NOW, weeks: 8 });
  assert.equal(series.length, 8);
  const totals = series.reduce((a, w) => ({
    verification: a.verification + w.counts.verification, resume: a.resume + w.counts.resume,
  }), { verification: 0, resume: 0 });
  assert.deepEqual(totals, { verification: 2, resume: 1 });
});

/* ---- buildObservability ---- */
test('buildObservability aggregates KPIs, funnel, matrices and risk register', () => {
  const rows = [
    baseRow({ id: 'a', branch: 'CSE', projectsTotal: 3, projectsVerified: 2, recruiterReadyProjects: 1, verifiedSkills: ['react', 'node'], readinessScore: 82, readinessCategory: 'Placement Ready', resumeScore: 78, lastActiveAt: iso(1 * DAY), totalVerifiedXp: 900 }),
    baseRow({ id: 'b', branch: 'CSE', projectsTotal: 1, projectsPending: 1, readinessScore: 35, readinessCategory: 'Needs Improvement', lastActiveAt: iso(45 * DAY) }),
    baseRow({ id: 'c', branch: 'ECE', readinessScore: 10, readinessCategory: 'Not Ready' }),
  ];
  const out = buildObservability({ rows, drives: [{ status: 'open' }, { status: 'closed' }], events: [], now: NOW });

  assert.equal(out.kpis.students, 3);
  assert.equal(out.kpis.verifiedStudents, 1);
  assert.equal(out.kpis.recruiterReady, 1);
  assert.equal(out.kpis.openDrives, 1);
  assert.equal(out.kpis.pendingReviews, 1);
  assert.ok(out.kpis.atRisk >= 2);

  // Funnel covers every stage and sums to n
  assert.deepEqual(out.funnel.map((f) => f.stage), FUNNEL_STAGES);
  assert.equal(out.funnel.reduce((s, f) => s + f.count, 0), 3);

  const cse = out.branchMatrix.find((b) => b.key === 'CSE');
  assert.equal(cse.count, 2);
  assert.equal(cse.avgReadiness, Math.round((82 + 35) / 2));
  assert.equal(cse.verifiedPct, 50);

  // Risk register sorted by severity desc
  const sev = out.riskRegister.map((r) => r.severity);
  assert.deepEqual(sev, [...sev].sort((x, y) => y - x));

  // Determinism
  assert.deepEqual(buildObservability({ rows, drives: [{ status: 'open' }, { status: 'closed' }], events: [], now: NOW }), out);
});

/* ---- deepStudentCsv ---- */
test('deepStudentCsv emits the full extended header and injection-safe rows', () => {
  const csv = deepStudentCsv([baseRow({ readinessScore: 50, readinessCategory: 'Apply Ready' })], NOW);
  const [header, row] = csv.split('\n');
  assert.equal(header, DEEP_EXPORT_COLUMNS.join(','));
  assert.equal(row.split(',').length, DEEP_EXPORT_COLUMNS.length);
  // RFC 4180: plain values are NOT quoted; quoting only when the cell needs it.
  assert.ok(row.includes('Apply Ready'));
  assert.ok(!row.includes('"Apply Ready"'));
});

test('deepStudentCsv neutralizes spreadsheet formula injection in student-controlled fields', () => {
  const evil = baseRow({ name: '=HYPERLINK("http://evil","x")', branch: '+cmd|calc', batch: '@SUM(1)' });
  const csv = deepStudentCsv([evil], NOW);
  const row = csv.split('\n')[1];
  // Every formula trigger char at cell start must be neutralized with a leading quote.
  assert.ok(row.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), 'equals-formula neutralized and quoted');
  assert.ok(row.includes("'+cmd|calc"), 'plus prefix neutralized');
  assert.ok(row.includes("'@SUM(1)"), 'at prefix neutralized');
  assert.ok(!/(^|,)=/.test(row), 'no raw =-cell survives');
});
