/* ============================================================
   JOB DISCOVERY OS — ATS DETECTION  (§8)
   ------------------------------------------------------------
   DETECTION IS SEPARATE FROM INGESTION. A provider can be
   DETECTED while SUPPORTED === false, meaning we know exactly
   what the company uses but have no connector for it yet. That
   is a registry entry worth keeping, not a failure.
   ============================================================ */

import { PROVIDER } from './schema.js';
import { hostOf } from './normalize/text.js';

/**
 * Each signature: host patterns, URL-path patterns, HTML markers and the
 * tenant extractor for that provider's canonical board URL shape.
 */
export const ATS_SIGNATURES = [
  {
    provider: PROVIDER.GREENHOUSE,
    hosts: [/(^|\.)greenhouse\.io$/i, /(^|\.)boards\.greenhouse\.io$/i, /(^|\.)job-boards\.greenhouse\.io$/i],
    paths: [/\/embed\/job_board/i, /\/boards\/[a-z0-9_-]+/i],
    html: [/boards\.greenhouse\.io/i, /grnhse_app/i, /greenhouse\.io\/embed\/job_board/i, /id="grnhse_iframe"/i],
    tenant: (url) => {
      /* `?for=` wins: an embed script URL is /embed/job_board/js?for=TENANT, and
         reading the path first would capture the literal segment "embed". */
      const m = String(url).match(/[?&]for=([a-z0-9_-]+)/i)
        || String(url).match(/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\/?)?([a-z0-9_-]+)/i);
      const t = m ? m[1].toLowerCase() : null;
      return t && t !== 'embed' && t !== 'job_board' ? t : null;
    },
  },
  {
    provider: PROVIDER.LEVER,
    hosts: [/(^|\.)lever\.co$/i, /(^|\.)jobs\.lever\.co$/i, /(^|\.)jobs\.eu\.lever\.co$/i],
    paths: [/^\/[a-z0-9_-]+\/?$/i],
    html: [/jobs\.lever\.co/i, /api\.lever\.co\/v0\/postings/i, /lever-job/i],
    tenant: (url) => {
      const m = String(url).match(/jobs(?:\.eu)?\.lever\.co\/([a-z0-9_.-]+)/i);
      return m ? m[1].toLowerCase() : null;
    },
  },
  {
    provider: PROVIDER.ASHBY,
    hosts: [/(^|\.)ashbyhq\.com$/i, /(^|\.)jobs\.ashbyhq\.com$/i],
    paths: [/^\/[a-z0-9_-]+/i],
    html: [/jobs\.ashbyhq\.com/i, /ashby_embed/i, /api\.ashbyhq\.com\/posting-api/i],
    tenant: (url) => {
      const m = String(url).match(/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i);
      return m ? m[1].toLowerCase() : null;
    },
  },
  {
    provider: PROVIDER.WORKABLE,
    hosts: [/(^|\.)workable\.com$/i, /(^|\.)apply\.workable\.com$/i],
    paths: [/^\/[a-z0-9_-]+/i],
    html: [/apply\.workable\.com/i, /workable\.com\/embed/i, /whr_embed/i],
    tenant: (url) => {
      const m = String(url).match(/apply\.workable\.com\/([a-z0-9_.-]+)/i)
        || String(url).match(/([a-z0-9_-]+)\.workable\.com/i);
      return m && m[1] !== 'apply' && m[1] !== 'www' ? m[1].toLowerCase() : null;
    },
  },
  {
    provider: PROVIDER.SMARTRECRUITERS,
    hosts: [/(^|\.)smartrecruiters\.com$/i, /(^|\.)careers\.smartrecruiters\.com$/i],
    paths: [/^\/[A-Za-z0-9_-]+/],
    html: [/smartrecruiters\.com/i, /api\.smartrecruiters\.com\/v1\/companies/i],
    tenant: (url) => {
      const m = String(url).match(/(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_.-]+)/i)
        || String(url).match(/api\.smartrecruiters\.com\/v1\/companies\/([A-Za-z0-9_.-]+)/i);
      return m ? m[1] : null;
    },
  },
  {
    provider: PROVIDER.WORKDAY,
    hosts: [/(^|\.)myworkdayjobs\.com$/i, /(^|\.)myworkdaysite\.com$/i, /(^|\.)workday\.com$/i],
    paths: [/\/wday\//i, /\/en-US\//i],
    html: [/myworkdayjobs\.com/i, /wd\d+\.myworkdayjobs/i, /workday/i],
    tenant: (url) => {
      const m = String(url).match(/https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/([^/?#]+)/i);
      return m ? `${m[1]}/${m[2]}/${m[3]}` : null;
    },
  },
  {
    provider: PROVIDER.SUCCESSFACTORS,
    hosts: [/(^|\.)successfactors\.com$/i, /(^|\.)successfactors\.eu$/i, /(^|\.)sapsf\.com$/i],
    paths: [/\/career/i],
    html: [/successfactors/i, /sapsf/i, /jobs\.sap\.com/i],
    tenant: (url) => {
      const m = String(url).match(/[?&]company=([A-Za-z0-9_.-]+)/i);
      return m ? m[1] : null;
    },
  },
  {
    provider: PROVIDER.ICIMS,
    hosts: [/(^|\.)icims\.com$/i],
    paths: [/\/jobs\//i],
    html: [/icims\.com/i, /icimsJobsIframe/i],
    tenant: (url) => {
      const m = String(url).match(/https?:\/\/([a-z0-9-]+)\.icims\.com/i);
      return m ? m[1].toLowerCase() : null;
    },
  },
  {
    provider: PROVIDER.RECRUITEE,
    hosts: [/(^|\.)recruitee\.com$/i],
    paths: [/^\/o\//i],
    html: [/recruitee\.com/i, /careers-page/i],
    tenant: (url) => {
      const m = String(url).match(/https?:\/\/([a-z0-9-]+)\.recruitee\.com/i);
      return m ? m[1].toLowerCase() : null;
    },
  },
  {
    provider: PROVIDER.PERSONIO,
    hosts: [/(^|\.)jobs\.personio\.(de|com)$/i, /(^|\.)personio\.de$/i],
    paths: [/\/job\//i],
    html: [/personio\.de/i, /personio\.com/i],
    tenant: (url) => {
      const m = String(url).match(/https?:\/\/([a-z0-9-]+)\.jobs\.personio\./i);
      return m ? m[1].toLowerCase() : null;
    },
  },
  {
    provider: PROVIDER.TEAMTAILOR,
    hosts: [/(^|\.)teamtailor\.com$/i],
    paths: [/\/jobs\//i],
    html: [/teamtailor\.com/i],
    tenant: (url) => {
      const m = String(url).match(/https?:\/\/([a-z0-9-]+)\.teamtailor\.com/i);
      return m ? m[1].toLowerCase() : null;
    },
  },
  {
    provider: PROVIDER.BAMBOOHR,
    hosts: [/(^|\.)bamboohr\.com$/i],
    paths: [/\/jobs\//i, /\/careers/i],
    html: [/bamboohr\.com\/jobs/i, /BambooHR/i],
    tenant: (url) => {
      const m = String(url).match(/https?:\/\/([a-z0-9-]+)\.bamboohr\.com/i);
      return m ? m[1].toLowerCase() : null;
    },
  },
  {
    provider: PROVIDER.JOBVITE,
    hosts: [/(^|\.)jobvite\.com$/i],
    paths: [/\/careers/i, /\/job\//i],
    html: [/jobvite\.com/i],
    tenant: (url) => {
      const m = String(url).match(/jobs\.jobvite\.com\/([a-z0-9-]+)/i);
      return m ? m[1].toLowerCase() : null;
    },
  },
];

/** Which providers actually have a working connector in THIS build. */
export const SUPPORTED_PROVIDERS = new Set([
  PROVIDER.GREENHOUSE, PROVIDER.LEVER, PROVIDER.ASHBY, PROVIDER.WORKABLE,
  PROVIDER.SMARTRECRUITERS, PROVIDER.GENERIC, PROVIDER.API,
]);

export const CAREER_PATH_HINTS = [
  '/careers', '/career', '/jobs', '/join-us', '/join', '/work-with-us',
  '/company/careers', '/about/careers', '/en/careers', '/careers/jobs',
  '/opportunities', '/vacancies', '/hiring', '/life-at', '/we-are-hiring',
];

/**
 * Fingerprint a URL and (optionally) the HTML served at it.
 *
 * @returns {{ provider, detected, supported, tenant, confidence, evidence }}
 */
export function detectAts(urlOrSource, html = '') {
  const url = String(urlOrSource || '');
  const host = hostOf(url) || '';
  const path = (() => { try { return new URL(url).pathname + (new URL(url).search || ''); } catch { return ''; } })();

  for (const sig of ATS_SIGNATURES) {
    const hostHit = sig.hosts.some((re) => re.test(host));
    if (hostHit) {
      const tenant = sig.tenant(url);
      return {
        provider: sig.provider,
        detected: true,
        supported: SUPPORTED_PROVIDERS.has(sig.provider),
        tenant,
        confidence: tenant ? 0.98 : 0.85,
        evidence: `host:${host}`,
      };
    }
  }

  if (html) {
    for (const sig of ATS_SIGNATURES) {
      const marker = sig.html.find((re) => re.test(html));
      if (marker) {
        /* Tenant may live in an embed URL inside the page rather than in our URL. */
        let tenant = sig.tenant(url);
        if (!tenant) {
          const embedded = html.match(new RegExp(`https?://[^"'\\s]*${sig.provider === PROVIDER.GREENHOUSE ? 'greenhouse\\.io' : ''}[^"'\\s]*`, 'i'));
          if (embedded) tenant = sig.tenant(embedded[0]);
          if (!tenant) {
            for (const m of html.matchAll(/https?:\/\/[^"'\s<>]+/g)) {
              const t = sig.tenant(m[0]);
              if (t && sig.hosts.some((re) => re.test(hostOf(m[0]) || ''))) { tenant = t; break; }
            }
          }
        }
        return {
          provider: sig.provider,
          detected: true,
          supported: SUPPORTED_PROVIDERS.has(sig.provider),
          tenant: tenant || null,
          confidence: tenant ? 0.9 : 0.7,
          evidence: `html:${String(marker).slice(0, 60)}`,
        };
      }
    }
  }

  const looksLikeCareers = CAREER_PATH_HINTS.some((p) => path.toLowerCase().startsWith(p))
    || /careers?\./i.test(host)
    || /\/(careers?|jobs|vacancies)(\/|$)/i.test(path);

  return {
    provider: PROVIDER.GENERIC,
    detected: looksLikeCareers,
    supported: true, // the universal crawler handles GENERIC
    tenant: null,
    confidence: looksLikeCareers ? 0.4 : 0.1,
    evidence: looksLikeCareers ? `path:${path}` : 'none',
  };
}

/** Canonical board URL for a detected tenant, when the provider has one. */
export function boardUrlFor(provider, tenant, { region = 'us' } = {}) {
  if (!tenant) return null;
  switch (provider) {
    case PROVIDER.GREENHOUSE: return `https://boards.greenhouse.io/${tenant}`;
    case PROVIDER.LEVER: return region === 'eu' ? `https://jobs.eu.lever.co/${tenant}` : `https://jobs.lever.co/${tenant}`;
    case PROVIDER.ASHBY: return `https://jobs.ashbyhq.com/${tenant}`;
    case PROVIDER.WORKABLE: return `https://apply.workable.com/${tenant}/`;
    case PROVIDER.SMARTRECRUITERS: return `https://careers.smartrecruiters.com/${tenant}`;
    case PROVIDER.RECRUITEE: return `https://${tenant}.recruitee.com/`;
    case PROVIDER.TEAMTAILOR: return `https://${tenant}.teamtailor.com/jobs`;
    case PROVIDER.BAMBOOHR: return `https://${tenant}.bamboohr.com/jobs/`;
    default: return null;
  }
}

/** Extract every ATS board URL referenced anywhere in a page. */
export function extractAtsLinks(html, baseUrl = '') {
  const found = new Map();
  const text = String(html || '');
  for (const m of text.matchAll(/(?:href|src|content|action)\s*=\s*["']([^"']+)["']/gi)) {
    let abs;
    try { abs = baseUrl ? new URL(m[1], baseUrl).toString() : m[1]; } catch { continue; }
    const det = detectAts(abs);
    if (det.detected && det.provider !== PROVIDER.GENERIC && det.tenant) {
      const key = `${det.provider}:${det.tenant}`;
      if (!found.has(key)) found.set(key, { ...det, url: abs });
    }
  }
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
    const det = detectAts(m[0]);
    if (det.detected && det.provider !== PROVIDER.GENERIC && det.tenant) {
      const key = `${det.provider}:${det.tenant}`;
      if (!found.has(key)) found.set(key, { ...det, url: m[0] });
    }
  }
  return [...found.values()];
}

export default { detectAts, boardUrlFor, extractAtsLinks, ATS_SIGNATURES, SUPPORTED_PROVIDERS, CAREER_PATH_HINTS };
