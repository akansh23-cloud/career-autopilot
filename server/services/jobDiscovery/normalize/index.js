/* ============================================================
   JOB DISCOVERY OS — NORMALIZATION ORCHESTRATOR
   ------------------------------------------------------------
   Adapter output (NormalizedJobInput) -> canonical JobDocument.
   Every canonical field written here also writes provenance, so
   §38 ("which source said remote?") is answerable by construction.
   ============================================================ */

import {
  makeJobDocument, makeSourceInstance, finalizeJobDocument, recordProvenance,
  NORMALIZER_VERSION, JOB_STATUS, SOURCE_CLASS,
} from '../schema.js';
import {
  stripHtml, normalizeWhitespace, normalizeUrl, contentNormalize, sha256,
  minhashSignature, parseSourceDate, registrableDomain, hostOf, tokens,
} from './text.js';
import { normalizeCompany, normalizeTitle, normalizeEmploymentType } from './entity.js';
import { parseLocations, classifyWorkplace } from './location.js';
import { normalizeCompensation } from './compensation.js';

/**
 * @typedef NormalizedJobInput
 * Emitted by EVERY adapter. Provider-shaped objects must not escape past here.
 */

export function canonicalJobId({ companyKey, normalizedTitle, locationKey, requisitionId }) {
  const parts = [companyKey || '', normalizedTitle || '', locationKey || '', requisitionId || ''];
  return `cj_${sha256(parts.join('::')).slice(0, 24)}`;
}

export function locationKeyOf(locations = []) {
  if (!locations.length) return '';
  return locations
    .map((l) => [l.city, l.region, l.countryCode].filter(Boolean).join('-').toLowerCase() || tokens(l.raw).join('-'))
    .filter(Boolean)
    .sort()
    .join('|');
}

/** Content hash is formatting-insensitive so a re-render is not a "change". */
export function computeContentHash(job) {
  const payload = [
    job.normalizedTitle,
    job.company?.normalizedName,
    locationKeyOf(job.locations),
    job.workplace?.type,
    job.workplace?.remoteScope,
    job.employmentType,
    job.compensation?.min ?? '', job.compensation?.max ?? '',
    job.compensation?.currency ?? '', job.compensation?.period ?? '',
    contentNormalize(job.description?.text || ''),
  ].join('||');
  return sha256(payload);
}

/** Dedupe fingerprint = stage-3 identity (company + title + location). */
export function computeDedupeFingerprint(job) {
  const companyKey = job.company?.domain || job.company?.normalizedName || '';
  return sha256([companyKey, job.normalizedTitle, locationKeyOf(job.locations)].join('||')).slice(0, 32);
}

/**
 * Build a canonical JobDocument from one adapter's normalized input.
 *
 * @param {NormalizedJobInput} input
 * @param {object} source  the JobSource record the input came from
 * @param {object} opts    { now }
 */
