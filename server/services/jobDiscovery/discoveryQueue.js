/* ============================================================
   JOB DISCOVERY OS — SOURCE DISCOVERY QUEUE
   ------------------------------------------------------------
   Discovery is not a sweep, it is a QUEUE. The difference matters:
   a sweep re-walks the same companies forever and re-probes the
   same dead domain every tick, which is both wasteful and rude to
   the hosts involved.

       discover company
         -> locate careers page
         -> detect ATS
         -> identify tenant / board
         -> register source
         -> validate
         -> crawl
         -> schedule future crawls

   Each arrow is a task with durable state. Every task carries:

       kind              what we are trying to resolve
       key               the DEDUPE identity (canonical, lowercase)
       state             PENDING | LEASED | RETRY | RESOLVED | EXHAUSTED | DEAD
       attempts          how many times we have tried
       nextAttemptAt     when it may be tried again (exponential backoff)
       failureReason     why the last attempt failed, classified
       confidence        how strong the evidence for this lead is
       discoveredFrom    provenance of the lead

   `key` is what stops the system rediscovering the same company:
   enqueueing an existing key updates its evidence and priority, it
   never creates a second task and never resets a backoff.
   ============================================================ */

import { ERROR_CLASS } from './schema.js';
import { sha256, registrableDomain, normalizeUrl, hostOf } from './normalize/text.js';

export const DISCOVERY_KIND = Object.freeze({
  COMPANY_DOMAIN: 'COMPANY_DOMAIN',   // probe a company's domain for a careers surface
  CAREERS_URL: 'CAREERS_URL',         // a specific careers page to classify
  ATS_LINK: 'ATS_LINK',               // a URL already fingerprinted as an ATS board
  SITEMAP: 'SITEMAP',                 // a sitemap that may list job pages
  JOB_BACKFILL: 'JOB_BACKFILL',       // an aggregator-only job whose origin is unknown
});

export const DISCOVERY_STATE = Object.freeze({
  PENDING: 'PENDING',
  LEASED: 'LEASED',
  RETRY: 'RETRY',
  RESOLVED: 'RESOLVED',     // a source was registered (or already existed)
  EXHAUSTED: 'EXHAUSTED',   // tried enough times, no source found — kept, not deleted
  DEAD: 'DEAD',             // permanently unusable lead (robots DENY, unparseable)
});

/** Failures that are worth retrying, and failures that are not. */
export const PERMANENT_FAILURES = new Set([
  ERROR_CLASS.ROBOTS_DENIED,
  ERROR_CLASS.SSRF_BLOCKED,
]);

export const MAX_ATTEMPTS = 6;
export const BASE_BACKOFF_HOURS = 6;
export const MAX_BACKOFF_HOURS = 24 * 30;
/* A resolved lead is revisited occasionally: companies switch ATS vendors. */
export const RESOLVED_RECHECK_HOURS = 24 * 21;

/**
 * Canonical dedupe key. Two leads that mean the same thing MUST produce the
 * same key, or the queue will happily probe one company twice a day forever.
 */
export function discoveryKey(kind, value) {
  const raw = String(value || '').trim().toLowerCase();
  switch (kind) {
    case DISCOVERY_KIND.COMPANY_DOMAIN:
      return `${kind}:${registrableDomain(raw) || raw}`;
    case DISCOVERY_KIND.CAREERS_URL:
    case DISCOVERY_KIND.SITEMAP:
      return `${kind}:${normalizeUrl(raw) || raw}`;
    case DISCOVERY_KIND.ATS_LINK:
      return `${kind}:${raw}`; // caller passes "PROVIDER:tenant"
    default:
      return `${kind}:${raw}`;
  }
}

export function taskId(key) { return `dq_${sha256(key).slice(0, 24)}`; }

