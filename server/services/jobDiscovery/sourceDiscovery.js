/* ============================================================
   JOB DISCOVERY OS — SOURCE DISCOVERY ENGINE  (§24, §24.1, §47)
   ------------------------------------------------------------
       unknown company
             ↓
       find careers surface
             ↓
       classify ATS / provider
             ↓
       extract tenant / source identifier
             ↓
       register JobSource
             ↓
       crawl

   This is the loop that makes direct-source coverage GROW. An
   aggregator tells us "Company XYZ is hiring"; discovery finds
   jobs.ashbyhq.com/xyz and registers it, and from then on XYZ's
   jobs arrive from the original ATS with a real apply URL.

   Every URL here is untrusted input and passes through the same
   SSRF, redirect, protocol, DNS, size and timeout protections as
   any other crawl target (§47). Nothing is fetched from internal
   infrastructure on the strength of a user-supplied string.
   ============================================================ */

import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, ACCESS_POLICY, ERROR_CLASS } from './schema.js';
import { detectAts, boardUrlFor, extractAtsLinks, CAREER_PATH_HINTS } from './atsDetect.js';
import { extractMeta } from './crawler/extract.js';
import { registrableDomain, normalizeUrl, hostOf } from './normalize/text.js';
import { makeSource, CRAWL_STRATEGY } from './sourceRegistry.js';

const CAREER_SUBDOMAINS = ['careers', 'jobs', 'work', 'hiring'];

export class SourceDiscoveryEngine {
  constructor({
    http, registry, adapters, robots = null, logger = console,
    maxProbesPerCompany = 8, allowGenericFallback = true,
  }) {
    this.http = http;
    this.registry = registry;
    this.adapters = adapters;
    this.robots = robots;
    this.logger = logger;
    this.maxProbesPerCompany = maxProbesPerCompany;
    this.allowGenericFallback = allowGenericFallback;
    /* Negative cache: do not re-probe a domain that yielded nothing recently. */
    this.attempted = new Map();
    this.metrics = { probed: 0, registered: 0, alreadyKnown: 0, failed: 0, atsFound: 0 };
  }

  seenRecently(key, ttlMs = 24 * 3600 * 1000) {
    const at = this.attempted.get(key);
    return at != null && Date.now() - at < ttlMs;
  }

  /**
   * Candidate careers surfaces for a domain, cheapest first. These are
   * CONSTRUCTED guesses; each is validated before use and a 404 costs one
   * bounded request.
   */
  candidateUrls(domain) {
    const d = registrableDomain(domain);
    if (!d) return [];
    const out = [];
    for (const sub of CAREER_SUBDOMAINS) out.push(`https://${sub}.${d}/`);
    for (const p of CAREER_PATH_HINTS.slice(0, 6)) out.push(`https://${d}${p}`);
    out.push(`https://www.${d}/`);
    return out.slice(0, this.maxProbesPerCompany);
  }

  /**
   * Given a job we already hold (typically from an aggregator), find and
   * register the ORIGINAL source for that employer.
   */
  async discoverFromJob(job) {
    const direct = (job.sourceInstances || []).find((s) => s.sourceClass === SOURCE_CLASS.ORIGINAL_ATS);
    if (direct) return { ok: true, alreadyDirect: true, reason: 'job already has an original ATS instance' };

    /* The apply URL an aggregator carries very often IS the ATS URL. */
    for (const inst of job.sourceInstances || []) {
      for (const url of [inst.applyUrl, inst.jobUrl].filter(Boolean)) {
        const det = detectAts(url);
        if (det.detected && det.provider !== PROVIDER.GENERIC && det.tenant) {
          return this.registerAts({
            provider: det.provider,
            tenant: det.tenant,
            companyName: job.company?.name || null,
            companyDomain: job.company?.domain || null,
            discoveredFrom: `job:${job.id}`,
          });
        }
      }
    }

    const domain = job.company?.domain
      || (job.company?.website ? registrableDomain(job.company.website) : null);
    if (!domain) {
      return { ok: false, reason: 'no company domain to probe', errorClass: ERROR_CLASS.PARSE_FAILED };
    }
    return this.discoverFromDomain(domain, { companyName: job.company?.name, discoveredFrom: `job:${job.id}` });
  }

  /** Probe a company domain for its careers surface and classify it. */
  async discoverFromDomain(domain, { companyName = null, discoveredFrom = null } = {}) {
    const d = registrableDomain(domain);
    if (!d) return { ok: false, reason: 'unparseable domain', errorClass: ERROR_CLASS.PARSE_FAILED };
    if (this.seenRecently(`domain:${d}`)) {
      return { ok: false, reason: 'probed recently — not rediscovering', skipped: true };
    }
    this.attempted.set(`domain:${d}`, Date.now());

    for (const url of this.candidateUrls(d)) {
      this.metrics.probed += 1;
      let page;
      try {
        /* SSRF, redirect, protocol, size and timeout guards all live in the
           client — discovery gets them for free and cannot opt out. */
        // eslint-disable-next-line no-await-in-loop
        page = await this.http.fetch(url, { maxBytes: 1024 * 1024, retries: 0 });
      } catch {
        continue;
      }

      const ats = detectAts(page.url, page.text);
      if (ats.detected && ats.provider !== PROVIDER.GENERIC && ats.tenant) {
        this.metrics.atsFound += 1;
        // eslint-disable-next-line no-await-in-loop
        return this.registerAts({
          provider: ats.provider,
          tenant: ats.tenant,
          companyName: companyName || extractMeta(page.text, page.url).siteName,
          companyDomain: d,
          careersUrl: page.url,
          discoveredFrom: discoveredFrom || `domain:${d}`,
        });
      }

      /* The careers page may only LINK to the board. */
      const links = extractAtsLinks(page.text, page.url);
      if (links.length) {
        this.metrics.atsFound += 1;
        // eslint-disable-next-line no-await-in-loop
        return this.registerAts({
          provider: links[0].provider,
          tenant: links[0].tenant,
          companyName: companyName || extractMeta(page.text, page.url).siteName,
          companyDomain: d,
          careersUrl: links[0].url,
          discoveredFrom: discoveredFrom || `domain:${d}`,
        });
      }

      if (ats.detected && this.allowGenericFallback) {
        // eslint-disable-next-line no-await-in-loop
        return this.registerGeneric({
          careersUrl: page.url,
          companyName: companyName || extractMeta(page.text, page.url).siteName,
          companyDomain: d,
          discoveredFrom: discoveredFrom || `domain:${d}`,
        });
      }
    }

    this.metrics.failed += 1;
    return { ok: false, reason: `no careers surface found for ${d}`, errorClass: ERROR_CLASS.PARSE_FAILED };
  }

