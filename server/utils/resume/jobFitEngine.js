/* ============================================================
   JOB FIT ENGINE (deterministic)
   ------------------------------------------------------------
   Scores a resume against ONE parsed JD. Separate from the overall
   resume-quality score.

   Breakdown:
     Required skills match ...... 30
     Preferred skills match ..... 15
     Responsibility match ....... 20
     Experience level match ..... 10
     Domain/tool match .......... 10
     Keyword coverage ........... 10
     Risk / missing critical ... -15 max
   ============================================================ */
import { normalizeResumeText } from './normalizeResumeText.js';
import { sliceSections, detectExperienceLevel } from './sectionDetector.js';
import { presentSkills, skillPresent } from './skillMatcher.js';

const round = (n) => Math.round(n);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function cov(text, list) {
  if (!list || !list.length) return { matched: [], ratio: 1 };
  const matched = presentSkills(text, list);
  return { matched, ratio: matched.length / list.length };
}

export function computeJobFit({ resumeText = '', jd = {} } = {}) {
  const norm = normalizeResumeText(resumeText);
  const sections = sliceSections(norm);
  const expText = sections.experienceProjects || norm;

  const required = cov(norm, jd.requiredSkills || []);
  const preferred = cov(norm, jd.preferredSkills || []);
  const toolsDomain = cov(norm, Array.from(new Set([...(jd.tools || []), ...(jd.domain ? [jd.domain] : [])])));
  const keywords = cov(norm, jd.keywords || []);

  // Responsibilities: match on overlap of significant words.
  const respMatch = (jd.responsibilities || []).filter((r) => {
    const words = String(r).toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const hit = words.filter((w) => expText.includes(w)).length;
    return words.length ? hit / words.length >= 0.3 : false;
  }).length;
  const respRatio = (jd.responsibilities || []).length ? respMatch / jd.responsibilities.length : 0.5;

  // Experience level alignment.
  const mine = detectExperienceLevel(norm).level;
  const order = { fresher: 0, junior: 1, mid: 2, senior: 3 };
  const want = order[jd.experienceLevel] ?? 2;
  const have = order[mine] ?? 1;
  const expDelta = Math.abs(want - have);
  const expScore = expDelta === 0 ? 10 : expDelta === 1 ? 7 : expDelta === 2 ? 3 : 0;

  const breakdown = {
    requiredSkills: round(required.ratio * 30),
    preferredSkills: round(preferred.ratio * 15),
    responsibilities: round(respRatio * 20),
    experienceLevel: expScore,
    domainTools: round(toolsDomain.ratio * 10),
    keywordCoverage: round(keywords.ratio * 10),
  };

  // Risk: missing REQUIRED critical skills.
  const missingRequired = (jd.requiredSkills || []).filter((s) => !skillPresent(norm, s));
  const reqLen = (jd.requiredSkills || []).length || 1;
  const riskPenalty = round(clamp((missingRequired.length / reqLen) * 15, 0, 15));
  breakdown.riskMissingCritical = -riskPenalty;

  const positive = breakdown.requiredSkills + breakdown.preferredSkills + breakdown.responsibilities +
    breakdown.experienceLevel + breakdown.domainTools + breakdown.keywordCoverage;
  const score = clamp(round(positive - riskPenalty), 0, 100);

  return {
    score,
    breakdown,
    matchedRequired: required.matched,
    missingRequired,
    matchedPreferred: preferred.matched,
    matchedKeywords: keywords.matched,
    missingKeywords: (jd.keywords || []).filter((k) => !skillPresent(norm, k)),
  };
}

export default { computeJobFit };
