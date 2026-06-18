/* ============================================================
   VERIFICATION CREDENTIAL ENGINE  (recruiter-trust core, v2)
   ------------------------------------------------------------
   A green checkmark is only worth something to an outside recruiter if:
     (a) they can verify it WITHOUT trusting our server — i.e. asymmetric
         signatures they check against a published public key, and CANNOT forge;
     (b) the confidence label means what they think it means — so the method
         ceiling is honest about what was actually proven;
     (c) it can be revoked and can expire — a credential later found fraudulent
         must be killable, and stale proof must decay.

   v2 changes vs v1:
     - Ed25519 asymmetric signatures (was HMAC). Verifiable offline by anyone
       holding the public key; the private key never leaves the server. This is
       W3C-Verifiable-Credentials-aligned and is the difference between "trust
       our API" and "trust the math".
     - HONEST ceilings: GitHub commit attribution is NOT proof of authorship or
       competence (emails are user-set, history is rewritable, code can be
       copied or AI-generated). So github_commit_authored now caps at MEDIUM.
       HIGH confidence requires a corroborating human/assessment signal
       (assessment_passed or admin_reviewed) — e.g. a live comprehension viva.
     - Issuer identity, expiry (expiresAt), and a revocation registry.

   Deterministic. No AI. AI may never mint, upgrade, revoke, or alter a credential.
   ============================================================ */
import crypto from 'crypto';

export const CREDENTIAL_VERSION = 'cred-v2';
export const ALG = 'EdDSA';
export const DEFAULT_ISSUER = process.env.VERIFICATION_ISSUER || 'career-autopilot';

/* ------------------------------------------------------------------
   METHOD TAXONOMY  (with HONEST confidence ceilings)
   The ceiling caps how much a credential minted by this method may claim.
   ------------------------------------------------------------------ */
export const METHODS = {
  // HIGH requires a human or a timed/proctored signal — something that is hard
  // to fake and that tests understanding, not just artifact possession.
  admin_reviewed:         { label: 'Human reviewer verified', ceiling: 'high', authorship: true, kind: 'human' },
  assessment_passed:      { label: 'Proctored assessment / live viva passed', ceiling: 'high', authorship: true, kind: 'assessment' },

  // MEDIUM: real, objective evidence — but artifact-level, so gameable in
  // principle. Worth showing; not worth calling "verified competence".
  github_commit_authored: { label: 'Authored in a verified repository (commit-attributed)', ceiling: 'medium', authorship: true, kind: 'artifact' },
  github_contributor:     { label: 'Contributor to a verified repository', ceiling: 'medium', authorship: true, kind: 'artifact' },
  live_demo_verified:     { label: 'Live deployment verified reachable', ceiling: 'medium', authorship: false, kind: 'artifact' },
  github_repo_detected:   { label: 'Detected in a verified repository (authorship unconfirmed)', ceiling: 'medium', authorship: false, kind: 'artifact' },

  // LOW: claimed only. Never counts toward verified totals.
  self_claim:             { label: 'Self-reported (unverified)', ceiling: 'low', authorship: false, kind: 'claim' },
};

export const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1, none: 0 };

export function methodCeiling(method) { return (METHODS[method] && METHODS[method].ceiling) || 'low'; }
export function clampConfidence(method, requested = 'medium') {
  const ceil = methodCeiling(method);
  const want = CONFIDENCE_RANK[requested] != null ? requested : 'low';
  return CONFIDENCE_RANK[want] <= CONFIDENCE_RANK[ceil] ? want : ceil;
}
/* Only medium+ counts toward recruiter-facing verified totals. */
export function isCountable(confidence) { return CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK.medium; }

/* ------------------------------------------------------------------
   KEYS  (Ed25519, asymmetric)
   Private key precedence:
     1. VERIFICATION_ED25519_PRIVATE_KEY (PEM, PKCS8) — production.
     2. Deterministically derived from VERIFICATION_SIGNING_KEY || SESSION_SECRET
        so dev/test/self-host get stable, verifiable keys with zero setup.
   The public key is publishable; the private key never leaves the server.
   ------------------------------------------------------------------ */
let _cachedKey = null;     // { priv, pub, kid } or null
let _cachedFrom = '';      // material the cache was built from (for invalidation)

function keyMaterial() {
  return process.env.VERIFICATION_ED25519_PRIVATE_KEY
    || process.env.VERIFICATION_SIGNING_KEY
    || process.env.SESSION_SECRET
    || '';
}

function loadKeys() {
  const material = keyMaterial();
  if (!material) { _cachedKey = null; _cachedFrom = ''; return null; }
  if (_cachedKey && _cachedFrom === material) return _cachedKey;

  let priv;
  if (material.includes('BEGIN') && material.includes('PRIVATE KEY')) {
    priv = crypto.createPrivateKey({ key: material, format: 'pem', type: 'pkcs8' });
  } else {
    // Deterministic seed -> Ed25519 PKCS8 (fixed DER prefix + 32-byte seed).
    const seed = crypto.createHash('sha256').update('ed25519-seed:' + material).digest();
    const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
    priv = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  }
  const pub = crypto.createPublicKey(priv);
  // kid is a short, public, non-reversible fingerprint of the PUBLIC key.
  const spki = pub.export({ format: 'der', type: 'spki' });
  const kid = crypto.createHash('sha256').update(spki).digest('hex').slice(0, 16);
  _cachedKey = { priv, pub, kid };
  _cachedFrom = material;
  return _cachedKey;
}

