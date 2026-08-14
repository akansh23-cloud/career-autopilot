/* ============================================================
   OBJECT-AWARE VERB FIT  (Phase A2, and the substance of B4)
   ------------------------------------------------------------
   "Ran deployment configuration" is grammatical, truthful, and
   wrong. English does not put "ran" in front of "configuration";
   it puts "configured" in front of "deployments". The engine had
   no way to know that, so a two-word synonym swap kept beating a
   real rewrite in the reranker.

   This module scores how naturally a VERB sits with the HEAD NOUN
   of its object. It is not a truth check — a badly-worded true
   sentence is still true. It is the difference between output
   that reads as edited and output that reads as generated.

   Deliberately a whitelist of collocations rather than a
   blacklist of awkward pairs: the space of things nobody says is
   far larger than the space of things people do say.
   ============================================================ */

export const OBJECT_VERB_FIT_VERSION = 'object-verb-fit-v1';

/* Head noun → verbs that genuinely collocate with it. Written as base forms;
   candidates are stemmed before lookup. */
const COLLOCATIONS = {
  configuration: ['configure', 'maintain', 'administer', 'manage', 'standardise', 'standardize', 'update'],
  config: ['configure', 'maintain', 'manage', 'update'],
  pipeline: ['build', 'maintain', 'configure', 'implement', 'develop', 'extend', 'operate', 'automate'],
  workflow: ['build', 'implement', 'automate', 'standardise', 'standardize', 'streamline', 'design'],
  query: ['write', 'author', 'develop', 'optimise', 'optimize', 'tune'],
  deployment: ['configure', 'execute', 'support', 'coordinate', 'automate', 'manage', 'coordinate'],
  release: ['coordinate', 'manage', 'execute', 'automate', 'support', 'ship'],
  dashboard: ['build', 'create', 'maintain', 'design', 'develop'],
  report: ['build', 'produce', 'prepare', 'author', 'automate', 'deliver'],
  analysis: ['perform', 'conduct', 'run', 'lead', 'deliver'],
  campaign: ['manage', 'execute', 'launch', 'run', 'plan', 'deliver'],
  service: ['build', 'develop', 'maintain', 'operate', 'deploy', 'design', 'migrate'],
  api: ['build', 'develop', 'design', 'document', 'maintain', 'integrate'],
  test: ['write', 'automate', 'run', 'execute', 'maintain', 'develop'],
  suite: ['build', 'maintain', 'automate', 'extend'],
  script: ['write', 'author', 'develop', 'maintain', 'automate'],
  migration: ['execute', 'plan', 'coordinate', 'complete', 'support', 'lead'],
  infrastructure: ['provision', 'manage', 'maintain', 'automate', 'operate', 'design'],
  cluster: ['operate', 'manage', 'maintain', 'configure', 'provision', 'scale'],
  environment: ['configure', 'provision', 'maintain', 'manage', 'support'],
  database: ['design', 'maintain', 'optimise', 'optimize', 'administer', 'migrate', 'tune'],
  schema: ['design', 'migrate', 'maintain', 'model', 'update'],
  model: ['build', 'train', 'develop', 'validate', 'deploy', 'design'],
  budget: ['manage', 'plan', 'forecast', 'track', 'control'],
  forecast: ['build', 'produce', 'prepare', 'maintain', 'update'],
  process: ['design', 'standardise', 'standardize', 'streamline', 'document', 'automate', 'improve'],
  documentation: ['write', 'author', 'produce', 'maintain', 'update'],
  training: ['deliver', 'design', 'run', 'develop'],
  onboarding: ['run', 'design', 'streamline', 'support'],
  access: ['manage', 'administer', 'control', 'grant', 'review'],
  repository: ['manage', 'maintain', 'administer', 'configure'],
  incident: ['resolve', 'triage', 'investigate', 'manage', 'reduce'],
  ticket: ['resolve', 'triage', 'handle', 'close'],
  content: ['create', 'produce', 'write', 'plan', 'publish'],
  strategy: ['define', 'develop', 'shape', 'own', 'lead'],
  roadmap: ['define', 'own', 'build', 'maintain'],
  backlog: ['manage', 'groom', 'prioritise', 'prioritize'],
  team: ['lead', 'manage', 'mentor', 'grow', 'coordinate'],
  stakeholder: ['engage', 'manage', 'align', 'brief'],
};

/* Verbs that are so generic they read as filler in front of an abstract noun.
   They are not wrong; they are what a machine reaches for. */
const LOW_INFORMATION_VERBS = new Set(['run', 'do', 'handle', 'work', 'perform', 'operate', 'conduct']);

/* Abstract process nouns: pairing these with a low-information verb is the
   specific failure this module exists to catch ("ran configuration"). */
const ABSTRACT_PROCESS_NOUNS = new Set([
  'configuration', 'config', 'management', 'administration', 'maintenance',
  'development', 'implementation', 'integration', 'migration', 'automation',
  'optimisation', 'optimization', 'documentation', 'coordination',
  'validation', 'verification', 'provisioning', 'orchestration', 'delivery',
]);

