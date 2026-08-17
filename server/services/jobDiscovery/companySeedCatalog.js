/* ============================================================
   JOB DISCOVERY OS — DIRECT EMPLOYER CAREER SEED CATALOG
   ------------------------------------------------------------
   The CompanyRegistry is searchable runtime knowledge, not a static
   spreadsheet. This importer gives it a high-quality starting corpus:

     1. 268 Career Autopilot-curated employer career surfaces are bundled
        with the application and can be inserted with zero network.
     2. Curated landing pages are then resolved, in a bounded batch, to the
        final public job-listing/ATS board whenever that target is exposed.
     3. When an operator/cron asks for the 1,000-company catalog, the importer
        extends the corpus from Outscal/OpenJobs' public company dataset and
        persists only company-specific career/ATS URLs (never general job
        boards such as LinkedIn/Indeed).

   External rows are SEEDS, not verified facts. They are explicitly stamped
   SEEDED_UNVERIFIED so later discovery/verification can replace/enrich them.
   The registry remains the source of truth after import.
   ============================================================ */

import fs from 'node:fs';
import { detectAts, boardUrlFor, extractAtsLinks } from './atsDetect.js';
import { PROVIDER } from './schema.js';
import { makeCompany, COMPANY_TYPE } from './companyRegistry.js';
import { registrableDomain, hostOf, normalizeUrl, stripHtml, normalizeWhitespace } from './normalize/text.js';

export const DEFAULT_COMPANY_SEED_TARGET = 1000;
export const OPENJOBS_COMPANY_DATA_URL = 'https://raw.githubusercontent.com/outscal/OpenJobs/main/data/companies_v2.json';
export const CURATED_SEED_SOURCE = 'career-autopilot-curated-2026-08';
export const OPENJOBS_SEED_SOURCE = 'outscal-openjobs';
export const CAREER_RESOLVER_SOURCE = 'career-autopilot-career-target-resolver';
export const DEFAULT_CAREER_RESOLVE_BATCH = 60;

const CURATED_CANONICAL_OVERRIDES = new Map([
  ['NVIDIA', {
    url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
    provider: PROVIDER.WORKDAY,
    tenant: 'nvidia/wd5/NVIDIAExternalCareerSite',
  }],
]);

const STARTUP_SCALEUP_NAMES = new Set([
  'Airbnb','Anduril','Anthropic','BrowserStack','Chargebee','CleverTap','Cohere','Coinbase','Confluent',
  'CRED','Darwinbox','Databricks','Datadog','Delhivery','Dream Sports','Druva','Freshworks','GitLab',
  'Groww','InMobi','Innovaccer','Juspay','Klarna','Lucid Motors','Meesho','MoEngage','MongoDB','OpenAI',
  'Palantir','Paytm','PhonePe','Pine Labs','Postman','Razorpay','Revolut','Rivian','Robinhood','Scale AI',
  'ShareChat','Shiprocket','Shopify','Snowflake','SpaceX','Stripe','Swiggy','Tekion','Udaan','Uniphore',
  'Whatfix','Wise','Zerodha','Zomato','Zoom'
]);

function curatedCompanyType(row) {
  if (row?.companyType && Object.values(COMPANY_TYPE).includes(row.companyType)) {
    return { companyType: row.companyType, companyTypeSource: 'curated-explicit', companyTypeConfidence: 1 };
  }
  if (STARTUP_SCALEUP_NAMES.has(String(row?.name || ''))) {
    return { companyType: COMPANY_TYPE.STARTUP_SCALEUP, companyTypeSource: 'career-autopilot-curated', companyTypeConfidence: 0.95 };
  }
  return { companyType: COMPANY_TYPE.MNC_ENTERPRISE, companyTypeSource: 'career-autopilot-curated', companyTypeConfidence: 0.85 };
}

const CURATED = JSON.parse(fs.readFileSync(
  new URL('./data/company-career-seeds-curated.json', import.meta.url),
  'utf8',
));

