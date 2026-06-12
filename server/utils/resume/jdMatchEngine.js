/* ============================================================
   JD MATCH ENGINE  (deterministic, Phase 4)
   ------------------------------------------------------------
   Extracts skills/requirements from pasted job-description text (reusing
   the existing jdParser + alias-aware skillMatcher — no new extraction
   logic) and matches them against the resume:
   - matched: present with experience-level evidence
   - weak:    present only in a skills list (no experience evidence)
   - missing: not in the resume at all
   Missing skills the user has VERIFIED proof for (verified projects /
   skill badges) are flagged "add this — you can prove it", tying Resume
   OS to the proof-score moat. Verified skills are server-resolved when
   the DB is on and may be supplemented by the client's verified list —
   they only ever ANNOTATE, never change match results.
   ============================================================ */
import { normalizeResumeText } from './normalizeResumeText.js';
import { parseJD } from './jdParser.js';
import { skillEvidence, presentSkills } from './skillMatcher.js';
import { sliceSections } from './sectionDetector.js';

export const JD_MATCH_VERSION = 'jd-match-v1';

const lcSet = (arr) => new Set((arr || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean));

/**
 * matchResumeToJD({ resumeText, jobDescription, targetRole, verifiedSkills })
 * Pure + deterministic. verifiedSkills: string[] of skills the user has
 * verified proof for (from verified project submissions / skill badges).
 */
export function matchResumeToJD({ resumeText = '', jobDescription = '', targetRole = '', verifiedSkills = [] } = {}) {
  const jd = parseJD({ jobDescription, targetRole });
  const norm = normalizeResumeText(String(resumeText || ''));
  const slices = sliceSections(norm);
  const evidenceCtx = {
    experienceText: [slices.experience, slices.projects].filter(Boolean).join('\n'),
    skillsText: slices.skills || '',
    fullText: norm,
  };

  const allJdSkills = Array.from(new Set([...(jd.requiredSkills || []), ...(jd.preferredSkills || [])]));
  const evidence = skillEvidence(allJdSkills, evidenceCtx);
  const evidenceBySkill = new Map(evidence.map((e) => [e.skill.toLowerCase(), e]));
  const verified = lcSet(verifiedSkills);

  const matched = [];
  const weak = [];
  const missing = [];
  for (const skill of allJdSkills) {
    const required = (jd.requiredSkills || []).includes(skill);
    const ev = evidenceBySkill.get(skill.toLowerCase());
    const isVerified = verified.has(skill.toLowerCase());
    if (ev && ev.evidenced) {
      matched.push({ skill, required, where: ev.where, verified: isVerified });
    } else if (ev) {
      weak.push({
        skill, required, where: ev.where, verified: isVerified,
        fix: `"${skill}" only appears in your skills list — back it with a bullet in Experience or Projects showing what you did with it.`,
      });
    } else {
      missing.push({
        skill, required, verified: isVerified,
        fix: isVerified
          ? `add this — you can prove it: "${skill}" is verified on your proof profile but absent from this resume.`
          : `"${skill}" is in the JD but not on your resume — add it only if you genuinely have it.`,
      });
    }
  }

  /* Provable gaps first: verified-but-missing is the highest-leverage fix. */
  missing.sort((a, b) => (b.verified - a.verified) || (b.required - a.required));

  const requiredTotal = (jd.requiredSkills || []).length;
  const requiredMatched = matched.filter((m) => m.required).length + weak.filter((w) => w.required).length;
  const coverage = requiredTotal ? Math.round((requiredMatched / requiredTotal) * 100) : 100;

  return {
    jd: {
      jobTitle: jd.jobTitle, company: jd.company,
      requiredSkills: jd.requiredSkills, preferredSkills: jd.preferredSkills,
      experienceLevel: jd.experienceLevel, keywords: jd.keywords,
    },
    matched,
    weak,
    missing,
    provableGaps: missing.filter((m) => m.verified).map((m) => m.skill),
    coverage,
    version: JD_MATCH_VERSION,
  };
}

/* Resolve the user's verified skills from verified project submissions.
   Server-side only; degrades to [] with the DB off. */
export async function resolveVerifiedSkills({ db, userId, email }) {
  if (!db?.dbEnabled?.()) return [];
  try {
    const subs = await db.listProjectSubmissions?.({ userId, email }) || [];
    const out = new Set();
    for (const s of subs) {
      const status = String(s.verificationStatus || s.status || '').toLowerCase();
      if (status !== 'verified') continue; // pending/unverified work NEVER counts
      for (const sk of [...(s.skillsCovered || []), ...(s.skills || [])]) {
        const v = String(sk || '').trim();
        if (v) out.add(v);
      }
    }
    return [...out];
  } catch { return []; }
}

export default { matchResumeToJD, resolveVerifiedSkills, JD_MATCH_VERSION };
