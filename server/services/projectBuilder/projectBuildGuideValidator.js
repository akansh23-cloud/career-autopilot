/* ============================================================
   Project OS — Builder Mode guide validator
   ------------------------------------------------------------
   Thin wrapper around the canonical validator/normalizer in
   web/src/lib/buildGuide.js. Kept as its own module so the route
   layer and tests can import a stable "validate the AI/JSON shape"
   entry point, exactly as the spec describes:
     - validate the JSON shape
     - sanitize arrays/objects
     - never render raw AI response directly
     - fall back to deterministic guide if validation fails
   ============================================================ */
import {
  validateBuildGuide as _validate,
  normalizeBuildGuide as _normalize,
  generateBuildGuide as _generate,
} from '../../../web/src/lib/buildGuide.js';

export function isValidBuildGuide(guide) {
  return _validate(guide);
}

/* Validate + sanitize. On any failure, returns a deterministic guide for the
   given project so the caller always has a renderable, complete object. */
export function sanitizeBuildGuide(guide, project = {}) {
  try {
    if (_validate(guide)) return _normalize(guide, project);
  } catch { /* fall through */ }
  return _generate(project || {});
}

export default { isValidBuildGuide, sanitizeBuildGuide };
