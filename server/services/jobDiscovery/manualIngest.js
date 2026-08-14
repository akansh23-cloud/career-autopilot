/* ============================================================
   JOB DISCOVERY OS — MANUAL INGESTION
   ------------------------------------------------------------
   Everything else in this system is autonomous: the discovery
   queue finds boards, the crawl queue works through them, the
   scheduler decides when. That is correct for steady state and
   useless for the two moments an operator actually has:

       "seed the index with these 40 employers, now"
       "this company just posted — pull it before tonight's tick"

   So this is the one-shot path. Give it targets, it registers
   them, crawls them, and persists what it found. The jobs land in
   the SAME canonical store the autonomous pipeline writes to, so
   they are searchable through the normal index immediately and
   forever after — there is no separate "manual" collection and no
   second code path for reading them back.

   WHAT THIS IS NOT ALLOWED TO DO
   ------------------------------
   An admin trigger is not an authorisation bypass. Manual fetches
   run through exactly the same guards as any scheduled crawl:

     - the SSRF-guarded HTTP client, unchanged
     - robots policy, unchanged: a REVIEW or DENY source is not
       crawled just because a human clicked a button
     - the source-health credibility guard, unchanged: a manual run
       cannot close jobs it failed to see
     - adapter configuration honesty, unchanged: NOT_CONFIGURED is
       reported, never silently treated as an empty board

   The only things a manual run changes are WHEN work happens and
   WHO asked for it. Both are recorded.

   BOUNDED BY CONSTRUCTION
   -----------------------
   One click must not be able to start an unbounded crawl of the
   internet. Targets per run, pages per source and total pages are
   all capped, and the response says when a cap was hit rather than
   quietly stopping.

   IDEMPOTENT
   ----------
   Running the same fetch twice is safe and is expected: the second
   run re-registers nothing, re-crawls the board, and dedupe folds
   the results onto the same canonical jobs. It updates; it never
   duplicates.
   ============================================================ */

import { sha256, registrableDomain, normalizeUrl } from './normalize/text.js';
import { detectAts } from './atsDetect.js';
import { ACCESS_POLICY, SOURCE_STATUS, PROVIDER, ERROR_CLASS } from './schema.js';

export const TARGET_KIND = Object.freeze({
  ATS_BOARD: 'ATS_BOARD',       // a URL we can fingerprint to provider + tenant
  SOURCE_ID: 'SOURCE_ID',       // an already-registered source
  CAREERS_URL: 'CAREERS_URL',   // a careers page we must classify first
  COMPANY_DOMAIN: 'COMPANY_DOMAIN', // just a domain; probe for a careers surface
});

export const RUN_MODE = Object.freeze({
  /* Crawl now, in this request, and return what landed. */
  INLINE: 'INLINE',
  /* Register and enqueue; the workers pick it up. For large batches, where
     holding an HTTP request open for 200 boards would be a bad idea. */
  QUEUE: 'QUEUE',
});

export const LIMITS = Object.freeze({
  maxTargetsPerRun: 50,
  maxPagesPerSource: 20,
  maxTotalPages: 400,
  maxRunsListed: 200,
});

/**
 * Classify one operator-supplied target string.
 *
 * Deliberately permissive about FORM and strict about MEANING: an operator
 * pastes whatever they have — a board URL, a careers page, a bare domain, a
 * source id — and the classifier works out which of those it is rather than
 * demanding they know.
 */
