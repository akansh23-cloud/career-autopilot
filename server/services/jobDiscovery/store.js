/* ============================================================
   JOB DISCOVERY OS — PERSISTENCE
   ------------------------------------------------------------
   Six collections behind one interface:

     jobs        canonical JobDocuments
     sources     JobSourceRegistry entries — persistent, and one of
                 the central assets of the whole system
     raw         RawJobSnapshots with a retention policy
     companies   CompanyRegistry — normalized employer knowledge
     discovery   persistent Source Discovery Queue
     crawl       persistent Crawl Queue with worker leases + DLQ

   Three backends:

     MemoryStore  tests, workers and large deterministic fixtures.
                  Backed by a REAL inverted index, so 100k documents
                  are queried by posting-list retrieval rather than
                  by walking the collection.
     FileStore    single-node deployments and local development
     MongoStore   Atlas, with every index the system needs, plus an
                  optional Atlas Search retrieval path

   Every backend answers searchCandidates() with the SAME contract:
   { docs, matchedTotal, truncated, strategy } — so a caller can
   always tell whether a candidate budget hid anything.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { JOB_STATUS, RAW_SNAPSHOT_SCHEMA_VERSION, REMOTE_SCOPE, WORKPLACE_TYPE, SOURCE_CLASS } from './schema.js';
import { parseLocation, detectCountry, detectRegion, locationCompatibility } from './normalize/location.js';
import { salaryCompatibility } from './normalize/compensation.js';
import { blockingKeys } from './dedupe.js';
import { InvertedIndex } from './invertedIndex.js';

/* ------------------------------------------------------------------
   Base: shared query semantics so every backend behaves identically.
   ------------------------------------------------------------------ */

export class BaseJobStore {
  /* A monotonically-increasing counter bumped on every write that changes the
     job corpus. The search layer keys its cache on it, so an ingest — scheduled
     or operator-triggered — invalidates stale query results immediately instead
     of leaving them to expire. Without this, an admin fetches jobs and the app
     keeps serving "no results" for the remainder of the cache TTL. */
  writeGeneration = 0;

  bumpGeneration() { this.writeGeneration += 1; return this.writeGeneration; }

  generation() { return this.writeGeneration; }

  async init() { return this; }

  /* eslint-disable no-unused-vars */
  async putJob(job) { throw new Error('not implemented'); }
  async getJob(id) { throw new Error('not implemented'); }
  async findCandidates(job) { throw new Error('not implemented'); }
  async listJobs(filter = {}) { throw new Error('not implemented'); }
  async putSource(source) { throw new Error('not implemented'); }
  async getSource(id) { throw new Error('not implemented'); }
  async listSources(filter = {}) { throw new Error('not implemented'); }
  async putRaw(snapshot) { throw new Error('not implemented'); }
  /* eslint-enable no-unused-vars */

  async searchCandidates(criteria = {}) {
    const docs = await this.listJobs({ status: criteria.status, limit: criteria.candidateLimit || 500 });
    return criteria.withRetrievalMeta
      ? { docs, matchedTotal: docs.length, truncated: false, strategy: 'list' }
      : docs;
  }

  async listVerificationCandidates({ before = null, limit = 25 } = {}) { return this.listJobs({ excludeStatus: JOB_STATUS.REMOVED, limit }); }
  async listDiscoveryCandidates({ at = null, limit = 25 } = {}) { return this.listJobs({ excludeStatus: JOB_STATUS.REMOVED, limit }); }
  async listDueSources({ at = null, limit = 20 } = {}) { return this.listSources({}); }
  async pruneRaw() { return 0; }
  async stats() { return {}; }

  /* Queues + company registry. A backend that does not implement these
     degrades visibly rather than pretending to persist. */
  async putCompany() { return null; }
  async getCompany() { return null; }
  async listCompanies() { return []; }
  async listCompanyDiscoveryCandidates() { return []; }
  async seedCompanies(companies = []) {
    let inserted = 0;
    let matched = 0;
    for (const company of companies) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await this.getCompany(company.id);
      if (existing) { matched += 1; continue; }
      // eslint-disable-next-line no-await-in-loop
      await this.putCompany(company);
      inserted += 1;
    }
    return { inserted, matched, totalProcessed: companies.length };
  }
  async pageJobs({ page = 1, pageSize = 20, ...filter } = {}) {
    const all = await this.listJobs({ ...filter, limit: 100000 });
    const p = Math.max(1, Number(page) || 1);
    const size = Math.max(1, Number(pageSize) || 20);
    const offset = (p - 1) * size;
    return { docs: all.slice(offset, offset + size), total: all.length, page: p, pageSize: size };
  }
  async pageCompanies({ page = 1, pageSize = 20, ...filter } = {}) {
    const all = await this.listCompanies({ ...filter, limit: 100000 });
    const p = Math.max(1, Number(page) || 1);
    const size = Math.max(1, Number(pageSize) || 20);
    const offset = (p - 1) * size;
    return { docs: all.slice(offset, offset + size), total: all.length, page: p, pageSize: size };
  }
  async companySummary() {
    const all = await this.listCompanies({ limit: 100000 });
    const byProvider = {};
    let withDomain = 0; let withSource = 0; let withAts = 0; let seeded = 0;
    for (const c of all) {
      if (c.domain) withDomain += 1;
      if ((c.sourceIds || []).length) withSource += 1;
      if (c.atsProvider) { withAts += 1; byProvider[c.atsProvider] = (byProvider[c.atsProvider] || 0) + 1; }
      if (c.seedSource) seeded += 1;
    }
    return { total: all.length, seeded, withDomain, withRegisteredSource: withSource, withKnownAts: withAts, byProvider };
  }
  async sourceSummary() {
    const all = await this.listSources({});
    const byProvider = {}; const byStatus = {}; const byClass = {};
    for (const s of all) {
      byProvider[s.provider] = (byProvider[s.provider] || 0) + 1;
      byStatus[s.status] = (byStatus[s.status] || 0) + 1;
      byClass[s.sourceClass] = (byClass[s.sourceClass] || 0) + 1;
    }
    return { total: all.length, byProvider, byStatus, byClass };
  }
  async coverageAggregate() { return null; }
  async putDiscoveryTask() { return null; }
  async getDiscoveryTask() { return null; }
  async listDiscoveryTasks() { return []; }
  async leaseDiscoveryTasks() { return []; }
  async putCrawlTask() { return null; }
  async getCrawlTask() { return null; }
  async listCrawlTasks() { return []; }
  async leaseCrawlTasks() { return []; }
  async putIngestRun() { return null; }
  async getIngestRun() { return null; }
  async listIngestRuns() { return []; }
}

function matchesJobFilter(job, filter = {}) {
  if (filter.status) {
    const wanted = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (!wanted.includes(job.status)) return false;
  }
  if (filter.excludeStatus) {
    const bad = Array.isArray(filter.excludeStatus) ? filter.excludeStatus : [filter.excludeStatus];
    if (bad.includes(job.status)) return false;
  }
  if (filter.sourceId) {
    if (!(job.sourceInstances || []).some((s) => s.sourceId === filter.sourceId)) return false;
  }
  if (filter.provider) {
    if (!(job.sourceInstances || []).some((s) => s.provider === filter.provider)) return false;
  }
  if (filter.companyDomain && job.company?.domain !== filter.companyDomain) return false;
  if (filter.needsVerification && !job.needsVerification) return false;
  if (filter.since && (job.lastSeenAt || '') < filter.since) return false;
  return true;
}

/** Translate free-form search criteria into index-level structural filters. */
export function retrievalFiltersOf(criteria = {}) {
  const filters = {};
  if (criteria.companyNormalized) filters.companyNormalized = criteria.companyNormalized;
  if (criteria.employmentType) filters.employmentType = criteria.employmentType;
  if (Array.isArray(criteria.seniority) && criteria.seniority.length) filters.seniority = criteria.seniority;
  if (criteria.sourceType) filters.sourceClass = String(criteria.sourceType).toUpperCase();
  if (criteria.directApply) filters.directApply = true;
  if (criteria.remote === 'remote') filters.workplaceType = WORKPLACE_TYPE.REMOTE;
  if (criteria.remote === 'hybrid') filters.workplaceType = WORKPLACE_TYPE.HYBRID;
  if (criteria.remote === 'onsite') filters.workplaceType = WORKPLACE_TYPE.ONSITE;
  if (criteria.location) {
    const qLoc = parseLocation(criteria.location);
    const qCountry = detectCountry(criteria.location);
    const qRegion = detectRegion(criteria.location);
    if (qLoc?.city) filters.city = qLoc.city;
    const code = qCountry?.code || qLoc?.countryCode || null;
    if (code) filters.countryCode = code;
    filters.remoteRegions = [qCountry?.code, qRegion?.code].filter(Boolean);
  }
  return filters;
}

/* ------------------------------------------------------------------
   Memory — index-backed, not a linear scan.
   ------------------------------------------------------------------ */

