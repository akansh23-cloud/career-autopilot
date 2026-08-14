/* ============================================================
   JOB DISCOVERY OS — SOURCE REGISTRY  (§5, §23, §27)
   ------------------------------------------------------------
   The registry is the asset. Jobs churn; the knowledge of WHICH
   boards exist, who they belong to, whether they are healthy and
   how often they change is what compounds.

   Tracks per source: identity, provider, tenant, URLs, status,
   access policy, crawl strategy + interval, attempt/success times,
   consecutive failures, jobs last seen, robots + storage policy,
   HTTP validators, and a rolling health window.
   ============================================================ */

import {
  PROVIDER, SOURCE_TYPE, SOURCE_CLASS, SOURCE_STATUS, ACCESS_POLICY, ERROR_CLASS,
} from './schema.js';
import { sha256, registrableDomain } from './normalize/text.js';

export const CRAWL_STRATEGY = Object.freeze({
  API: 'API',
  FEED: 'FEED',
  HTML: 'HTML',
  BROWSER: 'BROWSER',
});

/** Default cadence by source class — ATS boards change more usefully than aggregators. */
export const DEFAULT_INTERVAL_MINUTES = Object.freeze({
  [SOURCE_CLASS.ORIGINAL_ATS]: 180,
  [SOURCE_CLASS.ORIGINAL_CAREER_SITE]: 360,
  [SOURCE_CLASS.TRUSTED_FEED]: 240,
  [SOURCE_CLASS.AGGREGATOR]: 720,
});

export const MIN_INTERVAL_MINUTES = 30;
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
export const HEALTH_WINDOW = 20;

export function sourceId({ provider, tenant, careersUrl }) {
  const key = tenant ? `${provider}:${tenant}` : `${provider}:${careersUrl || ''}`;
  return `src_${sha256(key.toLowerCase()).slice(0, 20)}`;
}

export function makeSource(partial = {}) {
  const provider = partial.provider || PROVIDER.GENERIC;
  const sourceClass = partial.sourceClass || SOURCE_CLASS.ORIGINAL_CAREER_SITE;
  return {
    id: partial.id || sourceId({ provider, tenant: partial.tenant, careersUrl: partial.careersUrl }),
    companyId: partial.companyId ?? null,
    companyName: partial.companyName ?? null,
    /* baseUrl is the EMPLOYER's own domain only for a career site. For an ATS
       it is boards.greenhouse.io / jobs.lever.co, and for an aggregator it is
       the aggregator itself — deriving companyDomain from those stamped every
       ingested job with the wrong employer identity and broke cross-source
       dedupe. It is left null unless the caller actually knows it. */
    companyDomain: partial.companyDomain
      ?? (sourceClass === SOURCE_CLASS.ORIGINAL_CAREER_SITE && partial.baseUrl ? registrableDomain(partial.baseUrl) : null),
    companyWebsite: partial.companyWebsite ?? null,

    provider,
    sourceType: partial.sourceType || SOURCE_TYPE.CAREER_SITE,
    sourceClass,

    tenant: partial.tenant ?? null,
    region: partial.region ?? null,
    baseUrl: partial.baseUrl ?? null,
    careersUrl: partial.careersUrl ?? null,

    status: partial.status || SOURCE_STATUS.ACTIVE,
    accessPolicy: partial.accessPolicy || ACCESS_POLICY.REVIEW,

    crawlStrategy: partial.crawlStrategy || CRAWL_STRATEGY.API,
    crawlIntervalMinutes: partial.crawlIntervalMinutes ?? DEFAULT_INTERVAL_MINUTES[sourceClass] ?? 360,
    crawlPriority: partial.crawlPriority ?? 0,
    nextCrawlAt: partial.nextCrawlAt ?? null,
    cursor: partial.cursor ?? null,

    lastAttemptAt: partial.lastAttemptAt ?? null,
    lastSuccessAt: partial.lastSuccessAt ?? null,
    lastErrorAt: partial.lastErrorAt ?? null,
    lastErrorClass: partial.lastErrorClass ?? null,
    lastErrorMessage: partial.lastErrorMessage ?? null,

    consecutiveFailures: partial.consecutiveFailures ?? 0,
    jobsLastSeen: partial.jobsLastSeen ?? 0,

    robotsPolicy: partial.robotsPolicy ?? { checkedAt: null, policy: ACCESS_POLICY.REVIEW, crawlDelayMs: null },
    storagePolicy: partial.storagePolicy ?? { retainRawDays: 30, retainDescriptions: true },
    http: partial.http ?? { etag: null, lastModified: null },

    health: partial.health ?? {
      window: [],
      successRate: null,
      avgLatencyMs: null,
      avgJobsPerFetch: null,
      schemaErrors: 0,
      httpFailures: 0,
      rateLimits: 0,
      duplicateRatio: null,
      newJobRate: null,
      lastNewJobs: 0,
    },

    queries: partial.queries ?? null,
    location: partial.location ?? null,
    discoveredFrom: partial.discoveredFrom ?? null,
    createdAt: partial.createdAt || new Date().toISOString(),
  };
}