export function signingConfigured() { return !!loadKeys(); }
export function keyId() { const k = loadKeys(); return k ? k.kid : 'none'; }

export function publicKeyJwk() {
  const k = loadKeys();
  if (!k) return null;
  const jwk = k.pub.export({ format: 'jwk' });
  return { ...jwk, kid: k.kid, alg: ALG, use: 'sig' };
}
export function publicKeyPem() {
  const k = loadKeys();
  return k ? k.pub.export({ format: 'pem', type: 'spki' }).toString() : null;
}

/* Stable key-sorted JSON so the same logical object always signs to the same
   bytes regardless of property order. */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}
export function evidenceHash(evidence = {}) {
  return crypto.createHash('sha256').update(canonicalize(evidence)).digest('hex');
}
/* One-way subject binding: proves WHICH subject a credential is about without
   the public view revealing the raw user id/email. */
export function subjectHash(subject = '') {
  return crypto.createHash('sha256').update('subj:' + String(subject || '')).digest('hex');
}

/* The signed core — exactly the fields a verifier recomputes. Everything else
   (display labels, raw subject) is untrusted and unsigned. */
function signedCore(c) {
  return {
    v: c.v, alg: c.alg, issuer: c.issuer, kid: c.kid,
    credentialId: c.credentialId,
    subjectHash: c.subjectHash,
    claim: c.claim, claimType: c.claimType,
    method: c.method, confidence: c.confidence,
    evidenceHash: c.evidenceHash,
    issuedAt: c.issuedAt, expiresAt: c.expiresAt || null,
  };
}

export function signMessage(message) {
  const k = loadKeys();
  if (!k) return '';
  return crypto.sign(null, Buffer.from(message), k.priv).toString('base64url');
}
export function verifyMessage(message, signatureB64url) {
  const k = loadKeys();
  if (!k || !signatureB64url) return false;
  try { return crypto.verify(null, Buffer.from(message), k.pub, Buffer.from(signatureB64url, 'base64url')); }
  catch { return false; }
}

function deriveCredentialId(partial) {
  const basis = canonicalize({
    subjectHash: partial.subjectHash, claim: partial.claim, claimType: partial.claimType,
    method: partial.method, evidenceHash: partial.evidenceHash, issuedAt: partial.issuedAt,
  });
  return 'cred_' + crypto.createHash('sha256').update(basis).digest('hex').slice(0, 24);
}

/* ------------------------------------------------------------------
   REVOCATION REGISTRY
   In-memory by default; production should back this with the DB via
   setRevocationStore(). verifyCredential consults it.
   ------------------------------------------------------------------ */
const _revoked = new Map(); // credentialId -> { at, reason }
let _store = null;          // optional { isRevoked(id), revoke(id, meta), list() }
export function setRevocationStore(store) { _store = store || null; }
export function revokeCredential(credentialId, reason = '') {
  const id = String(credentialId || ''); if (!id) return false;
  const meta = { at: new Date().toISOString(), reason: String(reason || '') };
  if (_store?.revoke) _store.revoke(id, meta); else _revoked.set(id, meta);
  return true;
}
export function isRevoked(credentialId) {
  const id = String(credentialId || ''); if (!id) return false;
  if (_store?.isRevoked) return !!_store.isRevoked(id);
  return _revoked.has(id);
}
export function listRevocations() {
  if (_store?.list) return _store.list();
  return Array.from(_revoked.entries()).map(([credentialId, meta]) => ({ credentialId, ...meta }));
}

/* ------------------------------------------------------------------
   ISSUE
   validityDays: optional expiry window. Skills default to no expiry (null);
   callers can pass a window for time-bounded proof (e.g. assessment scores).
   ------------------------------------------------------------------ */
export function issueCredential({
  subject, claim, claimType = 'skill', method = 'self_claim',
  confidence, evidence = {}, issuedAt = new Date().toISOString(),
  validityDays = null, issuer = DEFAULT_ISSUER,
} = {}) {
  const m = METHODS[method] ? method : 'self_claim';
  const conf = clampConfidence(m, confidence || methodCeiling(m));
  const eHash = evidenceHash(evidence);
  const sHash = subjectHash(subject);
  const expiresAt = (validityDays && Number(validityDays) > 0)
    ? new Date(new Date(issuedAt).getTime() + Number(validityDays) * 86400000).toISOString()
    : null;
  const partial = { subjectHash: sHash, claim: String(claim || ''), claimType: String(claimType || 'skill'), method: m, evidenceHash: eHash, issuedAt };
  const core = {
    v: CREDENTIAL_VERSION, alg: ALG, issuer, kid: keyId(),
    credentialId: deriveCredentialId(partial),
    subjectHash: sHash, claim: partial.claim, claimType: partial.claimType,
    method: m, confidence: conf, evidenceHash: eHash, issuedAt, expiresAt,
  };
  return {
    ...core,
    subject: String(subject || ''),       // unsigned, server-side only
    methodLabel: METHODS[m].label,
    methodKind: METHODS[m].kind,
    countable: isCountable(conf),
    signature: signMessage(canonicalize(signedCore(core))),
  };
}

