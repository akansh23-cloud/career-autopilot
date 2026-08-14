import {
  compileTemplate, adaptTreeToShape, balancePageComposition, analyzeResumeShape,
  normalizeResumeDensityToTemplateMode, renderTemplatePdf,
} from '../../../web/src/lib/templateOs/index.js';
import { criticalTextChecks, extractPdfTextPortable } from './renderUtils.js';

export const VECTOR_RENDER_PROVIDER_VERSION = 'vector-pdf-render-provider-v1';

export function compileRenderLayout(definition, resumeDocument, structured, { sizeId = 'a4' } = {}) {
  const base = compileTemplate(definition, { density: normalizeResumeDensityToTemplateMode(resumeDocument.density) });
  if (!base.ok) throw Object.assign(new Error('invalid_template_definition'), { code: 'invalid_template_definition', validation: base.validation });
  return balancePageComposition(adaptTreeToShape(base, analyzeResumeShape(resumeDocument)), structured, { sizeId });
}

export async function renderVectorPdf({ definition, resumeDocument, structured, sizeId = 'a4' }) {
  const compiled = compileRenderLayout(definition, resumeDocument, structured, { sizeId });
  const out = renderTemplatePdf(compiled, structured, { sizeId });
  const extracted = await extractPdfTextPortable(out.bytes);
  const critical = criticalTextChecks(structured, extracted.text);
  return {
    provider: 'vector', providerVersion: VECTOR_RENDER_PROVIDER_VERSION,
    bytes: Buffer.from(out.bytes), pageCount: out.pageCount,
    extractedText: extracted.text, extractedPageCount: extracted.pageCount,
    validation: { ...critical, selectableText: extracted.text.trim().length > 0, pageRoundTrip: extracted.pageCount === out.pageCount },
    compiled,
  };
}
