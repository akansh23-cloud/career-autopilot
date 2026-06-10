/* ============================================================
   Project OS — Builder Mode service (server side)
   ------------------------------------------------------------
   DETERMINISTIC. No AI key, DB or network is required for any
   route to work. It reuses the single source-of-truth generator
   in web/src/lib/buildGuide.js so the server and the client never
   drift. AI enrichment is OPTIONAL: if a caller passes an
   `aiGuide`, it is validated/normalized through the same shape
   before use, and falls back to the deterministic guide on any
   problem. Nothing here throws to the client.
   ============================================================ */
import {
  generateBuildGuide,
  normalizeBuildGuide,
  validateBuildGuide,
  computeProgress,
  buildGuideToMarkdown,
} from '../../../web/src/lib/buildGuide.js';

/* Build a guide from a project (+ optional context). Deterministic-first;
   an optional pre-validated AI guide may be merged in but is never trusted raw. */
export function buildGuide({ project = {}, progress = null, aiGuide = null } = {}) {
  const base = generateBuildGuide(project || {}, { progress });
  if (aiGuide && validateBuildGuide(aiGuide)) {
    try {
      const normalized = normalizeBuildGuide(aiGuide, project || {});
      normalized.generatedBy = 'ai+validated';
      return normalizeBuildGuide({ ...normalized, projectId: base.projectId }, project || {});
    } catch {
      return base; // validation/normalization failed → safe deterministic guide
    }
  }
  return base;
}

/* Recompute progress for a stored project/guide pair. */
export function progressFor({ project = {}, progress = null } = {}) {
  const guide = generateBuildGuide(project || {}, { progress });
  return { guide, progress: computeProgress(guide) };
}

/* Export a guide as markdown or json (string content the route returns). */
export function exportGuide({ project = {}, progress = null, guide = null, format = 'markdown' } = {}) {
  const g = validateBuildGuide(guide) ? normalizeBuildGuide(guide, project) : generateBuildGuide(project || {}, { progress });
  if (String(format).toLowerCase() === 'json') {
    return { format: 'json', contentType: 'application/json', content: JSON.stringify(g, null, 2) };
  }
  return { format: 'markdown', contentType: 'text/markdown', content: buildGuideToMarkdown(g) };
}

export default { buildGuide, progressFor, exportGuide };