export class MemoryJobStore extends BaseJobStore {
  constructor() {
    super();
    this.jobs = new Map();
    this.sources = new Map();
    this.companies = new Map();
    this.discoveryTasks = new Map();
    this.crawlTasks = new Map();
    /* Receipts for operator-triggered ingestion. A manual fetch that leaves no
       record is unauditable: "did last night's fetch actually land anything?"
       has to be answerable after the browser tab is closed. */
    this.ingestRuns = new Map();
    this.raw = [];
    this.blocking = new Map(); // key -> Set(jobId)
    this.index = new InvertedIndex();
  }

  indexBlocking(job) {
    for (const key of blockingKeys(job)) {
      let set = this.blocking.get(key);
      if (!set) { set = new Set(); this.blocking.set(key, set); }
      set.add(job.id);
    }
  }

  deindex(job) {
    for (const key of blockingKeys(job)) {
      const set = this.blocking.get(key);
      if (set) { set.delete(job.id); if (!set.size) this.blocking.delete(key); }
    }
  }

  async putJob(job) {
    const prev = this.jobs.get(job.id);
    if (prev) this.deindex(prev);
    this.jobs.set(job.id, job);
    this.indexBlocking(job);
    this.index.add(job);
    this.bumpGeneration();
    return job;
  }

  /** Bulk load used by large fixtures — same semantics, far less churn. */
  async putJobs(jobs = []) {
    for (const job of jobs) await this.putJob(job);
    return jobs.length;
  }

  async getJob(id) { return this.jobs.get(id) || null; }

  async deleteJob(id) {
    const j = this.jobs.get(id);
    if (j) { this.deindex(j); this.jobs.delete(id); this.index.remove(id); this.bumpGeneration(); }
    return !!j;
  }

  /**
   * Dedupe candidates for one job.
   *
   * Bounded per key. Blocking keys are supposed to be selective, but some are
   * broad by nature — a company key on an employer with thousands of openings
   * matches thousands of rows, and an unbounded fan-out there turns every
   * ingest into an O(N) scan. The cap is applied PER KEY, not to the total, so
   * the precise keys (fingerprint, provider job id, apply url) always
   * contribute their matches even when a broad key is saturated.
   */
  async findCandidates(job, { perKeyLimit = 200, totalLimit = 600 } = {}) {
    const ids = new Set();
    /* Precise keys first, so a saturating broad key can never crowd out the
       exact match that would have deduped this job. */
    const keys = blockingKeys(job);
    const ordered = [
      ...keys.filter((k) => /^(fp|pid|ap|req):/.test(k)),
      ...keys.filter((k) => !/^(fp|pid|ap|req):/.test(k)),
    ];
    for (const key of ordered) {
      const postings = this.blocking.get(key);
      if (!postings) continue;
      let taken = 0;
      for (const id of postings) {
        if (id === job.id) continue;
        ids.add(id);
        taken += 1;
        if (taken >= perKeyLimit || ids.size >= totalLimit) break;
      }
      if (ids.size >= totalLimit) break;
    }
    return [...ids].map((id) => this.jobs.get(id)).filter(Boolean);
  }

  async listJobs(filter = {}) {
    const out = [];
    for (const job of this.jobs.values()) {
      if (matchesJobFilter(job, filter)) out.push(job);
      if (filter.limit && out.length >= filter.limit) break;
    }
    return out;
  }

  /**
   * Indexed candidate retrieval. The compatibility checks that need evidence
   * (location scope, salary) still run afterwards, but only over candidates the
   * index actually matched — never over the whole collection.
   */
  async searchCandidates(criteria = {}) {
    const statuses = criteria.status || [JOB_STATUS.NEW, JOB_STATUS.ACTIVE, JOB_STATUS.LIKELY_ACTIVE];
    const cap = Math.max(50, Math.min(5000, Number(criteria.candidateLimit) || 750));

    const { docs, matchedTotal, truncated, strategy } = this.index.retrieve({
      familyKeys: criteria.familyWeights || criteria.familyKeys || null,
      queryTerms: criteria.queryTerms || [],
      statuses,
      filters: retrievalFiltersOf(criteria),
      cap,
    });

    let out = docs;
    if (criteria.location) out = out.filter((j) => locationCompatibility(j, criteria.location).compatible);
    if (criteria.salaryMin != null || criteria.salaryMax != null) out = out.filter((j) => salaryCompatibility(j, criteria).compatible);

    return criteria.withRetrievalMeta ? { docs: out, matchedTotal, truncated, strategy } : out;
  }

  async listVerificationCandidates({ before = null, limit = 25 } = {}) {
    const cutoff = before ? Date.parse(before) : Date.now();
    const out = [...this.jobs.values()].filter((j) => j.status !== JOB_STATUS.REMOVED && (
      j.needsVerification
      || (j.nextVerifyAt ? Date.parse(j.nextVerifyAt) <= cutoff : (!j.lastVerifiedAt || Date.parse(j.lastVerifiedAt) <= cutoff))
    ));
    out.sort((a, b) => Number(!!b.needsVerification) - Number(!!a.needsVerification)
      || String(a.nextVerifyAt || a.lastVerifiedAt || '').localeCompare(String(b.nextVerifyAt || b.lastVerifiedAt || '')));
    return out.slice(0, limit);
  }

  async listDiscoveryCandidates({ at = null, limit = 25 } = {}) {
    const now = at || new Date().toISOString();
    const out = [...this.jobs.values()].filter((j) => {
      if (j.status === JOB_STATUS.REMOVED) return false;
      const hasDirect = (j.sourceInstances || []).some((x) => x.sourceClass === 'ORIGINAL_ATS' || x.sourceClass === 'ORIGINAL_CAREER_SITE');
      if (hasDirect) return false;
      return !j.sourceDiscovery?.nextAttemptAt || j.sourceDiscovery.nextAttemptAt <= now;
    });
    out.sort((a, b) => String(a.sourceDiscovery?.nextAttemptAt || '').localeCompare(String(b.sourceDiscovery?.nextAttemptAt || ''))
      || String(a.firstSeenAt || '').localeCompare(String(b.firstSeenAt || '')));
    return out.slice(0, limit);
  }

  /* ------------------------------ sources ------------------------------ */

  async putSource(source) { this.sources.set(source.id, source); return source; }
  async getSource(id) { return this.sources.get(id) || null; }

  async listSources(filter = {}) {
    let out = [...this.sources.values()];
    if (filter.provider) out = out.filter((s) => s.provider === filter.provider);
    if (filter.status) {
      const wanted = Array.isArray(filter.status) ? filter.status : [filter.status];
      out = out.filter((s) => wanted.includes(s.status));
    }
    if (filter.sourceClass) out = out.filter((s) => s.sourceClass === filter.sourceClass);
    if (filter.companyId) out = out.filter((s) => s.companyId === filter.companyId);
    return filter.limit ? out.slice(0, filter.limit) : out;
  }

  async listDueSources({ at = null, limit = 20 } = {}) {
    const now = at || new Date().toISOString();
    const out = [...this.sources.values()].filter((src) => !['DISABLED', 'NOT_CONFIGURED'].includes(src.status)
      && src.accessPolicy === 'ALLOW'
      && (!src.nextCrawlAt || src.nextCrawlAt <= now));
    out.sort((a, b) => (b.crawlPriority || 0) - (a.crawlPriority || 0) || String(a.nextCrawlAt || '').localeCompare(String(b.nextCrawlAt || '')));
    return out.slice(0, limit);
  }

  /* ------------------------------ companies ------------------------------ */

  async putIngestRun(run) { this.ingestRuns.set(run.id, run); return run; }
  async getIngestRun(id) { return this.ingestRuns.get(id) || null; }

  async listIngestRuns({ limit = 50, triggeredBy = null } = {}) {
    let out = [...this.ingestRuns.values()];
    if (triggeredBy) out = out.filter((r) => r.triggeredBy === triggeredBy);
    out.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
    return out.slice(0, limit);
  }

  async putCompany(company) { this.companies.set(company.id, company); return company; }
  async getCompany(id) { return this.companies.get(id) || null; }

  async listCompanies(filter = {}) {
    let out = [...this.companies.values()];
    if (filter.domain) out = out.filter((c) => c.domain === filter.domain);
    if (filter.normalizedName) out = out.filter((c) => c.normalizedName === filter.normalizedName);
    if (filter.hasSource === true) out = out.filter((c) => (c.sourceIds || []).length > 0);
    if (filter.hasSource === false) out = out.filter((c) => !(c.sourceIds || []).length);
    if (filter.provider) out = out.filter((c) => c.atsProvider === filter.provider);
    if (filter.seedSource) out = out.filter((c) => c.seedSource === filter.seedSource);
    return filter.limit ? out.slice(0, filter.limit) : out;
  }

