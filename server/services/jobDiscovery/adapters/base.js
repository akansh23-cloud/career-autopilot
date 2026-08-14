/* ============================================================
   JOB DISCOVERY OS — JobSourceAdapter INTERFACE  (§6)
   ------------------------------------------------------------
   Every provider implements the SAME five operations and emits
   the SAME NormalizedJobInput contract. Provider-shaped objects
   never leave normalize().

       identify(urlOrSource)   -> { provider, tenant, confidence }
       discover(source, ctx)   -> { source, ok, reason }
       fetchJobs(source, cur)  -> { items, nextCursor, authoritative, http }
       normalize(raw, source)  -> NormalizedJobInput
       verify(instance, ctx)   -> { ok, status, closed, errorClass }

   `authoritative` is load-bearing: it declares whether ABSENCE
   from this response is meaningful evidence a job closed. Keyword-
   filtered aggregator responses are never authoritative.
   ============================================================ */

import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, ERROR_CLASS } from '../schema.js';
import { detectAts } from '../atsDetect.js';

export class JobSourceAdapter {
  static provider = PROVIDER.GENERIC;
  static sourceType = SOURCE_TYPE.CAREER_SITE;
  static sourceClass = SOURCE_CLASS.ORIGINAL_CAREER_SITE;
  /** Set false when the adapter needs credentials that may be absent. */
  static requiresCredentials = false;

  constructor(ctx = {}) {
    this.ctx = ctx;
    this.http = ctx.http;
    this.logger = ctx.logger || console;
  }

  get provider() { return this.constructor.provider; }

  /** Default identification is the shared ATS fingerprinter. */
  identify(urlOrSource, html = '') {
    const det = detectAts(typeof urlOrSource === 'string' ? urlOrSource : (urlOrSource?.careersUrl || urlOrSource?.baseUrl), html);
    return det.provider === this.provider ? det : { ...det, provider: det.provider, matches: false };
  }

  /** Confirm the source is reachable and fill in tenant/board metadata. */
  // eslint-disable-next-line no-unused-vars
  async discover(source, ctx = {}) {
    return { source, ok: true, reason: 'no discovery step required' };
  }

  // eslint-disable-next-line no-unused-vars
  async fetchJobs(source, cursor = null, ctx = {}) {
    throw new Error(`${this.constructor.name}.fetchJobs not implemented`);
  }

  // eslint-disable-next-line no-unused-vars
  normalize(rawJob, source) {
    throw new Error(`${this.constructor.name}.normalize not implemented`);
  }

  /**
   * Re-verify one source instance against its ORIGINAL record.
   * Default: HEAD/GET the job URL and classify. 404/410 prove closure;
   * everything else is transient and must not close the job.
   */
  async verify(instance, ctx = {}) {
    const url = instance?.jobUrl || instance?.applyUrl;
    if (!url) return { ok: false, status: null, closed: false, errorClass: ERROR_CLASS.PARSE_FAILED, reason: 'no url' };
    const http = ctx.http || this.http;
    if (!http) return { ok: false, status: null, closed: false, errorClass: ERROR_CLASS.NOT_CONFIGURED, reason: 'no http client' };
    try {
      const r = await http.fetch(url, { method: 'GET', maxBytes: 512 * 1024 });
      return { ok: true, status: r.status, closed: false, errorClass: null };
    } catch (e) {
      const status = e?.status ?? null;
      const closed = status === 404 || status === 410;
      return { ok: false, status, closed, errorClass: e?.errorClass || ERROR_CLASS.UNKNOWN, reason: e?.message };
    }
  }

  /** Build the source-shaped descriptor this adapter operates on. */
  describe(source) {
    return {
      provider: this.provider,
      sourceType: this.constructor.sourceType,
      sourceClass: this.constructor.sourceClass,
      tenant: source?.tenant ?? null,
      baseUrl: source?.baseUrl ?? null,
    };
  }
}

/** Shape assertion used by tests to prove no provider object leaks through. */
export const NORMALIZED_INPUT_KEYS = Object.freeze([
  'sourceJobId', 'requisitionId', 'title', 'company', 'descriptionHtml',
  'descriptionText', 'locationsRaw', 'applicantRegions', 'explicitRemote',
  'workplaceHint', 'employmentTypeRaw', 'department', 'jobUrl', 'applyUrl',
  'sourcePublishedAt', 'validThrough', 'compensationStructured', 'compensationRaw',
  'tags', 'extraction', 'rawHash',
]);

export function assertNormalizedInput(input, { adapter = 'unknown' } = {}) {
  const extra = Object.keys(input || {}).filter((k) => !NORMALIZED_INPUT_KEYS.includes(k));
  if (extra.length) {
    throw new Error(`${adapter}: provider-specific keys leaked into NormalizedJobInput: ${extra.join(', ')}`);
  }
  return true;
}

export default { JobSourceAdapter, NORMALIZED_INPUT_KEYS, assertNormalizedInput };
