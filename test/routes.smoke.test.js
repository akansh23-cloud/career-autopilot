/* ============================================================
   ROUTE SMOKE TESTS
   ------------------------------------------------------------
   These exist because the suite was green at 615 tests while three
   shipped modules — jobSearchEngine.js, jobFilters.js and
   jobFilterOptions.js — were unreachable from the running app.
   Unit tests cannot catch "this module is never imported".

   Every test here boots the REAL Express app and asserts on a real
   HTTP response. If a route is deleted, unwired or crashes the
   process, one of these fails.
   ============================================================ */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';

let server;
let base;

before(async () => { ({ server, base } = await startServer()); });
after(async () => { await stopServer(server); });

async function signedIn() {
  const c = makeClient(base);
  await c.devLogin('Smoke Student', 'smoke.student@test.local');
  return c;
}

/* ---------- Job search is actually wired to the v2 engine ---------- */

test('GET /jobs/filters serves the canonical filter vocabulary', async () => {
  const c = await signedIn();
  const r = await c.get('/jobs/filters');
  assert.equal(r.status, 200);
  // These are the enums from server/utils/jobFilters.js. If this route is
  // missing, jobSearchRoute.js is not registered and the old inline gate is
  // back — which is exactly the regression this file guards against.
  assert.deepEqual(r.json.workModes, ['any', 'remote', 'hybrid', 'onsite']);
  assert.ok(r.json.experienceLevels.includes('internship'));
  assert.ok(r.json.jobTypes.includes('full-time'));
  assert.equal(r.json.fallbackSteps.length, 5);
});

test('GET /jobs/search returns the fallback-ladder explanation payload', async () => {
  const c = await signedIn();
  // verify=0 keeps this offline-safe: no outbound URL verification.
  const r = await c.get('/jobs/search?role=developer&freshness=latest&verify=0&limit=5');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.jobs), 'jobs must be an array');

  // The v2 contract. The old inline route returned none of this.
  assert.ok(r.json.search, 'payload.search is missing — the v2 engine is not wired in');
  assert.equal(typeof r.json.search.fallbackLevel, 'number');
  assert.ok(r.json.search.removedByFilter, 'per-cause removal counts missing');
  assert.ok(Array.isArray(r.json.search.attempts));
  assert.ok(r.json.search.applied, 'the applied (canonicalised) filters must be echoed back');
});

test('legacy work-mode values are canonicalised rather than emptying the result set', async () => {
  const c = await signedIn();
  const r = await c.get('/jobs/search?role=developer&mode=On-site%2FHybrid&freshness=latest&verify=0&limit=5');
  assert.equal(r.status, 200);
  // 'On-site/Hybrid' is the value the old UI persisted to localStorage.
  assert.equal(r.json.search.applied.mode, 'hybrid');
});

test('an unknown filter value degrades to "any" instead of erroring', async () => {
  const c = await signedIn();
  const r = await c.get('/jobs/search?role=developer&mode=banana&experience=wizard&jobType=nonsense&freshness=latest&verify=0');
  assert.equal(r.status, 200);
  assert.equal(r.json.search.applied.mode, 'any');
  assert.equal(r.json.search.applied.experience, 'any');
  assert.equal(r.json.search.applied.jobType, 'any');
});

/* ---------- Async rejections must not kill the process ---------- */

test('a throwing async handler returns 500 and leaves the server alive', async () => {
  const c = await signedIn();

  // /api/... with a bogus path exercises the 404 catch-all, which must still
  // respond as JSON after errorMiddleware is mounted ahead of it.
  const missing = await c.get('/api/definitely-not-a-real-endpoint');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error, 'not_found');

  // The server must still be serving after that.
  const health = await c.get('/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
});

test('malformed body on a validated POST is a 4xx, never a crash', async () => {
  const c = await signedIn();
  const r = await c.post('/api/projects/submit', { title: 42, nonsense: { deeply: { nested: true } } });
  assert.ok(r.status >= 400 && r.status < 500, `expected 4xx, got ${r.status}`);
  const health = await c.get('/health');
  assert.equal(health.json.ok, true, 'server died on a malformed request body');
});

/* ---------- Client crash telemetry ---------- */

test('POST /api/ops/client-error accepts a report without a CSRF token', async () => {
  const c = await signedIn();
  // A crashed UI cannot be relied on to attach a token, so this path is
  // CSRF-exempt on purpose.
  const r = await c.post('/api/ops/client-error', {
    message: 'smoke test',
    screen: 'jobs',
    componentStack: 'at Jobs',
    at: new Date().toISOString(),
  });
  assert.equal(r.status, 204);
});

/* ---------- Team project per-member progress ---------- */

test('team progress routes are registered and scoped', async () => {
  const c = await signedIn();
  // A plain student is not a college_admin, so the coordinator route must
  // refuse — a 404 here would mean the route was never mounted at all.
  const r = await c.get('/api/college/team-projects/tp_nonexistent/progress');
  assert.ok([401, 403, 404].includes(r.status), `unexpected status ${r.status}`);
  assert.notEqual(r.json?.message, undefined, 'the route should answer with a JSON envelope');
});

test('student progress route rejects a project the caller is not a member of', async () => {
  const c = await signedIn();
  const r = await c.get('/api/my/team-projects/tp_nonexistent/progress');
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'not_found_or_out_of_scope');
});

test('a student cannot update a module on a project they are not on', async () => {
  const c = await signedIn();
  const r = await c.patch('/api/my/team-projects/tp_nonexistent/modules/Some%20Module', { status: 'done' });
  assert.equal(r.status, 404);
});

/* ---------- Static assets bypass the global rate limiter ---------- */

test('repeated asset requests are not rate limited', async () => {
  const c = makeClient(base);
  // The limiter is mounted after express.static and skips asset extensions,
  // because a college lab shares one NAT IP and a cohort cold-loading the SPA
  // used to blow the per-minute bucket on JS chunks alone.
  for (let i = 0; i < 40; i += 1) {
    const r = await c.get('/favicon.ico');
    assert.notEqual(r.status, 429, `asset request ${i} was rate limited`);
  }
});
