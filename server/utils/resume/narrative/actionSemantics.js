/* ============================================================
   ACTION SEMANTICS VALIDATOR  (Part 4.2)
   ------------------------------------------------------------
   Rewriting may change HOW an action is described. It may not
   change WHAT the action was.

       wrote SQL query   →  launched SQL query     FAIL
       rebuilt X         →  consolidated X         FAIL
       wrote a report    →  authored a report      PASS

   The distinction is not synonymy in the abstract — it is whether
   the two verbs denote the same act on the same object. "Launch"
   and "write" are both things you can do to software, but only one
   of them is what happened, and a resume that says the wrong one is
   making a false claim in the most quietly deniable way available.

   Verbs are grouped into FAMILIES. Substitution within a family is
   safe. Substitution across families requires evidence that the new
   action actually occurred, which for a rewrite it never has —
   so cross-family substitution fails closed.
   ============================================================ */

export const ACTION_SEMANTICS_VERSION = 'action-semantics-v1';

/* Families of verbs denoting the same underlying act. Membership is
   deliberately conservative: when in doubt, a verb gets its own family,
   because a false PASS here becomes a lie on someone's resume. */
export const ACTION_FAMILIES = Object.freeze({
  /* Bringing something into existence. */
  create: ['create', 'build', 'develop', 'author', 'write', 'implement', 'construct', 'produce'],
  /* Designing the shape of something before/while building it. */
  design: ['design', 'architect', 'model', 'blueprint', 'specify'],
  /* Keeping an existing thing working. */
  maintain: ['maintain', 'support', 'operate', 'run', 'administer', 'manage', 'sustain'],
  /* Making an existing thing better without changing what it is. */
  improve: ['improve', 'enhance', 'optimise', 'optimize', 'tune', 'refine', 'strengthen', 'streamline'],
  /* Making an existing thing faster/smaller/cheaper by amount. */
  reduce: ['reduce', 'cut', 'lower', 'decrease', 'minimise', 'minimize', 'shrink'],
  increase: ['increase', 'raise', 'grow', 'boost', 'expand', 'scale'],
  /* Moving a thing from one place/form to another. */
  migrate: ['migrate', 'move', 'port', 'transfer', 'transition', 'convert'],
  /* Rebuilding a thing in place — NOT the same as merging things together. */
  rebuild: ['rebuild', 'rewrite', 'refactor', 'rearchitect', 're-architect', 'modernise', 'modernize'],
  /* Merging several things into fewer. */
  consolidate: ['consolidate', 'merge', 'unify', 'centralise', 'centralize', 'combine'],
  /* Making a thing uniform across cases. */
  standardise: ['standardise', 'standardize', 'normalise', 'normalize', 'harmonise', 'harmonize'],
  /* Removing manual effort. */
  automate: ['automate', 'script', 'orchestrate'],
  /* Connecting two systems. */
  integrate: ['integrate', 'connect', 'wire', 'link', 'embed'],
  /* Releasing something to an environment. */
  deploy: ['deploy', 'release', 'ship', 'roll out', 'launch', 'publish', 'promote'],
  /* Setting parameters on an existing thing. */
  configure: ['configure', 'set up', 'provision', 'install', 'establish'],
  /* Examining. */
  analyse: ['analyse', 'analyze', 'assess', 'evaluate', 'investigate', 'review', 'audit', 'examine'],
  /* Watching over time. */
  monitor: ['monitor', 'track', 'observe', 'measure', 'instrument'],
  /* Fixing a defect. */
  fix: ['fix', 'resolve', 'debug', 'troubleshoot', 'remediate', 'repair', 'correct'],
  /* Checking correctness. */
  test: ['test', 'validate', 'verify', 'certify', 'qualify'],
  /* Working alongside people. */
  collaborate: ['collaborate', 'partner', 'coordinate', 'liaise', 'work with'],
  /* Directing people. */
  lead: ['lead', 'direct', 'head', 'spearhead', 'drive', 'oversee', 'supervise'],
  /* Teaching. */
  mentor: ['mentor', 'coach', 'train', 'teach', 'onboard', 'guide'],
  /* Helping without owning. */
  assist: ['assist', 'help', 'contribute', 'participate', 'aid', 'support with'],
  /* Recording. */
  document: ['document', 'record', 'catalogue', 'catalog'],
  /* Presenting. */
  present: ['present', 'report', 'communicate', 'brief', 'demo', 'demonstrate'],
  /* Acquiring. */
  acquire: ['acquire', 'procure', 'source', 'purchase', 'negotiate'],
  /* Planning. */
  plan: ['plan', 'schedule', 'forecast', 'budget', 'roadmap'],
  /* Delivering an outcome to someone. */
  deliver: ['deliver', 'complete', 'execute', 'achieve', 'accomplish'],
});

