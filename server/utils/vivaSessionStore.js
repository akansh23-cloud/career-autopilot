/* ============================================================
   VIVA SESSION STORE
   ------------------------------------------------------------
   Holds two short-lived, server-only things:
     1. A cache of a candidate's SANITIZED repo files + authorship result,
        populated when they analyze a repo. The viva generates probes from this
        server-side so answer keys and source never round-trip through the
        client (integrity).
     2. Active viva sessions (probes WITH answer keys, start time, claimed
        skills). The client only ever sees answer-key-stripped probes.

   In-memory with TTL by default. For multi-instance production, back this with
   the DB / Redis via setStore(); the routes and engine are unchanged.
   ============================================================ */
import crypto from 'crypto';

const FILE_TTL_MS = 60 * 60 * 1000;       // analyzed files usable for 1h
const SESSION_TTL_MS = 20 * 60 * 1000;    // a viva session lives 20m

const _files = new Map();     // key -> { files, authorship, repoFullName, at }
const _sessions = new Map();  // sessionId -> { userId, repoFullName, probes, skills, startedAt, submitted }
let _store = null;            // optional external store

export function setStore(store) { _store = store || null; }

function fileKey(userId, repoFullName) { return `${userId}::${repoFullName}`; }
function sweep(map, ttl) {
  const now = Date.now();
  for (const [k, v] of map) if (now - (v.at || v.startedAt || 0) > ttl) map.delete(k);
}

export function cacheRepoFiles(userId, repoFullName, files, authorship) {
  if (!userId || !repoFullName) return;
  const rec = { files: files || {}, authorship: authorship || {}, repoFullName, at: Date.now() };
  if (_store?.cacheRepoFiles) return _store.cacheRepoFiles(userId, repoFullName, rec);
  sweep(_files, FILE_TTL_MS);
  _files.set(fileKey(userId, repoFullName), rec);
}

export function getRepoFiles(userId, repoFullName) {
  if (_store?.getRepoFiles) return _store.getRepoFiles(userId, repoFullName);
  sweep(_files, FILE_TTL_MS);
  const rec = _files.get(fileKey(userId, repoFullName));
  if (!rec || Date.now() - rec.at > FILE_TTL_MS) return null;
  return rec;
}

export function createSession({ userId, repoFullName, probes, skills }) {
  const sessionId = 'viva_' + crypto.randomBytes(16).toString('hex');
  const rec = { userId, repoFullName, probes, skills: skills || [], startedAt: Date.now(), submitted: false };
  if (_store?.createSession) _store.createSession(sessionId, rec);
  else { sweep(_sessions, SESSION_TTL_MS); _sessions.set(sessionId, rec); }
  return { sessionId, ...rec };
}

export function getSession(sessionId) {
  if (_store?.getSession) return _store.getSession(sessionId);
  const rec = _sessions.get(sessionId);
  if (!rec) return null;
  if (Date.now() - rec.startedAt > SESSION_TTL_MS) { _sessions.delete(sessionId); return null; }
  return rec;
}

export function closeSession(sessionId) {
  if (_store?.closeSession) return _store.closeSession(sessionId);
  const rec = _sessions.get(sessionId);
  if (rec) rec.submitted = true;
}

export default { setStore, cacheRepoFiles, getRepoFiles, createSession, getSession, closeSession };
