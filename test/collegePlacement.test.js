// College placement API — end-to-end against a real booted server.
//
// Runs DB-less with DEMO_MODE on, which is the same configuration the pilot
// demo uses, so these tests exercise the exact code path a placement cell sees
// on the hosted app: drive lifecycle, eligibility matching, outcome recording,
// placement statistics, trend deltas, task roll-up and directory pagination.
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEV_LOGIN = '1';
process.env.DEMO_MODE = '1';
process.env.ADMIN_EMAILS = 'placement-admin@test.dev';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';

let server, base, client;

before(async () => {
  ({ server, base } = await startServer());
  client = makeClient(base);
  await client.devLogin('Placement Admin', 'placement-admin@test.dev');
});
after(async () => { await stopServer(server); });

// The shared harness returns { status, json, text }. These unwrap to the body
// so each test reads as the API contract rather than as transport plumbing.
const GET = async (p) => (await client.get(p)).json;
const POST = async (p, b) => (await client.post(p, b)).json;
const PATCH = async (p, b) => (await client.patch(p, b)).json;
const DEL = async (p) => (await client.del(p)).json;
const ok = (r, label) => { assert.equal(r?.ok, true, `${label}: ${JSON.stringify(r).slice(0, 300)}`); return r; };

/* ============================================================
   Drive lifecycle
   ============================================================ */

let createdDriveId = '';

test('a drive can be created with full eligibility criteria', async () => {
  const r = ok(await POST('/api/college/drives', {
    title: 'Integration Test Drive',
    company: 'Testworks',
    role: 'SDE-1',
    ctcLpa: 15,
    eligibility: { branches: ['CSE'], batches: ['2026'], minReadiness: 40 },
  }), 'create drive');
  assert.ok(r.drive?.id, 'drive gets an id');
  createdDriveId = r.drive.id;
  assert.equal(r.drive.title, 'Integration Test Drive');
  assert.equal(r.drive.ctcLpa, 15);
});

