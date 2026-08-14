/* ============================================================
   WORKDAY ADAPTER
   ------------------------------------------------------------
   Workday serves its public candidate-experience boards from a
   POST search endpoint rather than a GET listing:

       POST /wday/cxs/{tenant}/{site}/jobs
            { appliedFacets: {}, limit, offset, searchText: "" }

   That is the SAME endpoint the public board page itself calls
   when an anonymous visitor opens it — no authentication, no
   private API, no block evasion. Only public sites the employer
   has published are addressed, and the site identifier comes from
   the board URL we detected.

   Pagination is offset-based against a stated `total`, so the
   board only becomes AUTHORITATIVE (absence proves closure) on the
   final page — an early page must never trigger reconciliation.

   Descriptions live on a per-posting detail endpoint. Enriching
   every posting on every crawl would be an enormous request volume
   for one board, so detail fetching is BOUNDED and best-effort: a
   posting without a description is stored with the description
   missing and its completeness flags say so, rather than being
   dropped or padded with invented text.
   ============================================================ */

import { JobSourceAdapter } from './base.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, ERROR_CLASS } from '../schema.js';
import { detectAts, boardUrlFor } from '../atsDetect.js';
import { stripHtml, sha256 } from '../normalize/text.js';

const PAGE_SIZE = 20;
const MAX_DETAIL_PER_RUN = 25;

/** tenant is stored as "company/wdN/site" — the only shape that addresses a board. */
export function parseWorkdayTenant(tenant) {
  const [company, wd, site] = String(tenant || '').split('/');
  if (!company || !wd || !site) return null;
  return { company, wd, site, host: `${company}.${wd}.myworkdayjobs.com` };
}

export class WorkdayAdapter extends JobSourceAdapter {
  static provider = PROVIDER.WORKDAY;
  static sourceType = SOURCE_TYPE.ATS;
  static sourceClass = SOURCE_CLASS.ORIGINAL_ATS;

  constructor(ctx = {}) {
    super(ctx);
    this.maxDetailPerRun = ctx.workdayMaxDetail ?? MAX_DETAIL_PER_RUN;
    this.detailBudget = 0;
  }

  identify(urlOrSource, html = '') {
    const url = typeof urlOrSource === 'string' ? urlOrSource : (urlOrSource?.careersUrl || urlOrSource?.baseUrl || '');
    const det = detectAts(url, html);
    return { ...det, matches: det.provider === PROVIDER.WORKDAY };
  }

  configurationStatus() {
    return {
      status: 'ACTIVE',
      configured: true,
      mode: 'JSON_POST',
      reason: 'public candidate-experience board endpoint; no credentials required',
    };
  }

  listUrl(t) { return `https://${t.host}/wday/cxs/${encodeURIComponent(t.company)}/${encodeURIComponent(t.site)}/jobs`; }

  detailUrl(t, externalPath) {
    if (!externalPath) return null;
    const path = String(externalPath).startsWith('/') ? externalPath : `/${externalPath}`;
    return `https://${t.host}/wday/cxs/${encodeURIComponent(t.company)}/${encodeURIComponent(t.site)}${path}`;
  }

  async discover(source, ctx = {}) {
    const t = parseWorkdayTenant(source.tenant);
    if (!t) return { source, ok: false, reason: 'workday tenant must be company/wdN/site', errorClass: ERROR_CLASS.PARSE_FAILED };
    const http = ctx.http || this.http;
    try {
      const r = await http.fetchJson(this.listUrl(t), {
        method: 'POST',
        body: { appliedFacets: {}, limit: 1, offset: 0, searchText: '' },
      });
      const total = Number(r.json?.total ?? 0);
      const board = boardUrlFor(PROVIDER.WORKDAY, source.tenant);
      return {
        source: { ...source, baseUrl: source.baseUrl || board, careersUrl: source.careersUrl || board },
        ok: true,
        reason: `workday board reachable, ${total} published jobs`,
        jobCount: total,
      };
    } catch (e) {
      return { source, ok: false, reason: e?.message, errorClass: e?.errorClass || ERROR_CLASS.NETWORK };
    }
  }

