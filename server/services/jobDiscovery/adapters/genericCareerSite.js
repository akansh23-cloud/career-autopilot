/* ============================================================
   UNIVERSAL CAREER-SITE CRAWLER ADAPTER  (§9)
   ------------------------------------------------------------
   For companies outside a supported ATS. Extraction runs cheap ->
   expensive and STOPS at the first stage that yields real jobs:

     1  HTTP fetch
     2  canonical / meta inspection
     3  JSON-LD  @type=JobPosting
     4  embedded framework JSON (__NEXT_DATA__, Nuxt, page state)
     5  HTML job links -> per-posting JSON-LD
     6  sitemap / XML
     7  public XHR endpoints the page itself exposes
     8  Playwright render  <- LAST, and bounded

   A browser is never launched for a source an earlier stage
   already answered. The stage that succeeded is recorded so the
   browser-fallback percentage in §51 is a measured number.
   ============================================================ */

import { JobSourceAdapter } from './base.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, ERROR_CLASS, ACCESS_POLICY } from '../schema.js';
import { detectAts } from '../atsDetect.js';
import {
  extractMeta, findJobPostings, jobPostingToInput, extractEmbeddedJson,
  findJobArrays, extractJobLinks, extractSitemapUrls, isSitemapIndex, filterJobSitemapUrls,
} from '../crawler/extract.js';
import { sha256, normalizeUrl, stripHtml, registrableDomain } from '../normalize/text.js';

export const STAGE = Object.freeze({
  JSON_LD: 'JSON_LD',
  EMBEDDED_JSON: 'EMBEDDED_JSON',
  HTML_LINKS: 'HTML_LINKS',
  SITEMAP: 'SITEMAP',
  PUBLIC_XHR: 'PUBLIC_XHR',
  BROWSER: 'BROWSER',
});

const MAX_DETAIL_PAGES = 40;

export class GenericCareerSiteAdapter extends JobSourceAdapter {
  static provider = PROVIDER.GENERIC;
  static sourceType = SOURCE_TYPE.CAREER_SITE;
  static sourceClass = SOURCE_CLASS.ORIGINAL_CAREER_SITE;

  constructor(ctx = {}) {
    super(ctx);
    this.robots = ctx.robots || null;
    this.browserPool = ctx.browserPool || null;
    this.maxDetailPages = ctx.maxDetailPages ?? MAX_DETAIL_PAGES;
    this.stageCounts = {};
  }

  identify(urlOrSource, html = '') {
    const det = detectAts(typeof urlOrSource === 'string' ? urlOrSource : (urlOrSource?.careersUrl || urlOrSource?.baseUrl || ''), html);
    return { ...det, matches: det.provider === PROVIDER.GENERIC };
  }

  async checkAccess(url) {
    if (!this.robots) return { policy: ACCESS_POLICY.REVIEW, reason: 'no robots policy configured' };
    return this.robots.check(url);
  }

  async discover(source, ctx = {}) {
    const url = source.careersUrl || source.baseUrl;
    if (!url) return { source, ok: false, reason: 'no careers url', errorClass: ERROR_CLASS.PARSE_FAILED };
    const access = await this.checkAccess(url);
    if (access.policy !== ACCESS_POLICY.ALLOW) {
      return { source: { ...source, accessPolicy: access.policy }, ok: false, reason: access.policy === ACCESS_POLICY.DENY ? `robots denied: ${access.reason}` : `crawl policy requires review: ${access.reason || 'robots policy not confirmed'}`, errorClass: access.policy === ACCESS_POLICY.DENY ? ERROR_CLASS.ROBOTS_DENIED : ERROR_CLASS.BLOCKED };
    }
    const http = ctx.http || this.http;
    try {
      const r = await http.fetch(url);
      const meta = extractMeta(r.text, r.url);
      const ats = detectAts(r.url, r.text);
      return {
        source: {
          ...source,
          accessPolicy: access.policy,
          companyName: source.companyName || meta.siteName || null,
          companyDomain: source.companyDomain || registrableDomain(r.url),
          detectedProvider: ats.provider,
          detectedTenant: ats.tenant,
          crawlDelayMs: access.crawlDelayMs ?? null,
          sitemaps: access.sitemaps || [],
        },
        ok: true,
        /* When the page reveals a real ATS, source discovery should register
           THAT instead — direct-source coverage beats generic crawling. */
        redirectToProvider: ats.provider !== PROVIDER.GENERIC && ats.tenant
          ? { provider: ats.provider, tenant: ats.tenant }
          : null,
        reason: ats.provider !== PROVIDER.GENERIC ? `careers page is powered by ${ats.provider}` : 'generic careers page reachable',
      };
    } catch (e) {
      return { source, ok: false, reason: e?.message, errorClass: e?.errorClass || ERROR_CLASS.NETWORK };
    }
  }

