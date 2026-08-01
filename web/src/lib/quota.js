/* ============================================================
   SERVER QUOTA MIRROR  (client side)
   ------------------------------------------------------------
   The backend (server/utils/quotaMiddleware.js) is the ONLY real
   enforcer of usage limits. It counts per UTC day, per plan, per
   bucket. This module mirrors that config for display purposes and
   holds the live remaining counts the server reports back on every
   metered call (X-Quota-Bucket / X-Quota-Remaining headers, and the
   429 body).

   Nothing here enforces anything. It exists so the UI can say
   "you've used your 10 AI calls for today, resets at midnight UTC"
   instead of "temporarily unavailable".

   Keep BUCKET_LIMITS in sync with QUOTA_CONFIG on the server. The
   test suite asserts the two match.
   ============================================================ */

export const QUOTA_EVENT = 'career-quota-updated';

const U = Infinity;

/* Mirrors server/utils/quotaMiddleware.js → QUOTA_CONFIG (per UTC day). */
export const BUCKET_LIMITS = {
  free: { generation: 15, aiCalls: 10, syncs: 60, exports: 5 },
  pro: { generation: 150, aiCalls: 100, syncs: 600, exports: 50 },
  premium: { generation: U, aiCalls: 400, syncs: U, exports: U },
  admin: { generation: U, aiCalls: U, syncs: U, exports: U },
};

export const BUCKET_LABELS = {
  generation: 'project & architecture generations',
  aiCalls: 'AI calls (resume analysis, tailoring, drafting)',
  syncs: 'project syncs',
  exports: 'exports & starter packs',
};

export const BUCKET_SHORT = {
  generation: 'Generations',
  aiCalls: 'AI calls',
  syncs: 'Syncs',
  exports: 'Exports',
};

export function bucketLimit(bucket, plan = 'free') {
  const row = BUCKET_LIMITS[plan] || BUCKET_LIMITS.free;
  const v = row[bucket];
  return v == null ? U : v;
}

export function isUnlimitedBucket(n) {
  return n === Infinity || n === U || n == null;
}

/* ---------------- live state ---------------- */
/* { [bucket]: { remaining, limit, plan, resetAt, updatedAt } } */
let liveState = {};

export function getQuotaState() {
  return { ...liveState };
}

export function getBucketState(bucket) {
  return liveState[bucket] || null;
}

function emit() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(QUOTA_EVENT, { detail: getQuotaState() }));
}

/**
 * Record what the server just told us about a bucket.
 * Called from api.js on every metered response (success or 429).
 */
export function recordQuota({ bucket, remaining, limit, plan, resetAt } = {}) {
  if (!bucket) return;
  const prev = liveState[bucket] || {};
  liveState = {
    ...liveState,
    [bucket]: {
      remaining: remaining == null ? prev.remaining : Number(remaining),
      limit: limit == null ? prev.limit : Number(limit),
      plan: plan || prev.plan || null,
      resetAt: resetAt || prev.resetAt || null,
      updatedAt: new Date().toISOString(),
    },
  };
  emit();
}

export function resetQuotaState() {
  liveState = {};
  emit();
}

/* ---------------- formatting ---------------- */

export function formatResetAt(resetAt) {
  if (!resetAt) return 'midnight UTC';
  try {
    const d = new Date(resetAt);
    if (Number.isNaN(d.getTime())) return 'midnight UTC';
    return d.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
  } catch {
    return 'midnight UTC';
  }
}

/**
 * Turn any API error into something a student can act on.
 * Returns { kind, title, message, suggestPlan, bucket, resetAt }.
 *
 *   kind: 'quota'   → daily plan limit hit; upgrading or waiting fixes it
 *         'rate'    → short burst limit; waiting fixes it
 *         'config'  → AI not switched on for this deployment
 *         'input'   → the student needs to change what they submitted
 *         'unknown' → anything else
 *
 * Never surfaces an env var name, a stack trace or a raw provider error.
 */
export function describeApiError(err, context = 'This') {
  const status = err?.status || 0;
  const code = err?.code || '';
  const q = err?.quota || null;

  if (code === 'quota_exceeded' || (status === 429 && q?.bucket)) {
    const label = BUCKET_LABELS[q?.bucket] || 'daily usage';
    const plan = q?.plan || 'current';
    return {
      kind: 'quota',
      title: 'Daily limit reached',
      message: `You've used all of today's ${label} on the ${plan} plan. It resets at ${formatResetAt(q?.resetAt)} — or upgrade for a higher daily allowance.`,
      suggestPlan: plan === 'pro' ? 'premium' : 'pro',
      bucket: q?.bucket || null,
      resetAt: q?.resetAt || null,
    };
  }

  if (code === 'rate_limited' || status === 429) {
    return {
      kind: 'rate',
      title: 'Too many requests',
      message: `${context} is being requested faster than we allow. Wait a minute and try again — nothing was lost.`,
      suggestPlan: null,
      bucket: null,
      resetAt: null,
    };
  }

  if (code === 'ai_not_configured') {
    return {
      kind: 'config',
      title: 'AI features are off',
      message: 'AI features are not enabled on this account yet, so you are seeing the standard template version. Everything else still works.',
      suggestPlan: null,
      bucket: null,
      resetAt: null,
    };
  }

  if (status === 400 || status === 422) {
    return {
      kind: 'input',
      title: 'Check your input',
      message: err?.message || 'Some required details are missing or too short.',
      suggestPlan: null,
      bucket: null,
      resetAt: null,
    };
  }

  return {
    kind: 'unknown',
    title: 'Something went wrong',
    message: `${context} could not be completed right now. Please try again in a moment.`,
    suggestPlan: null,
    bucket: null,
    resetAt: null,
  };
}

export default {
  BUCKET_LIMITS, BUCKET_LABELS, BUCKET_SHORT, QUOTA_EVENT,
  bucketLimit, isUnlimitedBucket, getQuotaState, getBucketState,
  recordQuota, resetQuotaState, describeApiError, formatResetAt,
};
