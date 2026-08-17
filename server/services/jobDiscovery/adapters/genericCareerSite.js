/* ============================================================
   UNIVERSAL CAREER-SITE CRAWLER ADAPTER
   ------------------------------------------------------------
   Generic career-page ingestion with two additional guarantees:

   1. Marketing/root pages are allowed to resolve to an explicit jobs listing.
   2. Recognised public listing pages (currently Google Careers and Amazon Jobs)
      are paginated with durable cursors instead of treating page one as the
      complete vacancy inventory.

   No private endpoint discovery and no auth bypass is introduced here. Every
   request still passes the same robots/access and SSRF-safe HTTP layer.
   ============================================================ */

import { JobSourceAdapter } from './base.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, ERROR_CLASS, ACCESS_POLICY } from '../schema.js';
import { detectAts } from '../atsDetect.js';
import {
  extractMeta, findJobPostings, jobPostingToInput, extractEmbeddedJson,
  findJobArrays, extractJobLinks, extractSitemapUrls, isSitemapIndex, filterJobSitemapUrls,
} from '../crawler/extract.js';
import {
  sha256, normalizeUrl, stripHtml, registrableDomain, normalizeWhitespace,
} from '../normalize/text.js';

export const STAGE = Object.freeze({
  JSON_LD: 'JSON_LD',
  EMBEDDED_JSON: 'EMBEDDED_JSON',
  LISTING_CARDS: 'LISTING_CARDS',
  HTML_LINKS: 'HTML_LINKS',
  SITEMAP: 'SITEMAP',
  PUBLIC_XHR: 'PUBLIC_XHR',
  BROWSER: 'BROWSER',
});

const MAX_DETAIL_PAGES = 40;
const MAX_LISTING_PAGE_HOPS = 3;
const AMAZON_RESULT_LIMIT = 50;

