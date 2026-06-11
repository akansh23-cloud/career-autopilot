/* ============================================================================
   resumeSectionOptimizer.js — auto-fix / optimisation engine for Resume OS
   ----------------------------------------------------------------------------
   When content does not fit the chosen page mode the system NEVER crops.
   This module produces safe, ordered optimisation steps and content-quality
   suggestions. Pure functions only — unit-tested under `node --test`.
   ========================================================================== */

import { toStructuredResume, flattenSkills } from './resumeDataModel.js';
import { DENSITIES, DENSITY_STEPS, MIN_BODY_FONT_PX } from './resumeRenderer.js';
import { recommendResumeTemplate } from './resumeTemplateRegistry.js';

export const ONE_PAGE_OVERFLOW_MESSAGE = 'Your resume has too much verified content for one page. Use two-page mode or remove lower-priority sections.';

/* Sections in ascending order of "safe to move to page 2 / drop last". */
export const OPTIONAL_SECTION_PRIORITY = ['interests', 'extra', 'publications', 'patents', 'certifications', 'achievements'];

/* ------------------------------------------------------- fit planning ---- */

/**
 * planOnePageFit({ pageCount, density, requestedOnePage })
 * Given a paginate result, return the ordered list of safe optimisation steps
 * to try next. Steps never push body text below MIN_BODY_FONT_PX and never
 * silently remove content.
 */
export function planOnePageFit({ pageCount = 1, density = 'compact', requestedOnePage = false } = {}) {
  const steps = [];
  if (!requestedOnePage || pageCount <= 1) {
    return { fits: pageCount <= 1, steps, message: '' };
  }
  const idx = DENSITY_STEPS.indexOf(density);
  for (let i = idx + 1; i < DENSITY_STEPS.length; i++) {
    const next = DENSITY_STEPS[i];
    if (DENSITIES[next].fontPx >= MIN_BODY_FONT_PX) {
      steps.push({ type: 'density', value: next, label: `Reduce spacing & font slightly (${next})` });
    }
  }
  steps.push({ type: 'shorten-summary', label: 'Shorten the summary to 2–3 lines' });
  steps.push({ type: 'group-skills', label: 'Group skills into tighter category lines' });
  steps.push({ type: 'move-optional', label: 'Move optional sections (certifications, achievements) to page 2', requiresConfirmation: false });
  steps.push({ type: 'hide-optional', label: 'Hide low-value optional sections', requiresConfirmation: true });
  steps.push({ type: 'two-page', label: 'Switch to two-page mode (recommended for senior profiles)' });
  steps.push({ type: 'switch-template', value: 'senior-engineer', label: 'Use a multi-page friendly template (Senior Engineer / Architect)' });
  return { fits: false, steps, message: ONE_PAGE_OVERFLOW_MESSAGE };
}

/* Densities respect the readability floor — exposed for tests/UI copy. */
export function densityIsReadable(densityId) {
  const d = DENSITIES[densityId];
  return !!d && d.fontPx >= MIN_BODY_FONT_PX && d.lineHeight >= 1.2 && d.margin >= 30;
}

/* ----------------------------------------------- section order by role --- */

export function sectionOrderForRole(role = '') {
  const r = String(role).toLowerCase();
  if (/intern|fresher|student|graduate|entry/.test(r)) {
    return ['summary', 'education', 'skills', 'projects', 'experience', 'certifications', 'achievements'];
  }
  if (/devops|sre|cloud|platform|infrastructure/.test(r)) {
    return ['summary', 'skills', 'experience', 'projects', 'certifications', 'education', 'achievements'];
  }
  if (/director|head|vp|chief|manager|lead|executive/.test(r)) {
    return ['summary', 'achievements', 'experience', 'skills', 'education', 'certifications', 'projects'];
  }
  return ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements'];
}

/* ------------------------------------------------ content quality rules -- */

const WEAK_PHRASES = ['highly motivated', 'hardworking', 'team player', 'go-getter', 'detail-oriented', 'results-driven', 'passionate about', 'dynamic professional', 'seeking a challenging'];
const ACTION_VERB_RE = /^(built|designed|developed|led|launched|shipped|implemented|created|architected|automated|reduced|increased|improved|migrated|optimi[sz]ed|delivered|owned|drove|scaled|mentored|managed|established|deployed|integrated|refactored|maintained|spearheaded|engineered|streamlined|cut|saved|grew|won|published|presented|achieved|collaborated|coordinated|analy[sz]ed|tested|debugged|monitored|configured|secured)/i;
const METRIC_RE = /\d+(\.\d+)?\s*(%|x|k|m|ms|s\b|users?|requests?|rps|qps|hrs?|hours?|days?|weeks?|crore|lakh|\$|₹|€)/i;

