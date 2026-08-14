/* ============================================================
   JOB DISCOVERY OS — CHANGE INTELLIGENCE
   ------------------------------------------------------------
   A posting is not a static row. Between two crawls it can be
   edited, re-scoped, repriced, moved, closed or reopened — and
   each of those is a DIFFERENT event with different consequences.

   The failure this module exists to prevent: treating an ordinary
   edit as a new job. A description tweak that changes the content
   hash must update ONE canonical record and emit
   DESCRIPTION_CHANGED. It must not create a second job, and the
   duplicate-ratio metric must not quietly count it as coverage.

   Events emitted:
       JOB_CREATED           first time we ever saw this posting
       TITLE_CHANGED
       SALARY_CHANGED        including salary appearing or disappearing
       LOCATION_CHANGED
       REMOTE_POLICY_CHANGED workplace type or remote scope moved
       EMPLOYMENT_TYPE_CHANGED
       DESCRIPTION_CHANGED   material body change only
       JOB_CLOSED
       JOB_REOPENED

   The change log is bounded and lives on the job, so "what happened
   to this posting" is answerable without a separate event store.
   ============================================================ */

import { JOB_STATUS } from './schema.js';

export const CHANGE = Object.freeze({
  JOB_CREATED: 'JOB_CREATED',
  TITLE_CHANGED: 'TITLE_CHANGED',
  SALARY_CHANGED: 'SALARY_CHANGED',
  LOCATION_CHANGED: 'LOCATION_CHANGED',
  REMOTE_POLICY_CHANGED: 'REMOTE_POLICY_CHANGED',
  EMPLOYMENT_TYPE_CHANGED: 'EMPLOYMENT_TYPE_CHANGED',
  SENIORITY_CHANGED: 'SENIORITY_CHANGED',
  DESCRIPTION_CHANGED: 'DESCRIPTION_CHANGED',
  SOURCE_ADDED: 'SOURCE_ADDED',
  JOB_CLOSED: 'JOB_CLOSED',
  JOB_REOPENED: 'JOB_REOPENED',
});

/** Events a product surface would legitimately alert on. */
export const MATERIAL_CHANGES = new Set([
  CHANGE.TITLE_CHANGED, CHANGE.SALARY_CHANGED, CHANGE.LOCATION_CHANGED,
  CHANGE.REMOTE_POLICY_CHANGED, CHANGE.EMPLOYMENT_TYPE_CHANGED,
  CHANGE.JOB_CLOSED, CHANGE.JOB_REOPENED,
]);

export const MAX_CHANGE_LOG = 40;
/* Below this ratio a description edit is a typo fix, not a re-scoped role. */
export const DESCRIPTION_MATERIALITY = 0.08;

function locationKey(job) {
  return (job.locations || [])
    .map((l) => [l.city, l.region, l.countryCode].filter(Boolean).join('|'))
    .filter(Boolean)
    .sort()
    .join(' ;; ');
}

function salaryKey(job) {
  const c = job.compensation || {};
  return [c.min ?? '', c.max ?? '', c.currency ?? '', c.period ?? ''].join('|');
}

/**
 * Compare two versions of the SAME canonical job.
 *
 * @returns {{ events: [{kind, from, to, at}], material: boolean }}
 */
