/* ============================================================
   AGGREGATOR ADAPTER  (§25)
   ------------------------------------------------------------
   The existing Remotive / RemoteOK / Jobicy / Arbeitnow / The Muse /
   Adzuna / JSearch integrations are PRESERVED — but demoted. They
   become bootstrap + supplemental sources behind the same
   JobSourceAdapter contract, classed AGGREGATOR, which means:

     - they lose every field conflict to an original ATS (§39)
     - their apply URL never displaces an original one (§35)
     - their responses are NEVER authoritative, so a job missing
       from a keyword-filtered aggregator response is not evidence
       of anything (§22.1)
     - the company names they carry feed source discovery, which is
       how direct-source coverage grows (§24.1)

   A legacy source is injected as `{ name, fetch(role, ctx) }`, the
   exact shape server.js already defines, so nothing is rewritten.
   ============================================================ */

import { JobSourceAdapter } from './base.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, ERROR_CLASS } from '../schema.js';
import { sha256, stripHtml } from '../normalize/text.js';

export class AggregatorAdapter extends JobSourceAdapter {
  static provider = PROVIDER.API;
  static sourceType = SOURCE_TYPE.AGGREGATOR;
  static sourceClass = SOURCE_CLASS.AGGREGATOR;

  /**
   * @param ctx.legacySources  array of { name, home, fetch(role, ctx) }
   * @param ctx.bootstrapQueries queries used to sweep aggregators in the
   *        background. Aggregators are keyword APIs, so coverage comes from
   *        sweeping a query set on a schedule — never from a user's search.
   */
  constructor(ctx = {}) {
    super(ctx);
    this.legacySources = new Map((ctx.legacySources || []).map((s) => [s.name, s]));
    this.bootstrapQueries = ctx.bootstrapQueries || [
      'devops engineer', 'software engineer', 'backend engineer', 'frontend engineer',
      'data engineer', 'data analyst', 'product manager', 'qa engineer',
      'support engineer', 'machine learning engineer',
    ];
  }

  identify(urlOrSource) {
    const name = typeof urlOrSource === 'string' ? urlOrSource : urlOrSource?.tenant;
    return {
      provider: PROVIDER.API,
      detected: this.legacySources.has(name),
      supported: this.legacySources.has(name),
      tenant: name || null,
      confidence: this.legacySources.has(name) ? 1 : 0,
      matches: this.legacySources.has(name),
      evidence: 'legacy-source-registry',
    };
  }

  async discover(source) {
    const legacy = this.legacySources.get(source.tenant);
    if (!legacy) {
      return { source, ok: false, reason: `legacy source "${source.tenant}" is not registered on this deployment`, errorClass: ERROR_CLASS.NOT_CONFIGURED };
    }
    return {
      source: { ...source, baseUrl: legacy.home || null, careersUrl: legacy.home || null },
      ok: true,
      reason: 'legacy source available',
    };
  }

  /**
   * Cursor walks the bootstrap query list, one query per crawl tick, so a
   * scheduled sweep spreads load instead of firing every query at once.
   */
  async fetchJobs(source, cursor = null, ctx = {}) {
    const legacy = this.legacySources.get(source.tenant);
    if (!legacy) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.NOT_CONFIGURED, message: `legacy source ${source.tenant} unavailable` } };
    }
    const queries = source.queries?.length ? source.queries : this.bootstrapQueries;
    const index = Number(cursor?.index || 0);
    if (index >= queries.length) return { items: [], nextCursor: null, authoritative: false };

    const query = queries[index];
    let raw = [];
    try {
      raw = await legacy.fetch(query, { role: query, location: source.location || '', freshness: '30d', diag: {} }) || [];
    } catch (e) {
      return {
        items: [], authoritative: false,
        nextCursor: index + 1 < queries.length ? { index: index + 1 } : null,
        error: { errorClass: e?.errorClass || ERROR_CLASS.NETWORK, message: e?.message },
      };
    }
    return {
      items: raw.map((j) => ({ ...j, __query: query, __legacySource: legacy.name })),
      nextCursor: index + 1 < queries.length ? { index: index + 1 } : null,
      /* Keyword-filtered response. Absence proves nothing. */
      authoritative: false,
    };
  }

  normalize(raw, source) {
    const url = raw.url || raw.applyUrl || null;
    const summary = raw.summary || raw.description || null;

    return {
      sourceJobId: String(raw.id ?? url ?? `${raw.company}-${raw.title}`),
      requisitionId: null,
      title: raw.title || null,
      company: {
        name: raw.company || null,
        /* The aggregator's own host is NOT the employer's domain, and a link
           that redirects through it tells us nothing about who the employer is.
           Leaving both null keeps source discovery honest about what it knows;
           the real domain arrives when discovery finds the original board. */
        website: null,
        domain: null,
        logoUrl: raw.logo || null,
      },
      descriptionHtml: null,
      descriptionText: summary ? stripHtml(summary) : null,
      locationsRaw: [raw.location].filter(Boolean),
      applicantRegions: [],
      /* mode:'Remote' from a remote-only board is an explicit assertion by that
         board — recorded as such, and outranked by any ATS that disagrees. */
      explicitRemote: /remote/i.test(String(raw.mode || '')) ? true : null,
      workplaceHint: raw.mode || null,
      employmentTypeRaw: raw.experience || raw.jobType || null,
      department: null,
      jobUrl: url,
      applyUrl: raw.applyUrl || url,
      sourcePublishedAt: raw.postedDate || null,
      validThrough: null,
      compensationStructured: null,
      compensationRaw: raw.salary || null,
      tags: Array.isArray(raw.requiredSkills) ? raw.requiredSkills.slice(0, 12) : [],
      extraction: 'AGGREGATOR_API',
      rawHash: sha256(JSON.stringify(raw)),
    };
  }

  /**
   * Verification for an aggregator instance is deliberately weak: a dead link
   * on an aggregator says nothing about the employer's own posting.
   */
  async verify(instance, ctx = {}) {
    const base = await super.verify(instance, ctx);
    if (base.closed) {
      return { ...base, closed: true, weakEvidence: true, reason: 'aggregator link gone — corroborate against the original source before closing' };
    }
    return base;
  }
}

export default AggregatorAdapter;
