/* ============================================================
   GREENHOUSE ADAPTER  (§7.1)
   ------------------------------------------------------------
   Public job-board ingestion. Board token -> full published job
   list, with content. Greenhouse returns a COMPLETE board, so
   absence from a successful response IS meaningful — the adapter
   reports authoritative:true and the freshness engine may count
   a miss.

   Provider job id is a high-confidence dedupe key (stage 1).
   ============================================================ */

import { JobSourceAdapter } from './base.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, ERROR_CLASS } from '../schema.js';
import { detectAts, boardUrlFor } from '../atsDetect.js';
import { stripHtml, sha256 } from '../normalize/text.js';

const API = 'https://boards-api.greenhouse.io/v1/boards';

export class GreenhouseAdapter extends JobSourceAdapter {
  static provider = PROVIDER.GREENHOUSE;
  static sourceType = SOURCE_TYPE.ATS;
  static sourceClass = SOURCE_CLASS.ORIGINAL_ATS;

  identify(urlOrSource, html = '') {
    const det = detectAts(typeof urlOrSource === 'string' ? urlOrSource : (urlOrSource?.careersUrl || urlOrSource?.baseUrl || ''), html);
    return { ...det, matches: det.provider === PROVIDER.GREENHOUSE };
  }

  boardUrl(tenant) { return boardUrlFor(PROVIDER.GREENHOUSE, tenant); }

  async discover(source, ctx = {}) {
    const tenant = source.tenant;
    if (!tenant) return { source, ok: false, reason: 'no board token', errorClass: ERROR_CLASS.PARSE_FAILED };
    const http = ctx.http || this.http;
    try {
      const r = await http.fetchJson(`${API}/${encodeURIComponent(tenant)}/jobs`);
      const count = Array.isArray(r.json?.jobs) ? r.json.jobs.length : 0;
      return {
        source: { ...source, baseUrl: this.boardUrl(tenant), careersUrl: source.careersUrl || this.boardUrl(tenant) },
        ok: true,
        reason: `board reachable, ${count} published jobs`,
        jobCount: count,
      };
    } catch (e) {
      return { source, ok: false, reason: e?.message, errorClass: e?.errorClass || ERROR_CLASS.NETWORK };
    }
  }

  /**
   * Greenhouse returns the whole board in one call. `content=true` includes the
   * HTML description; conditional headers avoid re-downloading an unchanged board.
   */
  async fetchJobs(source, cursor = null, ctx = {}) {
    const http = ctx.http || this.http;
    const tenant = source.tenant;
    if (!tenant) {
      return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.PARSE_FAILED, message: 'no board token' } };
    }
    const url = `${API}/${encodeURIComponent(tenant)}/jobs?content=true`;
    const r = await http.fetchJson(url, { etag: source.http?.etag || null, lastModified: source.http?.lastModified || null });
    if (r.notModified) {
      return { items: [], nextCursor: null, authoritative: false, notModified: true, http: { etag: r.etag, lastModified: r.lastModified, status: 304 } };
    }
    const jobs = Array.isArray(r.json?.jobs) ? r.json.jobs : [];
    return {
      items: jobs,
      nextCursor: null,
      authoritative: true, // complete board listing
      http: { etag: r.etag, lastModified: r.lastModified, status: r.status, url: r.url, bytes: r.bytes },
    };
  }

  normalize(raw, source) {
    const offices = (raw.offices || []).map((o) => o?.name).filter(Boolean);
    const locations = [raw.location?.name, ...offices].filter(Boolean);
    const departments = (raw.departments || []).map((d) => d?.name).filter(Boolean);
    const html = raw.content ? decodeEntities(raw.content) : null;

    /* Greenhouse metadata is a free-form array; only EXPLICIT compensation and
       remote fields are read, and only when the board actually set them. */
    const meta = Array.isArray(raw.metadata) ? raw.metadata : [];
    const metaByName = Object.fromEntries(meta.filter((m) => m?.name).map((m) => [String(m.name).toLowerCase(), m]));
    const salaryMeta = metaByName.salary || metaByName['salary range'] || metaByName.compensation || null;
    const remoteMeta = metaByName.remote || metaByName['remote?'] || metaByName['workplace type'] || null;

    let explicitRemote = null;
    if (remoteMeta && remoteMeta.value != null && remoteMeta.value !== '') {
      const v = String(remoteMeta.value).toLowerCase();
      if (/^(yes|true|remote)$/.test(v)) explicitRemote = true;
      else if (/^(no|false|onsite|on-site)$/.test(v)) explicitRemote = false;
    }

    return {
      sourceJobId: raw.id != null ? String(raw.id) : null,
      requisitionId: raw.requisition_id != null ? String(raw.requisition_id) : null,
      title: raw.title || null,
      company: {
        name: source.companyName || raw.company_name || source.tenant || null,
        website: source.companyWebsite || null,
        domain: source.companyDomain || null,
        logoUrl: null,
      },
      descriptionHtml: html,
      descriptionText: html ? stripHtml(html) : null,
      locationsRaw: locations,
      applicantRegions: [],
      explicitRemote,
      workplaceHint: remoteMeta?.value != null ? String(remoteMeta.value) : null,
      employmentTypeRaw: metaByName['employment type']?.value ?? null,
      department: departments[0] || null,
      jobUrl: raw.absolute_url || null,
      applyUrl: raw.absolute_url ? `${raw.absolute_url}#app` : null,
      /* Greenhouse exposes updated_at, which is NOT a publication date.
         first_published is used when present; otherwise the date stays null
         rather than passing an update time off as a posting time (§37/§58). */
      sourcePublishedAt: raw.first_published || null,
      validThrough: null,
      compensationStructured: null,
      compensationRaw: salaryMeta?.value ? String(salaryMeta.value) : null,
      tags: departments.slice(0, 6),
      extraction: 'GREENHOUSE_API',
      rawHash: sha256(JSON.stringify(raw)),
    };
  }
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export default GreenhouseAdapter;
