/* ============================================================
   JOB DISCOVERY OS — PROVIDER SPECS
   ------------------------------------------------------------
   One declaration per provider. Each names the PUBLIC listing
   surface that provider offers to anonymous visitors, and maps it
   onto NormalizedJobInput.

   ACCESS POLICY FOR EVERY SPEC IN THIS FILE:
     - Only endpoints a provider publishes for public job boards are
       used. Nothing here calls a private, partner, internal or
       authenticated API, and nothing here works around a login,
       a CAPTCHA or a block.
     - Where a provider's only listing surface requires a token
       (Comeet, SuccessFactors), the spec is declared with
       requiresCredentials:true. Without configuration it reports
       NOT_CONFIGURED and is skipped — the alternative would be
       scraping around an access control, which this system does
       not do.
     - Where the public surface is a rendered board page, the spec
       uses schema.org JobPosting structured data, which is
       published precisely so that job systems can read it.

   `authoritative` is set per provider and means "absence from a
   successful response proves the job is gone". Only complete board
   listings get it.
   ============================================================ */

import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS } from '../../schema.js';
import { SPEC_STRATEGY } from './specAdapter.js';

const ATS = { sourceType: SOURCE_TYPE.ATS, sourceClass: SOURCE_CLASS.ORIGINAL_ATS };

const enc = encodeURIComponent;

/** First non-empty value. Keeps "unknown stays null" honest in the maps. */
function first(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    return v;
  }
  return null;
}

function listOf(v) {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).filter((x) => x != null && String(x).trim());
}

/* ------------------------------------------------------------------
   RECRUITEE — documented public offers endpoint on the company board.
   ------------------------------------------------------------------ */
export const RECRUITEE_SPEC = {
  provider: PROVIDER.RECRUITEE,
  ...ATS,
  strategy: SPEC_STRATEGY.JSON,
  access: 'public company board endpoint (/api/offers/)',
  listUrl: ({ source }) => `https://${enc(source.tenant)}.recruitee.com/api/offers/`,
  itemsPath: 'offers',
  authoritative: true,
  pagination: { kind: 'none' },
  map: (raw, source) => ({
    sourceJobId: raw.id != null ? String(raw.id) : null,
    requisitionId: first(raw.slug),
    title: first(raw.title),
    companyName: first(raw.company_name, source.companyName),
    descriptionHtml: first(raw.description),
    locationsRaw: listOf(first(raw.location, [raw.city, raw.country].filter(Boolean).join(', '))),
    /* Recruitee states remoteness explicitly; absent means unknown. */
    explicitRemote: typeof raw.remote === 'boolean' ? raw.remote : null,
    workplaceHint: first(raw.remote === true ? 'Remote' : null),
    employmentTypeRaw: first(raw.employment_type_code, raw.employment_type),
    department: first(raw.department),
    jobUrl: first(raw.careers_url, raw.careers_apply_url),
    applyUrl: first(raw.careers_apply_url, raw.careers_url),
    sourcePublishedAt: first(raw.published_at),
    tags: listOf(raw.tags).slice(0, 6),
  }),
};

/* ------------------------------------------------------------------
   PERSONIO — public XML job feed published per company subdomain.
   ------------------------------------------------------------------ */
export const PERSONIO_SPEC = {
  provider: PROVIDER.PERSONIO,
  ...ATS,
  strategy: SPEC_STRATEGY.XML,
  access: 'public XML job feed (/xml)',
  listUrl: ({ source }) => `https://${enc(source.tenant)}.jobs.personio.de/xml`,
  itemTag: 'position',
  authoritative: true,
  map: (raw, source) => ({
    sourceJobId: first(raw.id),
    title: first(raw.name),
    companyName: source.companyName || null,
    descriptionHtml: first(raw.jobDescriptions, raw.jobDescription),
    locationsRaw: listOf(first(raw.office, raw.subcompany)),
    employmentTypeRaw: first(raw.employmentType, raw.schedule),
    department: first(raw.department),
    jobUrl: first(raw.jobUrl),
    sourcePublishedAt: first(raw.createdAt),
    tags: listOf(raw.department).slice(0, 3),
    /* Personio's feed carries no remote flag; it stays unknown rather than
       being guessed from an office name. */
    explicitRemote: null,
  }),
};

/* ------------------------------------------------------------------
   BAMBOOHR — public careers list JSON behind the company board.
   ------------------------------------------------------------------ */