test('a drive without a title is rejected with a usable message', async () => {
  const r = await POST('/api/college/drives', { company: 'No Title Co' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid_input');
  assert.ok(String(r.details?.[0] || '').length > 0, 'the reason is stated');
});

test('the drive list carries an eligibility and outcome roll-up per drive', async () => {
  const r = ok(await GET('/api/college/drives'), 'list drives');
  const mine = r.drives.find((d) => d.id === createdDriveId);
  assert.ok(mine, 'the created drive is listed');
  for (const key of ['eligibleCount', 'participants', 'offered', 'placed', 'medianCtc', 'offerRate']) {
    assert.ok(key in mine, `roll-up includes ${key}`);
  }
  assert.ok(Array.isArray(r.stages) && r.stages.length > 0, 'stage vocabulary is published to the client');
});

test('a drive can be edited, and identity fields cannot be rewritten through the patch', async () => {
  const r = ok(await PATCH(`/api/college/drives/${createdDriveId}`, {
    title: 'Renamed Drive', status: 'in_progress', id: 'hacked', collegeId: 'other-college',
  }), 'patch drive');
  assert.equal(r.drive.title, 'Renamed Drive');
  assert.equal(r.drive.status, 'in_progress');
  assert.notEqual(r.drive.id, 'hacked', 'the logical id is immutable');
});

test('patching a drive that does not exist is a clean 404, not a crash', async () => {
  const r = await PATCH('/api/college/drives/does-not-exist', { title: 'X' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_found_or_out_of_scope');
});

/* ============================================================
   Eligibility matching
   ============================================================ */

test('the cohort endpoint splits eligible from ineligible and explains every exclusion', async () => {
  const r = ok(await GET(`/api/college/drives/${createdDriveId}/cohort`), 'drive cohort');
  assert.ok(r.counts.total > 0, 'the demo cohort is present');
  assert.equal(r.counts.eligible + r.counts.ineligible, r.counts.total, 'the split is exhaustive');

  // Every eligible student really does satisfy the criteria we set.
  for (const s of r.eligible) {
    assert.equal(String(s.branch).toUpperCase(), 'CSE');
    assert.equal(String(s.batch), '2026');
    assert.ok(Number(s.readinessScore) >= 40);
    assert.deepEqual(s.reasons, []);
  }
  // Every exclusion states a reason a TPO could read out to a student.
  for (const s of r.ineligible.slice(0, 20)) {
    assert.ok(s.reasons.length > 0, `${s.name} was excluded without a reason`);
    assert.ok(s.reasons.every((x) => typeof x === 'string' && x.length > 3));
  }
});

/* ============================================================
   Outcome recording
   ============================================================ */

test('recording outcomes updates the funnel and respects college scope', async () => {
  const cohort = await GET(`/api/college/drives/${createdDriveId}/cohort`);
  const ids = cohort.eligible.slice(0, 4).map((s) => s.id);
  assert.ok(ids.length >= 2, 'need a couple of eligible students to test with');

  const r = ok(await POST(`/api/college/drives/${createdDriveId}/outcomes`, {
    entries: [
      { studentId: ids[0], stage: 'accepted', ctcLpa: 18 },
      { studentId: ids[1], stage: 'offered' },
      // A student from another college must be silently dropped, not recorded.
      { studentId: 'not-in-this-college', stage: 'accepted', ctcLpa: 99 },
    ],
  }), 'save outcomes');

  assert.equal(r.saved, 2);
  assert.equal(r.skipped, 1, 'the out-of-scope student was rejected');

  const counts = Object.fromEntries(r.funnel.stages.map((s) => [s.id, s.count]));
  assert.equal(counts.applied, 2);
  assert.equal(counts.offered, 2);
  assert.equal(counts.accepted, 1, 'an outstanding offer is not an acceptance');
});

test('an offer with no CTC inherits the package advertised on the drive', async () => {
  const r = ok(await GET(`/api/college/drives/${createdDriveId}/outcomes`), 'read outcomes');
  const inherited = r.outcomes.find((o) => o.stage === 'offered');
  assert.equal(inherited.ctcLpa, 15, 'fell back to the drive ctcLpa rather than staying null');
  const explicit = r.outcomes.find((o) => o.stage === 'accepted');
  assert.equal(explicit.ctcLpa, 18, 'an explicit package is never overwritten');
});

test('re-recording a student updates in place instead of duplicating them', async () => {
  const before = await GET(`/api/college/drives/${createdDriveId}/outcomes`);
  const target = before.outcomes.find((o) => o.stage === 'offered');

  ok(await POST(`/api/college/drives/${createdDriveId}/outcomes`, {
    entries: [{ studentId: target.studentId, stage: 'rejected' }],
  }), 're-record');

  const after = await GET(`/api/college/drives/${createdDriveId}/outcomes`);
  assert.equal(after.outcomes.length, before.outcomes.length, 'no duplicate row was created');
  const updated = after.outcomes.find((o) => o.studentId === target.studentId);
  assert.equal(updated.stage, 'rejected');
  assert.equal(updated.furthestStage, 'offered', 'the round they actually cleared is preserved');
});

test('an outcome can be cleared', async () => {
  const list = await GET(`/api/college/drives/${createdDriveId}/outcomes`);
  const victim = list.outcomes[0];
  ok(await DEL(`/api/college/drives/${createdDriveId}/outcomes/${victim.studentId}`), 'delete outcome');
  const after = await GET(`/api/college/drives/${createdDriveId}/outcomes`);
  assert.equal(after.outcomes.length, list.outcomes.length - 1);
});

/* ============================================================
   Placement report
   ============================================================ */

test('the placement report exposes the figures a TPO reports upward', async () => {
  const r = ok(await GET('/api/college/placement'), 'placement report');
  for (const key of ['students', 'placed', 'placementRate', 'offers', 'medianCtc', 'highestCtc', 'recruiters']) {
    assert.ok(key in r.summary, `summary includes ${key}`);
    assert.ok(Number.isFinite(Number(r.summary[key])), `${key} is a real number`);
  }
  assert.ok(r.summary.placementRate >= 0 && r.summary.placementRate <= 100, 'rate is a percentage');
  assert.ok(Array.isArray(r.byBranch) && Array.isArray(r.byBatch));
  assert.ok(Array.isArray(r.readyUnplaced));
  assert.ok(Array.isArray(r.batchComparison));
});

test('placement statistics stay internally consistent', async () => {
  const r = await GET('/api/college/placement');
  const branchPlaced = r.byBranch.reduce((a, b) => a + b.placed, 0);
  assert.equal(branchPlaced, r.summary.placed, 'branch splits sum to the headline placed count');
  const branchTotal = r.byBranch.reduce((a, b) => a + b.total, 0);
  assert.equal(branchTotal, r.summary.students, 'no student is missing from the branch split');
  assert.ok(r.summary.highestCtc >= r.summary.medianCtc, 'highest cannot be below the median');
});

/* ============================================================
   Trends
   ============================================================ */

test('observability carries trend deltas, batch comparison and a placement roll-up', async () => {
  const r = ok(await GET('/api/college/observability?fresh=1'), 'observability');
  assert.ok(r.trends, 'trends block is present');
  assert.ok(Array.isArray(r.trends.stock.metrics) && r.trends.stock.metrics.length > 0);
  assert.ok(r.trends.flow.verifications, 'flow deltas are available without stored history');
  assert.ok(Array.isArray(r.batchComparison));
  assert.ok(r.placement && 'placementRate' in r.placement);
});

test('a stock delta is either a real number with a baseline, or explicitly null', async () => {
  const r = await GET('/api/college/observability?fresh=1');
  const { stock } = r.trends;
  for (const m of stock.metrics) {
    if (stock.hasBaseline) {
      assert.ok(Number.isFinite(m.delta), `${m.key} should have a numeric delta when a baseline exists`);
      assert.ok(Number.isFinite(m.previous));
    } else {
      assert.equal(m.delta, null, `${m.key} must be null rather than a fabricated zero`);
    }
  }
});

/* ============================================================
   Interventions
   ============================================================ */

test('the task list reports completion, overdue state and a cohort roll-up', async () => {
  const r = ok(await GET('/api/college/tasks'), 'tasks');
  assert.ok(r.summary, 'summary roll-up present');
  for (const key of ['tasks', 'assigned', 'done', 'pending', 'completionRate', 'overdue']) {
    assert.ok(key in r.summary, `summary includes ${key}`);
  }
  for (const t of r.tasks) {
    // Shape normalization across the DB and demo paths is the point of this test.
    assert.ok(Number.isFinite(t.assigned) && Number.isFinite(t.done), 'counts are normalized');
    assert.equal(t.pending, Math.max(0, t.assigned - t.done));
    assert.ok(t.completionRate >= 0 && t.completionRate <= 100);
    assert.ok(['active', 'overdue', 'complete'].includes(t.status));
  }
  const sumAssigned = r.tasks.reduce((a, t) => a + t.assigned, 0);
  assert.equal(sumAssigned, r.summary.assigned, 'the roll-up matches the rows');
});

/* ============================================================
   Directory hardening
   ============================================================ */

test('the directory paginates and reports a real total', async () => {
  const page1 = ok(await GET('/api/college/students?limit=10&offset=0'), 'page 1');
  assert.equal(page1.students.length, 10);
  assert.ok(page1.total > 10, 'total reflects the whole cohort, not the page');
  assert.equal(page1.hasMore, true);

  const page2 = await GET('/api/college/students?limit=10&offset=10');
  const ids1 = new Set(page1.students.map((s) => s.id));
  assert.ok(page2.students.every((s) => !ids1.has(s.id)), 'page 2 is genuinely different rows');
});

test('sorting is applied server-side, so page 2 is the real page 2', async () => {
  const desc = await GET('/api/college/students?sort=readinessScore&order=desc&limit=50');
  const scores = desc.students.map((s) => Number(s.readinessScore || 0));
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'descending order holds');

  const asc = await GET('/api/college/students?sort=name&order=asc&limit=5');
  const names = asc.students.map((s) => s.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('an unknown sort field falls back to a safe default rather than erroring', async () => {
  const r = ok(await GET('/api/college/students?sort=__proto__&limit=5'), 'bad sort');
  assert.equal(r.sort, 'readinessScore');
});

test('deep mode adds engagement, funnel stage and risk without changing the default shape', async () => {
  const shallow = await GET('/api/college/students?limit=3');
  assert.equal(shallow.deep, false);
  assert.ok(!('engagement' in shallow.students[0]), 'the default contract is untouched');

  const deep = ok(await GET('/api/college/students?limit=3&deep=1'), 'deep mode');
  assert.equal(deep.deep, true);
  for (const s of deep.students) {
    assert.ok(s.funnelStage, 'funnel stage present');
    assert.ok(['active7', 'active30', 'dormant', 'never'].includes(s.engagement));
    assert.ok(Number.isFinite(s.riskSeverity), 'severity is the numeric sort key');
    assert.ok(['none', 'low', 'medium', 'high'].includes(s.riskBand), 'band is the human-readable label');
  }
});

test('free-text search matches on name and email', async () => {
  const all = await GET('/api/college/students?limit=1');
  const name = String(all.students[0].name || '').split(' ')[0];
  const r = ok(await GET(`/api/college/students?q=${encodeURIComponent(name)}&limit=50`), 'search');
  assert.ok(r.total >= 1);
  assert.ok(r.students.every((s) => `${s.name} ${s.email}`.toLowerCase().includes(name.toLowerCase())));
});

/* ============================================================
   Teardown behaviour
   ============================================================ */

test('deleting a drive removes its outcomes so placement figures cannot drift', async () => {
  const beforeReport = await GET('/api/college/placement');
  const beforeOutcomes = await GET(`/api/college/drives/${createdDriveId}/outcomes`);
  assert.ok(beforeOutcomes.outcomes.length > 0, 'the drive still has outcomes to orphan');

  ok(await DEL(`/api/college/drives/${createdDriveId}`), 'delete drive');

  const afterOutcomes = await GET(`/api/college/drives/${createdDriveId}/outcomes`);
  assert.equal(afterOutcomes.outcomes.length, 0, 'outcomes went with the drive');

  const afterReport = await GET('/api/college/placement');
  assert.ok(
    afterReport.summary.offers <= beforeReport.summary.offers,
    'removing a drive can only reduce recorded offers, never strand them'
  );
});
