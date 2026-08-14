/* ============================================================
   JOB DISCOVERY OS — SPEC-DRIVEN ADAPTER
   ------------------------------------------------------------
   Most ATS boards differ only in four ways:

       where the public list lives
       how it paginates
       where the array of postings sits in the response
       what the fields are called

   Everything else — conditional requests, error classification,
   authoritative-listing semantics, the NormalizedJobInput contract,
   verification, raw hashing — is IDENTICAL. Writing twenty
   near-copies of the same 150-line adapter would multiply the
   surface area on which a provider change can silently corrupt
   the index.

   So a provider is DECLARED (providerSpecs.js) and this one class
   executes the declaration. Adding a board is a spec, not a
   rewrite, and every provider inherits the same guarantees.

   HARD RULES CARRIED THROUGH EVERY SPEC:
     - PUBLIC endpoints only. No private, internal, partner or
       authenticated API is called. A provider whose only listing
       endpoint requires credentials reports NOT_CONFIGURED and is
       skipped by the scheduler — never faked, never scraped around.
     - `authoritative` is per-spec and load-bearing: it declares
       whether ABSENCE from a successful response is evidence a job
       closed. A paginated search endpoint that we did not read to
       the end is NOT authoritative.
     - unknown stays null. No spec may invent a posting date, a
       salary or a remote classification the board did not state.
   ============================================================ */

import { JobSourceAdapter } from '../base.js';
import { ERROR_CLASS, SOURCE_STATUS } from '../../schema.js';
import { detectAts, boardUrlFor } from '../../atsDetect.js';
import { stripHtml, sha256, normalizeUrl } from '../../normalize/text.js';
import { findJobPostings, jobPostingToInput, extractJobLinks } from '../../crawler/extract.js';

export const SPEC_STRATEGY = Object.freeze({
  JSON: 'JSON',              // public JSON listing endpoint
  JSON_POST: 'JSON_POST',    // public listing endpoint that requires a POST search body
  XML: 'XML',                // public XML feed
  HTML_JSONLD: 'HTML_JSONLD', // public board page carrying schema.org JobPosting
});

/** Read a dotted path out of a parsed response. Returns [] when absent. */
export function pluck(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur == null) return null;
    cur = cur[part];
  }
  return cur;
}

export function pluckArray(obj, path) {
  const v = pluck(obj, path);
  return Array.isArray(v) ? v : [];
}

/* ------------------------------------------------------------------
   Minimal XML element reader.
   Deliberately NOT a general XML parser: it extracts repeated elements
   and their direct child text, which is all a job feed needs, with no
   entity expansion and therefore no XXE surface.
   ------------------------------------------------------------------ */
