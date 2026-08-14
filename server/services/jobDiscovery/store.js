/* ============================================================
   JOB DISCOVERY OS — PERSISTENCE
   ------------------------------------------------------------
   Three collections behind one interface:

     jobs      canonical JobDocuments
     sources   JobSourceRegistry entries (§5) — persistent, and one
               of the central assets of the whole system
     raw       RawJobSnapshots (§15) with a retention policy

   Three backends:

     MemoryStore  tests and ephemeral workers
     FileStore    single-node deployments and local development
     MongoStore   Atlas, with every index §40 asks for

   The repo already degrades gracefully without MONGODB_URI, so
   `createStore()` follows the same rule: Mongo when configured,
   file when a data dir exists, memory otherwise. No new
   infrastructure is introduced (§30).
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { JOB_STATUS, RAW_SNAPSHOT_SCHEMA_VERSION, REMOTE_SCOPE, WORKPLACE_TYPE } from './schema.js';
import { parseLocation, detectCountry, detectRegion, locationCompatibility } from './normalize/location.js';
import { salaryCompatibility } from './normalize/compensation.js';
import { blockingKeys } from './dedupe.js';

/* ------------------------------------------------------------------
   Base: shared query semantics so every backend behaves identically.
   ------------------------------------------------------------------ */

export class BaseJobStore {
  async init() { return this; }

