/* ============================================================
   JOB DISCOVERY OS — CANONICAL SCHEMA
   ------------------------------------------------------------
   ONE authoritative normalized job model. Every adapter, crawler
   and search path emits/consumes this shape. Provider-specific
   objects must NEVER leak past normalize().

   Hard rules encoded here:
     - unknown stays null. No default "today", no default salary,
       no default remote status.
     - sourcePublishedAt / firstSeenAt / lastSeenAt / lastVerifiedAt
       are four DIFFERENT facts and are never substituted.
     - every canonical field carries recoverable provenance.
   ============================================================ */

export const JOB_DOCUMENT_SCHEMA_VERSION = 1;
export const RAW_SNAPSHOT_SCHEMA_VERSION = 1;
export const NORMALIZER_VERSION = 1;
export const DEDUPE_ALGORITHM_VERSION = 1;

export const JOB_STATUS = Object.freeze({
  NEW: 'NEW',
  ACTIVE: 'ACTIVE',
  LIKELY_ACTIVE: 'LIKELY_ACTIVE',
  STALE: 'STALE',
  REMOVED: 'REMOVED',
});
export const JOB_STATUSES = Object.freeze(Object.values(JOB_STATUS));

export const WORKPLACE_TYPE = Object.freeze({
  REMOTE: 'REMOTE',
  HYBRID: 'HYBRID',
  ONSITE: 'ONSITE',
  UNKNOWN: 'UNKNOWN',
});

/* Remote eligibility must be evidence-based. "Remote — US" is NOT worldwide. */
export const REMOTE_SCOPE = Object.freeze({
  REMOTE_WORLDWIDE: 'REMOTE_WORLDWIDE',
  REMOTE_REGION: 'REMOTE_REGION',
  REMOTE_COUNTRY: 'REMOTE_COUNTRY',
  HYBRID: 'HYBRID',
  ONSITE: 'ONSITE',
  UNKNOWN: 'UNKNOWN',
});

export const PROVIDER = Object.freeze({
  GREENHOUSE: 'GREENHOUSE',
  LEVER: 'LEVER',
  ASHBY: 'ASHBY',
  WORKABLE: 'WORKABLE',
  SMARTRECRUITERS: 'SMARTRECRUITERS',
  WORKDAY: 'WORKDAY',
  SUCCESSFACTORS: 'SUCCESSFACTORS',
  ICIMS: 'ICIMS',
  RECRUITEE: 'RECRUITEE',
  PERSONIO: 'PERSONIO',
  TEAMTAILOR: 'TEAMTAILOR',
  BAMBOOHR: 'BAMBOOHR',
  JOBVITE: 'JOBVITE',
  ORACLE_RECRUITING: 'ORACLE_RECRUITING',
  TALEO: 'TALEO',
  COMEET: 'COMEET',
  JAZZHR: 'JAZZHR',
  PINPOINT: 'PINPOINT',
  RIPPLING: 'RIPPLING',
  ZOHO_RECRUIT: 'ZOHO_RECRUIT',
  GENERIC: 'GENERIC',
  API: 'API',
});

export const SOURCE_TYPE = Object.freeze({
  ATS: 'ATS',
  CAREER_SITE: 'CAREER_SITE',
  FEED: 'FEED',
  AGGREGATOR: 'AGGREGATOR',
});

/* Source CLASS drives conflict resolution authority (§39). */
export const SOURCE_CLASS = Object.freeze({
  ORIGINAL_CAREER_SITE: 'ORIGINAL_CAREER_SITE',
  ORIGINAL_ATS: 'ORIGINAL_ATS',
  TRUSTED_FEED: 'TRUSTED_FEED',
  AGGREGATOR: 'AGGREGATOR',
});

/* Higher wins. Preserved as data so tests can assert the ordering. */
export const SOURCE_AUTHORITY = Object.freeze({
  [SOURCE_CLASS.ORIGINAL_CAREER_SITE]: 400,
  [SOURCE_CLASS.ORIGINAL_ATS]: 300,
  [SOURCE_CLASS.TRUSTED_FEED]: 200,
  [SOURCE_CLASS.AGGREGATOR]: 100,
});

