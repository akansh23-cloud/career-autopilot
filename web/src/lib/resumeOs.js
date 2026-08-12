/* ============================================================================
   resumeOs.js — Resume OS V3 client layer
   ----------------------------------------------------------------------------
   • ResumeOsApi: thin wrappers over the server's deterministic V3 engine.
     ALL scoring / matching / truth auditing stays backend-owned.
   • Local user-scoped cache of the working document so the Studio works
     instantly and survives refresh when the DB is off (server remains the
     canonical store when signed in with persistence).
   • Re-exports the ONE canonical document model from the server engine —
     the client never grows a competing schema.
   ========================================================================== */
import { api } from './api.js';
export {
  normalizeResumeDocument, emptyResumeDocument, toRendererStructured, toPlainText,
  makeId, PROVENANCE, RESUME_DOCUMENT_VERSION, collectBullets, normalizeBullet,
} from '../../../server/utils/resume/resumeDocument.js';
export { extractTextFromHtml, simulateAtsParse } from '../../../server/utils/resume/atsParseSimulator.js';

const KEY = 'careerAutopilot.resumeOs.v3';
let currentUserKey = 'guest';
const normKey = (u) => String(u?.email || u?.id || 'guest').trim().toLowerCase().replace(/[^a-z0-9@._-]+/g, '_') || 'guest';
export function setResumeOsUser(user) { currentUserKey = normKey(user); }
const scoped = () => `${KEY}:${currentUserKey}`;

export function getCachedResumeOs() {
  if (typeof window === 'undefined') return null;
  try { const raw = window.localStorage.getItem(scoped()); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function cacheResumeOs(patch) {
  if (typeof window === 'undefined') return patch;
  try {
    const next = { ...(getCachedResumeOs() || {}), ...patch, cachedAt: new Date().toISOString() };
    window.localStorage.setItem(scoped(), JSON.stringify(next));
    return next;
  } catch { return patch; }
}
export function clearCachedResumeOs() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(scoped()); } catch { /* noop */ }
}

export const ResumeOsApi = {
  masterProfile: () => api.get('/api/resume-os/master-profile'),
  list: () => api.get('/api/resume-os/documents'),
  get: (docId) => api.get(`/api/resume-os/documents/${encodeURIComponent(docId)}`),
  save: (doc) => api.post('/api/resume-os/documents', { doc }),
  remove: (docId) => api.del(`/api/resume-os/documents/${encodeURIComponent(docId)}`),
  create: (payload) => api.post('/api/resume-os/create', payload),
  variant: (payload) => api.post('/api/resume-os/variants', payload),
  snapshot: (payload) => api.post('/api/resume-os/snapshots', payload),
  restore: (docId, index) => api.post('/api/resume-os/snapshots/restore', { docId, index }),
  compile: (payload) => api.post('/api/resume-os/compile', payload),
  tailor: (payload) => api.post('/api/resume-os/tailor-v3', payload),
  /* V4 — canonical zero-AI job tailoring package */
  tailorForJob: (payload) => api.post('/api/resume-os/tailor-for-job', payload),
  /* Narrative Intelligence — evidence-driven content generation */
  enhance: (payload) => api.post('/api/resume-os/enhance', payload),
  tailorNarrative: (payload) => api.post('/api/resume-os/tailor-narrative', payload),
  narrativePreview: (payload) => api.post('/api/resume-os/narrative/preview', payload),
  compileSummary: (payload) => api.post('/api/resume-os/summary/compile', payload),
  recommendTemplates: (payload) => api.post('/api/resume-os/templates/recommend', payload),
  autofit: (payload) => api.post('/api/resume-os/autofit', payload),
  assist: (payload) => api.post('/api/resume-os/assist', payload),
  compileBullet: (facts) => api.post('/api/resume-os/bullet/compile', { facts }),
  quantify: (text) => api.post('/api/resume-os/bullet/quantify', { text }),
  atsSimulate: (payload) => api.post('/api/resume-os/ats-simulate', payload),
  certification: () => api.get('/api/resume-os/templates/certification'),
  exportText: (doc) => api.post('/api/resume-os/export/text', { doc }),
  collegeOverview: (collegeId) => api.get(`/api/resume-os/college/overview?collegeId=${encodeURIComponent(collegeId || '')}`),
};

