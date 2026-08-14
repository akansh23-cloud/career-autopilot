/* ============================================================
   ASHBY ADAPTER  (§7.3)
   ------------------------------------------------------------
   Public job-board ingestion via the documented posting API.
   Only the PUBLIC board endpoint is used — no privileged or
   internal Ashby endpoint is called, and none would be without
   explicit credentials and authorization.
   ============================================================ */

import { JobSourceAdapter } from './base.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, ERROR_CLASS } from '../schema.js';
import { detectAts, boardUrlFor } from '../atsDetect.js';
import { stripHtml, sha256 } from '../normalize/text.js';

const API = 'https://api.ashbyhq.com/posting-api/job-board';

export class AshbyAdapter extends JobSourceAdapter {
  static provider = PROVIDER.ASHBY;
  static sourceType = SOURCE_TYPE.ATS;
  static sourceClass = SOURCE_CLASS.ORIGINAL_ATS;

  identify(urlOrSource, html = '') {
    const det = detectAts(typeof urlOrSource === 'string' ? urlOrSource : (urlOrSource?.careersUrl || urlOrSource?.baseUrl || ''), html);
    return { ...det, matches: det.provider === PROVIDER.ASHBY };
  }

  boardApiUrl(tenant) {
    return `${API}/${encodeURIComponent(tenant)}?includeCompensation=true`;
  }

  async discover(source, ctx = {}) {
    const http = ctx.http || this.http;
    const tenant = source.tenant;
    if (!tenant) return { source, ok: false, reason: 'no ashby board name', errorClass: ERROR_CLASS.PARSE_FAILED };
    try {
      const r = await http.fetchJson(this.boardApiUrl(tenant));
      const jobs = Array.isArray(r.json?.jobs) ? r.json.jobs : [];
      return {
        source: {
          ...source,
          companyName: source.companyName || r.json?.organizationName || null,
          baseUrl: boardUrlFor(PROVIDER.ASHBY, tenant),
          careersUrl: source.careersUrl || boardUrlFor(PROVIDER.ASHBY, tenant),
        },
        ok: true,
        reason: `ashby board reachable, ${jobs.length} listed jobs`,
        jobCount: jobs.length,
      };
    } catch (e) {
      return { source, ok: false, reason: e?.message, errorClass: e?.errorClass || ERROR_CLASS.NETWORK };
    }
  }

  async fetchJobs(source, cursor = null, ctx = {}) {
    const http = ctx.http || this.http;
    const tenant = source.tenant;
    if (!tenant) return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.PARSE_FAILED, message: 'no ashby board name' } };
    const r = await http.fetchJson(this.boardApiUrl(tenant), {
      etag: source.http?.etag || null, lastModified: source.http?.lastModified || null,
    });
    if (r.notModified) {
      return { items: [], nextCursor: null, authoritative: false, notModified: true, http: { etag: r.etag, status: 304 } };
    }
    const jobs = Array.isArray(r.json?.jobs) ? r.json.jobs : [];
    /* isListed=false means the board is deliberately hiding it. Not ingested. */
    const listed = jobs.filter((j) => j?.isListed !== false);
    return {
      items: listed,
      nextCursor: null,
      authoritative: true, // whole board in one response
      organizationName: r.json?.organizationName || null,
      http: { etag: r.etag, lastModified: r.lastModified, status: r.status, url: r.url, bytes: r.bytes },
    };
  }

  normalize(raw, source) {
    const locations = [
      raw.location,
      ...(Array.isArray(raw.secondaryLocations)
        ? raw.secondaryLocations.map((l) => (typeof l === 'string' ? l : l?.location)).filter(Boolean)
        : []),
      raw.address?.postalAddress?.addressLocality,
    ].filter(Boolean);

    /* Ashby states remoteness explicitly. Absent -> null, never assumed. */
    const explicitRemote = typeof raw.isRemote === 'boolean' ? raw.isRemote : null;

    const html = raw.descriptionHtml || null;
    const text = raw.descriptionPlain || (html ? stripHtml(html) : null);

    /* compensation is only present when the board publishes it. */
    const tiers = raw.compensation?.compensationTiers;
    let structured = null;
    let compRaw = raw.compensation?.compensationTierSummary || null;
    if (Array.isArray(tiers) && tiers.length) {
      const comps = tiers.flatMap((t) => (Array.isArray(t.components) ? t.components : []));
      const salaryComp = comps.find((c) => /salary/i.test(String(c?.compensationType || c?.summary || ''))) || comps[0];
      if (salaryComp && (salaryComp.minValue != null || salaryComp.maxValue != null)) {
        structured = {
          minValue: salaryComp.minValue ?? null,
          maxValue: salaryComp.maxValue ?? null,
          currency: salaryComp.currencyCode ?? null,
          interval: salaryComp.interval ?? null,
        };
      }
      if (!compRaw) compRaw = tiers.map((t) => t.title || t.tierSummary).filter(Boolean).join('; ') || null;
    }

    return {
      sourceJobId: raw.id != null ? String(raw.id) : null,
      requisitionId: raw.jobRequisitionId != null ? String(raw.jobRequisitionId) : null,
      title: raw.title || null,
      company: {
        name: source.companyName || raw.organizationName || source.tenant || null,
        website: source.companyWebsite || null,
        domain: source.companyDomain || null,
        logoUrl: null,
      },
      descriptionHtml: html,
      descriptionText: text,
      locationsRaw: locations,
      applicantRegions: [],
      explicitRemote,
      workplaceHint: explicitRemote === true ? 'Remote' : (explicitRemote === false ? 'On-site' : null),
      employmentTypeRaw: raw.employmentType || null,
      department: raw.department || raw.team || null,
      jobUrl: raw.jobUrl || null,
      applyUrl: raw.applyUrl || raw.jobUrl || null,
      sourcePublishedAt: raw.publishedAt || null,
      validThrough: null,
      compensationStructured: structured,
      compensationRaw: compRaw,
      tags: [raw.team, raw.department].filter(Boolean),
      extraction: 'ASHBY_API',
      rawHash: sha256(JSON.stringify(raw)),
    };
  }
}

export default AshbyAdapter;
