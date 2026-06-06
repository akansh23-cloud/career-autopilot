import { inferRoleFromResume } from './roles.js';

const KEY = 'careerAutopilot.resume.v1';
const JOB_KEY = 'careerAutopilot.pendingJobSearch.v1';
const JOB_RESULTS_KEY = 'careerAutopilot.jobResults.v1';
const SELECTED_JOB_KEY = 'careerAutopilot.selectedJob.v1';
const TEMPLATE_KEY = 'careerAutopilot.selectedTemplate.v1';
const CUSTOM_TPL_KEY = 'careerAutopilot.customTemplate.v1';
let currentUserKey = 'guest';
function normalizeUserKey(user) {
  const raw = user?.email || user?.id || 'guest';
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9@._-]+/g, '_') || 'guest';
}
export function setResumeStoreUser(user) { currentUserKey = normalizeUserKey(user); }
function scoped(base) { return `${base}:${currentUserKey}`; }

const fallback = {
  text: '',
  fileName: '',
  targetRole: '',
  analysis: null,
  analysedAt: '',
  updatedAt: '',
};

function safeRead(key) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(scoped(key)) || (currentUserKey !== 'guest' ? window.localStorage.getItem(key) : null);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWrite(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(scoped(key), JSON.stringify(value));
  } catch {
    // Browser storage may be blocked/full. The app should still keep in-memory state.
  }
}

function safeRemove(key) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(scoped(key)); } catch {}
}

async function patchServerState(patch) {
  try {
    await fetch('/api/user/state', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch {}
}
async function saveResumeAnalysisToServer(resume) {
  try {
    await fetch('/api/resume/save-analysis', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume }),
    });
  } catch {}
}
export async function hydrateResumeFromServer() {
  try {
    const r = await fetch('/api/user/state', { credentials: 'include' });
    if (!r.ok) return getStoredResume();
    const d = await r.json();
    const resume = d?.state?.resume;
    if (resume && Object.keys(resume).length) {
      safeWrite(KEY, { ...fallback, ...resume, updatedAt: resume.updatedAt || new Date().toISOString() });
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('career-resume-updated', { detail: getStoredResume() }));
    }
  } catch {}
  return getStoredResume();
}

export function getStoredResume() {
  return { ...fallback, ...(safeRead(KEY) || {}) };
}

export function saveStoredResume(patch) {
  const next = { ...getStoredResume(), ...patch, updatedAt: new Date().toISOString() };
  safeWrite(KEY, next);
  patchServerState({ resume: next });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('career-resume-updated', { detail: next }));
  return next;
}

export function saveResumeAnalysis(analysis) {
  const next = saveStoredResume({ analysis, analysedAt: new Date().toISOString() });
  saveResumeAnalysisToServer(next);
  return next;
}

export function clearStoredResume() {
  safeRemove(KEY);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('career-resume-updated', { detail: fallback }));
}

export function getResumeSearchRole() {
  const r = getStoredResume();
  return (r.targetRole || r.analysis?.recommendedRole || inferRoleFromResume(r.text || '') || '').trim();
}

export function hasResumeAnalysis() {
  const r = getStoredResume();
  return Boolean(r.text && r.analysis && r.analysedAt);
}

export function queueResumeJobSearch(role) {
  const r = getStoredResume();
  const searchRole = (role || r.targetRole || r.analysis?.recommendedRole || inferRoleFromResume(r.text || '') || '').trim();
  const payload = { role: searchRole, fromResume: true, queuedAt: new Date().toISOString() };
  safeWrite(JOB_KEY, payload);
  return payload;
}

export function consumeQueuedResumeJobSearch() {
  const payload = safeRead(JOB_KEY);
  safeRemove(JOB_KEY);
  return payload;
}

export function getStoredJobResults() {
  return safeRead(JOB_RESULTS_KEY) || { status: 'idle', jobs: [], role: '', location: '', mode: 'Any', freshness: '7d', saved: {}, updatedAt: '' };
}

export function saveStoredJobResults(patch) {
  const next = { ...getStoredJobResults(), ...patch, updatedAt: new Date().toISOString() };
  safeWrite(JOB_RESULTS_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('career-jobs-updated', { detail: next }));
  return next;
}

export function clearStoredJobResults() {
  safeRemove(JOB_RESULTS_KEY);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('career-jobs-updated'));
}

export function saveSelectedJob(job) {
  safeWrite(SELECTED_JOB_KEY, { job, selectedAt: new Date().toISOString() });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('career-selected-job-updated', { detail: job }));
}

export function getSelectedJob() {
  return (safeRead(SELECTED_JOB_KEY) || {}).job || null;
}

export function getSelectedTemplate() {
  return (safeRead(TEMPLATE_KEY) || {}).id || '';
}
export function saveSelectedTemplate(id) {
  safeWrite(TEMPLATE_KEY, { id, updatedAt: new Date().toISOString() });
  return id;
}

export function getCustomTemplateSpec() {
  return safeRead(CUSTOM_TPL_KEY) || null;
}
export function saveCustomTemplateSpec(spec) {
  if (!spec) { safeRemove(CUSTOM_TPL_KEY); return null; }
  safeWrite(CUSTOM_TPL_KEY, spec);
  return spec;
}
