// Career Project Studio — localStorage persistence layer.
// Stores generated/saved project workspaces, published sandbox projects,
// partner-match requests, and a transient "seed" handed off from a job card.

const PROJECTS_KEY = 'careerAutopilot.projects.v1';
const PARTNERS_KEY = 'careerAutopilot.partnerRequests.v1';
const SEED_KEY = 'careerAutopilot.projectSeed.v1';

const EV = {
  projects: 'career-projects-updated',
  partners: 'career-partners-updated',
};

function read(key) {
  if (typeof window === 'undefined') return null;
  try { const r = window.localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; }
}
function write(key, value, evName) {
  if (typeof window === 'undefined') return value;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
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
  return next;
}
export function deleteProject(id) {
  write(PROJECTS_KEY, getProjects().filter((p) => p.id !== id), EV.projects);
}
export function getPublishedProjects() {
  return getProjects().filter((p) => p.published);
}

/* ---------------- Proof-of-work score ---------------- */
export function computeProofScore(p = {}) {
  let s = 0;
  if (p.githubUrl && p.githubUrl.trim()) s += 20;
  if (p.liveDemoUrl && p.liveDemoUrl.trim()) s += 20;
  if (p.readme && p.readme.trim().length > 40) s += 15;
  const checklist = p.checklist || [];
  const pct = checklist.length ? checklist.filter((c) => c.done).length / checklist.length : 0;
  if (pct >= 0.7) s += 20;
  if ((p.screenshots || []).length > 0) s += 10;
  if (p.interviewQuestions && p.interviewQuestions.length > 0) s += 10;
  if (p.linkedinPost && p.linkedinPost.trim().length > 20) s += 5;
  return Math.min(100, s);
}
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
  if (typeof window !== 'undefined') { try { window.localStorage.removeItem(SEED_KEY); } catch {} }
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