export function parseXmlItems(xml, itemTag) {
  const out = [];
  const re = new RegExp(`<${itemTag}\\b[^>]*>([\\s\\S]*?)</${itemTag}>`, 'gi');
  for (const m of String(xml || '').matchAll(re)) {
    const body = m[1];
    const item = {};
    for (const f of body.matchAll(/<([a-zA-Z0-9_:-]+)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      const key = f[1].replace(/^.*:/, '');
      const value = decodeXmlText(f[2]);
      if (item[key] == null) item[key] = value;
      else if (Array.isArray(item[key])) item[key].push(value);
      else item[key] = [item[key], value];
    }
    out.push(item);
  }
  return out;
}

function decodeXmlText(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
    .trim();
}

export class SpecAdapter extends JobSourceAdapter {
  /**
   * Subclasses are generated per provider so `static provider` stays a real
   * class field — the adapter registry keys on it.
   */
  constructor(ctx = {}, spec = null) {
    super(ctx);
    this.spec = spec || this.constructor.spec;
    this.credentials = ctx.credentials?.[this.spec.provider] || null;
  }

  get provider() { return this.spec.provider; }

  identify(urlOrSource, html = '') {
    const url = typeof urlOrSource === 'string'
      ? urlOrSource
      : (urlOrSource?.careersUrl || urlOrSource?.baseUrl || '');
    const det = detectAts(url, html);
    return { ...det, matches: det.provider === this.spec.provider };
  }

  /**
   * Truthful configuration status. A spec that needs a token the deployment
   * has not supplied says so HERE, and the scheduler skips it — the alternative
   * (silently returning zero jobs) looks identical to a healthy empty board.
   */
  configurationStatus() {
    if (!this.spec.requiresCredentials) {
      return {
        status: SOURCE_STATUS.ACTIVE,
        configured: true,
        mode: this.spec.strategy,
        reason: this.spec.access || 'public board endpoint; no credentials required',
      };
    }
    const ok = !!(this.credentials && (this.credentials.token || this.credentials.endpoint));
    return {
      status: ok ? SOURCE_STATUS.ACTIVE : SOURCE_STATUS.NOT_CONFIGURED,
      configured: ok,
      mode: this.spec.strategy,
      reason: ok
        ? 'credentials supplied by deployment'
        : `${this.spec.provider} publishes no unauthenticated listing endpoint; supply ${this.spec.credentialHint || 'a board token'} to enable ingestion`,
    };
  }

  boardUrl(tenant) { return boardUrlFor(this.spec.provider, tenant); }

  async discover(source, ctx = {}) {
    const cfg = this.configurationStatus();
    if (!cfg.configured) {
      return { source, ok: false, reason: cfg.reason, errorClass: ERROR_CLASS.NOT_CONFIGURED };
    }
    if (!source.tenant) {
      return { source, ok: false, reason: `no ${this.spec.provider} tenant`, errorClass: ERROR_CLASS.PARSE_FAILED };
    }
    try {
      const batch = await this.fetchJobs(source, null, ctx);
      if (batch.error) return { source, ok: false, reason: batch.error.message, errorClass: batch.error.errorClass };
      const board = this.boardUrl(source.tenant);
      return {
        source: { ...source, baseUrl: source.baseUrl || board, careersUrl: source.careersUrl || board },
        ok: true,
        reason: `${this.spec.provider} board reachable, ${batch.items.length} listed jobs`,
        jobCount: batch.items.length,
      };
    } catch (e) {
      return { source, ok: false, reason: e?.message, errorClass: e?.errorClass || ERROR_CLASS.NETWORK };
    }
  }

  async fetchJobs(source, cursor = null, ctx = {}) {
    const cfg = this.configurationStatus();
    if (!cfg.configured) {
      return { items: [], nextCursor: null, authoritative: false, notConfigured: true, error: { errorClass: ERROR_CLASS.NOT_CONFIGURED, message: cfg.reason } };
    }
    const http = ctx.http || this.http;
    if (!http) return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.NOT_CONFIGURED, message: 'no http client' } };
    if (!source.tenant) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.PARSE_FAILED, message: `no ${this.spec.provider} tenant` } };
    }

    const page = Number(cursor?.page ?? 0);
    const offset = Number(cursor?.offset ?? 0);
    const url = this.spec.listUrl({ source, page, offset, credentials: this.credentials });

    try {
      switch (this.spec.strategy) {
        case SPEC_STRATEGY.JSON: return await this.fetchJsonList({ http, source, url, page, offset });
        case SPEC_STRATEGY.JSON_POST: return await this.fetchJsonList({ http, source, url, page, offset, post: true });
        case SPEC_STRATEGY.XML: return await this.fetchXmlList({ http, source, url });
        case SPEC_STRATEGY.HTML_JSONLD: return await this.fetchHtmlList({ http, source, url, page });
        default:
          return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.NOT_CONFIGURED, message: `unknown strategy ${this.spec.strategy}` } };
      }
    } catch (e) {
      return {
        items: [], nextCursor: null, authoritative: false,
        error: { errorClass: e?.errorClass || ERROR_CLASS.NETWORK, message: e?.message || String(e) },
      };
    }
  }

  async fetchJsonList({ http, source, url, page, offset, post = false }) {
    const opts = {
      etag: page || offset ? null : (source.http?.etag || null),
      lastModified: page || offset ? null : (source.http?.lastModified || null),
    };
    if (post) {
      opts.method = 'POST';
      opts.body = this.spec.body ? this.spec.body({ source, page, offset }) : {};
    }
    if (this.spec.headers) opts.headers = this.spec.headers({ source, credentials: this.credentials });

    const r = await http.fetchJson(url, opts);
    if (r.notModified) {
      return { items: [], nextCursor: null, authoritative: false, notModified: true, http: { etag: r.etag, lastModified: r.lastModified, status: 304 } };
    }

    /* pluckArray() coerces a missing path to [], which is exactly the wrong
       answer here: an "empty" AUTHORITATIVE listing is licence to close every
       job on the board. A missing path is a SCHEMA CHANGE and must be
       distinguishable from a board that genuinely has no openings. */
    const raw = this.spec.items ? this.spec.items(r.json) : pluck(r.json, this.spec.itemsPath);
    const items = Array.isArray(raw) ? raw : null;
    if (!items) {
      /* A shape we no longer recognise is a SCHEMA CHANGE, not an empty board.
         Classifying it correctly is what stops self-healing from deleting jobs. */
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.SCHEMA_CHANGED, message: `${this.spec.provider}: listing array not found at ${this.spec.itemsPath}` } };
    }

    const nextCursor = this.nextCursor({ json: r.json, items, page, offset });
    return {
      items,
      nextCursor,
      /* Absence is only evidence when the WHOLE board came back. A paginated
         board becomes authoritative on the final page and not before. */
      authoritative: this.spec.authoritative !== false && !nextCursor,
      stage: this.spec.strategy,
      http: { etag: r.etag, lastModified: r.lastModified, status: r.status, url: r.url, bytes: r.bytes },
    };
  }

  async fetchXmlList({ http, source, url }) {
    const r = await http.fetch(url, {
      etag: source.http?.etag || null,
      lastModified: source.http?.lastModified || null,
      accept: 'application/xml,text/xml,application/rss+xml',
      allowedContentTypes: ['application/xml', 'text/xml', 'application/rss+xml', 'text/plain', 'application/atom+xml'],
    });
    if (r.notModified) {
      return { items: [], nextCursor: null, authoritative: false, notModified: true, http: { etag: r.etag, status: 304 } };
    }
    const items = parseXmlItems(r.text, this.spec.itemTag);
    if (!items.length && /<\w/.test(String(r.text || ''))) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.SCHEMA_CHANGED, message: `${this.spec.provider}: no <${this.spec.itemTag}> elements in feed` } };
    }
    return {
      items,
      nextCursor: null,
      authoritative: this.spec.authoritative !== false,
      stage: SPEC_STRATEGY.XML,
      http: { etag: r.etag, lastModified: r.lastModified, status: r.status, url: r.url, bytes: r.bytes },
    };
  }

  /**
   * Public board page carrying schema.org JobPosting. This is the SAME
   * structured-data path the universal crawler uses — no private endpoint is
   * reverse-engineered, and if a board stops publishing JSON-LD the result is a
   * classified PARSE failure rather than invented jobs.
   */
  async fetchHtmlList({ http, source, url, page }) {
    const r = await http.fetch(url, {
      etag: page ? null : (source.http?.etag || null),
      lastModified: page ? null : (source.http?.lastModified || null),
    });
    if (r.notModified) {
      return { items: [], nextCursor: null, authoritative: false, notModified: true, http: { etag: r.etag, status: 304 } };
    }
    const nodes = findJobPostings(r.text);
    if (nodes.length) {
      return {
        items: nodes.map((node) => ({ __jsonLd: node, __pageUrl: r.url })),
        nextCursor: null,
        authoritative: this.spec.authoritative !== false,
        stage: 'JSON_LD',
        http: { etag: r.etag, lastModified: r.lastModified, status: r.status, url: r.url, bytes: r.bytes },
      };
    }
    /* No structured data on the index page: surface the posting links so the
       registry records a real, actionable reason instead of "0 jobs". */
    const links = extractJobLinks(r.text, r.url).slice(0, 100);
    return {
      items: [],
      nextCursor: null,
      authoritative: false,
      stage: 'HTML_LINKS',
      error: links.length
        ? { errorClass: ERROR_CLASS.PARSE_FAILED, message: `${this.spec.provider}: board page exposed ${links.length} job links but no JobPosting structured data` }
        : { errorClass: ERROR_CLASS.SCHEMA_CHANGED, message: `${this.spec.provider}: no structured job data on board page` },
      http: { status: r.status, url: r.url, bytes: r.bytes },
    };
  }

  nextCursor({ json, items, page, offset }) {
    const p = this.spec.pagination;
    if (!p || p.kind === 'none') return null;
    if (!items.length) return null;
    const size = p.size || items.length;
    if (items.length < size) return null;
    if (p.kind === 'page') {
      const nextPage = page + 1;
      return nextPage >= (p.maxPages ?? 50) ? null : { page: nextPage };
    }
    if (p.kind === 'offset') {
      const total = p.totalPath ? Number(pluck(json, p.totalPath)) : null;
      const nextOffset = offset + size;
      if (Number.isFinite(total) && nextOffset >= total) return null;
      return nextOffset >= (p.maxOffset ?? 5000) ? null : { offset: nextOffset };
    }
    return null;
  }

  normalize(raw, source) {
    /* JSON-LD boards route through the shared schema.org mapper so one
       structured-data bug is fixed in one place for every provider. */
    if (raw && raw.__jsonLd) {
      const input = jobPostingToInput(raw.__jsonLd, { pageUrl: raw.__pageUrl });
      return {
        ...input,
        company: {
          name: source.companyName || input.company?.name || source.tenant || null,
          website: source.companyWebsite || input.company?.website || null,
          domain: source.companyDomain || null,
          logoUrl: input.company?.logoUrl ?? null,
        },
        extraction: `${this.spec.provider}_JSON_LD`,
        rawHash: sha256(JSON.stringify(raw.__jsonLd)),
      };
    }

    const mapped = this.spec.map(raw, source, { stripHtml, normalizeUrl });
    return {
      sourceJobId: mapped.sourceJobId ?? null,
      requisitionId: mapped.requisitionId ?? null,
      title: mapped.title ?? null,
      company: {
        name: source.companyName || mapped.companyName || source.tenant || null,
        website: source.companyWebsite || null,
        domain: source.companyDomain || null,
        logoUrl: null,
      },
      descriptionHtml: mapped.descriptionHtml ?? null,
      descriptionText: mapped.descriptionText ?? (mapped.descriptionHtml ? stripHtml(mapped.descriptionHtml) : null),
      locationsRaw: mapped.locationsRaw ?? [],
      applicantRegions: mapped.applicantRegions ?? [],
      explicitRemote: mapped.explicitRemote ?? null,
      workplaceHint: mapped.workplaceHint ?? null,
      employmentTypeRaw: mapped.employmentTypeRaw ?? null,
      department: mapped.department ?? null,
      jobUrl: mapped.jobUrl ?? null,
      applyUrl: mapped.applyUrl ?? mapped.jobUrl ?? null,
      sourcePublishedAt: mapped.sourcePublishedAt ?? null,
      validThrough: mapped.validThrough ?? null,
      compensationStructured: mapped.compensationStructured ?? null,
      compensationRaw: mapped.compensationRaw ?? null,
      tags: mapped.tags ?? [],
      extraction: `${this.spec.provider}_${this.spec.strategy}`,
      rawHash: sha256(JSON.stringify(raw)),
    };
  }
}

/** Build a concrete adapter class for one spec. */
export function adapterFromSpec(spec) {
  const cls = class extends SpecAdapter {
    static provider = spec.provider;
    static sourceType = spec.sourceType;
    static sourceClass = spec.sourceClass;
    static requiresCredentials = spec.requiresCredentials === true;
    static spec = spec;

    constructor(ctx = {}) { super(ctx, spec); }
  };
  Object.defineProperty(cls, 'name', { value: `${spec.provider}Adapter` });
  return cls;
}

export default { SpecAdapter, adapterFromSpec, SPEC_STRATEGY, pluck, pluckArray, parseXmlItems };
