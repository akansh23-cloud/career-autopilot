// Admin User Directory / Talent Intelligence tests.
//
// Two layers:
//  1) HTTP authorization — boots the real app and proves the access rules
//     (401 unauthenticated, 403 for normal users AND recruiters, 200 for admin).
//  2) Pure data-layer logic — the safe DTO mapper + filter/search/sort/paginate
//     helpers, which are pure functions of already-safe objects and need no DB.
//
// Admin authority in the test env comes ONLY from ADMIN_EMAILS (resolved
// server-side). It is set BEFORE importing the harness so server.js sees it.
process.env.ADMIN_EMAILS = 'admin@careerautopilot.local';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';
import {
  adminUserDTO, filterAdminUsers, sortAdminUsers, paginateAdminUsers, adminDirectoryStats,
} from '../db.js';

let server;
let base;

before(async () => { ({ server, base } = await startServer()); });
after(async () => { await stopServer(server); });

const ADMIN_EMAIL = 'admin@careerautopilot.local';

/* ----------------------------------------------------------------
   1) HTTP AUTHORIZATION
   ---------------------------------------------------------------- */

test('GET /api/admin/users rejects unauthenticated requests with 401', async () => {
  const c = makeClient(base);
  await c.bootstrap();
  const r = await c.get('/api/admin/users');
  assert.equal(r.status, 401);
  assert.equal(r.json.error, 'auth_required');
});

test('GET /api/admin/users returns 403 for a normal (non-admin) user', async () => {
  const c = makeClient(base);
  await c.devLogin('Normal User', 'normal-user@example.com');
  const r = await c.get('/api/admin/users');
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'forbidden');
});

test('GET /api/admin/users returns 403 for a recruiter (recruiters cannot see the admin directory)', async () => {
  const c = makeClient(base);
  await c.devLogin('Recruiter Rita', 'recruiter@example.com');
  const r = await c.get('/api/admin/users');
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'forbidden');
});

test('GET /api/admin/users returns 200 + well-formed payload for an admin', async () => {
  const c = makeClient(base);
  await c.devLogin('Admin Ada', ADMIN_EMAIL);
  const r = await c.get('/api/admin/users');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(Array.isArray(r.json.users), 'users must be an array');
  assert.ok(r.json.stats && typeof r.json.stats.totalUsers === 'number', 'stats summary present');
  assert.equal(typeof r.json.page, 'number');
  assert.equal(typeof r.json.totalPages, 'number');
});

test('admin list accepts filter/sort/pagination query params without error', async () => {
  const c = makeClient(base);
  await c.devLogin('Admin Ada', ADMIN_EMAIL);
  const r = await c.get('/api/admin/users?skill=react&sort=xp&page=1&pageSize=10&recruiterVisible=true');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.pageSize, 10);
});

test('GET /api/admin/users/:id rejects unauthenticated with 401 and non-admin with 403', async () => {
  const anon = makeClient(base);
  await anon.bootstrap();
  const r1 = await anon.get('/api/admin/users/64b2f0000000000000000000');
  assert.equal(r1.status, 401);

  const normal = makeClient(base);
  await normal.devLogin('Normal', 'normal2@example.com');
  const r2 = await normal.get('/api/admin/users/64b2f0000000000000000000');
  assert.equal(r2.status, 403);
});

test('PATCH visibility requires admin (401 unauth, 403 non-admin)', async () => {
  const anon = makeClient(base);
  await anon.bootstrap();
  const r1 = await anon.patch('/api/admin/users/64b2f0000000000000000000/visibility', { recruiterVisible: true });
  assert.equal(r1.status, 401);

  const normal = makeClient(base);
  await normal.devLogin('Normal', 'normal3@example.com');
  const r2 = await normal.patch('/api/admin/users/64b2f0000000000000000000/visibility', { recruiterVisible: true });
  assert.equal(r2.status, 403);
});

/* ----------------------------------------------------------------
   2) PURE DATA-LAYER LOGIC (no DB required)
   ---------------------------------------------------------------- */

// A deliberately "dirty" user doc carrying secrets that must NEVER be exposed.
const dirtyUser = {
  _id: 'u1',
  name: 'Asha Verma',
  email: 'asha@example.com',
  avatar: 'https://pic/a.png',
  googleId: 'google-oauth-id-SECRET',
  role: 'user',
  isActive: true,
  loginCount: 4,
  adminNotes: 'private note',
  featuredTalent: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  lastLoginAt: '2025-06-01T00:00:00.000Z',
  // things that must never leak:
  accessToken: 'ya29.SECRET-TOKEN',
  refreshToken: 'RT-SECRET',
  password: 'hunter2',
  sessionData: { cookie: 'SECRET' },
};
const network = {
  userId: 'u1',
  track: 'Backend',
  targetRole: 'Backend Engineer',
  currentCompany: 'Acme',
  location: 'Pune',
  visibility: 'published_only',
  openToRecruiters: true,
  completeness: 72,
  trustScore: 40,
  trustLevel: 'Building Trust',
  updatedAt: '2025-06-05T00:00:00.000Z',
  metrics: { careerXP: 820, level: 'Job Ready', verifiedBadges: 2, badgeCount: 3, publishedCount: 2, readiness: 64,
    skillNames: ['React', 'Node', 'Kubernetes'], topSkills: [{ name: 'React', xp: 600, level: 'Job Ready' }] },
};
const state = { profile: { skills: 'React, Node', currentRole: 'SDE-1' }, projects: [{}, {}, {}] };

