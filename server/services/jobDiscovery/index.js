/* ============================================================
   JOB DISCOVERY OS — SERVICE FACADE
   ------------------------------------------------------------
   One object the rest of Career Autopilot talks to.

   BOUNDARY (§49): this service supplies canonical JobDocuments.
   It does NOT tailor resumes. Resume OS owns ResumeDocument and
   stays untouched — "Tailor Resume" hands a JobDocument across
   the boundary and nothing else crosses it.

   BOUNDARY (§0/§50): search() reads only a query. There is no
   parameter, anywhere in this file, through which a resume,
   profile, evidence graph or Career Autopilot score could enter.
   ============================================================ */

import { createStore } from './store.js';
import { SourceRegistry, makeSource, CRAWL_STRATEGY } from './sourceRegistry.js';
import AdapterRegistry from './adapters/index.js';
import { IngestPipeline } from './ingest.js';
import { SourceDiscoveryEngine } from './sourceDiscovery.js';
import { StoreBackedSearchIndex, publicJobView } from './searchIndex.js';
import { CrawlScheduler, VerificationWorker, Metrics } from './scheduler.js';
import { SafeHttpClient } from './crawler/httpClient.js';
import { RateController } from './crawler/rateControl.js';
import { RobotsPolicy } from './crawler/robots.js';
import { BrowserPool } from './crawler/browserPool.js';
import {
  PROVIDER, SOURCE_TYPE, SOURCE_CLASS, SOURCE_STATUS, ACCESS_POLICY, JOB_STATUS,
} from './schema.js';
import { detectAts } from './atsDetect.js';

export class JobDiscoveryService {
  constructor({
    store, registry, adapters, ingest, search, scheduler, verifier, discovery,
    http, browserPool, robots, metrics, logger = console,
  }) {
    this.store = store;
    this.registry = registry;
    this.adapters = adapters;
    this.ingest = ingest;
    this.searchIndex = search;
    this.scheduler = scheduler;
    this.verifier = verifier;
    this.discovery = discovery;
    this.http = http;
    this.browserPool = browserPool;
    this.robots = robots;
    this.metrics = metrics;
    this.logger = logger;
  }

  /* ------------------------------ search ------------------------------ */

  /**
   * Anonymous, resume-free search. This is the ONLY search path the UI uses.
   * It never performs a network fetch.
   */
  async search(criteria = {}) {
    const started = Date.now();
    const payload = await this.searchIndex.search(criteria);
    this.metrics?.push?.('searchMs', Date.now() - started);
    return payload;
  }

  async getJob(id) {
    const job = await this.store.getJob(id);
    return job ? publicJobView(job) : null;
  }

  /* ------------------------- source management ------------------------- */

  /** Register a source explicitly (admin/seed path). */
  async registerSource(partial, opts = {}) {
    return this.registry.register(makeSource(partial), opts);
  }

  /**
   * Register from a URL: fingerprint it, extract the tenant, pick the class.
   * The URL is untrusted input and is validated by the same guards as any
   * crawl target before anything is fetched.
   */
  async registerFromUrl(url, { companyName = null, companyDomain = null, probe = true } = {}) {
    const det = detectAts(url);
    if (det.provider !== PROVIDER.GENERIC && det.tenant) {
      return this.discovery.registerAts({
        provider: det.provider, tenant: det.tenant, companyName, companyDomain,
        careersUrl: url, discoveredFrom: 'manual',
      });
    }
    if (!probe) {
      return this.discovery.registerGeneric({ careersUrl: url, companyName, companyDomain, discoveredFrom: 'manual' });
    }
    return this.discovery.discoverFromDomain(companyDomain || url, { companyName, discoveredFrom: 'manual' });
  }

  async listSources(filter = {}) { return this.registry.list(filter); }

  async crawlSource(sourceId, opts = {}) {
    const source = await this.registry.get(sourceId);
    if (!source) return { ok: false, reason: 'unknown source' };
    return this.ingest.runSource(source, opts);
  }

  async verifySource(sourceId, { limit = 25 } = {}) {
    const source = await this.registry.get(sourceId);
    if (!source) return { ok: false, reason: 'unknown source' };
    const jobs = await this.store.listJobs({ sourceId, excludeStatus: JOB_STATUS.REMOVED, limit });
    const marked = jobs.map((j) => ({ ...j, needsVerification: true }));
    for (const j of marked) await this.store.putJob(j);
    return this.verifier.run({ limit });
  }