export class SourceRegistry {
  constructor({ store, logger = console, now = () => new Date() } = {}) {
    this.store = store;
    this.logger = logger;
    this.now = now;
  }

  nowIso() { return this.now().toISOString(); }

  async register(partial, { overwrite = false } = {}) {
    const candidate = makeSource(partial);
    const existing = await this.store.getSource(candidate.id);
    if (existing && !overwrite) {
      /* Known source: enrich missing metadata, never reset health or cursors.
         §24.1 — do not repeatedly rediscover what is already registered. */
      const merged = {
        ...existing,
        companyName: existing.companyName || candidate.companyName,
        companyDomain: existing.companyDomain || candidate.companyDomain,
        companyWebsite: existing.companyWebsite || candidate.companyWebsite,
        baseUrl: existing.baseUrl || candidate.baseUrl,
        careersUrl: existing.careersUrl || candidate.careersUrl,
        region: existing.region || candidate.region,
      };
      await this.store.putSource(merged);
      return { source: merged, created: false };
    }
    if (existing && overwrite) {
      const merged = { ...existing, ...candidate, health: existing.health, cursor: existing.cursor };
      await this.store.putSource(merged);
      return { source: merged, created: false };
    }
    candidate.nextCrawlAt = candidate.nextCrawlAt || this.nowIso();
    candidate.crawlPriority = this.priority(candidate);
    await this.store.putSource(candidate);
    return { source: candidate, created: true };
  }

  async get(id) { return this.store.getSource(id); }
  async list(filter = {}) { return this.store.listSources(filter); }

  async find({ provider, tenant }) {
    if (!provider || !tenant) return null;
    return this.store.getSource(sourceId({ provider, tenant }));
  }

