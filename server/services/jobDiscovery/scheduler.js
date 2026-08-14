/* ============================================================
   JOB DISCOVERY OS — SCHEDULER, VERIFICATION, OBSERVABILITY
   ------------------------------------------------------------
   §26 forbids fetching the internet during a user search. Ingestion
   is a BACKGROUND activity; search reads the canonical index.

   This deployment runs on Vercel (see vercel.json), so a permanent
   in-process setInterval is not a valid scheduler. The model here is
   a `tick()` that does one bounded slice of work and returns, driven
   by whichever trigger the environment offers:

       node scripts/job-discovery-worker.mjs      long-running worker
       POST /api/admin/job-discovery/tick         cron-triggered
       runForever()                               local dev only

   §22.2 verification and §41 metrics live here too, because they
   share the same bounded-work-slice discipline.
   ============================================================ */

import { needsVerification, applyVerification, sweepStaleness, VERIFY_AFTER_DAYS } from './freshness.js';
import { JOB_STATUS, SOURCE_STATUS, ACCESS_POLICY, SOURCE_CLASS } from './schema.js';

/* ------------------------------ metrics ------------------------------ */

export class Metrics {
  constructor() {
    this.counters = {
      sourcesRegistered: 0, sourcesHealthy: 0, sourcesDegraded: 0, sourcesDisabled: 0,
      fetchAttempts: 0, fetchSuccess: 0, fetchFailure: 0, rateLimited: 0,
      rawJobsFetched: 0, newJobs: 0, updatedJobs: 0, removedJobs: 0,
      dedupeMerges: 0, dedupeRejected: 0,
      verificationsRun: 0, verificationsOk: 0, verificationsClosed: 0, verificationsFailed: 0,
      browserFallbacks: 0, extractionStages: {},
    };
    this.timings = { crawlMs: [], normalizeMs: [], verifyMs: [], searchMs: [] };
    this.errorsByClass = {};
  }

  push(bucket, ms) {
    const arr = this.timings[bucket];
    if (!arr) return;
    arr.push(ms);
    if (arr.length > 500) arr.shift();
  }

  recordSourceRun(result = {}) {
    this.counters.fetchAttempts += 1;
    if (result.ok) this.counters.fetchSuccess += 1; else this.counters.fetchFailure += 1;
    this.counters.rawJobsFetched += result.fetched || 0;
    this.counters.newJobs += result.created || 0;
    this.counters.updatedJobs += result.updated || 0;
    this.counters.dedupeMerges += result.merged || 0;
    this.counters.dedupeRejected += result.rejected || 0;
    if (result.latencyMs != null) this.push('crawlMs', result.latencyMs);
    for (const [stage, n] of Object.entries(result.stages || {})) {
      this.counters.extractionStages[stage] = (this.counters.extractionStages[stage] || 0) + n;
      if (stage === 'BROWSER') this.counters.browserFallbacks += n;
    }
    for (const e of result.errors || []) {
      const k = e.errorClass || 'UNKNOWN';
      this.errorsByClass[k] = (this.errorsByClass[k] || 0) + 1;
      if (k === 'RATE_LIMIT') this.counters.rateLimited += 1;
    }
  }

  recordVerification(outcome) {
    this.counters.verificationsRun += 1;
    if (outcome === 'ok') this.counters.verificationsOk += 1;
    else if (outcome === 'closed') { this.counters.verificationsClosed += 1; this.counters.removedJobs += 1; }
    else this.counters.verificationsFailed += 1;
  }

  percentile(bucket, p) {
    const arr = [...(this.timings[bucket] || [])].sort((a, b) => a - b);
    if (!arr.length) return null;
    return arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
  }

  snapshot() {
    const stages = this.counters.extractionStages;
    const stageTotal = Object.values(stages).reduce((a, b) => a + b, 0);
    return {
      counters: { ...this.counters },
      errorsByClass: { ...this.errorsByClass },
      latency: {
        crawlP50: this.percentile('crawlMs', 50),
        crawlP95: this.percentile('crawlMs', 95),
        verifyP50: this.percentile('verifyMs', 50),
        searchP50: this.percentile('searchMs', 50),
        searchP95: this.percentile('searchMs', 95),
      },
      /* §51 — browser fallback should stay LOW because HTTP/structured
         adapters handle most supported sources. Measured, not asserted. */
      browserFallbackPct: stageTotal ? Math.round((this.counters.browserFallbacks / stageTotal) * 100) : 0,
      fetchSuccessRate: this.counters.fetchAttempts
        ? Number((this.counters.fetchSuccess / this.counters.fetchAttempts).toFixed(3))
        : null,
    };
  }
}

