// Application Tracker — single source of truth.
//
// Previously the tracker board lived in an *unscoped* localStorage key that
// Jobs.jsx, Tracker.jsx and Growth.jsx each read/wrote independently, while the
// dashboard "Application funnel" read from a completely separate server summary.
// That meant: saving a job never showed up in the funnel, there was no remove
// action, and the board could bleed across users on a shared browser.
//
// This module centralizes everything, following the exact pattern used by
// projectStore.js: a per-user-scoped key, server persistence via the existing
// /api/user/state { tracker } field (no schema change needed), and a single
// 'career-tracker-updated' event every consumer listens to.
//
// The pure board helpers at the bottom (addJobToBoard, removeFromBoard,
// funnelFromBoard, trackerJobIdentity, …) have NO side effects and NO browser
// globals, so they can be unit-tested directly under `node --test`.

import { csrfHeaders } from './csrf.js';

const TRACKER_KEY = 'careerAutopilot.trackerBoard.v1';
const LEGACY_UNSCOPED_KEY = 'careerAutopilot.trackerBoard.v1';

export const COLUMN_ORDER = ['saved', 'applied', 'interview', 'offer'];
// Offer is intentionally NOT removable (final positive outcome — preserve it).
export const REMOVABLE_COLUMNS = ['saved', 'applied', 'interview'];

export const EMPTY_BOARD = { saved: [], applied: [], interview: [], offer: [] };
export const TRACKER_EVENT = 'career-tracker-updated';

let currentUserKey = 'guest';
function normalizeUserKey(user) {
  const raw = user?.email || user?.id || 'guest';
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9@._-]+/g, '_') || 'guest';
}
function scoped(base) { return `${base}:${currentUserKey}`; }

/* -------------------- pure helpers (no side effects) -------------------- */

const lc = (s = '') => String(s == null ? '' : s).trim().toLowerCase();

// Stable identity for a job, in priority order (spec #3):
//   1. externalJobId   2. source + url   3. url   4. company + title + location
export function trackerJobIdentity(job = {}) {
  const ext = job.externalJobId || job.externalId;
  if (ext) return `ext:${lc(ext)}`;
  const url = job.url || '';
  const source = job.source || '';
  if (source && url) return `su:${lc(source)}|${lc(url)}`;
  if (url) return `u:${lc(url)}`;
  const company = job.company || '';
  const title = job.title || job.role || '';
  const location = job.location || '';
  return `ctl:${lc(company)}|${lc(title)}|${lc(location)}`;
}

// Coerce any stored value into a complete, array-valued board.
export function normalizeBoard(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const out = { saved: [], applied: [], interview: [], offer: [] };
  for (const col of COLUMN_ORDER) {
    out[col] = Array.isArray(b[col]) ? b[col].filter(Boolean) : [];
  }
  return out;
}

export function boardTotal(board) {
  const b = normalizeBoard(board);
  return COLUMN_ORDER.reduce((n, c) => n + b[c].length, 0);
}

// Has this job been tracked already, in ANY column?
export function findCard(board, identity) {
  const b = normalizeBoard(board);
  for (const col of COLUMN_ORDER) {
    const card = b[col].find((c) => String(c.id) === String(identity));
    if (card) return { card, column: col };
  }
  return null;
}

function cardFromJob(job, identity) {
  return {
    id: identity,
    role: job.title || job.role || 'Role',
    company: job.company || '',
    url: job.url || '',
    source: job.source || '',
    location: job.location || '',
    externalJobId: job.externalJobId || job.externalId || '',
    addedAt: new Date().toISOString(),
  };
}

// Add a job to the Saved column. Returns { board, status } where status is
// 'saved' (newly added) or 'duplicate' (already tracked — board unchanged).
export function addJobToBoard(board, job) {
  const b = normalizeBoard(board);
  const identity = trackerJobIdentity(job);
  if (findCard(b, identity)) return { board: b, status: 'duplicate', identity };
  return { board: { ...b, saved: [cardFromJob(job, identity), ...b.saved] }, status: 'saved', identity };
}

export function removeFromBoard(board, colId, id) {
  const b = normalizeBoard(board);
  if (!COLUMN_ORDER.includes(colId)) return b;
  return { ...b, [colId]: b[colId].filter((c) => String(c.id) !== String(id)) };
}

