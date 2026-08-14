import { normalizeRenderInput, hasUnsupportedVectorGlyphs, renderSignature, RESUME_RENDER_SERVICE_VERSION } from './renderUtils.js';
import { renderVectorPdf } from './vectorPdfRenderProvider.js';
import { renderChromiumPdf } from './chromiumRenderProvider.js';
import { renderWeasyPrintPdf } from './weasyPrintRenderProvider.js';

export const RENDER_PROVIDERS = Object.freeze(['auto', 'vector', 'chromium', 'weasyprint']);

function configuredProvider(requested) {
  const raw = String(requested || process.env.RESUME_RENDER_PROVIDER || 'auto').toLowerCase();
  return RENDER_PROVIDERS.includes(raw) ? raw : 'auto';
}

export async function renderResumePdf({ doc, definition, sizeId = 'a4', provider = 'auto' }) {
  if (!definition) throw Object.assign(new Error('template_definition_required'), { code: 'template_definition_required' });
  const { resumeDocument, structured } = normalizeRenderInput(doc);
  const requested = configuredProvider(provider);
  const unicodeRequired = hasUnsupportedVectorGlyphs(resumeDocument);
  let selected = requested;
  if (selected === 'auto') selected = unicodeRequired ? 'chromium' : 'vector';
  if (selected === 'vector' && unicodeRequired) {
    throw Object.assign(new Error('vector_renderer_cannot_preserve_unicode'), { code: 'vector_renderer_cannot_preserve_unicode', recommendedProvider: 'chromium' });
  }
  let output;
  if (selected === 'chromium') {
    try { output = await renderChromiumPdf({ definition, resumeDocument, structured, sizeId }); }
    catch (err) {
      if (requested !== 'auto') throw err;
      output = await renderWeasyPrintPdf({ definition, resumeDocument, structured, sizeId });
      selected = 'weasyprint';
    }
  } else if (selected === 'weasyprint') output = await renderWeasyPrintPdf({ definition, resumeDocument, structured, sizeId });
  else output = await renderVectorPdf({ definition, resumeDocument, structured, sizeId });
  const signature = renderSignature({ doc: resumeDocument, definition, sizeId, density: resumeDocument.density });
  return {
    ...output,
    serviceVersion: RESUME_RENDER_SERVICE_VERSION,
    requestedProvider: requested,
    selectedProvider: selected,
    unicodeRequired,
    renderSignature: signature,
    sizeId,
  };
}

export default { renderResumePdf, RENDER_PROVIDERS, RESUME_RENDER_SERVICE_VERSION };