  async reprocessSource(sourceId, opts = {}) {
    const source = await this.registry.get(sourceId);
    if (!source) return { ok: false, reason: 'unknown source' };
    return this.ingest.reprocessSource(source, opts);
  }

  async tick(opts = {}) { return this.scheduler.tick(opts); }

  /* ------------------------- health + reporting ------------------------- */

  async sourceHealth() {
    const sources = await this.registry.list({});
    const now = Date.now();
    return sources.map((s) => ({
      id: s.id,
      provider: s.provider,
      sourceClass: s.sourceClass,
      tenant: s.tenant,
      companyName: s.companyName,
      careersUrl: s.careersUrl,
      status: s.status,
      accessPolicy: s.accessPolicy,
      lastAttemptAt: s.lastAttemptAt,
      lastSuccessAt: s.lastSuccessAt,
      lastErrorAt: s.lastErrorAt,
      lastErrorClass: s.lastErrorClass,
      lastErrorMessage: s.lastErrorMessage,
      consecutiveFailures: s.consecutiveFailures,
      jobsLastSeen: s.jobsLastSeen,
      newJobsLastRun: s.health?.lastNewJobs ?? 0,
      successRate: s.health?.successRate ?? null,
      avgLatencyMs: s.health?.avgLatencyMs ?? null,
      duplicateRatio: s.health?.duplicateRatio ?? null,
      schemaErrors: s.health?.schemaErrors ?? 0,
      crawlIntervalMinutes: s.crawlIntervalMinutes,
      nextCrawlAt: s.nextCrawlAt,
      overdueMinutes: s.nextCrawlAt ? Math.max(0, Math.round((now - Date.parse(s.nextCrawlAt)) / 60000)) : null,
      priority: Math.round(this.registry.priority(s)),
    }));
  }

  /** §63 — coverage report data. Fixture runs are labelled by the caller. */
  async coverageReport() {
    const [sources, jobs, registrySummary] = await Promise.all([
      this.registry.list({}),
      this.store.listJobs({ limit: 100000 }),
      this.registry.summary(),
    ]);

    const byProvider = {};
    const byStatus = {};
    let originalSourced = 0;
    let aggregatorOnly = 0;
    let directApply = 0;
    let withPublishedDate = 0;
    let withSalary = 0;
    let verified = 0;
    let totalInstances = 0;

    for (const job of jobs) {
      byStatus[job.status] = (byStatus[job.status] || 0) + 1;
      const instances = job.sourceInstances || [];
      totalInstances += instances.length;
      const hasOriginal = instances.some((s) => s.sourceClass === SOURCE_CLASS.ORIGINAL_ATS || s.sourceClass === SOURCE_CLASS.ORIGINAL_CAREER_SITE);
      if (hasOriginal) originalSourced += 1; else aggregatorOnly += 1;
      for (const p of new Set(instances.map((s) => s.provider))) byProvider[p] = (byProvider[p] || 0) + 1;
      const applyInstance = instances.find((s) => s.applyUrl === job.canonicalApplyUrl);
      if (applyInstance && (applyInstance.sourceClass === SOURCE_CLASS.ORIGINAL_ATS || applyInstance.sourceClass === SOURCE_CLASS.ORIGINAL_CAREER_SITE)) directApply += 1;
      if (job.sourcePublishedAt) withPublishedDate += 1;
      if (job.compensation?.min != null || job.compensation?.max != null) withSalary += 1;
      if (job.lastVerifiedAt) verified += 1;
    }

    const total = jobs.length || 0;
    const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);