  async fetchJobs(source, cursor = null, ctx = {}) {
    const http = ctx.http || this.http;
    const url = source.careersUrl || source.baseUrl;
    if (!url) return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.PARSE_FAILED, message: 'no careers url' } };

    const access = await this.checkAccess(url);
    if (access.policy !== ACCESS_POLICY.ALLOW) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: access.policy === ACCESS_POLICY.DENY ? ERROR_CLASS.ROBOTS_DENIED : ERROR_CLASS.BLOCKED, message: access.policy === ACCESS_POLICY.DENY ? access.reason : `crawl policy requires review: ${access.reason || 'robots policy not confirmed'}` } };
    }

    let page;
    try {
      page = await http.fetch(url, { etag: source.http?.etag || null, lastModified: source.http?.lastModified || null });
    } catch (e) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: e?.errorClass || ERROR_CLASS.NETWORK, message: e?.message } };
    }
    if (page.notModified) {
      return { items: [], nextCursor: null, authoritative: false, notModified: true, http: { etag: page.etag, status: 304 } };
    }

    const httpMeta = { etag: page.etag, lastModified: page.lastModified, status: page.status, url: page.url, bytes: page.bytes };
    const result = await this.extractFrom(page.text, page.url, source, ctx);
    this.stageCounts[result.stage] = (this.stageCounts[result.stage] || 0) + 1;
    return {
      items: result.items,
      nextCursor: null,
      /* A generic scrape is NEVER authoritative: we cannot prove the page shows
         the complete vacancy list, so absence must not close a job (§22.1). */
      authoritative: false,
      stage: result.stage,
      http: httpMeta,
    };
  }

  /** Runs the ladder against already-fetched HTML. Exposed for offline tests. */
  async extractFrom(html, pageUrl, source = {}, ctx = {}) {
    const http = ctx.http || this.http;

    /* 3 — JSON-LD on the listing page itself. */
    const postings = findJobPostings(html);
    if (postings.length) {
      return { stage: STAGE.JSON_LD, items: postings.map((n) => ({ __kind: 'jsonld', node: n, pageUrl })) };
    }

    /* 4 — embedded framework JSON. */
    for (const block of extractEmbeddedJson(html)) {
      const arrays = findJobArrays(block.data);
      if (arrays.length && arrays[0].jobs.length) {
        return {
          stage: STAGE.EMBEDDED_JSON,
          items: arrays[0].jobs.map((j) => ({ __kind: 'embedded', node: j, pageUrl, embedKey: block.key })),
        };
      }
    }

    /* 5 — HTML job links, then per-posting JSON-LD on each detail page. */
    const links = extractJobLinks(html, pageUrl);
    if (links.length) {
      const items = await this.fetchDetailPages(links.slice(0, this.maxDetailPages), http, pageUrl);
      if (items.length) return { stage: STAGE.HTML_LINKS, items };
    }

    /* 6 — sitemap. */
    const sitemaps = source.sitemaps?.length ? source.sitemaps : [];
    if (sitemaps.length && http) {
      for (const sm of sitemaps.slice(0, 3)) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const xml = await http.fetchText(sm, { accept: 'application/xml' });
          let urls = extractSitemapUrls(xml);
          if (isSitemapIndex(xml)) {
            const child = urls.find((u) => /job|career|vacan/i.test(u));
            if (child) {
              // eslint-disable-next-line no-await-in-loop
              urls = extractSitemapUrls(await http.fetchText(child, { accept: 'application/xml' }));
            }
          }
          const jobUrls = filterJobSitemapUrls(urls).slice(0, this.maxDetailPages);
          if (jobUrls.length) {
            // eslint-disable-next-line no-await-in-loop
            const items = await this.fetchDetailPages(jobUrls.map((u) => ({ url: u })), http, pageUrl);
            if (items.length) return { stage: STAGE.SITEMAP, items };
          }
        } catch { /* try next sitemap */ }
      }
    }

    /* 7 — public XHR endpoint the page itself calls, unauthenticated only. */
    const xhr = this.findPublicJobEndpoint(html, pageUrl);
    if (xhr && http) {
      try {
        const r = await http.fetchJson(xhr);
        const arrays = findJobArrays(r.json);
        if (arrays.length && arrays[0].jobs.length) {
          return {
            stage: STAGE.PUBLIC_XHR,
            items: arrays[0].jobs.map((j) => ({ __kind: 'embedded', node: j, pageUrl, endpoint: xhr })),
          };
        }
      } catch { /* fall through to browser */ }
    }

    /* 8 — browser render. Bounded, and skipped entirely when unavailable. */
    if (this.browserPool && await this.browserPool.probe()) {
      try {
        const rendered = await this.browserPool.render(pageUrl);
        const renderedPostings = findJobPostings(rendered.html);
        if (renderedPostings.length) {
          return { stage: STAGE.BROWSER, items: renderedPostings.map((n) => ({ __kind: 'jsonld', node: n, pageUrl: rendered.url })) };
        }
        for (const block of extractEmbeddedJson(rendered.html)) {
          const arrays = findJobArrays(block.data);
          if (arrays.length && arrays[0].jobs.length) {
            return { stage: STAGE.BROWSER, items: arrays[0].jobs.map((j) => ({ __kind: 'embedded', node: j, pageUrl: rendered.url })) };
          }
        }
        const renderedLinks = extractJobLinks(rendered.html, rendered.url);
        if (renderedLinks.length) {
          const items = await this.fetchDetailPages(renderedLinks.slice(0, this.maxDetailPages), http, rendered.url);
          if (items.length) return { stage: STAGE.BROWSER, items };
        }
      } catch { /* browser genuinely failed — report nothing rather than guess */ }
    }

    return { stage: null, items: [] };
  }

  async fetchDetailPages(links, http, baseUrl) {
    if (!http) return [];
    const out = [];
    for (const link of links) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await http.fetch(link.url);
        const nodes = findJobPostings(r.text);
        if (nodes.length) {
          out.push({ __kind: 'jsonld', node: nodes[0], pageUrl: r.url });
          continue;
        }
        const meta = extractMeta(r.text, r.url);
        if (meta.title) {
          out.push({ __kind: 'meta', meta, pageUrl: r.url, linkText: link.text || null, html: r.text });
        }
      } catch { /* one bad posting page must not fail the source */ }
    }
    return out;
  }

  /** Only endpoints the public page itself references. No credential discovery. */
  findPublicJobEndpoint(html, baseUrl) {
    const patterns = [
      /["'](\/[^"']*api[^"']*(?:jobs?|positions?|openings?|vacanc)[^"']*)["']/i,
      /["'](https?:\/\/[^"']*\/api\/[^"']*(?:jobs?|positions?|openings?)[^"']*)["']/i,
    ];
    for (const re of patterns) {
      const m = String(html || '').match(re);
      if (m) {
        try { return normalizeUrl(new URL(m[1], baseUrl).toString()); } catch { /* skip */ }
      }
    }
    return null;
  }

  normalize(raw, source) {
    if (raw.__kind === 'jsonld') {
      const input = jobPostingToInput(raw.node, { pageUrl: raw.pageUrl });
      return { ...input, extraction: 'JSON_LD', rawHash: sha256(JSON.stringify(raw.node)) };
    }

    if (raw.__kind === 'embedded') {
      const n = raw.node || {};
      const title = n.title || n.jobTitle || n.name || n.text || null;
      const jobUrl = n.absolute_url || n.hostedUrl || n.jobUrl || n.url || n.applyUrl || raw.pageUrl || null;
      const locationsRaw = [
        typeof n.location === 'string' ? n.location : (n.location?.name || n.location?.city || null),
        n.city, n.office, n.locationName,
      ].filter(Boolean);
      const html = n.descriptionHtml || n.content || n.description || null;
      return {
        sourceJobId: n.id != null ? String(n.id) : (n.shortcode ? String(n.shortcode) : (jobUrl || null)),
        requisitionId: n.requisitionId != null ? String(n.requisitionId) : null,
        title,
        company: {
          name: source.companyName || n.companyName || n.company?.name || null,
          website: source.baseUrl || null,
          domain: source.companyDomain || null,
          logoUrl: null,
        },
        descriptionHtml: typeof html === 'string' ? html : null,
        descriptionText: typeof html === 'string' ? stripHtml(html) : null,
        locationsRaw,
        applicantRegions: [],
        explicitRemote: typeof n.isRemote === 'boolean' ? n.isRemote : (typeof n.remote === 'boolean' ? n.remote : null),
        workplaceHint: n.workplaceType || n.workplace || null,
        employmentTypeRaw: n.employmentType || n.type || n.commitment || null,
        department: n.department || n.team || null,
        jobUrl,
        applyUrl: n.applyUrl || n.application_url || jobUrl,
        /* Only a field that genuinely means "published". An `updatedAt` is not
           promoted to a posting date. */
        sourcePublishedAt: n.publishedAt || n.published_on || n.datePosted || n.createdAt || null,
        validThrough: null,
        compensationStructured: null,
        compensationRaw: typeof n.salary === 'string' ? n.salary : null,
        tags: [],
        extraction: 'EMBEDDED_JSON',
        rawHash: sha256(JSON.stringify(n)),
      };
    }

    /* meta-only detail page: title + description, nothing invented. */
    const meta = raw.meta || {};
    return {
      sourceJobId: raw.pageUrl || null,
      requisitionId: null,
      title: meta.ogTitle || meta.title || raw.linkText || null,
      company: {
        name: source.companyName || meta.siteName || null,
        website: source.baseUrl || null,
        domain: source.companyDomain || null,
        logoUrl: null,
      },
      descriptionHtml: null,
      descriptionText: meta.description || null,
      locationsRaw: [],
      applicantRegions: [],
      explicitRemote: null,
      workplaceHint: null,
      employmentTypeRaw: null,
      department: null,
      jobUrl: meta.canonical || raw.pageUrl || null,
      applyUrl: meta.canonical || raw.pageUrl || null,
      sourcePublishedAt: null, // the page stated none
      validThrough: null,
      compensationStructured: null,
      compensationRaw: null,
      tags: [],
      extraction: 'HTML_META',
      rawHash: sha256(String(raw.pageUrl || '') + String(meta.title || '')),
    };
  }

  stats() { return { stageCounts: { ...this.stageCounts } }; }
}

export default GenericCareerSiteAdapter;