export function classifyTarget(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: false, reason: 'empty target' };

  if (/^src_[a-z0-9]+$/i.test(value)) {
    return { ok: true, kind: TARGET_KIND.SOURCE_ID, sourceId: value, input: value };
  }

  const looksLikeUrl = /^https?:\/\//i.test(value);
  if (looksLikeUrl) {
    const url = normalizeUrl(value);
    if (!url) return { ok: false, reason: 'unparseable url', input: value };
    const det = detectAts(url);
    if (det.detected && det.provider !== PROVIDER.GENERIC && det.tenant) {
      return {
        ok: true,
        kind: TARGET_KIND.ATS_BOARD,
        provider: det.provider,
        tenant: det.tenant,
        url,
        input: value,
      };
    }
    return { ok: true, kind: TARGET_KIND.CAREERS_URL, url, input: value };
  }

  /* registrableDomain() is a normalizer, not a validator — it will happily hand
     back "not a target". An operator's typo must be rejected here rather than
     becoming a discovery lead that probes a nonsense host. */
  if (LOOKS_LIKE_HOST.test(value)) {
    const domain = registrableDomain(value);
    if (domain) return { ok: true, kind: TARGET_KIND.COMPANY_DOMAIN, domain, input: value };
  }

  return { ok: false, reason: 'not a url, domain or source id', input: value };
}

/* A hostname: dot-separated labels, no whitespace, ending in a plausible TLD. */
const LOOKS_LIKE_HOST = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,24}\.?$/i;

export function runId(at, targets) {
  return `run_${sha256(`${at}:${targets.join('|')}`).slice(0, 20)}`;
}

export class ManualIngestService {
  constructor({ service, logger = console, now = () => new Date(), limits = LIMITS }) {
    this.service = service;
    this.logger = logger;
    this.now = now;
    this.limits = { ...LIMITS, ...limits };
  }

  nowIso() { return this.now().toISOString(); }

  get store() { return this.service.store; }