const BLOCKED_GENERAL_JOB_HOSTS = [
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'wellfound.com', 'angel.co',
  'ziprecruiter.com', 'simplyhired.com', 'jooble.org', 'talent.com',
  'jobrapido.com', 'jobs2careers.com', 'naukri.com', 'foundit.in',
  'monster.com', 'monsterindia.com', 'shine.com', 'timesjobs.com',
  'remotive.com', 'remoteok.com', 'weworkremotely.com', 'flexjobs.com',
];

const SHARED_ATS_HOSTS = [
  'greenhouse.io', 'greenhouse.com', 'lever.co', 'ashbyhq.com', 'myworkdayjobs.com',
  'smartrecruiters.com', 'workable.com', 'icims.com', 'successfactors.com',
  'successfactors.eu', 'oraclecloud.com', 'taleo.net', 'teamtailor.com',
  'recruitee.com', 'personio.de', 'pinpointhq.com', 'breezy.hr',
  'applytojob.com', 'jobvite.com', 'zohorecruit.com', 'rippling.com',
];

const JOB_BOARD_TEXT_RE = /\b(search|find|view|browse|explore|see|show)\s+(all\s+)?(open\s+)?(jobs?|roles?|positions?|openings?|opportunities|vacancies)\b|\b(current|open)\s+(jobs?|roles?|positions?|openings?|opportunities|vacancies)\b/i;
const JOB_BOARD_PATH_RE = /\/(jobs?|job-search|search-jobs?|careers?\/jobs?|careers?\/search|open-positions?|openings?|positions?|opportunities|vacancies)(?:\/|$)/i;
const SINGLE_JOB_PATH_RE = /\/(jobs?|positions?|roles?|openings?)\/[^/?#]{5,}(?:[/?#]|$)/i;
const BAD_TARGET_RE = /\b(sign[ -]?in|log[ -]?in|register|talent community|join our network|apply now)\b/i;

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
  const override = CURATED_CANONICAL_OVERRIDES.get(String(row.name));
  const careersUrl = override?.url || row.careersUrl;
  const domain = companyDomainFromWebsite(null, row.careersUrl);
  const ats = override
    ? { provider: override.provider, tenant: override.tenant }
    : atsInfo(careersUrl);
  const type = curatedCompanyType(row);
  return makeCompany({
    name: row.name,
    domain,
    website: domain ? `https://${domain}` : null,
    careersUrl,
    atsProvider: ats.provider,
    atsTenant: ats.tenant,
    region: row.region || null,
    industry: row.industry || null,
    ...type,
    indiaRelevance: row.indiaRelevance || null,
    careerUrlStatus: override ? 'CURATED_VERIFIED_ATS' : (ats.provider ? 'CURATED_ATS' : 'CURATED_SURFACE'),
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
    companyType: COMPANY_TYPE.UNKNOWN,
    companyTypeSource: 'external-unclassified',
    companyTypeConfidence: null,
    hiringCountries: Array.isArray(row.countries) ? row.countries.filter(Boolean).slice(0, 100) : [],
    country: Array.isArray(row.countries) && row.countries.length === 1 ? row.countries[0] : null,
    indiaRelevance: Array.isArray(row.countries) && row.countries.some((c) => /^india$/i.test(String(c))) ? 'High' : null,
    careerUrlStatus: ats.provider ? 'SEEDED_ATS_UNVERIFIED' : 'SEEDED_UNVERIFIED',
    seedSource: OPENJOBS_SEED_SOURCE,
    seedRank: rank || null,
    sourceConfidence: ats.provider ? 0.82 : 0.72,
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
      headers: { accept: 'application/json', 'user-agent': 'CareerAutopilot-JobDiscovery/2.2' },
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

async function fetchHtmlBounded(fetchImpl, url, { maxBytes = 1024 * 1024, timeoutMs = 4500 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('career target resolver: fetch is unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'CareerAutopilot-JobDiscovery/2.2 (+career-target-resolution)',
      },
    });
    if (!res.ok) throw new Error(`career page returned HTTP ${res.status}`);
    const length = Number(res.headers?.get?.('content-length') || 0);
    if (length && length > maxBytes) throw new Error(`career page exceeds ${maxBytes} bytes`);
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`career page exceeds ${maxBytes} bytes`);
    return { url: normalizeUrl(res.url || url) || url, text };
  } finally {
    clearTimeout(timer);
  }
}