  async fetchJobs(source, cursor = null, ctx = {}) {
    const http = ctx.http || this.http;
    if (!http) return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.NOT_CONFIGURED, message: 'no http client' } };
    const t = parseWorkdayTenant(source.tenant);
    if (!t) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.PARSE_FAILED, message: 'workday tenant must be company/wdN/site' } };
    }

    const offset = Number(cursor?.offset ?? 0);
    if (!offset) this.detailBudget = this.maxDetailPerRun;

    let r;
    try {
      r = await http.fetchJson(this.listUrl(t), {
        method: 'POST',
        body: { appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: '' },
      });
    } catch (e) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: e?.errorClass || ERROR_CLASS.NETWORK, message: e?.message } };
    }

    const postings = Array.isArray(r.json?.jobPostings) ? r.json.jobPostings : null;
    if (!postings) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.SCHEMA_CHANGED, message: 'workday: jobPostings array absent' } };
    }

    const total = Number(r.json?.total);
    const nextOffset = offset + PAGE_SIZE;
    const hasMore = postings.length === PAGE_SIZE && (!Number.isFinite(total) || nextOffset < total);

    /* Bounded, best-effort description enrichment. */
    const items = [];
    for (const p of postings) {
      let detail = null;
      if (this.detailBudget > 0 && p?.externalPath) {
        this.detailBudget -= 1;
        try {
          // eslint-disable-next-line no-await-in-loop
          const d = await http.fetchJson(this.detailUrl(t, p.externalPath));
          detail = d.json?.jobPostingInfo || null;
        } catch {
          /* A failed detail fetch is not a failed job. The posting is kept and
             its missing description is reported by completeness, not filled in. */
          detail = null;
        }
      }
      items.push({ ...p, __detail: detail, __tenant: source.tenant, __host: t.host });
    }

    return {
      items,
      nextCursor: hasMore ? { offset: nextOffset } : null,
      /* Only the LAST page of a complete board may be treated as authoritative. */
      authoritative: !hasMore,
      stage: 'JSON_POST',
      http: { status: r.status, url: r.url, bytes: r.bytes },
    };
  }

  normalize(raw, source) {
    const detail = raw.__detail || null;
    const host = raw.__host || parseWorkdayTenant(source.tenant)?.host || null;
    const path = raw.externalPath ? String(raw.externalPath) : null;
    const t = parseWorkdayTenant(source.tenant);
    const jobUrl = host && path && t ? `https://${host}/${encodeURIComponent(t.site)}${path.startsWith('/') ? path : `/${path}`}` : null;

    const html = detail?.jobDescription || null;

    /* bulletFields commonly carries the requisition id; it is used ONLY when it
       looks like an identifier, never as a generic text field. */
    const bullets = Array.isArray(raw.bulletFields) ? raw.bulletFields.filter(Boolean) : [];
    const requisitionId = bullets.find((b) => /^[A-Z0-9][A-Z0-9._-]{2,}$/i.test(String(b))) || null;

    /* Workday exposes `postedOn` as display text ("Posted 3 Days Ago"), which is
       NOT a date. Only the detail endpoint's startDate is a real posting date;
       without it the date stays null rather than being reconstructed. */
    const sourcePublishedAt = detail?.startDate || null;

    const locations = [
      raw.locationsText,
      detail?.location,
      ...(Array.isArray(detail?.additionalLocations) ? detail.additionalLocations : []),
    ].filter(Boolean);

    const remoteType = detail?.remoteType || null;
    let explicitRemote = null;
    if (remoteType) explicitRemote = /remote/i.test(remoteType) ? true : false;

    return {
      sourceJobId: raw.id != null ? String(raw.id) : (path || null),
      requisitionId,
      title: raw.title || detail?.title || null,
      company: {
        name: source.companyName || t?.company || null,
        website: source.companyWebsite || null,
        domain: source.companyDomain || null,
        logoUrl: null,
      },
      descriptionHtml: html,
      descriptionText: html ? stripHtml(html) : null,
      locationsRaw: locations,
      applicantRegions: [],
      explicitRemote,
      workplaceHint: remoteType,
      employmentTypeRaw: detail?.timeType || null,
      department: null,
      jobUrl,
      applyUrl: detail?.externalUrl || jobUrl,
      sourcePublishedAt,
      validThrough: detail?.endDate || null,
      compensationStructured: null,
      compensationRaw: null,
      tags: [],
      extraction: 'WORKDAY_CXS',
      rawHash: sha256(JSON.stringify({ ...raw, __detail: undefined })),
    };
  }
}

export default WorkdayAdapter;
