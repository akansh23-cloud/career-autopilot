/* ============================================================
   JOB DISCOVERY OS — FRESHNESS & STATUS ENGINE
   ------------------------------------------------------------
   Four timestamps, four DIFFERENT meanings (§22):

     sourcePublishedAt  the source said the job was published then
     firstSeenAt        we first discovered it then
     lastSeenAt         a source last returned it then
     lastVerifiedAt     we last confirmed it still exists then

   They are never substituted for one another, and the UI label is
   derived here so "Posted today" can never be printed when the
   only fact is "discovered today" (§34).
   ============================================================ */

import { JOB_STATUS, ERROR_CLASS } from './schema.js';
import { ageMinutes, ageDays } from './normalize/text.js';
import { computeContentHash } from './normalize/index.js';

/* A single miss is meaningless — feeds truncate, pages flake, providers 500.
   Only repeated misses from an AUTHORITATIVE COMPLETE feed trigger closure. */
export const MISS_THRESHOLD = 3;
export const STALE_AFTER_DAYS = 21;
export const VERIFY_AFTER_DAYS = 7;

/** HTTP/verification outcomes that PROVE a posting is gone. */
export const CLOSED_HTTP = new Set([404, 410]);

/** Failures that must NOT be treated as evidence of closure. */
export const TRANSIENT_ERRORS = new Set([
  ERROR_CLASS.NETWORK, ERROR_CLASS.TIMEOUT, ERROR_CLASS.RATE_LIMIT,
  ERROR_CLASS.BLOCKED, ERROR_CLASS.ROBOTS_DENIED, ERROR_CLASS.UNKNOWN,
  ERROR_CLASS.SCHEMA_CHANGED, ERROR_CLASS.PARSE_FAILED, ERROR_CLASS.AUTH_REQUIRED,
]);

/**
 * A source returned this job in its latest fetch.
 * NEW on first discovery, ACTIVE thereafter. Miss counters reset.
 */
export function observeSeen(job, { sourceId, at = new Date().toISOString() } = {}) {
  const next = { ...job, sourceInstances: (job.sourceInstances || []).map((s) => ({ ...s })) };
  next.lastSeenAt = at;
  const inst = next.sourceInstances.find((s) => s.sourceId === sourceId);
  if (inst) { inst.lastSeenAt = at; inst.active = true; inst.missCount = 0; }
  if (next.status === JOB_STATUS.NEW) {
    /* Stays NEW until a SECOND independent observation confirms it. */
    next.status = JOB_STATUS.ACTIVE;
  } else if (next.status === JOB_STATUS.REMOVED || next.status === JOB_STATUS.STALE) {
    next.status = JOB_STATUS.ACTIVE; // reappearance recovers the record
    next.closedAt = null;
  } else {
    next.status = JOB_STATUS.ACTIVE;
  }
  return next;
}

/**
 * A source completed a fetch and did NOT return this job.
 *
 * @param opts.authoritative  true only when the source returns a COMPLETE
 *   listing (an ATS board feed), so absence is meaningful. An aggregator's
 *   keyword-filtered response is NOT authoritative and never counts as a miss.
 */
export function observeMissing(job, {
  sourceId, at = new Date().toISOString(), authoritative = false, missThreshold = MISS_THRESHOLD,
} = {}) {
  const next = { ...job, sourceInstances: (job.sourceInstances || []).map((s) => ({ ...s })) };
  const inst = next.sourceInstances.find((s) => s.sourceId === sourceId);
  if (!inst) return next;
  if (!authoritative) return next; // incomplete response — no signal at all

  inst.missCount = (inst.missCount || 0) + 1;
  if (inst.missCount >= missThreshold) {
    inst.active = false;
    inst.deactivatedAt = at;
  }

  const anyActive = next.sourceInstances.some((s) => s.active);
  if (!anyActive) {
    /* Every source lost it. Still not deleted — flagged for verification.
       Only verify() with a proven-gone signal may set REMOVED. */
    next.status = JOB_STATUS.STALE;
    next.needsVerification = true;
  } else if (next.status === JOB_STATUS.ACTIVE) {
    next.status = JOB_STATUS.LIKELY_ACTIVE;
  }
  return next;
}

