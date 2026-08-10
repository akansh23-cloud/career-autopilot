/* ============================================================
   COLLEGE RESUME OVERVIEW — aggregate observability (no private
   resume content; counts and gap patterns only) + deterministic
   evidence-sprint cohort suggestions for the Intervention OS.
   ============================================================ */
import { resolveDictionary } from './roleDictionaries.js';
import { canonicalSkill } from './skillOntology.js';

export const COLLEGE_RESUME_OVERVIEW_VERSION = 'college-resume-overview-v1';

export function buildCollegeResumeOverview(signals = [], { minCohort = 3 } = {}) {
  const total = signals.length;
  const withDoc = signals.filter((s) => s.hasResumeDoc);
  const analyzedLegacy = signals.filter((s) => !s.hasResumeDoc && s.legacyResumeAnalyzed);
  const scored = signals.filter((s) => Number.isFinite(s.resumeScore));
  const ready = scored.filter((s) => s.resumeScore >= 80);
  const minorFixes = scored.filter((s) => s.resumeScore >= 60 && s.resumeScore < 80);
  const criticalGaps = scored.filter((s) => s.resumeScore < 60);
  const noResume = signals.filter((s) => !s.hasResumeDoc && !s.legacyResumeAnalyzed);
  const evidenceGaps = withDoc.filter((s) => s.verifiedSkillsOnResume === 0);

  /* Common missing evidence: for each student's target role, which must-have
     skills does the cohort most often lack verified coverage of? We only see
     counts (verified vs declared) per student — the per-skill gap pattern is
     derived from role dictionaries + zero-verified signals, never from
     private resume text. */
  const gapCounts = new Map();
  for (const s of signals) {
    if (!s.targetRole || s.verifiedSkillsOnResume > 0) continue;
    const { dict } = resolveDictionary(s.targetRole);
    for (const skill of (dict.mustHave || []).slice(0, 5)) {
      const c = canonicalSkill(skill);
      gapCounts.set(c, (gapCounts.get(c) || 0) + 1);
    }
  }
  const commonGaps = [...gapCounts.entries()]
    .map(([skill, count]) => ({ skill, students: count }))
    .sort((a, b) => b.students - a.students || a.skill.localeCompare(b.skill))
    .slice(0, 8);

  const interventionSuggestions = commonGaps
    .filter((g) => g.students >= minCohort)
    .slice(0, 4)
    .map((g) => ({
      type: 'evidence_sprint',
      skill: g.skill,
      students: g.students,
      title: `${g.skill.charAt(0).toUpperCase()}${g.skill.slice(1)} Evidence Sprint`,
      description: `${g.students} students target roles requiring ${g.skill} but carry zero verified skills on their resume. Route them into a verified ${g.skill} project instead of a textual reminder.`,
      action: { engine: 'projectos', context: { targetSkill: g.skill, reason: 'college_resume_gap' } },
    }));

  const avg = scored.length ? Math.round(scored.reduce((n, s) => n + s.resumeScore, 0) / scored.length) : null;

  return {
    version: COLLEGE_RESUME_OVERVIEW_VERSION,
    totals: {
      students: total,
      resumeOsAdopted: withDoc.length,
      legacyAnalyzedOnly: analyzedLegacy.length,
      noResume: noResume.length,
      avgResumeScore: avg,
    },
    buckets: {
      ready: ready.length,
      minorFixes: minorFixes.length,
      criticalGaps: criticalGaps.length,
      evidenceGaps: evidenceGaps.length,
    },
    commonGaps,
    interventionSuggestions,
  };
}

export default { COLLEGE_RESUME_OVERVIEW_VERSION, buildCollegeResumeOverview };