    return {
      generatedAt: new Date().toISOString(),
      providersImplemented: this.adapters.supportedProviders(),
      adapterStatus: this.adapters.statusReport(),
      sources: {
        registered: sources.length,
        ...registrySummary,
      },
      jobs: {
        total,
        byStatus,
        byProvider,
        active: (byStatus[JOB_STATUS.ACTIVE] || 0) + (byStatus[JOB_STATUS.NEW] || 0) + (byStatus[JOB_STATUS.LIKELY_ACTIVE] || 0),
        new: byStatus[JOB_STATUS.NEW] || 0,
        removed: byStatus[JOB_STATUS.REMOVED] || 0,
        stale: byStatus[JOB_STATUS.STALE] || 0,
      },
      coverage: {
        originalSourceCount: originalSourced,
        originalSourcePct: pct(originalSourced),
        supplementalOnlyCount: aggregatorOnly,
        supplementalOnlyPct: pct(aggregatorOnly),
        directApplyCount: directApply,
        directApplyPct: pct(directApply),
        withPublishedDatePct: pct(withPublishedDate),
        withSalaryPct: pct(withSalary),
        verificationCoveragePct: pct(verified),
        /* >1.0 means multiple sources collapsed onto one canonical job. */
        dedupeRatio: total ? Math.round((totalInstances / total) * 100) / 100 : 0,
      },
      runtime: this.metrics?.snapshot?.() ?? null,
    };
  }

  async stats() {
    return {
      store: await this.store.stats(),
      search: await this.searchIndex.stats(),
      http: this.http?.stats?.() ?? null,
      browser: this.browserPool?.stats?.() ?? null,
      discovery: this.discovery?.stats?.() ?? null,
      metrics: this.metrics?.snapshot?.() ?? null,
      adapters: this.adapters.statusReport(),
    };
  }

  async close() {
    await this.browserPool?.close?.();
    await this.store?.flush?.();
  }
}

/**
 * Build a fully wired service. Every dependency is injectable so the whole
 * system can be exercised offline with fixtures and no network.
 */
export async function createJobDiscoveryService({
  store = null,
  mongoose = null,
  connect = null,
  dataDir = undefined,
  backend = undefined,
  fetchImpl = globalThis.fetch,
  resolver = undefined,
  legacySources = [],
  bootstrapQueries = undefined,
  logger = console,
  enableBrowser = String(process.env.JOB_DISCOVERY_BROWSER || '').toLowerCase() === '1',
  rateOptions = {},
  httpOptions = {},
  now = () => new Date(),
} = {}) {
  const resolvedStore = store || await createStore({ mongoose, connect, dataDir, backend });
  const metrics = new Metrics();

  const rate = new RateController({
    globalConcurrency: Number(process.env.JOB_DISCOVERY_GLOBAL_CONCURRENCY || 8),
    hostConcurrency: Number(process.env.JOB_DISCOVERY_HOST_CONCURRENCY || 2),
    minHostDelayMs: Number(process.env.JOB_DISCOVERY_HOST_DELAY_MS || 1000),
    ...rateOptions,
  });

  const http = new SafeHttpClient({ fetchImpl, resolver, rateController: rate, ...httpOptions });
  const robots = new RobotsPolicy({ fetchText: (url) => http.fetchText(url, { retries: 0, allowedContentTypes: ['text/plain', 'text/html'] }) });
  const browserPool = enableBrowser ? new BrowserPool({ resolver }) : null;

  const adapters = new AdapterRegistry({
    http, robots, browserPool, logger, legacySources, bootstrapQueries,
  });

  const registry = new SourceRegistry({ store: resolvedStore, logger, now });
  const ingest = new IngestPipeline({ store: resolvedStore, registry, adapters, logger, metrics, now });
  const discovery = new SourceDiscoveryEngine({ http, registry, adapters, robots, logger });
  const verifier = new VerificationWorker({ store: resolvedStore, registry, adapters, metrics, logger, now });
  const search = new StoreBackedSearchIndex({ store: resolvedStore });
  const scheduler = new CrawlScheduler({ registry, ingest, verifier, discovery, metrics, logger, now });

  const service = new JobDiscoveryService({
    store: resolvedStore, registry, adapters, ingest, search: search, scheduler,
    verifier, discovery, http, browserPool, robots, metrics, logger,
  });

  /* Bootstrap the legacy aggregators as SUPPLEMENTAL sources (§25). They are
     preserved, demoted, and can never outrank an original ATS. */
  for (const legacy of legacySources) {
    await registry.register(makeSource({
      provider: PROVIDER.API,
      sourceType: SOURCE_TYPE.AGGREGATOR,
      sourceClass: SOURCE_CLASS.AGGREGATOR,
      tenant: legacy.name,
      companyName: null,
      baseUrl: legacy.home || null,
      careersUrl: legacy.home || null,
      crawlStrategy: CRAWL_STRATEGY.API,
      accessPolicy: ACCESS_POLICY.ALLOW,
      status: SOURCE_STATUS.ACTIVE,
      queries: bootstrapQueries || null,
      discoveredFrom: 'legacy-bootstrap',
    }));
  }

  return service;
}

export default { JobDiscoveryService, createJobDiscoveryService };
