// Multi-college tenancy — unit + API tests.
// Pure-logic units (CSV parsing, join codes, domain matching) plus the API
// surface booted DB-less: RBAC walls, input validation, honest db_off
// degradation, and consent recording. Cross-tenant DATA isolation paths
// (scope filtering over real users) are additionally guarded by the scope
// middleware tested in rbac.test.js and exercised end-to-end with Mongo.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';

import {
  parseRosterCsv, generateJoinCode, normalizeJoinCode, isValidJoinCodeFormat,
  emailDomain, domainMatches, sanitizeDomains, isPublicEmailDomain, slugCollegeKey,
} from '../server/utils/collegeOnboarding.js';
import { emailEnabled } from '../server/utils/mailer.js';
import { CONSENT_VERSION } from '../db.js';

let server, base, client;
before(async () => {
  ({ server, base } = await startServer());
  client = makeClient(base);
  await client.devLogin('Tenancy Tester', 'tenancy@test.dev');
});
after(async () => { await stopServer(server); });

/* ============================================================
   Onboarding helpers (pure, deterministic)
   ============================================================ */

test('roster CSV: flexible headers, quotes, BOM, dedupe, bad rows reported by line', () => {
  const csv = '\uFEFFEmail ID,Student Name,Dept,Passout Year,Roll No\n'
    + 'a@x.edu,"Sharma, Aarav",CSE,2026,101\n'
    + 'b@x.edu,Priya,IT,2027,102\n'
    + 'not-an-email,Broken,CSE,2026,103\n'
    + 'a@x.edu,Duplicate,CSE,2026,104\n';
  const r = parseRosterCsv(csv);
  assert.equal(r.headerDetected, true);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { email: 'a@x.edu', name: 'Sharma, Aarav', branch: 'CSE', batch: '2026', rollNo: '101' });
  assert.equal(r.errors.length, 2);
  assert.equal(r.errors[0].error, 'invalid_email');
  assert.equal(r.errors[0].line, 4);
  assert.equal(r.errors[1].error, 'duplicate_email');
  // Determinism: same text → same result.
  assert.deepEqual(parseRosterCsv(csv), r);
});

test('roster CSV: headerless files assume email-first', () => {
  const r = parseRosterCsv('c@x.edu,Kabir,ENTC,2026\nd@x.edu,Diya,CSE,2027\n');
  assert.equal(r.headerDetected, false);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[1].email, 'd@x.edu');
  assert.equal(r.rows[1].branch, 'CSE');
});

test('join codes: unambiguous alphabet, normalization, format validation', () => {
  const code = generateJoinCode();
  assert.equal(code.length, 8);
  assert.ok(!/[01OIL]/.test(code), `no ambiguous chars, got ${code}`);
  assert.ok(isValidJoinCodeFormat(code));
  const messy = ` ${code.slice(0, 2).toLowerCase()}-${code.slice(2, 4).toLowerCase()} ${code.slice(4).toLowerCase()} `;
  assert.equal(normalizeJoinCode(messy), normalizeJoinCode(code));
  assert.equal(isValidJoinCodeFormat('short'), false);
  assert.equal(isValidJoinCodeFormat('DEMO2026'), true);
});

test('domain matching: subdomains match, public providers are rejected as college domains', () => {
  assert.equal(emailDomain('Aarav.S@Students.COEP.ac.in'), 'students.coep.ac.in');
  assert.ok(domainMatches('a@students.coep.ac.in', ['coep.ac.in']));
  assert.ok(domainMatches('a@coep.ac.in', ['coep.ac.in']));
  assert.ok(!domainMatches('a@notcoep.ac.in', ['coep.ac.in']));
  assert.ok(isPublicEmailDomain('gmail.com'));
  const { domains, rejected } = sanitizeDomains(['COEP.ac.in', '@coep.ac.in', 'gmail.com', 'bad domain', 'coep.ac.in']);
  assert.deepEqual(domains, ['coep.ac.in']);
  assert.ok(rejected.includes('gmail.com'));
});