/**
 * A source fetch FAILED (network, timeout, 429, block...). This is explicitly
 * NOT evidence about the job (§22.1: "Do not remove a job after one transient
 * network error"). Status is preserved; only a diagnostic marker is written.
 */
export function observeSourceFailure(job, { sourceId, errorClass = ERROR_CLASS.NETWORK, at = new Date().toISOString() } = {}) {
  const next = { ...job, sourceInstances: (job.sourceInstances || []).map((s) => ({ ...s })) };
  const inst = next.sourceInstances.find((s) => s.sourceId === sourceId);
  if (inst) { inst.lastErrorClass = errorClass; inst.lastErrorAt = at; }
  if (next.status === JOB_STATUS.ACTIVE) next.status = JOB_STATUS.LIKELY_ACTIVE;
  return next;
}

/**
 * Direct re-verification result against the ORIGINAL source record.
 *
 * @param result.ok        true when the posting was found alive
 * @param result.status    HTTP status observed
 * @param result.closed    true when the source explicitly says closed/filled
 * @param result.errorClass classification for a failed check
 */
export function applyVerification(job, result = {}, { sourceId, at = new Date().toISOString(), missThreshold = MISS_THRESHOLD } = {}) {
  const next = { ...job, sourceInstances: (job.sourceInstances || []).map((s) => ({ ...s })) };
  const inst = next.sourceInstances.find((s) => s.sourceId === sourceId) || next.sourceInstances[0];

  if (result.ok) {
    next.lastVerifiedAt = at;
    next.needsVerification = false;
    if (inst) { inst.lastVerifiedAt = at; inst.active = true; inst.missCount = 0; }
    if (next.status !== JOB_STATUS.NEW) next.status = JOB_STATUS.ACTIVE;
    next.closedAt = null;
    return next;
  }

  const proofOfClosure = result.closed === true || CLOSED_HTTP.has(Number(result.status));
  if (proofOfClosure) {
    if (inst) { inst.active = false; inst.lastVerifiedAt = at; inst.closedAt = at; }
    const anyActive = next.sourceInstances.some((s) => s.active);
    next.lastVerifiedAt = at;
    if (!anyActive) {
      next.status = JOB_STATUS.REMOVED;
      next.closedAt = at;
      next.needsVerification = false;
    } else {
      next.status = JOB_STATUS.LIKELY_ACTIVE;
    }
    return next;
  }

  /* Verification could not be completed. Transient — never a closure. */
  if (inst) {
    inst.lastErrorClass = result.errorClass || ERROR_CLASS.UNKNOWN;
    inst.lastErrorAt = at;
    inst.verifyFailures = (inst.verifyFailures || 0) + 1;
  }
  if (next.status === JOB_STATUS.ACTIVE) next.status = JOB_STATUS.LIKELY_ACTIVE;
  return next;
}

/**
 * Content change detection (§21).
 *
 * Returns the UPDATED record — built from `incoming` — carrying the previous
 * hash and the change time. Returning a copy of the OLD record here silently
 * discarded whatever the caller had just merged into `incoming`, which is
 * exactly how a second source instance can vanish between dedupe and storage.
 */
export function applyContentChange(job, incoming, { at = new Date().toISOString() } = {}) {
  const nextHash = computeContentHash(incoming);
  if (nextHash === job.contentHash) {
    return {
      job: {
        ...incoming,
        contentHash: nextHash,
        previousContentHash: job.previousContentHash ?? null,
        lastChangedAt: job.lastChangedAt ?? null,
      },
      changed: false,
      changedFields: [],
    };
  }

  const changedFields = [];
  const cmp = [
    ['title', job.title, incoming.title],
    ['normalizedTitle', job.normalizedTitle, incoming.normalizedTitle],
    ['workplaceType', job.workplace?.type, incoming.workplace?.type],
    ['remoteScope', job.workplace?.remoteScope, incoming.workplace?.remoteScope],
    ['compensationMin', job.compensation?.min, incoming.compensation?.min],
    ['compensationMax', job.compensation?.max, incoming.compensation?.max],
    ['employmentType', job.employmentType, incoming.employmentType],
    ['descriptionLength', (job.description?.text || '').length, (incoming.description?.text || '').length],
  ];
  for (const [name, a, b] of cmp) if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) changedFields.push(name);

  const updated = {
    ...incoming,
    previousContentHash: job.contentHash,
    contentHash: nextHash,
    lastChangedAt: at,
  };
  return { job: updated, changed: true, changedFields };
}

