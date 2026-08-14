/* ============================================================
   JOB DISCOVERY OS — COVERAGE METRICS
   ------------------------------------------------------------
   The metric that matters is not "how many jobs are in the table".
   Anyone can inflate that. What matters is:

       are they real          direct-source and direct-apply rates
       are they fresh         discovery age, verification coverage
       are they distinct      duplicate ratio, dedupe collapse
       are they reachable     apply-url coverage
       is the machine healthy source failure rate, browser fallback

   NAMESPACE SEPARATION IS ENFORCED, not documented. Every snapshot
   is stamped PRODUCTION or FIXTURE and the two can never be summed:
   mergeSnapshots() throws on a namespace mismatch. A 100k-row
   deterministic benchmark is a real engineering measurement and a
   completely fake coverage claim, and the only way that distinction
   survives contact with a status page is if the code refuses to
   blur it.
   ============================================================ */

import { JOB_STATUS, SOURCE_CLASS, SOURCE_STATUS } from './schema.js';
import { ageDays } from './normalize/text.js';

export const NAMESPACE = Object.freeze({
  PRODUCTION: 'PRODUCTION',
  FIXTURE: 'FIXTURE',
});

const DIRECT_CLASSES = new Set([SOURCE_CLASS.ORIGINAL_ATS, SOURCE_CLASS.ORIGINAL_CAREER_SITE]);

