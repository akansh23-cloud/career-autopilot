/* ============================================================
   iCIMS ADAPTER
   ------------------------------------------------------------
   iCIMS publishes each employer's openings on a public career
   portal at {tenant}.icims.com. There is no unauthenticated JSON
   listing API, so this adapter reads the PUBLIC portal the same
   way any visitor's browser does:

       1. schema.org JobPosting structured data, when the portal
          publishes it (preferred — it is machine-readable by design)
       2. otherwise the portal's own job links, followed to bounded
          detail pages that carry the structured data

   Paging uses the portal's own `pr` parameter. Nothing here works
   around a login, a CAPTCHA or an access control; a portal that
   refuses anonymous access is recorded as AUTH_REQUIRED and the
   source is left alone.

   Because a keyword-less portal search is not guaranteed to be a
   complete listing, this adapter is NEVER authoritative: absence
   from a response may not close a job.
   ============================================================ */

import { JobSourceAdapter } from './base.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, ERROR_CLASS } from '../schema.js';
import { detectAts, boardUrlFor } from '../atsDetect.js';
import { findJobPostings, jobPostingToInput, extractJobLinks } from '../crawler/extract.js';
import { sha256, normalizeUrl } from '../normalize/text.js';

const MAX_PAGES = 10;
const MAX_DETAIL_PER_RUN = 30;

export class ICIMSAdapter extends JobSourceAdapter {
  static provider = PROVIDER.ICIMS;
  static sourceType = SOURCE_TYPE.ATS;
  static sourceClass = SOURCE_CLASS.ORIGINAL_ATS;

  constructor(ctx = {}) {
    super(ctx);
    this.maxDetailPerRun = ctx.icimsMaxDetail ?? MAX_DETAIL_PER_RUN;
    this.detailBudget = 0;
  }

  identify(urlOrSource, html = '') {
    const url = typeof urlOrSource === 'string' ? urlOrSource : (urlOrSource?.careersUrl || urlOrSource?.baseUrl || '');
    const det = detectAts(url, html);
    return { ...det, matches: det.provider === PROVIDER.ICIMS };
  }

  configurationStatus() {
    return {
      status: 'ACTIVE',
      configured: true,
      mode: 'HTML_JSONLD',
      reason: 'public career portal structured data; no credentials required',
    };
  }

  portalUrl(tenant, page = 0) {
    const base = `https://${encodeURIComponent(tenant)}.icims.com/jobs/search?ss=1&searchRelation=keyword_all`;
    return page ? `${base}&pr=${page}` : base;
  }

  async discover(source, ctx = {}) {
    const http = ctx.http || this.http;
    if (!source.tenant) return { source, ok: false, reason: 'no icims tenant', errorClass: ERROR_CLASS.PARSE_FAILED };
    try {
      const r = await http.fetch(this.portalUrl(source.tenant), { maxBytes: 1024 * 1024 });
      const nodes = findJobPostings(r.text);
      const links = extractJobLinks(r.text, r.url);
      const board = boardUrlFor(PROVIDER.ICIMS, source.tenant);
      return {
        source: { ...source, baseUrl: source.baseUrl || board, careersUrl: source.careersUrl || board },
        ok: true,
        reason: `icims portal reachable (${nodes.length} structured postings, ${links.length} job links)`,
        jobCount: nodes.length || links.length,
      };
    } catch (e) {
      return { source, ok: false, reason: e?.message, errorClass: e?.errorClass || ERROR_CLASS.NETWORK };
    }
  }

  async fetchJobs(source, cursor = null, ctx = {}) {
    const http = ctx.http || this.http;
    if (!http) return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.NOT_CONFIGURED, message: 'no http client' } };
    if (!source.tenant) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.PARSE_FAILED, message: 'no icims tenant' } };
    }

    const page = Number(cursor?.page ?? 0);
    if (!page) this.detailBudget = this.maxDetailPerRun;

    let r;
    try {
      r = await http.fetch(this.portalUrl(source.tenant, page), {
        etag: page ? null : (source.http?.etag || null),
        maxBytes: 2 * 1024 * 1024,
      });
    } catch (e) {
      return {
        items: [], nextCursor: null, authoritative: false,
        error: { errorClass: e?.errorClass || ERROR_CLASS.NETWORK, message: e?.message },
      };
    }
    if (r.notModified) {
      return { items: [], nextCursor: null, authoritative: false, notModified: true, http: { etag: r.etag, status: 304 } };
    }

    const items = [];
    for (const node of findJobPostings(r.text)) items.push({ __jsonLd: node, __pageUrl: r.url });

    /* Portals that only render links: follow a BOUNDED number of detail pages
       for their structured data. This is a page budget, not a crawl of the
       whole portal, and it never grows with the size of the board. */
    if (!items.length) {
      const links = extractJobLinks(r.text, r.url)
        .filter((u) => /\/jobs\//i.test(u))
        .slice(0, this.detailBudget);
      for (const url of links) {
        if (this.detailBudget <= 0) break;
        this.detailBudget -= 1;
        try {
          // eslint-disable-next-line no-await-in-loop
          const d = await http.fetch(url, { maxBytes: 1024 * 1024, retries: 0 });
          for (const node of findJobPostings(d.text)) items.push({ __jsonLd: node, __pageUrl: d.url });
        } catch {
          /* One unreachable detail page is not a source failure. */
        }
      }
    }

    const hasMore = items.length > 0 && page + 1 < MAX_PAGES;
    return {
      items,
      nextCursor: hasMore ? { page: page + 1 } : null,
      /* A portal search is not a guaranteed-complete listing, so absence from
         it is never evidence of closure. */
      authoritative: false,
      stage: 'JSON_LD',
      http: { etag: r.etag, lastModified: r.lastModified, status: r.status, url: r.url, bytes: r.bytes },
    };
  }

  normalize(raw, source) {
    const input = jobPostingToInput(raw.__jsonLd, { pageUrl: raw.__pageUrl });
    return {
      ...input,
      company: {
        name: source.companyName || input.company?.name || source.tenant || null,
        website: source.companyWebsite || input.company?.website || null,
        domain: source.companyDomain || null,
        logoUrl: input.company?.logoUrl ?? null,
      },
      jobUrl: normalizeUrl(input.jobUrl || raw.__pageUrl),
      extraction: 'ICIMS_JSON_LD',
      rawHash: sha256(JSON.stringify(raw.__jsonLd)),
    };
  }
}

export default ICIMSAdapter;
