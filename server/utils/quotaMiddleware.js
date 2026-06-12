/* ============================================================
   QUOTA MIDDLEWARE  (Market-Readiness Gap Sprint, Phase 5)
   ------------------------------------------------------------
   Config-driven per-plan DAILY limits, enforced server-side on the
   expensive route families (AI generation, deterministic generation,
   project syncs, exports). Distinct from the burst rate limiters in
   security.js: those protect the process per-minute; this protects the
   business per-day per-plan.

   - Counters: MongoDB-backed (atomic $inc per user/bucket/UTC-day) when
     the DB is on; bounded in-memory fallback otherwise. The in-memory
     fallback is per-instance — documented limitation on serverless.
   - 429 response always includes: error, message, bucket, limit,
     remaining (0) and resetAt (next UTC midnight).
   - Free tier limits are sized so one full golden path (generate a
     project + architecture + workspace + a patent assessment + a resume
     export + a sync) fits comfortably in a day.
   - Test bypass: skipped under NODE_ENV=test unless QUOTA_ENFORCE=1
     (which the quota tests set). QUOTA_DISABLED=1 disables everywhere.
   ============================================================ */

const U = Infinity;

/* Per-plan daily caps per bucket. 'admin' is resolved server-side only. */
export const QUOTA_CONFIG = {
  free:    { generation: 15, aiCalls: 10, syncs: 60,  exports: 5 },
  pro:     { generation: 150, aiCalls: 100, syncs: 600, exports: 50 },
  premium: { generation: U,   aiCalls: 400, syncs: U,   exports: U },
  admin:   { generation: U,   aiCalls: U,   syncs: U,   exports: U },
};

/* Route-family → bucket map. Prefix match on (method + path). Order
   matters: first match wins. Only state-changing/expensive calls count —
   plain GET reads are never metered. */
export const QUOTA_ROUTES = [
  { method: 'POST', prefix: '/api/projects/store/sync', bucket: 'syncs' },
  { method: 'POST', prefix: '/api/resume/analyze', bucket: 'aiCalls' },
  { method: 'POST', prefix: '/api/resume/tailor', bucket: 'aiCalls' },
  { method: 'POST', prefix: '/api/resume/export', bucket: 'exports' },
  { method: 'POST', prefix: '/api/workspace/starter-pack', bucket: 'exports' },
  { method: 'POST', prefix: '/api/workspace/generate', bucket: 'generation' },
  { method: 'POST', prefix: '/api/architecture', bucket: 'generation' },
  { method: 'POST', prefix: '/api/patent/assess', bucket: 'generation' },
  { method: 'POST', prefix: '/api/patents/ideas', bucket: 'generation' },
  { method: 'POST', prefix: '/api/problem-intelligence', bucket: 'generation' },
  { method: 'POST', prefix: '/api/project-intelligence', bucket: 'generation' },
  { method: 'POST', prefix: '/api/project-builder', bucket: 'generation' },
  { method: 'POST', prefix: '/api/career-intelligence', bucket: 'generation' },
  { method: 'POST', prefix: '/api/ai', bucket: 'aiCalls' },
];

export function matchQuotaBucket(method, path) {
  for (const r of QUOTA_ROUTES) {
    if (r.method === method && path.startsWith(r.prefix)) return r.bucket;
  }
  return null;
}

export function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function nextUtcMidnight(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return d.toISOString();
}

/* Bounded in-memory fallback counters (per process). */
const MEM_MAX = 5000;
const mem = new Map(); // `${day}|${userKey}|${bucket}` -> count
function memIncrement(userKey, bucket, day) {
  const key = `${day}|${userKey}|${bucket}`;
  // Drop stale-day entries opportunistically so the map stays bounded.
  if (mem.size > MEM_MAX) {
    for (const k of mem.keys()) { if (!k.startsWith(day + '|')) mem.delete(k); if (mem.size <= MEM_MAX) break; }
  }
  const next = (mem.get(key) || 0) + 1;
  mem.set(key, next);
  return next;
}
export function _resetMemoryCounters() { mem.clear(); } // test hook

/**
 * createQuotaMiddleware({ currentUser, planFor, db, logger, config })
 * - currentUser(req) → session user (same helper the routes use)
 * - planFor(req) → { effectivePlan } (server-resolved; client never trusted)
 * - db → db.js module (optional; in-memory fallback when off)
 */
export function createQuotaMiddleware({ currentUser, planFor, db = null, logger = null, config = QUOTA_CONFIG } = {}) {
  return async function quotaMiddleware(req, res, next) {
    try {
      if (process.env.QUOTA_DISABLED === '1') return next();
      if (process.env.NODE_ENV === 'test' && process.env.QUOTA_ENFORCE !== '1') return next();

      const bucket = matchQuotaBucket(req.method, req.path);
      if (!bucket) return next();

      const u = currentUser ? currentUser(req) : null;
      if (!u) return next(); // unauthenticated calls are rejected by requireAuth anyway

      const plan = (planFor ? planFor(req) : {}).effectivePlan || 'free';
      const limits = config[plan] || config.free;
      const limit = limits[bucket];
      if (limit === Infinity || limit == null) return next();

      const userKey = String(u.id || u.email || 'anon').toLowerCase();
      const day = utcDay();
      let count = null;
      if (db?.dbEnabled?.()) count = await db.incrementDailyUsage({ userKey, bucket, day });
      if (count == null) count = memIncrement(userKey, bucket, day);

      const remaining = Math.max(0, limit - count);
      res.setHeader('X-Quota-Bucket', bucket);
      res.setHeader('X-Quota-Remaining', String(remaining));

      if (count > limit) {
        logger?.warn?.('Daily quota exceeded', { bucket, plan, path: req.path });
        return res.status(429).json({
          error: 'quota_exceeded',
          message: `Daily ${bucket} limit reached for the ${plan} plan. It resets at midnight UTC — or upgrade for higher limits.`,
          bucket,
          plan,
          limit,
          remaining: 0,
          resetAt: nextUtcMidnight(),
        });
      }
      return next();
    } catch (err) {
      // Quota accounting must never take the API down.
      logger?.error?.('Quota middleware failed open', { message: err.message });
      return next();
    }
  };
}

export default { createQuotaMiddleware, matchQuotaBucket, QUOTA_CONFIG, QUOTA_ROUTES, utcDay, nextUtcMidnight, _resetMemoryCounters };
