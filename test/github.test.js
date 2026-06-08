// Tests for the GitHub integration (Career Proof Profile).
//
//   1. Engine unit tests — pure logic + crypto (no network): normalization,
//      stats, stack/skill detection, proof scoring, secret-file exclusion,
//      token encryption round-trip, JWT shape, public-safe private filtering,
//      and the bounded Career Proof Score contribution.
//   2. API / security tests — the live Express app: status never leaks tokens,
//      OAuth state is enforced, the webhook rejects bad signatures, a user
//      cannot analyze another user's repo, private repos are hidden from public
//      profiles by default, and unauthenticated access is blocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer, stopServer, makeClient } from './helpers.js';
import * as gh from '../server/utils/githubIntegrationEngine.js';

/* ============================== ENGINE ============================== */

test('normalizeGitHubUser maps API fields to a safe shape', () => {
  const u = gh.normalizeGitHubUser({ id: 42, login: 'kamal', name: 'Kamal', avatar_url: 'a', html_url: 'https://github.com/kamal', public_repos: 12, followers: 9 });
  assert.equal(u.providerUserId, '42');
  assert.equal(u.handle, 'kamal');
  assert.equal(u.url, 'https://github.com/kamal');
  assert.equal(u.publicRepos, 12);
  assert.equal(u.followers, 9);
});

test('normalizeGitHubRepo derives fullName + privacy', () => {
  const r = gh.normalizeGitHubRepo({ id: 7, name: 'app', owner: { login: 'kamal' }, private: true, default_branch: 'main' });
  assert.equal(r.githubRepoId, '7');
  assert.equal(r.fullName, 'kamal/app');
  assert.equal(r.private, true);
});

test('calculateGitHubStats aggregates stars, languages and recent activity', () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 400).toISOString();
  const repos = [
    { stargazersCount: 5, forksCount: 1, language: 'Python', pushedAt: now, fork: false },
    { stargazersCount: 3, forksCount: 0, language: 'Python', pushedAt: old, fork: false },
    { stargazersCount: 2, forksCount: 2, language: 'JavaScript', pushedAt: now, fork: false },
  ];
  const stats = gh.calculateGitHubStats({ followers: 10, publicRepos: 3 }, repos);
  assert.equal(stats.totalStars, 10);
  assert.equal(stats.totalForks, 3);
  assert.equal(stats.activeRepoCount, 2);
  assert.equal(stats.topLanguages[0].name, 'Python');
  assert.equal(stats.followers, 10);
});

test('detectRepoStack identifies frameworks from manifests', () => {
  const files = {
    'package.json': JSON.stringify({ dependencies: { react: '^18', express: '^4' }, devDependencies: { vite: '^5' } }),
    'Dockerfile': 'FROM node:20',
    '.github/workflows/ci.yml': 'name: ci',
  };
  const stack = gh.detectRepoStack(files, { language: 'JavaScript' });
  assert.ok(stack.includes('React'));
  assert.ok(stack.includes('Express'));
  assert.ok(stack.includes('Docker'));
  assert.ok(stack.includes('GitHub Actions'));
});

test('detectRepoSkills maps evidence to skills', () => {
  const files = {
    'Dockerfile': 'FROM python:3.12',
    'terraform/main.tf': 'resource "aws_s3_bucket" "b" {}',
    'requirements.txt': 'fastapi\nuvicorn',
    'tests/test_app.py': 'def test_x(): pass',
    'README.md': 'x'.repeat(300),
  };
  const skills = gh.detectRepoSkills(files, {});
  assert.ok(skills.includes('Docker'));
  assert.ok(skills.includes('Containerization'));
  assert.ok(skills.includes('Terraform'));
  assert.ok(skills.includes('Infrastructure as Code'));
  assert.ok(skills.includes('Python'));
  assert.ok(skills.includes('Testing'));
  assert.ok(skills.includes('Documentation'));
});

test('calculateRepoProofScore rewards real evidence and is bounded 0..100', () => {
  const rich = {
    'README.md': 'word '.repeat(300),
    'package.json': '{}',
    'src/index.js': 'x',
    'tests/a.test.js': 'x',
    '.github/workflows/ci.yml': 'x',
    'Dockerfile': 'x',
    'terraform/main.tf': 'x',
  };
  const a = gh.calculateRepoProofScore({ pushedAt: new Date().toISOString() }, rich, { recentCommits: 12 });
  assert.ok(a.score >= 70, `expected strong score, got ${a.score}`);
  assert.ok(a.score <= 100);
  const empty = gh.calculateRepoProofScore({}, {}, {});
  assert.ok(empty.score >= 0 && empty.score < 50);
});