test('college keys slug deterministically', () => {
  assert.equal(slugCollegeKey('  Demo Institute of Technology! '), 'demo-institute-of-technology');
  assert.equal(slugCollegeKey('PICT, Pune'), slugCollegeKey('pict pune'));
});

/* ============================================================
   RBAC walls — students never reach TPO or admin surfaces
   ============================================================ */

test('students are walled out of every /api/college/* route (403)', async () => {
  for (const call of [
    () => client.get('/api/college/members'),
    () => client.get('/api/college/roster'),
    () => client.get('/api/college/settings'),
    () => client.post('/api/college/roster/import', { csv: 'a@x.edu,A' }),
    () => client.post('/api/college/notify', { studentIds: ['x'] }),
    () => client.post('/api/college/tasks', { studentIds: ['x'], title: 'Do it' }),
  ]) {
    const r = await call();
    assert.equal(r.status, 403, `expected 403, got ${r.status}`);
  }
});

test('admin college registry requires admin', async () => {
  const r = await client.get('/api/admin/colleges');
  assert.equal(r.status, 403);
  const r2 = await client.post('/api/admin/demo/seed', {});
  assert.equal(r2.status, 403);
});

test('student self-service requires auth', async () => {
  const anon = makeClient(base);
  await anon.bootstrap();
  for (const path of ['/api/my/college', '/api/my/notifications', '/api/my/tasks']) {
    const r = await anon.get(path);
    assert.equal(r.status, 401, `${path} must 401 for anonymous`);
  }
});

/* ============================================================
   Honest db_off degradation — soft signals, never fake success
   ============================================================ */

test('joining/registering/leaving degrade to db_off with the DB off', async () => {
  const join = await client.post('/api/my/college/join', { code: 'DEMO2026' });
  assert.equal(join.status, 200);
  assert.equal(join.json.ok, false);
  assert.equal(join.json.reason, 'db_off');

  const reg = await client.post('/api/my/college/register', { name: 'Test Institute of Tech' });
  assert.equal(reg.json.ok, false);
  assert.equal(reg.json.reason, 'db_off');

  const leave = await client.post('/api/my/college/leave', {});
  assert.equal(leave.json.reason, 'db_off');
});

test('join validates code format before touching anything', async () => {
  const r = await client.post('/api/my/college/join', { code: 'no' });
  assert.equal(r.status, 400);
});

test('/api/my/college answers a clean empty state DB-less', async () => {
  const r = await client.get('/api/my/college');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.college, null);
});

test('notifications/tasks read as empty DB-less; writes degrade honestly', async () => {
  const list = await client.get('/api/my/notifications');
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.notifications, []);
  assert.equal(list.json.unread, 0);

  const tasks = await client.get('/api/my/tasks');
  assert.deepEqual(tasks.json.tasks, []);

  const read = await client.post('/api/my/notifications/read', { ids: [] });
  assert.equal(read.json.reason, 'db_off');
});

/* ============================================================
   DPDP consent
   ============================================================ */

test('consent demands an explicit accept', async () => {
  const r = await client.post('/api/my/consent', {});
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'accept_required');
});

test('consent records (session store DB-less) and /auth/me stops requiring it', async () => {
  const before1 = await client.get('/auth/me');
  assert.equal(before1.json.consentRequired, true);
  assert.equal(before1.json.consentVersion, CONSENT_VERSION);

  const r = await client.post('/api/my/consent', { accept: true, collegeVisibility: true });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.version, CONSENT_VERSION);

  const after1 = await client.get('/auth/me');
  assert.equal(after1.json.consentRequired, false);
});

/* ============================================================
   Roster import validation + notify honesty (DB-less contracts)
   ============================================================ */

test('mailer reports not-configured honestly in this environment', () => {
  assert.equal(emailEnabled({}), false);
  assert.equal(emailEnabled({ SMTP_URL: 'smtp://u:p@h:587' }), true);
  assert.equal(emailEnabled({ SMTP_HOST: 'h', SMTP_PORT: '587' }), true);
});
