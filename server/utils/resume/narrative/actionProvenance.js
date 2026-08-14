/* ============================================================
   ACTION PROVENANCE
   ------------------------------------------------------------
   The bug this exists to kill:

     SOURCE:   Worked on a Spring Boot service for ticket routing.
     ACCEPTED: Designed / Developed / Deployed a Spring Boot service...

   Every one of those is idiomatic English and none of them is
   supported. "Worked on" tells us the candidate was involved; it
   does not tell us what they did. Collocation strength answered
   the question "what sounds natural with this object?" and that
   answer was being used as if it had answered "what did this
   person actually do?".

   Those are different questions and they need different layers.
   This module owns the second one. It decides the AUTHORIZED
   ACTION SET from evidence alone. objectVerbFit may then rank
   within that set; it may never add to it.
   ============================================================ */
import { baseVerb, familyOf, ACTION_FAMILIES, extractClaimedPredicate } from './actionSemantics.js';

export const ACTION_PROVENANCE_VERSION = 'action-provenance-v1';

export const PROVENANCE = Object.freeze({
  EXPLICIT_ACTION: 'EXPLICIT_ACTION',
  NOMINALIZED_ACTION: 'NOMINALIZED_ACTION',
  SUPPORTED_EQUIVALENT: 'SUPPORTED_EQUIVALENT',
  RESPONSIBILITY_PARAPHRASE: 'RESPONSIBILITY_PARAPHRASE',
  CONTRIBUTION_ONLY: 'CONTRIBUTION_ONLY',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
});

/* ------------------------------------------------------------------
   NOMINALIZATION MAP — audited, not guessed.
   A noun earns a place here only when it encodes exactly one action.
   ------------------------------------------------------------------ */
export const NOMINALIZATION_MAP = Object.freeze({
  configuration: 'configure',
  implementation: 'implement',
  migration: 'migrate',
  validation: 'validate',
  maintenance: 'maintain',
  optimization: 'optimize',
  optimisation: 'optimise',
  automation: 'automate',
  monitoring: 'monitor',
  analysis: 'analyze',
  testing: 'test',
  coordination: 'coordinate',
  deployment: 'deploy',
  development: 'develop',
  administration: 'administer',
  integration: 'integrate',
  provisioning: 'provision',
  documentation: 'document',
  remediation: 'remediate',
  reconciliation: 'reconcile',
  troubleshooting: 'troubleshoot',
  orchestration: 'orchestrate',
  standardisation: 'standardise',
  standardization: 'standardize',
  refactoring: 'refactor',
  onboarding: 'onboard',
  scheduling: 'schedule',
  forecasting: 'forecast',
  budgeting: 'budget',
  reporting: 'report',
});

/* Nouns that name a THING, not an action. Their presence authorizes nothing.
   This is the list that stops "service" implying "built a service". */
export const NON_ACTION_NOUNS = new Set([
  'service', 'platform', 'system', 'application', 'app', 'project', 'work',
  'activity', 'activities', 'initiative', 'programme', 'program', 'product',
  'tool', 'solution', 'component', 'module', 'feature', 'team', 'process',
  'pipeline', 'dashboard', 'report', 'brief', 'briefs', 'database', 'server',
  'environment', 'cluster', 'repository', 'infrastructure', 'stack',
]);

/* Openers that establish involvement without establishing an action. */
const CONTRIBUTION_OPENERS = [
  'worked on', 'worked with', 'involved in', 'participated in',
  'contributed to', 'helped with', 'helped on', 'helped', 'assisted with',
  'assisted in', 'assisted', 'supported', 'part of', 'engaged in',
  'exposure to', 'familiar with', 'took part in',
];

/* Openers that state responsibility but not the act itself. */
const RESPONSIBILITY_OPENERS = [
  'responsible for', 'accountable for', 'in charge of', 'tasked with',
  'responsibilities included', 'duties included', 'owned',
];

/* Verbs that are always safe for a contribution-level source, because they
   restate the involvement rather than specifying an act. */
export const CONTRIBUTION_VERBS = ['contribute', 'support', 'assist', 'participate', 'help', 'work'];

/* Explicit, audited equivalences. objectVerbFit does NOT create these. */
const EQUIVALENCES = [
  ['write', 'author'],
  ['build', 'construct'],
  ['configure', 'set up'],
  ['maintain', 'sustain'],
  ['analyze', 'analyse'],
  ['optimize', 'optimise'],
  ['standardize', 'standardise'],
  ['coordinate', 'orchestrate'],
];

const EQUIV_MAP = new Map();
for (const group of EQUIVALENCES) {
  for (const v of group) {
    const others = group.filter((x) => x !== v).map(baseVerb);
    EQUIV_MAP.set(baseVerb(v), others);
  }
}