/* verb → family */
const VERB_FAMILY = new Map();
for (const [family, verbs] of Object.entries(ACTION_FAMILIES)) {
  for (const v of verbs) VERB_FAMILY.set(v, family);
}

/* Irregular past/participle forms that stemming will not recover. */
const IRREGULAR = new Map(Object.entries({
  wrote: 'write', written: 'write', built: 'build', ran: 'run', led: 'lead',
  drove: 'drive', driven: 'drive', rebuilt: 'rebuild', rewrote: 'rewrite',
  rewritten: 'rewrite', oversaw: 'oversee', overseen: 'oversee',
  taught: 'teach', sought: 'seek', made: 'make', met: 'meet', kept: 'keep',
  grew: 'grow', grown: 'grow', cut: 'cut', set: 'set', shipped: 'ship',
  spearheaded: 'spearhead', held: 'hold', brought: 'bring',
}));

/** Reduce an inflected verb to its base form, deterministically. */
export function baseVerb(word) {
  const w = String(word || '').toLowerCase().trim();
  if (!w) return '';
  if (IRREGULAR.has(w)) return IRREGULAR.get(w);
  if (VERB_FAMILY.has(w)) return w;

  /* Regular inflections, longest suffix first. */
  const tries = [];
  if (w.endsWith('ied')) tries.push(`${w.slice(0, -3)}y`);
  if (w.endsWith('ing')) { tries.push(w.slice(0, -3), `${w.slice(0, -3)}e`); }
  if (w.endsWith('ed')) { tries.push(w.slice(0, -2), w.slice(0, -1)); }
  if (w.endsWith('es')) { tries.push(w.slice(0, -2), w.slice(0, -1)); }
  if (w.endsWith('s')) tries.push(w.slice(0, -1));
  /* Doubled consonant: "shipped" → "shipp" → "ship" */
  if (/([bcdfghjklmnpqrstvwxz])\1$/.test(w.slice(0, -2))) tries.push(w.slice(0, -3));

  for (const t of tries) if (VERB_FAMILY.has(t)) return t;
  return tries.find(Boolean) || w;
}

/** The action family a verb belongs to, or null if unknown. */
export function familyOf(word) {
  const b = baseVerb(word);
  return VERB_FAMILY.get(b) || null;
}

/* Placeholder openers. These are not actions — they are the absence of one.
   "Responsible for deployment configuration" does not say what the person
   DID; it says they were near it. There is therefore no original action for a
   rewrite to contradict, and action semantics has nothing to constrain.

   What verb may be introduced in their place is governed by the seniority
   ceiling and evidence binding, which is the correct home for that question.
   Treating these as unknown verbs instead would block every rewrite of
   exactly the weak bullets the engine exists to improve. */
const PLACEHOLDER_OPENERS = new Set([
  'responsible', 'accountable', 'involved', 'tasked', 'worked', 'engaged',
  'exposure', 'familiar', 'duties', 'handled', 'dealt', 'part',
]);

export function isPlaceholderOpener(word) {
  return PLACEHOLDER_OPENERS.has(String(word || '').toLowerCase().trim());
}