  async listCompanyDiscoveryCandidates({ limit = 50 } = {}) {
    return [...this.companies.values()]
      .filter((c) => c.careersUrl && !(c.sourceIds || []).length && Number(c.discoveryAttempts || 0) < 5)
      .sort((a, b) => (Number(a.discoveryQueueCount || 0) - Number(b.discoveryQueueCount || 0))
        || String(a.lastDiscoveryAt || '').localeCompare(String(b.lastDiscoveryAt || ''))
        || (Number(a.seedRank || Number.MAX_SAFE_INTEGER) - Number(b.seedRank || Number.MAX_SAFE_INTEGER))
        || String(a.name || '').localeCompare(String(b.name || '')))
      .slice(0, Math.max(1, Number(limit) || 50));
  }

  async pageJobs({ page = 1, pageSize = 20, q = '', sourceId = null, companyDomain = null, provider = null, status = null, since = null } = {}) {
    const needle = String(q || '').trim().toLowerCase();
    let out = [...this.jobs.values()].filter((j) => {
      if (sourceId && !(j.sourceInstances || []).some((s) => s.sourceId === sourceId)) return false;
      if (companyDomain && j.company?.domain !== companyDomain) return false;
      if (provider && !(j.sourceInstances || []).some((s) => s.provider === provider)) return false;
      if (status && j.status !== status) return false;
      if (since && String(j.firstSeenAt || '') < since) return false;
      if (needle) {
        const hay = [j.title, j.company?.name, j.company?.domain, j.searchText].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    out.sort((a, b) => String(b.firstSeenAt || '').localeCompare(String(a.firstSeenAt || '')));
    const p = Math.max(1, Number(page) || 1);
    const size = Math.max(1, Number(pageSize) || 20);
    const offset = (p - 1) * size;
    return { docs: out.slice(offset, offset + size), total: out.length, page: p, pageSize: size };
  }

  async pageCompanies({ page = 1, pageSize = 20, q = '', hasSource = null, provider = null, seedSource = null } = {}) {
    const needle = String(q || '').trim().toLowerCase();
    let out = [...this.companies.values()].filter((c) => {
      if (hasSource === true && !(c.sourceIds || []).length) return false;
      if (hasSource === false && (c.sourceIds || []).length) return false;
      if (provider && c.atsProvider !== provider) return false;
      if (seedSource && c.seedSource !== seedSource) return false;
      if (needle) {
        const hay = [c.name, c.normalizedName, c.domain, c.careersUrl, c.industry, c.region, ...(c.hiringCountries || [])]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    out.sort((a, b) => (Number(a.seedRank || Number.MAX_SAFE_INTEGER) - Number(b.seedRank || Number.MAX_SAFE_INTEGER))
      || (Number(b.jobCount || 0) - Number(a.jobCount || 0))
      || String(a.name || '').localeCompare(String(b.name || '')));
    const p = Math.max(1, Number(page) || 1);
    const size = Math.max(1, Number(pageSize) || 20);
    const offset = (p - 1) * size;
    return { docs: out.slice(offset, offset + size), total: out.length, page: p, pageSize: size };
  }

  /* --------------------------- discovery queue --------------------------- */

  async putDiscoveryTask(task) { this.discoveryTasks.set(task.id, task); return task; }
  async getDiscoveryTask(id) { return this.discoveryTasks.get(id) || null; }

  async listDiscoveryTasks(filter = {}) {
    let out = [...this.discoveryTasks.values()];
    if (filter.state) {
      const wanted = Array.isArray(filter.state) ? filter.state : [filter.state];
      out = out.filter((t) => wanted.includes(t.state));
    }
    if (filter.kind) out = out.filter((t) => t.kind === filter.kind);
    return filter.limit ? out.slice(0, filter.limit) : out;
  }

  /**
   * Lease due tasks. In-process this is trivially atomic; the Mongo backend uses
   * findOneAndUpdate so two workers can never take the same task.
   */
  async leaseDiscoveryTasks({ at = null, limit = 10, owner = 'local', leaseMs = 120000 } = {}) {
    const nowIso = at || new Date().toISOString();
    const expiry = new Date(Date.parse(nowIso) + leaseMs).toISOString();
    const due = [...this.discoveryTasks.values()]
      .filter((t) => ['PENDING', 'RETRY'].includes(t.state) || (t.state === 'LEASED' && (t.leaseExpiresAt || '') <= nowIso))
      .filter((t) => !t.nextAttemptAt || t.nextAttemptAt <= nowIso)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(a.nextAttemptAt || '').localeCompare(String(b.nextAttemptAt || '')))
      .slice(0, limit);
    const leased = [];
    for (const t of due) {
      const next = { ...t, state: 'LEASED', leaseOwner: owner, leaseExpiresAt: expiry, leasedAt: nowIso };
      this.discoveryTasks.set(t.id, next);
      leased.push(next);
    }
    return leased;
  }

  /* ----------------------------- crawl queue ----------------------------- */

  async putCrawlTask(task) { this.crawlTasks.set(task.id, task); return task; }
  async getCrawlTask(id) { return this.crawlTasks.get(id) || null; }

  async listCrawlTasks(filter = {}) {
    let out = [...this.crawlTasks.values()];
    if (filter.state) {
      const wanted = Array.isArray(filter.state) ? filter.state : [filter.state];
      out = out.filter((t) => wanted.includes(t.state));
    }
    if (filter.sourceId) out = out.filter((t) => t.sourceId === filter.sourceId);
    return filter.limit ? out.slice(0, filter.limit) : out;
  }

  async leaseCrawlTasks({ at = null, limit = 5, owner = 'local', leaseMs = 300000 } = {}) {
    const nowIso = at || new Date().toISOString();
    const expiry = new Date(Date.parse(nowIso) + leaseMs).toISOString();
    const due = [...this.crawlTasks.values()]
      .filter((t) => ['PENDING', 'RETRY'].includes(t.state) || (t.state === 'LEASED' && (t.leaseExpiresAt || '') <= nowIso))
      .filter((t) => !t.availableAt || t.availableAt <= nowIso)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(a.availableAt || '').localeCompare(String(b.availableAt || '')))
      .slice(0, limit);
    const leased = [];
    for (const t of due) {
      const next = { ...t, state: 'LEASED', leaseOwner: owner, leaseExpiresAt: expiry, leasedAt: nowIso, attempts: (t.attempts || 0) + 1 };
      this.crawlTasks.set(t.id, next);
      leased.push(next);
    }
    return leased;
  }

  /* -------------------------------- raw -------------------------------- */

  async putRaw(snapshot) { this.raw.push(snapshot); return snapshot; }

  async pruneRaw({ maxAgeDays = 30, maxCount = 20000 } = {}) {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    const before = this.raw.length;
    this.raw = this.raw.filter((r) => (r.fetchedAt || '') >= cutoff);
    if (this.raw.length > maxCount) this.raw = this.raw.slice(-maxCount);
    return before - this.raw.length;
  }

  async listRaw(filter = {}) {
    let out = this.raw;
    if (filter.sourceId) out = out.filter((r) => r.sourceId === filter.sourceId);
    return filter.limit ? out.slice(-filter.limit) : out;
  }

  async stats() {
    const byStatus = {};
    for (const j of this.jobs.values()) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
    return {
      backend: 'memory',
      jobs: this.jobs.size,
      sources: this.sources.size,
      companies: this.companies.size,
      discoveryTasks: this.discoveryTasks.size,
      crawlTasks: this.crawlTasks.size,
      raw: this.raw.length,
      byStatus,
      index: this.index.stats(),
    };
  }
}

/* ------------------------------------------------------------------
   File — MemoryStore semantics with durable JSON snapshots.
   ------------------------------------------------------------------ */

export class FileJobStore extends MemoryJobStore {
  constructor({ dir = '.data/job-discovery', flushMs = 2000 } = {}) {
    super();
    this.dir = dir;
    this.flushMs = flushMs;
    this.dirty = false;
    this.timer = null;
  }

  paths() {
    return {
      jobs: path.join(this.dir, 'jobs.json'),
      sources: path.join(this.dir, 'sources.json'),
      raw: path.join(this.dir, 'raw.json'),
      companies: path.join(this.dir, 'companies.json'),
      discovery: path.join(this.dir, 'discovery-queue.json'),
      crawl: path.join(this.dir, 'crawl-queue.json'),
      ingestRuns: path.join(this.dir, 'ingest-runs.json'),
    };
  }

  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    const p = this.paths();
    const read = (file, fallback) => {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
    };
    for (const job of read(p.jobs, [])) { this.jobs.set(job.id, job); this.indexBlocking(job); this.index.add(job); }
    for (const s of read(p.sources, [])) this.sources.set(s.id, s);
    for (const c of read(p.companies, [])) this.companies.set(c.id, c);
    for (const t of read(p.discovery, [])) this.discoveryTasks.set(t.id, t);
    for (const t of read(p.crawl, [])) this.crawlTasks.set(t.id, t);
    for (const r of read(p.ingestRuns, [])) this.ingestRuns.set(r.id, r);
    this.raw = read(p.raw, []);
    return this;
  }

  scheduleFlush() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush().catch(() => {}); }, this.flushMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  async flush() {
    if (!this.dirty) return false;
    fs.mkdirSync(this.dir, { recursive: true });
    const p = this.paths();
    const write = (file, data) => {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    };
    write(p.jobs, [...this.jobs.values()]);
    write(p.sources, [...this.sources.values()]);
    write(p.raw, this.raw);
    write(p.companies, [...this.companies.values()]);
    write(p.discovery, [...this.discoveryTasks.values()]);
    write(p.crawl, [...this.crawlTasks.values()]);
    write(p.ingestRuns, [...this.ingestRuns.values()]);
    this.dirty = false;
    return true;
  }

  async putJob(job) { const r = await super.putJob(job); this.scheduleFlush(); return r; }
  async deleteJob(id) { const r = await super.deleteJob(id); this.scheduleFlush(); return r; }
  async putSource(s) { const r = await super.putSource(s); this.scheduleFlush(); return r; }
  async putRaw(s) { const r = await super.putRaw(s); this.scheduleFlush(); return r; }
  async putCompany(c) { const r = await super.putCompany(c); this.scheduleFlush(); return r; }
  async putDiscoveryTask(t) { const r = await super.putDiscoveryTask(t); this.scheduleFlush(); return r; }
  async putCrawlTask(t) { const r = await super.putCrawlTask(t); this.scheduleFlush(); return r; }
  async putIngestRun(x) { const r = await super.putIngestRun(x); this.scheduleFlush(); return r; }
  async pruneRaw(o) { const r = await super.pruneRaw(o); this.scheduleFlush(); return r; }
  async stats() { return { ...(await super.stats()), backend: 'file', dir: this.dir }; }
}

/* ------------------------------------------------------------------
   Mongo — reuses the app's existing Atlas connection.
   ------------------------------------------------------------------ */

let mongooseModels = null;

async function buildModels(mongoose) {
  if (mongooseModels) return mongooseModels;
  const { Schema } = mongoose;
  const Mixed = Schema.Types.Mixed;

  const jobSchema = new Schema({
    _id: { type: String },
    schemaVersion: Number,
    normalizerVersion: Number,
    company: { type: Mixed, default: {} },
    companyId: { type: String, default: null },
    title: String,
    normalizedTitle: String,
    titleFamily: { type: String, default: null },
    titleFamilies: { type: [String], default: [] },
    description: { type: Mixed, default: {} },
    employmentType: String,
    department: { type: String, default: null },
    seniority: String,
    locations: { type: [Mixed], default: [] },
    workplace: { type: Mixed, default: {} },
    compensation: { type: Mixed, default: {} },
    sourcePublishedAt: { type: Date, default: null },
    validThrough: { type: Date, default: null },
    firstSeenAt: Date,
    lastSeenAt: Date,
    lastVerifiedAt: { type: Date, default: null },
    lastChangedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    nextVerifyAt: { type: Date, default: null },
    verificationTier: { type: String, default: null },
    status: { type: String, default: JOB_STATUS.NEW },
    needsVerification: { type: Boolean, default: false },
    changeLog: { type: [Mixed], default: [] },
    sourceDiscovery: {
      attempts: { type: Number, default: 0 },
      lastAttemptAt: { type: Date, default: null },
      nextAttemptAt: { type: Date, default: null },
      state: { type: String, default: null },
      lastReason: { type: String, default: null },
      sourceId: { type: String, default: null },
    },
    canonicalApplyUrl: { type: String, default: null },
    canonicalJobUrl: { type: String, default: null },
    sourceInstances: { type: [Mixed], default: [] },
    contentHash: { type: String, default: null },
    previousContentHash: { type: String, default: null },
    dedupeFingerprint: { type: String, default: null },
    shingleSignature: { type: [Number], default: [] },
    provenance: { type: Mixed, default: {} },
    conflicts: { type: Mixed, default: {} },
    sourceConfidence: Number,
    completeness: Number,
    completenessFlags: { type: Mixed, default: {} },
    tags: { type: [String], default: [] },
    blockingKeys: { type: [String], default: [], index: true },
    searchText: { type: String, default: '' },
    directApply: { type: Boolean, default: false },
  }, { _id: false, timestamps: true, collection: 'jobdiscovery_jobs' });

  jobSchema.index({ 'company.domain': 1 });
  jobSchema.index({ 'company.normalizedName': 1 });
  jobSchema.index({ companyId: 1 });
  jobSchema.index({ normalizedTitle: 1 });
  jobSchema.index({ titleFamilies: 1, status: 1, sourcePublishedAt: -1 });
  jobSchema.index({ status: 1, lastSeenAt: -1 });
  jobSchema.index({ firstSeenAt: -1 });
  jobSchema.index({ sourcePublishedAt: -1 });
  jobSchema.index({ status: 1, nextVerifyAt: 1, needsVerification: 1 });
  jobSchema.index({ status: 1, lastVerifiedAt: 1, needsVerification: 1 });
  jobSchema.index({ 'sourceDiscovery.nextAttemptAt': 1, status: 1 });
  jobSchema.index({ 'workplace.type': 1, 'workplace.remoteScope': 1 });
  jobSchema.index({ 'locations.countryCode': 1, 'locations.city': 1 });
  jobSchema.index({ contentHash: 1 });
  jobSchema.index({ dedupeFingerprint: 1 });
  jobSchema.index({ directApply: 1, status: 1 });
  jobSchema.index({ 'sourceInstances.provider': 1, 'sourceInstances.sourceJobId': 1 });
  jobSchema.index({ 'sourceInstances.sourceClass': 1, status: 1 });
  jobSchema.index({ searchText: 'text', title: 'text' }, { weights: { title: 10, searchText: 3 }, name: 'job_text' });

  const sourceSchema = new Schema({
    _id: { type: String },
    companyId: { type: String, default: null },
    companyName: { type: String, default: null },
    companyDomain: { type: String, default: null },
    companyWebsite: { type: String, default: null },
    provider: { type: String, index: true },
    sourceType: { type: String, index: true },
    sourceClass: { type: String, index: true },
    tenant: { type: String, default: null },
    region: { type: String, default: null },
    baseUrl: { type: String, default: null },
    careersUrl: { type: String, default: null },
    status: { type: String, default: 'ACTIVE', index: true },
    accessPolicy: { type: String, default: 'REVIEW' },
    crawlStrategy: { type: String, default: 'API' },
    crawlIntervalMinutes: { type: Number, default: 360 },
    crawlPriority: { type: Number, default: 0, index: true },
    nextCrawlAt: { type: Date, default: null, index: true },
    lastAttemptAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    lastErrorAt: { type: Date, default: null },
    lastErrorClass: { type: String, default: null },
    lastErrorMessage: { type: String, default: null },
    consecutiveFailures: { type: Number, default: 0 },
    jobsLastSeen: { type: Number, default: 0 },
    robotsPolicy: { type: Mixed, default: {} },
    storagePolicy: { type: Mixed, default: {} },
    http: { type: Mixed, default: {} },
    health: { type: Mixed, default: {} },
    anomaly: { type: Mixed, default: null },
    cursor: { type: Mixed, default: null },
    queries: { type: Mixed, default: null },
    location: { type: Mixed, default: null },
    discoveredFrom: { type: String, default: null },
  }, { _id: false, timestamps: true, collection: 'jobdiscovery_sources' });
  sourceSchema.index({ provider: 1, tenant: 1 }, { unique: true, sparse: true });
  sourceSchema.index({ accessPolicy: 1, status: 1, nextCrawlAt: 1, crawlPriority: -1 });

  const companySchema = new Schema({
    _id: { type: String },
    name: { type: String, default: null },
    normalizedName: { type: String, index: true },
    domain: { type: String, default: null, index: true },
    website: { type: String, default: null },
    careersUrl: { type: String, default: null },
    atsProvider: { type: String, default: null, index: true },
    atsTenant: { type: String, default: null },
    country: { type: String, default: null },
    region: { type: String, default: null },
    industry: { type: String, default: null },
    hiringCountries: { type: [String], default: [] },
    indiaRelevance: { type: String, default: null },
    careerUrlStatus: { type: String, default: null, index: true },
    seedSource: { type: String, default: null, index: true },
    seedRank: { type: Number, default: null, index: true },
    sourceIds: { type: [String], default: [] },
    sourceConfidence: { type: Number, default: 0 },
    lastDiscoveryAt: { type: Date, default: null },
    lastDiscoveryOutcome: { type: String, default: null },
    discoveryAttempts: { type: Number, default: 0 },
    discoveryQueueCount: { type: Number, default: 0 },
    sourceHealth: { type: String, default: null },
    jobCount: { type: Number, default: 0 },
    provenance: { type: Mixed, default: {} },
  }, { _id: false, timestamps: true, collection: 'jobdiscovery_companies' });
  companySchema.index(
    { name: 'text', normalizedName: 'text', domain: 'text', careersUrl: 'text', industry: 'text', region: 'text' },
    { name: 'jobdiscovery_company_text', weights: { name: 10, normalizedName: 8, domain: 8, careersUrl: 4, industry: 2, region: 1 } },
  );
  companySchema.index({ seedSource: 1, seedRank: 1 });
  companySchema.index({ atsProvider: 1, seedRank: 1 });
  companySchema.index({ discoveryQueueCount: 1, seedRank: 1, discoveryAttempts: 1 });

  const discoverySchema = new Schema({
    _id: { type: String },
    kind: { type: String, index: true },
    key: { type: String, index: true },
    payload: { type: Mixed, default: {} },
    state: { type: String, default: 'PENDING', index: true },
    attempts: { type: Number, default: 0 },
    priority: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: null, index: true },
    lastAttemptAt: { type: Date, default: null },
    lastReason: { type: String, default: null },
    failureReason: { type: String, default: null },
    confidence: { type: Number, default: 0 },
    discoveredFrom: { type: String, default: null },
    resolvedSourceId: { type: String, default: null },
    companyId: { type: String, default: null },
    leaseOwner: { type: String, default: null },
    leaseExpiresAt: { type: Date, default: null },
  }, { _id: false, timestamps: true, collection: 'jobdiscovery_discovery_queue' });
  discoverySchema.index({ state: 1, nextAttemptAt: 1, priority: -1 });

  const crawlSchema = new Schema({
    _id: { type: String },
    sourceId: { type: String, index: true },
    idempotencyKey: { type: String, index: true },
    state: { type: String, default: 'PENDING', index: true },
    priority: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    availableAt: { type: Date, default: null, index: true },
    leaseOwner: { type: String, default: null },
    leaseExpiresAt: { type: Date, default: null },
    checkpoint: { type: Mixed, default: null },
    lastError: { type: Mixed, default: null },
    deadLetteredAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  }, { _id: false, timestamps: true, collection: 'jobdiscovery_crawl_queue' });
  crawlSchema.index({ state: 1, availableAt: 1, priority: -1 });

  const rawSchema = new Schema({
    schemaVersion: { type: Number, default: RAW_SNAPSHOT_SCHEMA_VERSION },
    sourceId: { type: String, index: true },
    sourceJobId: { type: String, default: null },
    fetchedAt: { type: Date },
    http: { type: Mixed, default: {} },
    contentHash: { type: String, index: true },
    normalizerVersion: Number,
    payload: { type: Mixed, default: null },
  }, { collection: 'jobdiscovery_raw' });
  rawSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 30 * 86400 });

  const ingestRunSchema = new Schema({
    _id: { type: String },
    mode: { type: String, default: 'INLINE' },
    triggeredBy: { type: String, default: null, index: true },
    reason: { type: String, default: null },
    dryRun: { type: Boolean, default: false },
    startedAt: { type: Date },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
    targets: { type: [Mixed], default: [] },
    totals: { type: Mixed, default: {} },
    ok: { type: Boolean, default: false },
  }, { _id: false, timestamps: true, collection: 'jobdiscovery_ingest_runs' });
  ingestRunSchema.index({ startedAt: -1 });

  mongooseModels = {
    IngestRun: mongoose.models.JobDiscoveryIngestRun || mongoose.model('JobDiscoveryIngestRun', ingestRunSchema),
    Job: mongoose.models.JobDiscoveryJob || mongoose.model('JobDiscoveryJob', jobSchema),
    Source: mongoose.models.JobDiscoverySource || mongoose.model('JobDiscoverySource', sourceSchema),
    Raw: mongoose.models.JobDiscoveryRaw || mongoose.model('JobDiscoveryRaw', rawSchema),
    Company: mongoose.models.JobDiscoveryCompany || mongoose.model('JobDiscoveryCompany', companySchema),
    Discovery: mongoose.models.JobDiscoveryDiscoveryTask || mongoose.model('JobDiscoveryDiscoveryTask', discoverySchema),
    Crawl: mongoose.models.JobDiscoveryCrawlTask || mongoose.model('JobDiscoveryCrawlTask', crawlSchema),
  };
  return mongooseModels;
}

