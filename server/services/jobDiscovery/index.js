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
import { DiscoveryQueue } from './discoveryQueue.js';
import { CrawlQueue } from './crawlQueue.js';
import { CompanyRegistry } from './companyRegistry.js';
import { ManualIngestService } from './manualIngest.js';
import { computeCoverage, NAMESPACE, coverageDisclaimer } from './coverageMetrics.js';
import { summarizeSourceHealth } from './sourceHealth.js';
import { summarizeChanges } from './changeIntelligence.js';
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
    crawlQueue = null, discoveryQueue = null, companies = null, manualIngest = null,
  }) {
    this.store = store;
    this.registry = registry;
    this.crawlQueue = crawlQueue;
    this.discoveryQueue = discoveryQueue;
    this.companies = companies;
    /* Operator-triggered ingestion. Same store, same guards, same canonical
       jobs — it only changes WHEN work happens and WHO asked for it. */
    this.manualIngest = manualIngest || new ManualIngestService({ service: this, logger });
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

  /**
   * Operator-triggered fetch. Accepts board URLs, careers pages, bare domains
   * or already-registered source ids, registers whatever is new, crawls it, and
   * persists the jobs into the SAME canonical store the autonomous pipeline
   * writes to — so they are searchable through the normal index immediately.
   */
  async fetchNow(targets, opts = {}) {
    return this.manualIngest.fetch(targets, opts);
  }

  /** Receipts for past manual fetches, newest first. */
  async ingestRuns(opts = {}) { return this.manualIngest.runs(opts); }

  async ingestRun(id) { return this.manualIngest.run(id); }

  /**
   * Browse what is actually in the store. This exists so an operator can VERIFY
   * a manual fetch landed, rather than trusting the run receipt — the receipt
   * says what we think happened, this says what is there.
   */
  async browseJobs(filter = {}) {
    const limit = Math.max(1, Math.min(200, Number(filter.limit) || 50));
    const jobs = await this.store.listJobs({ limit: 100000 });
    let out = jobs;
    if (filter.sourceId) out = out.filter((j) => (j.sourceInstances || []).some((s) => s.sourceId === filter.sourceId));
    if (filter.companyDomain) out = out.filter((j) => j.company?.domain === filter.companyDomain);
    if (filter.status) out = out.filter((j) => j.status === filter.status);
    if (filter.provider) out = out.filter((j) => (j.sourceInstances || []).some((s) => s.provider === filter.provider));
    if (filter.since) out = out.filter((j) => String(j.firstSeenAt || '') >= filter.since);
    const total = out.length;
    out.sort((a, b) => String(b.firstSeenAt || '').localeCompare(String(a.firstSeenAt || '')));
    const offset = Math.max(0, Number(filter.offset) || 0);
    return {
      total,
      offset,
      limit,
      jobs: out.slice(offset, offset + limit).map((j) => ({
        id: j.id,
        title: j.title,
        company: j.company?.name ?? null,
        companyDomain: j.company?.domain ?? null,
        status: j.status,
        locations: (j.locations || []).map((l) => l.raw).filter(Boolean),
        sourcePublishedAt: j.sourcePublishedAt,
        firstSeenAt: j.firstSeenAt,
        lastSeenAt: j.lastSeenAt,
        lastVerifiedAt: j.lastVerifiedAt,
        applyUrl: j.canonicalApplyUrl,
        providers: [...new Set((j.sourceInstances || []).map((s) => s.provider))],
        sourceIds: (j.sourceInstances || []).map((s) => s.sourceId),
        directApply: j.directApply,
        completeness: j.completeness,
      })),
    };
  }

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

  /**
   * Coverage report. The namespace is REQUIRED and travels with the numbers —
   * a fixture benchmark and live coverage are different claims and must never
   * be summed or shown under the same label.
   */
  async coverageReport({ namespace = NAMESPACE.PRODUCTION, windowHours = 24 } = {}) {
    const [sources, jobs, registrySummary, companies] = await Promise.all([
      this.registry.list({}),
      this.store.listJobs({ limit: 200000 }),
      this.registry.summary(),
      this.companies ? this.store.listCompanies({ limit: 100000 }) : Promise.resolve([]),
    ]);

    const snapshot = computeCoverage({
      jobs,
      sources,
      companies,
      namespace,
      windowHours,
      discoveryStats: this.discoveryQueue ? await this.discoveryQueue.stats() : null,
      crawlStats: this.crawlQueue ? await this.crawlQueue.stats() : null,
      runtime: this.metrics?.snapshot?.() ?? null,
    });

    const supplementalOnly = snapshot.jobs.total - snapshot.quality.directSourceCount;

    return {
      ...snapshot,
      disclaimer: coverageDisclaimer(snapshot),
      providers: this.adapters.coverageMatrix(),
      adapterStatus: this.adapters.statusReport(),
      registry: { ...registrySummary, health: summarizeSourceHealth(sources) },
      changes: summarizeChanges(jobs, {
        since: new Date(Date.now() - windowHours * 3600000).toISOString(),
      }),

      /* Stable surface retained for the admin route, the demo report and the
         phase-1 integration contract. Same numbers, previous field names —
         renaming a metric is not a reason to break every consumer of it. */
      providersImplemented: this.adapters.supportedProviders(),
      sources: {
        ...snapshot.sources,
        ...registrySummary,
      },
      coverage: {
        originalSourceCount: snapshot.quality.directSourceCount,
        originalSourcePct: snapshot.quality.directSourcePct,
        supplementalOnlyCount: supplementalOnly,
        supplementalOnlyPct: snapshot.jobs.total
          ? Math.round((supplementalOnly / snapshot.jobs.total) * 1000) / 10
          : 0,
        directApplyCount: snapshot.quality.directApplyCount,
        directApplyPct: snapshot.quality.directApplyPct,
        withPublishedDatePct: snapshot.quality.withPublishedDatePct,
        withSalaryPct: snapshot.quality.withSalaryPct,
        verificationCoveragePct: snapshot.quality.verificationCoveragePct,
        dedupeRatio: snapshot.quality.duplicateRatio,
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
      discoveryQueue: this.discoveryQueue ? await this.discoveryQueue.stats() : null,
      crawlQueue: this.crawlQueue ? await this.crawlQueue.stats() : null,
      companies: this.companies ? await this.companies.summary() : null,
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
  const companies = new CompanyRegistry({ store: resolvedStore, logger, now });
  const discoveryQueue = new DiscoveryQueue({ store: resolvedStore, logger, now });
  const crawlQueue = new CrawlQueue({ store: resolvedStore, logger, now });
  const ingest = new IngestPipeline({ store: resolvedStore, registry, adapters, logger, metrics, now });
  const discovery = new SourceDiscoveryEngine({
    http, registry, adapters, robots, logger, queue: discoveryQueue, companies,
  });
  const verifier = new VerificationWorker({ store: resolvedStore, registry, adapters, metrics, logger, now });
  const search = new StoreBackedSearchIndex({ store: resolvedStore });
  const scheduler = new CrawlScheduler({
    registry, ingest, verifier, discovery, metrics, logger, now,
    crawlQueue, discoveryQueue,
  });

  const service = new JobDiscoveryService({
    store: resolvedStore, registry, adapters, ingest, search, scheduler,
    verifier, discovery, http, browserPool, robots, metrics, logger,
    crawlQueue, discoveryQueue, companies,
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