/* --------------------------- verification --------------------------- */

export class VerificationWorker {
  constructor({ store, registry, adapters, metrics = null, logger = console, now = () => new Date() }) {
    this.store = store;
    this.registry = registry;
    this.adapters = adapters;
    this.metrics = metrics;
    this.logger = logger;
    this.now = now;
  }

  /**
   * Re-verify jobs against their ORIGINAL source record. A single failed check
   * never closes a job; only proven closure (404/410 or an explicit closed
   * state) from the highest-authority instance does.
   */
  async run({ limit = 25, ctx = {} } = {}) {
    const nowMs = this.now().getTime();
    const before = new Date(nowMs - VERIFY_AFTER_DAYS * 86400000).toISOString();
    const candidates = await this.store.listVerificationCandidates({ before, limit: Math.max(limit * 2, limit) });
    const due = candidates.filter((j) => needsVerification(j, { now: nowMs })).slice(0, limit);

    const summary = { checked: 0, alive: 0, closed: 0, inconclusive: 0, details: [] };

    for (const job of due) {
      /* Verify against the most authoritative instance available. */
      const instance = (job.sourceInstances || [])
        .filter((s) => s.jobUrl || s.applyUrl)
        .sort((a, b) => (
          ({ [SOURCE_CLASS.ORIGINAL_CAREER_SITE]: 4, [SOURCE_CLASS.ORIGINAL_ATS]: 3, [SOURCE_CLASS.TRUSTED_FEED]: 2, [SOURCE_CLASS.AGGREGATOR]: 1 }[b.sourceClass] ?? 0)
          - ({ [SOURCE_CLASS.ORIGINAL_CAREER_SITE]: 4, [SOURCE_CLASS.ORIGINAL_ATS]: 3, [SOURCE_CLASS.TRUSTED_FEED]: 2, [SOURCE_CLASS.AGGREGATOR]: 1 }[a.sourceClass] ?? 0)
        ))[0];
      if (!instance) { summary.inconclusive += 1; continue; }

      const source = instance.sourceId ? await this.store.getSource(instance.sourceId) : null;
      const adapter = this.adapters.forSource(source || { provider: instance.provider });

      const started = Date.now();
      let result;
      try {
        result = await adapter.verify(instance, ctx);
      } catch (e) {
        result = { ok: false, status: null, closed: false, errorClass: e?.errorClass || 'UNKNOWN', reason: e?.message };
      }
      this.metrics?.push?.('verifyMs', Date.now() - started);
      summary.checked += 1;

      /* An aggregator's dead link is weak evidence — it does not close a job
         that an original ATS also carries. */
      if (result.closed && result.weakEvidence) {
        const hasOriginal = (job.sourceInstances || []).some(
          (s) => s.sourceClass === SOURCE_CLASS.ORIGINAL_ATS || s.sourceClass === SOURCE_CLASS.ORIGINAL_CAREER_SITE,
        );
        if (hasOriginal) result = { ...result, closed: false, ok: false, errorClass: 'UNKNOWN' };
      }

      const at = this.now().toISOString();
      const updated = applyVerification(job, result, { sourceId: instance.sourceId, at });
      await this.store.putJob(updated);

      if (result.ok) { summary.alive += 1; this.metrics?.recordVerification('ok'); }
      else if (updated.status === JOB_STATUS.REMOVED) { summary.closed += 1; this.metrics?.recordVerification('closed'); }
      else { summary.inconclusive += 1; this.metrics?.recordVerification('failed'); }

      summary.details.push({
        jobId: job.id, provider: instance.provider, ok: !!result.ok,
        status: result.status ?? null, newStatus: updated.status,
      });
    }
    return summary;
  }

  /** Age-based sweep. Downgrades to STALE; never deletes. */
  async sweep({ limit = 500 } = {}) {
    const jobs = await this.store.listJobs({ excludeStatus: JOB_STATUS.REMOVED, limit });
    let downgraded = 0;
    for (const job of jobs) {
      const next = sweepStaleness(job, { now: this.now().getTime() });
      if (next !== job) { await this.store.putJob(next); downgraded += 1; }
    }
    return { scanned: jobs.length, downgraded };
  }
}

/* ---------------------------- scheduler ---------------------------- */