test('isSecretLikePath blocks secrets; isAllowedProofFile allowlists proof files', () => {
  for (const p of ['.env', 'config/.env.production', 'id_rsa', 'server.pem', 'secrets.json', 'creds/credentials.yml', 'aws-token.txt']) {
    assert.equal(gh.isSecretLikePath(p), true, `${p} should be secret-like`);
    assert.equal(gh.isAllowedProofFile(p), false, `${p} must never be allowed`);
  }
  for (const p of ['README.md', 'package.json', 'requirements.txt', 'Dockerfile', '.github/workflows/ci.yml', 'terraform/main.tf']) {
    assert.equal(gh.isAllowedProofFile(p), true, `${p} should be allowed`);
  }
});

test('sanitizeRepoFilesForAnalysis strips secret files even if fetched', () => {
  const clean = gh.sanitizeRepoFilesForAnalysis({ 'README.md': 'ok', '.env': 'SECRET=1', 'app.key': 'x' });
  assert.ok('README.md' in clean);
  assert.ok(!('.env' in clean));
  assert.ok(!('app.key' in clean));
});

test('token encryption round-trips and rejects tampering', () => {
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'unit-test-key-please-ignore';
  const enc = gh.encryptToken('gho_secrettoken123');
  assert.ok(enc.startsWith('v1:'));
  assert.notEqual(enc, 'gho_secrettoken123');
  assert.equal(gh.decryptToken(enc), 'gho_secrettoken123');
  const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'B' : 'A');
  assert.equal(gh.decryptToken(tampered), null);
  assert.equal(gh.decryptToken('garbage'), null);
});

