/* ============================================================
   ROUTE WIRING TESTS — real postings flowing end to end.
   ------------------------------------------------------------
   The live matrix tests prove the route's HONESTY when no
   provider is configured. These prove the opposite half: that
   when sources DO return postings, the route surfaces them —
   including the thin-result case that used to come back empty.

   Sources are stubbed (the engine's fetch layer is injected, by
   design), so this exercises the real registerJobSearchRoute,
   the real progressiveGate and the real ranking/verification
   path without any network.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerJobSearchRoute } from '../server/routes/jobSearchRoute.js';

const posting = (o = {}) => ({
  title: 'DevOps Engineer', company: 'Acme Corp', location: 'Pune, India',
  mode: 'Remote', source: 'Remotive', postedDate: '2026-08-05', postedDays: 2,
  url: `https://example.com/job/${Math.random().toString(36).slice(2)}`,
  summary: 'Kubernetes, Terraform, AWS', requiredSkills: ['kubernetes', 'aws'], ...o,
});

/* Minimal, faithful stand-ins for the helpers server.js injects. */
function makeApp(jobs, { failAll = false } = {}) {
  const app = express();
  registerJobSearchRoute(app, {
    SOURCES: [{
      name: 'Remotive',
      fetch: async () => { if (failAll) throw new Error('ECONNREFUSED'); return jobs; },
    }],
    configuredSources: () => [{ source: 'Remotive', active: true, integration: 'direct/public API', reason: '' }],
    sourceKey: (x) => String(x).toLowerCase().replace(/\s+/g, ''),
    sourceAllowed: () => true,
    requestedSources: () => null,
    inferSource: (j, fb) => j.source || fb,
    sourceFromUrl: () => 'Remotive',
    balancedBySource: (arr, limit) => arr.slice(0, limit),
    jobKey: (j) => j.url,
    verifyMany: async (arr) => arr.map((j) => ({ ...j, verified: true, verifyLevel: 'live' })),
    withBudget: async (p) => p,
    jobCacheGet: () => null,
    jobCacheSet: () => {},
    maxFreshDaysFromQuery: (f) => ({ '24h': 1, '1d': 1, '3d': 3, '7d': 7, '30d': 30, latest: Infinity }[f] ?? 30),
    passesFreshness: (days, fresh) => {
      const max = { '24h': 1, '1d': 1, '3d': 3, '7d': 7, '30d': 30, latest: Infinity }[fresh] ?? 30;
      if (days == null) return { ok: false, reason: 'no posting date' };
      return days <= max ? { ok: true } : { ok: false, reason: 'outside freshness window' };
    },
    validRoleMatch: (j, role) => !role || String(j.title).toLowerCase().includes(String(role).toLowerCase()),
    validLocationMatch: (j, loc) => !loc || String(j.location).toLowerCase().includes(String(loc).toLowerCase()),
    jsearchCountry: () => 'in',
    logger: { error: () => {}, warn: () => {}, info: () => {} },
  });
  return app;
}

