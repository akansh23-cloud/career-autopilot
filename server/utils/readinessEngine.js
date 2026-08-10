/* ============================================================
   READINESS ENGINE  (deterministic; VERIFIED data only)
   ------------------------------------------------------------
   Computes a candidate's placement readiness using ONLY verified skills,
   verified projects, and (optionally) a resume score. Pending/unverified
   signals never count. Categories:
     Not Ready / Needs Improvement / Apply Ready / Interview Ready / Placement Ready
   ============================================================ */
export const READINESS_VERSION = 'readiness-v1';
export const READINESS_CATEGORIES = ['Not Ready', 'Needs Improvement', 'Apply Ready', 'Interview Ready', 'Placement Ready'];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n);

/* Inputs are already-verified aggregates from the XP ledger + submissions. */
export function computeReadiness({
  verifiedSkills = [],
  totalVerifiedXp = 0,
  verifiedProjectCount = 0,
  recruiterReadyProjectCount = 0,
  resumeScore = null, // 0-100 or null
} = {}) {
  const skillCount = verifiedSkills.length;

  // Component scores (0-100), all from verified signals.
  const skillsScore = clamp(round((skillCount / 8) * 100), 0, 100);          // ~8 verified skills = full
  const xpScore = clamp(round((totalVerifiedXp / 1500) * 100), 0, 100);      // 1500 XP = full
  const projectScore = clamp(round((verifiedProjectCount / 4) * 100), 0, 100); // 4 verified projects = full
  const recruiterScore = clamp(round((recruiterReadyProjectCount / 2) * 100), 0, 100);
  const resumeComp = resumeScore == null ? null : clamp(round(resumeScore), 0, 100);

  // Weighted blend. Resume is optional; weights renormalize without it.
  const parts = [
    ['skills', skillsScore, 0.28],
    ['xp', xpScore, 0.17],
    ['projects', projectScore, 0.27],
    ['recruiterReady', recruiterScore, 0.13],
    ['resume', resumeComp, 0.15],
  ].filter(([, v]) => v != null);
  const wsum = parts.reduce((a, [, , w]) => a + w, 0);
  const score = clamp(round(parts.reduce((a, [, v, w]) => a + v * w, 0) / wsum), 0, 100);

  // Category: gated by hard verified minimums, not just the blended number.
  let category;
  if (skillCount === 0 && verifiedProjectCount === 0) category = 'Not Ready';
  else if (score >= 80 && verifiedProjectCount >= 2 && skillCount >= 5) category = 'Placement Ready';
  else if (score >= 65 && verifiedProjectCount >= 1 && skillCount >= 4) category = 'Interview Ready';
  else if (score >= 45 && skillCount >= 2) category = 'Apply Ready';
  else category = 'Needs Improvement';

  const gaps = [];
  if (skillCount < 4) gaps.push(`Verify more skills with proof (currently ${skillCount}; aim for 4+).`);
  if (verifiedProjectCount < 2) gaps.push(`Submit and verify more projects (currently ${verifiedProjectCount}; aim for 2+).`);
  if (recruiterReadyProjectCount < 1) gaps.push('Get at least one project to recruiter-ready (verified proof + live/GitHub).');
  if (resumeComp != null && resumeComp < 70) gaps.push(`Raise resume score (currently ${resumeComp}/100).`);
  if (totalVerifiedXp < 300) gaps.push('Earn more verified XP by completing and proving projects.');

  return {
    score,
    category,
    components: { skillsScore, xpScore, projectScore, recruiterScore, resumeScore: resumeComp },
    counts: { verifiedSkills: skillCount, totalVerifiedXp, verifiedProjectCount, recruiterReadyProjectCount },
    gaps,
    readinessVersion: READINESS_VERSION,
  };
}

export default { computeReadiness, READINESS_CATEGORIES, READINESS_VERSION };

