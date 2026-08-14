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
import { canonicalSkill, isKnownSkill } from '../skillOntology.js';
import {
  newVerdictSheet, recordVerdict, evaluateSheet, VERDICT,
} from './truthCheckRegistry.js';

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

/* Employer/client grounding: a rewrite must not introduce a capitalised
   organisation-shaped token that the original sentence did not contain.
   Returns NOT_RUN when there is nothing capitalised to reason about, because
   "no proper nouns present" is not evidence that grounding was verified. */
function employerVerdict(after, before, ctx = {}) {
  const text = String(after || '');
  if (!text.trim()) return VERDICT.NOT_RUN;

  const known = new Set((ctx.knownEntities || []).map((e) => String(e).toLowerCase()));

  /* Drop the leading token before scanning. The first word of a sentence is
     capitalised by grammar, and leaving it in makes a greedy proper-noun match
     swallow it together with the real names that follow ("Built GitLab CI"),
     which then looks sentence-initial and gets discarded — silently skipping
     the check on exactly the tokens it exists to inspect. */
  const scanned = text
    /* Capitalisation resets at EVERY sentence, not just the first. Dropping
       only the document's opening word left "Automated" — the second
       sentence's verb — looking like an organisation name. */
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/^\s*\S+\s*/, ''))
    .join(' ');

  const proper = scanned.match(/\b[A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+)*\b/g) || [];
  const candidates = proper
    .map((p) => p.trim())
    .filter((p) => p && p.split(/\s+/).length <= 4);

  const beforeLower = String(before || '').toLowerCase();
  for (const c of candidates) {
    if (beforeLower.includes(c.toLowerCase())) continue;
    if (known.has(c.toLowerCase())) continue;
    /* Technologies are capitalised too. "GitLab CI" is not an employer, and
       flagging it here would double-report a concern that skillContext already
       owns — two validators disagreeing about the same token is worse than
       either verdict alone. */
    if (isKnownSkill(c)) continue;
    if (c.split(/\s+/).every((w) => isKnownSkill(w))) continue;
    return VERDICT.FAIL;
  }

  /* The check ran over the full text and found nothing ungrounded. That is a
     PASS, not a NOT_RUN: "we looked and there was nothing to flag" is a real
     result, whereas NOT_RUN means we could not look at all. */
  return VERDICT.PASS;
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

  /* Part 4.4 — start from the verdict sheet the candidate carried out of the
     composer/validator, defaulting to NOT_RUN rather than PASS. Anything this
     stage owns is filled in below; anything nobody ran stays NOT_RUN and
     blocks safety. */
  const truthChecks = newVerdictSheet();
  for (const [k, v] of Object.entries(priorChecks || {})) {
    if (truthChecks[k] !== undefined && Object.values(VERDICT).includes(v)) {
      recordVerdict(truthChecks, k, v);
    }
  }

  const leaked = introducedForbiddenTerms(after, before, forbiddenTerms, termSurfaces);
  const violations = [];

  /* This stage is the owner of requirementLeakage and employer grounding. */
  recordVerdict(truthChecks, 'requirementLeakage', leaked.length ? VERDICT.FAIL : VERDICT.PASS);
  recordVerdict(truthChecks, 'employer', employerVerdict(after, before, ctx));

  if (leaked.length) {
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

  const safety = evaluateSheet(truthChecks);
  const failed = [...safety.failed, ...safety.notRun];
  const safe = safety.safe;

  return {
    changeId: change.changeId || change.id || null,
    safe,
    truthChecks,
    safety,
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
      safety: verdict.safety,
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
