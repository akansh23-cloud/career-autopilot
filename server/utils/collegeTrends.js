/* ============================================================
   Cohort trends — deltas, baselines and batch comparison
   ------------------------------------------------------------
   Every KPI in the command center used to be a point-in-time number.
   "Avg readiness 61" tells a TPO nothing about whether the placement
   cell's work is moving anything.

   Two honest ways to produce a delta, and this module does both while
   keeping them clearly separated:

   1. FLOW metrics (verifications, resume revisions) are derived from
      timestamped events. They need no history — the events ARE the
      history — so a delta is available on day one.

   2. STOCK metrics (avg readiness, recruiter-ready count) describe the
      cohort as it stands. You cannot reconstruct last month's average
      from today's rows, so these require a stored daily snapshot. Until
      snapshots have accumulated the delta is reported as `null` with
      `baselineDays: 0` — NEVER as zero, and never back-filled from a
      guess. A fabricated trendline is worse than no trendline.

   Pure and deterministic; persistence lives in db.js.
   ============================================================ */

export const TRENDS_VERSION = 'college-trends-v1';

const DAY = 24 * 60 * 60 * 1000;

/** UTC date key (YYYY-MM-DD) — one snapshot bucket per day per college. */
export function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const avg = (list, key) => (list.length
  ? Math.round(list.reduce((s, r) => s + (Number(r[key]) || 0), 0) / list.length)
  : 0);

/* ------------------------------------------------------------------
   Snapshot — the small set of stock metrics worth storing daily.
   Deliberately tiny: one document per college per day, forever, should
   stay well under a megabyte a year.
   ------------------------------------------------------------------ */
export function snapshotMetrics({ rows = [], now = Date.now() } = {}) {
  const students = rows.length;
  const withResume = rows.filter((r) => r.resumeScore != null).length;
  const recruiterReady = rows.filter((r) => Number(r.recruiterReadyProjects || 0) > 0).length;
  const verifiedStudents = rows.filter((r) => Number(r.projectsVerified ?? r.verifiedProjects ?? 0) > 0).length;
  const active7 = rows.filter((r) => r.lastActiveAt && now - Date.parse(r.lastActiveAt) <= 7 * DAY).length;

  return {
    date: dayKey(now),
    at: new Date(now).toISOString(),
    students,
    avgReadiness: avg(rows, 'readinessScore'),
    avgResume: rows.filter((r) => r.resumeScore != null).length
      ? Math.round(rows.filter((r) => r.resumeScore != null).reduce((s, r) => s + Number(r.resumeScore), 0) / withResume)
      : 0,
    recruiterReady,
    verifiedStudents,
    withResume,
    active7,
    placementReady: rows.filter((r) => Number(r.readinessScore || 0) >= 70).length,
  };
}

/* Which snapshot keys are surfaced as trend cards, and how to read them. */
export const TREND_KEYS = [
  { key: 'avgReadiness', label: 'Avg readiness', higherIsBetter: true, unit: '' },
  { key: 'avgResume', label: 'Avg resume score', higherIsBetter: true, unit: '' },
  { key: 'recruiterReady', label: 'Recruiter-ready', higherIsBetter: true, unit: '' },
  { key: 'verifiedStudents', label: 'With verified proof', higherIsBetter: true, unit: '' },
  { key: 'placementReady', label: 'Placement-ready', higherIsBetter: true, unit: '' },
  { key: 'students', label: 'Students', higherIsBetter: true, unit: '' },
];

/**
 * Compare today's snapshot against the closest one at least `windowDays` old.
 * Returns `delta: null` when no usable baseline exists — the UI renders that
 * as "no baseline yet", not as a flat zero.
 */
export function computeStockDeltas({ current, history = [], windowDays = 30, now = Date.now() } = {}) {
  const cutoff = now - windowDays * DAY;
  // Prefer the newest snapshot at or before the cutoff; if the college is
  // younger than the window, fall back to the OLDEST snapshot we hold and
  // report how many days it actually covers.
  const sorted = [...history]
    .filter((h) => h && h.at && Number.isFinite(Date.parse(h.at)))
    // Today's own snapshot is not a baseline for today. Anything at least a
    // day old is fair game, including when that's the only row we hold — a
    // four-day-old college still deserves a four-day comparison.
    .filter((h) => now - Date.parse(h.at) >= DAY)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const older = sorted.filter((h) => Date.parse(h.at) <= cutoff);
  const baseline = older.length ? older[older.length - 1] : (sorted[0] || null);

  const baselineDays = baseline
    ? Math.max(0, Math.round((now - Date.parse(baseline.at)) / DAY))
    : 0;

  const metrics = TREND_KEYS.map(({ key, label, higherIsBetter }) => {
    const value = Number(current?.[key] ?? 0);
    if (!baseline || baselineDays < 1) {
      return { key, label, value, previous: null, delta: null, pctChange: null, direction: 'flat', higherIsBetter };
    }
    const previous = Number(baseline[key] ?? 0);
    const delta = value - previous;
    return {
      key, label, value, previous, delta,
      pctChange: previous > 0 ? Math.round((delta / previous) * 100) : null,
      direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
      higherIsBetter,
    };
  });

  return {
    baselineDays,
    baselineAt: baseline?.at || null,
    hasBaseline: Boolean(baseline) && baselineDays >= 1,
    windowDays,
    metrics,
  };
}

