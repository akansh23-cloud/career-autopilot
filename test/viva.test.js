// Tests for the live comprehension viva — the top verification tier.
//   Engine: code-grounded probe generation (answer keys server-side), honest
//   deterministic scoring, anti-cheat (paste-speed / over-budget) blocking.
//   Routes: eligibility gating on verified authorship, start, and submit ->
//   a PASS mints a HIGH-confidence assessment_passed credential that verifies.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import viva from '../server/utils/vivaEngine.js';
import store from '../server/utils/vivaSessionStore.js';
import cred from '../server/utils/verificationCredentialEngine.js';

const PRIOR = process.env.VERIFICATION_SIGNING_KEY;
before(() => { process.env.VERIFICATION_SIGNING_KEY = 'unit-test-signing-key-0123456789'; });
after(() => { if (PRIOR === undefined) delete process.env.VERIFICATION_SIGNING_KEY; else process.env.VERIFICATION_SIGNING_KEY = PRIOR; });

const FILES = {
  'src/auth.js': "import jwt from 'jsonwebtoken';\nexport function signToken(userId, role) { return jwt.sign({ userId, role }, process.env.SECRET); }",
  'src/hash.py': "import hashlib\ndef digest(payload, salt):\n    return hashlib.sha256((payload + salt).encode()).hexdigest()",
};

function goodAnswers(probes) {
  const a = {};
  for (const p of probes) {
    let text = '';
    if (p.kind === 'import') text = p.file.includes('auth') ? 'jsonwebtoken' : 'hashlib';
    else if (p.kind === 'fn_arity') text = '2';
    else if (p.kind === 'fn_explain') text = (p.prompt.match(/`(\w+)`/)?.[1] || 'func') + ' processes the first argument to produce a result for the caller';
    else if (p.kind === 'add_guard') text = 'function signToken(userId, role){ if(!userId) return null; return jwt.sign({userId, role}); }';
    a[p.id] = { text, timingMs: p.minMs + 6000 };
  }
  return a;
}

/* ---------------- ENGINE ---------------- */

test('probes are generated from the candidate own code, answer keys stay server-side', () => {
  const probes = viva.generateVivaProbes(FILES, { seed: 's1' });
  assert.ok(probes.length >= viva.MIN_PROBES);
  assert.equal(viva.publicProbe(probes[0]).answerKey, undefined);
  // generation is deterministic for a fixed seed
  const again = viva.generateVivaProbes(FILES, { seed: 's1' });
  assert.deepEqual(probes.map((p) => p.prompt), again.map((p) => p.prompt));
});

test('a genuine session scores well and passes', () => {
  const probes = viva.generateVivaProbes(FILES, { seed: 's2' });
  const r = viva.scoreVivaSession(probes, goodAnswers(probes), { totalElapsedMs: 300000 });
  assert.ok(r.comprehensionScore >= viva.PASS_THRESHOLD);
  assert.equal(r.passed, true);
  assert.deepEqual(r.sessionFlags, []);
});

test('paste-speed answers are blocked even when textually correct', () => {
  const probes = viva.generateVivaProbes(FILES, { seed: 's3' });
  const fast = goodAnswers(probes);
  for (const id of Object.keys(fast)) fast[id].timingMs = 700; // implausibly fast
  const r = viva.scoreVivaSession(probes, fast, { totalElapsedMs: 20000 });
  assert.equal(r.blocked, true);
  assert.equal(r.passed, false);
  assert.ok(r.sessionFlags.includes('many_fast_answers'));
});

test('an empty/incomplete session cannot pass', () => {
  const probes = viva.generateVivaProbes(FILES, { seed: 's4' });
  const r = viva.scoreVivaSession(probes, {});
  assert.equal(r.passed, false);
  assert.ok(r.sessionFlags.includes('incomplete'));
});

test('over the time budget blocks a pass', () => {
  const probes = viva.generateVivaProbes(FILES, { seed: 's5' });
  const r = viva.scoreVivaSession(probes, goodAnswers(probes), { totalElapsedMs: viva.SESSION_BUDGET_MS + 1 });
  assert.ok(r.sessionFlags.includes('over_time_budget'));
  assert.equal(r.passed, false);
});

test('scoring is deterministic for identical inputs', () => {
  const probes = viva.generateVivaProbes(FILES, { seed: 's6' });
  const a = goodAnswers(probes);
  assert.equal(viva.scoreVivaSession(probes, a).comprehensionScore, viva.scoreVivaSession(probes, a).comprehensionScore);
});

/* ---------------- STORE + CREDENTIAL CHAIN ---------------- */

test('session store strips nothing server-side and round-trips probes', () => {
  const probes = viva.generateVivaProbes(FILES, { seed: 's7' });
  const s = store.createSession({ userId: 'u1', repoFullName: 'kamal/app', probes, skills: ['Node.js'] });
  const got = store.getSession(s.sessionId);
  assert.ok(got);
  assert.equal(got.probes.length, probes.length);
  assert.ok(got.probes[0].answerKey !== undefined); // keys retained server-side for scoring
});

test('a passed viva yields a HIGH-confidence assessment credential that verifies', () => {
  const probes = viva.generateVivaProbes(FILES, { seed: 's8' });
  const r = viva.scoreVivaSession(probes, goodAnswers(probes), { totalElapsedMs: 300000 });
  assert.equal(r.passed, true);
  const c = cred.issueCredential({
    subject: 'u1', claim: 'Node.js', method: 'assessment_passed', confidence: 'high',
    evidence: { signal: 'live_viva', score: r.comprehensionScore }, issuedAt: '2026-06-17T00:00:00.000Z', validityDays: 365,
  });
  assert.equal(c.confidence, 'high');
  assert.equal(cred.verifyCredential(c).valid, true);
  assert.ok(c.expiresAt); // assessment proof decays
});