function scoreBoardLink({ url, text }, baseUrl) {
  let parsed;
  try { parsed = new URL(url, baseUrl); } catch { return -1000; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return -1000;
  const label = normalizeWhitespace(stripHtml(text || '')).slice(0, 180);
  const joined = `${label} ${parsed.pathname} ${parsed.search}`;
  let score = 0;
  if (JOB_BOARD_TEXT_RE.test(label)) score += 12;
  if (JOB_BOARD_PATH_RE.test(parsed.pathname)) score += 8;
  if (/jobs?\./i.test(parsed.hostname) || /careers?\./i.test(parsed.hostname)) score += 3;
  if (/myworkdayjobs\.com|greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|icims\.com|oraclecloud\.com|taleo\.net|workable\.com/i.test(parsed.hostname)) score += 15;
  if (SINGLE_JOB_PATH_RE.test(parsed.pathname)) score -= 16;
  if (BAD_TARGET_RE.test(joined)) score -= 20;
  if (/\/about|\/culture|\/benefits|\/students?|\/internships?|\/locations?|\/teams?\b/i.test(parsed.pathname)) score -= 5;
  return score;
}

export function extractJobBoardCandidates(html, baseUrl) {
  const found = new Map();
  for (const m of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let abs;
    try { abs = new URL(m[1], baseUrl).toString(); } catch { continue; }
    if (!isDirectCareerSeedUrl(abs)) continue;
    const candidate = { url: normalizeUrl(abs), text: normalizeWhitespace(stripHtml(m[2] || '')).slice(0, 180) };
    if (!candidate.url) continue;
    candidate.score = scoreBoardLink(candidate, baseUrl);
    const prior = found.get(candidate.url);
    if (!prior || candidate.score > prior.score) found.set(candidate.url, candidate);
  }
  return [...found.values()].filter((x) => x.score >= 8).sort((a, b) => b.score - a.score);
}

export async function resolveCareerTarget(fetchImpl, company) {
  const inputUrl = normalizeUrl(company?.careersUrl || '');
  if (!inputUrl) return { ok: false, reason: 'missing careers url' };

  const override = CURATED_CANONICAL_OVERRIDES.get(String(company?.name || ''));
  if (override) {
    return {
      ok: true,
      changed: inputUrl !== override.url,
      url: override.url,
      provider: override.provider,
      tenant: override.tenant,
      status: 'RESOLVED_VERIFIED_ATS',
      confidence: 1,
      evidence: 'curated-official-override',
    };
  }

  const inputAts = detectAts(inputUrl);
  if (inputAts.detected && inputAts.provider !== PROVIDER.GENERIC && inputAts.tenant) {
    const board = boardUrlFor(inputAts.provider, inputAts.tenant) || inputUrl;
    return {
      ok: true,
      changed: board !== inputUrl,
      url: board,
      provider: inputAts.provider,
      tenant: inputAts.tenant,
      status: 'RESOLVED_ATS',
      confidence: 0.99,
      evidence: inputAts.evidence,
    };
  }

  let page;
  try {
    page = await fetchHtmlBounded(fetchImpl, inputUrl);
  } catch (e) {
    return { ok: false, reason: e?.message || String(e), url: inputUrl };
  }

  const pageAts = detectAts(page.url, page.text);
  if (pageAts.detected && pageAts.provider !== PROVIDER.GENERIC && pageAts.tenant) {
    const board = boardUrlFor(pageAts.provider, pageAts.tenant) || page.url;
    return {
      ok: true,
      changed: board !== inputUrl,
      url: board,
      provider: pageAts.provider,
      tenant: pageAts.tenant,
      status: 'RESOLVED_ATS',
      confidence: 0.96,
      evidence: pageAts.evidence,
    };
  }

  const atsLinks = extractAtsLinks(page.text, page.url);
  if (atsLinks.length) {
    const best = atsLinks[0];
    const board = boardUrlFor(best.provider, best.tenant) || best.url;
    return {
      ok: true,
      changed: board !== inputUrl,
      url: board,
      provider: best.provider,
      tenant: best.tenant,
      status: 'RESOLVED_ATS_LINK',
      confidence: 0.95,
      evidence: `linked:${best.evidence || best.provider}`,
    };
  }

  const candidates = extractJobBoardCandidates(page.text, page.url);
  if (candidates.length) {
    const best = candidates[0];
    const det = detectAts(best.url);
    const board = det.detected && det.provider !== PROVIDER.GENERIC && det.tenant
      ? (boardUrlFor(det.provider, det.tenant) || best.url)
      : best.url;
    return {
      ok: true,
      changed: board !== inputUrl,
      url: board,
      provider: det.provider !== PROVIDER.GENERIC ? det.provider : null,
      tenant: det.provider !== PROVIDER.GENERIC ? det.tenant : null,
      status: det.provider !== PROVIDER.GENERIC ? 'RESOLVED_ATS_LINK' : 'RESOLVED_JOB_LISTING',
      confidence: det.provider !== PROVIDER.GENERIC ? 0.94 : 0.86,
      evidence: `cta:${best.text || best.url}`,
    };
  }

  if (page.url && page.url !== inputUrl && isDirectCareerSeedUrl(page.url)) {
    return {
      ok: true,
      changed: true,
      url: page.url,
      provider: null,
      tenant: null,
      status: 'RESOLVED_REDIRECT',
      confidence: 0.8,
      evidence: 'http-redirect',
    };
  }

  return { ok: true, changed: false, url: inputUrl, provider: null, tenant: null, status: 'CURATED_SURFACE', confidence: 0.7, evidence: 'no-better-public-target' };
}

async function mapConcurrent(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) break;
      // eslint-disable-next-line no-await-in-loop
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
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

    let corrected = 0;
    if (this.companies) {
      for (const row of rows.filter((r) => r.careerUrlStatus === 'CURATED_VERIFIED_ATS')) {
        // eslint-disable-next-line no-await-in-loop
        const up = await this.companies.upsert(row, { source: CAREER_RESOLVER_SOURCE, confidence: 1 });
        if (up?.changed) corrected += 1;
      }
    }
    return { ok: true, source: CURATED_SEED_SOURCE, requested: rows.length, corrected, ...result };
  }

  async resolveCuratedCareerTargets({ limit = DEFAULT_CAREER_RESOLVE_BATCH, concurrency = 8 } = {}) {
    if (!this.companies || typeof this.fetchImpl !== 'function') {
      return { ok: false, scanned: 0, resolved: 0, changed: 0, reason: 'resolver dependencies unavailable' };
    }
    const all = await this.store.listCompanies({ limit: Math.max(2000, Number(limit) * 4) });
    const candidates = all
      .filter((c) => c.seedSource === CURATED_SEED_SOURCE)
      .filter((c) => c.careersUrl)
      .filter((c) => !/^RESOLVED_|^CURATED_VERIFIED_ATS$/i.test(String(c.careerUrlStatus || '')))
      .sort((a, b) => Number(a.seedRank || 999999) - Number(b.seedRank || 999999))
      .slice(0, Math.max(1, Number(limit) || DEFAULT_CAREER_RESOLVE_BATCH));

    const results = await mapConcurrent(candidates, concurrency, async (company) => {
      const resolved = await resolveCareerTarget(this.fetchImpl, company);
      if (!resolved.ok || !resolved.url) return { company: company.name, ...resolved };
      const patch = {
        name: company.name,
        domain: company.domain,
        website: company.website,
        careersUrl: resolved.url,
        atsProvider: resolved.provider,
        atsTenant: resolved.tenant,
        careerUrlStatus: resolved.status,
        sourceConfidence: Math.max(Number(company.sourceConfidence || 0), Number(resolved.confidence || 0)),
      };
      const up = await this.companies.upsert(patch, {
        source: CAREER_RESOLVER_SOURCE,
        confidence: resolved.confidence || 0.86,
      });
      return { company: company.name, companyId: company.id, upsertChanged: !!up?.changed, ...resolved };
    });

    return {
      ok: true,
      scanned: candidates.length,
      resolved: results.filter((r) => r?.ok).length,
      changed: results.filter((r) => r?.ok && (r.changed || r.upsertChanged)).length,
      atsResolved: results.filter((r) => r?.ok && r.provider).length,
      failures: results.filter((r) => !r?.ok).length,
      results,
    };
  }

  async ensure({ minimum = DEFAULT_COMPANY_SEED_TARGET, includeRemote = true } = {}) {
    const target = Math.max(1, Number(minimum) || DEFAULT_COMPANY_SEED_TARGET);
    const curated = await this.seedCurated();
    const resolution = includeRemote
      ? await this.resolveCuratedCareerTargets({
          limit: Number(process.env.JOB_DISCOVERY_CAREER_RESOLVE_BATCH || DEFAULT_CAREER_RESOLVE_BATCH),
          concurrency: Number(process.env.JOB_DISCOVERY_CAREER_RESOLVE_CONCURRENCY || 8),
        })
      : null;
    let summary = await this.store.companySummary();
    if (summary.seeded >= target || !includeRemote) {
      return { ok: true, target, reached: summary.seeded >= target, curated, resolution, external: null, summary };
    }

    let sourceRows;
    try {
      sourceRows = await fetchJsonBounded(this.fetchImpl, OPENJOBS_COMPANY_DATA_URL);
    } catch (e) {
      return {
        ok: true,
        partial: true,
        target,
        reached: summary.seeded >= target,
        curated,
        resolution,
        external: { ok: false, source: OPENJOBS_SEED_SOURCE, error: e?.message || String(e) },
        summary,
      };
    }
    if (!Array.isArray(sourceRows)) {
      return { ok: false, target, reached: false, curated, resolution, external: { ok: false, error: 'external seed payload is not an array' }, summary };
    }

    const existing = await this.store.listCompanies({ limit: Math.max(target * 2, 2500) });
    const knownNames = new Set(existing.map((c) => String(c.normalizedName || '').toLowerCase()).filter(Boolean));
    const knownDomains = new Set(existing.map((c) => String(c.domain || '').toLowerCase()).filter(Boolean));

    let enrichedExisting = 0;
    if (this.companies) {
      const existingByName = new Map(existing.map((c) => [String(c.normalizedName || '').toLowerCase(), c]));
      for (const row of sourceRows) {
        const candidate = normalizeOpenJobsRow(row);
        if (!candidate?.atsProvider || !candidate.atsTenant || !candidate.careersUrl) continue;
        const prior = existingByName.get(String(candidate.normalizedName || '').toLowerCase());
        if (!prior) continue;
        // eslint-disable-next-line no-await-in-loop
        const up = await this.companies.upsert({
          name: prior.name || candidate.name,
          domain: prior.domain || candidate.domain,
          website: prior.website || candidate.website,
          careersUrl: boardUrlFor(candidate.atsProvider, candidate.atsTenant) || candidate.careersUrl,
          atsProvider: candidate.atsProvider,
          atsTenant: candidate.atsTenant,
          careerUrlStatus: 'EXTERNAL_ATS_ENRICHED',
        }, { source: `${OPENJOBS_SEED_SOURCE}:ats-enrichment`, confidence: 0.9 });
        if (up?.changed) enrichedExisting += 1;
      }
    }

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
      resolution,
      external: { ok: true, source: OPENJOBS_SEED_SOURCE, enrichedExisting, requested: selected.length, ...external },
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
  CAREER_RESOLVER_SOURCE,
  DEFAULT_CAREER_RESOLVE_BATCH,
  isDirectCareerSeedUrl,
  normalizeOpenJobsRow,
  extractJobBoardCandidates,
  resolveCareerTarget,
};