/* ------------------------------------------------------------------
   Predicate extraction
   ------------------------------------------------------------------
   Truth checks must identify the action being CLAIMED, not merely the first
   token in the sentence. Resume rewrites (and especially bounded LLM polish)
   can legitimately put an adverb before the verb or use passive voice:

       Successfully designed the service.
       The service was carefully designed.
       The service has been designed.

   Looking only at token 1 turns those into "successfully" / "the" and
   silently hides the factual action. Keep this extractor conservative: it
   recognizes a start-of-clause active predicate and a finite set of passive
   auxiliary shapes. It does not scan arbitrary subordinate clauses looking
   for verbs, which would create false positives from method/purpose phrases.
   ------------------------------------------------------------------ */
const LEADING_BULLET_RE = /^\s*(?:[-*•▪◦–—]+\s*)?/;
/* Explicit allow-list rather than `\w+ly`: resume nouns such as "Family"
   and "Supply" also end in -ly and must never be discarded as adverbs. */
const CLAIM_MODIFIERS = [
  'successfully', 'effectively', 'independently', 'proactively', 'carefully',
  'directly', 'consistently', 'personally', 'primarily', 'actively', 'jointly',
  'regularly', 'systematically', 'efficiently',
];
const MODIFIER_SRC = `(?:${CLAIM_MODIFIERS.join('|')})`;
const LEADING_MODIFIER_RE = new RegExp(`^(?:${MODIFIER_SRC}\\s+){0,3}`, 'i');
const PASSIVE_PREDICATE_RE = new RegExp(
  `\\b(?:(?:is|are|was|were)\\s+(?:being\\s+)?|(?:has|have|had)\\s+been\\s+|(?:be|been|being)\\s+)(?:(?:${MODIFIER_SRC})\\s+){0,3}([A-Za-z][\\w-]*)\\b`,
  'i',
);

/**
 * Identify the principal action predicate claimed by a sentence.
 *
 * @returns {{surface:string, base:string, family:string|null, voice:'ACTIVE'|'PASSIVE'|'UNKNOWN', detected:boolean}}
 */
export function extractClaimedPredicate(text) {
  const source = String(text || '').replace(LEADING_BULLET_RE, '').trim();
  if (!source) return { surface: '', base: '', family: null, voice: 'UNKNOWN', detected: false };

  /* Prefer a real active lead predicate. This avoids a later subordinate
     passive clause stealing principal-predicate status from a sentence that
     already begins with an action (for example, "Contributed to a service
     that was designed..."). */
  const withoutModifiers = source.replace(LEADING_MODIFIER_RE, '');
  const active = withoutModifiers.match(/^([A-Za-z][\w-]*)\b/);
  if (active) {
    const surface = active[1].toLowerCase();
    const base = baseVerb(surface);
    const family = familyOf(base);
    if (family || isPlaceholderOpener(surface)) {
      return { surface, base, family, voice: 'ACTIVE', detected: true };
    }
  }

  /* Noun-led passive sentences otherwise look like noun-led restructures and
     evade the action gate. Only accept the participle when it belongs to an
     audited action family. */
  const passive = source.match(PASSIVE_PREDICATE_RE);
  if (passive) {
    const surface = passive[1].toLowerCase();
    const base = baseVerb(surface);
    const family = familyOf(base);
    if (family) return { surface, base, family, voice: 'PASSIVE', detected: true };
  }

  /* Preserve the previous conservative behavior for an unknown active first
     token: surface it to the caller, which can fail closed with NOT_RUN. */
  if (active) {
    const surface = active[1].toLowerCase();
    const base = baseVerb(surface);
    return { surface, base, family: familyOf(base), voice: 'ACTIVE', detected: true };
  }

  return { surface: '', base: '', family: null, voice: 'UNKNOWN', detected: false };
}

export function leadVerb(text) {
  return extractClaimedPredicate(text).surface;
}

