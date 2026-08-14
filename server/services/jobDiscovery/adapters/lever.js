/* ============================================================
   LEVER ADAPTER  (§7.2)
   ------------------------------------------------------------
   Published-postings ingestion with skip/limit pagination and
   the global vs EU endpoint split. Posting id is the stage-1
   dedupe key; hostedUrl/applyUrl are the direct-apply targets.
   ============================================================ */

import { JobSourceAdapter } from './base.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, ERROR_CLASS } from '../schema.js';
import { detectAts, boardUrlFor } from '../atsDetect.js';
import { stripHtml, sha256 } from '../normalize/text.js';

const PAGE_SIZE = 100;
const ENDPOINTS = {
  global: 'https://api.lever.co/v0/postings',
  eu: 'https://api.eu.lever.co/v0/postings',
};

export class LeverAdapter extends JobSourceAdapter {
  static provider = PROVIDER.LEVER;
  static sourceType = SOURCE_TYPE.ATS;
  static sourceClass = SOURCE_CLASS.ORIGINAL_ATS;

  identify(urlOrSource, html = '') {
    const det = detectAts(typeof urlOrSource === 'string' ? urlOrSource : (urlOrSource?.careersUrl || urlOrSource?.baseUrl || ''), html);
    return { ...det, matches: det.provider === PROVIDER.LEVER };
  }

  endpointFor(source) {
    const region = source.region === 'eu' || /\.eu\.lever\.co/i.test(source.baseUrl || '') ? 'eu' : 'global';
    return { region, base: ENDPOINTS[region] };
  }

  /**
   * Lever tenants exist on either the global or the EU stack. Discovery probes
   * global first, then EU, and records which one answered so later crawls hit
   * the right endpoint directly.
   */
  async discover(source, ctx = {}) {
    const http = ctx.http || this.http;
    const tenant = source.tenant;
    if (!tenant) return { source, ok: false, reason: 'no lever site', errorClass: ERROR_CLASS.PARSE_FAILED };
    const order = source.region === 'eu' ? ['eu', 'global'] : ['global', 'eu'];
    let lastError = null;
    for (const region of order) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await http.fetchJson(`${ENDPOINTS[region]}/${encodeURIComponent(tenant)}?mode=json&limit=1`);
        if (Array.isArray(r.json)) {
          return {
            source: {
              ...source, region,
              baseUrl: boardUrlFor(PROVIDER.LEVER, tenant, { region }),
              careersUrl: source.careersUrl || boardUrlFor(PROVIDER.LEVER, tenant, { region }),
            },
            ok: true,
            reason: `lever ${region} endpoint responded`,
          };
        }
        lastError = 'unexpected payload shape';
      } catch (e) { lastError = e?.message; }
    }
    return { source, ok: false, reason: lastError || 'no lever endpoint responded', errorClass: ERROR_CLASS.NETWORK };
  }

  async fetchJobs(source, cursor = null, ctx = {}) {
    const http = ctx.http || this.http;
    const tenant = source.tenant;
    if (!tenant) return { items: [], nextCursor: null, authoritative: false, error: { errorClass: ERROR_CLASS.PARSE_FAILED, message: 'no lever site' } };
    const { base } = this.endpointFor(source);
    const skip = Number(cursor?.skip || 0);
    const url = `${base}/${encodeURIComponent(tenant)}?mode=json&limit=${PAGE_SIZE}&skip=${skip}`;
    const r = await http.fetchJson(url, { etag: skip === 0 ? (source.http?.etag || null) : null });
    if (r.notModified) {
      return { items: [], nextCursor: null, authoritative: false, notModified: true, http: { etag: r.etag, status: 304 } };
    }
    const items = Array.isArray(r.json) ? r.json : [];
    const more = items.length === PAGE_SIZE;
    return {
      items,
      nextCursor: more ? { skip: skip + PAGE_SIZE } : null,
      /* Authoritative only once the full board has been walked. */
      authoritative: !more,
      http: { etag: r.etag, lastModified: r.lastModified, status: r.status, url: r.url, bytes: r.bytes },
    };
  }

  normalize(raw, source) {
    const cat = raw.categories || {};
    const locations = [cat.location, ...(Array.isArray(raw.additional?.locations) ? raw.additional.locations : [])]
      .concat(Array.isArray(raw.categories?.allLocations) ? raw.categories.allLocations : [])
      .filter(Boolean);

    const workplaceType = raw.workplaceType ? String(raw.workplaceType) : null;
    let explicitRemote = null;
    if (workplaceType) {
      if (/remote/i.test(workplaceType)) explicitRemote = true;
      else if (/on-?site|onsite/i.test(workplaceType)) explicitRemote = false;
    }

    const descriptionHtml = [raw.description, raw.additional].filter(Boolean).join('\n') || null;
    const descriptionText = [raw.descriptionPlain, raw.additionalPlain].filter(Boolean).join('\n\n')
      || (descriptionHtml ? stripHtml(descriptionHtml) : null);

    /* Lever's `salaryRange` is only present when the board published one. */
    const salary = raw.salaryRange && (raw.salaryRange.min != null || raw.salaryRange.max != null)
      ? {
        minValue: raw.salaryRange.min ?? null,
        maxValue: raw.salaryRange.max ?? null,
        currency: raw.salaryRange.currency ?? null,
        interval: raw.salaryRange.interval ?? null,
      }
      : null;

    return {
      sourceJobId: raw.id != null ? String(raw.id) : null,
      requisitionId: raw.requisitionId != null ? String(raw.requisitionId) : null,
      title: raw.text || null,
      company: {
        name: source.companyName || raw.categories?.department || source.tenant || null,
        website: source.companyWebsite || null,
        domain: source.companyDomain || null,
        logoUrl: null,
      },
      descriptionHtml,
      descriptionText,
      locationsRaw: locations,
      applicantRegions: [],
      explicitRemote,
      workplaceHint: workplaceType,
      employmentTypeRaw: cat.commitment || null,
      department: cat.department || cat.team || null,
      jobUrl: raw.hostedUrl || null,
      applyUrl: raw.applyUrl || (raw.hostedUrl ? `${raw.hostedUrl}/apply` : null),
      /* createdAt is Lever's publication timestamp for a published posting. */
      sourcePublishedAt: raw.createdAt ?? null,
      validThrough: null,
      compensationStructured: salary,
      compensationRaw: raw.salaryDescriptionPlain || null,
      tags: [cat.team, cat.department, cat.commitment].filter(Boolean).slice(0, 6),
      extraction: 'LEVER_API',
      rawHash: sha256(JSON.stringify(raw)),
    };
  }
}

export default LeverAdapter;
