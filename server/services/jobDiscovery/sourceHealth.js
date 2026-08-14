/* ============================================================
   JOB DISCOVERY OS — SOURCE HEALTH & SELF-HEALING
   ------------------------------------------------------------
   The single most destructive failure mode in a job index is not
   a crawler that stops working. It is a crawler that KEEPS working
   and returns nonsense.

   A provider ships a markup change. The parser still runs, still
   returns HTTP 200, and now finds 3 jobs on a board that had 400.
   Reconciliation sees 397 jobs "absent from an authoritative
   listing" and marks them gone. The index looks healthy the whole
   time. Users see an employer's openings vanish overnight.

   So a successful crawl is not automatically trusted. This module
   compares each run against the source's own recent history and
   decides whether the result is CREDIBLE. When it is not:

       - the source is marked DEGRADED
       - destructive reconciliation is BLOCKED for that run
       - existing jobs are retained untouched
       - a schema-change signal is raised for an operator

   The asymmetry is deliberate. Wrongly retaining a closed job costs
   a user one wasted click. Wrongly deleting 400 live jobs costs the
   product its credibility, and we cannot get them back without a
   full recrawl we may not be allowed to run.
   ============================================================ */

import { SOURCE_STATUS, ERROR_CLASS } from './schema.js';

export const ANOMALY = Object.freeze({
  VOLUME_COLLAPSE: 'VOLUME_COLLAPSE',       // job count fell off a cliff
  EMPTY_AFTER_POPULATED: 'EMPTY_AFTER_POPULATED',
  PARSE_FAILURE_SPIKE: 'PARSE_FAILURE_SPIKE',
  SCHEMA_ERROR: 'SCHEMA_ERROR',
  TITLE_DEGRADATION: 'TITLE_DEGRADATION',   // rows arriving without usable titles
  DUPLICATE_EXPLOSION: 'DUPLICATE_EXPLOSION',
});

/* A drop past this fraction of the recent norm is not believable as churn. */
export const VOLUME_COLLAPSE_RATIO = 0.4;
/* Below this many historical runs we have no norm, so we do not judge. */
export const MIN_HISTORY_RUNS = 3;
export const PARSE_FAILURE_THRESHOLD = 0.3;

/** Median of a source's recent successful job counts. */
export function baselineJobCount(source) {
  const window = (source.health?.window || []).filter((w) => w.ok && !w.notModified);
  if (window.length < MIN_HISTORY_RUNS) return null;
  const counts = window.map((w) => w.jobs || 0).sort((a, b) => a - b);
  const mid = Math.floor(counts.length / 2);
  return counts.length % 2 ? counts[mid] : Math.round((counts[mid - 1] + counts[mid]) / 2);
}

/**
 * Judge one crawl result against the source's history.
 *
 * @returns {{ credible, anomalies: [{kind, detail, severity}], baseline, observed }}
 */
export function assessRun(source, result = {}) {
  const anomalies = [];
  const baseline = baselineJobCount(source);
  const observed = result.fetched ?? 0;

  if (result.errors?.some((e) => e.errorClass === ERROR_CLASS.SCHEMA_CHANGED)) {
    anomalies.push({
      kind: ANOMALY.SCHEMA_ERROR,
      severity: 'high',
      detail: 'adapter reported a schema change; the response no longer matches the expected shape',
    });
  }

  if (baseline != null && baseline >= 5) {
    if (observed === 0) {
      anomalies.push({
        kind: ANOMALY.EMPTY_AFTER_POPULATED,
        severity: 'high',
        detail: `board returned 0 jobs where the recent median was ${baseline}`,
      });
    } else if (observed < baseline * VOLUME_COLLAPSE_RATIO) {
      anomalies.push({
        kind: ANOMALY.VOLUME_COLLAPSE,
        severity: 'high',
        detail: `board returned ${observed} jobs against a recent median of ${baseline}`,
      });
    }
  }

  const attempted = (result.fetched ?? 0) + (result.rejected ?? 0);
  if (attempted >= 10 && (result.rejected ?? 0) / attempted >= PARSE_FAILURE_THRESHOLD) {
    anomalies.push({
      kind: ANOMALY.PARSE_FAILURE_SPIKE,
      severity: 'high',
      detail: `${result.rejected} of ${attempted} rows failed to normalize`,
    });
  }

  if (result.titlelessRows && result.fetched && result.titlelessRows / result.fetched >= 0.5) {
    anomalies.push({
      kind: ANOMALY.TITLE_DEGRADATION,
      severity: 'medium',
      detail: `${result.titlelessRows} of ${result.fetched} rows arrived without a usable title`,
    });
  }

  const highSeverity = anomalies.some((a) => a.severity === 'high');
  return { credible: !highSeverity, anomalies, baseline, observed };
}

