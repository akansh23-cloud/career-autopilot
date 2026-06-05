// Plan + quota system (frontend). Limits mirror the backend; the backend is the
// source of truth for billing, but these gate the UI and show upgrade prompts.

const PLAN_KEY = 'careerAutopilot.plan.v1';
const USAGE_KEY = 'careerAutopilot.usage.v1';
export const PLAN_EVENT = 'career-plan-updated';

export const PLAN_PRICES = { free: 0, pro: 39900, premium: 79900 }; // paise
export const PLAN_LABELS = { free: 'Free', pro: 'Pro', premium: 'Premium' };

const U = Infinity;
export const LIMITS = {
  free:    { tailoring: 3,  contacts: 5,   tracking: 20, templates: 4, customUpload: false, docx: false, outreach: 5 },
  pro:     { tailoring: 50, contacts: 100, tracking: U,  templates: 8, customUpload: true,  docx: true,  outreach: 100 },
  premium: { tailoring: U,  contacts: U,   tracking: U,  templates: U, customUpload: true,  docx: true,  outreach: U },
};

export const METER_LABELS = {
  tailoring: 'resume tailoring',
  contacts: 'contact searches',
  tracking: 'tracked jobs',
  outreach: 'AI outreach drafts',
};

function read(key) {
  if (typeof window === 'undefined') return null;
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; }
}
function write(key, v) {
  if (typeof window === 'undefined') return v;
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
  return v;
}
export function monthKey(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

/* ---------------- current plan ---------------- */
export function getPlan() {
  const p = read(PLAN_KEY);
  if (!p || !LIMITS[p.planId]) return { planId: 'free', status: 'active', source: 'default' };
  return p;
}
export function setPlan(plan) {
  const next = { planId: 'free', status: 'active', source: 'local', ...plan, updatedAt: new Date().toISOString() };
  write(PLAN_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail: next }));
  return next;
}
export function planId() { return getPlan().planId; }
export function limitsFor(id = planId()) { return LIMITS[id] || LIMITS.free; }
export function isUnlimited(n) { return n === Infinity || n === U; }

/* ---------------- usage counters (per month) ---------------- */
function usageRoot() {
  const all = read(USAGE_KEY) || {};
  const mk = monthKey();
  if (all.__month !== mk) return { __month: mk }; // auto-reset on new month
  return all;
}
export function getUsage(meter) { return Number(usageRoot()[meter] || 0); }
export function getAllUsage() { const r = usageRoot(); const { __month, ...rest } = r; return rest; }

export function remaining(meter, id = planId()) {
  const lim = limitsFor(id)[meter];
  if (isUnlimited(lim)) return Infinity;
  return Math.max(0, lim - getUsage(meter));
}
export function canUse(meter, id = planId()) {
  const lim = limitsFor(id)[meter];
  if (isUnlimited(lim)) return true;
  return getUsage(meter) < lim;
}
/* increment a meter; returns true if allowed (and recorded), false if blocked */
export function useMeter(meter, n = 1) {
  if (!canUse(meter)) return false;
  const all = usageRoot();
  all[meter] = Number(all[meter] || 0) + n;
  write(USAGE_KEY, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail: getPlan() }));
  return true;
}
/* tracking is a count, not a monthly meter — check against current total */
export function canTrack(currentCount) {
  const lim = limitsFor().tracking;
  return isUnlimited(lim) || currentCount < lim;
}

/* feature flags */
export function canUploadCustom() { return !!limitsFor().customUpload; }
export function canExportDocx() { return !!limitsFor().docx; }
export function templateAllowance() { return limitsFor().templates; } // number or Infinity

/* trigger the upgrade modal with a contextual reason */
export function promptUpgrade(reason, suggested = 'pro') {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('career-open-pricing', { detail: { plan: suggested, reason } }));
}

/* sync plan from backend subscription status (called on load / after payment) */
export async function syncPlanFromServer() {
  try {
    const r = await fetch('/api/payments/subscription-status', { credentials: 'include' });
    if (!r.ok) return getPlan();
    const d = await r.json();
    if (d && d.ok && d.planId && LIMITS[d.planId]) {
      return setPlan({ planId: d.planId, status: d.status || 'active', source: d.source || 'razorpay', expiresAt: d.expiresAt, paymentId: d.paymentId, orderId: d.orderId });
    }
  } catch {}
  return getPlan();
}