export function diffJobs(previous, next, { at = new Date().toISOString() } = {}) {
  const events = [];
  const push = (kind, from, to) => events.push({ kind, from: from ?? null, to: to ?? null, at });

  if (!previous) {
    push(CHANGE.JOB_CREATED, null, next.title ?? null);
    return { events, material: true };
  }

  if ((previous.normalizedTitle || previous.title) !== (next.normalizedTitle || next.title)) {
    push(CHANGE.TITLE_CHANGED, previous.title, next.title);
  }

  const prevSalary = salaryKey(previous);
  const nextSalary = salaryKey(next);
  if (prevSalary !== nextSalary) {
    push(CHANGE.SALARY_CHANGED, compactSalary(previous), compactSalary(next));
  }

  if (locationKey(previous) !== locationKey(next)) {
    push(CHANGE.LOCATION_CHANGED,
      (previous.locations || []).map((l) => l.raw).join('; ') || null,
      (next.locations || []).map((l) => l.raw).join('; ') || null);
  }

  const prevRemote = `${previous.workplace?.type || ''}/${previous.workplace?.remoteScope || ''}`;
  const nextRemote = `${next.workplace?.type || ''}/${next.workplace?.remoteScope || ''}`;
  if (prevRemote !== nextRemote) push(CHANGE.REMOTE_POLICY_CHANGED, prevRemote, nextRemote);

  if ((previous.employmentType || '') !== (next.employmentType || '')) {
    push(CHANGE.EMPLOYMENT_TYPE_CHANGED, previous.employmentType, next.employmentType);
  }
  if ((previous.seniority || '') !== (next.seniority || '')) {
    push(CHANGE.SENIORITY_CHANGED, previous.seniority, next.seniority);
  }

  /* Description: only a MATERIAL length shift counts. Whitespace churn and
     boilerplate edits change the hash on every crawl for some boards, and
     logging those would drown the signal that a role was genuinely re-scoped. */
  const prevLen = String(previous.description?.text || '').length;
  const nextLen = String(next.description?.text || '').length;
  if (prevLen || nextLen) {
    const delta = Math.abs(nextLen - prevLen);
    const base = Math.max(prevLen, nextLen, 1);
    if (delta / base >= DESCRIPTION_MATERIALITY) {
      push(CHANGE.DESCRIPTION_CHANGED, prevLen, nextLen);
    }
  }

  const prevSources = new Set((previous.sourceInstances || []).map((s) => s.sourceId));
  for (const s of next.sourceInstances || []) {
    if (s.sourceId && !prevSources.has(s.sourceId)) push(CHANGE.SOURCE_ADDED, null, s.sourceId);
  }

  const wasOpen = previous.status !== JOB_STATUS.REMOVED;
  const isOpen = next.status !== JOB_STATUS.REMOVED;
  if (wasOpen && !isOpen) push(CHANGE.JOB_CLOSED, previous.status, next.status);
  if (!wasOpen && isOpen) push(CHANGE.JOB_REOPENED, previous.status, next.status);

  return { events, material: events.some((e) => MATERIAL_CHANGES.has(e.kind)) };
}

function compactSalary(job) {
  const c = job.compensation || {};
  if (c.min == null && c.max == null) return null;
  return `${c.min ?? ''}-${c.max ?? ''} ${c.currency ?? ''} ${c.period ?? ''}`.trim();
}

/**
 * Attach change events to the canonical record.
 *
 * CRITICAL: this UPDATES one job. It never returns a second document, so an
 * ordinary edit can never become a duplicate canonical job.
 */
export function applyChangeIntelligence(previous, next, { at = new Date().toISOString(), maxLog = MAX_CHANGE_LOG } = {}) {
  const { events, material } = diffJobs(previous, next, { at });
  if (!events.length) return { job: next, events: [], material: false };

  const log = [...(next.changeLog || previous?.changeLog || []), ...events].slice(-maxLog);
  const job = {
    ...next,
    changeLog: log,
    lastChangedAt: events.some((e) => e.kind !== CHANGE.SOURCE_ADDED) ? at : (next.lastChangedAt ?? previous?.lastChangedAt ?? null),
  };

  /* A material change invalidates whatever we last verified: the record on the
     board is not the record we checked. */
  if (material) job.needsVerification = true;

  return { job, events, material };
}

/** Roll a set of jobs up into change counts for the metrics surface. */
export function summarizeChanges(jobs = [], { since = null } = {}) {
  const counts = {};
  let total = 0;
  for (const job of jobs) {
    for (const e of job.changeLog || []) {
      if (since && e.at < since) continue;
      counts[e.kind] = (counts[e.kind] || 0) + 1;
      total += 1;
    }
  }
  return { total, byKind: counts };
}

export default {
  CHANGE, MATERIAL_CHANGES, diffJobs, applyChangeIntelligence, summarizeChanges,
  DESCRIPTION_MATERIALITY, MAX_CHANGE_LOG,
};
