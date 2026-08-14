/* ============================================================
   JOB DISCOVERY OS — SEARCH INDEX ABSTRACTION  (§30, §36, §60, §62)
   ------------------------------------------------------------
   Product logic talks to JobSearchIndex, never to a vendor. The
   first implementation runs on the persistence the repo already
   has (Mongo when configured, file/memory otherwise) rather than
   introducing new infrastructure — but ingestion writes through
   this interface, so an Atlas Search / OpenSearch / Meilisearch
   adapter can be swapped in later without touching a connector.

   Search NEVER touches the network. It reads the canonical index.
   ============================================================ */

import { rankJob, familyRelevant } from './ranking.js';
import { freshnessLabel } from './freshness.js';
import { JOB_STATUS, SOURCE_CLASS, SOURCE_AUTHORITY } from './schema.js';
import { tokens } from './normalize/text.js';
import { normalizeCompany } from './normalize/entity.js';
import { expandQuery } from './normalize/taxonomy.js';

export const FRESHNESS_WINDOWS = Object.freeze({
  '24h': 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30, latest: null, any: null,
});

export class JobSearchIndex {
  // eslint-disable-next-line no-unused-vars
  async search(query) { throw new Error('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async get(id) { throw new Error('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async upsert(job) { throw new Error('not implemented'); }
  async stats() { return {}; }
}

/** Short-lived, filter-keyed query cache (§62). */
export class QueryCache {
  constructor({ ttlMs = 60_000, max = 300, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.now = now;
    this.map = new Map();
  }

  key(criteria) {
    const normalized = {};
    for (const k of Object.keys(criteria).sort()) {
      const v = criteria[k];
      if (v == null || v === '') continue;
      normalized[k] = typeof v === 'string' ? v.trim().toLowerCase() : v;
    }
    return JSON.stringify(normalized);
  }

  get(criteria) {
    const k = this.key(criteria);
    const hit = this.map.get(k);
    if (!hit) return null;
    if (this.now() - hit.at > this.ttlMs) { this.map.delete(k); return null; }
    return hit.value;
  }

  set(criteria, value) {
    const k = this.key(criteria);
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(k, { at: this.now(), value });
    return value;
  }

  clear() { this.map.clear(); }
}

export class StoreBackedSearchIndex extends JobSearchIndex {
  constructor({ store, cache = null, now = () => Date.now(), defaultLimit = 20 } = {}) {
    super();
    this.store = store;
    /* Freshness-sensitive: a 60s TTL cannot serve a stale status for long. */
    this.cache = cache === false ? null : (cache === null ? new QueryCache({ ttlMs: 60_000 }) : cache);
    this.now = now;
    this.defaultLimit = defaultLimit;
    this.metrics = { searches: 0, cacheHits: 0, totalLatencyMs: 0, latencies: [] };
  }

  async upsert(job) { return this.store.putJob(job); }
  async get(id) { return this.store.getJob(id); }

  /**
   * @param criteria
   *   q, location, remote, salaryMin, salaryMax, currency, employmentType,
   *   freshness, company, sourceType, limit, cursor, includeUnverified
   */
  async search(criteria = {}) {
    const started = Date.now();
    const cached = this.cache?.get(criteria);
    if (cached) {
      this.metrics.cacheHits += 1;
      return { ...cached, cached: true };
    }

    const limit = Math.max(1, Math.min(100, Number(criteria.limit) || this.defaultLimit));
    const offset = decodeCursor(criteria.cursor);

    /* Status policy: REMOVED is never surfaced. STALE only on request. */
    const statuses = criteria.includeStale
      ? [JOB_STATUS.NEW, JOB_STATUS.ACTIVE, JOB_STATUS.LIKELY_ACTIVE, JOB_STATUS.STALE]
      : [JOB_STATUS.NEW, JOB_STATUS.ACTIVE, JOB_STATUS.LIKELY_ACTIVE];

    /* Indexed candidate retrieval first, deterministic Career Autopilot ranking
       second. Mongo selects a bounded candidate set using the text/title-family
       indexes; memory/file stores use the same interface for local fixtures. */
    const expansion = criteria.q ? expandQuery(criteria.q) : new Map();
    const familyKeys = [...expansion.keys()];
    const companyNormalized = criteria.company ? normalizeCompany(criteria.company).normalizedName : null;
    const pool = await this.store.searchCandidates({
      ...criteria,
      status: statuses,
      familyKeys,
      companyNormalized,
      candidateLimit: Math.max(250, Math.min(1500, Number(criteria.candidateLimit) || 750)),
    });

    const maxDays = FRESHNESS_WINDOWS[criteria.freshness ?? 'latest'] ?? null;
    const nowMs = this.now();

    const scored = [];
    const rejected = { freshness: 0, relevance: 0, location: 0, remote: 0, salary: 0, employmentType: 0, company: 0, sourceType: 0 };

    for (const job of pool) {
      if (criteria.company) {
        /* Both sides go through the SAME company normalizer. Comparing a raw
           query ("Other Corp") against a suffix-stripped stored name ("other")
           never matched, which silently emptied every company-filtered search. */
        const want = normalizeCompany(criteria.company).normalizedName;
        const have = job.company?.normalizedName || '';
        const display = tokens(job.company?.name || '').join(' ');
        if (want && !have.includes(want) && !display.includes(want)) { rejected.company += 1; continue; }
      }
      if (criteria.sourceType) {
        const want = String(criteria.sourceType).toUpperCase();
        const has = (job.sourceInstances || []).some((s) => s.sourceClass === want || s.sourceType === want);
        if (!has) { rejected.sourceType += 1; continue; }
      }
      if (maxDays != null) {
        const label = freshnessLabel(job, { now: nowMs });
        const days = label.ageMinutes == null ? null : label.ageMinutes / 1440;
        /* An undated job is not silently dropped by a date filter — it is only
           excluded when the caller explicitly asks for dated postings. */
        if (days == null) {
          if (criteria.requireDated) { rejected.freshness += 1; continue; }
        } else if (days > maxDays) { rejected.freshness += 1; continue; }
      }

      const relevance = rankJob(job, criteria, { now: nowMs });
      if (relevance.excluded) {
        const key = String(relevance.exclusionReason || '').split(':')[0];
        if (rejected[key] != null) rejected[key] += 1;
        continue;
      }
      /* A query that resolves to a role family and matches nothing about the
         job is suppressed rather than shown at rank 40 (§64.5). */
      if (criteria.q && relevance.title === 0 && relevance.query < 30) { rejected.relevance += 1; continue; }
      if (criteria.q && !familyRelevant(job, criteria.q) && relevance.title < 20 && relevance.query < 50) {
        rejected.relevance += 1; continue;
      }

      scored.push({ job, relevance });
    }

    scored.sort((a, b) => (
      b.relevance.overall - a.relevance.overall
      || b.relevance.title - a.relevance.title
      || b.relevance.freshness - a.relevance.freshness
      || String(a.job.id).localeCompare(String(b.job.id))
    ));

    const page = scored.slice(offset, offset + limit);
    const results = page.map((entry, i) => this.toResult(entry, offset + i + 1, nowMs));
    const nextCursor = offset + limit < scored.length ? encodeCursor(offset + limit) : null;

    const latency = Date.now() - started;
    this.metrics.searches += 1;
    this.metrics.totalLatencyMs += latency;
    this.metrics.latencies.push(latency);
    if (this.metrics.latencies.length > 500) this.metrics.latencies.shift();

    const payload = {
      query: {
        q: criteria.q ?? null,
        location: criteria.location ?? null,
        remote: criteria.remote ?? null,
        salaryMin: criteria.salaryMin ?? null,
        salaryMax: criteria.salaryMax ?? null,
        currency: criteria.currency ?? null,
        employmentType: criteria.employmentType ?? null,
        freshness: criteria.freshness ?? null,
        company: criteria.company ?? null,
        sourceType: criteria.sourceType ?? null,
        limit,
        cursor: criteria.cursor ?? null,
        expandedFamilies: criteria.q ? [...expandQuery(criteria.q).entries()].map(([family, v]) => ({ family, relation: v.relation, weight: v.weight })) : [],
      },
      results,
      total: scored.length,
      candidatesRetrieved: pool.length,
      scanned: pool.length, // compatibility alias; this is a bounded indexed candidate set, not a collection scan
      rejected,
      nextCursor,
      cached: false,
      latencyMs: latency,
      /* No candidate data was consulted. Stated explicitly so the §50 guarantee
         is visible in the payload, not just in a test. */
      personalization: { usedResume: false, usedProfile: false, usedEvidence: false },
    };

    this.cache?.set(criteria, payload);
    return payload;
  }

  toResult({ job, relevance }, rank, nowMs) {
    const label = freshnessLabel(job, { now: nowMs });
    const best = (job.sourceInstances || [])
      .slice()
      .sort((a, b) => (SOURCE_AUTHORITY[b.sourceClass] ?? 0) - (SOURCE_AUTHORITY[a.sourceClass] ?? 0))[0] || null;

    return {
      job: publicJobView(job),
      rank,
      relevance: {
        overall: relevance.overall,
        title: relevance.title,
        query: relevance.query,
        location: relevance.location,
        freshness: relevance.freshness,
        titleRelation: relevance.titleRelation,
        explanations: relevance.explanations,
      },
      source: {
        type: best?.sourceClass ?? null,
        provider: best?.provider ?? null,
        tenant: best?.tenant ?? null,
        isOriginal: best ? (best.sourceClass === SOURCE_CLASS.ORIGINAL_ATS || best.sourceClass === SOURCE_CLASS.ORIGINAL_CAREER_SITE) : false,
        instanceCount: (job.sourceInstances || []).length,
        providers: [...new Set((job.sourceInstances || []).map((s) => s.provider))],
      },
      freshness: {
        firstSeenAt: job.firstSeenAt,
        sourcePublishedAt: job.sourcePublishedAt,
        lastSeenAt: job.lastSeenAt,
        lastVerifiedAt: job.lastVerifiedAt,
        /* The label is derived by the freshness engine, so a UI cannot print
           "Posted" for a job whose only date is a discovery time. */
        dateKind: label.kind,
        dateLabel: label.label,
        verifiedLabel: label.verifiedLabel,
      },
      apply: {
        canonicalApplyUrl: job.canonicalApplyUrl,
        canonicalJobUrl: job.canonicalJobUrl,
        directApply: relevance.directApply === 100,
      },
    };
  }

  async stats() {
    const sorted = [...this.metrics.latencies].sort((a, b) => a - b);
    const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
    return {
      backend: 'indexed-candidate-rerank',
      searches: this.metrics.searches,
      cacheHits: this.metrics.cacheHits,
      p50Ms: pct(50),
      p95Ms: pct(95),
      store: await this.store.stats(),
    };
  }
}

/** The shape the API and UI receive. Internal signatures are not exposed. */
export function publicJobView(job) {
  return {
    id: job.id,
    title: job.title,
    normalizedTitle: job.normalizedTitle,
    titleFamily: job.titleFamily,
    company: {
      name: job.company?.name ?? null,
      domain: job.company?.domain ?? null,
      website: job.company?.website ?? null,
      logoUrl: job.company?.logoUrl ?? null,
    },
    description: { text: job.description?.text ?? '' },
    employmentType: job.employmentType,
    department: job.department,
    seniority: job.seniority,
    locations: job.locations || [],
    workplace: job.workplace || {},
    compensation: job.compensation || {},
    status: job.status,
    sourcePublishedAt: job.sourcePublishedAt,
    firstSeenAt: job.firstSeenAt,
    lastSeenAt: job.lastSeenAt,
    lastVerifiedAt: job.lastVerifiedAt,
    canonicalApplyUrl: job.canonicalApplyUrl,
    canonicalJobUrl: job.canonicalJobUrl,
    completeness: job.completeness,
    completenessFlags: job.completenessFlags,
    sourceConfidence: job.sourceConfidence,
    sourceInstances: (job.sourceInstances || []).map((s) => ({
      provider: s.provider,
      sourceClass: s.sourceClass,
      sourceType: s.sourceType,
      tenant: s.tenant,
      jobUrl: s.jobUrl,
      applyUrl: s.applyUrl,
      firstSeenAt: s.firstSeenAt,
      lastSeenAt: s.lastSeenAt,
      lastVerifiedAt: s.lastVerifiedAt,
      sourcePublishedAt: s.sourcePublishedAt,
      active: s.active,
    })),
    provenance: job.provenance || {},
    conflicts: job.conflicts || {},
    tags: job.tags || [],
  };
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const o = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))?.o;
    return Number.isInteger(o) && o >= 0 ? o : 0;
  } catch { return 0; }
}

export default { JobSearchIndex, StoreBackedSearchIndex, QueryCache, publicJobView, FRESHNESS_WINDOWS };
