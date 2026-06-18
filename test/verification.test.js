// Tests for the recruiter-trust verification layer (v2):
//   1. verificationCredentialEngine — Ed25519 asymmetric signing, OFFLINE
//      third-party verification via the published public key, tamper/expiry/
//      revocation detection, honest confidence ceilings, deterministic ids.
//   2. githubIntegrationEngine.verifyRepoAuthorship — authored/contributor/
//      fork/unverified + risk flags (single-burst / shallow-history / fork).
//   3. skillVerificationEngine — description never verifies; GitHub authorship
//      tops out at MEDIUM; a passed assessment/viva is the route to HIGH.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import cred from '../server/utils/verificationCredentialEngine.js';
import gh from '../server/utils/githubIntegrationEngine.js';
import { verifyProjectSubmission } from '../server/utils/skillVerificationEngine.js';

const PRIOR = process.env.VERIFICATION_SIGNING_KEY;
before(() => { process.env.VERIFICATION_SIGNING_KEY = 'unit-test-signing-key-0123456789'; });
after(() => { if (PRIOR === undefined) delete process.env.VERIFICATION_SIGNING_KEY; else process.env.VERIFICATION_SIGNING_KEY = PRIOR; });

const T0 = '2026-06-17T00:00:00.000Z';

/* ============================ CREDENTIAL ENGINE ============================ */

test('issued credential is Ed25519-signed and verifies as authentic', () => {
  const c = cred.issueCredential({ subject: 'u1', claim: 'Kubernetes', method: 'github_commit_authored', evidence: { repo: 'kamal/app' }, issuedAt: T0 });
  assert.equal(c.alg, 'EdDSA');
  assert.ok(c.signature && c.signature.length > 0);
  const r = cred.verifyCredential(c);
  assert.equal(r.valid, true);
  assert.equal(r.reason, 'ok');
});

test('a recruiter can verify OFFLINE with only the published public key (no server trust)', () => {
  const c = cred.issueCredential({ subject: 'u1', claim: 'Go', method: 'github_commit_authored', evidence: { repo: 'x' }, issuedAt: T0 });
  const jwk = cred.publicKeyJwk();
  assert.equal(jwk.crv, 'Ed25519');
  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const core = cred.canonicalize({
    v: c.v, alg: c.alg, issuer: c.issuer, kid: c.kid, credentialId: c.credentialId,
    subjectHash: c.subjectHash, claim: c.claim, claimType: c.claimType, method: c.method,
    confidence: c.confidence, evidenceHash: c.evidenceHash, issuedAt: c.issuedAt, expiresAt: c.expiresAt || null,
  });
  assert.equal(crypto.verify(null, Buffer.from(core), pub, Buffer.from(c.signature, 'base64url')), true);
  // The same key CANNOT forge: signing requires the private key.
  assert.throws(() => crypto.sign(null, Buffer.from(core), pub));
});

test('HONEST ceilings: GitHub authorship caps at medium; only assessment/admin reach high', () => {
  assert.equal(cred.issueCredential({ subject: 'u', claim: 'A', method: 'github_commit_authored', confidence: 'high', evidence: {}, issuedAt: T0 }).confidence, 'medium');
  assert.equal(cred.issueCredential({ subject: 'u', claim: 'A', method: 'github_repo_detected', confidence: 'high', evidence: {}, issuedAt: T0 }).confidence, 'medium');
  assert.equal(cred.issueCredential({ subject: 'u', claim: 'A', method: 'self_claim', confidence: 'high', evidence: {}, issuedAt: T0 }).confidence, 'low');
  assert.equal(cred.issueCredential({ subject: 'u', claim: 'A', method: 'assessment_passed', evidence: {}, issuedAt: T0 }).confidence, 'high');
  assert.equal(cred.issueCredential({ subject: 'u', claim: 'A', method: 'admin_reviewed', evidence: {}, issuedAt: T0 }).confidence, 'high');
});

