// Proof verification v2 — the honesty and safety contracts.
//
// Each test here pins a rule that, if broken, either lies to a student about
// their proof or exposes the server. No network calls: every case uses inputs
// that short-circuit before any fetch, or drives the validator directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isBlockedIp, assertSafeUrl } from '../server/utils/workspace/ssrfGuard.js';
import { parseTestOutput } from '../server/utils/workspace/testOutputParser.js';
import { runVerification } from '../server/utils/workspace/workspaceValidator.js';
import { planProof } from '../server/utils/workspace/proofAndPlanners.js';
import { parseRepoUrl, normalizeUrl } from '../server/utils/workspace/proofVerification.js';

/* ---------------- SSRF guard ---------------- */

test('cloud metadata and private ranges are blocked', () => {
  // 169.254.169.254 is the AWS/GCP instance metadata endpoint — the single
  // most valuable SSRF target. v6 fetched student URLs with no checks at all.
  for (const ip of ['169.254.169.254', '127.0.0.1', '10.0.0.5', '172.16.4.1',
                    '192.168.1.1', '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', 'fd00::1']) {
    assert.equal(isBlockedIp(ip), true, `${ip} should be blocked`);
  }
});

test('public addresses are allowed', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '76.76.21.21', '2606:4700::1111']) {
    assert.equal(isBlockedIp(ip), false, `${ip} should be allowed`);
  }
});

test('IPv4-mapped IPv6 cannot smuggle a private address past the guard', () => {
  assert.equal(isBlockedIp('::ffff:169.254.169.254'), true);
  assert.equal(isBlockedIp('::ffff:10.1.2.3'), true);
});

test('non-http schemes and localhost hostnames are refused', async () => {
  assert.equal((await assertSafeUrl('file:///etc/passwd')).ok, false);
  assert.equal((await assertSafeUrl('gopher://x/1')).ok, false);
  assert.equal((await assertSafeUrl('http://localhost:6379')).ok, false);
  assert.equal((await assertSafeUrl('http://foo.internal/admin')).ok, false);
  assert.equal((await assertSafeUrl('http://127.0.0.1:8080')).ok, false);
});

/* ---------------- test output parser ---------------- */

test('recognised runner summaries parse with counts', () => {
  const jest = parseTestOutput('PASS src/a.test.js\n\nTest Suites: 3 passed, 3 total\nTests:       12 passed, 12 total\nSnapshots:   0 total\nTime:        2.1 s');
  assert.equal(jest.ok, true);
  assert.equal(jest.runner, 'Jest');
  assert.equal(jest.passed, 12);

  const mocha = parseTestOutput('  API\n    GET /health\n      should return ok\n\n  7 passing (120ms)\n\nDone in 1.2s. Everything looks fine here.');
  assert.equal(mocha.ok, true);
  assert.equal(mocha.runner, 'Mocha');
  assert.equal(mocha.passed, 7);

  const nodeT = parseTestOutput('TAP version 13\nok 1 - adds\nok 2 - subtracts\n1..2\n# tests 2\n# pass 2\n# fail 0\n# duration_ms 40');
  assert.equal(nodeT.ok, true);
  assert.equal(nodeT.runner, 'node:test');
});

test('a run with failures is rejected, not accepted as proof', () => {
  const r = parseTestOutput('FAIL src/b.test.js\n\nTest Suites: 1 failed, 2 total\nTests:       2 failed, 8 passed, 10 total\nTime: 3s');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'failing');
  assert.match(r.message, /2 failing/);
});

test('junk paste is rejected with actionable feedback', () => {
  assert.equal(parseTestOutput('').reason, 'empty');
  assert.equal(parseTestOutput('it works').reason, 'too_short');
  const junk = parseTestOutput('all my tests are passing, I promise, everything works great on my machine here');
  assert.equal(junk.ok, false);
  assert.equal(junk.reason, 'unrecognised');
  assert.match(junk.message, /npm test/);
});

test('a runner that reports zero tests does not count', () => {
  const r = parseTestOutput('Test Suites: 0 total\nTests:       0 total\nSnapshots:   0 total\nTime:        0.5 s\nRan all test suites.');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_tests');
});

/* ---------------- URL parsing ---------------- */