/**
 * analyzeContentQuality(data) — content-quality suggestions (never invents
 * facts; only flags formatting / phrasing weaknesses in EXISTING content).
 */
export function analyzeContentQuality(input) {
  const d = toStructuredResume(input);
  const suggestions = [];
  const flatSkills = flattenSkills(d.skills);

  if (d.summary) {
    const low = d.summary.toLowerCase();
    for (const w of WEAK_PHRASES) {
      if (low.includes(w)) suggestions.push({ type: 'weak-phrase', where: 'summary', detail: `Generic phrase "${w}" — rewrite with a concrete strength or outcome.` });
    }
    if (d.summary.length > 420) suggestions.push({ type: 'long-summary', where: 'summary', detail: 'Summary is long — keep it to 2–3 lines for recruiters.' });
  }

  if (flatSkills.length > 0 && Object.values(d.skills).filter((g) => g.length).length <= 1 && flatSkills.length > 8) {
    suggestions.push({ type: 'ungrouped-skills', where: 'skills', detail: 'Skills read as one dump — group them (Languages, Backend, Cloud, …).' });
  }
  if (flatSkills.length > 30) {
    suggestions.push({ type: 'too-many-skills', where: 'skills', detail: `${flatSkills.length} skills listed — trim to the ones you can defend in an interview.` });
  }

  const checkBullets = (items, where, nameOf) => {
    items.forEach((item) => {
      (item.bullets || []).forEach((b) => {
        if (!ACTION_VERB_RE.test(b.trim())) {
          suggestions.push({ type: 'no-action-verb', where, detail: `Bullet under "${nameOf(item)}" doesn't start with an action verb: "${b.slice(0, 60)}…"` });
        }
      });
      const hasMetric = (item.bullets || []).some((b) => METRIC_RE.test(b));
      if ((item.bullets || []).length >= 2 && !hasMetric) {
        suggestions.push({ type: 'no-metrics', where, detail: `"${nameOf(item)}" has no quantified impact — add scale, numbers or outcomes where true.` });
      }
    });
  };
  checkBullets(d.experience, 'experience', (e) => e.role || e.company || 'experience entry');
  checkBullets(d.projects, 'projects', (p) => p.name || 'project');

  return suggestions;
}

/* ---------------------------------------------- JD-driven recommendations  */

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'you', 'will', 'our', 'are', 'that', 'this', 'have', 'has', 'work', 'team', 'role', 'job', 'years', 'experience', 'strong', 'good', 'ability', 'skills', 'knowledge', 'including', 'plus', 'etc', 'who', 'what', 'their', 'them', 'from', 'your', 'about', 'into', 'such', 'using', 'use', 'well', 'all', 'any', 'can', 'not', 'but', 'more', 'than', 'must', 'should', 'we', 'in', 'of', 'to', 'a', 'an', 'on', 'as', 'is', 'be', 'or', 'at', 'by', 'it', 'required', 'preferred', 'responsibilities', 'requirements', 'need', 'needs', 'needed', 'looking', 'want', 'wants', 'ideal', 'candidate', 'hands-on']);

export function extractJdKeywords(jobDescription = '', limit = 24) {
  const counts = new Map();
  const tokens = String(jobDescription).toLowerCase().match(/[a-z][a-z0-9+#./-]{1,28}/g) || [];
  for (const raw of tokens) {
    const t = raw.replace(/[./-]+$/, ''); // strip trailing punctuation ("aws." → "aws")
    if (!t || STOP_WORDS.has(t) || t.length < 3) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

/**
 * recommendForJobDescription({ data, role, jobDescription }) →
 * { missingKeywords, matchedKeywords, prioritizeSections, summaryAdvice }
 * Template choice itself comes from recommendResumeTemplate (registry).
 */
export function recommendForJobDescription({ data, role = '', jobDescription = '' } = {}) {
  const d = toStructuredResume(data);
  const keywords = extractJdKeywords(jobDescription);
  const haystack = JSON.stringify(d).toLowerCase();
  const matchedKeywords = keywords.filter((k) => haystack.includes(k));
  const missingKeywords = keywords.filter((k) => !haystack.includes(k));
  const prioritizeSections = sectionOrderForRole(role || jobDescription);
  const { template, templateId, reason: templateReason } = recommendResumeTemplate(role, jobDescription);
  const summaryAdvice = missingKeywords.length
    ? `Work these JD terms into your summary/bullets only where they are true: ${missingKeywords.slice(0, 6).join(', ')}.`
    : 'Your resume already covers the main JD vocabulary — focus the summary on impact.';
  return { matchedKeywords, missingKeywords, prioritizeSections, summaryAdvice, template, templateId, templateReason };
}
