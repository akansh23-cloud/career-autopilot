/* ============================================================
   WORKABLE ADAPTER  (§7.4)
   ------------------------------------------------------------
   Uses Workable's documented PUBLIC account endpoint for published
   jobs. No private SPI endpoint and no account token are used. The
   global XML feed remains a future bulk bootstrap option; it is not
   downloaded per company or per search request.

   §7.4 explicitly forbids downloading a large feed on every
   search request: this adapter is only ever driven by the crawl
   scheduler, it checkpoints via cursor, hashes each payload, and
   writes to the index. User search never calls it.
   ============================================================ */

import { JobSourceAdapter } from './base.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, ERROR_CLASS } from '../schema.js';
import { detectAts, boardUrlFor } from '../atsDetect.js';
import { stripHtml, sha256 } from '../normalize/text.js';

const PUBLIC_ACCOUNTS = 'https://www.workable.com/api/accounts';

export class WorkableAdapter extends JobSourceAdapter {
  static provider = PROVIDER.WORKABLE;
  static sourceType = SOURCE_TYPE.ATS;
  static sourceClass = SOURCE_CLASS.ORIGINAL_ATS;

  identify(urlOrSource, html = '') {
    const det = detectAts(typeof urlOrSource === 'string' ? urlOrSource : (urlOrSource?.careersUrl || urlOrSource?.baseUrl || ''), html);
    return { ...det, matches: det.provider === PROVIDER.WORKABLE };
  }

  publicAccountUrl(tenant) {
    return `${PUBLIC_ACCOUNTS}/${encodeURIComponent(tenant)}`;
  }

  async discover(source, ctx = {}) {
    const http = ctx.http || this.http;
    const tenant = source.tenant;
    if (!tenant) return { source, ok: false, reason: 'no workable subdomain', errorClass: ERROR_CLASS.PARSE_FAILED };
    try {
      const r = await http.fetchJson(this.publicAccountUrl(tenant));
      const jobs = Array.isArray(r.json?.jobs) ? r.json.jobs : [];
      return {
        source: {
          ...source,
          companyName: source.companyName || r.json?.name || null,
          baseUrl: boardUrlFor(PROVIDER.WORKABLE, tenant),
          careersUrl: source.careersUrl || boardUrlFor(PROVIDER.WORKABLE, tenant),
        },
        ok: true,
        reason: `workable account reachable, ${jobs.length} published jobs`,
        jobCount: jobs.length,
      };
    } catch (e) {
      return { source, ok: false, reason: e?.message, errorClass: e?.errorClass || ERROR_CLASS.NETWORK };
    }
  }

  /**
   * The documented public account endpoint returns the account's published jobs in one document. It is
   * checkpointed by ETag so an unchanged account costs one conditional GET.
   */
  async fetchJobs(source, cursor = null, ctx = {}) {
    const http = ctx.http || this.http;
    const tenant = source.tenant;
    if (!tenant) return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.PARSE_FAILED, message: 'no workable subdomain' } };
    const r = await http.fetchJson(this.publicAccountUrl(tenant), {
      etag: source.http?.etag || null, lastModified: source.http?.lastModified || null,
      maxBytes: 8 * 1024 * 1024,
    });
    if (r.notModified) {
      return { items: [], nextCursor: null, authoritative: false, notModified: true, http: { etag: r.etag, status: 304 } };
    }
    const jobs = Array.isArray(r.json?.jobs) ? r.json.jobs : [];
    return {
      items: jobs.map((j) => ({ ...j, __account: r.json?.name || null, __accountSubdomain: tenant })),
      nextCursor: null,
      authoritative: true,
      http: { etag: r.etag, lastModified: r.lastModified, status: r.status, url: r.url, bytes: r.bytes },
    };
  }

  normalize(raw, source) {
    const locBits = [raw.city, raw.state, raw.country].filter(Boolean).join(', ');
    const locations = [];
    if (raw.location && typeof raw.location === 'object') {
      const l = [raw.location.city, raw.location.region, raw.location.country].filter(Boolean).join(', ');
      if (l) locations.push(l);
    }
    if (locBits) locations.push(locBits);
    if (typeof raw.location === 'string' && raw.location) locations.push(raw.location);

    const telecommuting = typeof raw.telecommuting === 'boolean'
      ? raw.telecommuting
      : (typeof raw.location?.telecommuting === 'boolean' ? raw.location.telecommuting : null);

    const html = [raw.description, raw.requirements, raw.benefits].filter(Boolean).join('\n') || null;

    const shortcode = raw.shortcode || raw.id || null;
    const jobUrl = raw.url
      || raw.application_url
      || (shortcode && source.tenant ? `https://apply.workable.com/${source.tenant}/j/${shortcode}/` : null);
    const applyUrl = raw.application_url
      || (shortcode && source.tenant ? `https://apply.workable.com/${source.tenant}/j/${shortcode}/apply/` : jobUrl);

    return {
      sourceJobId: shortcode != null ? String(shortcode) : null,
      requisitionId: raw.code ? String(raw.code) : null,
      title: raw.title || null,
      company: {
        name: source.companyName || raw.__account || raw.company_name || source.tenant || null,
        website: source.companyWebsite || null,
        domain: source.companyDomain || null,
        logoUrl: null,
      },
      descriptionHtml: html,
      descriptionText: html ? stripHtml(html) : null,
      locationsRaw: locations,
      applicantRegions: [],
      explicitRemote: telecommuting,
      workplaceHint: raw.workplace || (telecommuting === true ? 'Remote' : null),
      employmentTypeRaw: raw.employment_type || raw.type || null,
      department: raw.department || (Array.isArray(raw.departments) ? raw.departments[0] : null) || null,
      jobUrl,
      applyUrl,
      sourcePublishedAt: raw.published_on || raw.published || raw.created_at || null,
      validThrough: null,
      compensationStructured: (raw.salary && (raw.salary.salary_from != null || raw.salary.salary_to != null))
        ? {
          minValue: raw.salary.salary_from ?? null,
          maxValue: raw.salary.salary_to ?? null,
          currency: raw.salary.salary_currency ?? null,
          interval: raw.salary.salary_interval ?? null,
        }
        : null,
      compensationRaw: null,
      tags: [raw.department, raw.function].filter(Boolean),
      extraction: 'WORKABLE_PUBLIC_ACCOUNT',
      rawHash: sha256(JSON.stringify(raw)),
    };
  }
}

export default WorkableAdapter;