export const SOURCE_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  DEGRADED: 'DEGRADED',
  DISABLED: 'DISABLED',
  REVIEW: 'REVIEW',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
});

export const ACCESS_POLICY = Object.freeze({
  ALLOW: 'ALLOW',
  DENY: 'DENY',
  REVIEW: 'REVIEW',
});

/* Normalized failure classifications (§43). */
export const ERROR_CLASS = Object.freeze({
  NETWORK: 'NETWORK',
  RATE_LIMIT: 'RATE_LIMIT',
  ROBOTS_DENIED: 'ROBOTS_DENIED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  SCHEMA_CHANGED: 'SCHEMA_CHANGED',
  PARSE_FAILED: 'PARSE_FAILED',
  TIMEOUT: 'TIMEOUT',
  BLOCKED: 'BLOCKED',
  SSRF_BLOCKED: 'SSRF_BLOCKED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  UNKNOWN: 'UNKNOWN',
});

export const EMPLOYMENT_TYPE = Object.freeze({
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  CONTRACT: 'CONTRACT',
  TEMPORARY: 'TEMPORARY',
  INTERNSHIP: 'INTERNSHIP',
  VOLUNTEER: 'VOLUNTEER',
  OTHER: 'OTHER',
  UNKNOWN: 'UNKNOWN',
});

export const SENIORITY = Object.freeze({
  INTERN: 'INTERN',
  ENTRY: 'ENTRY',
  MID: 'MID',
  SENIOR: 'SENIOR',
  STAFF: 'STAFF',
  PRINCIPAL: 'PRINCIPAL',
  LEAD: 'LEAD',
  MANAGER: 'MANAGER',
  DIRECTOR: 'DIRECTOR',
  EXECUTIVE: 'EXECUTIVE',
  UNKNOWN: 'UNKNOWN',
});

/* ------------------------------------------------------------------
   Factories. Everything defaults to null/UNKNOWN — never to a guess.
   ------------------------------------------------------------------ */

export function makeCompany(partial = {}) {
  return {
    name: partial.name ?? '',
    normalizedName: partial.normalizedName ?? '',
    domain: partial.domain ?? null,
    website: partial.website ?? null,
    logoUrl: partial.logoUrl ?? null,
  };
}

export function makeLocation(partial = {}) {
  return {
    raw: partial.raw ?? '',
    country: partial.country ?? null,
    countryCode: partial.countryCode ?? null,
    region: partial.region ?? null,
    city: partial.city ?? null,
  };
}

export function makeCompensation(partial = {}) {
  return {
    min: partial.min ?? null,
    max: partial.max ?? null,
    currency: partial.currency ?? null,
    period: partial.period ?? null, // HOUR | DAY | MONTH | YEAR
    raw: partial.raw ?? null,
  };
}

export function makeSourceInstance(partial = {}) {
  return {
    sourceId: partial.sourceId ?? null,
    sourceType: partial.sourceType ?? SOURCE_TYPE.AGGREGATOR,
    sourceClass: partial.sourceClass ?? SOURCE_CLASS.AGGREGATOR,
    provider: partial.provider ?? PROVIDER.GENERIC,
    tenant: partial.tenant ?? null,
    sourceJobId: partial.sourceJobId ?? null,
    requisitionId: partial.requisitionId ?? null,
    jobUrl: partial.jobUrl ?? null,
    applyUrl: partial.applyUrl ?? null,
    sourcePublishedAt: partial.sourcePublishedAt ?? null,
    firstSeenAt: partial.firstSeenAt ?? null,
    lastSeenAt: partial.lastSeenAt ?? null,
    lastVerifiedAt: partial.lastVerifiedAt ?? null,
    rawHash: partial.rawHash ?? null,
    active: partial.active !== false,
    missCount: partial.missCount ?? 0,
    /* The normalized values THIS source asserted. Kept so a disagreement
       between sources is recoverable rather than silently overwritten. */
    asserted: partial.asserted ?? {},
  };
}

