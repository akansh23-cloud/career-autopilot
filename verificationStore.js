// Privileged-role verification persistence abstraction.
//
// Mirrors paymentsStore.js: persists to a JSON file on disk (the existing local
// ".data" pattern), falling back to an in-memory map ONLY when the disk is not
// writable (e.g. a read-only serverless FS with no DB). This is the LOCAL/DEMO
// path. In production the canonical store is the DB (db.js writes these fields
// onto the User document); db.js uses this file store only when no DB is
// configured. Either way, approvals survive a server restart/redeploy.
//
// Stored per user (keyed by email, else id):
//   { accountType, roleVerified, verificationStatus, organizationId, collegeId,
//     name, requestedType, requestedAt, updatedAt }

import fs from 'fs';
import path from 'path';

const dataDir = () => (process.env.CA_DATA_DIR ? path.resolve(process.env.CA_DATA_DIR) : path.join(process.cwd(), '.data'));
const dataFile = () => path.join(dataDir(), 'verifications.json');
const mem = new Map();
let useFile = true;

function load() {
  if (!useFile) return Object.fromEntries(mem);
  try {
    const FILE = dataFile();
    if (!fs.existsSync(FILE)) return {};
    return JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}');
  } catch { return {}; }
}
function persist(all) {
  if (!useFile) { mem.clear(); Object.entries(all).forEach(([k, v]) => mem.set(k, v)); return; }
  try {
    const DIR = dataDir();
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(dataFile(), JSON.stringify(all, null, 2));
  } catch {
    // disk not writable (e.g. serverless) — fall back to memory for this process.
    useFile = false;
    mem.clear(); Object.entries(all).forEach(([k, v]) => mem.set(k, v));
  }
}

const keyFor = (u) => String((u && (u.email || u.id)) || '').toLowerCase();

const EMPTY = { accountType: '', roleVerified: false, verificationStatus: 'none', organizationId: '', collegeId: '' };

export function getVerification(user) {
  const key = keyFor(user);
  if (!key) return null;
  const all = load();
  const rec = all[key];
  return rec ? { ...EMPTY, ...rec } : null;
}

export function saveVerification(user, patch = {}) {
  const key = keyFor(user);
  if (!key) return { ok: false, reason: 'no_key' };
  const all = load();
  const cur = all[key] || { ...EMPTY };
  const next = { ...cur };
  for (const f of ['accountType', 'roleVerified', 'verificationStatus', 'organizationId', 'collegeId', 'name', 'requestedType']) {
    if (patch[f] !== undefined) next[f] = f === 'roleVerified' ? !!patch[f] : patch[f];
  }
  next.email = (user && user.email) || next.email || null;
  next.updatedAt = new Date().toISOString();
  all[key] = next;
  persist(all);
  return { ok: true, verification: { ...EMPTY, ...next } };
}

export function listPending(status = 'pending') {
  const all = load();
  return Object.entries(all)
    .map(([key, v]) => ({ id: v.id || key, email: v.email || key, name: v.name || '', requestedType: v.requestedType || v.accountType || '', organizationId: v.organizationId || '', collegeId: v.collegeId || '', status: v.verificationStatus || 'none', at: v.requestedAt || v.updatedAt || null }))
    .filter((r) => !status || r.status === status);
}

// Test-only: clear the local store so suites don't bleed state across runs.
export function __resetForTests() {
  try { const FILE = dataFile(); if (fs.existsSync(FILE)) fs.unlinkSync(FILE); } catch { /* ignore */ }
  mem.clear();
  useFile = true;
}
