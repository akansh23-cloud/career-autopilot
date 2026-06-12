// Project Sync — background bridge between the localStorage project store
// (lib/projectStore.js) and the server-owned store (/api/projects/store/*).
//
// Design (Market-Readiness Gap Sprint, Phase 1):
// - localStorage stays the cache and the synchronous source for the UI.
// - When signed in AND the server DB is on, the server becomes the source
//   of truth: on load we pull + merge (last-write-wins per project by
//   updatedAt, same rule the server applies), on save we push (debounced).
// - First sync after login automatically uploads existing local projects
//   (the migration path) — the sync endpoint handles this implicitly.
// - Offline-safe: a failed push sets a pending flag in localStorage; the
//   next save, load, or browser 'online' event retries it.
// - Zero behavior change when logged out or when the server answers
//   ok:false reason:'db_off' — we simply stop pushing until conditions
//   change, and the local store keeps working exactly as today.
import { csrfHeaders } from './csrf.js';

const PENDING_KEY = 'careerAutopilot.projectSync.pending.v1';
const PUSH_DEBOUNCE_MS = 2500;

let enabled = false;        // signed-in?
let serverAvailable = true; // flips false on db_off so we stop hammering
let pushTimer = null;
let getLocal = null;        // () => projects[]  (injected by projectStore)
let setLocal = null;        // (projects[]) => void (injected by projectStore)
let userKeyFn = null;       // () => scoped key fn for the pending flag

function scopedPendingKey() {
  try { return userKeyFn ? userKeyFn(PENDING_KEY) : PENDING_KEY; } catch { return PENDING_KEY; }
}
function setPending(on) {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.setItem(scopedPendingKey(), '1');
    else window.localStorage.removeItem(scopedPendingKey());
  } catch { /* storage unavailable — pending is best-effort */ }
}
function hasPending() {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(scopedPendingKey()) === '1'; } catch { return false; }
}

async function postSync(projects) {
  const r = await fetch('/api/projects/store/sync', {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ projects }),
  });
  if (!r.ok) throw new Error(`sync http ${r.status}`);
  return r.json();
}

/* Merge server projects into the local list: last-write-wins per project
   id by updatedAt — identical semantics to the server-side merge so both
   sides converge on the same set. Local-only projects are kept (they are
   already part of the payload we pushed). */
export function mergeProjects(local = [], server = []) {
  const byId = new Map();
  for (const p of Array.isArray(local) ? local : []) { if (p && p.id) byId.set(p.id, p); }
  for (const p of Array.isArray(server) ? server : []) {
    if (!p || !p.id) continue;
    const cur = byId.get(p.id);
    if (!cur) { byId.set(p.id, p); continue; }
    const curAt = new Date(cur.updatedAt || 0).getTime();
    const srvAt = new Date(p.updatedAt || 0).getTime();
    if (srvAt > curAt) byId.set(p.id, p);
  }
  // Newest first, matching the local store's unshift ordering convention.
  return [...byId.values()].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

/* Full round trip: push local set, receive merged set, write it back.
   Returns true when the server accepted the sync. */
export async function syncNow() {
  if (!enabled || !serverAvailable || typeof window === 'undefined') return false;
  if (!getLocal || !setLocal) return false;
  try {
    const local = getLocal();
    const result = await postSync(local);
    if (!result || result.ok === false) {
      if (result?.reason === 'db_off') serverAvailable = false; // local-first mode; stop pushing this session
      return false;
    }
    const merged = mergeProjects(local, result.projects || []);
    setLocal(merged);
    setPending(false);
    return true;
  } catch {
    setPending(true); // offline or transient failure — retry on next trigger
    return false;
  }
}

/* Debounced push used by every local save/delete. */
export function queueProjectsPush() {
  if (!enabled || !serverAvailable || typeof window === 'undefined') return;
  setPending(true);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; syncNow(); }, PUSH_DEBOUNCE_MS);
}

/* Wire-up called once by projectStore. `hooks` injects the local read/write
   so this module never creates a circular import at load time. */
export function initProjectSync({ user, readProjects, writeProjects, scopeKey } = {}) {
  getLocal = readProjects;
  setLocal = writeProjects;
  userKeyFn = scopeKey || null;
  enabled = !!(user && (user.email || user.id));
  serverAvailable = true; // re-probe per session; db_off flips it back off
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  if (typeof window !== 'undefined' && !window.__caProjectSyncOnline) {
    window.__caProjectSyncOnline = true;
    window.addEventListener('online', () => { if (enabled && hasPending()) syncNow(); });
  }
}

export function projectSyncEnabled() { return enabled && serverAvailable; }
export function hasPendingProjectSync() { return hasPending(); }

export default { initProjectSync, syncNow, queueProjectsPush, mergeProjects, projectSyncEnabled, hasPendingProjectSync };