export function searchTextOf(job) {
  return [
    job.title, job.company?.name, job.department,
    (job.locations || []).map((l) => l.raw).join(' '),
    (job.tags || []).join(' '),
    String(job.description?.text || '').slice(0, 4000),
  ].filter(Boolean).join('\n');
}

export class MongoJobStore extends BaseJobStore {
  constructor({ mongoose, connect, atlasSearchIndex = process.env.JOB_DISCOVERY_ATLAS_SEARCH_INDEX || null }) {
    super();
    this.mongoose = mongoose;
    this.connect = connect;
    this.models = null;
    /* Atlas Search is PREFERRED when the deployment provides an index name.
       Without one we do not pretend to have it — retrieval uses the indexed
       $text + titleFamilies path, which is the strongest thing plain Mongo
       offers, and stats() reports which path is actually live. */
    this.atlasSearchIndex = atlasSearchIndex || null;
    this.atlasSearchAvailable = null;
    this.lastAtlasError = null;
  }

  async init() {
    if (this.connect) await this.connect();
    this.models = await buildModels(this.mongoose);
    return this;
  }

  toDoc(job) {
    return {
      ...job,
      _id: job.id,
      blockingKeys: blockingKeys(job),
      searchText: searchTextOf(job),
      directApply: !!(job.canonicalApplyUrl && (job.sourceInstances || []).some(
        (s) => s.applyUrl === job.canonicalApplyUrl
          && (s.sourceClass === 'ORIGINAL_ATS' || s.sourceClass === 'ORIGINAL_CAREER_SITE'),
      )),
    };
  }