function lower(s) { return String(s || '').toLowerCase(); }

function startsWithAny(text, phrases) {
  const t = lower(text).trim();
  for (const p of phrases) {
    if (t.startsWith(`${p} `) || t === p) return p;
  }
  return null;
}

/* The first real verb after a weak opener: "Responsible for supporting
   deployments" → "supporting" → support. */
function verbAfterOpener(text, opener) {
  const rest = lower(text).trim().slice(opener.length).trim();
  const m = rest.match(/^(?:the\s+|a\s+|an\s+)?([a-z]+(?:ing|ed))\b/);
  if (!m) return null;
  const b = baseVerb(m[1]);
  return familyOf(b) ? b : null;
}

/* Any registered nominalization inside the phrase, head-anchored so that a
   trailing subordinate clause does not donate its noun. */
function nominalizedAction(text) {
  const head = lower(text).split(/\s+(?:for|to|across|in|on|with|using|through|by)\s+|,/)[0];
  for (const [noun, verb] of Object.entries(NOMINALIZATION_MAP)) {
    if (new RegExp(`(?<![a-z])${noun}(?![a-z])`).test(head)) return { noun, verb: baseVerb(verb) };
  }
  return null;
}

/**
 * Classify what a source statement authorizes us to claim.
 *
 * @param {object} evidence  an evidence record (uses rawText / action / object)
 * @param {object} opts.recordActions  lemmas explicitly evidenced elsewhere in
 *        the SAME record, with their object head nouns, for Part 7 widening.
 * @returns {{category:string, authorized:string[], detail:string}}
 */
export function classifyActionProvenance(evidence = {}, { recordActions = [] } = {}) {
  const text = evidence.rawText || evidence.originalText || '';
  if (!text.trim()) {
    return { category: PROVENANCE.UNKNOWN_ACTION, authorized: [], detail: 'No source text.' };
  }

  const contribOpener = startsWithAny(text, CONTRIBUTION_OPENERS);
  const respOpener = startsWithAny(text, RESPONSIBILITY_OPENERS);

  /* --- weak opener with an explicit verb after it --- */
  const opener = contribOpener || respOpener;
  if (opener) {
    const inner = verbAfterOpener(text, opener);
    if (inner) {
      return {
        category: PROVENANCE.RESPONSIBILITY_PARAPHRASE,
        authorized: withEquivalents([inner, ...CONTRIBUTION_VERBS]),
        detail: `The source names "${inner}" as the underlying action.`,
      };
    }

    /* --- nominalized action in the object ---
       Only a RESPONSIBILITY opener licenses this. "Responsible for deployment
       configuration" means the configuring was theirs. "Participated in
       database migration" means a migration happened and they were present
       for it — the noun describes the project, not their act. Treating those
       the same is how "Helped with deployment activities" became "Deployed
       applications". */
    const nom = respOpener ? nominalizedAction(evidence.object || text) : null;
    if (nom) {
      return {
        category: PROVENANCE.NOMINALIZED_ACTION,
        authorized: withEquivalents([nom.verb, ...CONTRIBUTION_VERBS]),
        detail: `"${nom.noun}" encodes the action "${nom.verb}".`,
      };
    }

    /* --- involvement only --- */
    if (contribOpener) {
      /* "Worked with X" proves association with X, but not that the candidate
         supported or contributed to X itself. Preserve the work predicate
         unless a separate same-record statement supplies a concrete action. */
      if (contribOpener === 'worked with') {
        const widened = sameRecordWidening(evidence, recordActions);
        return {
          category: PROVENANCE.CONTRIBUTION_ONLY,
          authorized: withEquivalents(['work', ...widened]),
          detail: widened.length
            ? '"worked with" establishes association; same-record evidence supplies the additional action.'
            : '"worked with" establishes association only; it does not prove support, ownership or a specific action on the object.',
        };
      }
      const widened = sameRecordWidening(evidence, recordActions);
      return {
        category: PROVENANCE.CONTRIBUTION_ONLY,
        authorized: withEquivalents([...CONTRIBUTION_VERBS, ...widened]),
        detail: widened.length
          ? `"${contribOpener}" establishes involvement; the same record additionally evidences ${widened.join(', ')}.`
          : `"${contribOpener}" establishes involvement but not which action was performed.`,
      };
    }

    /* Responsibility opener with neither an inner verb nor a nominalization:
       we know they were responsible, not what they did. */
    return {
      category: PROVENANCE.UNKNOWN_ACTION,
      authorized: withEquivalents(CONTRIBUTION_VERBS),
      detail: `"${respOpener}" states responsibility without naming an action.`,
    };
  }

  /* --- the source opens with a real action verb --- */
  const lead = baseVerb(evidence.action || (text.match(/^\s*([A-Za-z][\w-]*)/) || [])[1] || '');
  if (lead && familyOf(lead)) {
    return {
      category: PROVENANCE.EXPLICIT_ACTION,
      authorized: withEquivalents([lead]),
      detail: `The source states the action "${lead}".`,
    };
  }

  return {
    category: PROVENANCE.UNKNOWN_ACTION,
    authorized: [],
    detail: 'No defensible action could be identified in the source.',
  };
}

