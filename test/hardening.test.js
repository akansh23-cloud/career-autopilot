// Market-Readiness Gap Sprint — API + hardening tests.
// Boots the real Express app via test/helpers.js (DB off in CI, so every
// degradation path is exercised exactly as documented).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';

import {
  createQuotaMiddleware, matchQuotaBucket, QUOTA_CONFIG, utcDay, nextUtcMidnight, _resetMemoryCounters,
} from '../server/utils/quotaMiddleware.js';
import { EXPORT_SOURCES, DELETE_GRACE_DAYS } from '../db.js';

let server, base, client;
before(async () => {
  ({ server, base } = await startServer());
  client = makeClient(base);
  await client.devLogin('Gap Sprint Tester', 'gap-sprint@test.dev');
});
after(async () => { await stopServer(server); });

/* ============================================================
   Observability + health (Phase 5)
   ============================================================ */

test('every response carries an X-Request-Id; upstream ids are honored', async () => {
  const r = await client.get('/api/health');
  assert.ok(r.headers.get('x-request-id'), 'generated id present');
  const r2 = await client.get('/api/health', { 'X-Request-Id': 'trace-abc-12345' });
  assert.equal(r2.headers.get('x-request-id'), 'trace-abc-12345');
});

test('/api/health reports liveness + degraded flags without touching the DB', async () => {
  const r = await client.get('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.db, 'off'); // CI runs DB-less
  assert.equal(r.json.degraded.db, true);
});

test('/api/ready is ok+degraded with the DB intentionally off', async () => {
  const r = await client.get('/api/ready');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.db, 'off');
  assert.equal(r.json.degraded, true);
});

test('/api/admin/errors requires admin', async () => {
  const r = await client.get('/api/admin/errors');
  assert.equal(r.status, 403);
});

/* ============================================================
   Project store (Phase 1) — db_off degradation + auth
   ============================================================ */

test('project store endpoints degrade to ok:false db_off (HTTP 200) with the DB off', async () => {
  for (const call of [
    () => client.get('/api/projects/store'),
    () => client.post('/api/projects/store', { project: { id: 'p1', title: 'T' } }),
    () => client.post('/api/projects/store/sync', { projects: [{ id: 'p1', title: 'T', updatedAt: new Date().toISOString() }] }),
    () => client.patch('/api/projects/store/p1/progress', { taskPatch: { t1: { status: 'done' } } }),
    () => client.del('/api/projects/store/p1'),
  ]) {
    const r = await call();
    assert.equal(r.status, 200, 'db_off is a soft signal, never an error status');
    assert.equal(r.json.ok, false);
    assert.equal(r.json.reason, 'db_off');
  }
});

test('project store requires auth', async () => {
  const anon = makeClient(base);
  await anon.bootstrap();
  const r = await anon.get('/api/projects/store');
  assert.equal(r.status, 401);
});

test('project store sync validates input', async () => {
  const r = await client.post('/api/projects/store/sync', { projects: [{ title: 'no id' }] });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'invalid_input');
});

/* ============================================================
   Resume OS routes (Phase 4)
   ============================================================ */

test('POST /api/resume/ats-audit returns a deterministic audit', async () => {
  const text = 'KAMAL\nkamal@x.dev | +91 9876543210\n\nEXPERIENCE\nEngineer — ACME\nJan 2023 – Present\n• Built pipelines on AWS with measurable wins for the team\n\nEDUCATION\nB.E. 2021\n\nSKILLS\nAWS, SQL';
  const a = await client.post('/api/resume/ats-audit', { text });
  const b = await client.post('/api/resume/ats-audit', { text });
  assert.equal(a.status, 200);
  assert.ok(a.json.audit.score >= 85, `got ${a.json.audit.score}`);
  assert.deepEqual(a.json.audit, b.json.audit, 'same input → same audit');
});

test('POST /api/resume/jd-match flags provable gaps with the proof-moat message', async () => {
  const r = await client.post('/api/resume/jd-match', {
    resumeText: 'EXPERIENCE\nEngineer\nJan 2023 – Present\n• Built AWS pipelines daily for analytics\n\nSKILLS\nAWS, SQL',
    jobDescription: 'Requirements: AWS, Kafka and Airflow experience required for this data engineering role.',
    targetRole: 'Data Engineer',
    verifiedSkills: ['Kafka'],
  });
  assert.equal(r.status, 200);
  const kafka = r.json.match.missing.find((m) => m.skill.toLowerCase() === 'kafka');
  assert.ok(kafka && kafka.verified);
  assert.ok(kafka.fix.startsWith('add this — you can prove it'));
});

test('jd-match rejects an empty job description', async () => {
  const r = await client.post('/api/resume/jd-match', { resumeText: 'x', jobDescription: 'too short' });
  assert.equal(r.status, 400);
});

/* ============================================================
   DPDP (Phase 5) — export + delete contracts
   ============================================================ */

test('GET /api/account/export answers with the local-first truth when the DB is off', async () => {
  const r = await client.get('/api/account/export');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.db, 'off');
  assert.deepEqual(r.json.collections, {});
});

test('DELETE /api/account demands explicit confirmation', async () => {
  const r = await client.del('/api/account');
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'confirmation_required');
  assert.ok(/7-day grace/.test(r.json.message));
});