/* Real DOCX download (server-generated WordprocessingML, editable). */
export async function downloadRealDocx(doc) {
  const m = typeof document !== 'undefined' && document.cookie.match(/(?:^|;\s*)ca_csrf=([^;]+)/);
  const res = await fetch('/api/resume-os/export/docx', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(m ? { 'X-CSRF-Token': decodeURIComponent(m[1]) } : {}) },
    body: JSON.stringify({ doc }),
  });
  if (!res.ok) throw new Error('DOCX export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${(doc.title || 'resume').replace(/[^\w.-]+/g, '_')}.docx`; a.click();
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------------------
   Deterministic import extraction — PDF (pdfjs), DOCX (mammoth), TXT.
   Libraries are lazy-loaded so the Studio bundle stays lean; no AI anywhere.
--------------------------------------------------------------------------- */
export async function extractTextFromFile(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.txt') || file.type === 'text/plain') {
    return { ok: true, kind: 'txt', text: await file.text() };
  }
  if (name.endsWith('.docx') || file.type.includes('officedocument.wordprocessingml')) {
    const mammoth = await import('mammoth/mammoth.browser.js');
    const buf = await file.arrayBuffer();
    const out = await (mammoth.default || mammoth).extractRawText({ arrayBuffer: buf });
    return { ok: true, kind: 'docx', text: String(out.value || '') };
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      /* group items by line (y position) so structure survives extraction */
      let lastY = null; let line = [];
      for (const it of tc.items) {
        const y = Math.round(it.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line.join(' ')); line = []; }
        line.push(it.str); lastY = y;
      }
      if (line.length) lines.push(line.join(' '));
      lines.push('');
    }
    return { ok: true, kind: 'pdf', text: lines.join('\n').replace(/[ \t]+\n/g, '\n') };
  }
  return { ok: false, kind: 'unsupported', text: '' };
}

/* Validate an exported PDF blob by re-parsing it with pdfjs and checking
   that the document's critical content survived — REAL PDF validation,
   not just an HTML simulation. */
export async function validatePdfBlob(blob, doc) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const buf = await blob.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let text = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    text += tc.items.map((i) => i.str).join(' ') + '\n';
  }
  const { measureParseIntegrity } = await import('../../../server/utils/resume/atsParseSimulator.js');
  return { ...measureParseIntegrity(doc, text), pages: pdf.numPages };
}

/* Small pure helpers the Studio editor uses -------------------------------- */
export function updateItemInSection(doc, section, itemId, patch) {
  const list = (doc[section] || []).map((it) => (it.id === itemId ? { ...it, ...patch } : it));
  return { ...doc, [section]: list };
}
export function removeItemFromSection(doc, section, itemId) {
  return { ...doc, [section]: (doc[section] || []).filter((it) => it.id !== itemId) };
}
export function moveItemInSection(doc, section, itemId, dir) {
  const list = [...(doc[section] || [])];
  const i = list.findIndex((it) => it.id === itemId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return doc;
  [list[i], list[j]] = [list[j], list[i]];
  return { ...doc, [section]: list };
}
export function moveSectionOrder(doc, key, dir) {
  const order = [...(doc.sectionOrder || [])];
  const i = order.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return doc;
  [order[i], order[j]] = [order[j], order[i]];
  return { ...doc, sectionOrder: order };
}
export function dismissCheck(doc, checkId, mode = 'ignored') {
  const meta = { ...(doc.metadata || {}) };
  const dismissed = { ...(meta.dismissedChecks || {}) };
  dismissed[checkId] = mode; // 'ignored' | 'intentional'
  return { ...doc, metadata: { ...meta, dismissedChecks: dismissed } };
}
export function isCheckDismissed(doc, checkId) {
  return !!doc?.metadata?.dismissedChecks?.[checkId];
}
