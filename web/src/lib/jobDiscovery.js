/* ============================================================
   JOB DISCOVERY OS — FRONTEND ADAPTER  (§34, §48)
   ------------------------------------------------------------
   Jobs.jsx searches the CANONICAL INDEX via /jobs/search-v2. It
   no longer causes a live fan-out across Remotive / RemoteOK /
   Jobicy / JSearch on every keystroke.

   This module maps a canonical search result onto the job shape
   the existing UI (tracker, tailoring, project studio, contacts)
   already understands, and attaches the provenance fields the
   card needs. Resume OS integration is untouched: `saveSelectedJob`
   still receives a job object with title/company/url/summary.

   THE DATE RULE (§34) IS ENFORCED HERE:
     dateKind === 'posted'      -> "Posted 2 hours ago"
     dateKind === 'discovered'  -> "First discovered 42 minutes ago"
   `postedDate` is populated ONLY from sourcePublishedAt. When the
   source published no date, postedDate stays empty and the card
   shows the discovery label instead. firstSeenAt is never written
   into postedDate.
   ============================================================ */

export const SOURCE_LABELS = {
  ORIGINAL_CAREER_SITE: 'Direct company careers',
  ORIGINAL_ATS: 'Direct company careers',
  TRUSTED_FEED: 'Structured job feed',
  AGGREGATOR: 'Job aggregator',
};

export const PROVIDER_LABELS = {
  GREENHOUSE: 'Greenhouse', LEVER: 'Lever', ASHBY: 'Ashby', WORKABLE: 'Workable',
  SMARTRECRUITERS: 'SmartRecruiters', WORKDAY: 'Workday', GENERIC: 'Company site',
  API: 'Partner API',
};

export function sourceLabel(source = {}) {
  const base = SOURCE_LABELS[source.type] || 'Unknown source';
  const provider = PROVIDER_LABELS[source.provider] || source.provider;
  if (!provider) return base;
  return source.isOriginal ? `${base} / ${provider}` : `${provider}`;
}

/** Human location string without inventing a place the source never stated. */
export function locationText(job) {
  const locs = job.locations || [];
  if (locs.length) {
    const shown = locs.slice(0, 2).map((l) => l.raw || [l.city, l.region, l.country].filter(Boolean).join(', ')).filter(Boolean);
    const extra = locs.length > 2 ? ` +${locs.length - 2}` : '';
    if (shown.length) return shown.join(' · ') + extra;
  }
  const wp = job.workplace || {};
  if (wp.type === 'REMOTE') {
    if (wp.remoteScope === 'REMOTE_WORLDWIDE') return 'Remote — worldwide';
    if (wp.remoteRegions?.length) return `Remote — ${wp.remoteRegions.join('/')}`;
    return 'Remote — region not stated';
  }
  return 'Location not stated';
}

export function workModeText(job) {
  const wp = job.workplace || {};
  if (wp.type === 'REMOTE') return 'Remote';
  if (wp.type === 'HYBRID') return 'Hybrid';
  if (wp.type === 'ONSITE') return 'On-site';
  return ''; // UNKNOWN stays blank rather than guessing
}

export function salaryText(job) {
  const c = job.compensation || {};
  if (c.min == null && c.max == null) return ''; // never fabricated
  const cur = c.currency ? `${c.currency} ` : '';
  const period = c.period ? ` / ${c.period.toLowerCase()}` : '';
  const fmt = (n) => Number(n).toLocaleString();
  if (c.min != null && c.max != null && c.min !== c.max) return `${cur}${fmt(c.min)}–${fmt(c.max)}${period}`;
  return `${cur}${fmt(c.min ?? c.max)}${period}`;
}

/**
 * Canonical search result -> UI job.
 * Keeps every legacy field name the rest of Jobs.jsx reads.
 */
