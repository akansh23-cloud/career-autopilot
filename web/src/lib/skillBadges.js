// Skill-badge presentation helpers — the single place that decides which
// badges are "strong/verified" vs "developing/practiced", so the dashboard,
// the Career Profile and the Skills & XP page all agree.
//
// Background: badges come from lib/badges.js (deriveBadges), each carrying a
// `level` (Practiced | Project Verified | GitHub Verified | Deployment Verified
// | Recruiter Ready) and a `confidence` (20–99). The dashboard previously
// rendered ALL of them — including 40%-confidence "Practiced" chips — which
// looked cluttered and untrustworthy.
//
// Pure module (no browser globals, no heavy imports) so it is unit-testable.

const LEVEL_ORDER = ['Practiced', 'Project Verified', 'GitHub Verified', 'Deployment Verified', 'Recruiter Ready'];
const RANK = Object.fromEntries(LEVEL_ORDER.map((l, i) => [l, i]));

export const STRONG_PROOF_MIN = 80;

// Words that don't change the underlying skill, so "CI/CD Integration" and
// "CI/CD" collapse to one chip instead of many near-duplicates.
const FILLER = new Set(['integration', 'development', 'engineering', 'engineer', 'developer', 'fundamentals', 'basics', 'pipeline', 'pipelines']);

// Canonical key used for de-duplication.
export function normalizeSkillName(name = '') {
  const cleaned = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const tokens = cleaned.split(' ');
  // Drop trailing filler words ("ci/cd integration" -> "ci/cd"), but never
  // reduce a name to nothing.
  while (tokens.length > 1 && FILLER.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

const proofOf = (b) => Number(b?.proofScore ?? b?.confidence ?? 0);
const levelRank = (b) => (RANK[b?.level] ?? 0);

// A badge is "strong/verified" when it has high proof OR a verified status,
// i.e. proofScore/confidence >= 80 OR its level is beyond plain "Practiced".
export function isStrongBadge(badge) {
  if (!badge) return false;
  if (badge.verificationStatus === 'verified') return true;
  if (proofOf(badge) >= STRONG_PROOF_MIN) return true;
  return levelRank(badge) > RANK.Practiced;
}

function sortStrong(a, b) {
  return levelRank(b) - levelRank(a) || proofOf(b) - proofOf(a);
}

// Collapse near-duplicate skills, keeping the single strongest badge per skill.
export function dedupeBadges(badges = []) {
  const best = new Map();
  for (const badge of badges) {
    if (!badge) continue;
    const key = normalizeSkillName(badge.skillName || badge.badgeName || '');
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || sortStrong(badge, prev) < 0) best.set(key, badge);
  }
  return [...best.values()];
}

// Split deduped badges into the two groups the UI cares about.
export function classifyBadges(badges = []) {
  const unique = dedupeBadges(badges);
  const verified = unique.filter(isStrongBadge).sort(sortStrong);
  const developing = unique.filter((b) => !isStrongBadge(b)).sort(sortStrong);
  return { verified, developing, all: unique };
}

// The strong badges to surface on the dashboard/profile, capped to a tidy count.
export function topVerifiedBadges(badges = [], limit = 16) {
  return classifyBadges(badges).verified.slice(0, Math.max(0, limit));
}