/* ============================================================
   READINESS V2 — TARGET-ROLE SPECIFIC  (readiness-v2; additive)
   ------------------------------------------------------------
   Role-dimension readiness computed from the SAME verified-first
   signals as v1, sliced against the role's weighted skill buckets
   (utils/resume/roleDictionaries.js — the canonical role source).

   Honesty rules carried over from v1:
   - verified evidence moves a dimension fully; resume/claimed
     mentions move it a little (they are signals, not proof);
   - every dimension explains WHICH evidence produced its score;
   - the output names the single highest-impact action, computed
     from weight × gap, never from vibes;
   - v1 remains untouched — colleges/recruiters keep their number.
   ============================================================ */
import { resolveDictionary, SKILL_ALIASES } from './resume/roleDictionaries.js';

const _lc = (s) => String(s || '').toLowerCase().trim();

/* skill matcher: exact, alias, or word-boundary containment. */
function skillMatches(target, candidates) {
  const t = _lc(target);
  if (!t) return false;
  const aliases = [t, ...(SKILL_ALIASES[t] || [])];
  return candidates.some((c) => {
    const x = _lc(c);
    return aliases.some((a) => x === a || (a.length > 2 && (x.includes(a) || a.includes(x))));
  });
}

const DIMENSION_WEIGHTS = { mustHave: 3, goodToHave: 1.5, tools: 1, cloud: 1, languages: 1.5, databases: 1, testing: 1.25 };
const DIMENSION_LABELS = {
  mustHave: 'Core role skills', goodToHave: 'Differentiators', tools: 'Tooling',
  cloud: 'Cloud', languages: 'Languages & frameworks', databases: 'Databases', testing: 'Testing & quality',
};

/* Per-skill evidence level → contribution (0..1). Verified proof is the
   only thing that scores a skill fully. */
function skillContribution(skill, sig) {
  if (skillMatches(skill, sig.verifiedSkills)) return { level: 'verified', value: 1 };
  if (skillMatches(skill, sig.provenSkills)) return { level: 'github_proven', value: 0.7 };
  if (skillMatches(skill, sig.resumeSkills)) return { level: 'resume_claimed', value: 0.3 };
  if (skillMatches(skill, sig.claimedSkills)) return { level: 'declared', value: 0.2 };
  return { level: 'missing', value: 0 };
}

