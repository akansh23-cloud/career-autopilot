/* ============================================================
   LIVE ROUTE TESTS — the exact search matrix that was requested.
   Runs against a real server instance via the shared harness.
   No provider keys are configured in the test env, which is
   itself the important case: the response must EXPLAIN that,
   never present it as "no jobs found".
   ============================================================ */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';

let server, base, c;

before(async () => {
  ({ server, base } = await startServer());
  c = makeClient(base);
  await c.devLogin('Kamal', 'kamal@example.com');
});
after(async () => { await stopServer(server); });

const search = (qs) => c.get(`/jobs/search?verify=0&limit=12&${qs}`);

/* ---------------- provider configuration surface ---------------- */

test('/jobs/sources reports what is actually configured at runtime', async () => {
  const r = await c.get('/jobs/sources');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.sources));
  assert.equal(r.json.aiJobGeneration, false, 'jobs must never be AI-generated');
  // Boards that need a search provider must be reported inactive with a reason.
  const linkedin = r.json.sources.find((s) => s.source === 'LinkedIn');
  assert.ok(linkedin, 'LinkedIn must be listed');
  assert.equal(linkedin.active, false, 'no RAPIDAPI/SERPAPI key in test env');
  assert.ok(linkedin.reason.length > 0, 'inactive sources must carry a reason');
});

test('/jobs/diagnostics reports provider health without leaking the key', async () => {
  const r = await c.get('/jobs/diagnostics?role=DevOps%20Engineer&location=India');
  assert.equal(r.status, 200);
  assert.equal(r.json.env.rapidapiConfigured, false);
  const jsearch = r.json.checks.find((x) => /JSearch/.test(x.provider));
  assert.ok(jsearch, 'JSearch health must be reported');
  assert.match(jsearch.message, /RAPIDAPI_KEY missing/);
  assert.ok(!JSON.stringify(r.json).includes('X-RapidAPI-Key'), 'must not leak header/key material');
});

/* ---------------- the requested search matrix ---------------- */

const MATRIX = [
  ['DevOps Engineer, location blank', 'role=DevOps%20Engineer&location='],
  ['DevOps Engineer, India',          'role=DevOps%20Engineer&location=India'],
  ['DevOps Engineer, Pune',           'role=DevOps%20Engineer&location=Pune'],
  ['Cloud Engineer, India',           'role=Cloud%20Engineer&location=India'],
];

