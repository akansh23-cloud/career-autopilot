import { test } from 'node:test';
import assert from 'node:assert/strict';
import session from 'express-session';
import { createMongooseSessionStore } from '../sessionStore.js';

/* Simulates a Mongo connection failure (the Vercel root cause) WITHOUT a real
   database. Proves the store:
   - awaits the injected connect() before any query (serverless-safe ordering),
   - never hangs — every method calls back with the error,
   so /auth/me can surface a clean 503/safe error instead of hanging or 500ing. */

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms)),
  ]);
}

test('store methods call back with an error (and do not hang) when connect() fails', async () => {
  let connectCalls = 0;
  const connect = async () => { connectCalls += 1; throw new Error('Mongo unreachable (simulated)'); };
  const store = createMongooseSessionStore(session, { connect });

  const callbackErr = (fn) => withTimeout(new Promise((resolve) => fn((err) => resolve(err))), 2000, fn.name || 'op');

  const getErr = await callbackErr((cb) => store.get('sid-1', cb));
  assert.ok(getErr instanceof Error, 'get must call back with the connect error');

  const setErr = await callbackErr((cb) => store.set('sid-1', { cookie: { maxAge: 1000 } }, cb));
  assert.ok(setErr instanceof Error, 'set must call back with the connect error');

  const touchErr = await callbackErr((cb) => store.touch('sid-1', { cookie: { maxAge: 1000 } }, cb));
  assert.ok(touchErr instanceof Error, 'touch must call back with the connect error');

  const destroyErr = await callbackErr((cb) => store.destroy('sid-1', cb));
  assert.ok(destroyErr instanceof Error, 'destroy must call back with the connect error');

  // connect() was awaited before any query work (serverless-safe ordering).
  assert.ok(connectCalls >= 4, `connect() must run before each op (saw ${connectCalls})`);
});
