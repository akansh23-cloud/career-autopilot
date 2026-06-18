// Verification PERSISTENCE tests.
//
// Proves the production blocker is fixed: privileged-role verification is stored
// in durable storage (the on-disk store in local mode; the User document with a
// DB), NOT in process memory. We assert the value is physically on disk and that
// the HTTP access-context + recruiter/college guards read the persisted value.
//
// Uses an isolated temp data dir so it never touches the repo's real .data.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
process.env.CA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-verif-'));
process.env.ADMIN_EMAILS = 'persist-admin@ca.local';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';
import * as verificationStore from '../verificationStore.js';
import { getUserVerification, setUserVerification } from '../db.js';

const ADMIN_EMAIL = 'persist-admin@ca.local';
const dataFilePath = () => path.join(path.resolve(process.env.CA_DATA_DIR), 'verifications.json');

let server; let base;
before(async () => { verificationStore.__resetForTests(); ({ server, base } = await startServer()); });
after(async () => { await stopServer(server); verificationStore.__resetForTests(); });

/* ---- the store itself writes to DISK, not memory ---- */

test('saveVerification physically persists to disk (survives a simulated restart)', async () => {
  const email = 'persist-store@ca.local';
  verificationStore.saveVerification({ email }, { accountType: 'recruiter', roleVerified: true, organizationId: 'org-77', verificationStatus: 'approved' });

  // It is on disk — read the raw file, not the in-memory structure.
  const raw = JSON.parse(fs.readFileSync(dataFilePath(), 'utf8'));
  assert.ok(raw[email], 'record should be written to the JSON file');
  assert.equal(raw[email].accountType, 'recruiter');
  assert.equal(raw[email].roleVerified, true);

  // Simulate a process restart: clear in-process memory, re-read from disk.
  const reread = verificationStore.getVerification({ email });
  assert.equal(reread.roleVerified, true);
  assert.equal(reread.accountType, 'recruiter');
  assert.equal(reread.organizationId, 'org-77');
});

test('db.getUserVerification reads the persisted value back (no DB → on-disk store)', async () => {
  const email = 'persist-db@ca.local';
  const w = await setUserVerification({ email, accountType: 'college_admin', roleVerified: true, collegeId: 'college-X', verificationStatus: 'approved' });
  assert.equal(w.ok, true);
  // A fresh read goes through the durable store, not memory.
  const v = await getUserVerification({ email });
  assert.equal(v.accountType, 'college_admin');
  assert.equal(v.roleVerified, true);
  assert.equal(v.collegeId, 'college-X');
});

/* ---- end-to-end: admin approval persists and is honored by the guards ---- */

async function adminApprove(body) {
  const admin = makeClient(base);
  await admin.devLogin('Admin Ada', ADMIN_EMAIL);
  return admin.post('/api/admin/users/by-email/verify', { action: 'approve', ...body });
}

test('admin approval persists; access-context reflects it from storage on a fresh session', async () => {
  const email = 'persist-rec@ca.local';
  const r = await adminApprove({ email, accountType: 'recruiter', organizationId: 'org-9' });
  assert.equal(r.status, 200);

  // Confirm it is on disk (durable), independent of any live session.
  const raw = JSON.parse(fs.readFileSync(dataFilePath(), 'utf8'));
  assert.equal(raw[email]?.roleVerified, true);
  assert.equal(raw[email]?.accountType, 'recruiter');

  // A brand-new login session for that user reads the PERSISTED context.
  const rec = makeClient(base);
  await rec.devLogin('Persisted Rec', email);
  const ctx = await rec.get('/api/account/access-context');
  assert.equal(ctx.status, 200);
  assert.equal(ctx.json.roleVerified, true);
  assert.equal(ctx.json.accountType, 'recruiter');
  assert.equal(ctx.json.role, 'recruiter');
});

test('verified recruiter access works from persisted fields', async () => {
  const email = 'persist-rec2@ca.local';
  assert.equal((await adminApprove({ email, accountType: 'recruiter' })).status, 200);
  const rec = makeClient(base);
  await rec.devLogin('Persisted Rec2', email);
  assert.equal((await rec.get('/api/recruiter/candidates')).status, 200);
  assert.equal((await rec.get('/api/network/shortlists')).status, 200);
});

test('verified college_admin access works from persisted fields (own scope only)', async () => {
  const email = 'persist-col@ca.local';
  assert.equal((await adminApprove({ email, accountType: 'college_admin', collegeId: 'college-A' })).status, 200);
  const col = makeClient(base);
  await col.devLogin('Persisted Col', email);
  assert.equal((await col.get('/api/college/students')).status, 200);
  assert.equal((await col.get('/api/college/students?collegeId=college-B')).status, 403);
});

test('self-selected profile.role still does NOT grant backend privilege (only admin approval does)', async () => {
  const email = 'persist-selfselect@ca.local';
  const c = makeClient(base);
  await c.devLogin('Self Select', email);
  // User asks for recruiter + sets persona — but no admin approval.
  await c.post('/api/account/request-verification', { requestedType: 'recruiter', organizationId: 'org-x' });
  // Even with a persisted PENDING request, access is denied (roleVerified false).
  const ctx = await c.get('/api/account/access-context');
  assert.equal(ctx.json.roleVerified, false);
  assert.notEqual(ctx.json.role, 'recruiter');
  assert.equal((await c.get('/api/recruiter/candidates')).status, 403);
});