export const BAMBOOHR_SPEC = {
  provider: PROVIDER.BAMBOOHR,
  ...ATS,
  strategy: SPEC_STRATEGY.JSON,
  access: 'public careers board listing (/careers/list)',
  listUrl: ({ source }) => `https://${enc(source.tenant)}.bamboohr.com/careers/list`,
  itemsPath: 'result',
  authoritative: true,
  pagination: { kind: 'none' },
  map: (raw, source) => {
    const loc = raw.location || {};
    const parts = [loc.city, loc.state, loc.country].filter(Boolean).join(', ');
    const remoteFlag = raw.isRemote === true || raw.locationType === 'remote'
      ? true
      : (raw.isRemote === false ? false : null);
    return {
      sourceJobId: raw.id != null ? String(raw.id) : null,
      title: first(raw.jobOpeningName, raw.title),
      companyName: source.companyName || null,
      descriptionText: first(raw.jobOpeningShareUrlDescription),
      locationsRaw: listOf(parts || raw.atsLocation),
      explicitRemote: remoteFlag,
      workplaceHint: first(raw.locationType),
      employmentTypeRaw: first(raw.employmentStatusLabel),
      department: first(raw.departmentLabel, raw.department),
      jobUrl: raw.id != null ? `https://${source.tenant}.bamboohr.com/careers/${raw.id}` : null,
      sourcePublishedAt: first(raw.datePosted, raw.postedDate),
      tags: listOf(raw.departmentLabel).slice(0, 3),
    };
  },
};

/* ------------------------------------------------------------------
   RIPPLING — public ATS board listing for a company slug.
   ------------------------------------------------------------------ */
export const RIPPLING_SPEC = {
  provider: PROVIDER.RIPPLING,
  ...ATS,
  strategy: SPEC_STRATEGY.JSON,
  access: 'public ATS board listing endpoint',
  listUrl: ({ source }) => `https://api.rippling.com/platform/api/ats/v1/board/${enc(source.tenant)}/jobs`,
  items: (json) => (Array.isArray(json) ? json : (Array.isArray(json?.jobs) ? json.jobs : null)),
  authoritative: true,
  pagination: { kind: 'none' },
  map: (raw, source) => ({
    sourceJobId: first(raw.uuid, raw.id) != null ? String(first(raw.uuid, raw.id)) : null,
    requisitionId: first(raw.requisitionId),
    title: first(raw.name, raw.title),
    companyName: source.companyName || null,
    descriptionHtml: first(raw.jobDescription, raw.description),
    locationsRaw: listOf(first(
      raw.workLocation?.label,
      (raw.workLocations || []).map((l) => l?.label).filter(Boolean),
      raw.location,
    )),
    explicitRemote: raw.isRemote === true ? true : (raw.isRemote === false ? false : null),
    workplaceHint: first(raw.workplaceType),
    employmentTypeRaw: first(raw.employmentType),
    department: first(raw.department?.label, raw.department),
    jobUrl: first(raw.url, raw.jobUrl),
    applyUrl: first(raw.applyUrl, raw.url),
    sourcePublishedAt: first(raw.publishedAt, raw.createdAt),
    tags: listOf(raw.department?.label).slice(0, 3),
  }),
};

/* ------------------------------------------------------------------
   PINPOINT — public postings JSON on the company board.
   ------------------------------------------------------------------ */
export const PINPOINT_SPEC = {
  provider: PROVIDER.PINPOINT,
  ...ATS,
  strategy: SPEC_STRATEGY.JSON,
  access: 'public board postings feed (/postings.json)',
  listUrl: ({ source }) => `https://${enc(source.tenant)}.pinpointhq.com/postings.json`,
  items: (json) => (Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : null)),
  authoritative: true,
  pagination: { kind: 'none' },
  map: (raw, source) => {
    const a = raw.attributes || raw;
    return {
      sourceJobId: first(raw.id, a.id) != null ? String(first(raw.id, a.id)) : null,
      title: first(a.title),
      companyName: source.companyName || null,
      descriptionHtml: first(a.description),
      locationsRaw: listOf(first(a.location?.name, a.location, a.city)),
      explicitRemote: a.workplace_type === 'remote' ? true : (a.workplace_type ? false : null),
      workplaceHint: first(a.workplace_type),
      employmentTypeRaw: first(a.employment_type),
      department: first(a.department?.name, a.department),
      jobUrl: first(a.url, a.apply_url),
      applyUrl: first(a.apply_url, a.url),
      sourcePublishedAt: first(a.published_at, a.created_at),
      tags: listOf(a.department?.name).slice(0, 3),
    };
  },
};

/* ------------------------------------------------------------------
   Structured-data boards. These providers render a public board page
   that publishes schema.org JobPosting — the standard machine-readable
   contract for job listings — so no private endpoint is needed.
   ------------------------------------------------------------------ */
export const TEAMTAILOR_SPEC = {
  provider: PROVIDER.TEAMTAILOR,
  ...ATS,
  strategy: SPEC_STRATEGY.HTML_JSONLD,
  access: 'public board page schema.org JobPosting data',
  listUrl: ({ source }) => source.careersUrl || `https://${enc(source.tenant)}.teamtailor.com/jobs`,
  authoritative: false,
};

export const JAZZHR_SPEC = {
  provider: PROVIDER.JAZZHR,
  ...ATS,
  strategy: SPEC_STRATEGY.HTML_JSONLD,
  access: 'public board page schema.org JobPosting data',
  listUrl: ({ source }) => source.careersUrl || `https://${enc(source.tenant)}.applytojob.com/apply`,
  authoritative: false,
};

