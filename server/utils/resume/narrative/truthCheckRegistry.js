/* ============================================================
   TRUTH CHECK REGISTRY  (Part 4.4)
   ------------------------------------------------------------
   Every change carries a named verdict for every mandatory
   validator. Three states, and the third one is the point:

       PASS     the validator ran and the change is clean
       FAIL     the validator ran and the change is not clean
       NOT_RUN  the validator could not be evaluated

   NOT_RUN must never be treated as PASS. A validator that could
   not run has told us nothing, and "we didn't check" is not a
   synonym for "it's fine" — that substitution is how unverified
   claims reach a resume wearing a green tick.

   safe === every MANDATORY validator returned PASS.
   ============================================================ */

export const TRUTH_REGISTRY_VERSION = 'truth-check-registry-v1';

export const VERDICT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  NOT_RUN: 'NOT_RUN',
  /* Distinct from NOT_RUN on purpose. NOT_RUN means "we could not check and
     therefore know nothing". NOT_APPLICABLE means "we checked whether this
     applies and it does not" — e.g. action semantics against a summary, which
     is a noun-phrase description rather than an action statement. Collapsing
     the two would either block valid content or, worse, teach us to read
     NOT_RUN as harmless. */
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

/**
 * The mandatory validators. A change is safe only when all of these are PASS.
 * `blocking: false` validators are advisory — they are still reported, but a
 * NOT_RUN or FAIL on them does not by itself make a change unsafe.
 */
export const MANDATORY_CHECKS = Object.freeze([
  { id: 'metric', blocking: true, label: 'Numbers trace to the evidence they came from' },
  { id: 'entity', blocking: true, label: 'Employers, clients and products are grounded' },
  { id: 'skillContext', blocking: true, label: 'Technologies stay in the record that evidences them' },
  { id: 'seniority', blocking: true, label: 'Ownership language stays at or below the evidence ceiling' },
  { id: 'requirementLeakage', blocking: true, label: 'No unsupported job-description terms introduced' },
  { id: 'certification', blocking: true, label: 'Training is not restated as certification' },
  /* ADVISORY, deliberately. This is a capitalisation heuristic: it flags
     proper-noun-shaped tokens a rewrite introduced. It cannot distinguish a
     fabricated client from a role title, a product name or the first word of
     a sentence, and as a blocking check it suppressed whole summaries on
     3 of 12 fixtures — a worse outcome than the risk it mitigates.

     Invented employers are already caught by `entity`, which validates
     against the evidence graph rather than against letter case. This one
     stays as a reported signal; it does not get a veto it cannot justify. */
  { id: 'employer', blocking: false, label: 'No employer or client invented (advisory heuristic)' },
  { id: 'evidenceBinding', blocking: true, label: 'Every claim binds to an evidence unit' },
  { id: 'actionSemantics', blocking: true, label: 'The action described is the action that happened' },
  { id: 'actionProvenance', blocking: true, label: 'The claimed action is one the evidence authorizes' },
]);

export const MANDATORY_IDS = MANDATORY_CHECKS.filter((c) => c.blocking).map((c) => c.id);
export const ALL_CHECK_IDS = MANDATORY_CHECKS.map((c) => c.id);

/**
 * A fresh verdict sheet. Everything starts NOT_RUN, so a validator that is
 * never invoked is visible as such instead of inheriting an optimistic
 * default. This is the inversion that Part 4.4 asks for.
 */
export function newVerdictSheet() {
  const sheet = {};
  for (const id of ALL_CHECK_IDS) sheet[id] = VERDICT.NOT_RUN;
  return sheet;
}

export function recordVerdict(sheet, id, verdict) {
  if (!ALL_CHECK_IDS.includes(id)) {
    throw new Error(`Unknown truth check "${id}" — add it to MANDATORY_CHECKS or fix the caller.`);
  }
  if (!Object.values(VERDICT).includes(verdict)) {
    throw new Error(`Invalid verdict "${verdict}" for check "${id}".`);
  }
  /* FAIL is sticky: once a validator has failed, a later PASS from a
     different code path must not quietly overwrite it. */
  if (sheet[id] === VERDICT.FAIL) return sheet;
  sheet[id] = verdict;
  return sheet;
}

/**
 * Decide safety from a verdict sheet.
 *
 * @returns {{safe:boolean, failed:string[], notRun:string[], reason:string}}
 */
export function evaluateSheet(sheet = {}) {
  const failed = [];
  const notRun = [];
  for (const { id, blocking } of MANDATORY_CHECKS) {
    if (!blocking) continue;
    const v = sheet[id] || VERDICT.NOT_RUN;
    if (v === VERDICT.FAIL) failed.push(id);
    else if (v === VERDICT.NOT_RUN) notRun.push(id);
    /* PASS and NOT_APPLICABLE both satisfy. */
  }
  const safe = failed.length === 0 && notRun.length === 0;
  let reason = 'All mandatory truth checks passed.';
  if (failed.length) {
    reason = `Failed truth checks: ${failed.join(', ')}.`;
  } else if (notRun.length) {
    reason = `Could not verify: ${notRun.join(', ')}. An unverified change is not treated as a safe one.`;
  }
  return { safe, failed, notRun, reason };
}

/** Human-readable label for a check id, for surfacing in the UI. */
export function labelFor(id) {
  return (MANDATORY_CHECKS.find((c) => c.id === id) || {}).label || id;
}

export default {
  TRUTH_REGISTRY_VERSION, VERDICT, MANDATORY_CHECKS, MANDATORY_IDS, ALL_CHECK_IDS,
  newVerdictSheet, recordVerdict, evaluateSheet, labelFor,
};
