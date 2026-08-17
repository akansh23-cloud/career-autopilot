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

   If the configured URL is only a marketing careers landing page,
   one bounded extra step follows high-confidence "Search jobs" /
   "View open positions" listing links before giving up. This is
   deliberately NOT a general site crawler: only a few job-listing
   candidates are considered and every target goes through the same
   robots/HTTP safety gates as the original source.
   ============================================================ */

import { JobSourceAdapter } from './base.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, ERROR_CLASS, ACCESS_POLICY } from '../schema.js';
import { detectAts } from '../atsDetect.js';
import {
  extractMeta, findJobPostings, jobPostingToInput, extractEmbeddedJson,
  findJobArrays, extractJobLinks, extractSitemapUrls, isSitemapIndex, filterJobSitemapUrls,
} from '../crawler/extract.js';
import { sha256, normalizeUrl, stripHtml, registrableDomain, normalizeWhitespace } from '../normalize/text.js';

export const STAGE = Object.freeze({
  JSON_LD: 'JSON_LD',
  EMBEDDED_JSON: 'EMBEDDED_JSON',
  HTML_LINKS: 'HTML_LINKS',
  SITEMAP: 'SITEMAP',
  PUBLIC_XHR: 'PUBLIC_XHR',
  BROWSER: 'BROWSER',
});

const MAX_DETAIL_PAGES = 40;
const MAX_LISTING_PAGE_HOPS = 3;

/* A career landing page often has a CTA such as "Search for jobs" while the
   actual vacancies live one URL deeper. The old crawler treated the landing
   page as the listing and therefore returned a perfectly successful zero-job
   run for employers such as Amazon. These patterns identify only likely
   LISTING pages, not arbitrary navigation. */
const LISTING_TEXT_RE = /\b(search|find|view|browse|explore|see|show)\s+(?:for\s+)?(?:all\s+)?(?:open\s+)?(jobs?|roles?|positions?|openings?|opportunities|vacancies)\b|\b(current|open)\s+(jobs?|roles?|positions?|openings?|opportunities|vacancies)\b/i;
const LISTING_PATH_RE = /(?:^|\/)(?:search|job-search|search-jobs?|jobs?|careers?\/jobs?|careers?\/search|open-positions?|openings?|positions?|opportunities|vacancies)(?:\/|$)/i;
const SINGLE_JOB_RE = /(?:^|\/)(?:jobs?|positions?|roles?|openings?)\/[^/?#]{5,}(?:\/|$)/i;
const BAD_LISTING_TEXT_RE = /\b(sign[ -]?in|log[ -]?in|register|talent community|join our network|apply now|job alert)\b/i;

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

/**
 * Extract only high-confidence listing/search pages from a landing page.
 * Kept exportable so offline fixtures can regression-test landing -> listing
 * resolution without making a network request.
 */
export function extractListingPageLinks(html, baseUrl) {
  const found = new Map();
  for (const m of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = String(m[1] || '').trim();
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
    let abs;
    let u;
    try {
      abs = normalizeUrl(new URL(href, baseUrl).toString());
      u = new URL(abs);
    } catch { continue; }
    if (!abs || !['http:', 'https:'].includes(u.protocol)) continue;

    const label = normalizeWhitespace(stripHtml(m[2] || '')).slice(0, 180);
    const joined = `${label} ${u.pathname} ${u.search}`;
    let score = 0;
    if (LISTING_TEXT_RE.test(label)) score += 14;
    if (LISTING_PATH_RE.test(u.pathname)) score += 9;
    /* Plain /en/search and locale-prefixed equivalents are common listing
       routes even when the anchor text is only "Jobs". */
    if (/(?:^|\/)search(?:\/|$)/i.test(u.pathname)) score += 8;
    if (/jobs?\.|careers?\./i.test(u.hostname)) score += 3;
    if (sameOrigin(abs, baseUrl)) score += 2;
    if (SINGLE_JOB_RE.test(u.pathname)) score -= 18;
    if (BAD_LISTING_TEXT_RE.test(joined)) score -= 20;
    if (/\/(?:about|culture|benefits|students?|internships?|locations?|teams?)(?:\/|$)/i.test(u.pathname)) score -= 6;

    if (score < 9) continue;
    const prior = found.get(abs);
    const candidate = { url: abs, text: label, score };
    if (!prior || candidate.score > prior.score) found.set(abs, candidate);
  }
  return [...found.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
}

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

  async checkAccess(url, source = null) {
    if (!this.robots) {
      if (source?.accessPolicy === ACCESS_POLICY.ALLOW && source?.accessApproval?.policy === ACCESS_POLICY.ALLOW) {
        return { policy: ACCESS_POLICY.ALLOW, reason: 'admin-approved-review', manualApproval: true, crawlDelayMs: null };
      }
      return { policy: ACCESS_POLICY.REVIEW, reason: 'no robots policy configured' };
    }

    const live = await this.robots.check(url);
    /* Explicit robots DENY always wins. An administrator may only approve a
       source that is otherwise stuck in REVIEW because robots could not be
       established. This makes the UI's “Approve source” action real without
       turning it into a robots bypass. */
    if (live.policy === ACCESS_POLICY.DENY) return live;
    if (live.policy === ACCESS_POLICY.ALLOW) return live;
    if (source?.accessPolicy === ACCESS_POLICY.ALLOW && source?.accessApproval?.policy === ACCESS_POLICY.ALLOW) {
      return { ...live, policy: ACCESS_POLICY.ALLOW, reason: `admin-approved-review: ${live.reason || 'robots-unconfirmed'}`, manualApproval: true };
    }
    return live;
  }

  async discover(source, ctx = {}) {
    const url = source.careersUrl || source.baseUrl;
    if (!url) return { source, ok: false, reason: 'no careers url', errorClass: ERROR_CLASS.PARSE_FAILED };
    const access = await this.checkAccess(url, source);
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

    const access = await this.checkAccess(url, source);
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

    let effectivePage = page;
    let result = await this.extractFrom(page.text, page.url, source, ctx);

    /* A reachable careers page with zero extracted jobs may simply be the
       marketing shell. Follow at most three explicit listing/search CTAs and
       run the SAME extraction ladder there. This fixes stale seeded URLs without
       requiring an operator to manually discover the hidden final page first. */
    if (!(result.items || []).length) {
      const listingLinks = extractListingPageLinks(page.text, page.url).slice(0, MAX_LISTING_PAGE_HOPS);
      for (const candidate of listingLinks) {
        let listingAccess;
        try {
          // eslint-disable-next-line no-await-in-loop
          listingAccess = await this.checkAccess(candidate.url, source);
        } catch { continue; }
        if (listingAccess.policy !== ACCESS_POLICY.ALLOW) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          const listingPage = await http.fetch(candidate.url);
          if (listingPage.notModified) continue;
          // eslint-disable-next-line no-await-in-loop
          const listingResult = await this.extractFrom(listingPage.text, listingPage.url, source, ctx);
          if ((listingResult.items || []).length) {
            effectivePage = listingPage;
            result = listingResult;
            break;
          }
        } catch { /* one dead CTA must not fail the source */ }
      }
    }

    const httpMeta = {
      etag: effectivePage.etag,
      lastModified: effectivePage.lastModified,
      status: effectivePage.status,
      url: effectivePage.url,
      bytes: effectivePage.bytes,
    };
    if (result.stage) this.stageCounts[result.stage] = (this.stageCounts[result.stage] || 0) + 1;
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