  fromDoc(doc) {
    if (!doc) return null;
    const o = doc.toObject ? doc.toObject() : doc;
    const {
      _id, blockingKeys: _bk, searchText: _st, __v, createdAt, updatedAt, score, ...rest
    } = o;
    const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
    return {
      ...rest,
      id: _id,
      sourceDiscovery: rest.sourceDiscovery ? {
        ...rest.sourceDiscovery,
        lastAttemptAt: iso(rest.sourceDiscovery.lastAttemptAt),
        nextAttemptAt: iso(rest.sourceDiscovery.nextAttemptAt),
      } : {},
      sourcePublishedAt: iso(rest.sourcePublishedAt),
      validThrough: iso(rest.validThrough),
      firstSeenAt: iso(rest.firstSeenAt),
      lastSeenAt: iso(rest.lastSeenAt),
      lastVerifiedAt: iso(rest.lastVerifiedAt),
      lastChangedAt: iso(rest.lastChangedAt),
      closedAt: iso(rest.closedAt),
      nextVerifyAt: iso(rest.nextVerifyAt),
    };
  }

  async putJob(job) {
    const { _id, ...doc } = this.toDoc(job);
    await this.models.Job.updateOne({ _id: job.id }, { $set: doc }, { upsert: true });
    this.bumpGeneration();
    return job;
  }

  async getJob(id) { return this.fromDoc(await this.models.Job.findById(id).lean()); }

  async deleteJob(id) {
    const r = await this.models.Job.deleteOne({ _id: id });
    if (r.deletedCount > 0) this.bumpGeneration();
    return r.deletedCount > 0;
  }

  async findCandidates(job) {
    const keys = blockingKeys(job);
    if (!keys.length) return [];
    const docs = await this.models.Job.find({ blockingKeys: { $in: keys }, _id: { $ne: job.id } }).limit(50).lean();
    return docs.map((d) => this.fromDoc(d));
  }

  async listJobs(filter = {}) {
    const q = {};
    if (filter.status) q.status = Array.isArray(filter.status) ? { $in: filter.status } : filter.status;
    if (filter.excludeStatus) q.status = { $nin: Array.isArray(filter.excludeStatus) ? filter.excludeStatus : [filter.excludeStatus] };
    if (filter.sourceId) q['sourceInstances.sourceId'] = filter.sourceId;
    if (filter.provider) q['sourceInstances.provider'] = filter.provider;
    if (filter.companyDomain) q['company.domain'] = filter.companyDomain;
    if (filter.needsVerification) q.needsVerification = true;
    if (filter.since) q.lastSeenAt = { $gte: new Date(filter.since) };
    let query = this.models.Job.find(q);
    if (filter.sort) query = query.sort(filter.sort);
    const docs = await query.limit(filter.limit || 500).lean();
    return docs.map((d) => this.fromDoc(d));
  }

