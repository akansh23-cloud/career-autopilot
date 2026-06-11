/* ============================================================================
   resumeTemplates.js — compatibility façade for the rebuilt Resume OS
   ----------------------------------------------------------------------------
   The real implementation now lives in focused modules:
     • resumeDataModel.js        — structured resume model + parser/mapper
     • resumeTemplateRegistry.js — central template registry (NO fake ATS numbers)
     • resumeRenderer.js         — single renderer (preview === export), pagination
     • resumeLayoutValidator.js  — validateResumeLayout(container, options)
     • resumeSectionOptimizer.js — one-page fit planning, content quality, JD recs
     • resumeFixtures.js         — sample resumes for the Template Lab + tests

   This file keeps the legacy import surface stable for Editor.jsx and
   ResumeTemplates.jsx while routing everything to the new system.
   ========================================================================== */

import {
  RESUME_TEMPLATES, getResumeTemplate, LEGACY_TEMPLATE_MAP,
  setCustomResumeTemplate, getCustomResumeTemplate,
  recommendTemplateId as _recommendTemplateId,
  recommendResumeTemplate, isTemplateAtsSafe, ATS_SAFE_RULES, STANDARD_SECTIONS,
} from './resumeTemplateRegistry.js';
import {
  parseResumeText, toStructuredResume, structuredFromText, emptyStructuredResume,
  groupSkills, flattenSkills, devopsSkillGroups,
} from './resumeDataModel.js';
import {
  paginateResume, composePagedDocumentHTML, renderAndValidate,
  exportResumePDF as _exportResumePDF,
  exportResumeSnapshotPDF,
  exportResumeDOCX as _exportResumeDOCX,
  PAGE_SIZES, DENSITIES, MIN_BODY_FONT_PX,
} from './resumeRenderer.js';
import { validateResumeLayout } from './resumeLayoutValidator.js';
import {
  planOnePageFit, analyzeContentQuality, recommendForJobDescription,
  ONE_PAGE_OVERFLOW_MESSAGE, sectionOrderForRole,
} from './resumeSectionOptimizer.js';

/* ------------------------------------------------------------------ */
/* Legacy names                                                        */
/* ------------------------------------------------------------------ */

/** Legacy: parse raw resume text into the (legacy) section model. */
export const parseResume = parseResumeText;

/** Legacy: the template list. Now the central registry — no atsScore fields. */
export const TEMPLATES = RESUME_TEMPLATES;

/** Legacy: resolve a template by id (handles legacy ids + custom template). */
export const getTemplate = getResumeTemplate;

/** Legacy: role → template id recommendation. */
export const recommendTemplateId = _recommendTemplateId;

/** Exports — same renderer as the preview, validated before writing files. */
export const exportResumePDF = _exportResumePDF;
export const exportResumeDOCX = _exportResumeDOCX;
export { exportResumeSnapshotPDF };

/** Legacy: register the user's custom uploaded template. */
export const setCustomTemplate = setCustomResumeTemplate;
export const getCustomTemplate = getCustomResumeTemplate;

/* ------------------------------------------------------------------ */
/* Custom uploaded template → registry-shaped template                 */
/* ------------------------------------------------------------------ */

/**
 * Build a registry-shaped template from an analyzed upload spec
 * (templateAnalyze.js). Custom templates always render single-column —
 * the old free-form two-column rendering was the source of collapsed and
 * overlapping layouts, so column hints only affect the risk label.
 */
export function buildCustomTemplate(spec = {}) {
  const accent = (spec.colorPalette && spec.colorPalette.accent) || '#334155';
  const headerBg = (spec.colorPalette && spec.colorPalette.headerBg) || accent;
  const wantsBand = spec.headerLayout === 'banner' || spec.headerLayout === 'band';
  const atsSafe = spec.atsSafe !== false && Number(spec.columnLayout) !== 2 && !wantsBand;
  const order = Array.isArray(spec.sectionOrder) && spec.sectionOrder.length
    ? spec.sectionOrder.map((s) => String(s).toLowerCase())
    : ['summary', 'skills', 'experience', 'projects', 'education', 'certifications'];

  const badges = [
    atsSafe ? 'ATS-safe' : 'Visual, not ATS-first',
    'Single-column',
    'Custom upload',
  ];

  return {
    id: 'custom-upload',
    name: spec.templateName || 'My Uploaded Template',
    category: 'custom',
    bestFor: ['Personal style match'],
    badges,
    atsSafe,
    layoutType: 'single-column',
    pageMode: 'auto',
    supportsOnePage: true,
    supportsMultiPage: true,
    riskLevel: atsSafe ? 'low' : 'visual',
    description: atsSafe
      ? 'Styled from your uploaded template, constrained to a single-column ATS-safe structure.'
      : 'Styled from your uploaded template. Visual styling detected — treat as visual, not ATS-first.',
    sections: ['Header', ...order.map((s) => s[0].toUpperCase() + s.slice(1))],
    previewType: 'structural',
    custom: true,
    recommendations: Array.isArray(spec.recommendations) ? spec.recommendations : [],
    theme: {
      font: spec.fontStyle === 'serif'
        ? 'Georgia, "Times New Roman", serif'
        : '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      accent,
      headerAlign: spec.headerLayout === 'center' ? 'center' : 'left',
      sectionStyle: (spec.sectionStyles && spec.sectionStyles.divider === 'rule') ? 'rule' : 'bar',
      bulletChar: 'disc',
      density: spec.spacingRules === 'tight' ? 'compact' : 'comfortable',
      nameSize: 21,
      skillsStyle: atsSafe ? 'grouped-lines' : 'chips',
      headerBand: wantsBand && !atsSafe ? { bg: headerBg, fg: '#ffffff' } : false,
      sectionOrder: order,
    },
  };
}

/**
 * Legacy `atsEstimate(template)` returned a fake number. Fake ATS numbers are
 * banned from template cards — this now returns an honest label object so any
 *caller renders a label instead of a score.
 */
export function atsEstimate(tpl) {
  const t = typeof tpl === 'string' ? getResumeTemplate(tpl) : tpl;
  const safe = !!(t && t.atsSafe);
  return {
    label: safe ? 'ATS-safe' : 'Visual, not ATS-first',
    atsSafe: safe,
    riskLevel: (t && t.riskLevel) || (safe ? 'low' : 'visual'),
  };
}

/* ------------------------------------------------------------------ */
/* Modern surface re-exports (preferred import path going forward)     */
/* ------------------------------------------------------------------ */
export {
  RESUME_TEMPLATES, getResumeTemplate, LEGACY_TEMPLATE_MAP, recommendResumeTemplate,
  isTemplateAtsSafe, ATS_SAFE_RULES, STANDARD_SECTIONS,
  toStructuredResume, structuredFromText, emptyStructuredResume,
  groupSkills, flattenSkills, devopsSkillGroups,
  paginateResume, composePagedDocumentHTML, renderAndValidate,
  validateResumeLayout, planOnePageFit, analyzeContentQuality,
  recommendForJobDescription, ONE_PAGE_OVERFLOW_MESSAGE, sectionOrderForRole,
  PAGE_SIZES, DENSITIES, MIN_BODY_FONT_PX,
};