function pct(n, total) {
  return total ? Math.round((n / total) * 1000) / 10 : 0;
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

/**
 * Compute the full coverage snapshot.
 *
 * @param opts.namespace  PRODUCTION or FIXTURE. Required — there is no default,
 *                        because a default is how fixture numbers end up on a
 *                        dashboard labelled "coverage".
 */
export function computeCoverage({
  jobs = [], sources = [], companies = [], discoveryStats = null, crawlStats = null,
  runtime = null, namespace, now = Date.now(), windowHours = 24,
}) {
  if (namespace !== NAMESPACE.PRODUCTION && namespace !== NAMESPACE.FIXTURE) {
    throw new Error('computeCoverage: namespace must be PRODUCTION or FIXTURE — refusing to emit unlabelled coverage metrics');
  }

  const byStatus = {};
  const byProvider = {};
  const bySourceClass = {};

  let directSourced = 0;
  let directApply = 0;
  let anyApplyUrl = 0;
  let withPublishedDate = 0;
  let withSalary = 0;
  let verified = 0;
  let totalInstances = 0;
  let multiSourced = 0;
  let changedRecently = 0;

  const discoveryAges = [];
  const windowStart = now - windowHours * 3600000;
  let discoveredInWindow = 0;
  let newestHour = 0;

  for (const job of jobs) {
    byStatus[job.status] = (byStatus[job.status] || 0) + 1;

    const instances = job.sourceInstances || [];
    totalInstances += instances.length;
    if (instances.length > 1) multiSourced += 1;

    for (const p of new Set(instances.map((s) => s.provider))) byProvider[p] = (byProvider[p] || 0) + 1;
    for (const c of new Set(instances.map((s) => s.sourceClass))) bySourceClass[c] = (bySourceClass[c] || 0) + 1;

    if (instances.some((s) => DIRECT_CLASSES.has(s.sourceClass))) directSourced += 1;

    if (job.canonicalApplyUrl) {
      anyApplyUrl += 1;
      const applyInstance = instances.find((s) => s.applyUrl === job.canonicalApplyUrl);
      if (applyInstance && DIRECT_CLASSES.has(applyInstance.sourceClass)) directApply += 1;
    }

    if (job.sourcePublishedAt) withPublishedDate += 1;
    if (job.compensation?.min != null || job.compensation?.max != null) withSalary += 1;
    if (job.lastVerifiedAt) verified += 1;
    if (job.lastChangedAt && Date.parse(job.lastChangedAt) >= windowStart) changedRecently += 1;

    /* Discovery age: how long after PUBLICATION did we find it? Only computable
       when the source stated a real publication date — never faked from
       firstSeenAt, which would make this metric self-congratulatory. */
    if (job.sourcePublishedAt && job.firstSeenAt) {
      const lag = (Date.parse(job.firstSeenAt) - Date.parse(job.sourcePublishedAt)) / 86400000;
      if (Number.isFinite(lag) && lag >= 0) discoveryAges.push(Math.round(lag * 10) / 10);
    }
    const firstSeen = Date.parse(job.firstSeenAt || '');
    if (Number.isFinite(firstSeen) && firstSeen >= windowStart) {
      discoveredInWindow += 1;
      if (firstSeen >= now - 3600000) newestHour += 1;
    }
  }

  const total = jobs.length;
  const active = (byStatus[JOB_STATUS.ACTIVE] || 0) + (byStatus[JOB_STATUS.NEW] || 0) + (byStatus[JOB_STATUS.LIKELY_ACTIVE] || 0);

  const sourceStatus = {};
  let healthySources = 0;
  let failingSources = 0;
  let degradedSources = 0;
  for (const s of sources) {
    sourceStatus[s.status] = (sourceStatus[s.status] || 0) + 1;
    if (s.status === SOURCE_STATUS.DEGRADED) degradedSources += 1;
    const rate = s.health?.successRate;
    if (typeof rate === 'number') {
      if (rate >= 0.8) healthySources += 1;
      else if (rate < 0.5) failingSources += 1;
    } else if (s.status === SOURCE_STATUS.ACTIVE) healthySources += 1;
  }

  const companiesCovered = companies.filter((c) => (c.sourceIds || []).length).length;

  return {
    namespace,
    generatedAt: new Date(now).toISOString(),
    windowHours,

    jobs: {
      activeCanonicalJobs: active,
      total,
      byStatus,
      byProvider,
      bySourceClass,
      new: byStatus[JOB_STATUS.NEW] || 0,
      stale: byStatus[JOB_STATUS.STALE] || 0,
      removed: byStatus[JOB_STATUS.REMOVED] || 0,
    },

    sources: {
      registered: sources.length,
      healthy: healthySources,
      degraded: degradedSources,
      failing: failingSources,
      byStatus: sourceStatus,
      sourceFailureRatePct: pct(failingSources, sources.length),
    },

    companies: {
      known: companies.length,
      covered: companiesCovered,
      coveragePct: pct(companiesCovered, companies.length),
    },

    discovery: {
      jobsDiscoveredPerDay: windowHours ? Math.round((discoveredInWindow / windowHours) * 24) : 0,
      jobsDiscoveredInWindow: discoveredInWindow,
      newJobsLastHour: newestHour,
      /* Median days between a stated publication date and our first sighting.
         null when no job in the set carried a real publication date. */
      medianDiscoveryAgeDays: median(discoveryAges),
      datedSampleSize: discoveryAges.length,
      queue: discoveryStats,
    },

    quality: {
      directSourceCount: directSourced,
      directSourcePct: pct(directSourced, total),
      directApplyCount: directApply,
      directApplyPct: pct(directApply, total),
      applyUrlCoveragePct: pct(anyApplyUrl, total),
      withPublishedDatePct: pct(withPublishedDate, total),
      withSalaryPct: pct(withSalary, total),
      verificationCoveragePct: pct(verified, total),
      multiSourcedCount: multiSourced,
      /* >1.0 means several source instances collapsed onto one canonical job.
         This is DEDUPE WORKING, and it is deliberately not called "coverage". */
      duplicateRatio: total ? Math.round((totalInstances / total) * 100) / 100 : 0,
      duplicatesCollapsed: Math.max(0, totalInstances - total),
      changedInWindow: changedRecently,
    },

    machine: {
      crawlQueue: crawlStats,
      browserFallbackPct: runtime?.browserFallbackPct ?? null,
      fetchSuccessRate: runtime?.fetchSuccessRate ?? null,
      searchP50Ms: runtime?.latency?.searchP50 ?? null,
      searchP95Ms: runtime?.latency?.searchP95 ?? null,
    },
  };
}

/**
 * Combining snapshots is only ever valid inside one namespace. This throws
 * rather than returning a plausible-looking blend, because a blended number is
 * indistinguishable from a real one once it reaches a report.
 */
export function mergeSnapshots(a, b) {
  if (!a || !b) return a || b;
  if (a.namespace !== b.namespace) {
    throw new Error(`mergeSnapshots: refusing to combine ${a.namespace} and ${b.namespace} metrics`);
  }
  return {
    ...a,
    jobs: { ...a.jobs, total: a.jobs.total + b.jobs.total, activeCanonicalJobs: a.jobs.activeCanonicalJobs + b.jobs.activeCanonicalJobs },
    sources: { ...a.sources, registered: a.sources.registered + b.sources.registered },
  };
}

/** One-line honesty statement for any surface that prints these numbers. */
export function coverageDisclaimer(snapshot) {
  return snapshot.namespace === NAMESPACE.FIXTURE
    ? 'FIXTURE DATA — deterministic benchmark corpus. These numbers measure the engine, not real-world job coverage.'
    : 'PRODUCTION DATA — measured from live registered sources.';
}

export default { computeCoverage, mergeSnapshots, coverageDisclaimer, NAMESPACE };
