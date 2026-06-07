import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';

let server;
let base;

before(async () => {
  ({ server, base } = await startServer());
});
after(async () => {
  await stopServer(server);
});

/* ---------- Public / health ---------- */
test('health endpoint is public and returns ok', async () => {
  const c = makeClient(base);
  const r = await c.get('/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test('root serves the SPA html', async () => {
  const c = makeClient(base);
  const r = await c.get('/');
  assert.equal(r.status, 200);
  assert.match(r.text, /<!doctype html>/i);
});

/* ---------- Auth gate: unauthorized access ---------- */
test('protected job search rejects unauthenticated requests with 401', async () => {
  const c = makeClient(base);
  const r = await c.get('/jobs/search?role=developer');
  assert.equal(r.status, 401);
  assert.equal(r.json.error, 'auth_required');
});

test('protected user-state read rejects unauthenticated requests with 401', async () => {
  const c = makeClient(base);
  const r = await c.get('/api/user/state');
  assert.equal(r.status, 401);
});

test('unknown API route returns JSON 404 (not the SPA html)', async () => {
  const c = makeClient(base);
  const r = await c.get('/api/does-not-exist');
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'not_found');
});

/* ---------- Dev login + session ---------- */
test('dev login establishes a session and /auth/me reflects it', async () => {
  const c = makeClient(base);
  const login = await c.devLogin('Alice', 'alice@example.com');
  assert.equal(login.status, 200);
  assert.equal(login.json.ok, true);
  const me = await c.get('/auth/me');
  assert.equal(me.json.authenticated, true);
  assert.equal(me.json.user.email, 'alice@example.com');
});

/* ---------- CSRF protection ---------- */
test('authenticated mutation without CSRF token is rejected with 403', async () => {
  const c = makeClient(base);
  await c.devLogin('Carol', 'carol@example.com');
  // Bypass the client's automatic CSRF echo by calling fetch directly with the
  // session cookie but NO X-CSRF-Token header.
  const cookie = [...c.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(base + '/api/user/state', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ profile: { role: 'student' } }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'csrf_failed');
});

test('authenticated mutation with CSRF token passes the CSRF gate', async () => {
  const c = makeClient(base);
  await c.devLogin('Dave', 'dave@example.com');
  const r = await c.patch('/api/user/state', { profile: { role: 'student' } });
  // DB is off in tests → dev behavior is 200 with db:false (never a 503 in dev).
  assert.equal(r.status, 200);
  assert.equal(r.json.db, false);
});

/* ---------- Input validation ---------- */
test('malformed support ticket payload is rejected with 400', async () => {
  const c = makeClient(base);
  await c.bootstrap();
  const r = await c.post('/support/tickets', { email: 'not-an-email', subject: '', message: '' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'invalid_request');
});

test('valid support ticket is accepted', async () => {
  const c = makeClient(base);
  await c.bootstrap();
  const r = await c.post('/support/tickets', {
    email: 'user@example.com',
    subject: 'Cannot log in',
    message: 'I keep getting redirected to the landing page.',
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test('empty support chat message is rejected with 400', async () => {
  const c = makeClient(base);
  await c.bootstrap();
  const r = await c.post('/support/chat', { message: '' });
  assert.equal(r.status, 400);
});

test('oversized user-state patch with unknown keys is rejected', async () => {
  const c = makeClient(base);
  await c.devLogin('Eve', 'eve@example.com');
  const r = await c.patch('/api/user/state', { profile: {}, evilUnknownKey: 'x' });
  assert.equal(r.status, 400); // .strict() schema rejects unexpected keys
});

/* ---------- User data isolation ---------- */
test('two users have isolated sessions (/auth/me never mixes identities)', async () => {
  const a = makeClient(base);
  const b = makeClient(base);
  await a.devLogin('UserA', 'a@iso.com');
  await b.devLogin('UserB', 'b@iso.com');
  const meA = await a.get('/auth/me');
  const meB = await b.get('/auth/me');
  assert.equal(meA.json.user.email, 'a@iso.com');
  assert.equal(meB.json.user.email, 'b@iso.com');
  assert.notEqual(meA.json.user.id, meB.json.user.id);
});

test('logout clears the session', async () => {
  const c = makeClient(base);
  await c.devLogin('Frank', 'frank@example.com');
  const out = await c.post('/auth/logout', {});
  assert.equal(out.status, 200);
  const me = await c.get('/auth/me');
  assert.equal(me.json.authenticated, false);
});

/* ---------- Job freshness filter behavior ---------- */
test('job search respects the freshness window and returns structured shape', async () => {
  const c = makeClient(base);
  await c.devLogin('Grace', 'grace@example.com');
  // verify=0 keeps it fast; no provider keys in test → expect 0 jobs but a valid shape.
  const r = await c.get('/jobs/search?role=developer&freshness=3d&limit=5&verify=0');
  assert.equal(r.status, 200);
  assert.equal(r.json.freshnessDays, 3);
  assert.ok(Array.isArray(r.json.jobs));
  // Every returned job (if any) must be within the freshness window.
  for (const j of r.json.jobs) {
    if (typeof j.postedDays === 'number') assert.ok(j.postedDays <= 3);
  }
});

/* ---------- Concurrency / load ---------- */
test('handles 100 concurrent lightweight requests with no failures', async () => {
  const c = makeClient(base);
  await c.devLogin('Heidi', 'heidi@example.com');
  const results = await Promise.all(
    Array.from({ length: 100 }, () => c.get('/auth/me')),
  );
  assert.equal(results.length, 100);
  assert.ok(results.every((r) => r.status === 200 && r.json.authenticated === true));
});