test('tampering (confidence bump or claim swap) is rejected', () => {
  const c = cred.issueCredential({ subject: 'u', claim: 'React', method: 'github_repo_detected', evidence: {}, issuedAt: T0 });
  assert.equal(cred.verifyCredential({ ...c, confidence: 'high' }).tampered, true);
  assert.equal(cred.verifyCredential({ ...c, claim: 'Rust' }).reason, 'signature_mismatch');
});

test('changed evidence is caught via the evidence hash', () => {
  const evidence = { repo: 'kamal/app', commits: 18 };
  const c = cred.issueCredential({ subject: 'u', claim: 'Go', method: 'github_commit_authored', evidence, issuedAt: T0 });
  assert.equal(cred.verifyCredential(c, { evidence }).valid, true);
  assert.equal(cred.verifyCredential(c, { evidence: { repo: 'kamal/app', commits: 1 } }).reason, 'evidence_mismatch');
});

test('expired credentials fail verification', () => {
  const c = cred.issueCredential({ subject: 'u', claim: 'X', method: 'assessment_passed', evidence: {}, issuedAt: '2020-01-01T00:00:00.000Z', validityDays: 30 });
  const r = cred.verifyCredential(c);
  assert.equal(r.valid, false);
  assert.equal(r.expired, true);
  assert.equal(r.reason, 'expired');
});

test('revoked credentials fail verification thereafter', () => {
  const c = cred.issueCredential({ subject: 'u', claim: 'Y', method: 'github_commit_authored', evidence: {}, issuedAt: T0 });
  assert.equal(cred.verifyCredential(c).valid, true);
  cred.revokeCredential(c.credentialId, 'plagiarism found');
  const r = cred.verifyCredential(c);
  assert.equal(r.valid, false);
  assert.equal(r.revoked, true);
});

test('credential id is deterministic for the same verified fact', () => {
  const args = { subject: 'u', claim: 'Java', method: 'admin_reviewed', evidence: { by: 'admin' }, issuedAt: T0 };
  assert.equal(cred.issueCredential(args).credentialId, cred.issueCredential(args).credentialId);
});

test('public view is verifiable but never leaks the raw subject', () => {
  const c = cred.issueCredential({ subject: 'secret-user@x.com', claim: 'Terraform', method: 'assessment_passed', evidence: { score: 0.9 }, issuedAt: T0 });
  const pub = cred.credentialPublicView(c);
  assert.equal(pub.subject, undefined);
  assert.ok(pub.subjectHash && pub.subjectHash.length === 64);
  assert.equal(cred.verifyCredential(pub).valid, true); // verifiable from the public view alone
});

test('summarize distinguishes human-verified from artifact-only', () => {
  const list = [
    cred.issueCredential({ subject: 'u', claim: 'Docker', method: 'github_commit_authored', evidence: {}, issuedAt: T0 }),
    cred.issueCredential({ subject: 'u', claim: 'K8s', method: 'assessment_passed', evidence: {}, issuedAt: T0 }),
    cred.issueCredential({ subject: 'u', claim: 'AWS', method: 'self_claim', evidence: {}, issuedAt: T0 }),
  ];
  const s = cred.summarizeCredentials(list);
  assert.equal(s.countable, 2);             // docker(medium) + k8s(high)
  assert.equal(s.hasHumanVerified, true);   // k8s via assessment
});

/* ============================ AUTHORSHIP ============================ */

test('owner with iterative history is authored with no risk flags', () => {
  const a = gh.verifyRepoAuthorship({ repo: { owner: 'kamal', fork: false }, commitSignals: { authorCounts: { kamal: 10 }, recentCommits: 10 }, identityHandle: 'Kamal' });
  assert.equal(a.classification, 'authored');
  assert.equal(a.riskFlags.length, 0);
  assert.equal(a.authorshipVerified, true);
});

test('a single-commit dump is flagged risky and not treated as verified authorship', () => {
  const a = gh.verifyRepoAuthorship({ repo: { owner: 'kamal', fork: false }, commitSignals: { authorCounts: { kamal: 1 }, recentCommits: 1 }, identityHandle: 'kamal' });
  assert.ok(a.riskFlags.includes('single_burst'));
  assert.equal(a.authorshipVerified, false); // looks like a paste, not authored work
});