  /**
   * Fetch jobs for a batch of operator-supplied targets.
   *
   * @param targets   strings: board URLs, careers URLs, domains, or source ids
   * @param mode      INLINE (crawl now) or QUEUE (hand to the workers)
   * @param dryRun    resolve and report what WOULD be fetched, touch nothing
   * @param triggeredBy who asked — recorded on the run receipt
   */
  async fetch(targets = [], {
    mode = RUN_MODE.INLINE,
    dryRun = false,
    maxPagesPerSource = this.limits.maxPagesPerSource,
    triggeredBy = null,
    reason = null,
    ctx = {},
  } = {}) {
    const startedAt = this.nowIso();
    const started = Date.now();

    const list = (Array.isArray(targets) ? targets : [targets])
      .map((t) => String(t ?? '').trim())
      .filter(Boolean);

    if (!list.length) {
      return { ok: false, error: 'no_targets', message: 'Provide at least one URL, domain or source id.' };
    }

    const truncated = list.length > this.limits.maxTargetsPerRun;
    const accepted = list.slice(0, this.limits.maxTargetsPerRun);

    const results = [];
    let pagesSpent = 0;

    for (const raw of accepted) {
      const classified = classifyTarget(raw);
      if (!classified.ok) {
        results.push({ input: raw, ok: false, stage: 'CLASSIFY', reason: classified.reason });
        continue;
      }

      /* A shared page budget across the whole run. Without it, one enormous
         board can consume everything an operator asked for. */
      if (pagesSpent >= this.limits.maxTotalPages) {
        results.push({
          input: raw, ok: false, stage: 'BUDGET',
          reason: `run page budget of ${this.limits.maxTotalPages} exhausted before this target`,
        });
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const outcome = await this.fetchOne(classified, {
        mode, dryRun, ctx,
        maxPages: Math.min(maxPagesPerSource, this.limits.maxTotalPages - pagesSpent),
      });
      pagesSpent += outcome.pagesFetched || 0;
      results.push(outcome);
    }

    const totals = summarize(results, { pagesSpent });
    const finishedAt = this.nowIso();

    const run = {
      id: runId(startedAt, accepted),
      mode,
      dryRun,
      triggeredBy: triggeredBy ?? null,
      reason: reason ?? null,
      startedAt,
      finishedAt,
      durationMs: Date.now() - started,
      /* The receipt keeps a compact per-target record — enough to answer "what
         did that fetch actually do?" days later without keeping every job. */
      targets: results.map((r) => ({
        input: r.input,
        kind: r.kind ?? null,
        ok: r.ok,
        stage: r.stage,
        sourceId: r.sourceId ?? null,
        provider: r.provider ?? null,
        tenant: r.tenant ?? null,
        fetched: r.fetched ?? 0,
        created: r.created ?? 0,
        merged: r.merged ?? 0,
        reason: r.reason ?? null,
      })),
      totals,
      ok: results.some((r) => r.ok),
    };

    /* A dry run is a question, not an event — it leaves no receipt. */
    if (!dryRun) {
      try {
        await this.store.putIngestRun(run);
      } catch (e) {
        this.logger?.warn?.('[job-discovery] could not persist ingest run receipt', e?.message);
      }
    }

    return {
      ok: true,
      run,
      results,
      truncated,
      truncatedReason: truncated
        ? `only the first ${this.limits.maxTargetsPerRun} targets were accepted; submit the rest as a second run`
        : null,
      budgetExhausted: pagesSpent >= this.limits.maxTotalPages,
    };
  }

  /** Resolve one target to a registered source, then crawl or enqueue it. */
  async fetchOne(target, { mode, dryRun, maxPages, ctx }) {
    const base = { input: target.input, kind: target.kind };

    /* ---- resolve to a source ---- */
    let source = null;
    let registered = false;

    try {
      if (target.kind === TARGET_KIND.SOURCE_ID) {
        source = await this.service.registry.get(target.sourceId);
        if (!source) return { ...base, ok: false, stage: 'RESOLVE', reason: 'no such source' };
      } else if (target.kind === TARGET_KIND.ATS_BOARD) {
        if (dryRun) {
          return {
            ...base, ok: true, stage: 'DRY_RUN', provider: target.provider, tenant: target.tenant,
            reason: `would register ${target.provider}:${target.tenant} and crawl it`,
          };
        }
        const r = await this.service.discovery.registerAts({
          provider: target.provider,
          tenant: target.tenant,
          careersUrl: target.url,
          discoveredFrom: 'manual-admin',
        });
        if (!r.ok) return { ...base, ok: false, stage: 'REGISTER', reason: r.reason };
        source = r.source;
        registered = !!r.created;
      } else if (target.kind === TARGET_KIND.CAREERS_URL) {
        if (dryRun) {
          return { ...base, ok: true, stage: 'DRY_RUN', reason: 'would classify this careers page and register whatever it resolves to' };
        }
        const r = await this.service.registerFromUrl(target.url, { probe: false });
        if (!r.ok) return { ...base, ok: false, stage: 'REGISTER', reason: r.reason };
        source = r.source;
        registered = !!r.created;
      } else if (target.kind === TARGET_KIND.COMPANY_DOMAIN) {
        if (dryRun) {
          return { ...base, ok: true, stage: 'DRY_RUN', reason: `would probe ${target.domain} for a careers surface` };
        }
        const r = await this.service.discovery.discoverFromDomain(target.domain, { discoveredFrom: 'manual-admin' });
        if (!r.ok) return { ...base, ok: false, stage: 'DISCOVER', reason: r.reason };
        source = r.source;
        registered = !!r.created;
      }
    } catch (e) {
      return { ...base, ok: false, stage: 'RESOLVE', reason: e?.message || String(e) };
    }

    if (!source) return { ...base, ok: false, stage: 'RESOLVE', reason: 'target did not resolve to a source' };

    const identity = {
      sourceId: source.id,
      provider: source.provider,
      tenant: source.tenant,
      companyName: source.companyName ?? null,
      registered,
    };

    /* ---- the guards an admin trigger does NOT bypass ---- */

    if (source.accessPolicy !== ACCESS_POLICY.ALLOW) {
      /* REVIEW means we have not established that we are permitted to crawl
         this host. A human clicking "fetch" is not that establishment. */
      return {
        ...base, ...identity, ok: false, stage: 'ACCESS',
        reason: `source access policy is ${source.accessPolicy}; only ALLOW sources may be crawled. Approve the source first.`,
      };
    }

    if (source.status === SOURCE_STATUS.DISABLED) {
      return { ...base, ...identity, ok: false, stage: 'ACCESS', reason: 'source is DISABLED' };
    }

    const adapter = this.service.adapters.forSource(source);
    const cfg = adapter?.configurationStatus?.();
    if (cfg && cfg.configured === false) {
      return {
        ...base, ...identity, ok: false, stage: 'NOT_CONFIGURED',
        reason: cfg.reason,
        errorClass: ERROR_CLASS.NOT_CONFIGURED,
      };
    }

    if (dryRun) {
      return { ...base, ...identity, ok: true, stage: 'DRY_RUN', reason: 'source is registered, permitted and configured; would crawl now' };
    }

    /* ---- QUEUE mode: hand it to the workers ---- */
    if (mode === RUN_MODE.QUEUE) {
      if (!this.service.crawlQueue) {
        return { ...base, ...identity, ok: false, stage: 'QUEUE', reason: 'no crawl queue configured on this deployment' };
      }
      /* windowMinutes:5 makes an operator request its own idempotency window, so
         "fetch now" is not swallowed by a scheduled task already queued for the
         source's ordinary 6-hour window. */
      const q = await this.service.crawlQueue.enqueue(source, { priority: 1000, windowMinutes: 5 });
      return {
        ...base, ...identity, ok: true, stage: 'QUEUED',
        queued: q.created,
        reason: q.created ? 'queued for the next worker tick' : 'already queued for this window',
      };
    }

    /* ---- INLINE mode: crawl now ---- */
    try {
      const r = await this.service.ingest.runSource(source, { ctx, maxPages });
      return {
        ...base,
        ...identity,
        ok: r.ok,
        stage: r.ok ? 'CRAWLED' : 'CRAWL_FAILED',
        fetched: r.fetched,
        created: r.created,
        merged: r.merged,
        changed: r.changed,
        rejected: r.rejected,
        pagesFetched: r.pagesFetched || 1,
        notModified: r.notModified,
        /* Surfaced because "credible: false" is the difference between "this
           board has 3 jobs" and "our parser broke" — and an operator staring at
           a small number deserves to know which. */
        credible: r.health?.credible ?? true,
        reconciliationAllowed: r.reconciliation?.allowed ?? null,
        anomalies: (r.health?.anomalies || []).map((a) => a.kind),
        changeEvents: r.changeEvents,
        reason: r.ok
          ? `${r.created} new, ${r.merged} merged, ${r.changed} changed`
          : (r.errors[0]?.message || 'crawl failed'),
        errorClass: r.errors[0]?.errorClass ?? null,
      };
    } catch (e) {
      return { ...base, ...identity, ok: false, stage: 'CRAWL_FAILED', reason: e?.message || String(e) };
    }
  }

  /** Past manual runs, newest first. */
  async runs({ limit = 25, triggeredBy = null } = {}) {
    return this.store.listIngestRuns({
      limit: Math.min(limit, this.limits.maxRunsListed),
      triggeredBy,
    });
  }

  async run(id) { return this.store.getIngestRun(id); }
}

function summarize(results, { pagesSpent }) {
  const t = {
    targets: results.length,
    succeeded: 0,
    failed: 0,
    sourcesRegistered: 0,
    sourcesCrawled: 0,
    queued: 0,
    jobsFetched: 0,
    jobsCreated: 0,
    jobsMerged: 0,
    jobsChanged: 0,
    rowsRejected: 0,
    pagesFetched: pagesSpent,
    incredibleRuns: 0,
    byStage: {},
  };
  for (const r of results) {
    t.byStage[r.stage] = (t.byStage[r.stage] || 0) + 1;
    if (r.ok) t.succeeded += 1; else t.failed += 1;
    if (r.registered) t.sourcesRegistered += 1;
    if (r.stage === 'CRAWLED') t.sourcesCrawled += 1;
    if (r.stage === 'QUEUED' && r.queued) t.queued += 1;
    t.jobsFetched += r.fetched || 0;
    t.jobsCreated += r.created || 0;
    t.jobsMerged += r.merged || 0;
    t.jobsChanged += r.changed || 0;
    t.rowsRejected += r.rejected || 0;
    if (r.credible === false) t.incredibleRuns += 1;
  }
  return t;
}

export default { ManualIngestService, classifyTarget, TARGET_KIND, RUN_MODE, LIMITS };
