// RBAC authorization tests.
//
// Two layers:
//  1) HTTP authorization — boots the real app and proves the persona-role guards
//     on the recruiter / college / admin API families (401 unauthenticated,
//     403 for normal users, and the correct pass-through for admins).
//  2) Pure resolver logic — access.resolvePersonaRole, which decides a caller's
//     persona role from server-controlled inputs and is the single place that
//     could later require recruiter/college verification.
//
// NOTE ON THE TEST ENV: there is no MongoDB in the test harness (db:off), so the
// ONLY server-resolvable non-anonymous role is `admin` (via ADMIN_EMAILS). A
// self-selected recruiter/college persona is persisted in the DB in production
// and resolves there; with no DB it correctly resolves to `student` and is
// denied. The recruiter/college "allowed" paths are therefore validated at the
// resolver level (layer 2), while the HTTP layer proves the deny + admin paths.
process.env.ADMIN_EMAILS = 'rbac-admin@careerautopilot.local';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';
import {
  resolvePersonaRole, resolvePrivilegedRole, collegeScopeAllowed,
  isPersonaVerified, PERSONA_ROLES,
} from '../access.js';

let server;
let base;

before(async () => { ({ server, base } = await startServer()); });
after(async () => { await stopServer(server); });

const ADMIN_EMAIL = 'rbac-admin@careerautopilot.local';

/* ----------------------------------------------------------------
   1) HTTP AUTHORIZATION — recruiter candidate discovery
   ---------------------------------------------------------------- */

test('GET /api/recruiter/candidates rejects unauthenticated with 401', async () => {
  const c = makeClient(base);
  await c.bootstrap();
  const r = await c.get('/api/recruiter/candidates');
  assert.equal(r.status, 401);
  assert.equal(r.json.error, 'auth_required');
});

test('GET /api/recruiter/candidates returns 403 for a normal (student) user', async () => {
  const c = makeClient(base);
  await c.devLogin('Normal User', 'rbac-normal@example.com');
  const r = await c.get('/api/recruiter/candidates');
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'forbidden');
});

test('GET /api/recruiter/candidates returns 200 for an admin', async () => {
  const c = makeClient(base);
  await c.devLogin('Admin Ada', ADMIN_EMAIL);
  const r = await c.get('/api/recruiter/candidates');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(Array.isArray(r.json.candidates));
});

/* ----------------------------------------------------------------
   HTTP AUTHORIZATION — network candidate discovery (recruiter/admin only)
   ---------------------------------------------------------------- */

test('GET /api/network/candidates returns 403 for a normal user', async () => {
  const c = makeClient(base);
  await c.devLogin('Normal User', 'rbac-normal2@example.com');
  const r = await c.get('/api/network/candidates');
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'forbidden');
});

test('GET /api/network/candidates returns 200 for an admin', async () => {
  const c = makeClient(base);
  await c.devLogin('Admin Ada', ADMIN_EMAIL);
  const r = await c.get('/api/network/candidates');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(Array.isArray(r.json.profiles));
});

/* ----------------------------------------------------------------
   HTTP AUTHORIZATION — /api/college/* namespace guard
   ---------------------------------------------------------------- */

test('GET /api/college/* rejects unauthenticated with 401', async () => {
  const c = makeClient(base);
  await c.bootstrap();
  const r = await c.get('/api/college/students');
  assert.equal(r.status, 401);
  assert.equal(r.json.error, 'auth_required');
});

test('GET /api/college/* returns 403 for a normal user (and a self-selected recruiter)', async () => {
  const c = makeClient(base);
  await c.devLogin('Normal User', 'rbac-normal3@example.com');
  const r = await c.get('/api/college/students');
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'forbidden');
});

