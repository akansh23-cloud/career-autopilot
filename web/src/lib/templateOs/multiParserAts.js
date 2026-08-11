/* ============================================================
   TEMPLATE OS — MULTI-PARSER ATS AUDIT
   ------------------------------------------------------------
   Phase 27. A deterministic, dependency-free audit of the actual PDF text
   layer emitted by the owned writer. It intentionally does NOT claim to be
   Workday/Greenhouse/etc. Instead it models three common extraction styles:

     1. content-stream order (semantic PDF order)
     2. spatial row-major order (top-to-bottom, then left-to-right)
     3. visual column-major order (left region before right region)

   The goal is parser robustness, not vendor-name theatre.
   ============================================================ */
import { renderTemplatePdf, pdfEncodeText } from './pdfWriter.js';
import { normalizeStructuredContent } from './compiler.js';
import { scoreReadingOrder } from './shape.js';
import { pdfFieldRecovery } from './pdfValidation.js';

export const MULTI_PARSER_ATS_VERSION = 'multi-parser-ats-v1-owned-pdf';

const WINANSI_DECODE = Object.freeze({
  128: '€', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡', 136: 'ˆ', 137: '‰',
  138: 'Š', 139: '‹', 140: 'Œ', 142: 'Ž', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•',
  150: '–', 151: '—', 152: '˜', 153: '™', 154: 'š', 155: '›', 156: 'œ', 158: 'ž', 159: 'Ÿ',
});

function decodePdfLiteral(input = '') {
  return String(input)
    .replace(/\\([0-7]{1,3})/g, (_m, oct) => { const b = parseInt(oct, 8); return WINANSI_DECODE[b] || String.fromCharCode(b); })
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
}

/** Parse the text-placement operators emitted by our deterministic PDF writer. */
export function parseOwnedPdfTextItems(bytes) {
  let raw = '';
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) raw += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)));
  const streams = [...raw.matchAll(/stream\n([\s\S]*?)endstream/g)].map((m) => m[1]);
  const pages = [];
  const itemRe = /BT\s+\/([A-Z0-9]+)\s+([0-9.]+)\s+Tf\s+(-?[0-9.]+)\s+(-?[0-9.]+)\s+Td\s+\(((?:\\.|[^\\)])*)\)\s+Tj\s+ET/g;
  for (const stream of streams) {
    const items = [];
    let m;
    while ((m = itemRe.exec(stream))) {
      items.push({ font: m[1], size: Number(m[2]), x: Number(m[3]), y: Number(m[4]), text: decodePdfLiteral(m[5]) });
    }
    if (items.length) pages.push(items);
  }
  return pages;
}

function rowMajor(items) {
  return [...items].sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 2.2) return dy;
    return a.x - b.x;
  });
}

function columnMajor(items) {
  if (items.length < 4) return rowMajor(items);
  const xs = [...new Set(items.map((x) => Number(x.x.toFixed(1))))].sort((a, b) => a - b);
  let split = null; let gap = 0;
  for (let i = 1; i < xs.length; i += 1) {
    const g = xs[i] - xs[i - 1];
    if (g > gap) { gap = g; split = (xs[i] + xs[i - 1]) / 2; }
  }
  /* Avoid inventing two columns from ordinary bullet indentation. */
  if (split == null || gap < 55) return rowMajor(items);
  const left = items.filter((x) => x.x < split);
  const right = items.filter((x) => x.x >= split);
  return [...rowMajor(left), ...rowMajor(right)];
}

function textForProfile(pages, profile) {
  return pages.map((items) => {
    const ordered = profile === 'spatial-row-major' ? rowMajor(items)
      : profile === 'visual-column-major' ? columnMajor(items)
        : items;
    return ordered.map((x) => x.text).join(' ');
  }).join('\n');
}

export const ATS_PARSER_PROFILES = Object.freeze([
  { id: 'semantic-stream', label: 'Semantic stream', description: 'Uses the PDF content-stream order emitted by Template OS.' },
  { id: 'spatial-row-major', label: 'Spatial row-major', description: 'Sorts positioned text top-to-bottom and then left-to-right.' },
  { id: 'visual-column-major', label: 'Visual column-major', description: 'Models parsers that consume the left visual region before the right.' },
]);

export function auditOwnedPdfAcrossParsers(compiled, structuredInput, { sizeId = 'a4' } = {}) {
  const structured = normalizeStructuredContent(structuredInput);
  const rendered = renderTemplatePdf(compiled, structured, { sizeId });
  const pages = parseOwnedPdfTextItems(rendered.bytes);
  const encoded = JSON.parse(JSON.stringify(structured), (_k, v) => typeof v === 'string' ? pdfEncodeText(v) : v);
  const expectedOrder = compiled.tree.sections.map((s) => s.key);
  const parsers = ATS_PARSER_PROFILES.map((profile) => {
    const text = textForProfile(pages, profile.id);
    const recovery = pdfFieldRecovery(encoded, text);
    const order = scoreReadingOrder(encoded, pdfEncodeText(text), expectedOrder);
    return {
      ...profile,
      integrity: recovery.integrity,
      criticalOk: recovery.criticalOk,
      orderScore: order.score,
      misplaced: order.misplaced,
      extractedChars: text.length,
      pass: recovery.criticalOk && recovery.integrity >= 90 && order.score >= 70,
    };
  });
  const minIntegrity = Math.min(...parsers.map((p) => p.integrity));
  const minOrderScore = Math.min(...parsers.map((p) => p.orderScore));
  const medianOrder = [...parsers.map((p) => p.orderScore)].sort((a, b) => a - b)[1];
  const allCritical = parsers.every((p) => p.criticalOk);
  const semantic = parsers.find((p) => p.id === 'semantic-stream');
  let robustness = 'DESIGN_FORWARD';
  if (allCritical && minIntegrity >= 90 && minOrderScore >= 88) robustness = compiled.tree.layoutType === 'single-column' ? 'VERY_HIGH' : 'HIGH';
  else if (allCritical && minIntegrity >= 90 && medianOrder >= 82 && (semantic?.orderScore || 0) >= 95) robustness = 'HIGH';
  else if (allCritical && minIntegrity >= 80 && medianOrder >= 70) robustness = 'BALANCED';
  return {
    version: MULTI_PARSER_ATS_VERSION,
    sizeId,
    pageCount: rendered.pageCount,
    layoutType: compiled.tree.layoutType,
    minIntegrity,
    minOrderScore,
    medianOrder,
    allCritical,
    robustness,
    parsers,
    note: 'Parser profiles are deterministic extraction models, not claims about named ATS vendors.',
  };
}

export default { MULTI_PARSER_ATS_VERSION, ATS_PARSER_PROFILES, parseOwnedPdfTextItems, auditOwnedPdfAcrossParsers };