test('adminUserDTO never exposes secrets / tokens / OAuth / raw session data', () => {
  const dto = adminUserDTO({ user: dirtyUser, network, state });
  const blob = JSON.stringify(dto);
  for (const secret of ['googleId', 'accessToken', 'refreshToken', 'password', 'sessionData', 'cookie']) {
    assert.ok(!(secret in dto), `DTO must not contain key "${secret}"`);
  }
  for (const val of ['google-oauth-id-SECRET', 'ya29.SECRET-TOKEN', 'RT-SECRET', 'hunter2']) {
    assert.ok(!blob.includes(val), `serialized DTO must not contain secret value ${val}`);
  }
  // It SHOULD expose the safe, intended fields.
  assert.equal(dto.id, 'u1');
  assert.equal(dto.email, 'asha@example.com');
  assert.equal(dto.xp, 820);
  assert.equal(dto.recruiterVisible, true);
  assert.equal(dto.completedProjectsCount, 2);
  assert.equal(dto.totalProjectsCount, 3);
  assert.equal(dto.featuredTalent, true);
});

test('recruiterVisible defaults to false / private when there is no network profile', () => {
  const dto = adminUserDTO({ user: { _id: 'u2', name: 'New User', email: 'new@example.com' } });
  assert.equal(dto.recruiterVisible, false);
  assert.equal(dto.visibilityStatus, 'private');
  assert.equal(dto.profileCompletion, 0);
  assert.equal(dto.xp, 0);
});

test('adminUserDTO falls back to onboarding skills string when no derived skills exist', () => {
  const dto = adminUserDTO({ user: { _id: 'u3', name: 'X', email: 'x@e.com' }, state: { profile: { skills: 'Java, AWS , AWS' } } });
  assert.deepEqual(dto.skills, ['Java', 'AWS']); // trimmed + de-duped
});

// A small fixture set of safe DTOs for filter/sort/paginate/stats.
function fixtures() {
  return [
    adminUserDTO({ user: { _id: 'a', name: 'Alice Cloud', email: 'alice@corp.com', lastLoginAt: new Date().toISOString() },
      network: { metrics: { careerXP: 1000, skillNames: ['React', 'DevOps'], publishedCount: 3 }, openToRecruiters: true, completeness: 90, updatedAt: new Date().toISOString() } }),
    adminUserDTO({ user: { _id: 'b', name: 'Bob Backend', email: 'bob@corp.com', lastLoginAt: '2024-01-01T00:00:00.000Z' },
      network: { metrics: { careerXP: 500, skillNames: ['Java', 'Kubernetes'], publishedCount: 1 }, openToRecruiters: false, completeness: 40, updatedAt: '2024-01-01T00:00:00.000Z' } }),
    adminUserDTO({ user: { _id: 'c', name: 'Cara Data', email: 'cara@data.io', lastLoginAt: new Date().toISOString() },
      network: { metrics: { careerXP: 1500, skillNames: ['Python', 'AI/ML'], publishedCount: 0 }, openToRecruiters: true, completeness: 60, updatedAt: new Date().toISOString() } }),
  ];
}

test('filterAdminUsers filters by skill', () => {
  const rows = fixtures();
  const out = filterAdminUsers(rows, { skill: 'kubernetes' });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Bob Backend');
});

test('filterAdminUsers searches by name and by email', () => {
  const rows = fixtures();
  assert.equal(filterAdminUsers(rows, { q: 'alice' }).length, 1);
  assert.equal(filterAdminUsers(rows, { q: 'data.io' })[0].name, 'Cara Data');
});

test('filterAdminUsers honors recruiterVisible-only', () => {
  const rows = fixtures();
  const out = filterAdminUsers(rows, { recruiterVisible: true });
  assert.equal(out.length, 2);
  assert.ok(out.every((u) => u.recruiterVisible === true));
});

test('sortAdminUsers sorts by XP descending', () => {
  const rows = sortAdminUsers(fixtures(), 'xp');
  assert.deepEqual(rows.map((r) => r.xp), [1500, 1000, 500]);
});

test('paginateAdminUsers paginates and reports totals', () => {
  const rows = fixtures();
  const p1 = paginateAdminUsers(rows, 1, 2);
  assert.equal(p1.items.length, 2);
  assert.equal(p1.total, 3);
  assert.equal(p1.totalPages, 2);
  const p2 = paginateAdminUsers(rows, 2, 2);
  assert.equal(p2.items.length, 1);
  assert.equal(p2.page, 2);
});

test('adminDirectoryStats summarizes recruiter-visible, projects and top skill', () => {
  const s = adminDirectoryStats(fixtures());
  assert.equal(s.totalUsers, 3);
  assert.equal(s.recruiterVisibleUsers, 2);
  assert.equal(s.completedProjectUsers, 2); // a + b have publishedCount > 0
  assert.ok(s.topSkillCount >= 1);
});