/**
 * THE GUARD. Answers: may this run's absences be treated as closures?
 *
 * Absence is only evidence when BOTH the adapter says the listing was complete
 * AND the result looks credible. A degraded parser producing a short list is
 * not a shrinking board.
 */
export function mayReconcileMissing({ authoritative, assessment }) {
  if (!authoritative) {
    return { allowed: false, reason: 'source response was not an authoritative complete listing' };
  }
  if (!assessment.credible) {
    return {
      allowed: false,
      reason: `run failed credibility checks (${assessment.anomalies.map((a) => a.kind).join(', ')}); existing jobs retained`,
    };
  }
  return { allowed: true, reason: 'complete listing from a source whose output looks credible' };
}

/**
 * Derive the source's next status from an assessment. Degradation is sticky
 * enough to be noticed and recoverable on its own once output looks sane again.
 */
export function healthStatusFor(source, assessment, { ok = true } = {}) {
  if (!assessment.credible) return SOURCE_STATUS.DEGRADED;
  if (source.status === SOURCE_STATUS.DEGRADED && ok && assessment.credible) {
    /* Self-healing: a source that recovers on its own returns to ACTIVE without
       an operator, but only after producing a credible run. */
    return SOURCE_STATUS.ACTIVE;
  }
  return source.status;
}

/**
 * Build the record written back onto the source. Kept as data so an operator
 * can see exactly what tripped and when, and so a test can assert it.
 */
export function anomalyRecord(assessment, { at = new Date().toISOString() } = {}) {
  if (assessment.credible) return null;
  return {
    at,
    kinds: assessment.anomalies.map((a) => a.kind),
    details: assessment.anomalies.map((a) => a.detail),
    baseline: assessment.baseline,
    observed: assessment.observed,
    /* Explicitly recorded so a later reader knows nothing was deleted. */
    destructiveActionsBlocked: true,
    needsOperatorReview: true,
  };
}

/** Roll up source health for the metrics surface. */
export function summarizeSourceHealth(sources = []) {
  const byStatus = {};
  let degraded = 0;
  let withAnomaly = 0;
  let healthy = 0;
  let failing = 0;
  for (const s of sources) {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    if (s.status === SOURCE_STATUS.DEGRADED) degraded += 1;
    if (s.anomaly) withAnomaly += 1;
    const rate = s.health?.successRate;
    if (typeof rate === 'number') {
      if (rate >= 0.8) healthy += 1;
      else if (rate < 0.5) failing += 1;
    }
  }
  return {
    total: sources.length,
    byStatus,
    degraded,
    withOpenAnomaly: withAnomaly,
    healthy,
    failing,
    failureRatePct: sources.length ? Math.round((failing / sources.length) * 1000) / 10 : 0,
  };
}

export default {
  ANOMALY, assessRun, mayReconcileMissing, healthStatusFor, anomalyRecord,
  baselineJobCount, summarizeSourceHealth, VOLUME_COLLAPSE_RATIO,
};