  baseQuery(criteria) {
    const statuses = criteria.status || [JOB_STATUS.NEW, JOB_STATUS.ACTIVE, JOB_STATUS.LIKELY_ACTIVE];
    const base = { status: { $in: statuses } };
    if (criteria.employmentType) base.employmentType = { $in: [criteria.employmentType, 'UNKNOWN', null] };
    if (Array.isArray(criteria.seniority) && criteria.seniority.length) base.seniority = { $in: [...criteria.seniority, 'UNKNOWN', null] };
    if (criteria.companyNormalized) base['company.normalizedName'] = criteria.companyNormalized;
    if (criteria.directApply) base.directApply = true;

    const andClauses = [];
    if (criteria.sourceType) {
      andClauses.push({
        $or: [
          { 'sourceInstances.sourceClass': criteria.sourceType },
          { 'sourceInstances.sourceType': criteria.sourceType },
        ],
      });
    }
    if (criteria.remote === 'remote') base['workplace.type'] = WORKPLACE_TYPE.REMOTE;
    if (criteria.remote === 'hybrid') base['workplace.type'] = WORKPLACE_TYPE.HYBRID;
    if (criteria.remote === 'onsite') base['workplace.type'] = WORKPLACE_TYPE.ONSITE;

    if (criteria.location) {
      const qLoc = parseLocation(criteria.location);
      const qCountry = detectCountry(criteria.location);
      const qRegion = detectRegion(criteria.location);
      const locationOr = [];
      if (qLoc?.city) locationOr.push({ 'locations.city': qLoc.city });
      if (qCountry?.code || qLoc?.countryCode) locationOr.push({ 'locations.countryCode': qCountry?.code || qLoc.countryCode });
      if (qCountry?.code) locationOr.push({ 'workplace.remoteRegions': qCountry.code });
      if (qRegion?.code) locationOr.push({ 'workplace.remoteRegions': qRegion.code });
      /* Worldwide and explicitly-unspecified remote scope remain candidates;
         the final evidence-based locationCompatibility() decides the score. */
      locationOr.push({
        'workplace.type': WORKPLACE_TYPE.REMOTE,
        'workplace.remoteScope': { $in: [REMOTE_SCOPE.REMOTE_WORLDWIDE, REMOTE_SCOPE.UNKNOWN] },
      });
      if (locationOr.length) andClauses.push({ $or: locationOr });
    }
    if (andClauses.length) base.$and = andClauses;
    return base;
  }

