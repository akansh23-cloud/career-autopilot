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
import {
  DISCOVERY_KIND, leadsFromJob, leadsFromPage,
} from './discoveryQueue.js';
import { extractSitemapUrls, filterJobSitemapUrls, isSitemapIndex } from './crawler/extract.js';

const CAREER_SUBDOMAINS = ['careers', 'jobs', 'work', 'hiring'];

export class SourceDiscoveryEngine {
  constructor({
    http, registry, adapters, robots = null, logger = console,
    queue = null, companies = null,
    maxProbesPerCompany = 8, allowGenericFallback = true,
  }) {
    this.http = http;
    this.registry = registry;
    this.adapters = adapters;
    this.robots = robots;
    this.logger = logger;
    /* The durable queue and the company registry are what turn discovery from a
       repeating sweep into work that COMPOUNDS: every resolved company is one we
       never have to probe again, and every dead lead stays dead. */
    this.queue = queue;
    this.companies = companies;
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

  /* ------------------------------------------------------------------
     Queue-driven discovery.
     ------------------------------------------------------------------ */

  /** Turn a job with no direct provenance into durable discovery leads. */
  async seedFromJob(job) {
    if (!this.queue) return { created: 0, deduped: 0, submitted: 0 };
    const leads = leadsFromJob(job, { detectAts });
    return this.queue.enqueueMany(leads);
  }

  /** Seed from an explicit company/domain, e.g. an admin action or an import. */
  async seedFromDomain(domain, { companyName = null, discoveredFrom = 'manual' } = {}) {
    if (!this.queue) return { created: 0, deduped: 0, submitted: 0 };
    const d = registrableDomain(domain);
    if (!d) return { created: 0, deduped: 0, submitted: 0 };
    return this.queue.enqueueMany([{
      kind: DISCOVERY_KIND.COMPANY_DOMAIN,
      value: d,
      payload: { companyName, companyDomain: d },
      confidence: 0.75,
      priority: 70,
      discoveredFrom,
    }]);
  }

  /**
   * Execute one leased discovery task. Never throws: the queue needs a verdict
   * for every task, and an exception here would strand a lease.
   */
  async processTask(task) {
    try {
      switch (task.kind) {
        case DISCOVERY_KIND.ATS_LINK: return await this.processAtsLink(task);
        case DISCOVERY_KIND.COMPANY_DOMAIN: return await this.processDomain(task);
        case DISCOVERY_KIND.CAREERS_URL: return await this.processCareersUrl(task);
        case DISCOVERY_KIND.SITEMAP: return await this.processSitemap(task);
        case DISCOVERY_KIND.JOB_BACKFILL:
          /* Nothing actionable yet. Exhaust it politely rather than probing the
             internet on the strength of a company name alone. */
          await this.queue?.fail(task, { errorClass: ERROR_CLASS.PARSE_FAILED, reason: 'no domain or ATS link available for this employer yet' });
          return { ok: false, taskId: task.id, kind: task.kind, reason: 'no actionable identity' };
        default:
          await this.queue?.fail(task, { errorClass: ERROR_CLASS.UNKNOWN, reason: `unknown task kind ${task.kind}` });
          return { ok: false, taskId: task.id, reason: `unknown task kind ${task.kind}` };
      }
    } catch (e) {
      await this.queue?.fail(task, { errorClass: e?.errorClass || ERROR_CLASS.UNKNOWN, reason: e?.message });
      return { ok: false, taskId: task.id, kind: task.kind, reason: e?.message || String(e) };
    }
  }

  async processAtsLink(task) {
    const { provider, tenant } = task.payload || {};
    const r = await this.registerAts({
      provider, tenant,
      companyName: task.payload?.companyName ?? null,
      companyDomain: task.payload?.companyDomain ?? null,
      careersUrl: task.payload?.careersUrl ?? null,
      discoveredFrom: task.discoveredFrom,
    });
    if (r.ok) {
      await this.recordCompany(task, r, { provider, tenant });
      await this.queue?.resolve(task, { sourceId: r.source?.id ?? null, reason: r.reason });
    } else {
      await this.queue?.fail(task, { errorClass: ERROR_CLASS.PARSE_FAILED, reason: r.reason });
    }
    return { ok: r.ok, taskId: task.id, kind: task.kind, created: r.created, source: sourceBrief(r.source), reason: r.reason };
  }

  async processDomain(task) {
    const domain = String(task.key).split(':').slice(1).join(':');

    /* Ask what we already know BEFORE touching the network. This is the whole
       economic argument for the company registry. */
    if (this.companies) {
      const hint = await this.companies.discoveryHint({ domain, name: task.payload?.companyName });
      if (hint.skipProbe) {
        await this.queue?.resolve(task, { sourceId: hint.company?.sourceIds?.[0] ?? null, companyId: hint.company?.id ?? null, reason: hint.reason });
        return { ok: true, taskId: task.id, kind: task.kind, skipped: true, reason: hint.reason };
      }
    }

    const r = await this.discoverFromDomain(domain, {
      companyName: task.payload?.companyName ?? null,
      discoveredFrom: task.discoveredFrom,
    });
    if (r.ok) {
      await this.recordCompany(task, r, { domain });
      await this.queue?.resolve(task, { sourceId: r.source?.id ?? null, reason: r.reason });
    } else {
      await this.companies?.recordDiscovery({ domain, name: task.payload?.companyName, outcome: r.reason });
      await this.queue?.fail(task, { errorClass: r.errorClass || ERROR_CLASS.PARSE_FAILED, reason: r.reason });
    }
    return { ok: r.ok, taskId: task.id, kind: task.kind, created: r.created, source: sourceBrief(r.source), reason: r.reason };
  }

  async processCareersUrl(task) {
    const url = normalizeUrl(task.payload?.careersUrl || String(task.key).split(':').slice(1).join(':'));
    if (!url) {
      await this.queue?.fail(task, { errorClass: ERROR_CLASS.PARSE_FAILED, reason: 'unusable careers url' });
      return { ok: false, taskId: task.id, kind: task.kind, reason: 'unusable careers url' };
    }
    let page;
    try {
      page = await this.http.fetch(url, { maxBytes: 1024 * 1024, retries: 0 });
    } catch (e) {
      await this.queue?.fail(task, { errorClass: e?.errorClass || ERROR_CLASS.NETWORK, reason: e?.message });
      return { ok: false, taskId: task.id, kind: task.kind, reason: e?.message };
    }

    /* A careers page is also a source of NEW leads — boards it links to, and
       further careers pages. Feed them back into the queue. */
    if (this.queue) {
      await this.queue.enqueueMany(leadsFromPage(page.text, page.url, {
        extractAtsLinks, careerHints: CAREER_PATH_HINTS,
      }));
    }

    const ats = detectAts(page.url, page.text);
    if (ats.detected && ats.provider !== PROVIDER.GENERIC && ats.tenant) {
      const r = await this.registerAts({
        provider: ats.provider, tenant: ats.tenant,
        companyName: task.payload?.companyName ?? extractMeta(page.text, page.url).siteName,
        companyDomain: task.payload?.companyDomain ?? registrableDomain(page.url),
        careersUrl: page.url,
        discoveredFrom: task.discoveredFrom,
      });
      if (r.ok) {
        await this.recordCompany(task, r, { provider: ats.provider, tenant: ats.tenant, domain: registrableDomain(page.url) });
        await this.queue?.resolve(task, { sourceId: r.source?.id ?? null, reason: r.reason });
      } else {
        await this.queue?.fail(task, { errorClass: ERROR_CLASS.PARSE_FAILED, reason: r.reason });
      }
      return { ok: r.ok, taskId: task.id, kind: task.kind, source: sourceBrief(r.source), reason: r.reason };
    }

    const g = await this.registerGeneric({
      careersUrl: page.url,
      companyName: task.payload?.companyName ?? extractMeta(page.text, page.url).siteName,
      companyDomain: task.payload?.companyDomain ?? registrableDomain(page.url),
      discoveredFrom: task.discoveredFrom,
    });
    if (g.ok) {
      await this.recordCompany(task, g, { domain: registrableDomain(page.url) });
      await this.queue?.resolve(task, { sourceId: g.source?.id ?? null, reason: g.reason });
    } else {
      /* robots DENY is permanent — the queue marks it DEAD and stops asking. */
      await this.queue?.fail(task, {
        errorClass: /robots/i.test(g.reason || '') ? ERROR_CLASS.ROBOTS_DENIED : ERROR_CLASS.PARSE_FAILED,
        reason: g.reason,
      });
    }
    return { ok: g.ok, taskId: task.id, kind: task.kind, source: sourceBrief(g.source), reason: g.reason };
  }

  /** Sitemaps are the cheapest bulk source of career-page leads a site offers. */
  async processSitemap(task) {
    const url = normalizeUrl(task.payload?.sitemapUrl || String(task.key).split(':').slice(1).join(':'));
    if (!url) {
      await this.queue?.fail(task, { errorClass: ERROR_CLASS.PARSE_FAILED, reason: 'unusable sitemap url' });
      return { ok: false, taskId: task.id, kind: task.kind, reason: 'unusable sitemap url' };
    }
    let page;
    try {
      page = await this.http.fetch(url, {
        maxBytes: 4 * 1024 * 1024,
        retries: 0,
        accept: 'application/xml,text/xml',
        allowedContentTypes: ['application/xml', 'text/xml', 'text/plain', 'application/rss+xml'],
      });
    } catch (e) {
      await this.queue?.fail(task, { errorClass: e?.errorClass || ERROR_CLASS.NETWORK, reason: e?.message });
      return { ok: false, taskId: task.id, kind: task.kind, reason: e?.message };
    }

    const urls = extractSitemapUrls(page.text);
    const leads = [];
    if (isSitemapIndex(page.text)) {
      /* A sitemap index: queue the child sitemaps that look job-related, and
         only those — following every sitemap on a large site is a crawl we have
         no business running. */
      for (const child of filterJobSitemapUrls(urls).slice(0, 20)) {
        leads.push({
          kind: DISCOVERY_KIND.SITEMAP, value: child, payload: { sitemapUrl: child },
          confidence: 0.5, priority: 40, discoveredFrom: task.discoveredFrom,
        });
      }
    } else {
      for (const jobUrl of filterJobSitemapUrls(urls).slice(0, 50)) {
        leads.push({
          kind: DISCOVERY_KIND.CAREERS_URL, value: jobUrl, payload: { careersUrl: jobUrl },
          confidence: 0.4, priority: 25, discoveredFrom: task.discoveredFrom,
        });
      }
    }
    const seeded = this.queue ? await this.queue.enqueueMany(leads) : { created: 0 };
    await this.queue?.resolve(task, { reason: `sitemap yielded ${seeded.created} new leads` });
    return { ok: true, taskId: task.id, kind: task.kind, seeded: seeded.created, reason: `sitemap yielded ${seeded.created} new leads` };
  }

  async recordCompany(task, result, { provider = null, tenant = null, domain = null } = {}) {
    if (!this.companies) return null;
    const source = result.source || null;
    return this.companies.upsert({
      name: task.payload?.companyName ?? source?.companyName ?? null,
      domain: domain || task.payload?.companyDomain || source?.companyDomain || null,
      careersUrl: source?.careersUrl ?? null,
      atsProvider: provider || source?.provider || null,
      atsTenant: tenant || source?.tenant || null,
      sourceIds: source?.id ? [source.id] : [],
    }, { source: `discovery:${task.kind}`, confidence: task.confidence ?? 0.6 });
  }

  stats() { return { ...this.metrics, negativeCacheSize: this.attempted.size }; }
}

function sourceBrief(source) {
  if (!source) return null;
  return { id: source.id, provider: source.provider, tenant: source.tenant };
}

export default SourceDiscoveryEngine;
