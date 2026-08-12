// Plan + entitlement system (frontend).
//
// TWO DISTINCT THINGS LIVE IN THIS APP — do not conflate them:
//
//   1. ENTITLEMENTS (this file): what a plan unlocks, and the monthly
//      allowances shown on the pricing card — tailoring runs, contact
//      searches, workspaces, templates, DOCX export. Counted client-side so
//      the UI can gate and prompt an upgrade before a call goes out.
//
//   2. DAILY COMPUTE QUOTA (lib/quota.js, mirroring the server's
//      quotaMiddleware): how much expensive work the backend will do per UTC
//      day. The SERVER is the only real enforcer, and it is what actually
//      returns 429.
//
// A student can be inside their monthly entitlement and still be stopped by
// the daily quota. Both paths must produce a clear, specific message — that
// was the whole point of the fix.
import { BUCKET_LIMITS } from './quota.js';

const PLAN_KEY = 'careerAutopilot.plan.v1';
const USAGE_KEY = 'careerAutopilot.usage.v1';
export const PLAN_EVENT = 'career-plan-updated';

export const PLAN_PRICES = { free: 0, pro: 39900, premium: 79900 }; // paise
export const PLAN_LABELS = { free: 'Free', pro: 'Pro', premium: 'Premium' };

const U = Infinity;
export const LIMITS = {
  free:    { tailoring: 3,  contacts: 5,   tracking: 20, templates: 4, customUpload: false, docx: false, outreach: 5,   workspaces: 1,  aiGen: 2,   sandboxPublish: 1, creatorRecs: 6 },
  pro:     { tailoring: 50, contacts: 100, tracking: U,  templates: 8, customUpload: true,  docx: true,  outreach: 100, workspaces: 10, aiGen: 100, sandboxPublish: 5, creatorRecs: 60 },
  premium: { tailoring: U,  contacts: U,   tracking: U,  templates: U, customUpload: true,  docx: true,  outreach: U,   workspaces: U,  aiGen: U,   sandboxPublish: U, creatorRecs: U },
};
const ADMIN_LIMITS = { tailoring: U, contacts: U, tracking: U, templates: U, customUpload: true, docx: true, outreach: U, workspaces: U, aiGen: U, sandboxPublish: U, creatorRecs: U };

export const PLAN_LABELS_FULL = { free: 'Free', pro: 'Pro', premium: 'Premium', admin: 'Full Access' };

export const METER_LABELS = {
  tailoring: 'resume tailoring',
  contacts: 'contact searches',
  tracking: 'tracked jobs',
  outreach: 'AI outreach drafts',
  creatorRecs: 'project recommendations',
  workspaces: 'active project workspaces',
  aiGen: 'AI project roadmaps',
  sandboxPublish: 'published sandbox projects',
};

/* Which server compute bucket a UI action ultimately spends. Used to show the
   real daily allowance next to the monthly entitlement, so the two numbers on
   screen always agree with what the backend will actually do. */
export const METER_TO_BUCKET = {
  /* P1.7 — tailoring is deterministic; it does not spend an AI call. */
  tailoring: 'tailoring',
  outreach: 'aiCalls',
  contacts: 'aiCalls',
  aiGen: 'generation',
  creatorRecs: 'generation',
  workspaces: 'generation',
  sandboxPublish: 'syncs',
};

export function dailyBucketLimit(meter, id = planId()) {
  const bucket = METER_TO_BUCKET[meter];
  if (!bucket) return U;
  const row = BUCKET_LIMITS[isAdmin() ? 'admin' : id] || BUCKET_LIMITS.free;
  const v = row[bucket];
  return v == null ? U : v;
}

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
export function isAdmin() { return !!getPlan().isAdmin; }
export function effectivePlan() { const p = getPlan(); return p.isAdmin ? 'admin' : p.planId; }
export function limitsFor(id = planId()) { return LIMITS[id] || LIMITS.free; }
/* limits for the CURRENT user, honoring admin full-access */
function currentLimits() { return isAdmin() ? ADMIN_LIMITS : limitsFor(); }
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
  if (isAdmin()) return Infinity;
  const lim = limitsFor(id)[meter];
  if (isUnlimited(lim)) return Infinity;
  return Math.max(0, lim - getUsage(meter));
}
export function canUse(meter) {
  if (isAdmin()) return true;
  const lim = currentLimits()[meter];
  if (isUnlimited(lim)) return true;
  return getUsage(meter) < lim;
}
/* increment a meter; returns true if allowed (and recorded), false if blocked.
   Admins never consume quota. */
export function useMeter(meter, n = 1) {
  if (isAdmin()) return true;
  if (!canUse(meter)) return false;
  const all = usageRoot();
  all[meter] = Number(all[meter] || 0) + n;
  write(USAGE_KEY, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail: getPlan() }));
  return true;
}
/* tracking is a count, not a monthly meter — check against current total */
export function canTrack(currentCount) {
  if (isAdmin()) return true;
  const lim = currentLimits().tracking;
  return isUnlimited(lim) || currentCount < lim;
}
/* workspaces are a live count too (how many project workspaces exist right
   now), not a monthly meter. Previously defined but never enforced, which is
   why a blocked second project failed silently. */
export function canCreateWorkspace(currentCount) {
  if (isAdmin()) return true;
  const lim = currentLimits().workspaces;
  return isUnlimited(lim) || currentCount < lim;
}
export function workspaceAllowance() { return isAdmin() ? Infinity : currentLimits().workspaces; }

/* feature flags */
export function canUploadCustom() { return isAdmin() || !!currentLimits().customUpload; }
export function canExportDocx() { return isAdmin() || !!currentLimits().docx; }
export function templateAllowance() { return isAdmin() ? Infinity : currentLimits().templates; } // number or Infinity

/* Human sentence for any meter, used in upgrade prompts and the usage strip.
   Always mentions BOTH the monthly entitlement and the daily server cap when
   they differ, so the number on screen is never contradicted by a 429. */
export function describeLimit(meter, id = planId()) {
  const label = METER_LABELS[meter] || meter;
  const monthly = isAdmin() ? U : limitsFor(id)[meter];
  const daily = dailyBucketLimit(meter, id);
  if (isUnlimited(monthly) && isUnlimited(daily)) return `Unlimited ${label}.`;
  const parts = [];
  if (!isUnlimited(monthly)) parts.push(`${monthly} ${label} per month`);
  if (!isUnlimited(daily)) parts.push(`${daily} per day across the account`);
  return `Your ${PLAN_LABELS[id] || id} plan includes ${parts.join(', capped at ')}.`;
}

/* trigger the upgrade modal with a contextual reason (no-op for admins) */
export function promptUpgrade(reason, suggested = 'pro') {
  if (isAdmin()) return;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('career-open-pricing', { detail: { plan: suggested, reason } }));
}

/* sync plan from backend subscription status (called on load / after payment) */
export async function syncPlanFromServer() {
  try {
    const r = await fetch('/api/payments/subscription-status', { credentials: 'include' });
    if (!r.ok) return getPlan();
    const d = await r.json();
    if (d && d.ok && d.planId && LIMITS[d.planId]) {
      return setPlan({
        planId: d.planId,
        status: d.status || 'active',
        source: d.source || 'razorpay',
        expiresAt: d.expiresAt,
        paymentId: d.paymentId,
        orderId: d.orderId,
        role: d.role || (d.isAdmin ? 'admin' : d.planId),
        isAdmin: !!d.isAdmin,
        effectivePlan: d.effectivePlan || (d.isAdmin ? 'admin' : d.planId),
      });
    }
  } catch {}
  return getPlan();
}