  /** Register (or recognise) a direct ATS board. */
  async registerAts({ provider, tenant, companyName = null, companyDomain = null, careersUrl = null, discoveredFrom = null }) {
    if (!provider || !tenant) return { ok: false, reason: 'incomplete ats identity' };
    const existing = await this.registry.find({ provider, tenant });
    if (existing) {
      this.metrics.alreadyKnown += 1;
      return { ok: true, created: false, source: existing, reason: 'source already registered' };
    }
    const board = boardUrlFor(provider, tenant);
    const { source, created } = await this.registry.register(makeSource({
      provider,
      sourceType: SOURCE_TYPE.ATS,
      sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
      tenant,
      companyName,
      companyDomain,
      baseUrl: board,
      careersUrl: careersUrl || board,
      crawlStrategy: CRAWL_STRATEGY.API,
      accessPolicy: ACCESS_POLICY.ALLOW, // documented public board endpoint
      discoveredFrom,
    }));
    if (created) this.metrics.registered += 1; else this.metrics.alreadyKnown += 1;
    return { ok: true, created, source, reason: created ? 'registered new ATS source' : 'source already registered' };
  }

  /** Register a generic careers site for the universal crawler. */
  async registerGeneric({ careersUrl, companyName = null, companyDomain = null, discoveredFrom = null }) {
    const url = normalizeUrl(careersUrl);
    if (!url) return { ok: false, reason: 'unusable careers url' };

    let accessPolicy = ACCESS_POLICY.REVIEW;
    let crawlDelayMs = null;
    if (this.robots) {
      const check = await this.robots.check(url);
      accessPolicy = check.policy;
      crawlDelayMs = check.crawlDelayMs ?? null;
      if (check.policy === ACCESS_POLICY.DENY) {
        /* Registered as DENY so the scheduler routes around it and we can look
           for another legitimate source for the same employer (§13). */
        const denied = await this.registry.register(makeSource({
          provider: PROVIDER.GENERIC,
          sourceType: SOURCE_TYPE.CAREER_SITE,
          sourceClass: SOURCE_CLASS.ORIGINAL_CAREER_SITE,
          tenant: hostOf(url),
          companyName, companyDomain,
          baseUrl: url, careersUrl: url,
          accessPolicy: ACCESS_POLICY.DENY,
          status: 'DISABLED',
          crawlStrategy: CRAWL_STRATEGY.HTML,
          robotsPolicy: { checkedAt: new Date().toISOString(), policy: ACCESS_POLICY.DENY, crawlDelayMs },
          discoveredFrom,
        }));
        return { ok: false, created: denied.created, source: denied.source, reason: `robots denies crawling ${url}` };
      }
    }

    const { source, created } = await this.registry.register(makeSource({
      provider: PROVIDER.GENERIC,
      sourceType: SOURCE_TYPE.CAREER_SITE,
      sourceClass: SOURCE_CLASS.ORIGINAL_CAREER_SITE,
      tenant: hostOf(url),
      companyName, companyDomain,
      baseUrl: url, careersUrl: url,
      accessPolicy,
      crawlStrategy: CRAWL_STRATEGY.HTML,
      robotsPolicy: { checkedAt: new Date().toISOString(), policy: accessPolicy, crawlDelayMs },
      discoveredFrom,
    }));
    if (created) this.metrics.registered += 1; else this.metrics.alreadyKnown += 1;
    return { ok: true, created, source, reason: created ? 'registered careers site' : 'source already registered' };
  }

  /**
   * The self-expansion sweep: walk jobs that only have aggregator provenance
   * and try to find each employer's original board.
   */
  async expandFrom(jobs, { limit = 25 } = {}) {
    const results = [];
    const seenDomains = new Set();
    for (const job of jobs) {
      if (results.length >= limit) break;
      const key = job.company?.domain || job.company?.normalizedName;
      if (!key || seenDomains.has(key)) continue;
      seenDomains.add(key);
      // eslint-disable-next-line no-await-in-loop
      const r = await this.discoverFromJob(job);
      results.push({ company: job.company?.name || null, ...r, source: r.source ? { id: r.source.id, provider: r.source.provider, tenant: r.source.tenant } : null });
    }
    return { results, metrics: { ...this.metrics } };
  }

  stats() { return { ...this.metrics, negativeCacheSize: this.attempted.size }; }
}

export default SourceDiscoveryEngine;