export function makeDiscoveryTask({
  kind, value, payload = {}, confidence = 0.5, discoveredFrom = null,
  priority = 0, now = new Date().toISOString(),
}) {
  const key = discoveryKey(kind, value);
  return {
    id: taskId(key),
    kind,
    key,
    payload,
    state: DISCOVERY_STATE.PENDING,
    attempts: 0,
    priority,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastReason: null,
    failureReason: null,
    confidence,
    discoveredFrom,
    resolvedSourceId: null,
    companyId: payload.companyId ?? null,
    leaseOwner: null,
    leaseExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function backoffHours(attempts) {
  return Math.min(MAX_BACKOFF_HOURS, BASE_BACKOFF_HOURS * (2 ** Math.max(0, attempts - 1)));
}

export class DiscoveryQueue {
  constructor({ store, logger = console, now = () => new Date(), maxAttempts = MAX_ATTEMPTS } = {}) {
    this.store = store;
    this.logger = logger;
    this.now = now;
    this.maxAttempts = maxAttempts;
    this.metrics = {
      enqueued: 0, deduped: 0, leased: 0,
      resolved: 0, retried: 0, exhausted: 0, dead: 0,
    };
  }

  nowIso() { return this.now().toISOString(); }

  /**
   * Add a lead. Idempotent by construction: an existing key is ENRICHED, never
   * duplicated and never reset. A stronger piece of evidence can raise a task's
   * confidence and priority, but it cannot wipe out a backoff that a string of
   * failures earned, or resurrect a lead we proved is unusable.
   */
  async enqueue({ kind, value, payload = {}, confidence = 0.5, discoveredFrom = null, priority = 0 }) {
    if (!value) return { ok: false, reason: 'no discovery value' };
    const candidate = makeDiscoveryTask({ kind, value, payload, confidence, discoveredFrom, priority, now: this.nowIso() });
    const existing = await this.store.getDiscoveryTask(candidate.id);

    if (existing) {
      this.metrics.deduped += 1;
      const merged = {
        ...existing,
        payload: { ...existing.payload, ...payload },
        confidence: Math.max(existing.confidence ?? 0, confidence),
        priority: Math.max(existing.priority ?? 0, priority),
        discoveredFrom: existing.discoveredFrom || discoveredFrom,
        updatedAt: this.nowIso(),
      };
      await this.store.putDiscoveryTask(merged);
      return { ok: true, created: false, task: merged, reason: 'lead already queued' };
    }

    this.metrics.enqueued += 1;
    await this.store.putDiscoveryTask(candidate);
    return { ok: true, created: true, task: candidate };
  }

  /** Bulk enqueue that reports how much of a batch was genuinely new. */
  async enqueueMany(leads = []) {
    let created = 0;
    let deduped = 0;
    for (const lead of leads) {
      // eslint-disable-next-line no-await-in-loop
      const r = await this.enqueue(lead);
      if (r.ok && r.created) created += 1;
      else if (r.ok) deduped += 1;
    }
    return { submitted: leads.length, created, deduped };
  }

  async lease({ limit = 10, owner = 'worker', leaseMs = 120000 } = {}) {
    const tasks = await this.store.leaseDiscoveryTasks({ at: this.nowIso(), limit, owner, leaseMs });
    this.metrics.leased += tasks.length;
    return tasks;
  }

  /** A source was found (or already known). */
  async resolve(task, { sourceId = null, companyId = null, reason = null } = {}) {
    this.metrics.resolved += 1;
    const at = this.nowIso();
    const next = {
      ...task,
      state: DISCOVERY_STATE.RESOLVED,
      attempts: (task.attempts || 0) + 1,
      lastAttemptAt: at,
      /* Resolved is not final: employers migrate between ATS vendors, so the
         lead is rechecked long after the fact rather than closed forever. */
      nextAttemptAt: new Date(this.now().getTime() + RESOLVED_RECHECK_HOURS * 3600000).toISOString(),
      lastReason: reason,
      failureReason: null,
      resolvedSourceId: sourceId,
      companyId: companyId ?? task.companyId ?? null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: at,
    };
    await this.store.putDiscoveryTask(next);
    return next;
  }

  /**
   * An attempt failed. Classify it: a permanent failure is DEAD immediately, a
   * transient one backs off exponentially, and running out of attempts leaves
   * the lead EXHAUSTED — recorded, not deleted, so we know we tried and why.
   */
  async fail(task, { errorClass = ERROR_CLASS.UNKNOWN, reason = null } = {}) {
    const at = this.nowIso();
    const attempts = (task.attempts || 0) + 1;

    if (PERMANENT_FAILURES.has(errorClass)) {
      this.metrics.dead += 1;
      const dead = {
        ...task,
        state: DISCOVERY_STATE.DEAD,
        attempts,
        lastAttemptAt: at,
        nextAttemptAt: null,
        lastReason: reason,
        failureReason: errorClass,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: at,
      };
      await this.store.putDiscoveryTask(dead);
      return dead;
    }

    const exhausted = attempts >= this.maxAttempts;
    if (exhausted) this.metrics.exhausted += 1; else this.metrics.retried += 1;

    const next = {
      ...task,
      state: exhausted ? DISCOVERY_STATE.EXHAUSTED : DISCOVERY_STATE.RETRY,
      attempts,
      lastAttemptAt: at,
      nextAttemptAt: exhausted
        ? null
        : new Date(this.now().getTime() + backoffHours(attempts) * 3600000).toISOString(),
      lastReason: reason,
      failureReason: errorClass,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: at,
    };
    await this.store.putDiscoveryTask(next);
    return next;
  }

  async stats() {
    const all = await this.store.listDiscoveryTasks({ limit: 100000 });
    const byState = {};
    const byKind = {};
    const byFailure = {};
    for (const t of all) {
      byState[t.state] = (byState[t.state] || 0) + 1;
      byKind[t.kind] = (byKind[t.kind] || 0) + 1;
      if (t.failureReason) byFailure[t.failureReason] = (byFailure[t.failureReason] || 0) + 1;
    }
    return {
      total: all.length,
      byState,
      byKind,
      byFailure,
      counters: { ...this.metrics },
      resolvedRate: all.length
        ? Number(((byState[DISCOVERY_STATE.RESOLVED] || 0) / all.length).toFixed(3))
        : null,
    };
  }
}

/* ------------------------------------------------------------------
   Lead extraction. Turns things we already hold into discovery leads.
   ------------------------------------------------------------------ */

/** Leads implied by a job we already have (typically aggregator-only). */
export function leadsFromJob(job, { detectAts }) {
  const leads = [];
  const from = `job:${job.id}`;

  for (const inst of job.sourceInstances || []) {
    for (const url of [inst.applyUrl, inst.jobUrl].filter(Boolean)) {
      const det = detectAts(url);
      if (det.detected && det.provider !== 'GENERIC' && det.tenant) {
        /* The strongest possible lead: the aggregator's own apply link IS the
           original board. Highest confidence, highest priority. */
        leads.push({
          kind: DISCOVERY_KIND.ATS_LINK,
          value: `${det.provider}:${det.tenant}`,
          payload: {
            provider: det.provider,
            tenant: det.tenant,
            careersUrl: url,
            companyName: job.company?.name ?? null,
            companyDomain: job.company?.domain ?? null,
          },
          confidence: det.confidence ?? 0.9,
          priority: 100,
          discoveredFrom: from,
        });
      }
    }
  }

  const domain = job.company?.domain
    || (job.company?.website ? registrableDomain(job.company.website) : null);
  if (domain) {
    leads.push({
      kind: DISCOVERY_KIND.COMPANY_DOMAIN,
      value: domain,
      payload: { companyName: job.company?.name ?? null, companyDomain: domain },
      confidence: 0.6,
      priority: 50,
      discoveredFrom: from,
    });
  }

  if (!leads.length) {
    /* Nothing actionable yet — record the gap so the queue can revisit it when
       the company acquires a domain, rather than losing the job entirely. */
    leads.push({
      kind: DISCOVERY_KIND.JOB_BACKFILL,
      value: job.company?.normalizedName || job.id,
      payload: { jobId: job.id, companyName: job.company?.name ?? null },
      confidence: 0.2,
      priority: 5,
      discoveredFrom: from,
    });
  }
  return leads;
}

/** Leads implied by a page we fetched: ATS links, careers links, sitemaps. */
export function leadsFromPage(html, pageUrl, { extractAtsLinks, extractJobLinks = null, careerHints = [] }) {
  const leads = [];
  const from = `page:${hostOf(pageUrl) || pageUrl}`;

  for (const link of extractAtsLinks(html, pageUrl)) {
    leads.push({
      kind: DISCOVERY_KIND.ATS_LINK,
      value: `${link.provider}:${link.tenant}`,
      payload: { provider: link.provider, tenant: link.tenant, careersUrl: link.url },
      confidence: link.confidence ?? 0.85,
      priority: 90,
      discoveredFrom: from,
    });
  }

  const seen = new Set();
  for (const m of String(html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let abs;
    try { abs = new URL(m[1], pageUrl).toString(); } catch { continue; }
    const lower = abs.toLowerCase();
    if (!careerHints.some((h) => lower.includes(h))) continue;
    const norm = normalizeUrl(abs);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    leads.push({
      kind: DISCOVERY_KIND.CAREERS_URL,
      value: norm,
      payload: { careersUrl: norm },
      confidence: 0.45,
      priority: 30,
      discoveredFrom: from,
    });
    if (seen.size >= 25) break;
  }
  return leads;
}

export default {
  DiscoveryQueue, DISCOVERY_KIND, DISCOVERY_STATE, makeDiscoveryTask,
  discoveryKey, taskId, backoffHours, leadsFromJob, leadsFromPage,
  MAX_ATTEMPTS, PERMANENT_FAILURES,
};