export function toCanonicalJob(input, source = {}, { now = new Date().toISOString() } = {}) {
  const sourceClass = source.sourceClass || SOURCE_CLASS.AGGREGATOR;

  const descriptionText = input.descriptionText != null
    ? normalizeWhitespace(String(input.descriptionText))
    : stripHtml(input.descriptionHtml || '');
  const descriptionHtml = input.descriptionHtml ?? null;

  const companyDomain = input.company?.domain
    || (input.company?.website ? registrableDomain(input.company.website) : null)
    || (source.companyDomain || null);

  const company = {
    ...normalizeCompany(input.company?.name, { domain: companyDomain, website: input.company?.website }),
    website: input.company?.website ? normalizeUrl(input.company.website) : null,
    logoUrl: input.company?.logoUrl ? normalizeUrl(input.company.logoUrl) : null,
  };

  const titleInfo = normalizeTitle(input.title, { description: descriptionText });
  const locations = parseLocations(input.locationsRaw || []);
  const workplace = classifyWorkplace({
    locationsRaw: input.locationsRaw || [],
    description: descriptionText,
    explicitRemote: input.explicitRemote ?? null,
    applicantRegions: input.applicantRegions || [],
    workplaceHint: input.workplaceHint || null,
  });

  const compensation = normalizeCompensation(
    input.compensationStructured ?? null,
    { rawText: input.compensationRaw ?? null },
  );

  const jobUrl = normalizeUrl(input.jobUrl);
  const applyUrl = normalizeUrl(input.applyUrl) || jobUrl;

  const instance = makeSourceInstance({
    sourceId: source.id ?? null,
    sourceType: source.sourceType,
    sourceClass,
    provider: source.provider,
    tenant: source.tenant ?? null,
    sourceJobId: input.sourceJobId != null ? String(input.sourceJobId) : null,
    requisitionId: input.requisitionId != null ? String(input.requisitionId) : null,
    jobUrl,
    applyUrl,
    sourcePublishedAt: parseSourceDate(input.sourcePublishedAt),
    firstSeenAt: now,
    lastSeenAt: now,
    lastVerifiedAt: null,
    rawHash: input.rawHash ?? null,
    active: true,
    asserted: {
      title: titleInfo.title,
      workplaceType: workplace.type,
      remoteScope: workplace.remoteScope,
      compensation,
      locations: (input.locationsRaw || []).slice(0, 6),
      employmentType: normalizeEmploymentType(input.employmentTypeRaw),
    },
  });

  const job = makeJobDocument({
    now,
    normalizerVersion: NORMALIZER_VERSION,
    company,
    title: titleInfo.title,
    normalizedTitle: titleInfo.normalizedTitle,
    titleFamily: titleInfo.titleFamily,
    titleFamilies: titleInfo.titleFamilies,
    description: { text: descriptionText, html: descriptionHtml },
    employmentType: normalizeEmploymentType(input.employmentTypeRaw),
    department: input.department ? normalizeWhitespace(input.department) : null,
    seniority: titleInfo.seniority,
    locations,
    workplace,
    compensation,
    sourcePublishedAt: parseSourceDate(input.sourcePublishedAt),
    validThrough: parseSourceDate(input.validThrough),
    firstSeenAt: now,
    lastSeenAt: now,
    lastVerifiedAt: null,
    status: JOB_STATUS.NEW,
    canonicalJobUrl: jobUrl,
    canonicalApplyUrl: applyUrl,
    sourceInstances: [instance],
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 20) : [],
  });

  job.id = canonicalJobId({
    companyKey: company.domain || company.normalizedName,
    normalizedTitle: job.normalizedTitle,
    locationKey: locationKeyOf(locations),
    requisitionId: instance.requisitionId || '',
  });

  job.contentHash = computeContentHash(job);
  job.dedupeFingerprint = computeDedupeFingerprint(job);
  job.shingleSignature = minhashSignature(job.description.text, { k: 5, bands: 32 });

  /* Provenance for every field a source can disagree about. */
  for (const [field, value] of Object.entries({
    title: job.title,
    company: company.name,
    description: descriptionText ? sha256(contentNormalize(descriptionText)).slice(0, 16) : null,
    workplaceType: workplace.type,
    remoteScope: workplace.remoteScope,
    compensation: (compensation.min != null || compensation.max != null) ? compensation : null,
    locations: locations.length ? locations.map((l) => l.raw) : null,
    employmentType: job.employmentType,
    sourcePublishedAt: job.sourcePublishedAt,
    canonicalApplyUrl: applyUrl,
    department: job.department,
    seniority: job.seniority,
  })) {
    recordProvenance(job, field, value, instance, now);
  }

  return finalizeJobDocument(job);
}

/** Adapter-facing helper: build a RawJobSnapshot envelope (§15). */
export function makeRawSnapshot({
  sourceId, sourceJobId, payload, httpMeta = {}, fetchedAt = new Date().toISOString(),
  normalizerVersion = NORMALIZER_VERSION, schemaVersion = 1,
}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null);
  return {
    schemaVersion,
    sourceId,
    sourceJobId: sourceJobId != null ? String(sourceJobId) : null,
    fetchedAt,
    http: {
      status: httpMeta.status ?? null,
      etag: httpMeta.etag ?? null,
      lastModified: httpMeta.lastModified ?? null,
      contentType: httpMeta.contentType ?? null,
      url: httpMeta.url ?? null,
      bytes: httpMeta.bytes ?? (body ? Buffer.byteLength(body) : 0),
    },
    contentHash: sha256(body),
    normalizerVersion,
    payload: payload ?? null,
  };
}

export { hostOf, registrableDomain, normalizeUrl, parseSourceDate };

export default {
  toCanonicalJob, makeRawSnapshot, computeContentHash, computeDedupeFingerprint,
  canonicalJobId, locationKeyOf,
};