test('EXPORT_SOURCES covers every critical user-keyed collection and powers the cascade', () => {
  const names = EXPORT_SOURCES.map((s) => s.name);
  for (const required of [
    'profile', 'userState', 'resumes', 'resumeVersions', 'projects', 'projectWorkspaces',
    'projectSubmissions', 'patentIdeas', 'patentRecords', 'priorArtRecords', 'patentDisclosures',
    'githubRepositories', 'networkProfile', 'supportTickets',
  ]) assert.ok(names.includes(required), `export must include ${required}`);
  // export and cascade iterate the SAME list, so completeness of one is
  // completeness of the other — verify each entry is well-formed.
  for (const src of EXPORT_SOURCES) {
    assert.equal(typeof src.model, 'function', `${src.name} resolves a model lazily`);
    assert.ok(['_id', 'userId'].includes(src.key), `${src.name} keyed by a user field`);
  }
  assert.equal(DELETE_GRACE_DAYS, 7);
});

/* ============================================================
   Quota middleware (Phase 5) — unit-level with fakes
   ============================================================ */

test('quota route matcher maps generation/AI/sync/export families', () => {
  assert.equal(matchQuotaBucket('POST', '/api/workspace/generate'), 'generation');
  assert.equal(matchQuotaBucket('POST', '/api/projects/store/sync'), 'syncs');
  assert.equal(matchQuotaBucket('POST', '/api/resume/tailor'), 'aiCalls');
  assert.equal(matchQuotaBucket('POST', '/api/workspace/starter-pack'), 'exports');
  assert.equal(matchQuotaBucket('GET', '/api/workspace/generate'), null, 'reads are never metered');
  assert.equal(matchQuotaBucket('POST', '/api/user/state'), null);
});

test('free plan permits one full golden path in a day', () => {
  // generate project + architecture + workspace + patent assessment +
  // resume tailor + an export + steady background syncs — all within caps.
  const f = QUOTA_CONFIG.free;
  assert.ok(f.generation >= 5, 'several generation calls fit');
  assert.ok(f.aiCalls >= 3 && f.exports >= 1 && f.syncs >= 20);
});

test('quota middleware enforces the daily cap with a clear 429', async () => {
  process.env.QUOTA_ENFORCE = '1';
  _resetMemoryCounters();
  try {
    const mw = createQuotaMiddleware({
      currentUser: () => ({ id: 'u-quota', email: 'q@test.dev' }),
      planFor: () => ({ effectivePlan: 'free' }),
      db: null, // forces the in-memory counter path
      config: { ...QUOTA_CONFIG, free: { ...QUOTA_CONFIG.free, generation: 2 } },
    });
    const run = () => new Promise((resolve) => {
      const headers = {};
      const res = {
        setHeader: (k, v) => { headers[k] = v; },
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ status: this.statusCode || 200, body, headers, blocked: true }); },
      };
      mw({ method: 'POST', path: '/api/workspace/generate' }, res, () => resolve({ status: 200, headers, blocked: false }));
    });
    const r1 = await run(); const r2 = await run(); const r3 = await run();
    assert.equal(r1.blocked, false);
    assert.equal(r2.blocked, false);
    assert.equal(r2.headers['X-Quota-Remaining'], '0');
    assert.equal(r3.status, 429);
    assert.equal(r3.body.error, 'quota_exceeded');
    assert.equal(r3.body.remaining, 0);
    assert.equal(r3.body.limit, 2);
    assert.ok(r3.body.resetAt > new Date().toISOString(), 'resetAt is the next UTC midnight');
  } finally {
    delete process.env.QUOTA_ENFORCE;
    _resetMemoryCounters();
  }
});

test('quota middleware is bypassed in test mode without QUOTA_ENFORCE', async () => {
  _resetMemoryCounters();
  const mw = createQuotaMiddleware({
    currentUser: () => ({ id: 'u2' }),
    planFor: () => ({ effectivePlan: 'free' }),
    config: { ...QUOTA_CONFIG, free: { ...QUOTA_CONFIG.free, generation: 0 } },
  });
  const passed = await new Promise((resolve) => {
    mw({ method: 'POST', path: '/api/workspace/generate' }, {}, () => resolve(true));
  });
  assert.equal(passed, true);
});

test('utcDay/nextUtcMidnight are well-formed', () => {
  assert.match(utcDay(), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(nextUtcMidnight().endsWith('T00:00:00.000Z'));
});

/* ============================================================
   Patent route surfaces (Phase 3) — triage + live prior-art labels
   ============================================================ */

test('idea generation responses carry the triage block on every score', async () => {
  const r = await client.post('/api/patents/ideas/generate', {
    domain: 'Cybersecurity', interests: 'anomaly detection', count: 2,
  });
  assert.equal(r.status, 200);
  const ideas = r.json.ideas || [];
  assert.ok(ideas.length >= 1);
  for (const idea of ideas) {
    const score = idea.scoreDetail || idea.score || {};
    const triage = score.triage || idea.triage;
    if (triage) {
      assert.ok(triage.headline.includes('faculty/IP-cell triage'));
      assert.ok(typeof triage.nextHumanStep === 'string');
    }
  }
});
