// Client helpers for the verification-credential layer (recruiter trust).
// Signed credentials are minted server-side with an Ed25519 key; the client
// only ever displays public-safe views and asks the server (or anyone holding
// the public key) to RE-VERIFY them. No signing material is on the client.
import { api } from './api.js';

export const Verification = {
  methods: () => api.get('/api/verification/methods'),
  publicKey: () => api.get('/api/verification/public-key'),
  // Pass one credential (+ optional original evidence) or a credentials array.
  verify: (payload) => api.post('/api/verification/verify-credential', payload),
  revoke: (credentialId, reason) => api.post('/api/verification/revoke', { credentialId, reason }),
};

/* Confidence -> how a recruiter should read it. HIGH is reserved for
   human-/assessment-corroborated proof (a live viva or reviewer), not artifacts. */
export const CONFIDENCE_META = {
  high:   { label: 'Verified', tone: 'mint',    rank: 3, blurb: 'Corroborated by a live viva/assessment or human review.' },
  medium: { label: 'Evidenced', tone: 'cyan',   rank: 2, blurb: 'Backed by authored code or a verified deployment (artifact-level).' },
  low:    { label: 'Self-reported', tone: 'default', rank: 1, blurb: 'Claimed but not independently verified.' },
  none:   { label: 'Unverified', tone: 'default', rank: 0, blurb: '' },
};
export function confidenceMeta(confidence) { return CONFIDENCE_META[confidence] || CONFIDENCE_META.none; }

/* Only medium+ counts toward recruiter-facing verified totals (server enforces too). */
export function isCountable(confidence) { return confidenceMeta(confidence).rank >= 2; }

export const METHOD_LABELS = {
  assessment_passed: 'Live viva / assessment passed',
  admin_reviewed: 'Human-reviewed',
  github_commit_authored: 'Authored in a verified repo (attributed)',
  github_contributor: 'Contributor to a verified repo',
  live_demo_verified: 'Live demo verified',
  github_repo_detected: 'Detected in a verified repo',
  self_claim: 'Self-reported',
};
export function methodLabel(method) { return METHOD_LABELS[method] || method || 'Unverified'; }

/* methodKind -> whether this is recruiter-grade (human/assessment) or artifact. */
export function isHumanGrade(methodKind) { return methodKind === 'human' || methodKind === 'assessment'; }

export function credentialLine(c = {}) {
  const m = confidenceMeta(c.confidence);
  return `${c.claim} · ${m.label} · ${methodLabel(c.method)}`;
}

export function summarize(credentials = []) {
  const list = Array.isArray(credentials) ? credentials : [];
  const countable = list.filter((c) => isCountable(c.confidence));
  const human = countable.filter((c) => isHumanGrade(c.methodKind) || c.confidence === 'high');
  return {
    total: list.length,
    countable: countable.length,
    human: human.length,
    verifiedSkills: countable.filter((c) => (c.claimType || 'skill') === 'skill').map((c) => c.claim),
    hasHumanVerified: human.length > 0,
  };
}
