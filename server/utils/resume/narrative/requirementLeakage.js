/* ============================================================
   REQUIREMENT LEAKAGE AUDIT  (P1.3)  +  TRUTH-SAFE VERDICT (P1.4)
   ------------------------------------------------------------
   Detecting a lie and shipping it with a warning attached is not
   a safety feature. If generated content contains a JD term the
   candidate's evidence does not support, the change is REVERTED
   to the original sentence and the run is marked PARTIAL.

   "safe" is computed here and only here. It is the conjunction of
   the hard truth checks — never confidence, never score delta,
   never "did it change". The Accept-All-Safe button in the UI
   binds to this field, so anything looser than a conjunction of
   truth checks would put unverified sentences into a one-click
   bulk accept.
   ============================================================ */
import { equivalenceKey } from './requirementGraph.js';
import { canonicalSkill } from '../skillOntology.js';

export const REQUIREMENT_LEAKAGE_VERSION = 'requirement-leakage-v1';

export const LEAKAGE_TYPE = Object.freeze({
  UNSUPPORTED_REQUIREMENT_LEAKAGE: 'UNSUPPORTED_REQUIREMENT_LEAKAGE',
  METRIC_LEAKAGE: 'METRIC_LEAKAGE',
  ENTITY_LEAKAGE: 'ENTITY_LEAKAGE',
});

export const TAILORING_STATUS = Object.freeze({
  COMPLETE: 'TAILORING_COMPLETE',
  PARTIAL: 'TAILORING_PARTIAL',
});

/* Hard truth checks. Every one must PASS for safe === true. */
export const TRUTH_CHECKS = Object.freeze([
  'metric',
  'entity',
  'skillContext',
  'seniority',
  'requirementLeakage',
  'certification',
  'employer',
  'evidenceBinding',
]);

/**
 * Word-boundary presence test that survives punctuation and casing but does
 * not fire on substrings ("go" inside "algorithm", "s3" inside "s3cret").
 */
function mentions(text, term) {
  const t = String(term || '').trim();
  if (!t) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(String(text || ''));
}

/**
 * Which forbidden terms does `text` contain that `original` did not?
 * Terms already present in the candidate's own sentence are theirs to keep —
 * we are policing INTRODUCTION, not vocabulary the user wrote themselves.
 */
export function introducedForbiddenTerms(text, original, forbiddenTerms, termSurfaces = new Map()) {
  const hits = [];
  for (const key of forbiddenTerms) {
    const surfaces = termSurfaces.get(key) || [key];
    const inNew = surfaces.some((s) => mentions(text, s));
    if (!inNew) continue;
    const inOld = surfaces.some((s) => mentions(original, s));
    if (inOld) continue;
    hits.push(key);
  }
  return hits;
}

/**
 * Audit one proposed change. Returns a verdict carrying the per-check
 * results, the definitive `safe` boolean, and the action taken.
 *
 * @param {object} change  { changeId, before, after, evidenceIds, ... }
 * @param {object} ctx     { forbiddenTerms:Set, termSurfaces:Map, priorChecks:object }
 */
export function auditChange(change, ctx = {}) {
  const {
    forbiddenTerms = new Set(),
    termSurfaces = new Map(),
    priorChecks = {},
  } = ctx;

  const before = String(change.before || '');
  const after = String(change.after || '');

  const truthChecks = {};
  for (const k of TRUTH_CHECKS) truthChecks[k] = priorChecks[k] || 'PASS';

  const leaked = introducedForbiddenTerms(after, before, forbiddenTerms, termSurfaces);
  const violations = [];

  if (leaked.length) {
    truthChecks.requirementLeakage = 'FAIL';
    for (const term of leaked) {
      violations.push({
        type: LEAKAGE_TYPE.UNSUPPORTED_REQUIREMENT_LEAKAGE,
        changeId: change.changeId || change.id || null,
        requirement: term,
        action: 'REVERTED',
        detail: `"${term}" appears in the target job description but is not supported by this candidate's evidence, and it was not in the original sentence.`,
      });
    }
  }

  const failed = Object.entries(truthChecks).filter(([, v]) => v !== 'PASS').map(([k]) => k);
  const safe = failed.length === 0;

  return {
    changeId: change.changeId || change.id || null,
    safe,
    truthChecks,
    failedChecks: failed,
    violations,
    /* Fail closed: an unsafe change reverts to the candidate's own words. */
    finalText: safe ? after : before,
    reverted: !safe,
    changed: safe ? after !== before : false,
  };
}

/**
 * Audit every proposed change and revert the unsafe ones.
 *
 * Returns the audited changes plus the run-level status. A single reverted
 * change is enough to make the run PARTIAL — the user is told that some of
 * what they asked for could not be done honestly, rather than being handed
 * a clean-looking result with a footnote.
 */
export function auditAndRevert(changes = [], ctx = {}) {
  const audited = [];
  const violations = [];
  let reverted = 0;

  for (const change of changes) {
    const verdict = auditChange(change, {
      ...ctx,
      priorChecks: change.truthChecks || {},
    });
    if (verdict.reverted) reverted += 1;
    violations.push(...verdict.violations);
    audited.push({
      ...change,
      after: verdict.finalText,
      safe: verdict.safe,
      changed: verdict.changed,
      reverted: verdict.reverted,
      truthChecks: verdict.truthChecks,
      failedChecks: verdict.failedChecks,
      violations: verdict.violations,
    });
  }

  return {
    version: REQUIREMENT_LEAKAGE_VERSION,
    changes: audited,
    violations,
    revertedCount: reverted,
    status: reverted > 0 ? TAILORING_STATUS.PARTIAL : TAILORING_STATUS.COMPLETE,
    safe: reverted === 0,
  };
}

/**
 * Build a surface-form lookup so "K8s" in generated text trips the
 * "kubernetes" tripwire. Without this, leakage detection is defeated by
 * an abbreviation.
 */
export function buildTermSurfaces(terms = [], extraAliases = {}) {
  const map = new Map();
  const add = (key, surface) => {
    const list = map.get(key) || [];
    if (!list.includes(surface)) list.push(surface);
    map.set(key, list);
  };
  for (const t of terms) {
    const key = equivalenceKey(t);
    add(key, t);
    add(key, key);
    const canon = canonicalSkill(t);
    if (canon) add(key, canon);
    for (const alias of extraAliases[key] || []) add(key, alias);
  }
  return map;
}

/* Abbreviations that must trip the same wire as their long form. */
export const DEFAULT_SURFACE_ALIASES = Object.freeze({
  kubernetes: ['k8s', 'kube'],
  openshift: ['ocp', 'open shift'],
  'ci/cd': ['cicd', 'ci cd'],
  postgresql: ['postgres', 'psql'],
  'github actions': ['gh actions'],
  terraform: ['tf'],
  prometheus: ['prom'],
  javascript: ['js'],
  typescript: ['ts'],
  'amazon web services': ['aws'],
});

export default {
  REQUIREMENT_LEAKAGE_VERSION, LEAKAGE_TYPE, TAILORING_STATUS, TRUTH_CHECKS,
  auditChange, auditAndRevert, introducedForbiddenTerms, buildTermSurfaces,
  DEFAULT_SURFACE_ALIASES,
};
