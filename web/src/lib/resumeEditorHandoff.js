/* ============================================================================
   resumeEditorHandoff.js — single contract for opening tailored output in the
   Resume Editor.
   ----------------------------------------------------------------------------
   Three flows hand a tailored resume to the Editor:
     1. the backend Resume OS tailoring endpoint (/api/resume/tailor) via the
        Resume → Tailor panel,
     2. the legacy job application kit modal in Jobs.jsx,
     3. the Editor's own inline tailor.
   All of them must write the SAME localStorage payload so the Editor opens the
   tailored text with a template id that exists in the CURRENT template
   registry (legacy ids are mapped, never passed through raw).
   ========================================================================== */
import { getResumeTemplate } from './resumeTemplateRegistry.js';

export const EDITOR_HANDOFF_KEY = 'careerAutopilot.editor.lastTailor.v1';

/**
 * Build the editor handoff payload (pure — no storage access).
 *  tailoredText : the tailored resume text that should open in the editor
 *  originalText : the pre-tailoring resume text (kept for re-tailoring)
 *  jobDescription, templateId (any legacy id is mapped through the registry),
 *  length: 'Auto' | 'Single page' | 'Multi page'
 */
export function buildEditorHandoff({
  tailoredText = '', originalText = '', jobDescription = '',
  templateId = '', length = 'Auto', extra = {},
} = {}) {
  const tpl = getResumeTemplate(templateId); // maps legacy ids, never undefined
  const len = ['Auto', 'Single page', 'Multi page'].includes(length) ? length : 'Auto';
  return {
    resume: originalText || tailoredText,
    out: tailoredText,
    jd: jobDescription || '',
    tpl: tpl.id,
    len,
    ...extra,
    updatedAt: new Date().toISOString(),
  };
}

/** Persist the handoff for the Editor to pick up (browser only). */
export function writeEditorHandoff(payload) {
  try { localStorage.setItem(EDITOR_HANDOFF_KEY, JSON.stringify(payload)); return true; }
  catch { return false; }
}

/** Convenience: build + persist in one call. Returns the payload. */
export function openInEditorHandoff(args) {
  const payload = buildEditorHandoff(args);
  writeEditorHandoff(payload);
  return payload;
}