/**
 * Canonical job document. Callers MUST NOT add provider-shaped fields.
 */
export function makeJobDocument(partial = {}) {
  const now = partial.now || new Date().toISOString();
  const doc = {
    schemaVersion: JOB_DOCUMENT_SCHEMA_VERSION,
    normalizerVersion: partial.normalizerVersion ?? NORMALIZER_VERSION,

    id: partial.id ?? null,

    company: makeCompany(partial.company),

    title: partial.title ?? '',
    normalizedTitle: partial.normalizedTitle ?? '',
    titleFamily: partial.titleFamily ?? null,
    titleFamilies: partial.titleFamilies ?? [],

    description: {
      text: partial.description?.text ?? '',
      html: partial.description?.html ?? null,
    },

    employmentType: partial.employmentType ?? EMPLOYMENT_TYPE.UNKNOWN,
    department: partial.department ?? null,
    seniority: partial.seniority ?? SENIORITY.UNKNOWN,

    locations: Array.isArray(partial.locations) ? partial.locations.map(makeLocation) : [],

    workplace: {
      type: partial.workplace?.type ?? WORKPLACE_TYPE.UNKNOWN,
      remoteScope: partial.workplace?.remoteScope ?? REMOTE_SCOPE.UNKNOWN,
      remoteRegions: partial.workplace?.remoteRegions ?? [],
      evidence: partial.workplace?.evidence ?? null,
    },

    compensation: makeCompensation(partial.compensation),

    /* FOUR DISTINCT FACTS. Never substituted for one another. */
    sourcePublishedAt: partial.sourcePublishedAt ?? null,
    validThrough: partial.validThrough ?? null,
    firstSeenAt: partial.firstSeenAt ?? now,
    lastSeenAt: partial.lastSeenAt ?? now,
    lastVerifiedAt: partial.lastVerifiedAt ?? null,
    lastChangedAt: partial.lastChangedAt ?? null,
    closedAt: partial.closedAt ?? null,

    status: partial.status ?? JOB_STATUS.NEW,

    canonicalApplyUrl: partial.canonicalApplyUrl ?? null,
    canonicalJobUrl: partial.canonicalJobUrl ?? null,

    sourceInstances: Array.isArray(partial.sourceInstances)
      ? partial.sourceInstances.map(makeSourceInstance)
      : [],

    contentHash: partial.contentHash ?? null,
    previousContentHash: partial.previousContentHash ?? null,
    dedupeFingerprint: partial.dedupeFingerprint ?? null,
    shingleSignature: partial.shingleSignature ?? [],

    /* provenance[field] = { sourceId, sourceClass, provider, value, at } */
    provenance: partial.provenance ?? {},
    /* conflicts[field] = [{ sourceId, sourceClass, value }] — retained, never dropped */
    conflicts: partial.conflicts ?? {},

    sourceConfidence: partial.sourceConfidence ?? 0,
    completeness: partial.completeness ?? 0,
    completenessFlags: partial.completenessFlags ?? {},

    tags: partial.tags ?? [],
  };
  return doc;
}

/* Transparent completeness. Missing data is REPORTED, never filled in. */
export function completenessFlags(job = {}) {
  return {
    hasTitle: !!job.title,
    hasCompany: !!job.company?.name,
    hasDescription: String(job.description?.text || '').trim().length >= 40,
    hasLocation: Array.isArray(job.locations) && job.locations.length > 0,
    hasApplyUrl: !!job.canonicalApplyUrl,
    hasJobUrl: !!job.canonicalJobUrl,
    hasPublishedDate: !!job.sourcePublishedAt,
    hasSalary: job.compensation?.min != null || job.compensation?.max != null,
    hasEmploymentType: !!job.employmentType && job.employmentType !== EMPLOYMENT_TYPE.UNKNOWN,
    hasRemoteClassification: !!job.workplace?.type && job.workplace.type !== WORKPLACE_TYPE.UNKNOWN,
    hasSeniority: !!job.seniority && job.seniority !== SENIORITY.UNKNOWN,
  };
}