test('a fork with no commits by the identity is not attributable', () => {
  const f = gh.verifyRepoAuthorship({ repo: { owner: 'someoneelse', fork: true }, commitSignals: { authorCounts: { someoneelse: 30 }, recentCommits: 30 }, identityHandle: 'kamal' });
  assert.equal(f.classification, 'fork');
  assert.equal(f.authorshipVerified, false);
});

test('no identity degrades to detected, never authored', () => {
  const u = gh.verifyRepoAuthorship({ repo: { owner: 'kamal' }, commitSignals: { authorCounts: { kamal: 5 }, recentCommits: 5 }, identityHandle: '' });
  assert.equal(u.classification, 'unverified');
  assert.equal(u.method, 'github_repo_detected');
});

test('authored repos add a bonus but proof contribution stays capped at 30', () => {
  const repos = Array.from({ length: 5 }, () => ({ score: 100, visibility: 'public', detectedSkills: ['A', 'B'], authorship: { authorshipVerified: true, classification: 'authored' } }));
  const out = gh.githubProofContribution({ identityConnected: true, appInstalled: true, analyzedRepos: repos });
  assert.ok(out.publicContribution <= out.cap);
  assert.equal(out.cap, 30);
});

/* ============================ SKILL VERIFICATION ============================ */

test('a skill mentioned only in the description is NOT verified', () => {
  const r = verifyProjectSubmission({ subjectId: 'u1', claimedSkills: ['Kubernetes'], description: 'I used Kubernetes a lot. '.repeat(10), complexityLevel: 'advanced' });
  assert.ok(!r.verifiedSkills.includes('kubernetes'));
  assert.ok(r.pendingSkills.includes('kubernetes'));
  assert.equal(r.credentials.length, 0);
});

test('GitHub-authored evidence verifies at MEDIUM (not high) with a valid credential', () => {
  const r = verifyProjectSubmission({
    subjectId: 'u1', claimedSkills: ['Docker'], githubUrl: 'https://github.com/kamal/app',
    githubAnalysis: { exists: true, detectedSkills: ['Docker'], repoFullName: 'kamal/app', authorship: { authorshipVerified: true, classification: 'authored', riskFlags: [] } },
    complexityLevel: 'advanced',
  });
  assert.ok(r.verifiedSkills.includes('docker'));
  assert.equal(r.skillProof.docker.confidence, 'medium');
  assert.equal(r.skillProof.docker.method, 'github_commit_authored');
  assert.equal(cred.verifyCredential(r.credentials[0]).valid, true);
});

test('a passed assessment/viva is the route to HIGH confidence', () => {
  const r = verifyProjectSubmission({
    subjectId: 'u1', claimedSkills: ['Docker'],
    githubUrl: 'https://github.com/kamal/app',
    githubAnalysis: { exists: true, detectedSkills: ['Docker'], repoFullName: 'kamal/app' },
    assessments: [{ skill: 'Docker', passed: true, kind: 'live_viva', score: 0.88 }],
    complexityLevel: 'advanced',
  });
  assert.equal(r.skillProof.docker.method, 'assessment_passed');
  assert.equal(r.skillProof.docker.confidence, 'high');
  assert.equal(r.verificationSummary.hasHumanVerified, true);
});

test('admin review verifies at high regardless of other signals', () => {
  const r = verifyProjectSubmission({ subjectId: 'u1', claimedSkills: ['System Design'], description: 'short' }, { skills: { 'system design': 'verified' }, reviewer: 'admin-1' });
  assert.equal(r.skillProof['system design'].confidence, 'high');
  assert.equal(r.skillProof['system design'].method, 'admin_reviewed');
});

test('pending and rejected skills never mint credentials', () => {
  const r = verifyProjectSubmission({ subjectId: 'u1', claimedSkills: ['Rust', 'COBOL'], description: 'mentions Rust and COBOL only' }, { skills: { cobol: 'rejected' } });
  assert.ok(r.rejectedSkills.includes('cobol'));
  assert.equal(r.credentials.length, 0);
});
