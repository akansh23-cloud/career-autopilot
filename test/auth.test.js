import './_googleEnv.js'; // MUST be first: sets GOOGLE_* before server.js loads
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';

let server;
let base;

before(async () => { ({ server, base } = await startServer()); });
after(async () => { await stopServer(server); });

/* /auth/me must never crash for an anonymous visitor — this is exactly what
   broke on Vercel (session store hit Mongo before connect → 500). */
test('/auth/me returns 200 and authenticated:false when no user is signed in', async () => {
  const c = makeClient(base);
  const r = await c.get('/auth/me');
  assert.equal(r.status, 200);
  assert.equal(r.json.authenticated, false);
  assert.equal(r.json.user, null);
  assert.ok(r.json.providers, 'providers must always be present');
});

/* With Google OAuth env configured, the client must see google.enabled=true
   (so the UI does NOT show "Google OAuth isn't configured"). */
test('/auth/me reports providers.google.enabled=true when Google env is set', async () => {
  const c = makeClient(base);
  const r = await c.get('/auth/me');
  assert.equal(r.status, 200);
  assert.equal(r.json.providers.google.enabled, true);
});

/* /health exposes DB + session-store + google status for deployment debugging. */
test('/health reports db, sessionStore and google status', async () => {
  const c = makeClient(base);
  const r = await c.get('/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(['configured', 'off'].includes(r.json.db));
  assert.ok(['mongodb', 'memory'].includes(r.json.sessionStore));
  assert.equal(typeof r.json.google, 'boolean');
});

/* /health/db is a safe probe. With no MONGODB_URI (test env) it reports db:off
   and 200 — and when a DB is configured but unreachable it returns 503 (covered
   by the session-store unit test, which simulates the failure deterministically). */
test('/health/db reports db:off (200) when no MONGODB_URI is configured', async () => {
  const c = makeClient(base);
  const r = await c.get('/health/db');
  assert.equal(r.status, 200);
  assert.equal(r.json.db, 'off');
});
