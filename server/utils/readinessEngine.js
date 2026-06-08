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