test('generateGitHubAppJwt produces a valid RS256 JWT verifiable by the public key', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  // Simulate an env-stored key with escaped newlines.
  process.env.GITHUB_APP_ID = '123456';
  process.env.GITHUB_APP_PRIVATE_KEY = String(pem).replace(/\n/g, '\\n');
  const jwt = gh.generateGitHubAppJwt();
  const [h, p, s] = jwt.split('.');
  assert.ok(h && p && s);
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(header.alg, 'RS256');
  assert.equal(payload.iss, '123456');
  assert.ok(payload.exp > payload.iat);
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${h}.${p}`);
  verifier.end();
  assert.equal(verifier.verify(publicKey, Buffer.from(s, 'base64url')), true);
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
});

test('filterPrivateRepoDataForPublicView hides private repos by default', () => {
  const privateAnalysis = { visibility: 'private', repoFullName: 'kamal/secret', score: 80, detectedSkills: ['Docker'], evidence: [{ label: 'README detected', present: true }] };
  // Default (no opt-in) -> nothing leaks.
  assert.equal(gh.filterPrivateRepoDataForPublicView(privateAnalysis, {}), null);
  // Opt-in -> safe summary only, NO repo name.
  const safe = gh.filterPrivateRepoDataForPublicView(privateAnalysis, { privateProofSummaryVisible: true });
  assert.ok(safe);
  assert.equal(safe.repoName, null);
  assert.equal(safe.proofScore, 80);
  assert.ok(safe.detectedSkills.includes('Docker'));
});

test('filterPrivateRepoDataForPublicView hides public repos until opted in', () => {
  const pub = { visibility: 'public', repoFullName: 'kamal/app', score: 70, detectedSkills: [], evidence: [] };
  assert.equal(gh.filterPrivateRepoDataForPublicView(pub, {}), null);
  const shown = gh.filterPrivateRepoDataForPublicView(pub, { publicProofVisible: true, htmlUrl: 'https://github.com/kamal/app' });
  assert.equal(shown.repoName, 'kamal/app');
});

test('githubProofContribution is bounded and never overinflates', () => {
  const big = gh.githubProofContribution({
    identityConnected: true, appInstalled: true,
    analyzedRepos: Array.from({ length: 20 }, () => ({ score: 100, visibility: 'public', detectedSkills: ['A', 'B', 'C'] })),
  });
  assert.ok(big.publicContribution <= big.cap);
  assert.equal(big.cap, 30);
  const none = gh.githubProofContribution({});
  assert.equal(none.publicContribution, 0);
});

test('generatePublicSafeRepoSummary omits repo name for private repos', () => {
  const s = gh.generatePublicSafeRepoSummary({ visibility: 'private', repoFullName: 'kamal/secret', score: 60, detectedSkills: [], evidence: [] });
  assert.equal(s.repoName, null);
  assert.equal(s.verified, true);
});

/* ============================== API / SECURITY ============================== */

test('GET /api/integrations/github/config requires auth', async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(base + '/api/integrations/github/config');
    assert.equal(res.status, 401);
  } finally { await stopServer(server); }
});

test('GET /api/integrations/github/status never returns tokens', async () => {
  const { server, base } = await startServer();
  try {
    const c = makeClient(base);
    await c.devLogin('Kamal', 'kamal@test.dev');
    const res = await c.get('/api/integrations/github/status');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.ok(!/encryptedAccessToken|access_token|"token"/i.test(res.text), 'status must not leak token fields');
    // connection should be null (not connected) and contain no token key when present
    assert.ok(res.json.connection === null || !('encryptedAccessToken' in res.json.connection));
  } finally { await stopServer(server); }
});

test('OAuth callback rejects a mismatched state', async () => {
  const { server, base } = await startServer();
  try {
    const c = makeClient(base);
    await c.devLogin('Kamal', 'kamal@test.dev');
    // No session state set -> any state is "bad_state"; callback should redirect with gh_error.
    const res = await fetch(base + '/api/integrations/github/callback?code=x&state=forged', {
      headers: { Cookie: [...c.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') },
      redirect: 'manual',
    });
    assert.ok([301, 302, 303, 307, 308].includes(res.status));
    const loc = res.headers.get('location') || '';
    assert.ok(/gh_error=/.test(loc), 'should redirect with an error flag');
    assert.ok(!/access_token/.test(loc));
  } finally { await stopServer(server); }
});

test('webhook: ignored without a secret, rejects bad signatures, accepts valid ones', async () => {
  // These sub-cases share one server and run sequentially so the global
  // GITHUB_APP_WEBHOOK_SECRET is never toggled by a concurrent test.
  const prev = process.env.GITHUB_APP_WEBHOOK_SECRET;

  // (a) No secret configured -> ignored.
  delete process.env.GITHUB_APP_WEBHOOK_SECRET;
  let h = await startServer();
  try {
    const res = await fetch(h.base + '/api/integrations/github/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleted' }),
    });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.equal(j.ignored, 'webhook_not_configured');
  } finally { await stopServer(h.server); }

  // (b) Secret configured -> bad signature 401, valid signature 200.
  process.env.GITHUB_APP_WEBHOOK_SECRET = 'unit-webhook-secret';
  h = await startServer();
  try {
    const body = JSON.stringify({ action: 'deleted', installation: { id: 1 } });
    const bad = await fetch(h.base + '/api/integrations/github/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=deadbeef', 'X-GitHub-Event': 'installation' },
      body,
    });
    assert.equal(bad.status, 401);

    const good = 'sha256=' + crypto.createHmac('sha256', 'unit-webhook-secret').update(Buffer.from(body)).digest('hex');
    const ok = await fetch(h.base + '/api/integrations/github/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': good, 'X-GitHub-Event': 'installation' },
      body,
    });
    assert.equal(ok.status, 200);
  } finally {
    await stopServer(h.server);
    if (prev !== undefined) process.env.GITHUB_APP_WEBHOOK_SECRET = prev;
    else delete process.env.GITHUB_APP_WEBHOOK_SECRET;
  }
});

test('analyzing a repository the user does not own returns 404', async () => {
  const { server, base } = await startServer();
  try {
    const c = makeClient(base);
    await c.devLogin('Kamal', 'kamal@test.dev');
    const res = await c.post('/api/integrations/github/repositories/999999/analyze', { confirmPrivate: false });
    // DB off in tests -> no owned repo -> 404 repo_not_found.
    assert.equal(res.status, 404);
    assert.equal(res.json.error, 'repo_not_found');
  } finally { await stopServer(server); }
});

test('repositories list is empty and auth-gated', async () => {
  const { server, base } = await startServer();
  try {
    const noauth = await fetch(base + '/api/integrations/github/repositories');
    assert.equal(noauth.status, 401);
    const c = makeClient(base);
    await c.devLogin('Kamal', 'kamal@test.dev');
    const res = await c.get('/api/integrations/github/repositories');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.repositories, []);
  } finally { await stopServer(server); }
});