test('repo URL parsing accepts real forms and rejects junk', () => {
  assert.equal(parseRepoUrl('https://github.com/akansh/career-autopilot').fullName, 'akansh/career-autopilot');
  assert.equal(parseRepoUrl('https://github.com/akansh/career-autopilot.git').fullName, 'akansh/career-autopilot');
  assert.equal(parseRepoUrl('github.com/a/b/').fullName, 'a/b');
  assert.equal(parseRepoUrl('https://gitlab.com/a/b'), null);
  assert.equal(parseRepoUrl('not a url'), null);
});

test('bare hostnames get an https scheme', () => {
  assert.match(normalizeUrl('my-app.vercel.app'), /^https:\/\//);
  assert.equal(normalizeUrl(''), null);
});

/* ---------------- proof catalogue ---------------- */

test('demo video is gone and screenshots are repo-backed', () => {
  const items = planProof({}, { frontend: 'react', backend: 'node' });
  assert.equal(items.some((i) => i.type === 'demo_video'), false);
  const shots = items.find((i) => i.type === 'screenshots');
  assert.equal(shots.verificationMethod, 'github_screenshots');
  assert.equal(shots.required, true);
  // Nothing should still be on the old un-actionable 'manual' method.
  assert.equal(items.some((i) => i.verificationMethod === 'manual'), false);
});

test('non-deployable projects skip deployment items instead of failing them', () => {
  const items = planProof({}, {}); // no frontend/backend/deployment
  const dep = items.find((i) => i.type === 'deployed_url');
  assert.equal(dep.status, 'not_applicable');
  assert.equal(dep.required, false, 'a skipped item must not block completion');
  const health = items.find((i) => i.type === 'api_health');
  assert.equal(health.status, 'not_applicable');
});

/* ---------------- validator status rules ---------------- */

const planWith = (stack) => ({ proofRequirements: planProof({}, stack), architecture: {} });

test('no evidence leaves everything pending with an instruction', () => {
  const { proofRequirements, verificationSummary } = runVerification(planWith({ frontend: 'react' }), null);
  assert.equal(verificationSummary.mode, 'local_only');
  const net = proofRequirements.filter((p) => p.status !== 'not_applicable' && p.verificationMethod !== 'workspace_local');
  assert.ok(net.every((p) => p.status === 'pending'));
  assert.ok(net.every((p) => /attach|paste|run/i.test(p.verificationNote)));
});

test('an unavailable check is pending, never failed', () => {
  // GitHub rate-limited: the platform's problem, not the student's.
  const evidence = { github: { unavailable: true, note: 'GitHub rate-limited this check. It stays pending — try again shortly.' } };
  const { proofRequirements } = runVerification(planWith({ frontend: 'react' }), evidence);
  const repo = proofRequirements.find((p) => p.type === 'github_repo');
  assert.equal(repo.status, 'pending');
  assert.notEqual(repo.status, 'failed');
  assert.match(repo.verificationNote, /rate-limited/);
});

test('a hosting failure page does not verify the deployment', () => {
  // The v6 bug: a Vercel 404 is HTTP 200 with real HTML and passed the old
  // `body.length > 400` check.
  const evidence = { deployment: { checked: true, unavailable: false, reachable: false, failureNote: 'Vercel reports that this deployment does not exist.', note: 'Vercel reports that this deployment does not exist.' } };
  const { proofRequirements } = runVerification(planWith({ frontend: 'react' }), evidence);
  const dep = proofRequirements.find((p) => p.type === 'deployed_url');
  assert.equal(dep.status, 'pending');
});

test('a reachable deployment verifies but does not claim the app works', () => {
  const evidence = { deployment: { checked: true, unavailable: false, reachable: true, statusCode: 200, note: 'Reachable at https://x.vercel.app (HTTP 200, 120ms).' } };
  const { proofRequirements } = runVerification(planWith({ frontend: 'react' }), evidence);
  const dep = proofRequirements.find((p) => p.type === 'deployed_url');
  assert.equal(dep.status, 'verified');
  assert.match(dep.verificationNote, /does not execute/i);
});

test('pasted tests are self_reported; a green CI run is verified', () => {
  const paste = { tests: parseTestOutput('Tests:       5 passed, 5 total\nTest Suites: 1 passed, 1 total\nTime: 1s') };
  let out = runVerification(planWith({ frontend: 'react' }), paste);
  let t = out.proofRequirements.find((p) => p.type === 'tests_passing');
  assert.equal(t.status, 'self_reported');

  const ci = { ...paste, ci: { checked: true, unavailable: false, present: true, note: 'CI run passed on main (abc1234).' } };
  out = runVerification(planWith({ frontend: 'react' }), ci);
  t = out.proofRequirements.find((p) => p.type === 'tests_passing');
  assert.equal(t.status, 'verified');
});

test('screenshots need both count and a README embed', () => {
  const notEmbedded = { github: { present: true, hasSource: true, note: 'ok' }, screenshots: { checked: true, unavailable: false, present: true, count: 3, enough: true, embedded: false, note: 'none embedded in the README' } };
  let out = runVerification(planWith({ frontend: 'react' }), notEmbedded);
  assert.equal(out.proofRequirements.find((p) => p.type === 'screenshots').status, 'pending');

  const good = { ...notEmbedded, screenshots: { ...notEmbedded.screenshots, embedded: true, note: '3 screenshots and 1 embedded.' } };
  out = runVerification(planWith({ frontend: 'react' }), good);
  assert.equal(out.proofRequirements.find((p) => p.type === 'screenshots').status, 'verified');
});

test('a README-only repo does not verify as a project', () => {
  const evidence = { github: { present: true, hasSource: false, size: 4, fullName: 'a/b', note: 'ok' } };
  const { proofRequirements } = runVerification(planWith({ frontend: 'react' }), evidence);
  assert.equal(proofRequirements.find((p) => p.type === 'github_repo').status, 'pending');
});

test('self-reported evidence counts toward completion but is reported separately', () => {
  const evidence = {
    github: { present: true, hasSource: true, note: 'ok' },
    readme: { checked: true, present: true, meaningful: true, imageRefs: 1, note: 'good' },
    screenshots: { checked: true, present: true, count: 2, enough: true, embedded: true, note: 'good' },
    deployment: { checked: true, reachable: true, statusCode: 200, note: 'ok' },
    tests: parseTestOutput('  9 passing (100ms)\n\nDone in 1.0s, everything green across the suite.'),
  };
  const { verificationSummary } = runVerification(planWith({ frontend: 'react' }), evidence);
  assert.equal(verificationSummary.requiredPending, 0);
  assert.equal(verificationSummary.complete, true);
  // ...but the self-claim is never folded into the verified count.
  assert.equal(verificationSummary.selfReportedItems, 1);
  assert.ok(verificationSummary.verifiedItems >= 4);
});

test('not_applicable items are excluded from pending counts', () => {
  const { verificationSummary } = runVerification(planWith({}), null);
  assert.equal(verificationSummary.notApplicableItems, 2);
  assert.ok(!verificationSummary.checks.some((c) => c.result === 'failed'));
});

test('no proof item can ever be marked failed', () => {
  for (const ev of [null, {}, { github: { unavailable: true } }, { deployment: { reachable: false, note: 'x' } }]) {
    const { proofRequirements } = runVerification(planWith({ frontend: 'react' }), ev);
    assert.ok(proofRequirements.every((p) => p.status !== 'failed'));
  }
});

/* ---------------- serverless wall-clock budget ---------------- */

test('a verification run is bounded by its budget and reports honestly', async () => {
  // Serverless platforms kill a function at a fixed limit and the caller gets a
  // 504 with no explanation. We must stop first and return `unavailable`, which
  // the validator renders as `pending` — never a failure the student caused.
  process.env.PROOF_VERIFY_BUDGET_MS = '1200';
  const mod = await import('../server/utils/workspace/proofVerification.js?budget=1');
  const t0 = Date.now();
  // 10.0.0.9 is blocked by the SSRF guard and returns fast; the GitHub call
  // against a non-existent repo is the slow half.
  const ev = await mod.gatherProofEvidence({ repoUrl: 'https://github.com/a/b', liveUrl: 'https://10.0.0.9/' });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 6000, `run should be bounded, took ${elapsed}ms`);
  assert.equal(ev.deployment.reachable, false);
  delete process.env.PROOF_VERIFY_BUDGET_MS;
});

test('vercel config sets an explicit function duration', async () => {
  // The legacy `builds` array is mutually exclusive with `functions`, so a
  // config using it silently cannot raise maxDuration past the default.
  const fs = await import('node:fs');
  const cfg = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(cfg.builds, undefined, 'legacy builds blocks the functions config');
  assert.ok(cfg.functions['api/index.js'].maxDuration >= 30);
});
