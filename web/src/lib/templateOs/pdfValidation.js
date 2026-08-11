/* ============================================================
   TEMPLATE OS — REAL PDF VALIDATION
   ------------------------------------------------------------
   Generates an actual PDF through the vector writer, extracts the
   TEXT LAYER with pdfjs, and scores what a parser would really
   receive: field recovery + semantic reading order + page count.

   This is the difference between "our HTML extracts cleanly" and
   "the PDF a recruiter receives extracts cleanly". Runs in Node
   (certification, tests) and in the browser (Studio validation).

   Base-14 fonts are WinAnsi; glyphs outside it are transliterated
   by the writer, so expectations are put through the SAME
   transform before comparison — no flattering mismatch.
   ============================================================ */
import { renderTemplatePdf, pdfEncodeText, PDF_WRITER_VERSION } from './pdfWriter.js';
import { scoreReadingOrder } from './shape.js';
import { normalizeStructuredContent } from './compiler.js';

export const PDF_VALIDATION_VERSION = 'pdf-validation-v1';

let _pdfjs = null;
async function loadPdfjs() {
  if (_pdfjs) return _pdfjs;
  /* browser build in the app, legacy build under Node */
  const isNode = typeof window === 'undefined';
  _pdfjs = isNode
    ? await import('pdfjs-dist/legacy/build/pdf.mjs')
    : await import('pdfjs-dist/build/pdf.mjs');
  if (!isNode) {
    const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
    _pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  return _pdfjs;
}

/** Extract the text layer of a PDF, page by page, in content-stream order. */
export async function extractPdfText(bytes) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => it.str).join(' '));
  }
  try { await doc.destroy(); } catch { /* noop */ }
  return { pageCount: doc.numPages, pages, text: pages.join('\n') };
}

const FIELD_WEIGHTS = ['name', 'email', 'phone', 'roles', 'companies', 'dates', 'skills', 'projects', 'education', 'certifications'];

export function pdfFieldRecovery(structuredInput, text) {
  const d = normalizeStructuredContent(structuredInput);
  const hay = pdfEncodeText(text).toLowerCase();
  const has = (v) => { const n = pdfEncodeText(v).trim().toLowerCase(); return !!n && hay.includes(n); };
  const every = (list, pick) => (list.length ? list.every((x) => has(pick(x))) : true);
  const checks = {
    name: has(d.personalInfo?.name),
    email: has(d.personalInfo?.email),
    phone: has(d.personalInfo?.phone),
    roles: every(d.experience || [], (e) => e.role),
    companies: every(d.experience || [], (e) => e.company),
    dates: every(d.experience || [], (e) => e.dates),
    skills: (d.skills || []).every((g) => (g.items || []).slice(0, 3).every((i) => has(i))),
    projects: every(d.projects || [], (p) => p.name),
    education: every(d.education || [], (e) => e.school),
    certifications: (d.certifications || []).slice(0, 3).every((c) => has(c)),
  };
  const passed = FIELD_WEIGHTS.filter((k) => checks[k]);
  return { checks, integrity: Math.round((passed.length / FIELD_WEIGHTS.length) * 100), criticalOk: checks.name && checks.email };
}

/**
 * Full loop: compiled template + content → real PDF → extracted text → scores.
 */
export async function validateRenderedPdf(compiled, structured, { sizeId = 'a4' } = {}) {
  const rendered = renderTemplatePdf(compiled, structured, { sizeId });
  const extracted = await extractPdfText(rendered.bytes);
  const recovery = pdfFieldRecovery(structured, extracted.text);
  /* compare like with like: the writer transliterates glyphs outside WinAnsi,
     so the expectation is put through the identical transform */
  const encoded = JSON.parse(JSON.stringify(normalizeStructuredContent(structured)), (_k, v) => (typeof v === 'string' ? pdfEncodeText(v) : v));
  const order = scoreReadingOrder(encoded, pdfEncodeText(extracted.text), compiled.tree.sections.map((s) => s.key));
  return {
    version: PDF_VALIDATION_VERSION,
    writerVersion: PDF_WRITER_VERSION,
    sizeId,
    bytes: rendered.bytes.length,
    pageCount: rendered.pageCount,
    extractedPages: extracted.pageCount,
    integrity: recovery.integrity,
    criticalOk: recovery.criticalOk,
    checks: recovery.checks,
    orderScore: order.score,
    misplaced: order.misplaced,
    /* the PDF the writer produced == the PDF that was parsed */
    roundTripOk: rendered.pageCount === extracted.pageCount,
  };
}

export default { PDF_VALIDATION_VERSION, extractPdfText, pdfFieldRecovery, validateRenderedPdf };
