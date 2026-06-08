/* ============================================================
   SKILL MATCHER
   ------------------------------------------------------------
   Word-boundary aware (not naive substring includes), alias-aware, and
   evidence-aware: a skill mentioned inside an experience/projects section
   counts more than one only listed in a skills section.
   ============================================================ */
import { SKILL_ALIASES } from './roleDictionaries.js';

/* Build a word-boundary-ish matcher for a token. We allow the token to be
   bounded by non-alphanumerics (so "ci/cd", "node.js", "c++" still match)
   instead of strict \b which breaks on punctuation-containing skills. */
function tokenRegex(token) {
  const t = String(token).toLowerCase().trim();
  if (!t) return null;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // (?<![a-z0-9]) ... (?![a-z0-9]) — boundaries that ignore punctuation.
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'i');
}

/* All match terms for a canonical skill (itself + aliases). */
export function termsForSkill(skill) {
  const s = String(skill).toLowerCase().trim();
  const aliases = SKILL_ALIASES[s] || [];
  return Array.from(new Set([s, ...aliases]));
}

/* True if any term for the skill appears (word-boundary) in the text. */
export function skillPresent(text, skill) {
  for (const term of termsForSkill(skill)) {
    const re = tokenRegex(term);
    if (re && re.test(text)) return true;
  }
  return false;
}

/* Returns the subset of `skills` present in text. */
export function presentSkills(text, skills = []) {
  return skills.filter((s) => skillPresent(text, s));
}

export function countPresent(text, skills = []) {
  return presentSkills(text, skills).length;
}

/* Evidence-based match: for each skill, where does it appear?
   weight 1.0 if in experience/projects, 0.5 if only in skills/other. */
export function skillEvidence(skills, { experienceText = '', skillsText = '', fullText = '' }) {
  const out = [];
  for (const skill of skills) {
    const inExp = skillPresent(experienceText, skill);
    const inSkills = skillPresent(skillsText, skill);
    const inFull = skillPresent(fullText, skill);
    if (!inFull) continue;
    const where = inExp ? 'experience' : inSkills ? 'skills-section' : 'other';
    out.push({ skill, where, weight: inExp ? 1 : 0.5, evidenced: inExp });
  }
  return out;
}

export default { termsForSkill, skillPresent, presentSkills, countPresent, skillEvidence };