export const ZOHO_RECRUIT_SPEC = {
  provider: PROVIDER.ZOHO_RECRUIT,
  ...ATS,
  strategy: SPEC_STRATEGY.HTML_JSONLD,
  access: 'public career-site page schema.org JobPosting data',
  listUrl: ({ source }) => source.careersUrl || `https://${enc(source.tenant)}.zohorecruit.com/jobs/Careers`,
  authoritative: false,
};

export const JOBVITE_SPEC = {
  provider: PROVIDER.JOBVITE,
  ...ATS,
  strategy: SPEC_STRATEGY.HTML_JSONLD,
  access: 'public board page schema.org JobPosting data',
  listUrl: ({ source }) => source.careersUrl || `https://jobs.jobvite.com/${enc(source.tenant)}/search`,
  authoritative: false,
};

export const TALEO_SPEC = {
  provider: PROVIDER.TALEO,
  ...ATS,
  strategy: SPEC_STRATEGY.HTML_JSONLD,
  access: 'public career-section page schema.org JobPosting data',
  listUrl: ({ source }) => source.careersUrl || `https://${enc(source.tenant)}.taleo.net/careersection/`,
  authoritative: false,
};

/* ------------------------------------------------------------------
   Credential-gated providers.
   Neither publishes an unauthenticated listing endpoint. They are
   DETECTED and REGISTERED — knowing a company runs Comeet is worth
   keeping — but ingestion stays off until a deployment supplies the
   board token the provider itself issues for this purpose.
   ------------------------------------------------------------------ */
export const COMEET_SPEC = {
  provider: PROVIDER.COMEET,
  ...ATS,
  strategy: SPEC_STRATEGY.JSON,
  requiresCredentials: true,
  credentialHint: 'a Comeet careers-API company token',
  access: 'careers API; company token required by the provider',
  listUrl: ({ source, credentials }) => `https://www.comeet.co/careers-api/2.0/company/${enc(source.tenant)}/positions?token=${enc(credentials?.token || '')}`,
  items: (json) => (Array.isArray(json) ? json : null),
  authoritative: true,
  pagination: { kind: 'none' },
  map: (raw, source) => ({
    sourceJobId: first(raw.uid) != null ? String(raw.uid) : null,
    title: first(raw.name),
    companyName: first(raw.company_name, source.companyName),
    descriptionHtml: first(raw.details?.map?.((d) => d?.value).join('\n'), raw.description),
    locationsRaw: listOf(first(raw.location?.name, [raw.location?.city, raw.location?.country].filter(Boolean).join(', '))),
    explicitRemote: raw.location?.is_remote === true ? true : (raw.location?.is_remote === false ? false : null),
    employmentTypeRaw: first(raw.employment_type),
    department: first(raw.department),
    jobUrl: first(raw.url_comeet_hosted_page, raw.url_active_page),
    applyUrl: first(raw.url_active_page, raw.url_comeet_hosted_page),
    sourcePublishedAt: first(raw.time_updated),
    tags: listOf(raw.department).slice(0, 3),
  }),
};

export const SUCCESSFACTORS_SPEC = {
  provider: PROVIDER.SUCCESSFACTORS,
  ...ATS,
  strategy: SPEC_STRATEGY.JSON,
  requiresCredentials: true,
  credentialHint: 'the tenant career-site search endpoint published by the employer',
  access: 'career-site search endpoint; per-tenant and not uniformly public',
  /* SuccessFactors career sites do not share one public listing URL shape.
     Where an employer publishes one, the deployment configures it; we do not
     guess an endpoint or probe a tenant for an undocumented one. */
  listUrl: ({ source, credentials, offset }) => {
    const base = credentials?.endpoint || source.queries?.endpoint;
    if (!base) return 'about:blank';
    return `${base}${base.includes('?') ? '&' : '?'}$skip=${offset || 0}`;
  },
  items: (json) => (Array.isArray(json?.d?.results) ? json.d.results : (Array.isArray(json?.jobRequisitions) ? json.jobRequisitions : null)),
  authoritative: false,
  pagination: { kind: 'offset', size: 100, maxOffset: 2000 },
  map: (raw, source) => ({
    sourceJobId: first(raw.jobReqId, raw.jobId) != null ? String(first(raw.jobReqId, raw.jobId)) : null,
    title: first(raw.jobTitle, raw.title),
    companyName: source.companyName || null,
    descriptionHtml: first(raw.jobDescription, raw.externalJobDescription),
    locationsRaw: listOf(first(raw.location, raw.city)),
    employmentTypeRaw: first(raw.employmentType),
    department: first(raw.department),
    jobUrl: first(raw.applyUrl, raw.jobUrl),
    sourcePublishedAt: first(raw.postingStartDate, raw.createdDateTime),
    explicitRemote: null,
  }),
};

export const PROVIDER_SPECS = Object.freeze([
  RECRUITEE_SPEC, PERSONIO_SPEC, BAMBOOHR_SPEC, RIPPLING_SPEC, PINPOINT_SPEC,
  TEAMTAILOR_SPEC, JAZZHR_SPEC, ZOHO_RECRUIT_SPEC, JOBVITE_SPEC, TALEO_SPEC,
  COMEET_SPEC, SUCCESSFACTORS_SPEC,
]);

export default PROVIDER_SPECS;
