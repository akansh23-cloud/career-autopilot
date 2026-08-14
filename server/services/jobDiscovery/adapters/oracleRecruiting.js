/* ============================================================
   ORACLE RECRUITING (Candidate Experience) ADAPTER
   ------------------------------------------------------------
   Oracle's candidate-experience sites are served by a public REST
   resource that the board page itself calls for anonymous visitors:

       GET /hcmRestApi/resources/latest/recruitingCEJobRequisitions
           ?onlyData=true
           &finder=findReqs;siteNumber={site},limit=N,offset=M

   No authentication, no private endpoint. The tenant is stored as
   "host/siteNumber" because BOTH are needed to address a board.

   The finder returns a wrapper object whose requisitionList holds
   the postings and whose TotalJobsCount states the board size, so
   pagination is exact and AUTHORITATIVE status is only claimed on
   the final page.
   ============================================================ */

import { JobSourceAdapter } from './base.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, ERROR_CLASS } from '../schema.js';
import { detectAts, boardUrlFor } from '../atsDetect.js';
import { stripHtml, sha256 } from '../normalize/text.js';

const PAGE_SIZE = 100;

export function parseOracleTenant(tenant) {
  const [host, site] = String(tenant || '').split('/');
  if (!host || !site) return null;
  return { host, site };
}

export class OracleRecruitingAdapter extends JobSourceAdapter {
  static provider = PROVIDER.ORACLE_RECRUITING;
  static sourceType = SOURCE_TYPE.ATS;
  static sourceClass = SOURCE_CLASS.ORIGINAL_ATS;

  identify(urlOrSource, html = '') {
    const url = typeof urlOrSource === 'string' ? urlOrSource : (urlOrSource?.careersUrl || urlOrSource?.baseUrl || '');
    const det = detectAts(url, html);
    return { ...det, matches: det.provider === PROVIDER.ORACLE_RECRUITING };
  }

  configurationStatus() {
    return {
      status: 'ACTIVE',
      configured: true,
      mode: 'JSON',
      reason: 'public candidate-experience REST resource; no credentials required',
    };
  }

  listUrl(t, offset) {
    const finder = `findReqs;siteNumber=${encodeURIComponent(t.site)},limit=${PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC`;
    return `https://${t.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${finder}`;
  }

  async discover(source, ctx = {}) {
    const t = parseOracleTenant(source.tenant);
    if (!t) return { source, ok: false, reason: 'oracle tenant must be host/siteNumber', errorClass: ERROR_CLASS.PARSE_FAILED };
    const http = ctx.http || this.http;
    try {
      const r = await http.fetchJson(this.listUrl(t, 0));
      const wrapper = r.json?.items?.[0] || {};
      const total = Number(wrapper.TotalJobsCount ?? (wrapper.requisitionList || []).length);
      const board = boardUrlFor(PROVIDER.ORACLE_RECRUITING, source.tenant);
      return {
        source: { ...source, baseUrl: source.baseUrl || board, careersUrl: source.careersUrl || board },
        ok: true,
        reason: `oracle CE site reachable, ${total} published requisitions`,
        jobCount: total,
      };
    } catch (e) {
      return { source, ok: false, reason: e?.message, errorClass: e?.errorClass || ERROR_CLASS.NETWORK };
    }
  }

  async fetchJobs(source, cursor = null, ctx = {}) {
    const http = ctx.http || this.http;
    if (!http) return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.NOT_CONFIGURED, message: 'no http client' } };
    const t = parseOracleTenant(source.tenant);
    if (!t) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.PARSE_FAILED, message: 'oracle tenant must be host/siteNumber' } };
    }

    const offset = Number(cursor?.offset ?? 0);
    let r;
    try {
      r = await http.fetchJson(this.listUrl(t, offset), {
        etag: offset ? null : (source.http?.etag || null),
      });
    } catch (e) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: e?.errorClass || ERROR_CLASS.NETWORK, message: e?.message } };
    }
    if (r.notModified) {
      return { items: [], nextCursor: null, authoritative: false, notModified: true, http: { etag: r.etag, status: 304 } };
    }

    const wrapper = r.json?.items?.[0];
    const list = Array.isArray(wrapper?.requisitionList) ? wrapper.requisitionList : null;
    if (!list) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.SCHEMA_CHANGED, message: 'oracle: requisitionList absent' } };
    }

    const total = Number(wrapper.TotalJobsCount);
    const nextOffset = offset + PAGE_SIZE;
    const hasMore = list.length === PAGE_SIZE && (!Number.isFinite(total) || nextOffset < total);

    return {
      items: list.map((x) => ({ ...x, __host: t.host, __site: t.site })),
      nextCursor: hasMore ? { offset: nextOffset } : null,
      authoritative: !hasMore,
      stage: 'ORACLE_CE',
      http: { etag: r.etag, lastModified: r.lastModified, status: r.status, url: r.url, bytes: r.bytes },
    };
  }

  normalize(raw, source) {
    const host = raw.__host || parseOracleTenant(source.tenant)?.host;
    const site = raw.__site || parseOracleTenant(source.tenant)?.site;
    const id = raw.Id != null ? String(raw.Id) : null;
    const jobUrl = host && site && id
      ? `https://${host}/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(site)}/job/${encodeURIComponent(id)}`
      : null;

    const locations = [
      raw.PrimaryLocation,
      ...(Array.isArray(raw.secondaryLocations) ? raw.secondaryLocations.map((l) => l?.Name || l?.LocationName).filter(Boolean) : []),
    ].filter(Boolean);

    /* Oracle states WorkplaceType when the employer configured it. Absent means
       unknown — an office-less requisition is not evidence of remote work. */
    const wt = raw.WorkplaceType || raw.WorkplaceTypeCode || null;
    let explicitRemote = null;
    if (wt) explicitRemote = /remote/i.test(String(wt));

    const html = raw.ExternalDescriptionStr || raw.ShortDescriptionStr || null;

    return {
      sourceJobId: id,
      requisitionId: raw.RequisitionNumber != null ? String(raw.RequisitionNumber) : null,
      title: raw.Title || null,
      company: {
        name: source.companyName || null,
        website: source.companyWebsite || null,
        domain: source.companyDomain || null,
        logoUrl: null,
      },
      descriptionHtml: html,
      descriptionText: html ? stripHtml(html) : null,
      locationsRaw: locations,
      applicantRegions: [],
      explicitRemote,
      workplaceHint: wt ? String(wt) : null,
      employmentTypeRaw: raw.JobType || raw.WorkerTypeCode || null,
      department: raw.JobFamily || null,
      jobUrl,
      applyUrl: jobUrl,
      /* PostedDate is a real publication date when present. */
      sourcePublishedAt: raw.PostedDate || null,
      validThrough: null,
      compensationStructured: null,
      compensationRaw: null,
      tags: [raw.JobFamily, raw.Category].filter(Boolean).slice(0, 4),
      extraction: 'ORACLE_CE_API',
      rawHash: sha256(JSON.stringify(raw)),
    };
  }
}

export default OracleRecruitingAdapter;
