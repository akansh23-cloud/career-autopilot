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
import { allocateVerificationBudget, applyVerificationSchedule, isVerificationDue } from './verificationPolicy.js';
import { CRAWL_STATE, interleaveByHost } from './crawlQueue.js';
import { DISCOVERY_KIND } from './discoveryQueue.js';

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
  async run({ limit = 25, ctx = {}, deadlineAt = null } = {}) {
    const nowMs = this.now().getTime();
    const before = new Date(nowMs).toISOString();
    /* Over-fetch, then let the ADAPTIVE POLICY spend the budget. A fresh
       direct-ATS posting is worth far more re-checks than a four-month-old
       aggregator record, and taking candidates in id order wastes the budget on
       whatever happens to sort first. */
    const candidates = await this.store.listVerificationCandidates({ before, limit: Math.max(limit * 4, limit) });
    const allocated = allocateVerificationBudget(candidates, {
      limit,
      now: nowMs,
      sourceHealth: () => null,
    });
    const due = allocated.length
      ? allocated.map((a) => a.job)
      : candidates.filter((j) => needsVerification(j, { now: nowMs }) || isVerificationDue(j, { now: nowMs })).slice(0, limit);

    const summary = {
      checked: 0, alive: 0, closed: 0, inconclusive: 0, details: [],
      byTier: allocated.reduce((acc, a) => { acc[a.tier] = (acc[a.tier] || 0) + 1; return acc; }, {}),
    };

    for (const job of due) {
      if (deadlineAt != null && Date.now() >= Number(deadlineAt)) break;
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
      let updated = applyVerification(job, result, { sourceId: instance.sourceId, at });
      /* Re-tier after every check: a job that just changed, or that just failed
         a check, earns a different cadence than it had a moment ago. */
      updated = applyVerificationSchedule(updated, { now: this.now().getTime(), from: at });
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
    crawlQueue = null, discoveryQueue = null,
    logger = console, now = () => new Date(),
    sourcesPerTick = 5, verifyPerTick = 20, discoverPerTick = 5,
    workerId = `${process.env.JOB_DISCOVERY_WORKER_ID || 'worker'}-${Math.random().toString(36).slice(2, 8)}`,
  }) {
    this.registry = registry;
    this.ingest = ingest;
    this.verifier = verifier;
    this.discovery = discovery;
    this.crawlQueue = crawlQueue;
    this.discoveryQueue = discoveryQueue;
    this.metrics = metrics;
    this.logger = logger;
    this.now = now;
    this.sourcesPerTick = sourcesPerTick;
    this.verifyPerTick = verifyPerTick;
    this.discoverPerTick = discoverPerTick;
    /* Identity matters once there is more than one worker: leases are held
       against this id, and an expired lease is reclaimable by anyone. */
    this.workerId = workerId;
    this.running = false;
    this.lastTick = null;
  }

  /**
   * Queue-driven crawl slice. Due sources are ENQUEUED (idempotently, so two
   * triggers in one window produce one task), then leased and executed. The
   * atomicity lives in the store, so this is safe to run on several machines.
   */
  async crawlSlice({ ctx = {}, limit = this.sourcesPerTick, deadlineAt = null } = {}) {
    const out = { enqueued: 0, deduped: 0, leased: 0, crawled: [], deadLettered: 0 };

    /* A source with work already in flight — typically an operator's "fetch
       now" — is not enqueued again for its routine window. Two tasks for one
       board in one tick would crawl someone else's server twice for nothing. */
    const active = await this.crawlQueue.activeSourceIds();

    const due = await this.registry.due({ limit: limit * 3 });
    for (const source of due) {
      if (deadlineAt != null && Date.now() >= Number(deadlineAt)) break;
      if (source.accessPolicy !== ACCESS_POLICY.ALLOW) continue;
      if (source.status === SOURCE_STATUS.DISABLED || source.status === SOURCE_STATUS.NOT_CONFIGURED) continue;
      if (active.has(source.id)) { out.deduped += 1; continue; }
      // eslint-disable-next-line no-await-in-loop
      const r = await this.crawlQueue.enqueue(source);
      if (r.created) out.enqueued += 1; else out.deduped += 1;
    }

    const leased = interleaveByHost(await this.crawlQueue.lease({ limit, owner: this.workerId }));
    out.leased = leased.length;

    for (const task of leased) {
      if (deadlineAt != null && Date.now() >= Number(deadlineAt)) {
        // eslint-disable-next-line no-await-in-loop
        await this.crawlQueue.defer(task, { checkpoint: task.checkpoint, reason: 'scheduler execution deadline' });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const source = await this.registry.get(task.sourceId);
      if (!source) {
        // eslint-disable-next-line no-await-in-loop
        await this.crawlQueue.fail(task, { errorClass: 'UNKNOWN', message: 'source no longer registered' });
        out.deadLettered += 1;
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const r = await this.ingest.runSource(source, {
        ctx,
        resumeCursor: task.checkpoint?.cursor || null,
        checkpoint: (cp) => this.crawlQueue.checkpoint(task, cp),
        deadlineAt,
      });

      if (r.ok && r.partial) {
        // eslint-disable-next-line no-await-in-loop
        await this.crawlQueue.defer(task, {
          checkpoint: { cursor: r.nextCursor, pagesFetched: r.pagesFetched, created: r.created, merged: r.merged },
          reason: r.deadlineReached ? 'execution deadline continuation' : 'page continuation',
        });
      } else if (r.ok) {
        // eslint-disable-next-line no-await-in-loop
        await this.crawlQueue.complete(task, r);
      } else {
        // eslint-disable-next-line no-await-in-loop
        const failed = await this.crawlQueue.fail(task, {
          errorClass: r.errors[0]?.errorClass,
          message: r.errors[0]?.message,
        });
        if (failed.state === CRAWL_STATE.DEAD) out.deadLettered += 1;
      }

      out.crawled.push({
        sourceId: source.id, provider: source.provider, tenant: source.tenant,
        ok: r.ok, fetched: r.fetched, created: r.created, merged: r.merged,
        notModified: r.notModified, notConfigured: r.notConfigured,
        credible: r.health?.credible ?? true,
        reconciliation: r.reconciliation?.allowed ?? null,
        changeEvents: r.changeEvents,
        partial: !!r.partial,
        deadlineReached: !!r.deadlineReached,
        errors: r.errors.map((e) => e.errorClass),
      });
    }
    return out;
  }

  /** Queue-driven discovery slice. */
  async discoverySlice({ limit = this.discoverPerTick, deadlineAt = null } = {}) {
    const out = { seeded: 0, seededCompanies: 0, leased: 0, resolved: 0, failed: 0, results: [] };
    if (!this.discoveryQueue || !this.discovery) return out;

    /* The persistent company seed catalog is actionable input, not a decorative
       list. Feed unsourced career entries into the SAME durable discovery queue
       used by job-derived leads. Idempotency is owned by DiscoveryQueue, so
       repeatedly scanning a 1,000-company registry does not duplicate work. */
    const companyCandidates = await this.ingest.store.listCompanyDiscoveryCandidates?.({ limit }) || [];
    for (const company of companyCandidates) {
      if (deadlineAt != null && Date.now() >= Number(deadlineAt)) break;
      const hasAts = company.atsProvider && company.atsTenant;
      const lead = hasAts
        ? {
            kind: DISCOVERY_KIND.ATS_LINK,
            value: `${company.atsProvider}:${company.atsTenant}`,
            payload: {
              provider: company.atsProvider, tenant: company.atsTenant, careersUrl: company.careersUrl,
              companyName: company.name || null, companyDomain: company.domain || null, companyId: company.id || null,
            },
            confidence: company.sourceConfidence ?? 0.75,
            priority: 100,
            discoveredFrom: `company-seed:${company.seedSource || 'registry'}`,
          }
        : {
            kind: DISCOVERY_KIND.CAREERS_URL,
            value: company.careersUrl,
            payload: {
              careersUrl: company.careersUrl, companyName: company.name || null,
              companyDomain: company.domain || null, companyId: company.id || null,
            },
            confidence: company.sourceConfidence ?? 0.65,
            priority: 80,
            discoveredFrom: `company-seed:${company.seedSource || 'registry'}`,
          };
      // eslint-disable-next-line no-await-in-loop
      const seeded = await this.discoveryQueue.enqueue(lead);
      /* Even a deduped/backing-off task counts as this company's turn in the
         seed scheduler. Persisting the queue timestamp prevents the first few
         difficult employers from starving the remaining 1,000-company list. */
      // eslint-disable-next-line no-await-in-loop
      await this.discovery.companies?.markDiscoveryQueued?.(company, {
        outcome: seeded?.created ? 'QUEUED' : 'ALREADY_QUEUED',
      });
      if (seeded?.created) { out.seeded += 1; out.seededCompanies += 1; }
    }

    /* Seed from jobs that still have no direct-source provenance. */
    const jobs = await this.ingest.store.listDiscoveryCandidates({ at: this.now().toISOString(), limit });
    for (const job of jobs) {
      if (deadlineAt != null && Date.now() >= Number(deadlineAt)) break;
      // eslint-disable-next-line no-await-in-loop
      const seeded = await this.discovery.seedFromJob(job);
      out.seeded += seeded.created;
    }

    const tasks = await this.discoveryQueue.lease({ limit, owner: this.workerId });
    out.leased = tasks.length;
    for (const task of tasks) {
      if (deadlineAt != null && Date.now() >= Number(deadlineAt)) {
        // eslint-disable-next-line no-await-in-loop
        await this.discoveryQueue.defer(task, { reason: 'scheduler execution deadline' });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const r = await this.discovery.processTask(task);
      if (r.ok) out.resolved += 1; else out.failed += 1;
      out.results.push(r);
    }
    return out;
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
        if (this.crawlQueue) {
          const slice = await this.crawlSlice({ ctx });
          out.crawled = slice.crawled;
          out.queue = { enqueued: slice.enqueued, deduped: slice.deduped, leased: slice.leased, deadLettered: slice.deadLettered };
        } else {
          /* Direct execution path, retained for single-process fixtures and
             tests that inject no queue. */
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
              credible: r.health?.credible ?? true,
              errors: r.errors.map((e) => e.errorClass),
            });
          }
        }
      }

      if (verify && this.verifier) {
        out.verification = await this.verifier.run({ limit: this.verifyPerTick, ctx });
      }

      if (discover && this.discoveryQueue && this.discovery?.processTask) {
        out.discovery = await this.discoverySlice({ limit: this.discoverPerTick });
        out.discovery.durableQueue = true;
      } else if (discover && this.discovery) {
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

  /**
   * Drain one work phase until an execution deadline rather than until a count
   * ceiling. Chunk sizes only control lease/query granularity; the loop keeps
   * going while time and due work remain. This is the serverless-safe way to
   * stress large queues without silently truncating them.
   */
  async runPhaseUntilDeadline(phase, { budgetMs = 45_000, ctx = {} } = {}) {
    const started = Date.now();
    const deadlineAt = started + Math.max(1_000, Number(budgetMs) || 45_000);
    const out = { phase, startedAt: new Date(started).toISOString(), deadlineAt: new Date(deadlineAt).toISOString(), cycles: 0, results: [] };

    while (Date.now() < deadlineAt) {
      let r;
      if (phase === 'crawl') {
        r = await this.crawlSlice({ ctx, limit: this.sourcesPerTick, deadlineAt });
        out.results.push(r);
        out.cycles += 1;
        if (!r.leased && !r.enqueued) break;
      } else if (phase === 'discover') {
        r = await this.discoverySlice({ limit: this.discoverPerTick, deadlineAt });
        out.results.push(r);
        out.cycles += 1;
        if (!r.leased && !r.seeded) break;
      } else if (phase === 'verify') {
        r = await this.verifier.run({ limit: this.verifyPerTick, ctx, deadlineAt });
        out.results.push(r);
        out.cycles += 1;
        if (!r.checked) break;
      } else {
        throw new Error(`unknown job-discovery phase: ${phase}`);
      }
    }

    out.finishedAt = this.now().toISOString();
    out.durationMs = Date.now() - started;
    out.deadlineReached = Date.now() >= deadlineAt;
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
