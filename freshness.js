/* ============================================================
   JOB FRESHNESS HELPERS  (pure, dependency-free, unit-testable)
   ------------------------------------------------------------
   Single source of truth for how the "24h / 3 days / 7 days / month /
   latest" filter maps to a maximum age in days, plus how a job's posted
   date is interpreted. Kept dependency-free so it runs under `node --test`
   without booting Express/Mongo.

   Rule: a job with NO known posted date is NEVER treated as "fresh".
   It is surfaced as "date unavailable" and excluded when a real time
   window is requested (24h/3d/7d/30d) — only the explicit "latest"/"all"
   option lets undated jobs through.
   ============================================================ */

// Map the UI freshness token to a maximum allowed age in days.
// Unknown / 'latest' / 'all' => no upper bound (Infinity).
export function maxFreshDaysFromQuery(v) {
  switch (String(v || '').toLowerCase()) {
    case '24h':
    case '1d':
      return 1;
    case '3d':
      return 3;
    case '7d':
    case 'week':
      return 7;
    case '30d':
    case 'month':
      return 30;
    case 'latest':
    case 'all':
    case '':
      return Infinity;
    default:
      return 7; // safe default: last week
  }
}

// True when a freshness filter imposes a real time window (so undated jobs
// must be excluded). 'latest'/'all' impose no window.
export function isBoundedFreshness(v) {
  return Number.isFinite(maxFreshDaysFromQuery(v));
}

// Decide whether a job passes the freshness window.
// postedDays: number of days since posting, or null/undefined if unknown.
// Returns { ok, reason }.
export function passesFreshness(postedDays, freshness) {
  const maxDays = maxFreshDaysFromQuery(freshness);
  const hasDate = typeof postedDays === 'number' && Number.isFinite(postedDays);
  if (!hasDate) {
    // No date: only allowed through the unbounded ("latest"/"all") option.
    if (!Number.isFinite(maxDays)) return { ok: true, reason: 'date unavailable (unbounded window)' };
    return { ok: false, reason: 'posted date unavailable — not treated as fresh' };
  }
  if (postedDays > maxDays) return { ok: false, reason: `too old (${postedDays}d > ${maxDays}d)` };
  return { ok: true, reason: 'within freshness window' };
}