/* Families that are NEVER interchangeable even when a naive synonym
   dictionary would say otherwise. Listed explicitly because these are the
   substitutions that actually show up and actually mislead. */
const HARD_INCOMPATIBLE = [
  ['create', 'deploy'],       // writing a query is not launching it
  ['create', 'maintain'],     // building is not running
  ['rebuild', 'consolidate'], // rewriting one thing is not merging many
  ['rebuild', 'create'],      // rebuilding implies a predecessor existed
  ['assist', 'lead'],
  ['assist', 'create'],
  ['maintain', 'design'],
  ['configure', 'create'],
  ['migrate', 'create'],
  ['monitor', 'fix'],
  ['analyse', 'improve'],
  ['test', 'fix'],
  ['plan', 'deliver'],
  ['collaborate', 'lead'],
  ['document', 'create'],
];

function hardIncompatible(a, b) {
  return HARD_INCOMPATIBLE.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

/**
 * Validate that a rewrite has not changed the action being claimed.
 *
 * @param {string} candidate  proposed sentence
 * @param {object} evidence   the evidence record it derives from
 * @returns {{status:'PASS'|'FAIL'|'NOT_RUN', violations:Array, detail:string}}
 */
export function validateActionSemantics(candidate, evidence = {}) {
  const candVerb = leadVerb(candidate);
  /* The original action, preferring the parsed action over re-parsing text. */
  const srcVerb = String(evidence.action || '').toLowerCase() || leadVerb(evidence.rawText || '');

  if (!candVerb) {
    return {
      status: 'NOT_RUN', violations: [],
      detail: 'No lead verb could be identified in the candidate.',
    };
  }

  /* No source action at all, or only a placeholder: nothing to preserve. */
  if (!srcVerb || isPlaceholderOpener(srcVerb)) {
    return {
      status: 'PASS', violations: [],
      detail: srcVerb
        ? `"${srcVerb}" is a placeholder rather than an action, so no action claim is being changed.`
        : 'The source states no action, so no action claim is being changed.',
    };
  }

  const candBase = baseVerb(candVerb);
  const srcBase = baseVerb(srcVerb);
  if (candBase === srcBase) {
    return { status: 'PASS', violations: [], detail: 'Action unchanged.' };
  }

  const candFamily = familyOf(candVerb);
  const srcFamily = familyOf(srcVerb);

  /* An unknown verb on either side cannot be reasoned about. Report NOT_RUN
     so the caller decides — a mandatory validator that cannot run must not
     silently count as a pass. */
  if (!candFamily || !srcFamily) {
    /* An untaxonomised verb that was left ALONE is fine — nothing changed. */
    if (candBase === srcBase) {
      return { status: 'PASS', violations: [], detail: 'Action unchanged.' };
    }
    return {
      status: 'NOT_RUN',
      violations: [],
      detail: `Action semantics could not be assessed: ${!srcFamily ? `"${srcVerb}"` : `"${candVerb}"`} is not in the action taxonomy, and the action was changed.`,
    };
  }

  if (candFamily === srcFamily && !hardIncompatible(candFamily, srcFamily)) {
    return {
      status: 'PASS',
      violations: [],
      detail: `"${srcVerb}" → "${candVerb}" stays within the ${srcFamily} family.`,
    };
  }

  return {
    status: 'FAIL',
    violations: [{
      code: 'action_semantics',
      severity: 'critical',
      from: srcVerb,
      to: candVerb,
      fromFamily: srcFamily,
      toFamily: candFamily,
      detail: `Rewriting "${srcVerb}" as "${candVerb}" changes the action from ${srcFamily} to ${candFamily}. Wording may change; what happened may not.`,
    }],
    detail: `Action changed from ${srcFamily} to ${candFamily}.`,
  };
}

export default {
  ACTION_SEMANTICS_VERSION, ACTION_FAMILIES,
  baseVerb, familyOf, leadVerb, validateActionSemantics, isPlaceholderOpener,
};
