/* ============================================================
   SMARTRECRUITERS ADAPTER  (§7.5)
   ------------------------------------------------------------
   Behind explicit configuration.

   Two modes, and the adapter is honest about which one it is in:

     PUBLIC   the company's published postings endpoint, which the
              hosted careers page itself calls unauthenticated.
              Enabled only when the source is explicitly registered
              with a company identifier.

     KEYED    when SMARTRECRUITERS_API_KEY is present it is sent,
              which unlocks the same postings surface for private
              boards the operator is entitled to read.

   If the deployment config demands a key and none is present the
   adapter reports status NOT_CONFIGURED and ingests NOTHING. It
   never reports a successful run it did not perform.
   ============================================================ */

import { JobSourceAdapter } from './base.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, SOURCE_STATUS, ERROR_CLASS } from '../schema.js';
import { detectAts, boardUrlFor } from '../atsDetect.js';
import { stripHtml, sha256 } from '../normalize/text.js';

const API = 'https://api.smartrecruiters.com/v1/companies';
const PAGE_SIZE = 100;

export class SmartRecruitersAdapter extends JobSourceAdapter {
  static provider = PROVIDER.SMARTRECRUITERS;
  static sourceType = SOURCE_TYPE.ATS;
  static sourceClass = SOURCE_CLASS.ORIGINAL_ATS;
  static requiresCredentials = true;

  constructor(ctx = {}) {
    super(ctx);
    this.apiKey = ctx.smartRecruitersApiKey ?? process.env.SMARTRECRUITERS_API_KEY ?? '';
    /* Operators who want strictly-keyed access set this; the default allows the
       public postings surface, which is what a careers page already exposes. */
    this.requireKey = ctx.smartRecruitersRequireKey
      ?? (String(process.env.SMARTRECRUITERS_REQUIRE_KEY || '').toLowerCase() === '1');
  }

  /** Truthful configuration state, surfaced in the source registry + admin view. */
  configurationStatus() {
    if (this.requireKey && !this.apiKey) {
      return {
        status: SOURCE_STATUS.NOT_CONFIGURED,
        configured: false,
        mode: null,
        reason: 'SMARTRECRUITERS_REQUIRE_KEY is set but SMARTRECRUITERS_API_KEY is absent',
      };
    }
    return {
      status: SOURCE_STATUS.ACTIVE,
      configured: true,
      mode: this.apiKey ? 'KEYED' : 'PUBLIC',
      reason: this.apiKey ? 'API key present' : 'public postings endpoint',
    };
  }

  identify(urlOrSource, html = '') {
    const det = detectAts(typeof urlOrSource === 'string' ? urlOrSource : (urlOrSource?.careersUrl || urlOrSource?.baseUrl || ''), html);
    return { ...det, matches: det.provider === PROVIDER.SMARTRECRUITERS };
  }

  headers() {
    return this.apiKey ? { 'X-SmartToken': this.apiKey } : {};
  }

  async discover(source, ctx = {}) {
    const cfg = this.configurationStatus();
    if (!cfg.configured) {
      return { source: { ...source, status: SOURCE_STATUS.NOT_CONFIGURED }, ok: false, reason: cfg.reason, errorClass: ERROR_CLASS.NOT_CONFIGURED };
    }
    const http = ctx.http || this.http;
    const tenant = source.tenant;
    if (!tenant) return { source, ok: false, reason: 'no smartrecruiters company id', errorClass: ERROR_CLASS.PARSE_FAILED };
    try {
      const r = await http.fetchJson(`${API}/${encodeURIComponent(tenant)}/postings?limit=1`, { headers: this.headers() });
      return {
        source: {
          ...source,
          baseUrl: boardUrlFor(PROVIDER.SMARTRECRUITERS, tenant),
          careersUrl: source.careersUrl || boardUrlFor(PROVIDER.SMARTRECRUITERS, tenant),
          mode: cfg.mode,
        },
        ok: true,
        reason: `smartrecruiters ${cfg.mode.toLowerCase()} mode, totalFound=${r.json?.totalFound ?? 'unknown'}`,
      };
    } catch (e) {
      return { source, ok: false, reason: e?.message, errorClass: e?.errorClass || ERROR_CLASS.NETWORK };
    }
  }

  async fetchJobs(source, cursor = null, ctx = {}) {
    const cfg = this.configurationStatus();
    if (!cfg.configured) {
      return {
        items: [], nextCursor: null, authoritative: false,
        notConfigured: true,
        error: { errorClass: ERROR_CLASS.NOT_CONFIGURED, message: cfg.reason },
      };
    }
    const http = ctx.http || this.http;
    const tenant = source.tenant;
    if (!tenant) return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.PARSE_FAILED, message: 'no company id' } };

    const offset = Number(cursor?.offset || 0);
    const url = `${API}/${encodeURIComponent(tenant)}/postings?limit=${PAGE_SIZE}&offset=${offset}`;
    const r = await http.fetchJson(url, { headers: this.headers(), etag: offset === 0 ? (source.http?.etag || null) : null });
    if (r.notModified) {
      return { items: [], nextCursor: null, authoritative: false, notModified: true, http: { etag: r.etag, status: 304 } };
    }
    const content = Array.isArray(r.json?.content) ? r.json.content : [];
    const total = Number(r.json?.totalFound ?? content.length);
    const consumed = offset + content.length;
    const more = content.length === PAGE_SIZE && consumed < total;
    return {
      items: content,
      nextCursor: more ? { offset: consumed } : null,
      authoritative: !more,
      http: { etag: r.etag, lastModified: r.lastModified, status: r.status, url: r.url, bytes: r.bytes },
    };
  }

  normalize(raw, source) {
    const loc = raw.location || {};
    const locationParts = [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
    const locations = [];
    if (locationParts) locations.push(locationParts);
    if (loc.remote === true) locations.push('Remote');

    const sections = raw.jobAd?.sections || {};
    const html = [
      sections.companyDescription?.text,
      sections.jobDescription?.text,
      sections.qualifications?.text,
      sections.additionalInformation?.text,
    ].filter(Boolean).join('\n') || null;

    const uuid = raw.id || raw.uuid || null;
    const jobUrl = raw.ref || raw.applyUrl
      || (source.tenant && uuid ? `https://jobs.smartrecruiters.com/${source.tenant}/${uuid}` : null);

    return {
      sourceJobId: uuid != null ? String(uuid) : null,
      requisitionId: raw.refNumber != null ? String(raw.refNumber) : null,
      title: raw.name || null,
      company: {
        name: source.companyName || raw.company?.name || source.tenant || null,
        website: source.companyWebsite || null,
        domain: source.companyDomain || null,
        logoUrl: null,
      },
      descriptionHtml: html,
      descriptionText: html ? stripHtml(html) : null,
      locationsRaw: locations,
      applicantRegions: [],
      explicitRemote: typeof loc.remote === 'boolean' ? loc.remote : null,
      workplaceHint: loc.remote === true ? 'Remote' : null,
      employmentTypeRaw: raw.typeOfEmployment?.label || raw.typeOfEmployment?.id || null,
      department: raw.department?.label || raw.function?.label || null,
      jobUrl,
      applyUrl: raw.applyUrl || jobUrl,
      sourcePublishedAt: raw.releasedDate || null,
      validThrough: null,
      compensationStructured: null,
      compensationRaw: null,
      tags: [raw.industry?.label, raw.function?.label].filter(Boolean),
      extraction: 'SMARTRECRUITERS_API',
      rawHash: sha256(JSON.stringify(raw)),
    };
  }
}

export default SmartRecruitersAdapter;