export function moveInBoard(board, colId, id, dir) {
  const b = normalizeBoard(board);
  const cur = COLUMN_ORDER.indexOf(colId);
  const nextCol = COLUMN_ORDER[cur + dir];
  if (cur < 0 || !nextCol) return b;
  const card = b[colId].find((c) => String(c.id) === String(id));
  if (!card) return b;
  return {
    ...b,
    [colId]: b[colId].filter((c) => String(c.id) !== String(id)),
    [nextCol]: [{ ...card, movedAt: new Date().toISOString() }, ...b[nextCol]],
  };
}

// Funnel counts derived directly from the board — the shared truth the
// dashboard now reads instead of a disconnected server summary.
export function funnelFromBoard(board) {
  const b = normalizeBoard(board);
  return { saved: b.saved.length, applied: b.applied.length, interview: b.interview.length, offer: b.offer.length, rejected: 0 };
}

/* -------------------- storage layer (browser) -------------------- */

function readRaw(key) {
  if (typeof window === 'undefined') return null;
  try { const r = window.localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; }
}
function writeRaw(key, value) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

async function patchServerState(board) {
  if (typeof fetch === 'undefined') return;
  try {
    await fetch('/api/user/state', {
      method: 'PATCH', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tracker: board }),
    });
  } catch { /* local copy still authoritative */ }
}

export function setTrackerStoreUser(user) {
  currentUserKey = normalizeUserKey(user);
  if (typeof window === 'undefined' || !user) return;
  // One-time migration: lift any pre-scoping board into this user's scoped key
  // so existing saved jobs are never lost, then drop the leak-prone global key.
  try {
    const scopedExisting = readRaw(scoped(TRACKER_KEY));
    const legacy = readRaw(LEGACY_UNSCOPED_KEY);
    if (!scopedExisting && legacy && boardTotal(legacy) > 0) {
      writeRaw(scoped(TRACKER_KEY), normalizeBoard(legacy));
    }
    if (legacy) window.localStorage.removeItem(LEGACY_UNSCOPED_KEY);
  } catch { /* ignore */ }
}

export function getTrackerBoard() {
  return normalizeBoard(readRaw(scoped(TRACKER_KEY)));
}

export function saveTrackerBoard(board, { sync = true } = {}) {
  const next = normalizeBoard(board);
  writeRaw(scoped(TRACKER_KEY), next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TRACKER_EVENT, { detail: next }));
  if (sync) patchServerState(next);
  return next;
}

export async function hydrateTrackerFromServer() {
  if (typeof fetch === 'undefined') return getTrackerBoard();
  try {
    const r = await fetch('/api/user/state', { credentials: 'include' });
    if (!r.ok) return getTrackerBoard();
    const d = await r.json();
    const remote = d?.state?.tracker;
    // Only adopt the server copy when it actually has tracked jobs, so an empty
    // server record never wipes a board the user just built offline.
    if (remote && boardTotal(remote) > 0) saveTrackerBoard(remote, { sync: false });
  } catch { /* keep local */ }
  return getTrackerBoard();
}

export function getTrackerFunnel() { return funnelFromBoard(getTrackerBoard()); }
export function getTrackedCount() { return boardTotal(getTrackerBoard()); }

/* High-level mutations used by the views. */

// Save a job from the Jobs page. Returns { status: 'saved' | 'duplicate' }.
export function saveJobToTracker(job) {
  const { board, status } = addJobToBoard(getTrackerBoard(), job);
  if (status === 'saved') saveTrackerBoard(board);
  return { status, board };
}

export function addManualApplication({ role, company, url } = {}) {
  const title = String(role || '').trim();
  if (!title) return { status: 'invalid', board: getTrackerBoard() };
  // Manual entries get a unique identity so two different manual rows never collide.
  const job = { title, company: String(company || '').trim(), url: String(url || '').trim(), source: 'manual' };
  const identity = `${trackerJobIdentity(job)}|${Date.now().toString(36)}`;
  const b = getTrackerBoard();
  const card = cardFromJob(job, identity);
  return { status: 'saved', board: saveTrackerBoard({ ...b, saved: [card, ...b.saved] }) };
}

export function moveTrackerCard(colId, id, dir) {
  return saveTrackerBoard(moveInBoard(getTrackerBoard(), colId, id, dir));
}

export function removeTrackerCard(colId, id) {
  // Offer cards cannot be removed (spec #4).
  if (!REMOVABLE_COLUMNS.includes(colId)) return getTrackerBoard();
  return saveTrackerBoard(removeFromBoard(getTrackerBoard(), colId, id));
}
