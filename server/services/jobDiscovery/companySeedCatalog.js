/* ============================================================
   JOB DISCOVERY OS — DIRECT EMPLOYER CAREER SEED CATALOG
   ------------------------------------------------------------
   The CompanyRegistry is searchable runtime knowledge, not a static
   spreadsheet. This importer gives it a high-quality starting corpus:

     1. 268 Career Autopilot-curated direct employer career portals are
        bundled with the application and can be inserted with zero network.
     2. When an operator/cron asks for the 1,000-company catalog, the importer
        extends the corpus from Outscal/OpenJobs' public company dataset and
        persists only company-specific career/ATS URLs (never general job
        boards such as LinkedIn/Indeed).

   External rows are SEEDS, not verified facts. They are explicitly stamped
   SEEDED_UNVERIFIED so later discovery/verification can replace/enrich them.
   The registry remains the source of truth after import.
   ============================================================ */

import fs from 'node:fs';
import { detectAts } from './atsDetect.js';
import { makeCompany } from './companyRegistry.js';
import { registrableDomain, hostOf } from './normalize/text.js';

export const DEFAULT_COMPANY_SEED_TARGET = 1000;
export const OPENJOBS_COMPANY_DATA_URL = 'https://raw.githubusercontent.com/outscal/OpenJobs/main/data/companies_v2.json';
export const CURATED_SEED_SOURCE = 'career-autopilot-curated-2026-08';
export const OPENJOBS_SEED_SOURCE = 'outscal-openjobs';

const CURATED = JSON.parse(fs.readFileSync(
  new URL('./data/company-career-seeds-curated.json', import.meta.url),
  'utf8',
));

/* General recruiter/aggregator hosts are not company career pages. Shared ATS
   hosts are intentionally NOT blocked: a tenant-specific Greenhouse/Lever/etc.
   URL is an original employer source even though the infrastructure is shared. */
const BLOCKED_GENERAL_JOB_HOSTS = [
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'wellfound.com', 'angel.co',
  'ziprecruiter.com', 'simplyhired.com', 'jooble.org', 'talent.com',
  'jobrapido.com', 'jobs2careers.com', 'naukri.com', 'foundit.in',
  'monster.com', 'monsterindia.com', 'shine.com', 'timesjobs.com',
  'remotive.com', 'remoteok.com', 'weworkremotely.com', 'flexjobs.com',
];

/* Shared ATS domains must not be mistaken for the employer's corporate domain. */
const SHARED_ATS_HOSTS = [
  'greenhouse.io', 'greenhouse.com', 'lever.co', 'ashbyhq.com', 'myworkdayjobs.com',
  'smartrecruiters.com', 'workable.com', 'icims.com', 'successfactors.com',
  'successfactors.eu', 'oraclecloud.com', 'taleo.net', 'teamtailor.com',
  'recruitee.com', 'personio.de', 'pinpointhq.com', 'breezy.hr',
  'applytojob.com', 'jobvite.com', 'zohorecruit.com', 'rippling.com',
];

function sameOrSubdomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isDirectCareerSeedUrl(value) {
  try {
    const u = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return false;
    if (BLOCKED_GENERAL_JOB_HOSTS.some((d) => sameOrSubdomain(host, d))) return false;
    return true;
  } catch {
    return false;
  }
}

function companyDomainFromWebsite(website, careersUrl = null) {
  const d = website ? registrableDomain(website) : null;
  if (d) return d;
  const careerHost = hostOf(careersUrl || '');
  if (!careerHost) return null;
  if (SHARED_ATS_HOSTS.some((d0) => sameOrSubdomain(careerHost, d0))) return null;
  return registrableDomain(careerHost);
}

function atsInfo(careersUrl) {
  const det = careersUrl ? detectAts(careersUrl) : null;
  if (!det?.detected || det.provider === 'GENERIC') return { provider: null, tenant: null };
  return { provider: det.provider || null, tenant: det.tenant || null };
}

function normalizeCurated(row, rank) {
  if (!row?.name || !isDirectCareerSeedUrl(row.careersUrl)) return null;
  const domain = companyDomainFromWebsite(null, row.careersUrl);
  const ats = atsInfo(row.careersUrl);
  return makeCompany({
    name: row.name,
    domain,
    website: domain ? `https://${domain}` : null,
    careersUrl: row.careersUrl,
    atsProvider: ats.provider,
    atsTenant: ats.tenant,
    region: row.region || null,
    industry: row.industry || null,
    indiaRelevance: row.indiaRelevance || null,
    careerUrlStatus: 'CURATED_DIRECT',
    seedSource: CURATED_SEED_SOURCE,
    seedRank: Number(row.seedRank || rank),
    sourceConfidence: Number(row.sourceConfidence || 0.9),
  });
}

function bestExternalCareerUrl(row) {
  const candidates = [...(row?.ats_links || []), ...(row?.list_urls || [])]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .filter(isDirectCareerSeedUrl);
  return candidates[0] || null;
}

