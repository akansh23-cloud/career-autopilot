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
      method: 'PATCH', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(patch),
    });
  } catch {}
}
/* One-time repair for workspaces saved while the generator was overwriting the
   chosen project name with a generic "Production-grade <type> project for
   <role>" string. Where we still hold the recommendation the student clicked,
   we restore the real title and problem statement. Purely additive: a project
   without a recommendation, or with a title the student typed themselves, is
   left exactly as it is. */
const GENERIC_TITLE_RE = /^production-grade\s+.+\s+project\s+for\s+.+$/i;
function repairProjectIdentity(list = []) {
  let changed = false;
  const next = list.map((p) => {
    const rec = p && p.creator && p.creator.fromRecommendation;
    const recTitle = String(rec?.title || '').trim();
    if (!recTitle) return p;
    const current = String(p.title || '').trim();
    if (current === recTitle) return p;
    if (current && !GENERIC_TITLE_RE.test(current)) return p; // deliberately renamed — leave alone
    changed = true;
    const recSummary = String(rec.summary || '').trim();
    return { ...p, title: recTitle, ...(recSummary ? { problemStatement: recSummary } : {}) };
  });
  return { list: next, changed };
}

export async function hydrateProjectsFromServer() {
  try {
    const r = await fetch('/api/user/state', { credentials: 'include' });
    if (!r.ok) return getProjects();
    const d = await r.json();
    const projects = d?.state?.projects;
    if (Array.isArray(projects)) write(PROJECTS_KEY, projects, EV.projects);
  } catch {}
  const { list, changed } = repairProjectIdentity(getProjects());
  if (changed) {
    write(PROJECTS_KEY, list, EV.projects);
    patchServerState({ projects: list });
  }
  return getProjects();
}

function read(key) {
  if (typeof window === 'undefined') return null;
  // Read ONLY the user-scoped key — no legacy unscoped fallback (cross-user leak).
  try { const r = window.localStorage.getItem(scoped(key)); return r ? JSON.parse(r) : null; } catch { return null; }
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
/* ---- duplicate prevention (#9) ----
   Dedupe a project by the authenticated-user-scoped store + a normalized key of
   (title, target role, source job/title). Used so regenerating or re-saving the
   same project never spawns a second workspace. */
function normKey(s = '') { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
/* A stable identifier for the IDEA behind a creator-built project.
   Recommendation ids are regenerated on every discover run (they carry a salt
   + index), so they cannot be used. The capability archetype + domain are
   deterministic for a given idea, which makes this stable across regenerations
   while still separating two distinct ideas that happen to share a title. */
function recFingerprint(p = {}) {
  const rec = (p.creator && p.creator.fromRecommendation) || {};
  const cap = rec.novelty?.capabilityId || p.novelty?.capabilityId || '';
  const dom = rec.domain || p.domain || '';
  return cap && dom ? `${normKey(cap)}#${normKey(dom)}` : '';
}
function dedupeKey(p = {}) {
  return [normKey(p.title), normKey(p.targetRole || p.role), normKey(p.sourceJob?.title || p.jobId || ''), recFingerprint(p)].join('|');
}
export function findDuplicateProject(project, list = getProjects()) {
  if (!project || !normKey(project.title)) return null; // need a real title to compare
  const key = dedupeKey(project);
  return list.find((p) => p.id !== project.id && dedupeKey(p) === key) || null;
}
/* saveProjectDetailed — the real implementation.
   Returns { project, merged, mergedWith, created } so callers can TELL THE
   USER what happened. The old behaviour folded a new project into a matching
   existing one and returned it as if it were new: the student clicked
   "Build this" a second time, got silently redirected into project #1, and
   concluded the app had stopped generating projects. The fold is still the
   right default (it protects progress), but it must never be invisible. */
export function saveProjectDetailed(project) {
  const now = new Date().toISOString();
  const list = getProjects();
  let idx = list.findIndex((p) => p.id === project.id);
  let mergedWith = null;
  // A NEW project (no id match) that matches an existing one by normalized
  // title + target role + source job folds into that project rather than
  // creating a duplicate workspace. User progress (tasks/checklist) is kept.
  if (idx < 0) {
    const dup = findDuplicateProject(project, list);
    if (dup) {
      idx = list.findIndex((p) => p.id === dup.id);
      mergedWith = { id: dup.id, title: dup.title || 'your existing project' };
      project = {
        ...dup, ...project, id: dup.id, createdAt: dup.createdAt,
        tasks: project.tasks || dup.tasks,
        checklist: project.checklist || dup.checklist,
      };
    }
  }
  const existed = idx >= 0;
  const next = { ...project, updatedAt: now };
  next.createdAt = next.createdAt || (existed ? list[idx].createdAt : now) || now;
  next.proofScore = computeProofScore(next);
  if (existed) list[idx] = next; else list.unshift(next);
  write(PROJECTS_KEY, list, EV.projects);
  patchServerState({ projects: list });
  return {
    project: next,
    merged: !!mergedWith,
    mergedWith,
    created: !existed,
  };
}

/* Back-compatible wrapper — returns the project, as every existing caller
   expects. Callers that create NEW projects should prefer
   saveProjectDetailed() so they can surface a merge. */
export function saveProject(project) {
  return saveProjectDetailed(project).project;
}

/* Force a genuinely separate workspace even when the title collides, by
   disambiguating the title. Used by the "create it separately" escape hatch
   offered when a build merges into an existing project. */
export function saveProjectAsNew(project) {
  const list = getProjects();
  const base = String(project.title || 'Untitled project').trim();
  let title = base;
  let n = 2;
  const taken = new Set(list.map((p) => String(p.title || '').trim().toLowerCase()));
  while (taken.has(title.toLowerCase())) { title = `${base} (${n})`; n += 1; }
  return saveProjectDetailed({ ...project, id: uid('proj'), title, createdAt: new Date().toISOString() }).project;
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
import { csrfHeaders } from './csrf.js';
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
