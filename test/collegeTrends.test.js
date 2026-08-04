import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey, snapshotMetrics, computeStockDeltas, computeFlowDeltas, batchComparison, TREND_KEYS,
} from '../server/utils/collegeTrends.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-01T00:00:00.000Z');
const ago = (days) => new Date(NOW - days * DAY).toISOString();

const row = (over = {}) => ({
  id: 'r1', branch: 'CSE', batch: '2026', readinessScore: 70, resumeScore: 75,
  projectsVerified: 1, recruiterReadyProjects: 1, lastActiveAt: ago(1), ...over,
});

/* ================= snapshots ================= */

test('dayKey buckets to a UTC date so there is one snapshot per day', () => {
  assert.equal(dayKey(NOW), '2026-08-01');
  assert.equal(dayKey(NOW + 23 * 60 * 60 * 1000), '2026-08-01');
  assert.equal(dayKey(NOW + DAY), '2026-08-02');
});

test('snapshotMetrics captures the stock metrics that cannot be recovered later', () => {
  const m = snapshotMetrics({
    rows: [
      row({ readinessScore: 80, resumeScore: 90 }),
      row({ readinessScore: 60, resumeScore: null, recruiterReadyProjects: 0 }),
    ],
    now: NOW,
  });
  assert.equal(m.students, 2);
  assert.equal(m.avgReadiness, 70);
  assert.equal(m.avgResume, 90); // averaged over students WITH a resume only
  assert.equal(m.withResume, 1);
  assert.equal(m.recruiterReady, 1);
  assert.equal(m.placementReady, 1); // only the 80
  assert.equal(m.date, '2026-08-01');
});