/* ------------------------------------------------------------------
   VERIFY  (offline-capable with the public key)
   Returns { valid, tampered, expired, revoked, reason }. Never throws.
   ------------------------------------------------------------------ */
export function verifyCredential(credential = {}, opts = {}) {
  const { evidence, checkRevocation = true } = opts;
  const fail = (reason, extra = {}) => ({ valid: false, tampered: false, expired: false, revoked: false, reason, ...extra });

  if (!credential || typeof credential !== 'object') return fail('no_credential', { tampered: true });
  if (credential.v !== CREDENTIAL_VERSION) return fail('unknown_version');
  if (credential.alg && credential.alg !== ALG) return fail('unknown_alg');
  if (!signingConfigured()) return fail('signing_not_configured');

  // A confidence above the method ceiling is tampering, caught before crypto.
  if (CONFIDENCE_RANK[credential.confidence] > CONFIDENCE_RANK[methodCeiling(credential.method)]) {
    return fail('confidence_exceeds_method', { tampered: true });
  }
  // Key binding: a credential signed under a different (rotated) key can't be
  // confirmed here, but that's not tampering.
  if (credential.kid && credential.kid !== keyId()) return fail('key_mismatch');

  const ok = verifyMessage(canonicalize(signedCore(credential)), credential.signature);
  if (!ok) return fail('signature_mismatch', { tampered: true });

  if (evidence !== undefined && evidenceHash(evidence) !== credential.evidenceHash) {
    return fail('evidence_mismatch', { tampered: true });
  }
  if (credential.expiresAt && Date.now() > new Date(credential.expiresAt).getTime()) {
    return fail('expired', { expired: true });
  }
  if (checkRevocation && isRevoked(credential.credentialId)) {
    return fail('revoked', { revoked: true });
  }
  return { valid: true, tampered: false, expired: false, revoked: false, reason: 'ok' };
}

/* Recruiter-safe view: independently verifiable (keeps signature + kid + the
   signed fields) but never leaks the raw subject or any key material. */
export function credentialPublicView(c = {}) {
  return {
    v: c.v || CREDENTIAL_VERSION, alg: c.alg || ALG, issuer: c.issuer || DEFAULT_ISSUER, kid: c.kid || null,
    credentialId: c.credentialId || null,
    subjectHash: c.subjectHash || null,
    claim: c.claim || '', claimType: c.claimType || 'skill',
    method: c.method || 'self_claim',
    methodLabel: c.methodLabel || (METHODS[c.method]?.label) || '',
    methodKind: c.methodKind || (METHODS[c.method]?.kind) || 'claim',
    confidence: c.confidence || 'low',
    countable: !!isCountable(c.confidence),
    issuedAt: c.issuedAt || null, expiresAt: c.expiresAt || null,
    evidenceHash: c.evidenceHash || null,
    signature: c.signature || null,
  };
}

export function summarizeCredentials(credentials = []) {
  const list = Array.isArray(credentials) ? credentials : [];
  const byConfidence = { high: 0, medium: 0, low: 0 };
  const byMethod = {};
  let highestRank = 0, highest = 'none';
  for (const c of list) {
    const conf = c.confidence || 'low';
    if (byConfidence[conf] != null) byConfidence[conf] += 1;
    byMethod[c.method] = (byMethod[c.method] || 0) + 1;
    if (CONFIDENCE_RANK[conf] > highestRank) { highestRank = CONFIDENCE_RANK[conf]; highest = conf; }
  }
  const countable = list.filter((c) => isCountable(c.confidence));
  return {
    total: list.length,
    countable: countable.length,
    verifiedSkills: countable.filter((c) => (c.claimType || 'skill') === 'skill').map((c) => c.claim),
    byConfidence, byMethod,
    highestConfidence: highest,
    // "Human-verified" is the recruiter-grade tier: corroborated by a person or
    // a proctored assessment, not just an artifact.
    hasHumanVerified: list.some((c) => (METHODS[c.method]?.kind === 'human' || METHODS[c.method]?.kind === 'assessment') && isCountable(c.confidence)),
    hasAuthoredProof: list.some((c) => METHODS[c.method]?.authorship && isCountable(c.confidence)),
  };
}

export default {
  CREDENTIAL_VERSION, ALG, DEFAULT_ISSUER, METHODS, CONFIDENCE_RANK,
  methodCeiling, clampConfidence, isCountable,
  signingConfigured, keyId, publicKeyJwk, publicKeyPem,
  canonicalize, evidenceHash, subjectHash, signMessage, verifyMessage,
  issueCredential, verifyCredential, credentialPublicView, summarizeCredentials,
  setRevocationStore, revokeCredential, isRevoked, listRevocations,
};