test('GET /api/college/students passes the guard for an admin (real scoped route → 200)', async () => {
  const c = makeClient(base);
  await c.devLogin('Admin Ada', ADMIN_EMAIL);
  const r = await c.get('/api/college/students');
  assert.notEqual(r.status, 401);
  assert.notEqual(r.status, 403);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

/* ----------------------------------------------------------------
   HTTP AUTHORIZATION — admin directory still locked down
   ---------------------------------------------------------------- */

test('GET /api/admin/users returns 403 for a normal user and 200 for an admin', async () => {
  const normal = makeClient(base);
  await normal.devLogin('Normal User', 'rbac-normal4@example.com');
  const r1 = await normal.get('/api/admin/users');
  assert.equal(r1.status, 403);

  const admin = makeClient(base);
  await admin.devLogin('Admin Ada', ADMIN_EMAIL);
  const r2 = await admin.get('/api/admin/users');
  assert.equal(r2.status, 200);
  assert.equal(r2.json.ok, true);
});

/* ----------------------------------------------------------------
   HTTP AUTHORIZATION — shortlist APIs (recruiter/admin only)
   ---------------------------------------------------------------- */

test('shortlist APIs reject unauthenticated with 401', async () => {
  const c = makeClient(base);
  await c.bootstrap();
  const g = await c.get('/api/network/shortlists');
  assert.equal(g.status, 401);
  const p = await c.post('/api/network/shortlists', { candidateUserId: 'x' });
  assert.equal(p.status, 401);
});

test('shortlist APIs return 403 for a normal (student/professional) user', async () => {
  const c = makeClient(base);
  await c.devLogin('Student Sam', 'rbac-student-sl@example.com');
  const g = await c.get('/api/network/shortlists');
  assert.equal(g.status, 403);
  assert.equal(g.json.error, 'forbidden');
  const p = await c.post('/api/network/shortlists', { candidateUserId: 'x' });
  assert.equal(p.status, 403);
  assert.equal(p.json.error, 'forbidden');
});

test('shortlist GET works for an admin', async () => {
  const c = makeClient(base);
  await c.devLogin('Admin Ada', ADMIN_EMAIL);
  const g = await c.get('/api/network/shortlists');
  assert.equal(g.status, 200);
  assert.equal(g.json.ok, true);
});

/* ----------------------------------------------------------------
   HTTP — payments subscription-status must not throw (effectivePlan restored)
   ---------------------------------------------------------------- */

test('GET /api/payments/subscription-status works and returns effectivePlan', async () => {
  const c = makeClient(base);
  await c.devLogin('Paying Pat', 'rbac-sub@example.com');
  const r = await c.get('/api/payments/subscription-status');
  assert.equal(r.status, 200);
  // The regression was "access.effectivePlan is not a function" → must be a string.
  assert.equal(typeof r.json.effectivePlan, 'string');
});

/* ----------------------------------------------------------------
   HTTP — VERIFIED privileged-role flow (admin approves → access granted)
   ---------------------------------------------------------------- */

async function adminVerify(body) {
  const admin = makeClient(base);
  await admin.devLogin('Admin Ada', ADMIN_EMAIL);
  return admin.post('/api/admin/users/by-email/verify', body);
}

test('self-selected / requested-but-unapproved recruiter is STILL rejected from recruiter APIs', async () => {
  const c = makeClient(base);
  await c.devLogin('Wannabe Rec', 'rbac-pending-rec@example.com');
  await c.post('/api/account/request-verification', { requestedType: 'recruiter', organizationId: 'org-1' });
  const r = await c.get('/api/recruiter/candidates');
  assert.equal(r.status, 403); // pending != verified
});

test('a VERIFIED recruiter can access recruiter, candidate and shortlist APIs', async () => {
  const email = 'rbac-verified-rec@example.com';
  const v = await adminVerify({ email, accountType: 'recruiter', organizationId: 'org-9', action: 'approve' });
  assert.equal(v.status, 200);
  const rec = makeClient(base);
  await rec.devLogin('Verified Rec', email);
  assert.equal((await rec.get('/api/recruiter/candidates')).status, 200);
  assert.equal((await rec.get('/api/network/candidates')).status, 200);
  assert.equal((await rec.get('/api/network/shortlists')).status, 200);
});

test('a VERIFIED college_admin can access OWN college students but NOT another college', async () => {
  const email = 'rbac-verified-college@example.com';
  const v = await adminVerify({ email, accountType: 'college_admin', collegeId: 'college-A', action: 'approve' });
  assert.equal(v.status, 200);
  const ca = makeClient(base);
  await ca.devLogin('Verified College', email);
  const own = await ca.get('/api/college/students');
  assert.equal(own.status, 200);
  assert.equal(own.json.ok, true);
  assert.ok(Array.isArray(own.json.students));
  const other = await ca.get('/api/college/students?collegeId=college-B');
  assert.equal(other.status, 403);
  assert.equal(other.json.error, 'forbidden_scope');
});

test('admin can access any college scope', async () => {
  const c = makeClient(base);
  await c.devLogin('Admin Ada', ADMIN_EMAIL);
  const r = await c.get('/api/college/students?collegeId=college-Z');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

/* ----------------------------------------------------------------
   PURE LOGIC — backend privilege must be SERVER-CONTROLLED
   ---------------------------------------------------------------- */

test('resolvePrivilegedRole: a self-selected profile role grants NO backend privilege', () => {
  // profile.role is never passed to the backend resolver; even if it were, the
  // resolver only consults server-controlled fields.
  assert.equal(resolvePrivilegedRole({ email: 'r@x.z' }), null);
  assert.equal(resolvePrivilegedRole({ email: 'r@x.z', profileRole: 'recruiter' }), null);
  assert.equal(resolvePrivilegedRole({ email: 'c@x.z', profileRole: 'college_admin' }), null);
});

test('resolvePrivilegedRole: admin from allowlist / dbRole / isAdmin flag', () => {
  assert.equal(resolvePrivilegedRole({ email: ADMIN_EMAIL }), 'admin');
  assert.equal(resolvePrivilegedRole({ email: 'x@y.z', dbRole: 'admin' }), 'admin');
  assert.equal(resolvePrivilegedRole({ email: 'x@y.z', isAdmin: true }), 'admin');
});

test('resolvePrivilegedRole: recruiter/college require a VERIFIED server-controlled accountType', () => {
  // accountType alone (unverified) grants NOTHING.
  assert.equal(resolvePrivilegedRole({ email: 'a@b.c', accountType: 'recruiter' }), null);
  assert.equal(resolvePrivilegedRole({ email: 'a@b.c', accountType: 'college_admin' }), null);
  // accountType + roleVerified grants the role.
  assert.equal(resolvePrivilegedRole({ email: 'a@b.c', accountType: 'recruiter', roleVerified: true }), 'recruiter');
  assert.equal(resolvePrivilegedRole({ email: 'a@b.c', accountType: 'college_admin', roleVerified: true }), 'college_admin');
  // a persisted server-set dbRole counts as verified.
  assert.equal(resolvePrivilegedRole({ email: 'a@b.c', dbRole: 'recruiter' }), 'recruiter');
  // self-selected "admin" via accountType is never trusted.
  assert.equal(resolvePrivilegedRole({ email: 'a@b.c', accountType: 'admin', roleVerified: true }), null);
});

test('collegeScopeAllowed: same collegeId allowed, other college denied, missing denied', () => {
  assert.equal(collegeScopeAllowed('college-A', 'college-A'), true);
  assert.equal(collegeScopeAllowed('college-A', 'college-B'), false); // other college students
  assert.equal(collegeScopeAllowed('', 'college-A'), false);
  assert.equal(collegeScopeAllowed('college-A', null), false);
});

test('isPersonaVerified: only admin is verified today', () => {
  assert.equal(isPersonaVerified('admin'), true);
  assert.equal(isPersonaVerified('recruiter'), false);
  assert.equal(isPersonaVerified('college_admin'), false);
  assert.ok(PERSONA_ROLES.includes('recruiter'));
});
