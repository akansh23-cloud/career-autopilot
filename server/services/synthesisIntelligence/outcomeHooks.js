/* ============================================================
   Synthesis Intelligence — outcome hooks
   ------------------------------------------------------------
   Stable event vocabulary for everything that can happen to an
   idea after generation, mapped onto innovation-memory outcomes
   so future retrieval can learn from them. recordIdeaEvent is
   best-effort and DB-optional: it never throws into callers.
   ============================================================ */

export const IDEA_EVENTS = [
  'idea_generated',
  'idea_selected',
  'project_started',
  'project_completed',
  'faculty_approved',
  'faculty_rejected',
  'ip_review_shortlisted',
  'prior_art_blocked',
  'recruiter_shortlisted',
  'student_abandoned',
];

/* Map idea events → memory outcome values understood by the learning layer.
   idea_generated/idea_selected/project_started are lifecycle markers stored
   verbatim; terminal events map to outcome semantics. */
export const EVENT_TO_OUTCOME = {
  idea_generated: 'idea_generated',
  idea_selected: 'idea_selected',
  project_started: 'project_started',
  project_completed: 'built',
  faculty_approved: 'faculty_positive',
  faculty_rejected: 'faculty_negative',
  ip_review_shortlisted: 'ip_review_shortlisted',
  prior_art_blocked: 'prior_art_blocked',
  recruiter_shortlisted: 'recruiter_shown',
  student_abandoned: 'student_abandoned',
};

export function isValidIdeaEvent(event) {
  return IDEA_EVENTS.includes(String(event || ''));
}

export function mapEventToOutcome(event) {
  return EVENT_TO_OUTCOME[String(event || '')] || '';
}

/**
 * recordIdeaEvent — persists an outcome onto a memory chunk via the existing
 * outcome-learning service. Dynamic import keeps this module dependency-free
 * for tests; failures degrade silently (memory is always best-effort).
 */
export async function recordIdeaEvent({ chunkId, event } = {}) {
  if (!isValidIdeaEvent(event)) return { ok: false, reason: 'invalid_event', validEvents: IDEA_EVENTS };
  const outcome = mapEventToOutcome(event);
  try {
    const { recordOutcome } = await import('../innovationMemory/outcomeLearningService.js');
    const r = await recordOutcome({ chunkId, outcome });
    return { ...r, event, outcome };
  } catch (err) {
    return { ok: false, reason: 'memory_unavailable', event, outcome, error: err?.message || '' };
  }
}

export default { IDEA_EVENTS, EVENT_TO_OUTCOME, isValidIdeaEvent, mapEventToOutcome, recordIdeaEvent };
