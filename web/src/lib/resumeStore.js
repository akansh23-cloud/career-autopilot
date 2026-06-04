import { inferRoleFromResume } from './roles.js';

const KEY = 'careerAutopilot.resume.v1';
const JOB_KEY = 'careerAutopilot.pendingJobSearch.v1';

const fallback = {
  text: '',
  fileName: '',
  targetRole: '',
  updatedAt: '',
};

function safeRead(key) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWrite(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browser storage may be blocked/full. The app should still keep in-memory state.
  }
}

function safeRemove(key) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(key); } catch {}
}

export function getStoredResume() {
  return { ...fallback, ...(safeRead(KEY) || {}) };
}

export function saveStoredResume(patch) {
  const next = { ...getStoredResume(), ...patch, updatedAt: new Date().toISOString() };
  safeWrite(KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('career-resume-updated', { detail: next }));
  return next;
}

export function clearStoredResume() {
  safeRemove(KEY);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('career-resume-updated', { detail: fallback }));
}

export function getResumeSearchRole() {
  const r = getStoredResume();
  return (r.targetRole || inferRoleFromResume(r.text || '') || '').trim();
}

export function queueResumeJobSearch(role) {
  const r = getStoredResume();
  const searchRole = (role || r.targetRole || inferRoleFromResume(r.text || '') || '').trim();
  const payload = { role: searchRole, fromResume: true, queuedAt: new Date().toISOString() };
  safeWrite(JOB_KEY, payload);
  return payload;
}

export function consumeQueuedResumeJobSearch() {
  const payload = safeRead(JOB_KEY);
  safeRemove(JOB_KEY);
  return payload;
}
