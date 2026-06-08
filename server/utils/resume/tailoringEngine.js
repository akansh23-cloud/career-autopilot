/* ============================================================
   TAILORING ENGINE (deterministic, safety-first)
   ------------------------------------------------------------
   Rewrites / reorders / emphasizes ONLY facts already present in the
   resume. It never inserts skills the resume does not contain. Missing
   JD skills are returned as SUGGESTIONS (needsReview), never written into
   the resume as claims. Three modes control how aggressively existing
   content is restructured.
   ============================================================ */
import { normalizeResumeText } from './normalizeResumeText.js';
import { sliceSections } from './sectionDetector.js';
import { skillPresent, presentSkills } from './skillMatcher.js';

const MODES = new Set(['conservative', 'balanced', 'aggressive']);

function splitLines(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

/* Reorder skills so JD-required (and present-in-resume) skills lead. */
function reorderSkills(skillsText, jd) {
  const items = skillsText
    .split(/[,\n•|]/).map((s) => s.trim()).filter(Boolean);
  if (!items.length) return { text: skillsText, reordered: false };
  const wanted = new Set([...(jd.requiredSkills || []), ...(jd.preferredSkills || [])].map((s) => s.toLowerCase()));
  const score = (item) => {
    const lc = item.toLowerCase();
    for (const w of wanted) if (lc.includes(w)) return 2;
    return 0;
  };
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  const reordered = sorted.join(', ');
  return { text: reordered, reordered: reordered !== items.join(', ') };
}

/* Emphasize matched JD keywords inside bullet lines by moving the most
   relevant bullets up. Does not change bullet wording in conservative mode. */
function reorderBullets(expText, jd, mode) {
  const lines = splitLines(expText);
  const bullets = lines.filter((l) => /^[•\-*]/.test(l));
  if (!bullets.length) return { text: expText, changed: false };
  const wanted = [...(jd.requiredSkills || []), ...(jd.keywords || [])];
  const relevance = (l) => wanted.reduce((n, w) => n + (skillPresent(l, w) ? 1 : 0), 0);
  let newBullets = [...bullets];
  if (mode !== 'conservative') newBullets = [...bullets].sort((a, b) => relevance(b) - relevance(a));
  // Balanced/aggressive: lightly normalise bullet starts to strong verbs
  // ONLY if they already begin with a weak filler — never adds facts.
  if (mode === 'aggressive') {
    newBullets = newBullets.map((b) => b.replace(/^([•\-*]\s*)(responsible for|worked on|helped with)\s+/i, '$1'));
  }
  const changed = newBullets.join('\n') !== bullets.join('\n');
  // Rebuild: non-bullet lines kept in place at top, bullets reordered after.
  const nonBullets = lines.filter((l) => !/^[•\-*]/.test(l));
  return { text: [...nonBullets, ...newBullets].join('\n'), changed };
}

export function tailorResume({ resumeText = '', jd = {}, targetRole = '', mode = 'balanced' } = {}) {
  const safeMode = MODES.has(mode) ? mode : 'balanced';
  const original = String(resumeText || '');
  const norm = normalizeResumeText(original);
  const sections = sliceSections(norm);

  const changeLog = [];
  const safeChanges = [];
  const needsReview = [];

  // 1) Skills section reordering (all modes).
  let tailoredSkills = sections.skills || '';
  if (tailoredSkills) {
    const r = reorderSkills(tailoredSkills, jd);
    if (r.reordered) { tailoredSkills = r.text; changeLog.push('Reordered skills to surface JD-required skills first.'); safeChanges.push('Skills reordered (no new skills added).'); }
  }

  // 2) Experience/projects bullet reordering (balanced+aggressive reorder; conservative keeps order).
  let tailoredExp = sections.experienceProjects || '';
  const be = reorderBullets(tailoredExp, jd, safeMode);
  if (be.changed) { tailoredExp = be.text; changeLog.push('Reordered experience bullets to lead with JD-relevant achievements.'); safeChanges.push('Experience bullets reordered (wording preserved).'); }

  // 3) Summary emphasis (balanced/aggressive): prepend a focus line built ONLY
  //    from skills the resume already proves + the target role. No new facts.
  let tailoredSummary = sections.summary || '';
  if (safeMode !== 'conservative') {
    const proven = presentSkills(norm, [...(jd.requiredSkills || []), ...(jd.preferredSkills || [])]).slice(0, 5);
    if (proven.length) {
      const focus = `Target role: ${targetRole || jd.jobTitle || 'role'}. Relevant strengths: ${proven.join(', ')}.`;
      tailoredSummary = tailoredSummary ? `${focus}\n${tailoredSummary}` : focus;
      changeLog.push('Added a role-focus line to the summary using only skills already present in the resume.');
      safeChanges.push('Summary focus line uses existing, resume-proven skills only.');
    }
  }

  // 4) Missing JD skills -> SUGGESTIONS only (never inserted as claims).
  const keywordsMissing = (jd.requiredSkills || []).concat(jd.preferredSkills || [])
    .filter((s) => !skillPresent(norm, s));
  for (const m of keywordsMissing.slice(0, 15)) {
    needsReview.push(`JD asks for "${m}" but it is not evidenced in your resume — add it only if you genuinely have it.`);
  }

  const keywordsAdded = presentSkills(norm, [...(jd.requiredSkills || []), ...(jd.keywords || [])])
    .filter((k) => (jd.requiredSkills || []).includes(k) || (jd.keywords || []).includes(k));

  // Assemble tailored resume text preserving any non-recognised content.
  const blocks = [];
  if (tailoredSummary) blocks.push(`SUMMARY\n${tailoredSummary}`);
  if (tailoredSkills) blocks.push(`SKILLS\n${tailoredSkills}`);
  if (tailoredExp) blocks.push(`EXPERIENCE & PROJECTS\n${tailoredExp}`);
  for (const k of ['education', 'certifications', 'achievements']) {
    if (sections[k]) blocks.push(`${k.toUpperCase()}\n${sections[k]}`);
  }
  // Fall back to original if we failed to recognise meaningful sections.
  const tailoredText = blocks.length >= 2 ? blocks.join('\n\n') : original;

  return {
    mode: safeMode,
    tailoredResume: {
      text: tailoredText,
      summary: tailoredSummary,
      skills: tailoredSkills,
      experienceProjects: tailoredExp,
    },
    keywordsAdded: Array.from(new Set(keywordsAdded)),
    keywordsMissing: Array.from(new Set(keywordsMissing)),
    changeLog,
    safeChanges,
    needsReview,
  };
}

export default { tailorResume };
