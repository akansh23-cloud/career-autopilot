/* ============================================================
   JOB DISCOVERY OS — SAFE HTTP CLIENT
   ------------------------------------------------------------
   Every outbound crawl request goes through here. It enforces:
     - SSRF validation on the initial URL AND on every redirect hop
     - manual redirect following with a hard hop cap
     - maximum response bytes (streamed, aborted on overflow)
     - request timeout
     - content-type allow policy
     - conditional requests (ETag / Last-Modified) so unchanged
       payloads are not re-downloaded (§29)
     - normalized error classification (§43)
     - per-host rate control + circuit breaking (§28)
   ============================================================ */

import { assertUrlAllowed, SsrfError } from './ssrf.js';
import { RateController, parseRetryAfter, backoffDelay } from './rateControl.js';
import { ERROR_CLASS } from '../schema.js';
import { USER_AGENT } from './robots.js';

export const DEFAULTS = Object.freeze({
  timeoutMs: 12_000,
  maxRedirects: 4,
  maxBytes: 3 * 1024 * 1024,
  maxRetries: 2,
  allowedContentTypes: [
    'text/html', 'application/xhtml+xml', 'application/json', 'text/json',
    'application/ld+json', 'text/plain', 'application/xml', 'text/xml',
    'application/rss+xml', 'application/atom+xml',
  ],
});

export class HttpError extends Error {
  constructor(message, { errorClass = ERROR_CLASS.UNKNOWN, status = null, url = null, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.errorClass = errorClass;
    this.status = status;
    this.url = url;
    this.retryAfterMs = retryAfterMs;
  }
}

export function classifyStatus(status) {
  if (status === 429) return ERROR_CLASS.RATE_LIMIT;
  if (status === 401) return ERROR_CLASS.AUTH_REQUIRED;
  if (status === 403) return ERROR_CLASS.BLOCKED;
  if (status === 408 || status === 504) return ERROR_CLASS.TIMEOUT;
  if (status >= 500) return ERROR_CLASS.NETWORK;
  return ERROR_CLASS.UNKNOWN;
}

function contentTypeAllowed(ct, allowed) {
  if (!ct) return true;
  const base = String(ct).split(';')[0].trim().toLowerCase();
  return allowed.some((a) => base === a || base.endsWith(`+${a.split('/')[1]}`));
}

async function readCapped(response, maxBytes) {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new HttpError(`Response exceeded ${maxBytes} bytes`, { errorClass: ERROR_CLASS.BLOCKED, url: response.url });
    }
    return { text, bytes: Buffer.byteLength(text) };
  }
  const reader = body.getReader();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      try { await reader.cancel(); } catch { /* already closed */ }
      throw new HttpError(`Response exceeded ${maxBytes} bytes`, { errorClass: ERROR_CLASS.BLOCKED, url: response.url });
    }
    chunks.push(Buffer.from(value));
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes };
}

