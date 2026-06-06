// Career Project Studio — localStorage persistence layer.
// Stores generated/saved project workspaces, published sandbox projects,
// partner-match requests, and a transient "seed" handed off from a job card.

const PROJECTS_KEY = 'careerAutopilot.projects.v1';
const PARTNERS_KEY = 'careerAutopilot.partnerRequests.v1';
const SEED_KEY = 'careerAutopilot.projectSeed.v1';
let currentUserKey = 'guest';
function normalizeUserKey(user) {
  const raw = user?.email || user?.id || 'guest';
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9@._-]+/g, '_') || 'guest';
}
export function setProjectStoreUser(user) { currentUserKey = normalizeUserKey(user); }
function scoped(base) { return `${base}:${currentUserKey}`; }

const EV = {
  projects: 'career-projects-updated',
  partners: 'career-partners-updated',
};

async function patchServerState(patch) {
  try {
    await fetch('/api/user/state', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch {}
}
export async function hydrateProjectsFromServer() {
  try {
    const r = await fetch('/api/user/state', { credentials: 'include' });
    if (!r.ok) return getProjects();
    const d = await r.json();
    const projects = d?.state?.projects;
    if (Array.isArray(projects)) write(PROJECTS_KEY, projects, EV.projects);
  } catch {}
  return getProjects();
}

function read(key) {
  if (typeof window === 'undefined') return null;
  try { const r = window.localStorage.getItem(scoped(key)) || (currentUserKey !== 'guest' ? window.localStorage.getItem(key) : null); return r ? JSON.parse(r) : null; } catch { return null; }
}
function write(key, value, evName) {
  if (typeof window === 'undefined') return value;
  try { window.localStorage.setItem(scoped(key), JSON.stringify(value)); } catch {}
  if (evName) window.dispatchEvent(new CustomEvent(evName, { detail: value }));
  return value;
}
export function uid(prefix = 'p') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/* ---------------- Projects (workspaces) ---------------- */
export function getProjects() {
  const list = read(PROJECTS_KEY);
  return Array.isArray(list) ? list : [];
}
export function getProject(id) {
  return getProjects().find((p) => p.id === id) || null;
}
export function saveProject(project) {
  const now = new Date().toISOString();
  const list = getProjects();
  const idx = list.findIndex((p) => p.id === project.id);
  const next = { ...project, updatedAt: now };
  if (idx >= 0) list[idx] = next;
  else { next.createdAt = next.createdAt || now; list.unshift(next); }
  next.proofScore = computeProofScore(next);
  if (idx >= 0) list[idx] = next; else list[0] = next;
  write(PROJECTS_KEY, list, EV.projects);
  patchServerState({ projects: list });
  return next;
}
export function deleteProject(id) {
  const next = getProjects().filter((p) => p.id !== id);
  write(PROJECTS_KEY, next, EV.projects);
  patchServerState({ projects: next });
}
export function getPublishedProjects() {
  return getProjects().filter((p) => p.published);
}

/* ---------------- Proof-of-work score (Part 5) ----------------
   Delegates to lib/proofScore.js (weighted breakdown). Still returns a number
   so every existing caller keeps working. */
import { proofScore as _proofScore, proofBreakdown as _proofBreakdown } from './proofScore.js';
export function computeProofScore(p = {}) { return _proofScore(p); }
export function proofScoreBreakdown(p = {}) { return _proofBreakdown(p); }
export function taskProgress(p = {}) {
  const tasks = p.tasks || [];
  if (!tasks.length) return 0;
  return Math.round((tasks.filter((t) => t.status === 'done').length / tasks.length) * 100);
}

/* ---------------- Job → Studio seed handoff ---------------- */
export function saveStudioSeed(seed) {
  return write(SEED_KEY, { ...seed, at: new Date().toISOString() });
}
export function consumeStudioSeed() {
  const s = read(SEED_KEY);
  if (typeof window !== 'undefined') { try { window.localStorage.removeItem(scoped(SEED_KEY)); } catch {} }
  return s;
}
export function peekStudioSeed() { return read(SEED_KEY); }

/* ---------------- Partner-match requests ---------------- */
export function getPartnerRequests() {
  const list = read(PARTNERS_KEY);
  return Array.isArray(list) ? list : [];
}
export function savePartnerRequest(reqObj) {
  const list = getPartnerRequests();
  const now = new Date().toISOString();
  const idx = list.findIndex((r) => r.id === reqObj.id);
  const next = { ...reqObj, updatedAt: now };
  if (idx >= 0) list[idx] = next;
  else { next.id = next.id || uid('req'); next.createdAt = now; list.unshift(next); }
  write(PARTNERS_KEY, list, EV.partners);
  return next;
}
export function deletePartnerRequest(id) {
  write(PARTNERS_KEY, getPartnerRequests().filter((r) => r.id !== id), EV.partners);
}

export const PROJECT_EVENTS = EV;