const LISTING_TEXT_RE = /\b(search|find|view|browse|explore|see|show)\s+(?:for\s+)?(?:all\s+)?(?:open\s+)?(jobs?|roles?|positions?|openings?|opportunities|vacancies)\b|\b(current|open)\s+(jobs?|roles?|positions?|openings?|opportunities|vacancies)\b/i;
const LISTING_PATH_RE = /(?:^|\/)(?:search|job-search|search-jobs?|jobs?|careers?\/jobs?|careers?\/search|open-positions?|openings?|positions?|opportunities|vacancies)(?:\/|$)/i;
const SINGLE_JOB_RE = /(?:^|\/)(?:jobs?|positions?|roles?|openings?)\/[^/?#]{5,}(?:\/|$)/i;
const BAD_LISTING_TEXT_RE = /\b(sign[ -]?in|log[ -]?in|register|talent community|join our network|apply now|job alert)\b/i;
const GENERIC_ANCHOR_TEXT_RE = /^(learn more|read more|view|details?|apply|apply now|share|open|job details?)$/i;

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

function isGoogleCareersUrl(value) {
  try {
    const u = new URL(value);
    return (u.hostname === 'www.google.com' || u.hostname === 'google.com' || u.hostname === 'careers.google.com')
      && (/\/about\/careers\/applications\/jobs\/results/i.test(u.pathname) || /\/jobs\/?$/i.test(u.pathname));
  } catch { return false; }
}

function isGoogleListingUrl(value) {
  try {
    const u = new URL(value);
    return (u.hostname === 'www.google.com' || u.hostname === 'google.com')
      && /^\/about\/careers\/applications\/jobs\/results\/?$/i.test(u.pathname);
  } catch { return false; }
}

function isAmazonJobsUrl(value) {
  try {
    const u = new URL(value);
    return /(^|\.)amazon\.jobs$/i.test(u.hostname);
  } catch { return false; }
}

function isAmazonSearchUrl(value) {
  try {
    const u = new URL(value);
    return /(^|\.)amazon\.jobs$/i.test(u.hostname) && /^\/[a-z]{2}(?:-[A-Z]{2})?\/search\/?$/i.test(u.pathname);
  } catch { return false; }
}

export function canonicalListingUrl(value, cursor = null) {
  let raw = cursor?.url || value;
  if (!raw) return null;

  try {
    const u = new URL(raw);
    if (u.hostname === 'careers.google.com' || (isGoogleCareersUrl(raw) && !isGoogleListingUrl(raw))) {
      raw = 'https://www.google.com/about/careers/applications/jobs/results/';
    }

    if (isAmazonJobsUrl(raw)) {
      const a = new URL(raw);
      if (!/\/[a-z]{2}(?:-[A-Z]{2})?\/search\/?$/i.test(a.pathname)) {
        const locale = (a.pathname.match(/^\/([a-z]{2}(?:-[A-Z]{2})?)(?:\/|$)/) || [])[1] || 'en';
        a.pathname = `/${locale}/search`;
      }
      if (!a.searchParams.has('base_query')) a.searchParams.set('base_query', '');
      if (!a.searchParams.has('loc_query')) a.searchParams.set('loc_query', '');
      if (!a.searchParams.has('result_limit')) a.searchParams.set('result_limit', String(cursor?.limit || AMAZON_RESULT_LIMIT));
      a.searchParams.set('offset', String(cursor?.offset ?? Number(a.searchParams.get('offset') || 0)));
      raw = a.toString();
    }

    if (isGoogleListingUrl(raw)) {
      const g = new URL(raw);
      const page = cursor?.page ?? Number(g.searchParams.get('page') || 1);
      g.searchParams.set('page', String(Math.max(1, page)));
      raw = g.toString();
    }

    return normalizeUrl(raw) || raw;
  } catch {
    return normalizeUrl(raw);
  }
}

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

function titleFromSlug(slug) {
  const text = normalizeWhitespace(String(slug || '').replace(/[-_]+/g, ' '));
  if (!text) return null;
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function extractRecognizedListingCards(html, pageUrl) {
  let site = null;
  if (isGoogleListingUrl(pageUrl)) site = 'google';
  else if (isAmazonSearchUrl(pageUrl)) site = 'amazon';
  if (!site) return [];

  const out = new Map();
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of String(html || '').matchAll(anchorRe)) {
    let abs;
    try { abs = normalizeUrl(new URL(m[1], pageUrl).toString()); } catch { continue; }
    if (!abs) continue;

    let jobId = null;
    let slug = null;
    if (site === 'google') {
      const mm = new URL(abs).pathname.match(/\/about\/careers\/applications\/jobs\/results\/(\d+)-([^/?#]+)/i);
      if (!mm) continue;
      [, jobId, slug] = mm;
    } else {
      const mm = new URL(abs).pathname.match(/\/[a-z]{2}(?:-[A-Z]{2})?\/jobs\/(\d+)\/([^/?#]+)/i);
      if (!mm) continue;
      [, jobId, slug] = mm;
    }

    let label = normalizeWhitespace(stripHtml(m[2] || '')).replace(/\s+/g, ' ').trim();
    if (!label || GENERIC_ANCHOR_TEXT_RE.test(label) || label.length < 3) label = titleFromSlug(slug);
    if (!label) continue;

    const start = Math.max(0, (m.index || 0) - 500);
    const end = Math.min(String(html || '').length, (m.index || 0) + m[0].length + 900);
    const context = normalizeWhitespace(stripHtml(String(html || '').slice(start, end))).slice(0, 1600);

    out.set(`${site}:${jobId}`, {
      __kind: 'listing-card',
      site,
      sourceJobId: jobId,
      title: label,
      jobUrl: abs,
      context,
    });
  }
  return [...out.values()];
}

function parseGooglePageWindow(html) {
  const text = normalizeWhitespace(stripHtml(html));
  const m = text.match(/Showing\s+(\d+)\s+to\s+(\d+)\s+of\s+([\d,]+)\s+rows/i)
    || text.match(/(\d+)\s*[\-–‑]\s*(\d+)\s+of\s+([\d,]+)/i);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), total: Number(String(m[3]).replace(/,/g, '')) };
}

export function listingCursorFor(html, pageUrl, itemCount = 0) {
  if (isGoogleListingUrl(pageUrl)) {
    const win = parseGooglePageWindow(html);
    if (!win || !Number.isFinite(win.total) || win.total <= 0 || win.end >= win.total) return null;
    const u = new URL(pageUrl);
    const current = Math.max(1, Number(u.searchParams.get('page') || 1));
    u.searchParams.delete('page');
    return { kind: 'SITE_LISTING', site: 'google', url: u.toString(), page: current + 1, total: win.total };
  }

  if (isAmazonSearchUrl(pageUrl)) {
    if (!itemCount) return null;
    const u = new URL(pageUrl);
    const offset = Math.max(0, Number(u.searchParams.get('offset') || 0));
    const requestedLimit = Math.max(1, Number(u.searchParams.get('result_limit') || AMAZON_RESULT_LIMIT));
    const text = normalizeWhitespace(stripHtml(html));
    const hasMoreSignal = /Load more jobs/i.test(text) || itemCount >= requestedLimit;
    if (!hasMoreSignal) return null;
    u.searchParams.delete('offset');
    return {
      kind: 'SITE_LISTING', site: 'amazon', url: u.toString(),
      offset: offset + itemCount, limit: requestedLimit,
    };
  }

  return null;
}

function explicitLocationFromContext(raw) {
  const text = String(raw || '');
  const amazon = text.match(/(?:^|\s)([^|]{2,120}?)\s*\|\s*Job ID\s*:/i);
  if (amazon) return normalizeWhitespace(amazon[1]).replace(/^.*?Results listed\s*/i, '').trim();
  return null;
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
    if (live.policy === ACCESS_POLICY.DENY) return live;
    if (live.policy === ACCESS_POLICY.ALLOW) return live;
    if (source?.accessPolicy === ACCESS_POLICY.ALLOW && source?.accessApproval?.policy === ACCESS_POLICY.ALLOW) {
      return { ...live, policy: ACCESS_POLICY.ALLOW, reason: `admin-approved-review: ${live.reason || 'robots-unconfirmed'}`, manualApproval: true };
    }
    return live;
  }

  async discover(source, ctx = {}) {
    const initial = source.careersUrl || source.baseUrl;
    const url = canonicalListingUrl(initial) || initial;
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
        redirectToProvider: ats.provider !== PROVIDER.GENERIC && ats.tenant ? { provider: ats.provider, tenant: ats.tenant } : null,
        reason: ats.provider !== PROVIDER.GENERIC ? `careers page is powered by ${ats.provider}` : 'generic careers page reachable',
      };
    } catch (e) {
      return { source, ok: false, reason: e?.message, errorClass: e?.errorClass || ERROR_CLASS.NETWORK };
    }
  }

  async fetchJobs(source, cursor = null, ctx = {}) {
    const http = ctx.http || this.http;
    const initial = source.careersUrl || source.baseUrl;
    const requestUrl = canonicalListingUrl(initial, cursor) || initial;
    if (!requestUrl) return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.PARSE_FAILED, message: 'no careers url' } };

    const access = await this.checkAccess(requestUrl, source);
    if (access.policy !== ACCESS_POLICY.ALLOW) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: access.policy === ACCESS_POLICY.DENY ? ERROR_CLASS.ROBOTS_DENIED : ERROR_CLASS.BLOCKED, message: access.policy === ACCESS_POLICY.DENY ? access.reason : `crawl policy requires review: ${access.reason || 'robots policy not confirmed'}` } };
    }

    let page;
    try {
      page = await http.fetch(requestUrl, cursor ? {} : { etag: source.http?.etag || null, lastModified: source.http?.lastModified || null });
    } catch (e) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: e?.errorClass || ERROR_CLASS.NETWORK, message: e?.message } };
    }
    if (page.notModified) return { items: [], nextCursor: null, authoritative: false, notModified: true, http: { etag: page.etag, status: 304 } };

    let effectivePage = page;
    let result = await this.extractFrom(page.text, page.url, source, ctx);

    if (!(result.items || []).length && !cursor) {
      const listingLinks = extractListingPageLinks(page.text, page.url).slice(0, MAX_LISTING_PAGE_HOPS);
      for (const candidate of listingLinks) {
        const candidateUrl = canonicalListingUrl(candidate.url) || candidate.url;
        let listingAccess;
        try { listingAccess = await this.checkAccess(candidateUrl, source); } catch { continue; }
        if (listingAccess.policy !== ACCESS_POLICY.ALLOW) continue;
        try {
          const listingPage = await http.fetch(candidateUrl);
          if (listingPage.notModified) continue;
          const listingResult = await this.extractFrom(listingPage.text, listingPage.url, source, ctx);
          if ((listingResult.items || []).length) {
            effectivePage = listingPage;
            result = listingResult;
            break;
          }
        } catch { /* one dead CTA must not fail the source */ }
      }
    }

    const nextCursor = listingCursorFor(effectivePage.text, effectivePage.url, (result.items || []).length);
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
      nextCursor,
      authoritative: false,
      stage: result.stage,
      http: httpMeta,
    };
  }

  async extractFrom(html, pageUrl, source = {}, ctx = {}) {
    const http = ctx.http || this.http;

    const postings = findJobPostings(html);
    if (postings.length) return { stage: STAGE.JSON_LD, items: postings.map((n) => ({ __kind: 'jsonld', node: n, pageUrl })) };

    for (const block of extractEmbeddedJson(html)) {
      const arrays = findJobArrays(block.data);
      if (arrays.length && arrays[0].jobs.length) {
        return { stage: STAGE.EMBEDDED_JSON, items: arrays[0].jobs.map((j) => ({ __kind: 'embedded', node: j, pageUrl, embedKey: block.key })) };
      }
    }

    const listingCards = extractRecognizedListingCards(html, pageUrl);
    if (listingCards.length) return { stage: STAGE.LISTING_CARDS, items: listingCards };

    const links = extractJobLinks(html, pageUrl);
    if (links.length) {
      const items = await this.fetchDetailPages(links.slice(0, this.maxDetailPages), http);
      if (items.length) return { stage: STAGE.HTML_LINKS, items };
    }

    const sitemaps = source.sitemaps?.length ? source.sitemaps : [];
    if (sitemaps.length && http) {
      for (const sm of sitemaps.slice(0, 3)) {
        try {
          const xml = await http.fetchText(sm, { accept: 'application/xml' });
          let urls = extractSitemapUrls(xml);
          if (isSitemapIndex(xml)) {
            const child = urls.find((u) => /job|career|vacan/i.test(u));
            if (child) urls = extractSitemapUrls(await http.fetchText(child, { accept: 'application/xml' }));
          }
          const jobUrls = filterJobSitemapUrls(urls).slice(0, this.maxDetailPages);
          if (jobUrls.length) {
            const items = await this.fetchDetailPages(jobUrls.map((u) => ({ url: u })), http);
            if (items.length) return { stage: STAGE.SITEMAP, items };
          }
        } catch { /* try next sitemap */ }
      }
    }

    const xhr = this.findPublicJobEndpoint(html, pageUrl);
    if (xhr && http) {
      try {
        const r = await http.fetchJson(xhr);
        const arrays = findJobArrays(r.json);
        if (arrays.length && arrays[0].jobs.length) {
          return { stage: STAGE.PUBLIC_XHR, items: arrays[0].jobs.map((j) => ({ __kind: 'embedded', node: j, pageUrl, endpoint: xhr })) };
        }
      } catch { /* fall through to browser */ }
    }

    if (this.browserPool && await this.browserPool.probe()) {
      try {
        const rendered = await this.browserPool.render(pageUrl);
        const renderedPostings = findJobPostings(rendered.html);
        if (renderedPostings.length) return { stage: STAGE.BROWSER, items: renderedPostings.map((n) => ({ __kind: 'jsonld', node: n, pageUrl: rendered.url })) };
        for (const block of extractEmbeddedJson(rendered.html)) {
          const arrays = findJobArrays(block.data);
          if (arrays.length && arrays[0].jobs.length) return { stage: STAGE.BROWSER, items: arrays[0].jobs.map((j) => ({ __kind: 'embedded', node: j, pageUrl: rendered.url })) };
        }
        const cards = extractRecognizedListingCards(rendered.html, rendered.url);
        if (cards.length) return { stage: STAGE.BROWSER, items: cards };
        const renderedLinks = extractJobLinks(rendered.html, rendered.url);
        if (renderedLinks.length) {
          const items = await this.fetchDetailPages(renderedLinks.slice(0, this.maxDetailPages), http);
          if (items.length) return { stage: STAGE.BROWSER, items };
        }
      } catch { /* browser failed; never fabricate */ }
    }

    return { stage: null, items: [] };
  }

  async fetchDetailPages(links, http) {
    if (!http) return [];
    const out = [];
    for (const link of links) {
      try {
        const r = await http.fetch(link.url);
        const nodes = findJobPostings(r.text);
        if (nodes.length) {
          out.push({ __kind: 'jsonld', node: nodes[0], pageUrl: r.url });
          continue;
        }
        const meta = extractMeta(r.text, r.url);
        if (meta.title) out.push({ __kind: 'meta', meta, pageUrl: r.url, linkText: link.text || null, html: r.text });
      } catch { /* one bad posting must not fail the source */ }
    }
    return out;
  }

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

    if (raw.__kind === 'listing-card') {
      const location = raw.site === 'amazon' ? explicitLocationFromContext(raw.context) : null;
      return {
        sourceJobId: raw.sourceJobId || raw.jobUrl,
        requisitionId: raw.sourceJobId || null,
        title: raw.title || null,
        company: {
          name: source.companyName || (raw.site === 'google' ? 'Google' : raw.site === 'amazon' ? 'Amazon' : null),
          website: source.baseUrl || null,
          domain: source.companyDomain || null,
          logoUrl: null,
        },
        descriptionHtml: null,
        descriptionText: raw.context || null,
        locationsRaw: location ? [location] : [],
        applicantRegions: [],
        explicitRemote: null,
        workplaceHint: null,
        employmentTypeRaw: null,
        department: null,
        jobUrl: raw.jobUrl,
        applyUrl: raw.jobUrl,
        sourcePublishedAt: null,
        validThrough: null,
        compensationStructured: null,
        compensationRaw: null,
        tags: [],
        extraction: 'LISTING_CARD',
        rawHash: sha256(`${raw.site}:${raw.sourceJobId}:${raw.title}:${raw.jobUrl}`),
      };
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
        sourcePublishedAt: n.publishedAt || n.published_on || n.datePosted || n.createdAt || null,
        validThrough: null,
        compensationStructured: null,
        compensationRaw: typeof n.salary === 'string' ? n.salary : null,
        tags: [],
        extraction: 'EMBEDDED_JSON',
        rawHash: sha256(JSON.stringify(n)),
      };
    }

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
      sourcePublishedAt: null,
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