async function call(app, qs) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/jobs/search?verify=1&${qs}`);
    return { status: res.status, json: await res.json() };
  } finally { server.close(); }
}

test('real postings are returned end to end through the live route', async () => {
  const app = makeApp([posting(), posting(), posting({ title: 'Senior DevOps Engineer' })]);
  const r = await call(app, 'role=DevOps%20Engineer&location=Pune&freshness=7d');
  assert.equal(r.status, 200);
  assert.equal(r.json.jobs.length, 3, 'all three real postings must surface');
  assert.equal(r.json.search.fallbackLevel, 0, 'exact match, no relaxation needed');
  assert.equal(r.json.diagnostics.errorCode, null, 'a successful search must raise no error');
  for (const j of r.json.jobs) assert.match(j.url, /^https:\/\//);
});

test('THE REGRESSION: fewer results than minResults still returns the real jobs', async () => {
  // 3 real postings, caller wants 8. Before the engine fix this returned [].
  const app = makeApp([posting(), posting(), posting()]);
  const r = await call(app, 'role=DevOps%20Engineer&location=Pune&freshness=7d&minResults=8');
  assert.equal(r.status, 200);
  assert.equal(r.json.jobs.length, 3, 'must return the 3 real postings, not "No jobs found"');
  assert.equal(r.json.search.thinResults, true, 'must be flagged as thin, not empty');
  assert.equal(r.json.search.requestedMinResults, 8);
});

test('a too-tight freshness window falls back and NAMES the relaxation', async () => {
  // Nothing inside 24h; a real 20-day-old posting exists.
  const app = makeApp([posting({ postedDays: 20, postedDate: '2026-07-19' })]);
  const r = await call(app, 'role=DevOps%20Engineer&location=Pune&freshness=24h&filterMode=strict');
  assert.equal(r.json.jobs.length, 1, 'the real posting must be shown via fallback');
  assert.equal(r.json.search.usedFallback, true);
  const names = r.json.search.relaxedFilters.map((x) => x.filter);
  assert.ok(names.includes('freshness'), 'the user must be told the date filter was widened');
  assert.match(r.json.search.relaxedFilters.find((x) => x.filter === 'freshness').label, /widened/i);
});

test('a location with no matches relaxes location and says so', async () => {
  const app = makeApp([posting({ location: 'Berlin, Germany' })]);
  const r = await call(app, 'role=DevOps%20Engineer&location=Pune&freshness=30d');
  assert.equal(r.json.jobs.length, 1);
  assert.ok(r.json.search.relaxedFilters.some((x) => x.filter === 'location'),
    'dropping the location filter must be disclosed');
});

test('a genuinely unmatchable search returns zero and never fabricates', async () => {
  const app = makeApp([posting({ title: 'Pastry Chef', summary: 'baking', requiredSkills: [] })]);
  const r = await call(app, 'role=DevOps%20Engineer&location=Pune&freshness=7d');
  assert.equal(r.json.jobs.length, 0, 'no fabricated filler');
  assert.ok(r.json.search.explanation.length > 0, 'zero must still be explained');
});

test('all sources failing is reported as an outage, not as "no jobs"', async () => {
  const app = makeApp([], { failAll: true });
  const r = await call(app, 'role=DevOps%20Engineer&location=Pune');
  assert.equal(r.json.jobs.length, 0);
  assert.equal(r.json.diagnostics.errorCode, 'ALL_SOURCES_FAILED');
  assert.match(r.json.diagnostics.errorMessage, /network or upstream outage/i);
  assert.ok(r.json.diagnostics.sourcesFailed.length > 0, 'the failing sources must be named');
});

test('a successful search IS cached; an empty one is not', async () => {
  const writes = [];
  const app = express();
  registerJobSearchRoute(app, {
    SOURCES: [{ name: 'Remotive', fetch: async () => [] }],
    configuredSources: () => [{ source: 'Remotive', active: true, integration: 'direct', reason: '' }],
    sourceKey: (x) => String(x).toLowerCase(), sourceAllowed: () => true, requestedSources: () => null,
    inferSource: (j, fb) => j.source || fb, sourceFromUrl: () => 'Remotive',
    balancedBySource: (a, l) => a.slice(0, l), jobKey: (j) => j.url,
    verifyMany: async (a) => a.map((j) => ({ ...j, verified: true })),
    withBudget: async (p) => p, jobCacheGet: () => null,
    jobCacheSet: (k) => writes.push(k),
    maxFreshDaysFromQuery: () => 30, passesFreshness: () => ({ ok: true }),
    validRoleMatch: () => true, validLocationMatch: () => true,
    jsearchCountry: () => 'in', logger: { error: () => {} },
  });
  await call(app, 'role=DevOps%20Engineer&location=Pune');
  assert.equal(writes.length, 0, 'an empty result must never be written to the cache');
});

test('/jobs/filters publishes the canonical vocabulary the UI must use', async () => {
  const app = makeApp([]);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/jobs/filters`);
  const json = await res.json();
  server.close();
  assert.ok(json.workModes.length && json.experienceLevels.length && json.jobTypes.length);
  assert.deepEqual(json.freshness, ['24h', '3d', '7d', '30d', 'latest']);
  assert.equal(json.fallbackSteps.length, 5, 'all five ladder steps must be published');
});

test('a WORKING India search does not raise a coverage error over real results', async () => {
  // Regression: NO_REGIONAL_SOURCE was raised on location match alone, so a
  // successful Pune search showed an error banner above its own results.
  const app = makeApp([posting(), posting()]);
  const r = await call(app, 'role=DevOps%20Engineer&location=Pune&freshness=7d');
  assert.ok(r.json.jobs.length > 0, 'precondition: this search must succeed');
  assert.equal(r.json.diagnostics.errorCode, null,
    'a search that returned real jobs must not report a source problem');
});

test('an EMPTY India search still raises the coverage error', async () => {
  const app = makeApp([posting({ title: 'Pastry Chef', summary: '', requiredSkills: [] })]);
  const r = await call(app, 'role=DevOps%20Engineer&location=Pune&freshness=7d');
  assert.equal(r.json.jobs.length, 0);
  assert.equal(r.json.diagnostics.errorCode, 'NO_REGIONAL_SOURCE');
});