export function computeRoleReadiness({
  targetRole = '',
  verifiedSkills = [],
  provenSkills = [],       // GitHub-analysis detected skills (artifact proof)
  claimedSkills = [],      // profile-declared
  resumeSkills = [],       // present on the resume
  verifiedProjectCount = 0,
  recruiterReadyProjectCount = 0,
  resumeScore = null,
  assessmentPassedSkills = [], // viva/assessment (highest confidence)
} = {}) {
  const role = String(targetRole || '').trim() || 'Software Engineer';
  const resolved = resolveDictionary(role);
  const dict = resolved.dict;
  const sig = {
    verifiedSkills: [...verifiedSkills, ...assessmentPassedSkills],
    provenSkills, claimedSkills, resumeSkills,
  };

  const dimensions = [];
  for (const [bucket, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    const skills = Array.isArray(dict[bucket]) ? dict[bucket] : [];
    if (!skills.length) continue;
    const detail = skills.map((s) => ({ skill: s, ...skillContribution(s, sig) }));
    const raw = detail.reduce((a, d) => a + d.value, 0) / skills.length;
    const verified = detail.filter((d) => d.level === 'verified');
    const missing = detail.filter((d) => d.level === 'missing');
    const unproven = detail.filter((d) => d.level === 'resume_claimed' || d.level === 'declared');
    dimensions.push({
      id: bucket, label: DIMENSION_LABELS[bucket] || bucket, weight,
      score: Math.round(raw * 100),
      verifiedCount: verified.length, totalSkills: skills.length,
      evidence: {
        verified: verified.map((d) => d.skill),
        githubProven: detail.filter((d) => d.level === 'github_proven').map((d) => d.skill),
        claimedUnproven: unproven.map((d) => d.skill),
        missing: missing.map((d) => d.skill),
      },
    });
  }

  /* Evidence dimensions — same verified-only project/resume signals as v1,
     surfaced as their own explainable rows. */
  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  dimensions.push({
    id: 'projectEvidence', label: 'Project evidence', weight: 2,
    score: Math.round(clamp01(verifiedProjectCount / 3) * 100),
    verifiedCount: verifiedProjectCount, totalSkills: 3,
    evidence: { note: `${verifiedProjectCount} verified project(s); ${recruiterReadyProjectCount} recruiter-ready. 3 verified projects = full.` },
  });
  if (resumeScore != null) {
    dimensions.push({
      id: 'resumeEvidence', label: 'Resume evidence', weight: 1.5,
      score: Math.max(0, Math.min(100, Math.round(resumeScore))),
      evidence: { note: `Deterministic resume score for ${role}.` },
    });
  }

  const wsum = dimensions.reduce((a, d) => a + d.weight, 0);
  const score = Math.round(dimensions.reduce((a, d) => a + d.score * d.weight, 0) / (wsum || 1));

  /* Highest-impact actions: weight × gap, tie-broken toward mustHave.
     Each names the exact missing/unproven skills so the CTA can route into
     the project recommender with real gap data. */
  const actions = dimensions
    .filter((d) => d.evidence && (d.evidence.missing?.length || d.evidence.claimedUnproven?.length))
    .map((d) => {
      const focus = (d.evidence.missing || []).concat(d.evidence.claimedUnproven || []).slice(0, 3);
      const impact = Math.round(((100 - d.score) / 100) * d.weight * 10);
      const verb = d.evidence.missing?.length ? 'Build verified evidence for' : 'Prove your claimed';
      return {
        dimensionId: d.id, dimension: d.label, impact,
        skills: focus,
        title: `${verb} ${focus.join(', ')}`,
        why: `${d.label} is at ${d.score}% for ${role}${d.evidence.missing?.length ? ` — no evidence at all for ${d.evidence.missing[0]}` : ` — claimed but unverified: ${d.evidence.claimedUnproven[0]}`}.`,
      };
    })
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 4);

  return {
    readinessVersion: 'readiness-v2',
    targetRole: resolved.name,
    knownRole: !!resolved.known,
    score,
    dimensions: dimensions.map(({ weight, ...d }) => ({ ...d, weight })),
    topActions: actions,
    inputsUsed: {
      verifiedSkills: verifiedSkills.length, githubProvenSkills: provenSkills.length,
      claimedSkills: claimedSkills.length, resumeSkills: resumeSkills.length,
      verifiedProjectCount, recruiterReadyProjectCount, resumeScore,
    },
  };
}

/* Delta attribution: explain why readiness moved between two snapshots.
   Deterministic diff over dimensions + inputs; never invents a cause. */
export function explainReadinessChange(prev = null, next = null) {
  if (!prev || !next) return { hasBaseline: !!next, delta: null, reasons: [] };
  const delta = (next.score ?? 0) - (prev.score ?? 0);
  const prevDims = new Map((prev.dimensions || []).map((d) => [d.id, d]));
  const reasons = [];
  for (const d of next.dimensions || []) {
    const p = prevDims.get(d.id);
    if (!p) continue;
    const dd = d.score - p.score;
    if (dd === 0) continue;
    const gained = (d.evidence?.verified || []).filter((s) => !(p.evidence?.verified || []).includes(s));
    reasons.push({
      dimension: d.label, change: dd,
      detail: gained.length ? `Verified: ${gained.slice(0, 3).join(', ')}` : dd > 0 ? 'Evidence improved' : 'Evidence decreased',
    });
  }
  const pi = prev.inputsUsed || {}; const ni = next.inputsUsed || {};
  if ((ni.verifiedProjectCount ?? 0) !== (pi.verifiedProjectCount ?? 0)) {
    reasons.push({ dimension: 'Project evidence', change: null, detail: `Verified projects: ${pi.verifiedProjectCount ?? 0} → ${ni.verifiedProjectCount ?? 0}` });
  }
  reasons.sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));
  return { hasBaseline: true, delta, reasons: reasons.slice(0, 5) };
}