/** Age-based staleness sweep. Never deletes — only downgrades. */
export function sweepStaleness(job, { now = Date.now(), staleAfterDays = STALE_AFTER_DAYS } = {}) {
  if (job.status === JOB_STATUS.REMOVED) return job;
  const seenAge = ageDays(job.lastSeenAt, now);
  if (seenAge != null && seenAge >= staleAfterDays && job.status !== JOB_STATUS.STALE) {
    return { ...job, status: JOB_STATUS.STALE, needsVerification: true };
  }
  return job;
}

/** Does this job need a re-verification pass right now? */
export function needsVerification(job, { now = Date.now(), verifyAfterDays = VERIFY_AFTER_DAYS } = {}) {
  if (job.status === JOB_STATUS.REMOVED) return false;
  if (job.needsVerification) return true;
  if (job.status === JOB_STATUS.STALE) return true;
  const vAge = ageDays(job.lastVerifiedAt, now);
  if (vAge == null) return ageDays(job.firstSeenAt, now) >= 1;
  return vAge >= verifyAfterDays;
}

/**
 * The ONLY sanctioned way to label a job's date in any UI (§34).
 * Returns { kind, label, at } where kind is 'posted' | 'discovered'.
 * When the source published no date, kind is ALWAYS 'discovered'.
 */
export function freshnessLabel(job, { now = Date.now() } = {}) {
  const publishedMinutes = ageMinutes(job.sourcePublishedAt, now);
  const kind = publishedMinutes != null ? 'posted' : 'discovered';
  const at = publishedMinutes != null ? job.sourcePublishedAt : job.firstSeenAt;
  const minutes = publishedMinutes != null ? publishedMinutes : ageMinutes(job.firstSeenAt, now);
  const verb = kind === 'posted' ? 'Posted' : 'First discovered';
  return {
    kind,
    at,
    ageMinutes: minutes,
    label: minutes == null ? `${verb} — date unknown` : `${verb} ${humanAge(minutes)}`,
    verifiedLabel: job.lastVerifiedAt
      ? `Verified active ${humanAge(ageMinutes(job.lastVerifiedAt, now))}`
      : 'Not yet re-verified',
  };
}

export function humanAge(minutes) {
  if (minutes == null) return 'at an unknown time';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  return `${mo} month${mo === 1 ? '' : 's'} ago`;
}

/**
 * Freshness score for ranking. Uses sourcePublishedAt when the source stated
 * one, otherwise firstSeenAt — and reports WHICH, so no caller can conflate them.
 */
export function freshnessScore(job, { now = Date.now(), halfLifeDays = 14 } = {}) {
  const label = freshnessLabel(job, { now });
  if (label.ageMinutes == null) return { score: 0.3, basis: 'unknown' };
  const days = label.ageMinutes / 1440;
  const score = Math.pow(0.5, days / halfLifeDays);
  return { score: Math.max(0.02, Math.min(1, score)), basis: label.kind, days: Math.round(days) };
}

export default {
  MISS_THRESHOLD, STALE_AFTER_DAYS, VERIFY_AFTER_DAYS, CLOSED_HTTP, TRANSIENT_ERRORS,
  observeSeen, observeMissing, observeSourceFailure, applyVerification,
  applyContentChange, sweepStaleness, needsVerification, freshnessLabel,
  freshnessScore, humanAge,
};
