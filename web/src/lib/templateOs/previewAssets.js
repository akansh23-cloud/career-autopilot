/* ============================================================
   TEMPLATE OS — CACHED PREVIEW ASSETS
   ------------------------------------------------------------
   Published/static templates use previews generated from the real
   renderer and committed under web/public/template-previews/. Draft,
   generated, or newly imported templates keep the lightweight SVG
   skeleton until their own preview asset exists.

   Public assets are deliberately addressed by predictable URLs so Vite
   can serve/copy them without importing dozens of images into the JS
   bundle. Query-versioning prevents stale browser caches when the preview
   pipeline changes or a template version is bumped.
   ============================================================ */

export const TEMPLATE_PREVIEW_CACHE_VERSION = 'template-preview-cache-v1';
export const TEMPLATE_PREVIEW_WIDTH = 360;
export const TEMPLATE_PREVIEW_HEIGHT = 509;

const safeId = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '');

/**
 * Predictable URL for a pre-generated preview asset.
 *
 * surface:
 *  - resume-studio: templates from resumeTemplateRegistry
 *  - editor: legacy ResumeTemplates gallery
 */
export function cachedTemplatePreviewUrl(templateId, {
  surface = 'resume-studio',
  templateVersion = 1,
} = {}) {
  const id = safeId(templateId);
  if (!id) return '';
  const bucket = surface === 'editor' ? 'editor' : 'resume-studio';
  const version = Number.isFinite(Number(templateVersion)) ? Number(templateVersion) : 1;
  return `/template-previews/${bucket}/${id}.png?pc=${encodeURIComponent(TEMPLATE_PREVIEW_CACHE_VERSION)}&tv=${version}`;
}

/** Apply the wireframe fallback exactly once if a cached preview is absent. */
export function fallbackPreviewOnError(event, fallbackSrc = '') {
  const img = event?.currentTarget;
  if (!img || !fallbackSrc || img.dataset.previewFallback === '1') return;
  img.dataset.previewFallback = '1';
  img.src = fallbackSrc;
}

export default {
  TEMPLATE_PREVIEW_CACHE_VERSION,
  TEMPLATE_PREVIEW_WIDTH,
  TEMPLATE_PREVIEW_HEIGHT,
  cachedTemplatePreviewUrl,
  fallbackPreviewOnError,
};