/* Part 7 — the same record may license a stronger verb, but only when that
   record explicitly uses it AND about the same object. A neighbouring bullet
   about a different thing proves nothing about this one. */
function sameRecordWidening(evidence, recordActions) {
  const objHead = lower(evidence.object || '').split(/\s+/).slice(-1)[0];
  if (!objHead) return [];
  const out = [];
  for (const ra of recordActions || []) {
    if (!ra || !ra.verb) continue;
    const sameObject = lower(ra.object || '').includes(objHead);
    if (sameObject) out.push(baseVerb(ra.verb));
  }
  return out;
}

function withEquivalents(verbs) {
  const set = new Set();
  for (const v of verbs) {
    const b = baseVerb(v);
    set.add(b);
    for (const e of EQUIV_MAP.get(b) || []) set.add(e);
  }
  return [...set];
}

/**
 * Hard truth check. Does the candidate claim an action the evidence authorizes?
 *
 * @returns {{status:'PASS'|'FAIL'|'NOT_APPLICABLE'|'NOT_RUN', violations:Array, detail:string}}
 */
export function validateActionProvenance(candidate, evidence = {}, opts = {}) {
  if (opts.kind === 'summary') {
    return { status: 'NOT_APPLICABLE', violations: [], detail: 'Summaries are not per-statement action claims.' };
  }
  const text = String(candidate || '').trim();
  const sourceText = String(evidence?.rawText || evidence?.originalText || '').trim();

  /* The untouched source is always evidence-safe by definition. This matters
     for weak bullets such as "Involved in team meetings" where no defensible
     action predicate exists: the optimizer must be allowed to preserve them
     rather than converting an inability to improve into an unsafe/undefined
     output. */
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').replace(/[.;\s]+$/, '').trim().toLowerCase();
  if (sourceText && norm(text) === norm(sourceText)) {
    return { status: 'PASS', violations: [], detail: 'Candidate preserves the source statement unchanged.' };
  }

  const predicate = extractClaimedPredicate(text);
  if (!predicate.detected) {
    return { status: 'NOT_RUN', violations: [], detail: 'No defensible principal action predicate was identified in the changed candidate.' };
  }

  const claimed = predicate.base;
  const prov = classifyActionProvenance(evidence, opts);

  /* Unchanged action is always fine. */
  const sourceLead = baseVerb(evidence.action || '');
  if (sourceLead && claimed === sourceLead) {
    return { status: 'PASS', violations: [], detail: 'Action unchanged.' };
  }

  /* If we found a principal predicate but it is outside the audited action
     vocabulary, fail closed via NOT_RUN. A mandatory truth check that cannot
     reason about the claimed action must never silently become PASS. */
  if (!predicate.family && !prov.authorized.includes(claimed)) {
    return {
      status: 'NOT_RUN', violations: [],
      detail: `The principal predicate "${predicate.surface}" is not in the audited action vocabulary.`,
    };
  }

  if (prov.authorized.includes(claimed)) {
    return {
      status: 'PASS', violations: [],
      detail: `"${claimed}" (${predicate.voice.toLowerCase()} voice) is authorized by ${prov.category}: ${prov.detail}`,
    };
  }

  return {
    status: 'FAIL',
    violations: [{
      code: 'unsupported_action_claim',
      severity: 'critical',
      claimed,
      category: prov.category,
      authorized: prov.authorized,
      detail: `The rewrite claims the candidate "${claimed}" this, but the source only establishes ${prov.category === PROVENANCE.CONTRIBUTION_ONLY ? 'involvement' : 'a different action'}. ${prov.detail}`,
    }],
    detail: `"${claimed}" (${predicate.voice.toLowerCase()} voice) is not authorized by ${prov.category}.`,
  };
}

/**
 * Rank-only helper contract for the language layer: the authorized set is an
 * input, never an output.
 */
export function authorizedActionsFor(evidence, opts = {}) {
  return classifyActionProvenance(evidence, opts).authorized;
}

export default {
  ACTION_PROVENANCE_VERSION, PROVENANCE, NOMINALIZATION_MAP, NON_ACTION_NOUNS,
  CONTRIBUTION_VERBS, classifyActionProvenance, validateActionProvenance,
  authorizedActionsFor,
};