  // eslint-disable-next-line no-unused-vars
  async putJob(job) { throw new Error('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async getJob(id) { throw new Error('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async findCandidates(job) { throw new Error('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async listJobs(filter = {}) { throw new Error('not implemented'); }
  async searchCandidates(criteria = {}) { return this.listJobs({ status: criteria.status, limit: criteria.candidateLimit || 500 }); }
  async listVerificationCandidates({ before = null, limit = 25 } = {}) { return this.listJobs({ excludeStatus: JOB_STATUS.REMOVED, limit }); }
  async listDiscoveryCandidates({ at = null, limit = 25 } = {}) { return this.listJobs({ excludeStatus: JOB_STATUS.REMOVED, limit }); }
  // eslint-disable-next-line no-unused-vars
  async putSource(source) { throw new Error('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async getSource(id) { throw new Error('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async listSources(filter = {}) { throw new Error('not implemented'); }
  async listDueSources({ at = null, limit = 20 } = {}) { return this.listSources({}); }
  // eslint-disable-next-line no-unused-vars
  async putRaw(snapshot) { throw new Error('not implemented'); }
  async pruneRaw() { return 0; }
  async stats() { return {}; }
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

/* ------------------------------------------------------------------
   Memory
   ------------------------------------------------------------------ */

export class MemoryJobStore extends BaseJobStore {
  constructor() {
    super();
    this.jobs = new Map();
    this.sources = new Map();
    this.raw = [];
    this.blocking = new Map(); // key -> Set(jobId)
  }

  index(job) {
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
    this.index(job);
    return job;
  }

  async getJob(id) { return this.jobs.get(id) || null; }

  async deleteJob(id) {
    const j = this.jobs.get(id);
    if (j) { this.deindex(j); this.jobs.delete(id); }
    return !!j;
  }

  async findCandidates(job) {
    const ids = new Set();
    for (const key of blockingKeys(job)) {
      for (const id of this.blocking.get(key) || []) if (id !== job.id) ids.add(id);
    }
    return [...ids].map((id) => this.jobs.get(id)).filter(Boolean);
  }

  async listJobs(filter = {}) {
    const out = [];
    for (const job of this.jobs.values()) if (matchesJobFilter(job, filter)) out.push(job);
    return filter.limit ? out.slice(0, filter.limit) : out;
  }

  async searchCandidates(criteria = {}) {
    const statuses = criteria.status || [JOB_STATUS.NEW, JOB_STATUS.ACTIVE, JOB_STATUS.LIKELY_ACTIVE];
    let out = await this.listJobs({ status: statuses });
    if (criteria.employmentType) out = out.filter((j) => !j.employmentType || j.employmentType === 'UNKNOWN' || j.employmentType === criteria.employmentType);
    if (Array.isArray(criteria.seniority) && criteria.seniority.length) out = out.filter((j) => !j.seniority || j.seniority === 'UNKNOWN' || criteria.seniority.includes(j.seniority));
    if (criteria.companyNormalized) out = out.filter((j) => (j.company?.normalizedName || '') === criteria.companyNormalized);
    if (criteria.sourceType) out = out.filter((j) => (j.sourceInstances || []).some((x) => x.sourceClass === criteria.sourceType || x.sourceType === criteria.sourceType));
    if (criteria.remote === 'remote') out = out.filter((j) => j.workplace?.type === WORKPLACE_TYPE.REMOTE);
    if (criteria.remote === 'hybrid') out = out.filter((j) => j.workplace?.type === WORKPLACE_TYPE.HYBRID);
    if (criteria.remote === 'onsite') out = out.filter((j) => j.workplace?.type === WORKPLACE_TYPE.ONSITE);
    if (criteria.location) out = out.filter((j) => locationCompatibility(j, criteria.location).compatible);
    if (criteria.salaryMin != null || criteria.salaryMax != null) out = out.filter((j) => salaryCompatibility(j, criteria).compatible);
    const families = new Set(criteria.familyKeys || []);
    const q = String(criteria.q || '').toLowerCase().trim();
    if (q || families.size) {
      out = out.filter((job) => {
        const fam = [job.titleFamily, ...(job.titleFamilies || [])].filter(Boolean);
        const familyHit = fam.some((x) => families.has(x));
        const hay = searchTextOf(job).toLowerCase();
        return familyHit || !q || q.split(/\s+/).filter(Boolean).some((t) => hay.includes(t));
      });
    }
    return out.slice(0, criteria.candidateLimit || 750);
  }

  async listVerificationCandidates({ before = null, limit = 25 } = {}) {
    const cutoff = before ? Date.parse(before) : Date.now();
    const out = [...this.jobs.values()].filter((j) => j.status !== JOB_STATUS.REMOVED && (
      j.needsVerification || !j.lastVerifiedAt || Date.parse(j.lastVerifiedAt) <= cutoff
    ));
    out.sort((a,b) => Number(!!b.needsVerification)-Number(!!a.needsVerification) || String(a.lastVerifiedAt||'').localeCompare(String(b.lastVerifiedAt||'')));
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
    out.sort((a,b) => String(a.sourceDiscovery?.nextAttemptAt||'').localeCompare(String(b.sourceDiscovery?.nextAttemptAt||'')) || String(a.firstSeenAt||'').localeCompare(String(b.firstSeenAt||'')));
    return out.slice(0, limit);
  }

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
    return out;
  }

  async listDueSources({ at = null, limit = 20 } = {}) {
    const now = at || new Date().toISOString();
    const out = [...this.sources.values()].filter((src) =>
      !['DISABLED','NOT_CONFIGURED'].includes(src.status)
      && src.accessPolicy === 'ALLOW'
      && (!src.nextCrawlAt || src.nextCrawlAt <= now)
    );
    out.sort((a,b) => (b.crawlPriority || 0) - (a.crawlPriority || 0) || String(a.nextCrawlAt||'').localeCompare(String(b.nextCrawlAt||'')));
    return out.slice(0, limit);
  }

  async putRaw(snapshot) {
    this.raw.push(snapshot);
    return snapshot;
  }

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
    return { backend: 'memory', jobs: this.jobs.size, sources: this.sources.size, raw: this.raw.length, byStatus };
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
    };
  }

  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    const p = this.paths();
    const read = (file, fallback) => {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
    };
    for (const job of read(p.jobs, [])) { this.jobs.set(job.id, job); this.index(job); }
    for (const s of read(p.sources, [])) this.sources.set(s.id, s);
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
    this.dirty = false;
    return true;
  }

  async putJob(job) { const r = await super.putJob(job); this.scheduleFlush(); return r; }
  async deleteJob(id) { const r = await super.deleteJob(id); this.scheduleFlush(); return r; }
  async putSource(s) { const r = await super.putSource(s); this.scheduleFlush(); return r; }
  async putRaw(s) { const r = await super.putRaw(s); this.scheduleFlush(); return r; }
  async pruneRaw(o) { const r = await super.pruneRaw(o); this.scheduleFlush(); return r; }
  async stats() { return { ...(await super.stats()), backend: 'file', dir: this.dir }; }
}

/* ------------------------------------------------------------------
   Mongo — reuses the app's existing Atlas connection (§30).
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
    status: { type: String, default: JOB_STATUS.NEW },
    needsVerification: { type: Boolean, default: false },
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
  }, { _id: false, timestamps: true, collection: 'jobdiscovery_jobs' });

  /* §40 — every index the spec asks for. */
  jobSchema.index({ 'company.domain': 1 });
  jobSchema.index({ 'company.normalizedName': 1 });
  jobSchema.index({ normalizedTitle: 1 });
  jobSchema.index({ titleFamilies: 1 });
  jobSchema.index({ status: 1, lastSeenAt: -1 });
  jobSchema.index({ firstSeenAt: -1 });
  jobSchema.index({ sourcePublishedAt: -1 });
  jobSchema.index({ status: 1, lastVerifiedAt: 1, needsVerification: 1 });
  jobSchema.index({ 'sourceDiscovery.nextAttemptAt': 1, status: 1 });
  jobSchema.index({ 'workplace.type': 1, 'workplace.remoteScope': 1 });
  jobSchema.index({ 'locations.countryCode': 1, 'locations.city': 1 });
  jobSchema.index({ contentHash: 1 });
  jobSchema.index({ dedupeFingerprint: 1 });
  jobSchema.index({ 'sourceInstances.provider': 1, 'sourceInstances.sourceJobId': 1 });
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
    cursor: { type: Mixed, default: null },
    queries: { type: Mixed, default: null },
    location: { type: Mixed, default: null },
    discoveredFrom: { type: String, default: null },
  }, { _id: false, timestamps: true, collection: 'jobdiscovery_sources' });
  sourceSchema.index({ provider: 1, tenant: 1 }, { unique: true, sparse: true });
  sourceSchema.index({ accessPolicy: 1, status: 1, nextCrawlAt: 1, crawlPriority: -1 });