/**
 * Flow deltas straight from the event log — available immediately, no
 * snapshot history required. Compares the last `windowDays` against the
 * `windowDays` before that.
 */
export function computeFlowDeltas({ events = [], windowDays = 30, now = Date.now() } = {}) {
  const start = now - windowDays * DAY;
  const priorStart = now - 2 * windowDays * DAY;

  const bucket = (type) => {
    let current = 0;
    let previous = 0;
    for (const e of events) {
      if (type && e.type !== type) continue;
      const t = Date.parse(e.at || '');
      if (!Number.isFinite(t)) continue;
      if (t >= start && t <= now) current++;
      else if (t >= priorStart && t < start) previous++;
    }
    const delta = current - previous;
    return {
      current, previous, delta,
      pctChange: previous > 0 ? Math.round((delta / previous) * 100) : null,
      direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    };
  };

  return {
    windowDays,
    verifications: { key: 'verifications', label: 'Project verifications', ...bucket('verification') },
    resumes: { key: 'resumes', label: 'Resume revisions', ...bucket('resume') },
    allActivity: { key: 'allActivity', label: 'Total activity', ...bucket(null) },
  };
}

/* ------------------------------------------------------------------
   Batch comparison — the question a TPO actually asks:
   "is this year's cohort ahead of or behind last year's?"
   ------------------------------------------------------------------ */

/**
 * Compare batches side by side. `placedByStudentId` is an optional Set of
 * student ids who accepted an offer, so placement lands in the same table.
 */
export function batchComparison({ rows = [], placedIds = new Set(), now = Date.now() } = {}) {
  const groups = new Map();
  for (const r of rows) {
    const key = String(r.batch || 'Unknown');
    const g = groups.get(key) || { batch: key, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }

  const out = [...groups.values()].map(({ batch, rows: list }) => {
    const withResume = list.filter((r) => r.resumeScore != null);
    const placed = list.filter((r) => placedIds.has(String(r.id))).length;
    return {
      batch,
      students: list.length,
      avgReadiness: avg(list, 'readinessScore'),
      avgResume: withResume.length
        ? Math.round(withResume.reduce((s, r) => s + Number(r.resumeScore), 0) / withResume.length)
        : 0,
      resumeCoverage: pct(withResume.length, list.length),
      verifiedCoverage: pct(
        list.filter((r) => Number(r.projectsVerified ?? r.verifiedProjects ?? 0) > 0).length,
        list.length
      ),
      recruiterReadyRate: pct(list.filter((r) => Number(r.recruiterReadyProjects || 0) > 0).length, list.length),
      placementReadyRate: pct(list.filter((r) => Number(r.readinessScore || 0) >= 70).length, list.length),
      placed,
      placementRate: pct(placed, list.length),
      active7: pct(
        list.filter((r) => r.lastActiveAt && now - Date.parse(r.lastActiveAt) <= 7 * DAY).length,
        list.length
      ),
    };
  });

  // Newest batch first — that is the one being worked right now. Batches are
  // usually graduation years, so a numeric sort is right; fall back to string.
  out.sort((a, b) => {
    const na = Number(a.batch);
    const nb = Number(b.batch);
    if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
    return String(a.batch).localeCompare(String(b.batch));
  });

  // Deltas against the next-oldest batch, so "2026 vs 2025" reads directly
  // off the row without the TPO doing arithmetic.
  return out.map((row, i) => {
    const prev = out[i + 1];
    if (!prev) return { ...row, vsPrevious: null };
    return {
      ...row,
      vsPrevious: {
        batch: prev.batch,
        avgReadiness: row.avgReadiness - prev.avgReadiness,
        placementReadyRate: row.placementReadyRate - prev.placementReadyRate,
        verifiedCoverage: row.verifiedCoverage - prev.verifiedCoverage,
        placementRate: row.placementRate - prev.placementRate,
      },
    };
  });
}

export default {
  TRENDS_VERSION, TREND_KEYS, dayKey,
  snapshotMetrics, computeStockDeltas, computeFlowDeltas, batchComparison,
};