export function toUiJob(result) {
  const job = result.job || {};
  const fresh = result.freshness || {};
  const source = result.source || {};
  const apply = result.apply || {};

  return {
    /* legacy fields the existing UI already consumes */
    id: job.id,
    title: job.title || '',
    company: job.company?.name || '',
    companyDomain: job.company?.domain || '',
    location: locationText(job),
    mode: workModeText(job),
    experience: job.seniority && job.seniority !== 'UNKNOWN' ? job.seniority : '',
    salary: salaryText(job),
    companyType: job.department || '',
    source: sourceLabel(source),
    /* ONLY a real source publication date lands here. */
    postedDate: fresh.sourcePublishedAt || '',
    postedDays: null,
    url: apply.canonicalApplyUrl || apply.canonicalJobUrl || '',
    applyUrl: apply.canonicalApplyUrl || '',
    summary: String(job.description?.text || '').slice(0, 320),
    requiredSkills: job.tags || [],
    verified: !!fresh.lastVerifiedAt,

    /* Job Discovery OS provenance, consumed by the card */
    _discovery: {
      rank: result.rank,
      relevance: result.relevance || {},
      status: job.status,
      dateKind: fresh.dateKind,
      dateLabel: fresh.dateLabel,
      verifiedLabel: fresh.verifiedLabel,
      firstSeenAt: fresh.firstSeenAt,
      sourcePublishedAt: fresh.sourcePublishedAt,
      canonicalJobUrl: apply.canonicalJobUrl || '',
      canonicalApplyUrl: apply.canonicalApplyUrl || '',
      lastVerifiedAt: fresh.lastVerifiedAt,
      sourceType: source.type,
      sourceProvider: source.provider,
      isOriginal: !!source.isOriginal,
      sourceCount: source.instanceCount || 0,
      providers: source.providers || [],
      directApply: !!apply.directApply,
      remoteScope: job.workplace?.remoteScope || 'UNKNOWN',
      completeness: job.completeness,
      completenessFlags: job.completenessFlags || {},
      sourceConfidence: job.sourceConfidence,
      titleRelation: result.relevance?.titleRelation || null,
    },
  };
}

/** Search-v2 payload -> { jobs, meta } for the existing view state. */
export function fromSearchPayload(payload = {}) {
  const results = payload.results || [];
  return {
    jobs: results.map(toUiJob),
    meta: {
      engine: 'job-discovery-os',
      total: payload.total ?? results.length,
      scanned: payload.scanned ?? null,
      shown: results.length,
      nextCursor: payload.nextCursor || null,
      rejected: payload.rejected || {},
      expandedFamilies: payload.query?.expandedFamilies || [],
      cached: !!payload.cached,
      latencyMs: payload.latencyMs ?? null,
      personalization: payload.personalization || null,
      explanation: buildExplanation(payload),
    },
  };
}

function buildExplanation(payload) {
  const results = payload.results || [];
  const total = payload.total ?? results.length;
  if (!results.length) {
    const r = payload.rejected || {};
    const causes = Object.entries(r).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (!causes.length) return 'No indexed jobs matched this search yet.';
    const [cause, n] = causes[0];
    const LABEL = {
      relevance: 'were not relevant to this role',
      location: 'were not open to this location',
      remote: 'did not match the work-mode filter',
      salary: 'fell outside the salary filter',
      employmentType: 'did not match the employment type',
      freshness: 'were older than the selected window',
      company: 'were from other companies',
      sourceType: 'came from a different source type',
    };
    return `No matches. ${n} indexed job${n === 1 ? '' : 's'} ${LABEL[cause] || 'were filtered out'}.`;
  }
  const direct = results.filter((r) => r.source?.isOriginal).length;
  const parts = [`${results.length} of ${total} indexed match${total === 1 ? '' : 'es'}`];
  if (direct) parts.push(`${direct} from the employer's own board`);
  const related = results.filter((r) => ['STRONG', 'RELATED'].includes(r.relevance?.titleRelation)).length;
  if (related) parts.push(`${related} from related role families`);
  return `${parts.join(' · ')}.`;
}

export default { toUiJob, fromSearchPayload, sourceLabel, locationText, workModeText, salaryText };
