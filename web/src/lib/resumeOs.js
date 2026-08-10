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
  compileBullet: (facts) => api.post('/api/resume-os/bullet/compile', { facts }),
  quantify: (text) => api.post('/api/resume-os/bullet/quantify', { text }),
  atsSimulate: (payload) => api.post('/api/resume-os/ats-simulate', payload),
  certification: () => api.get('/api/resume-os/templates/certification'),
  exportText: (doc) => api.post('/api/resume-os/export/text', { doc }),
  collegeOverview: (collegeId) => api.get(`/api/resume-os/college/overview?collegeId=${encodeURIComponent(collegeId || '')}`),
};

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