  /**
   * Indexed candidate retrieval. Atlas Search when the deployment provides an
   * index; otherwise compound $text + titleFamilies queries. Either way the
   * result is a BOUNDED candidate set that the deterministic Career Autopilot
   * reranker then orders — Node never ranks the whole collection.
   */
  async searchCandidates(criteria = {}) {
    const cap = Math.max(50, Math.min(2000, Number(criteria.candidateLimit) || 750));
    const base = this.baseQuery(criteria);
    const families = (criteria.familyKeys || []).filter(Boolean);
    const text = String(criteria.q || '').trim();

    if (this.atlasSearchIndex) {
      try {
        const out = await this.atlasSearchCandidates({ base, families, text, cap });
        this.atlasSearchAvailable = true;
        return criteria.withRetrievalMeta ? out : out.docs;
      } catch (e) {
        /* A missing or renamed Atlas index must not take search down — fall
           back and RECORD it, never silently claim Atlas Search ran. */
        this.atlasSearchAvailable = false;
        this.lastAtlasError = e?.message || String(e);
      }
    }

    const docsById = new Map();
    const add = (docs) => { for (const d of docs) docsById.set(String(d._id), d); };
    let matchedTotal = 0;

    if (families.length) {
      const q = { ...base, titleFamilies: { $in: families } };
      matchedTotal += await this.models.Job.countDocuments(q);
      add(await this.models.Job.find(q).sort({ sourcePublishedAt: -1, firstSeenAt: -1 }).limit(Math.ceil(cap * 0.7)).lean());
    }
    if (text) {
      const q = { ...base, $text: { $search: text } };
      add(await this.models.Job.find(q, { score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' } }).limit(cap).lean());
    }
    if (!text && !families.length) {
      matchedTotal += await this.models.Job.countDocuments(base);
      add(await this.models.Job.find(base).sort({ sourcePublishedAt: -1, firstSeenAt: -1 }).limit(cap).lean());
    }

    const docs = [...docsById.values()].slice(0, cap).map((d) => this.fromDoc(d));
    const out = {
      docs,
      matchedTotal: Math.max(matchedTotal, docs.length),
      truncated: docs.length >= cap,
      strategy: this.atlasSearchAvailable === false ? 'mongo-text (atlas index unavailable)' : 'mongo-text',
    };
    return criteria.withRetrievalMeta ? out : docs;
  }

  /** $search + $searchMeta so truncation is reported against a real total. */
  async atlasSearchCandidates({ base, families, text, cap }) {
    const should = [];
    if (text) {
      should.push({ text: { query: text, path: 'title', score: { boost: { value: 8 } } } });
      should.push({ text: { query: text, path: 'searchText' } });
      should.push({ text: { query: text, path: 'company.name', score: { boost: { value: 3 } } } });
    }
    if (families.length) {
      should.push({ text: { query: families, path: 'titleFamilies', score: { boost: { value: 5 } } } });
    }
    if (!should.length) should.push({ exists: { path: 'title' } });

    const compound = { should, minimumShouldMatch: 1 };
    const docs = await this.models.Job.aggregate([
      { $search: { index: this.atlasSearchIndex, compound } },
      { $match: base },
      { $limit: cap },
      { $addFields: { score: { $meta: 'searchScore' } } },
    ]);

    let matchedTotal = docs.length;
    try {
      const meta = await this.models.Job.aggregate([
        { $searchMeta: { index: this.atlasSearchIndex, compound, count: { type: 'lowerBound' } } },
      ]);
      matchedTotal = meta?.[0]?.count?.lowerBound ?? matchedTotal;
    } catch { /* count metadata is optional */ }

    return {
      docs: docs.map((d) => this.fromDoc(d)),
      matchedTotal,
      truncated: docs.length >= cap,
      strategy: 'atlas-search',
    };
  }

  async listVerificationCandidates({ before = null, limit = 25 } = {}) {
    const cutoff = before ? new Date(before) : new Date();
    const q = {
      status: { $ne: JOB_STATUS.REMOVED },
      $or: [
        { needsVerification: true },
        { nextVerifyAt: { $lte: cutoff } },
        { nextVerifyAt: null, lastVerifiedAt: null },
        { nextVerifyAt: null, lastVerifiedAt: { $lte: cutoff } },
      ],
    };
    const docs = await this.models.Job.find(q)
      .sort({ needsVerification: -1, nextVerifyAt: 1, lastVerifiedAt: 1, firstSeenAt: 1 })
      .limit(Math.max(1, limit)).lean();
    return docs.map((d) => this.fromDoc(d));
  }

  async listDiscoveryCandidates({ at = null, limit = 25 } = {}) {
    const now = at ? new Date(at) : new Date();
    const q = {
      status: { $ne: JOB_STATUS.REMOVED },
      'sourceInstances.sourceClass': { $nin: ['ORIGINAL_ATS', 'ORIGINAL_CAREER_SITE'] },
      $or: [
        { 'sourceDiscovery.nextAttemptAt': { $exists: false } },
        { 'sourceDiscovery.nextAttemptAt': null },
        { 'sourceDiscovery.nextAttemptAt': { $lte: now } },
      ],
    };
    const docs = await this.models.Job.find(q)
      .sort({ 'sourceDiscovery.nextAttemptAt': 1, firstSeenAt: 1 })
      .limit(Math.max(1, limit)).lean();
    return docs.map((d) => this.fromDoc(d));
  }

  async putSource(source) {
    const { id, _id, ...doc } = source;
    await this.models.Source.updateOne({ _id: id || _id }, { $set: doc }, { upsert: true });
    return source;
  }

  async getSource(id) {
    const d = await this.models.Source.findById(id).lean();
    if (!d) return null;
    const { _id, __v, ...rest } = d;
    return { ...rest, id: _id };
  }

  async listSources(filter = {}) {
    const q = {};
    if (filter.provider) q.provider = filter.provider;
    if (filter.status) q.status = Array.isArray(filter.status) ? { $in: filter.status } : filter.status;
    if (filter.sourceClass) q.sourceClass = filter.sourceClass;
    if (filter.companyId) q.companyId = filter.companyId;
    const docs = await this.models.Source.find(q).limit(filter.limit || 5000).lean();
    return docs.map(({ _id, __v, ...rest }) => ({ ...rest, id: _id }));
  }

  async listDueSources({ at = null, limit = 20 } = {}) {
    const now = at ? new Date(at) : new Date();
    const docs = await this.models.Source.find({
      status: { $nin: ['DISABLED', 'NOT_CONFIGURED'] },
      accessPolicy: 'ALLOW',
      $or: [{ nextCrawlAt: null }, { nextCrawlAt: { $lte: now } }],
    }).sort({ crawlPriority: -1, nextCrawlAt: 1 }).limit(Math.max(1, limit)).lean();
    return docs.map(({ _id, __v, ...rest }) => ({ ...rest, id: _id }));
  }

  /* --------------------------- ingest runs --------------------------- */

  async putIngestRun(run) {
    const { id, _id, ...doc } = run;
    await this.models.IngestRun.updateOne({ _id: id || _id }, { $set: doc }, { upsert: true });
    return run;
  }

  async getIngestRun(id) {
    const d = await this.models.IngestRun.findById(id).lean();
    if (!d) return null;
    const { _id, __v, ...rest } = d;
    return { ...rest, id: _id };
  }

  async listIngestRuns({ limit = 50, triggeredBy = null } = {}) {
    const q = {};
    if (triggeredBy) q.triggeredBy = triggeredBy;
    const docs = await this.models.IngestRun.find(q)
      .sort({ startedAt: -1 })
      .limit(Math.max(1, Math.min(500, limit)))
      .lean();
    return docs.map(({ _id, __v, ...rest }) => ({ ...rest, id: _id }));
  }

  /* ------------------------------ companies ------------------------------ */

  async putCompany(company) {
    const { id, _id, ...doc } = company;
    await this.models.Company.updateOne({ _id: id || _id }, { $set: doc }, { upsert: true });
    return company;
  }

  async getCompany(id) {
    const d = await this.models.Company.findById(id).lean();
    if (!d) return null;
    const { _id, __v, ...rest } = d;
    return { ...rest, id: _id };
  }

  async listCompanies(filter = {}) {
    const q = {};
    if (filter.domain) q.domain = filter.domain;
    if (filter.normalizedName) q.normalizedName = filter.normalizedName;
    if (filter.hasSource === true) q['sourceIds.0'] = { $exists: true };
    if (filter.hasSource === false) q['sourceIds.0'] = { $exists: false };
    if (filter.provider) q.atsProvider = filter.provider;
    if (filter.seedSource) q.seedSource = filter.seedSource;
    const docs = await this.models.Company.find(q).limit(filter.limit || 5000).lean();
    return docs.map(({ _id, __v, ...rest }) => ({ ...rest, id: _id }));
  }

  async listCompanyDiscoveryCandidates({ limit = 50 } = {}) {
    const docs = await this.models.Company.find({
      careersUrl: { $exists: true, $nin: [null, ''] },
      'sourceIds.0': { $exists: false },
      $or: [
        { discoveryAttempts: { $exists: false } },
        { discoveryAttempts: { $lt: 5 } },
      ],
    })
      .sort({ discoveryQueueCount: 1, lastDiscoveryAt: 1, seedRank: 1, name: 1 })
      .limit(Math.max(1, Number(limit) || 50))
      .lean();
    return docs.map(({ _id, __v, ...rest }) => ({ ...rest, id: _id }));
  }

  async seedCompanies(companies = [], { seedSource = null } = {}) {
    const rows = (companies || []).filter((c) => c?.id);
    if (!rows.length) return { inserted: 0, matched: 0, totalProcessed: 0 };
    const operations = rows.map((company) => {
      const { id, _id, ...doc } = company;
      const seedMeta = {
        ...(seedSource ? { seedSource } : {}),
        ...(company.seedRank != null ? { seedRank: company.seedRank } : {}),
        ...(company.careerUrlStatus ? { careerUrlStatus: company.careerUrlStatus } : {}),
        ...(company.indiaRelevance ? { indiaRelevance: company.indiaRelevance } : {}),
      };
      return {
        updateOne: {
          filter: { _id: id || _id },
          update: { $setOnInsert: doc, $set: seedMeta },
          upsert: true,
        },
      };
    });
    const r = await this.models.Company.bulkWrite(operations, { ordered: false });
    return {
      inserted: r.upsertedCount || 0,
      matched: r.matchedCount || 0,
      modified: r.modifiedCount || 0,
      totalProcessed: rows.length,
    };
  }

  async pageJobs({
    page = 1, pageSize = 20, q: search = '', sourceId = null,
    companyDomain = null, provider = null, status = null, since = null,
  } = {}) {
    const query = {};
    if (sourceId) query['sourceInstances.sourceId'] = sourceId;
    if (companyDomain) query['company.domain'] = companyDomain;
    if (provider) query['sourceInstances.provider'] = provider;
    if (status) query.status = status;
    if (since) query.firstSeenAt = { $gte: new Date(since) };
    const term = String(search || '').trim();
    if (term) query.$text = { $search: term };

    const p = Math.max(1, Number(page) || 1);
    const size = Math.max(1, Number(pageSize) || 20);
    const offset = (p - 1) * size;
    const countPromise = this.models.Job.countDocuments(query);
    let find = this.models.Job.find(query);
    if (term) {
      find = find.select({ score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' }, firstSeenAt: -1 });
    } else {
      find = find.sort({ firstSeenAt: -1, _id: 1 });
    }
    const [total, docs] = await Promise.all([
      countPromise,
      find.skip(offset).limit(size).lean(),
    ]);
    return { docs: docs.map((d) => this.fromDoc(d)), total, page: p, pageSize: size };
  }

  async pageCompanies({
    page = 1, pageSize = 20, q: search = '', hasSource = null,
    provider = null, seedSource = null, careerUrlStatus = null,
  } = {}) {
    const query = {};
    if (hasSource === true) query['sourceIds.0'] = { $exists: true };
    if (hasSource === false) query['sourceIds.0'] = { $exists: false };
    if (provider) query.atsProvider = provider;
    if (seedSource) query.seedSource = seedSource;
    if (careerUrlStatus) query.careerUrlStatus = careerUrlStatus;
    const term = String(search || '').trim();
    if (term) query.$text = { $search: term };

    const p = Math.max(1, Number(page) || 1);
    const size = Math.max(1, Number(pageSize) || 20);
    const offset = (p - 1) * size;
    const countPromise = this.models.Company.countDocuments(query);
    let find = this.models.Company.find(query);
    if (term) {
      find = find.select({ score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' }, seedRank: 1, name: 1 });
    } else {
      find = find.sort({ seedRank: 1, jobCount: -1, name: 1 });
    }
    const [total, docs] = await Promise.all([
      countPromise,
      find.skip(offset).limit(size).lean(),
    ]);
    return {
      docs: docs.map(({ _id, __v, score, ...rest }) => ({ ...rest, id: _id })),
      total, page: p, pageSize: size,
    };
  }

  async companySummary() {
    const [total, seeded, withDomain, withSource, withAts, byProvider] = await Promise.all([
      this.models.Company.countDocuments(),
      this.models.Company.countDocuments({ seedSource: { $exists: true, $nin: [null, ''] } }),
      this.models.Company.countDocuments({ domain: { $exists: true, $nin: [null, ''] } }),
      this.models.Company.countDocuments({ 'sourceIds.0': { $exists: true } }),
      this.models.Company.countDocuments({ atsProvider: { $exists: true, $nin: [null, ''] } }),
      this.models.Company.aggregate([
        { $match: { atsProvider: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$atsProvider', n: { $sum: 1 } } },
      ]),
    ]);
    return {
      total, seeded, withDomain, withRegisteredSource: withSource, withKnownAts: withAts,
      byProvider: Object.fromEntries(byProvider.map((x) => [x._id, x.n])),
    };
  }

  async sourceSummary() {
    const [total, providers, statuses, classes] = await Promise.all([
      this.models.Source.countDocuments(),
      this.models.Source.aggregate([{ $group: { _id: '$provider', n: { $sum: 1 } } }]),
      this.models.Source.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      this.models.Source.aggregate([{ $group: { _id: '$sourceClass', n: { $sum: 1 } } }]),
    ]);
    return {
      total,
      byProvider: Object.fromEntries(providers.map((x) => [x._id, x.n])),
      byStatus: Object.fromEntries(statuses.map((x) => [x._id, x.n])),
      byClass: Object.fromEntries(classes.map((x) => [x._id, x.n])),
    };
  }

  async coverageAggregate({ now = Date.now(), windowHours = 24 } = {}) {
    const windowStart = new Date(now - windowHours * 3600000);
    const hourStart = new Date(now - 3600000);
    const activeStatuses = [JOB_STATUS.NEW, JOB_STATUS.ACTIVE, JOB_STATUS.LIKELY_ACTIVE];
    const directClasses = [SOURCE_CLASS.ORIGINAL_ATS, SOURCE_CLASS.ORIGINAL_CAREER_SITE];
    const nonEmpty = { $exists: true, $nin: [null, ''] };
    const salaryPresent = {
      $or: [
        { 'compensation.min': { $exists: true, $ne: null } },
        { 'compensation.max': { $exists: true, $ne: null } },
      ],
    };

    const [
      total, active, directSourceCount, directApplyCount, applyUrlCount,
      publishedCount, salaryCount, verifiedCount, changedInWindow,
      discoveredInWindow, newJobsLastHour, multiSourcedCount,
      byStatusRows, providerRows, classRows, instanceRows, datedSampleSize,
    ] = await Promise.all([
      this.models.Job.countDocuments(),
      this.models.Job.countDocuments({ status: { $in: activeStatuses } }),
      this.models.Job.countDocuments({ 'sourceInstances.sourceClass': { $in: directClasses } }),
      this.models.Job.countDocuments({ directApply: true }),
      this.models.Job.countDocuments({ canonicalApplyUrl: nonEmpty }),
      this.models.Job.countDocuments({ sourcePublishedAt: { $ne: null } }),
      this.models.Job.countDocuments(salaryPresent),
      this.models.Job.countDocuments({ lastVerifiedAt: { $ne: null } }),
      this.models.Job.countDocuments({ lastChangedAt: { $gte: windowStart } }),
      this.models.Job.countDocuments({ firstSeenAt: { $gte: windowStart } }),
      this.models.Job.countDocuments({ firstSeenAt: { $gte: hourStart } }),
      this.models.Job.countDocuments({ $expr: { $gt: [{ $size: { $ifNull: ['$sourceInstances', []] } }, 1] } }),
      this.models.Job.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      this.models.Job.aggregate([
        { $unwind: '$sourceInstances' },
        { $group: { _id: { job: '$_id', provider: '$sourceInstances.provider' } } },
        { $group: { _id: '$_id.provider', n: { $sum: 1 } } },
      ]),
      this.models.Job.aggregate([
        { $unwind: '$sourceInstances' },
        { $group: { _id: { job: '$_id', klass: '$sourceInstances.sourceClass' } } },
        { $group: { _id: '$_id.klass', n: { $sum: 1 } } },
      ]),
      this.models.Job.aggregate([
        { $project: { n: { $size: { $ifNull: ['$sourceInstances', []] } } } },
        { $group: { _id: null, n: { $sum: '$n' } } },
      ]),
      this.models.Job.countDocuments({ sourcePublishedAt: { $ne: null }, firstSeenAt: { $ne: null } }),
    ]);

    return {
      total,
      active,
      directSourceCount,
      directApplyCount,
      applyUrlCount,
      publishedCount,
      salaryCount,
      verifiedCount,
      changedInWindow,
      discoveredInWindow,
      newJobsLastHour,
      multiSourcedCount,
      totalInstances: instanceRows[0]?.n || 0,
      datedSampleSize,
      byStatus: Object.fromEntries(byStatusRows.map((x) => [x._id, x.n])),
      byProvider: Object.fromEntries(providerRows.filter((x) => x._id).map((x) => [x._id, x.n])),
      bySourceClass: Object.fromEntries(classRows.filter((x) => x._id).map((x) => [x._id, x.n])),
      medianDiscoveryAgeDays: null,
      aggregateStrategy: 'mongo-count-and-aggregate',
    };
  }

  /* --------------------------- discovery queue --------------------------- */

  async putDiscoveryTask(task) {
    const { id, _id, ...doc } = task;
    await this.models.Discovery.updateOne({ _id: id || _id }, { $set: doc }, { upsert: true });
    return task;
  }

  async getDiscoveryTask(id) {
    const d = await this.models.Discovery.findById(id).lean();
    if (!d) return null;
    const { _id, __v, ...rest } = d;
    return { ...rest, id: _id };
  }

  async listDiscoveryTasks(filter = {}) {
    const q = {};
    if (filter.state) q.state = Array.isArray(filter.state) ? { $in: filter.state } : filter.state;
    if (filter.kind) q.kind = filter.kind;
    const docs = await this.models.Discovery.find(q).limit(filter.limit || 500).lean();
    return docs.map(({ _id, __v, ...rest }) => ({ ...rest, id: _id }));
  }

  /** Atomic lease — two workers can never take the same discovery task. */
  async leaseDiscoveryTasks({ at = null, limit = 10, owner = 'worker', leaseMs = 120000 } = {}) {
    const now = at ? new Date(at) : new Date();
    const expiry = new Date(now.getTime() + leaseMs);
    const out = [];
    for (let i = 0; i < limit; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const d = await this.models.Discovery.findOneAndUpdate(
        {
          $or: [
            { state: { $in: ['PENDING', 'RETRY'] } },
            { state: 'LEASED', leaseExpiresAt: { $lte: now } },
          ],
          $and: [{ $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] }],
        },
        { $set: { state: 'LEASED', leaseOwner: owner, leaseExpiresAt: expiry, lastAttemptAt: now } },
        { sort: { priority: -1, nextAttemptAt: 1 }, returnDocument: 'after', new: true, lean: true },
      );
      if (!d) break;
      const { _id, __v, ...rest } = d;
      out.push({ ...rest, id: _id });
    }
    return out;
  }

  /* ----------------------------- crawl queue ----------------------------- */

  async putCrawlTask(task) {
    const { id, _id, ...doc } = task;
    await this.models.Crawl.updateOne({ _id: id || _id }, { $set: doc }, { upsert: true });
    return task;
  }

  async getCrawlTask(id) {
    const d = await this.models.Crawl.findById(id).lean();
    if (!d) return null;
    const { _id, __v, ...rest } = d;
    return { ...rest, id: _id };
  }

  async listCrawlTasks(filter = {}) {
    const q = {};
    if (filter.state) q.state = Array.isArray(filter.state) ? { $in: filter.state } : filter.state;
    if (filter.sourceId) q.sourceId = filter.sourceId;
    const docs = await this.models.Crawl.find(q).limit(filter.limit || 500).lean();
    return docs.map(({ _id, __v, ...rest }) => ({ ...rest, id: _id }));
  }

  async leaseCrawlTasks({ at = null, limit = 5, owner = 'worker', leaseMs = 300000 } = {}) {
    const now = at ? new Date(at) : new Date();
    const expiry = new Date(now.getTime() + leaseMs);
    const out = [];
    for (let i = 0; i < limit; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const d = await this.models.Crawl.findOneAndUpdate(
        {
          $or: [
            { state: { $in: ['PENDING', 'RETRY'] } },
            { state: 'LEASED', leaseExpiresAt: { $lte: now } },
          ],
          $and: [{ $or: [{ availableAt: null }, { availableAt: { $lte: now } }] }],
        },
        {
          $set: { state: 'LEASED', leaseOwner: owner, leaseExpiresAt: expiry, leasedAt: now },
          $inc: { attempts: 1 },
        },
        { sort: { priority: -1, availableAt: 1 }, returnDocument: 'after', new: true, lean: true },
      );
      if (!d) break;
      const { _id, __v, ...rest } = d;
      out.push({ ...rest, id: _id });
    }
    return out;
  }

  /* -------------------------------- raw -------------------------------- */

  async putRaw(snapshot) {
    await this.models.Raw.create({ ...snapshot, fetchedAt: new Date(snapshot.fetchedAt) });
    return snapshot;
  }

  async listRaw(filter = {}) {
    const q = filter.sourceId ? { sourceId: filter.sourceId } : {};
    return this.models.Raw.find(q).sort({ fetchedAt: -1 }).limit(filter.limit || 200).lean();
  }

  /* TTL index handles retention; this exists for explicit operator cleanup. */
  async pruneRaw({ maxAgeDays = 30 } = {}) {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000);
    const r = await this.models.Raw.deleteMany({ fetchedAt: { $lt: cutoff } });
    return r.deletedCount || 0;
  }

  async stats() {
    const [jobs, sources, raw, companies, discoveryTasks, crawlTasks] = await Promise.all([
      this.models.Job.countDocuments(), this.models.Source.countDocuments(), this.models.Raw.countDocuments(),
      this.models.Company.countDocuments(), this.models.Discovery.countDocuments(), this.models.Crawl.countDocuments(),
    ]);
    const agg = await this.models.Job.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    return {
      backend: 'mongo',
      jobs, sources, raw, companies, discoveryTasks, crawlTasks,
      byStatus: Object.fromEntries(agg.map((a) => [a._id, a.n])),
      atlasSearch: {
        configuredIndex: this.atlasSearchIndex,
        available: this.atlasSearchAvailable,
        lastError: this.lastAtlasError,
      },
    };
  }
}

/**
 * Backend selection mirrors the rest of the app: Mongo when configured,
 * otherwise file, otherwise memory. A configured Mongo URI is fail-closed:
 * callers may not silently create a second local index if Mongoose wiring is
 * missing. Never introduces new infrastructure.
 */
export async function createStore({
  mongoUri = process.env.MONGODB_URI || '',
  mongoose = null,
  connect = null,
  dataDir = process.env.JOB_DISCOVERY_DATA_DIR || '.data/job-discovery',
  backend = process.env.JOB_DISCOVERY_STORE || '',
  atlasSearchIndex = process.env.JOB_DISCOVERY_ATLAS_SEARCH_INDEX || null,
} = {}) {
  const chosen = backend || (mongoUri ? 'mongo' : (dataDir ? 'file' : 'memory'));
  if (chosen === 'mongo') {
    if (!mongoose) throw new Error('createStore: MONGODB_URI/mongo backend configured without a mongoose instance; refusing local-store fallback');
    return new MongoJobStore({ mongoose, connect, atlasSearchIndex }).init();
  }
  if (chosen === 'file') return new FileJobStore({ dir: dataDir }).init();
  return new MemoryJobStore().init();
}

export default {
  MemoryJobStore, FileJobStore, MongoJobStore, createStore, searchTextOf, retrievalFiltersOf,
};