export class SafeHttpClient {
  /**
   * @param opts.fetchImpl  injectable for offline tests
   * @param opts.resolver   injectable DNS resolver for SSRF tests
   */
  constructor({
    fetchImpl = globalThis.fetch,
    resolver = undefined,
    rateController = null,
    userAgent = USER_AGENT,
    allowPrivateHosts = false,
    ...rest
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.resolver = resolver;
    this.userAgent = userAgent;
    this.allowPrivateHosts = allowPrivateHosts;
    this.opts = { ...DEFAULTS, ...rest };
    this.rate = rateController || new RateController();
    this.metrics = {
      attempts: 0, ok: 0, notModified: 0, failures: 0, rateLimited: 0,
      ssrfBlocked: 0, bytes: 0, redirects: 0,
    };
  }

  /**
   * @returns {{ ok, status, url, text, headers, etag, lastModified, contentType,
   *             bytes, notModified, redirects }}
   */
  async fetch(rawUrl, {
    method = 'GET', headers = {}, etag = null, lastModified = null,
    timeoutMs = this.opts.timeoutMs, maxBytes = this.opts.maxBytes,
    maxRedirects = this.opts.maxRedirects, allowedContentTypes = this.opts.allowedContentTypes,
    retries = this.opts.maxRetries, accept = null, body = null,
  } = {}) {
    let currentUrl = String(rawUrl);
    let hops = 0;
    let attempt = 0;

    for (;;) {
      const validated = await this.assertAllowed(currentUrl);
      const host = validated.hostname;
      this.metrics.attempts += 1;

      let response;
      try {
        // eslint-disable-next-line no-await-in-loop
        response = await this.rate.schedule(host, () => this.rawFetch(currentUrl, {
          method, headers, etag, lastModified, timeoutMs, accept, body,
        }));
      } catch (e) {
        this.metrics.failures += 1;
        this.rate.noteFailure(host);
        const cls = e?.name === 'AbortError' ? ERROR_CLASS.TIMEOUT : (e?.errorClass || ERROR_CLASS.NETWORK);
        if (attempt < retries && (cls === ERROR_CLASS.NETWORK || cls === ERROR_CLASS.TIMEOUT)) {
          attempt += 1;
          // eslint-disable-next-line no-await-in-loop
          await this.rate.sleep(backoffDelay(attempt, { jitter: this.rate.jitter }));
          continue;
        }
        throw new HttpError(e?.message || 'network failure', { errorClass: cls, url: currentUrl });
      }

      const status = response.status;

      if (status === 304) {
        this.metrics.notModified += 1;
        this.rate.noteSuccess(host);
        return {
          ok: true, notModified: true, status, url: currentUrl, text: null,
          headers: response.headers, etag: response.headers?.get?.('etag') ?? etag,
          lastModified: response.headers?.get?.('last-modified') ?? lastModified,
          contentType: response.headers?.get?.('content-type') ?? null, bytes: 0, redirects: hops,
        };
      }

      if (status >= 300 && status < 400) {
        const location = response.headers?.get?.('location');
        if (!location) throw new HttpError(`Redirect ${status} without Location`, { errorClass: ERROR_CLASS.PARSE_FAILED, status, url: currentUrl });
        hops += 1;
        this.metrics.redirects += 1;
        if (hops > maxRedirects) {
          throw new HttpError(`Too many redirects (${hops})`, { errorClass: ERROR_CLASS.BLOCKED, status, url: currentUrl });
        }
        /* Public -> private is re-validated here, never trusted. */
        currentUrl = new URL(location, currentUrl).toString();
        etag = null; lastModified = null;
        continue;
      }

      if (status === 429 || status === 503) {
        const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
        this.metrics.rateLimited += 1;
        this.rate.noteRateLimited(host, retryAfterMs);
        if (attempt < retries) {
          attempt += 1;
          // eslint-disable-next-line no-await-in-loop
          await this.rate.sleep(retryAfterMs ?? backoffDelay(attempt, { jitter: this.rate.jitter }));
          continue;
        }
        throw new HttpError(`Rate limited (${status})`, { errorClass: ERROR_CLASS.RATE_LIMIT, status, url: currentUrl, retryAfterMs });
      }

      if (status < 200 || status >= 400) {
        this.metrics.failures += 1;
        this.rate.noteFailure(host);
        throw new HttpError(`HTTP ${status}`, { errorClass: classifyStatus(status), status, url: currentUrl });
      }

      const contentType = response.headers?.get?.('content-type') ?? null;
      if (!contentTypeAllowed(contentType, allowedContentTypes)) {
        throw new HttpError(`Content-Type not permitted: ${contentType}`, { errorClass: ERROR_CLASS.BLOCKED, status, url: currentUrl });
      }

      const declared = Number(response.headers?.get?.('content-length') || 0);
      if (declared && declared > maxBytes) {
        throw new HttpError(`Declared size ${declared} exceeds cap`, { errorClass: ERROR_CLASS.BLOCKED, status, url: currentUrl });
      }

      const { text, bytes } = await readCapped(response, maxBytes);
      this.metrics.ok += 1;
      this.metrics.bytes += bytes;
      this.rate.noteSuccess(host);
      return {
        ok: true, notModified: false, status, url: currentUrl, text,
        headers: response.headers,
        etag: response.headers?.get?.('etag') ?? null,
        lastModified: response.headers?.get?.('last-modified') ?? null,
        contentType, bytes, redirects: hops,
      };
    }
  }

  async assertAllowed(url) {
    try {
      return await assertUrlAllowed(url, { resolver: this.resolver, allowPrivate: this.allowPrivateHosts });
    } catch (e) {
      if (e instanceof SsrfError) {
        /* DNS unavailability is an operational/network failure, not evidence
           that the target attempted to reach a private address. Keeping these
           distinct prevents healthy public sources from being misreported as
           SSRF attacks during resolver outages. */
        if (e.code === 'DNS_FAILED' || e.code === 'DNS_EMPTY') {
          this.metrics.failures += 1;
          throw new HttpError(e.message, { errorClass: ERROR_CLASS.NETWORK, url });
        }
        this.metrics.ssrfBlocked += 1;
        throw new HttpError(e.message, { errorClass: ERROR_CLASS.SSRF_BLOCKED, url });
      }
      throw e;
    }
  }

  async rawFetch(url, { method, headers, etag, lastModified, timeoutMs, accept, body = null }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const h = {
      'User-Agent': this.userAgent,
      Accept: accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      ...headers,
    };
    if (etag) h['If-None-Match'] = etag;
    if (lastModified) h['If-Modified-Since'] = lastModified;
    /* A POST body is only ever a SEARCH payload for a public board endpoint
       (Workday's cxs/jobs is POST-only). Every SSRF, redirect, size, content-type
       and rate guard above applies identically — a body changes nothing about
       what this client is allowed to reach. */
    let payload;
    if (body != null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!h['Content-Type']) h['Content-Type'] = 'application/json';
    }
    try {
      return await this.fetchImpl(url, {
        method, headers: h, redirect: 'manual', signal: controller.signal,
        ...(payload != null ? { body: payload } : {}),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchJson(url, opts = {}) {
    const r = await this.fetch(url, { accept: 'application/json', ...opts });
    if (r.notModified) return { ...r, json: null };
    try {
      return { ...r, json: r.text ? JSON.parse(r.text) : null };
    } catch (e) {
      throw new HttpError(`Invalid JSON from ${url}`, { errorClass: ERROR_CLASS.PARSE_FAILED, url, status: r.status });
    }
  }

  async fetchText(url, opts = {}) {
    const r = await this.fetch(url, opts);
    return r.text || '';
  }

  stats() { return { ...this.metrics, rate: this.rate.stats() }; }
}

export default { SafeHttpClient, HttpError, classifyStatus, DEFAULTS };