export class CrawlScheduler {
  constructor({
    registry, ingest, verifier, discovery = null, metrics = null,
    logger = console, now = () => new Date(),
    sourcesPerTick = 5, verifyPerTick = 20, discoverPerTick = 5,
  }) {
    this.registry = registry;
    this.ingest = ingest;
    this.verifier = verifier;
    this.discovery = discovery;
    this.metrics = metrics;
    this.logger = logger;
    this.now = now;
    this.sourcesPerTick = sourcesPerTick;
    this.verifyPerTick = verifyPerTick;
    this.discoverPerTick = discoverPerTick;
    this.running = false;
    this.lastTick = null;
  }

  /**
   * One bounded slice of work. Safe to call from a cron trigger, a queue
   * consumer or a long-running worker. Never runs two ticks concurrently.
   */
  async tick({ crawl = true, verify = true, discover = true, ctx = {} } = {}) {
    if (this.running) return { skipped: true, reason: 'tick already in progress' };
    this.running = true;
    const started = Date.now();
    const out = { at: this.now().toISOString(), crawled: [], verification: null, discovery: null, errors: [] };

    try {
      if (crawl) {
        const due = await this.registry.due({ limit: this.sourcesPerTick });
        for (const source of due) {
          if (source.accessPolicy !== ACCESS_POLICY.ALLOW) continue;
          if (source.status === SOURCE_STATUS.DISABLED || source.status === SOURCE_STATUS.NOT_CONFIGURED) continue;
          // eslint-disable-next-line no-await-in-loop
          const r = await this.ingest.runSource(source, { ctx });
          out.crawled.push({
            sourceId: source.id, provider: source.provider, tenant: source.tenant,
            ok: r.ok, fetched: r.fetched, created: r.created, merged: r.merged,
            notModified: r.notModified, notConfigured: r.notConfigured,
            errors: r.errors.map((e) => e.errorClass),
          });
        }
      }

      if (verify && this.verifier) {
        out.verification = await this.verifier.run({ limit: this.verifyPerTick, ctx });
      }

      if (discover && this.discovery) {
        /* Durable self-expansion queue. The STORE selects only jobs whose
           source-discovery attempt is due; no arbitrary first-500 scan and no
           process-local negative cache is relied on for fairness. */
        const jobs = await this.ingest.store.listDiscoveryCandidates({ at: this.now().toISOString(), limit: this.discoverPerTick });
        const results = [];
        for (const job of jobs) {
          // eslint-disable-next-line no-await-in-loop
          const r = await this.discovery.discoverFromJob(job);
          const attempts = (job.sourceDiscovery?.attempts || 0) + 1;
          const baseHours = r.ok ? 24 * 7 : Math.min(24 * 30, 24 * (2 ** Math.min(5, attempts - 1)));
          const at = this.now().toISOString();
          const nextAttemptAt = new Date(this.now().getTime() + baseHours * 3600000).toISOString();
          const updated = {
            ...job,
            sourceDiscovery: {
              ...(job.sourceDiscovery || {}),
              attempts,
              lastAttemptAt: at,
              nextAttemptAt,
              state: r.ok ? (r.created ? 'SOURCE_REGISTERED' : 'RESOLVED_OR_KNOWN') : (r.skipped ? 'DEFERRED' : 'FAILED'),
              lastReason: r.reason || null,
              sourceId: r.source?.id || job.sourceDiscovery?.sourceId || null,
            },
          };
          // eslint-disable-next-line no-await-in-loop
          await this.ingest.store.putJob(updated);
          results.push({ company: job.company?.name || null, ...r, source: r.source ? { id: r.source.id, provider: r.source.provider, tenant: r.source.tenant } : null });
        }
        out.discovery = { results, durableQueue: true };
      }
    } catch (e) {
      out.errors.push({ message: e?.message || String(e) });
    } finally {
      this.running = false;
      this.lastTick = this.now().toISOString();
      out.durationMs = Date.now() - started;
    }
    return out;
  }

  /** Local development only. Serverless deployments must use tick(). */
  async runForever({ intervalMs = 60_000, signal = null } = {}) {
    /* eslint-disable no-await-in-loop */
    while (!signal?.aborted) {
      await this.tick();
      await new Promise((r) => {
        const t = setTimeout(r, intervalMs);
        if (typeof t.unref === 'function') t.unref();
      });
    }
    /* eslint-enable no-await-in-loop */
  }
}

export default { CrawlScheduler, VerificationWorker, Metrics };