for (const [label, qs] of MATRIX) {
  test(`search: ${label} — returns a valid, honest payload`, async () => {
    const r = await search(qs);
    assert.equal(r.status, 200, 'search must not 500');
    assert.ok(Array.isArray(r.json.jobs), 'jobs must be an array');
    assert.ok(r.json.search, 'search metadata must be present');
    assert.ok(r.json.diagnostics, 'diagnostics must be present');

    // Every returned job must be a REAL posting with a real URL. Never fabricated.
    for (const j of r.json.jobs) {
      assert.ok(j.title && j.company, 'a job must have a title and company');
      assert.match(j.url, /^https?:\/\//, 'a job must carry a direct, real URL');
      assert.ok(j.source, 'a job must name its source');
    }

    // An empty result set must ALWAYS carry a reason.
    if (r.json.jobs.length === 0) {
      const why = r.json.diagnostics.errorMessage || r.json.search.explanation;
      assert.ok(why && why.length > 0, 'an empty result must explain itself, never be a bare blank');
    }
  });
}

test('India-capable provider missing is an explicit error, not silence', async () => {
  for (const loc of ['India', 'Pune']) {
    const r = await search(`role=DevOps%20Engineer&location=${loc}`);
    assert.equal(r.json.diagnostics.regionalProviderRequired, true, `${loc} must be detected as regional`);
    assert.equal(r.json.diagnostics.regionalProviderConfigured, false);
    assert.equal(r.json.diagnostics.errorCode, 'NO_REGIONAL_SOURCE',
      `${loc} with no India provider must raise NO_REGIONAL_SOURCE`);
    assert.match(r.json.diagnostics.errorMessage, /No India-capable job source is configured/);
    assert.match(r.json.diagnostics.errorMessage, /RAPIDAPI_KEY|ADZUNA|SERPAPI/, 'must say how to fix it');
  }
});

test('a blank location does NOT raise the regional error', async () => {
  const r = await search('role=DevOps%20Engineer&location=');
  assert.equal(r.json.diagnostics.regionalProviderRequired, false);
  assert.notEqual(r.json.diagnostics.errorCode, 'NO_REGIONAL_SOURCE');
});

test('diagnostics never leak the API key', async () => {
  const r = await search('role=DevOps%20Engineer&location=India');
  const blob = JSON.stringify(r.json);
  assert.ok(!/RAPIDAPI_KEY=|X-RapidAPI-Key/i.test(blob));
  assert.equal(typeof r.json.diagnostics.apiKeyDetected, 'boolean', 'only a boolean, never the value');
});

/* ---------------- every filter combination ---------------- */

const MODES = ['any', 'remote', 'hybrid'];
const FRESHNESS = ['24h', '3d', '7d', '30d', 'latest'];

for (const mode of MODES) {
  test(`work mode "${mode}" is accepted and echoed back`, async () => {
    const r = await search(`role=DevOps%20Engineer&location=&mode=${mode}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.search.applied.mode, mode);
  });
}

for (const fresh of FRESHNESS) {
  test(`freshness "${fresh}" is accepted and honoured`, async () => {
    const r = await search(`role=DevOps%20Engineer&location=&freshness=${fresh}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.search.applied.freshness, fresh);
    // At fallback level 0 the window must actually hold.
    const maxDays = { '24h': 1, '3d': 3, '7d': 7, '30d': 30, latest: Infinity }[fresh];
    if (r.json.search.fallbackLevel === 0) {
      for (const j of r.json.jobs) {
        if (typeof j.postedDays === 'number') {
          assert.ok(j.postedDays <= maxDays, `${j.title} is ${j.postedDays}d old, outside ${fresh}`);
        }
      }
    }
  });
}

test('legacy UI filter values are canonicalised instead of emptying the list', async () => {
  const r = await search('role=DevOps%20Engineer&location=&mode=On-site%2FHybrid&experience=Any&jobType=Any');
  assert.equal(r.status, 200);
  assert.equal(r.json.search.applied.mode, 'hybrid', 'legacy "On-site/Hybrid" must map to hybrid');
  assert.equal(r.json.search.applied.experience, 'any');
  assert.equal(r.json.search.applied.jobType, 'any');
});

test('an unknown filter value degrades to "any" rather than throwing', async () => {
  const r = await search('role=DevOps%20Engineer&location=&mode=teleport&experience=wizard&jobType=quest');
  assert.equal(r.status, 200);
  assert.equal(r.json.search.applied.mode, 'any');
});

/* ---------------- fallback reporting ---------------- */

test('fallback reporting names which filters were relaxed', async () => {
  const r = await search('role=DevOps%20Engineer&location=India&freshness=24h');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.search.relaxedFilters), 'relaxedFilters must always be an array');
  if (r.json.search.usedFallback) {
    assert.ok(r.json.search.relaxedFilters.length > 0,
      'if a fallback was used, the relaxed filters must be named');
    for (const rel of r.json.search.relaxedFilters) {
      assert.ok(rel.filter && rel.label, 'each relaxation must name a filter and a human label');
    }
  }
});

test('the ladder is reported attempt by attempt', async () => {
  const r = await search('role=DevOps%20Engineer&location=India');
  const attempts = r.json.search.attempts;
  assert.ok(Array.isArray(attempts) && attempts.length > 0, 'attempts must be reported');
  assert.equal(attempts[0].level, 0, 'the exact search must always be attempt 0');
  for (const a of attempts) assert.equal(typeof a.count, 'number');
});

test('thin-but-real results are flagged distinctly from empty', async () => {
  const r = await search('role=DevOps%20Engineer&location=&minResults=40');
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.search.thinResults, 'boolean');
  if (r.json.jobs.length > 0 && r.json.jobs.length < 40) {
    assert.equal(r.json.search.thinResults, true,
      'real-but-fewer-than-requested must be flagged, not reported as empty');
  }
});

/* ---------------- caching ---------------- */

test('an empty result set is never cached', async () => {
  const qs = 'role=ZzzNonexistentRole' + Date.now() + '&location=Atlantis';
  const first = await search(qs);
  const second = await search(qs);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  if (first.json.jobs.length === 0) {
    assert.notEqual(second.json.cached, true, 'an empty search must not be served from cache');
  }
});