export function normalizeOpenJobsRow(row, rank = 0) {
  if (!row?.name) return null;
  const careersUrl = bestExternalCareerUrl(row);
  if (!careersUrl) return null;
  const domain = companyDomainFromWebsite(row.website, careersUrl);
  const ats = atsInfo(careersUrl);
  return makeCompany({
    name: String(row.name).trim(),
    domain,
    website: row.website || (domain ? `https://${domain}` : null),
    careersUrl,
    atsProvider: ats.provider,
    atsTenant: ats.tenant,
    industry: row.industry_category || row.type || null,
    hiringCountries: Array.isArray(row.countries) ? row.countries.filter(Boolean).slice(0, 100) : [],
    country: Array.isArray(row.countries) && row.countries.length === 1 ? row.countries[0] : null,
    indiaRelevance: Array.isArray(row.countries) && row.countries.some((c) => /^india$/i.test(String(c))) ? 'High' : null,
    careerUrlStatus: 'SEEDED_UNVERIFIED',
    seedSource: OPENJOBS_SEED_SOURCE,
    seedRank: rank || null,
    sourceConfidence: 0.72,
  });
}

function rankExternal(row) {
  const countries = Array.isArray(row?.countries) ? row.countries : [];
  const india = countries.some((c) => /^india$/i.test(String(c)));
  const tech = String(row?.industry_category || row?.type || '').toLowerCase() === 'tech';
  const ats = bestExternalCareerUrl(row) ? 1 : 0;
  return (ats * 1000) + (india * 400) + (tech * 200) + Math.min(100, countries.length * 5);
}

async function fetchJsonBounded(fetchImpl, url, { maxBytes = 8 * 1024 * 1024, timeoutMs = 25000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('company seed import: fetch is unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'CareerAutopilot-JobDiscovery/2.1' },
    });
    if (!res.ok) throw new Error(`company seed source returned HTTP ${res.status}`);
    const length = Number(res.headers?.get?.('content-length') || 0);
    if (length && length > maxBytes) throw new Error(`company seed source exceeds ${maxBytes} bytes`);
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`company seed source exceeds ${maxBytes} bytes`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

export class CompanySeedCatalog {
  constructor({ store, companies, fetchImpl = globalThis.fetch, logger = console } = {}) {
    this.store = store;
    this.companies = companies;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  curatedEntries() {
    return CURATED.map((r, i) => normalizeCurated(r, i + 1)).filter(Boolean);
  }

  async seedCurated() {
    const rows = this.curatedEntries();
    const result = await this.store.seedCompanies(rows, { seedSource: CURATED_SEED_SOURCE });
    return { ok: true, source: CURATED_SEED_SOURCE, requested: rows.length, ...result };
  }

  async ensure({ minimum = DEFAULT_COMPANY_SEED_TARGET, includeRemote = true } = {}) {
    const target = Math.max(1, Number(minimum) || DEFAULT_COMPANY_SEED_TARGET);
    const curated = await this.seedCurated();
    let summary = await this.store.companySummary();
    if (summary.seeded >= target || !includeRemote) {
      return { ok: true, target, reached: summary.seeded >= target, curated, external: null, summary };
    }

    let sourceRows;
    try {
      sourceRows = await fetchJsonBounded(this.fetchImpl, OPENJOBS_COMPANY_DATA_URL);
    } catch (e) {
      return {
        ok: false,
        target,
        reached: false,
        curated,
        external: { ok: false, source: OPENJOBS_SEED_SOURCE, error: e?.message || String(e) },
        summary,
      };
    }
    if (!Array.isArray(sourceRows)) {
      return { ok: false, target, reached: false, curated, external: { ok: false, error: 'external seed payload is not an array' }, summary };
    }

    const existing = await this.store.listCompanies({ limit: Math.max(target * 2, 2500) });
    const knownNames = new Set(existing.map((c) => String(c.normalizedName || '').toLowerCase()).filter(Boolean));
    const knownDomains = new Set(existing.map((c) => String(c.domain || '').toLowerCase()).filter(Boolean));

    const ranked = sourceRows
      .filter((r) => bestExternalCareerUrl(r))
      .sort((a, b) => rankExternal(b) - rankExternal(a) || String(a.name || '').localeCompare(String(b.name || '')));

    const needed = Math.max(0, target - summary.seeded);
    const selected = [];
    for (const row of ranked) {
      if (selected.length >= needed) break;
      const candidate = normalizeOpenJobsRow(row, curated.requested + selected.length + 1);
      if (!candidate?.id || !candidate.careersUrl) continue;
      const n = String(candidate.normalizedName || '').toLowerCase();
      const d = String(candidate.domain || '').toLowerCase();
      if ((n && knownNames.has(n)) || (d && knownDomains.has(d))) continue;
      if (n) knownNames.add(n);
      if (d) knownDomains.add(d);
      selected.push(candidate);
    }

    const external = await this.store.seedCompanies(selected, { seedSource: OPENJOBS_SEED_SOURCE });
    summary = await this.store.companySummary();
    return {
      ok: true,
      target,
      reached: summary.seeded >= target,
      curated,
      external: { ok: true, source: OPENJOBS_SEED_SOURCE, requested: selected.length, ...external },
      summary,
    };
  }

  async status() {
    return this.store.companySummary();
  }
}

export default {
  CompanySeedCatalog,
  DEFAULT_COMPANY_SEED_TARGET,
  OPENJOBS_COMPANY_DATA_URL,
  CURATED_SEED_SOURCE,
  OPENJOBS_SEED_SOURCE,
  isDirectCareerSeedUrl,
  normalizeOpenJobsRow,
};