test('snapshotMetrics on an empty cohort is all zeroes and never NaN', () => {
  const m = snapshotMetrics({ rows: [], now: NOW });
  for (const [key, v] of Object.entries(m)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${key} must be finite`);
  }
});

/* ================= stock deltas — the honesty rule ================= */

test('with no stored history the delta is null, never a reassuring zero', () => {
  const current = snapshotMetrics({ rows: [row()], now: NOW });
  const d = computeStockDeltas({ current, history: [], now: NOW });
  assert.equal(d.hasBaseline, false);
  assert.equal(d.baselineDays, 0);
  for (const m of d.metrics) {
    assert.equal(m.delta, null, `${m.key} must report null, not 0`);
    assert.equal(m.previous, null);
  }
});

test('a single snapshot from today is not a baseline against itself', () => {
  const current = snapshotMetrics({ rows: [row()], now: NOW });
  const d = computeStockDeltas({ current, history: [current], now: NOW });
  assert.equal(d.hasBaseline, false);
});

test('deltas are computed against the newest snapshot older than the window', () => {
  const current = { avgReadiness: 70, avgResume: 80, recruiterReady: 10, verifiedStudents: 12, placementReady: 8, students: 40 };
  const history = [
    { at: ago(90), avgReadiness: 40, avgResume: 60, recruiterReady: 2, verifiedStudents: 3, placementReady: 1, students: 20 },
    { at: ago(31), avgReadiness: 60, avgResume: 75, recruiterReady: 6, verifiedStudents: 8, placementReady: 5, students: 35 },
    { at: ago(2), avgReadiness: 69, avgResume: 79, recruiterReady: 9, verifiedStudents: 11, placementReady: 7, students: 39 },
  ];
  const d = computeStockDeltas({ current, history, windowDays: 30, now: NOW });
  assert.equal(d.hasBaseline, true);
  assert.equal(d.baselineDays, 31); // the 31-day-old one, not the 90 and not the 2
  const readiness = d.metrics.find((m) => m.key === 'avgReadiness');
  assert.equal(readiness.previous, 60);
  assert.equal(readiness.delta, 10);
  assert.equal(readiness.pctChange, 17);
  assert.equal(readiness.direction, 'up');
});

test('a college younger than the window falls back to its oldest snapshot and says so', () => {
  const current = { avgReadiness: 55, avgResume: 0, recruiterReady: 0, verifiedStudents: 0, placementReady: 0, students: 10 };
  const history = [{ at: ago(4), avgReadiness: 50, avgResume: 0, recruiterReady: 0, verifiedStudents: 0, placementReady: 0, students: 9 }];
  const d = computeStockDeltas({ current, history, windowDays: 30, now: NOW });
  assert.equal(d.hasBaseline, true);
  assert.equal(d.baselineDays, 4);
  assert.ok(d.baselineDays < d.windowDays, 'UI uses this to caption the comparison honestly');
});

test('a genuinely flat metric reports zero, distinct from an absent baseline', () => {
  const current = { avgReadiness: 70, avgResume: 80, recruiterReady: 5, verifiedStudents: 5, placementReady: 5, students: 20 };
  const history = [{ at: ago(40), ...current }];
  const d = computeStockDeltas({ current, history, now: NOW });
  const readiness = d.metrics.find((m) => m.key === 'avgReadiness');
  assert.equal(readiness.delta, 0);
  assert.notEqual(readiness.delta, null);
  assert.equal(readiness.direction, 'flat');
});

test('every declared trend key is present in the output', () => {
  const d = computeStockDeltas({ current: {}, history: [], now: NOW });
  assert.deepEqual(d.metrics.map((m) => m.key).sort(), TREND_KEYS.map((k) => k.key).sort());
});

/* ================= flow deltas ================= */

test('flow deltas compare the window against the window before it', () => {
  const events = [
    { type: 'verification', at: ago(3) },
    { type: 'verification', at: ago(10) },
    { type: 'verification', at: ago(40) },
    { type: 'resume', at: ago(5) },
    { type: 'resume', at: ago(45) },
    { type: 'resume', at: ago(50) },
  ];
  const f = computeFlowDeltas({ events, windowDays: 30, now: NOW });
  assert.equal(f.verifications.current, 2);
  assert.equal(f.verifications.previous, 1);
  assert.equal(f.verifications.delta, 1);
  assert.equal(f.resumes.current, 1);
  assert.equal(f.resumes.previous, 2);
  assert.equal(f.resumes.direction, 'down');
  assert.equal(f.allActivity.current, 3);
});

test('events older than both windows and malformed timestamps are ignored', () => {
  const f = computeFlowDeltas({
    events: [{ type: 'verification', at: ago(200) }, { type: 'verification', at: 'garbage' }, { type: 'verification' }],
    windowDays: 30, now: NOW,
  });
  assert.equal(f.verifications.current, 0);
  assert.equal(f.verifications.previous, 0);
  assert.equal(f.verifications.pctChange, null); // no baseline to divide by
});

/* ================= batch comparison ================= */

test('batches sort newest first and each carries a delta against the previous one', () => {
  const rows = [
    row({ id: 'a', batch: '2026', readinessScore: 80, resumeScore: 85 }),
    row({ id: 'b', batch: '2026', readinessScore: 60, resumeScore: 65 }),
    row({ id: 'c', batch: '2025', readinessScore: 50, resumeScore: 55, projectsVerified: 0, recruiterReadyProjects: 0 }),
  ];
  const out = batchComparison({ rows, placedIds: new Set(['a']), now: NOW });
  assert.deepEqual(out.map((r) => r.batch), ['2026', '2025']);

  const y26 = out[0];
  assert.equal(y26.students, 2);
  assert.equal(y26.avgReadiness, 70);
  assert.equal(y26.placed, 1);
  assert.equal(y26.placementRate, 50);
  assert.equal(y26.verifiedCoverage, 100);
  assert.equal(y26.placementReadyRate, 50); // only the 80 clears 70

  assert.equal(y26.vsPrevious.batch, '2025');
  assert.equal(y26.vsPrevious.avgReadiness, 20);
  assert.equal(y26.vsPrevious.verifiedCoverage, 100);

  assert.equal(out[1].vsPrevious, null, 'the oldest batch has nothing to compare against');
});

test('a blank batch merges into Unknown rather than becoming its own cohort', () => {
  const out = batchComparison({
    rows: [row({ id: 'a', batch: 'Unknown' }), row({ id: 'b', batch: '' })],
    now: NOW,
  });
  assert.equal(out.length, 1, 'students with no batch are one Unknown group, not two');
  assert.equal(out[0].batch, 'Unknown');
  assert.equal(out[0].students, 2);
  assert.ok(Number.isFinite(out[0].avgReadiness));
});

test('non-numeric and numeric batch labels sort together without throwing', () => {
  const out = batchComparison({
    rows: [row({ id: 'a', batch: '2026' }), row({ id: 'b', batch: 'Unknown' }), row({ id: 'c', batch: '2025' })],
    now: NOW,
  });
  assert.equal(out.length, 3);
  assert.ok(out.every((r) => Number.isFinite(r.avgReadiness)));
});

test('an empty cohort yields an empty comparison rather than a divide-by-zero', () => {
  assert.deepEqual(batchComparison({ rows: [], now: NOW }), []);
});