  async update(id, patch) {
    const existing = await this.store.getSource(id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    await this.store.putSource(merged);
    return merged;
  }

  /* ------------------------- health + scheduling ------------------------- */

  /**
   * Record one crawl run. `result` carries what actually happened; nothing here
   * is inferred, so a failing source degrades visibly rather than silently
   * poisoning search (§23).
   */
  async recordRun(id, result = {}) {
    const source = await this.store.getSource(id);
    if (!source) return null;
    const at = this.nowIso();
    const ok = result.ok === true;

    const window = [...(source.health?.window || []), {
      at, ok,
      latencyMs: result.latencyMs ?? null,
      jobs: result.jobCount ?? 0,
      newJobs: result.newJobs ?? 0,
      duplicates: result.duplicates ?? 0,
      errorClass: result.errorClass ?? null,
      notModified: !!result.notModified,
    }].slice(-HEALTH_WINDOW);

    const runs = window.length;
    const successes = window.filter((w) => w.ok).length;
    const latencies = window.map((w) => w.latencyMs).filter((n) => typeof n === 'number');
    const jobCounts = window.filter((w) => w.ok).map((w) => w.jobs);
    const totalJobs = jobCounts.reduce((a, b) => a + b, 0);
    const totalDupes = window.reduce((a, w) => a + (w.duplicates || 0), 0);
    const totalNew = window.reduce((a, w) => a + (w.newJobs || 0), 0);

    const health = {
      ...source.health,
      window,
      successRate: runs ? successes / runs : null,
      avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
      avgJobsPerFetch: jobCounts.length ? Math.round(totalJobs / jobCounts.length) : null,
      schemaErrors: (source.health?.schemaErrors || 0) + (result.errorClass === ERROR_CLASS.SCHEMA_CHANGED ? 1 : 0),
      httpFailures: (source.health?.httpFailures || 0) + (ok ? 0 : 1),
      rateLimits: (source.health?.rateLimits || 0) + (result.errorClass === ERROR_CLASS.RATE_LIMIT ? 1 : 0),
      duplicateRatio: totalJobs ? totalDupes / totalJobs : null,
      newJobRate: totalJobs ? totalNew / totalJobs : null,
      lastNewJobs: result.newJobs ?? 0,
    };

    const consecutiveFailures = ok ? 0 : (source.consecutiveFailures || 0) + 1;
    /* A run can succeed at the HTTP level and still be untrustworthy. When the
       health assessment says the output is not credible, DEGRADED wins over the
       ordinary success path — otherwise a broken parser keeps a green light. */
    const baseStatus = this.deriveStatus(source, { ok, consecutiveFailures, errorClass: result.errorClass });
    const status = result.credible === false
      ? SOURCE_STATUS.DEGRADED
      : (result.healthStatus && ok ? result.healthStatus : baseStatus);
    const crawlIntervalMinutes = this.deriveInterval(source, { ok, result, health });

    const merged = {
      ...source,
      status,
      lastAttemptAt: at,
      lastSuccessAt: ok ? at : source.lastSuccessAt,
      lastErrorAt: ok ? source.lastErrorAt : at,
      lastErrorClass: ok ? null : (result.errorClass ?? ERROR_CLASS.UNKNOWN),
      lastErrorMessage: ok ? null : (result.message ? String(result.message).slice(0, 300) : null),
      consecutiveFailures,
      jobsLastSeen: ok ? (result.jobCount ?? source.jobsLastSeen) : source.jobsLastSeen,
      crawlIntervalMinutes,
      nextCrawlAt: new Date(this.now().getTime() + crawlIntervalMinutes * 60000).toISOString(),
      cursor: result.nextCursor ?? null,
      /* Retained, not overwritten with null on the next good run, so an operator
         can still see what tripped after a source self-heals. */
      anomaly: result.anomaly ?? source.anomaly ?? null,
      http: result.http ? { etag: result.http.etag ?? source.http?.etag ?? null, lastModified: result.http.lastModified ?? source.http?.lastModified ?? null } : source.http,
      health,
    };
    merged.crawlPriority = this.priority(merged);
    await this.store.putSource(merged);
    return merged;
  }

  deriveStatus(source, { ok, consecutiveFailures, errorClass }) {
    if (source.status === SOURCE_STATUS.NOT_CONFIGURED && errorClass === ERROR_CLASS.NOT_CONFIGURED) return SOURCE_STATUS.NOT_CONFIGURED;
    if (errorClass === ERROR_CLASS.NOT_CONFIGURED) return SOURCE_STATUS.NOT_CONFIGURED;
    if (errorClass === ERROR_CLASS.ROBOTS_DENIED) return SOURCE_STATUS.DISABLED;
    if (ok) return SOURCE_STATUS.ACTIVE;
    if (consecutiveFailures >= 8) return SOURCE_STATUS.DISABLED;
    if (consecutiveFailures >= 3) return SOURCE_STATUS.DEGRADED;
    if (errorClass === ERROR_CLASS.SCHEMA_CHANGED) return SOURCE_STATUS.REVIEW;
    return source.status === SOURCE_STATUS.ACTIVE ? SOURCE_STATUS.ACTIVE : source.status;
  }

  /**
   * §27 — priority as cadence. High-velocity boards are revisited sooner;
   * quiet or failing ones back off. Bounded both ways so nothing hammers a
   * host and nothing goes permanently dark.
   */
  deriveInterval(source, { ok, result, health }) {
    const base = source.crawlIntervalMinutes || DEFAULT_INTERVAL_MINUTES[source.sourceClass] || 360;
    if (!ok) return clampInterval(base * 2);
    if (result.notModified) return clampInterval(base * 1.5);
    const newJobs = result.newJobs ?? 0;
    if (newJobs >= 5) return clampInterval(base * 0.5);
    if (newJobs >= 1) return clampInterval(base * 0.8);
    if ((health.newJobRate ?? 0) === 0 && (health.window?.length || 0) >= 5) return clampInterval(base * 1.5);
    return clampInterval(base);
  }

  /** Sources due for a crawl. Production stores resolve this with an indexed
   * query on accessPolicy/status/nextCrawlAt/crawlPriority; REVIEW is not
   * executable permission. */
  async due({ limit = 20, at = null } = {}) {
    const nowIso = at || this.nowIso();
    if (typeof this.store.listDueSources === 'function') {
      return this.store.listDueSources({ at: nowIso, limit });
    }
    return [];
  }

  /** Composite priority: velocity + reliability + staleness + class. */
  priority(source) {
    const classWeight = {
      [SOURCE_CLASS.ORIGINAL_ATS]: 40,
      [SOURCE_CLASS.ORIGINAL_CAREER_SITE]: 30,
      [SOURCE_CLASS.TRUSTED_FEED]: 20,
      [SOURCE_CLASS.AGGREGATOR]: 10,
    }[source.sourceClass] ?? 10;

    const reliability = (source.health?.successRate ?? 0.5) * 25;
    const velocity = Math.min(20, (source.health?.lastNewJobs ?? 0) * 2);
    const size = Math.min(10, Math.log10((source.jobsLastSeen || 0) + 1) * 5);

    const lastAt = source.lastAttemptAt ? Date.parse(source.lastAttemptAt) : 0;
    const staleHours = lastAt ? (this.now().getTime() - lastAt) / 3600000 : 999;
    const staleness = Math.min(25, staleHours / 2);

    const penalty = (source.consecutiveFailures || 0) * 6;
    return classWeight + reliability + velocity + size + staleness - penalty;
  }

  async summary() {
    return this.store.sourceSummary();
  }
}

function clampInterval(minutes) {
  return Math.round(Math.max(MIN_INTERVAL_MINUTES, Math.min(MAX_INTERVAL_MINUTES, minutes)));
}

export default {
  SourceRegistry, makeSource, sourceId, CRAWL_STRATEGY,
  DEFAULT_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES,
};
