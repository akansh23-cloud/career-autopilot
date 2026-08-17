/* ============================================================
   GOOGLE CAREERS — ROBOTS-COMPLIANT DIRECT SOURCE
   ------------------------------------------------------------
   Google exposes the first public jobs-results page to crawlers but explicitly
   disallows the `?page=` pagination form in robots.txt. The generic crawler's
   durable page cursor therefore cannot be used for this host.

   This adapter deliberately requests ONLY the allowed canonical listing page.
   It still uses the generic extraction + normalization ladder so direct Google
   job URLs retain ORIGINAL_CAREER_SITE provenance, but the run is explicitly
   non-authoritative/partial and never tries to bypass Google's crawl policy.
   ============================================================ */

import GenericCareerSiteAdapter from './genericCareerSite.js';
import { ACCESS_POLICY, ERROR_CLASS } from '../schema.js';

export const GOOGLE_CAREERS_LISTING = 'https://www.google.com/about/careers/applications/jobs/results/';

function hostOf(value) {
  try { return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

export function isGoogleCareerSource(source = {}) {
  const urls = [source.careersUrl, source.baseUrl, source.companyWebsite].filter(Boolean);
  if (urls.some((u) => ['google.com', 'careers.google.com'].includes(hostOf(u)))) return true;
  const domain = String(source.companyDomain || '').toLowerCase().replace(/^www\./, '');
  if (domain === 'google.com') return true;
  return /^google$/i.test(String(source.companyName || '').trim());
}

export class GoogleCareersAdapter extends GenericCareerSiteAdapter {
  static matchesSource(source) { return isGoogleCareerSource(source); }

  async fetchJobs(source, _cursor = null, ctx = {}) {
    const http = ctx.http || this.http;
    const requestUrl = GOOGLE_CAREERS_LISTING;

    const access = await this.checkAccess(requestUrl, source);
    if (access.policy !== ACCESS_POLICY.ALLOW) {
      return {
        items: [], nextCursor: null, authoritative: false,
        error: {
          errorClass: access.policy === ACCESS_POLICY.DENY ? ERROR_CLASS.ROBOTS_DENIED : ERROR_CLASS.BLOCKED,
          message: access.policy === ACCESS_POLICY.DENY
            ? access.reason
            : `crawl policy requires review: ${access.reason || 'robots policy not confirmed'}`,
        },
      };
    }

    let page;
    try {
      page = await http.fetch(requestUrl, {
        etag: source.http?.etag || null,
        lastModified: source.http?.lastModified || null,
      });
    } catch (e) {
      return {
        items: [], nextCursor: null, authoritative: false,
        error: { errorClass: e?.errorClass || ERROR_CLASS.NETWORK, message: e?.message },
      };
    }

    if (page.notModified) {
      return {
        items: [], nextCursor: null, authoritative: false, notModified: true,
        partialCoverage: true,
        coverageNote: 'Google direct crawl is limited to the robots-allowed listing surface.',
        http: { etag: page.etag, status: 304, url: requestUrl },
      };
    }

    const result = await this.extractFrom(page.text, page.url, source, ctx);
    if (result.stage) this.stageCounts[result.stage] = (this.stageCounts[result.stage] || 0) + 1;

    return {
      items: result.items || [],
      /* IMPORTANT: Google explicitly disallows jobs/results?page=. Do not emit
         a cursor that would cause runSource() to request that path. */
      nextCursor: null,
      authoritative: false,
      partialCoverage: true,
      coverageNote: 'Google direct crawl is intentionally partial because query pagination is disallowed by robots.txt.',
      stage: result.stage,
      http: {
        etag: page.etag,
        lastModified: page.lastModified,
        status: page.status,
        url: page.url,
        bytes: page.bytes,
      },
    };
  }
}

export default GoogleCareersAdapter;
