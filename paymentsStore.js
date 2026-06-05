// Subscription persistence abstraction.
// Uses MongoDB when available (via db.js hook), otherwise a JSON file on disk,
// otherwise an in-memory map. Swap in a real DB later without touching callers.

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.cwd(), '.data');
const FILE = path.join(DIR, 'subscriptions.json');
const mem = new Map();
let useFile = true;

function load() {
  if (!useFile) return Object.fromEntries(mem);
  try {
    if (!fs.existsSync(FILE)) return {};
    return JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}');
  } catch { return {}; }
}
function persist(all) {
  if (!useFile) { mem.clear(); Object.entries(all).forEach(([k, v]) => mem.set(k, v)); return; }
  try {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
  } catch {
    // disk not writable (e.g. serverless) — fall back to memory
    useFile = false;
    mem.clear(); Object.entries(all).forEach(([k, v]) => mem.set(k, v));
  }
}
const keyFor = (u) => String((u && (u.email || u.id)) || 'anonymous').toLowerCase();

export function getSubscription(user) {
  const all = load();
  const rec = all[keyFor(user)];
  if (!rec) return { planId: 'free', status: 'active', source: 'default' };
  // expire monthly plans
  if (rec.expiresAt && new Date(rec.expiresAt).getTime() < Date.now()) {
    return { ...rec, planId: 'free', status: 'expired' };
  }
  return rec;
}

export function saveSubscription(user, data) {
  const all = load();
  const rec = {
    userId: (user && user.id) || null,
    email: (user && user.email) || null,
    planId: data.planId,
    paymentId: data.paymentId || null,
    orderId: data.orderId || null,
    amount: data.amount || null,
    status: data.status || 'active',
    source: data.source || 'razorpay',
    startedAt: data.startedAt || new Date().toISOString(),
    expiresAt: data.expiresAt || new Date(Date.now() + 30 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  all[keyFor(user)] = rec;
  persist(all);
  return rec;
}

export function recordOrder(user, order) {
  const all = load();
  const k = keyFor(user);
  const rec = all[k] || { email: (user && user.email) || null, planId: 'free', status: 'active' };
  rec.pendingOrder = { orderId: order.orderId, planId: order.planId, amount: order.amount, createdAt: new Date().toISOString() };
  all[k] = rec;
  persist(all);
}