  const rawSchema = new Schema({
    schemaVersion: { type: Number, default: RAW_SNAPSHOT_SCHEMA_VERSION },
    sourceId: { type: String, index: true },
    sourceJobId: { type: String, default: null },
    fetchedAt: { type: Date, index: true },
    http: { type: Mixed, default: {} },
    contentHash: { type: String, index: true },
    normalizerVersion: Number,
    payload: { type: Mixed, default: null },
  }, { collection: 'jobdiscovery_raw' });
  /* Retention: raw payloads expire automatically rather than growing forever. */
  rawSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 30 * 86400 });

  mongooseModels = {
    Job: mongoose.models.JobDiscoveryJob || mongoose.model('JobDiscoveryJob', jobSchema),
    Source: mongoose.models.JobDiscoverySource || mongoose.model('JobDiscoverySource', sourceSchema),
    Raw: mongoose.models.JobDiscoveryRaw || mongoose.model('JobDiscoveryRaw', rawSchema),
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
  constructor({ mongoose, connect }) {
    super();
    this.mongoose = mongoose;
    this.connect = connect;
    this.models = null;
  }

  async init() {
    if (this.connect) await this.connect();
    this.models = await buildModels(this.mongoose);
    return this;
  }

  toDoc(job) {
    return { ...job, _id: job.id, blockingKeys: blockingKeys(job), searchText: searchTextOf(job) };
  }

  fromDoc(doc) {
    if (!doc) return null;
    const o = doc.toObject ? doc.toObject() : doc;
    const { _id, blockingKeys: _bk, searchText: _st, __v, createdAt, updatedAt, ...rest } = o;
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
    };
  }

  async putJob(job) {
    const { _id, ...doc } = this.toDoc(job);
    await this.models.Job.updateOne({ _id: job.id }, { $set: doc }, { upsert: true });
    return job;
  }

  async getJob(id) { return this.fromDoc(await this.models.Job.findById(id).lean()); }

  async deleteJob(id) {
    const r = await this.models.Job.deleteOne({ _id: id });
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

  /** Indexed candidate retrieval. Production search never takes an arbitrary
      first-N slice of the collection and hopes the relevant job is present. */
  async searchCandidates(criteria = {}) {
    const statuses = criteria.status || [JOB_STATUS.NEW, JOB_STATUS.ACTIVE, JOB_STATUS.LIKELY_ACTIVE];
    const base = { status: { $in: statuses } };
    if (criteria.employmentType) base.employmentType = { $in: [criteria.employmentType, 'UNKNOWN', null] };
    if (Array.isArray(criteria.seniority) && criteria.seniority.length) base.seniority = { $in: [...criteria.seniority, 'UNKNOWN', null] };
    if (criteria.companyNormalized) base['company.normalizedName'] = criteria.companyNormalized;

    /* Compose structured OR clauses under $and so source-type and location
       filters cannot overwrite each other. These are candidate-selection
       constraints only; the deterministic ranker still performs the final
       compatibility check before a result is surfaced. */
    const andClauses = [];
    if (criteria.sourceType) andClauses.push({ $or: [
      { 'sourceInstances.sourceClass': criteria.sourceType },
      { 'sourceInstances.sourceType': criteria.sourceType },
    ] });
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

    const cap = Math.max(50, Math.min(1500, Number(criteria.candidateLimit) || 750));
    const docsById = new Map();
    const add = (docs) => { for (const d of docs) docsById.set(String(d._id), d); };
    const families = (criteria.familyKeys || []).filter(Boolean);
    if (families.length) {
      const q = { ...base, titleFamilies: { $in: families } };
      add(await this.models.Job.find(q).sort({ sourcePublishedAt: -1, firstSeenAt: -1 }).limit(Math.ceil(cap * 0.7)).lean());
    }
    const text = String(criteria.q || '').trim();
    if (text) {
      const q = { ...base, $text: { $search: text } };
      // If base already used $or for source type, $text remains a top-level AND.
      add(await this.models.Job.find(q, { score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' } }).limit(cap).lean());
    }
    if (!text && !families.length) {
      add(await this.models.Job.find(base).sort({ sourcePublishedAt: -1, firstSeenAt: -1 }).limit(cap).lean());
    }
    return [...docsById.values()].slice(0, cap).map((d) => this.fromDoc(d));
  }

  async listVerificationCandidates({ before = null, limit = 25 } = {}) {
    const cutoff = before ? new Date(before) : new Date();
    const q = {
      status: { $ne: JOB_STATUS.REMOVED },
      $or: [
        { needsVerification: true },
        { lastVerifiedAt: null },
        { lastVerifiedAt: { $lte: cutoff } },
      ],
    };
    const docs = await this.models.Job.find(q)
      .sort({ needsVerification: -1, lastVerifiedAt: 1, firstSeenAt: 1 })
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

  async putRaw(snapshot) {
    await this.models.Raw.create({ ...snapshot, fetchedAt: new Date(snapshot.fetchedAt) });
    return snapshot;
  }

  async listRaw(filter = {}) {
    const q = filter.sourceId ? { sourceId: filter.sourceId } : {};
    return this.models.Raw.find(q).sort({ fetchedAt: -1 }).limit(filter.limit || 200).lean();
  }

  /* TTL index handles retention; this exists for explicit operator-run cleanup. */
  async pruneRaw({ maxAgeDays = 30 } = {}) {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000);
    const r = await this.models.Raw.deleteMany({ fetchedAt: { $lt: cutoff } });
    return r.deletedCount || 0;
  }

  async stats() {
    const [jobs, sources, raw] = await Promise.all([
      this.models.Job.countDocuments(), this.models.Source.countDocuments(), this.models.Raw.countDocuments(),
    ]);
    const agg = await this.models.Job.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    return { backend: 'mongo', jobs, sources, raw, byStatus: Object.fromEntries(agg.map((a) => [a._id, a.n])) };
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
} = {}) {
  /* Fail closed when a Mongo URI is present. Falling back to a local file store
     in that situation can split the crawler worker and HTTP API across two
     different indexes while both appear healthy. */
  const chosen = backend || (mongoUri ? 'mongo' : (dataDir ? 'file' : 'memory'));
  if (chosen === 'mongo') {
    if (!mongoose) throw new Error('createStore: MONGODB_URI/mongo backend configured without a mongoose instance; refusing local-store fallback');
    return new MongoJobStore({ mongoose, connect }).init();
  }
  if (chosen === 'file') return new FileJobStore({ dir: dataDir }).init();
  return new MemoryJobStore().init();
}

export default { MemoryJobStore, FileJobStore, MongoJobStore, createStore, searchTextOf };