const COMPLETENESS_WEIGHTS = {
  hasTitle: 14, hasCompany: 14, hasDescription: 16, hasLocation: 10,
  hasApplyUrl: 14, hasJobUrl: 6, hasPublishedDate: 8, hasSalary: 6,
  hasEmploymentType: 4, hasRemoteClassification: 6, hasSeniority: 2,
};

export function computeCompleteness(job = {}) {
  const flags = completenessFlags(job);
  let total = 0; let got = 0;
  for (const [k, w] of Object.entries(COMPLETENESS_WEIGHTS)) {
    total += w;
    if (flags[k]) got += w;
  }
  return { flags, completeness: total ? Math.round((got / total) * 100) : 0 };
}

/** Confidence in the canonical record, driven by the BEST source class present. */
export function computeSourceConfidence(job = {}) {
  const instances = job.sourceInstances || [];
  if (!instances.length) return 0;
  const best = Math.max(...instances.map((s) => SOURCE_AUTHORITY[s.sourceClass] ?? 0));
  const base = Math.round((best / 400) * 80);
  const corroboration = Math.min(20, (new Set(instances.map((s) => s.sourceId)).size - 1) * 7);
  return Math.max(0, Math.min(100, base + corroboration));
}

/**
 * Record provenance for a field without destroying disagreement.
 * Returns true when the incoming value WON authority.
 */
export function recordProvenance(job, field, value, instance, at) {
  if (value == null || value === '' ) return false;
  const incomingAuthority = SOURCE_AUTHORITY[instance?.sourceClass] ?? 0;
  const existing = job.provenance?.[field];
  const existingAuthority = existing ? (SOURCE_AUTHORITY[existing.sourceClass] ?? 0) : -1;
  const entry = {
    sourceId: instance?.sourceId ?? null,
    sourceClass: instance?.sourceClass ?? null,
    provider: instance?.provider ?? null,
    value,
    at: at || new Date().toISOString(),
  };
  job.provenance = job.provenance || {};
  job.conflicts = job.conflicts || {};

  if (existing && JSON.stringify(existing.value) !== JSON.stringify(value)) {
    const list = job.conflicts[field] || [];
    const loser = incomingAuthority > existingAuthority ? existing : entry;
    if (!list.some((c) => c.sourceId === loser.sourceId && JSON.stringify(c.value) === JSON.stringify(loser.value))) {
      list.push({ sourceId: loser.sourceId, sourceClass: loser.sourceClass, value: loser.value, at: loser.at });
    }
    job.conflicts[field] = list;
  }

  if (incomingAuthority > existingAuthority) {
    job.provenance[field] = entry;
    return true;
  }
  return false;
}

export function finalizeJobDocument(job) {
  const { flags, completeness } = computeCompleteness(job);
  job.completenessFlags = flags;
  job.completeness = completeness;
  job.sourceConfidence = computeSourceConfidence(job);
  return job;
}

export default {
  JOB_DOCUMENT_SCHEMA_VERSION, RAW_SNAPSHOT_SCHEMA_VERSION, NORMALIZER_VERSION,
  DEDUPE_ALGORITHM_VERSION,
  JOB_STATUS, JOB_STATUSES, WORKPLACE_TYPE, REMOTE_SCOPE, PROVIDER, SOURCE_TYPE,
  SOURCE_CLASS, SOURCE_AUTHORITY, SOURCE_STATUS, ACCESS_POLICY, ERROR_CLASS,
  EMPLOYMENT_TYPE, SENIORITY,
  makeJobDocument, makeSourceInstance, makeCompany, makeLocation, makeCompensation,
  completenessFlags, computeCompleteness, computeSourceConfidence,
  recordProvenance, finalizeJobDocument,
};