function stem(word) {
  let w = String(word || '').toLowerCase();
  const irregular = {
    ran: 'run', built: 'build', wrote: 'write', led: 'lead', drove: 'drive',
    made: 'make', kept: 'keep', grew: 'grow', oversaw: 'oversee', taught: 'teach',
  };
  if (irregular[w]) return irregular[w].replace(/e$/, '');
  for (const suf of ['ised', 'ized', 'ing', 'ed', 'es', 's']) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) { w = w.slice(0, -suf.length); break; }
  }
  return w.replace(/e$/, '');
}

const stemmedCollocations = (() => {
  const m = new Map();
  for (const [noun, verbs] of Object.entries(COLLOCATIONS)) {
    m.set(noun, new Set(verbs.map(stem)));
  }
  return m;
})();

/** The head noun of an object phrase — the last noun before any preposition. */
/* Proper singularisation: "queries" → "query", not "querie". */
function singular(noun) {
  const n = String(noun || '');
  if (/ies$/.test(n)) return `${n.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/.test(n)) return n.slice(0, -2);
  if (/[^s]s$/.test(n)) return n.slice(0, -1);
  return n;
}

export function headNoun(objectPhrase) {
  const phrase = String(objectPhrase || '').toLowerCase().trim();
  if (!phrase) return '';
  /* Cut at the first preposition: "deployment configuration of X" → "deployment configuration" */
  const head = phrase.split(/\s+(?:of|for|to|in|on|across|with|using|through|by|at)\s+/)[0];
  const words = head.split(/\s+/).filter(Boolean);
  return words.length ? words[words.length - 1].replace(/[^a-z]/g, '') : '';
}

/**
 * How well does this verb sit with this object?
 *
 * @returns {{score:number, reason:string}} score in [0,1]; 0.5 is "no opinion"
 */
export function verbObjectFit(verb, objectPhrase) {
  const v = stem(verb);
  const noun = headNoun(objectPhrase);
  if (!v || !noun) return { score: 0.5, reason: 'no verb/object pair to assess' };

  const sing = singular(noun);
  const known = stemmedCollocations.get(noun) || stemmedCollocations.get(sing);

  if (known) {
    if (known.has(v)) return { score: 1, reason: `"${verb} ${noun}" is an idiomatic pairing` };
    /* The noun is known and this verb is not among its collocates. That is a
       real signal, not an absence of one. */
    if (LOW_INFORMATION_VERBS.has(v)) {
      return { score: 0.15, reason: `"${verb} ${noun}" is filler phrasing; the noun has natural verbs of its own` };
    }
    return { score: 0.45, reason: `"${verb} ${noun}" is not a usual pairing` };
  }

  /* Unknown noun: only penalise the specific, reliably-bad shape. */
  if (LOW_INFORMATION_VERBS.has(v) && ABSTRACT_PROCESS_NOUNS.has(sing)) {
    return { score: 0.2, reason: `"${verb} ${sing}" pairs a generic verb with an abstract process noun` };
  }
  return { score: 0.5, reason: 'no collocation data for this noun' };
}

/**
 * Verbs that genuinely fit this object, for candidate GENERATION rather than
 * scoring. Returns [] when there is no data, so the caller keeps its own verb.
 */
/* RANKING ONLY (A.1 §4). The authorized set is an INPUT. This function can
   reorder it; it cannot add to it. The previous `verbsForObject(object)` could
   hand the composer a verb the evidence never supported, which made a language
   heuristic into a factual claim. */
export function rankAuthorizedVerbs({ object, authorizedVerbs = [] } = {}) {
  return [...authorizedVerbs]
    .map((v) => ({ verb: v, fit: verbObjectFit(v, object).score }))
    .sort((a, b) => b.fit - a.fit || String(a.verb).localeCompare(String(b.verb)))
    .map((x) => x.verb);
}

/* Retained for naturalness diagnostics only. NEVER use the result as a claim —
   use rankAuthorizedVerbs with an evidence-derived set instead. */
export function verbsForObject(objectPhrase) {
  const noun = headNoun(objectPhrase);
  if (!noun) return [];
  return COLLOCATIONS[noun] || COLLOCATIONS[singular(noun)] || [];
}

/** Score a whole sentence by its opening verb against its object. */
export function scoreSentenceVerbFit(text) {
  const t = String(text || '').trim();
  const m = t.match(/^([A-Za-z][\w-]*)\s+(.*)$/);
  if (!m) return { score: 0.5, reason: 'no leading verb' };
  return verbObjectFit(m[1], m[2]);
}

export default {
  OBJECT_VERB_FIT_VERSION, verbObjectFit, verbsForObject, rankAuthorizedVerbs, headNoun,
  scoreSentenceVerbFit,
};
