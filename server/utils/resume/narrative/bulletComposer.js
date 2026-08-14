/* ============================================================
   BULLET INTENT PLANNER + COMPOSITION ENGINE (stages 9 & 10)
   ------------------------------------------------------------
   Two jobs:

   1. INTENT PLANNING — decide what each bullet must COMMUNICATE
      before deciding how to say it. Intent is inferred from the
      evidence itself (verb family, presence of an outcome, scope,
      technology mix), then diversified across the section so a
      role does not read as six variations of one idea.

   2. COMPOSITION — for each evidence unit, produce 5–8 candidate
      sentences with genuinely different STRATEGIES and genuinely
      different STRUCTURES:

        A technical_precision   ACTION → SYSTEM → SCALE
        B impact_led            PROBLEM → CHANGE → RESULT
        C ownership_led         OWNERSHIP → SCOPE → TECHNOLOGY
        D architecture_led      ARCHITECTURE → IMPLEMENTATION → CONSEQUENCE
        E concise_ats           shortest defensible form
        F seniority_adjusted    register-matched framing
        G domain_natural        collocation-upgraded phrasing

   HOW IT AVOIDS FABRICATION BY CONSTRUCTION
   Composition is RECOMBINATION, not writing. Every candidate is
   assembled from spans the candidate themself wrote (action,
   object, method, scope, outcome) plus a connective vocabulary
   that carries no factual content ("by", "across", "which"). The
   only substitutions permitted are (a) verb register within the
   same semantic family and (b) collocation upgrades whose head
   noun is already in the source. The truth validator then checks
   the result anyway.
   ============================================================ */
import crypto from 'node:crypto';
import { conjugateVerb, verbInfo } from '../grammarLibrary.js';
import { vocabularyFor, eligibleCollocations, INTENTS } from './domainVocabulary.js';
import { validateAgainstEvidence } from './truthValidator.js';
import { applySpellingConvention, isNamedTool } from './candidateIntelligence.js';

import { rankAuthorizedVerbs, headNoun } from './objectVerbFit.js';
import {
  evidenceResponsibilityLevel, claimedResponsibilityLevel, RESPONSIBILITY,
} from './responsibilityScale.js';
import {
  authorizedActionsFor, classifyActionProvenance, PROVENANCE,
} from './actionProvenance.js';

export const BULLET_COMPOSER_VERSION = 'bullet-composer-v1';

/* Verbs that take a preposition before their object. Using them bare is the
   difference between "Contributed to the service" and "Contribute service". */
const PREPOSITIONAL_VERBS = {
  contribute: 'to', participate: 'in', assist: 'with', help: 'with', work: 'on',
};

/* These verbs are always realized in past tense in the contribution family,
   independent of the source's tense detection, which is unreliable when the
   source opener was a placeholder. */
function pastTense(base) {
  const irregular = { build: 'Built', write: 'Wrote', run: 'Ran', lead: 'Led' };
  if (irregular[base]) return irregular[base];
  const b = String(base);
  const past = /e$/.test(b) ? `${b}d` : /[^aeiou]y$/.test(b) ? `${b.slice(0, -1)}ied` : `${b}ed`;
  return past.charAt(0).toUpperCase() + past.slice(1);
}

/* Weak-opener parsing intentionally removes a/an/the before storing the object
   so downstream anatomy is clean. Contribution rewrites, however, need the
   original determiner back to remain human: "Worked on a Spring Boot service"
   should become "Contributed to a Spring Boot service", not "Contributed to
   Spring Boot service". Restore only a determiner explicitly present in the
   source; never invent one from noun heuristics. */
const WEAK_OPENER_WITH_DETERMINER_RE = /^(?:worked on|worked with|involved in|participated in|contributed to|helped with|helped on|helped|assisted with|assisted in|assisted|supported|part of|engaged in|responsible for|accountable for|in charge of|tasked with)\s+(a|an|the)\s+/i;

function restoreSourceDeterminer(objectPhrase, rawText) {
  const obj = String(objectPhrase || '').trim();
  if (!obj || /^(?:a|an|the)\s+/i.test(obj)) return obj;
  const m = String(rawText || '').trim().match(WEAK_OPENER_WITH_DETERMINER_RE);
  return m ? `${m[1]} ${obj}` : obj;
}

export const STRATEGIES = Object.freeze([
  'authorized_action',
  'contribution_safe',
  'denominalised',
  'technical_precision', 'impact_led', 'ownership_led', 'architecture_led',
  'concise_ats', 'seniority_adjusted', 'domain_natural',
]);

/* ------------------------------------------------------------------ */
/* Intent inference                                                    */
/* ------------------------------------------------------------------ */
const INTENT_SIGNALS = [
  { intent: 'automation', re: /\b(automat|script|schedul|trigger|orchestrat|manual|ci\/?cd|pipeline)\w*/i, weight: 3 },
  { intent: 'migration', re: /\b(migrat|port|move[d]? |replatform|upgrad|consolidat|decommission|cutover)\w*/i, weight: 3 },
  { intent: 'reliability', re: /\b(stabil|reliab|uptime|availab|incident|outage|failover|resilien|recover|rollback)\w*/i, weight: 3 },
  { intent: 'security', re: /\b(secur|vulnerab|scan|encrypt|access control|permission|iam|compliance|audit|veracode|prisma|sonarqube)\w*/i, weight: 3 },
  { intent: 'performance', re: /\b(latency|throughput|runtime|perform|optimi[sz]|tun(?:e|ed|ing)|speed|faster|slow)\w*/i, weight: 3 },
  { intent: 'cost', re: /\b(cost|spend|budget|licen[cs]e|savings?|billing|invoice amount|right[- ]siz)\w*/i, weight: 3 },
  { intent: 'architecture', re: /\b(architect|design|pattern|schema|contract|module|topology|boundar|layer|structur)\w*/i, weight: 2 },
  { intent: 'data', re: /\b(data ?(?:pipeline|set|quality|model)|ingest|etl|elt|warehouse|lakehouse|table|partition|reconcil|dataset|schema)\w*/i, weight: 2 },
  { intent: 'delivery', re: /\b(deploy|releas|ship|launch|rollout|deliver)\w*/i, weight: 2 },
  { intent: 'leadership', re: /\b(led|lead|mentor|coach|onboard|review(?:ed)? (?:code|work)|guid(?:e|ed)|train(?:ed)?)\b/i, weight: 3 },
  { intent: 'troubleshooting', re: /\b(debug|troubleshoot|root cause|diagnos|investigat|triag|reproduc|fix(?:ed)?)\w*/i, weight: 3 },
  { intent: 'scale', re: /\b(scal|volume|concurren|million|thousand|tb\b|gb\b|per (?:day|hour|second)|throughput)\w*/i, weight: 2 },
  { intent: 'operational_excellence', re: /\b(standardi[sz]|document|runbook|process|governance|template|baseline|consistency)\w*/i, weight: 2 },
  { intent: 'product_impact', re: /\b(customer|user|adoption|revenue|conversion|retention|feature|launch)\w*/i, weight: 2 },
  { intent: 'analysis', re: /\b(analy[sz]|report|dashboard|insight|forecast|model(?:led|ed)?|quantif|segment)\w*/i, weight: 2 },
  { intent: 'compliance', re: /\b(complian|regulat|audit|sox|basel|rbi|sebi|gdpr|control|evidence|attest|month[- ]end|period[- ]end|year[- ]end|close\b|ledger|intercompany|substantiat|sign[- ]off)\w*/i, weight: 3 },
  { intent: 'stakeholder', re: /\b(stakeholder|business (?:team|user)|liais|coordinat|present(?:ed)?|align)\w*/i, weight: 2 },
  { intent: 'innovation', re: /\b(prototyp|proof of concept|poc\b|pilot|introduc|first|new approach)\w*/i, weight: 2 },
  { intent: 'research', re: /\b(research|experiment|hypothes|literature|publish|ablat|replicat)\w*/i, weight: 3 },
  { intent: 'ownership', re: /\b(own(?:ed|ing)?|end[- ]to[- ]end|responsible|maintain|operat(?:e|ed))\w*/i, weight: 2 },
];

export function inferIntent(evidence) {
  const text = [evidence.rawText, evidence.object, evidence.outcome].filter(Boolean).join(' ');
  const scores = new Map();
  for (const sig of INTENT_SIGNALS) {
    const hits = (text.match(new RegExp(sig.re.source, 'gi')) || []).length;
    if (hits) scores.set(sig.intent, (scores.get(sig.intent) || 0) + hits * sig.weight);
  }
  if (!scores.size) return { intent: 'delivery', confidence: 0.3, alternatives: [] };
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = ranked.reduce((s, [, v]) => s + v, 0) || 1;
  return {
    intent: ranked[0][0],
    confidence: Number(Math.min(0.95, ranked[0][1] / total + 0.25).toFixed(2)),
    alternatives: ranked.slice(1, 4).map(([intent, score]) => ({ intent, score })),
  };
}

/**
 * Plan intents across a whole section so the bullets do not all say the same
 * kind of thing. Where an evidence unit has a strong second-choice intent and
 * its first choice is already saturated, the alternative is used.
 */
export function planSectionIntents(records, { maxSameIntent = 2, preferred = [] } = {}) {
  const plan = [];
  const used = new Map();
  const preferSet = new Set(preferred);
  /* Records with the most confident intent claim their slot first. */
  const scored = records.map((r) => ({ r, inf: inferIntent(r) }))
    .sort((a, b) => b.inf.confidence - a.inf.confidence);

  for (const { r, inf } of scored) {
    let chosen = inf.intent;
    const count = used.get(chosen) || 0;
    if (count >= maxSameIntent) {
      const alt = inf.alternatives.find((a) => (used.get(a.intent) || 0) < maxSameIntent);
      if (alt) chosen = alt.intent;
    }
    /* A JD-preferred intent breaks ties in its own favour. */
    if (preferSet.size && !preferSet.has(chosen)) {
      const preferredAlt = inf.alternatives.find((a) => preferSet.has(a.intent) && (used.get(a.intent) || 0) < maxSameIntent);
      if (preferredAlt && preferredAlt.score >= 2) chosen = preferredAlt.intent;
    }
    used.set(chosen, (used.get(chosen) || 0) + 1);
    plan.push({ evidenceId: r.id, intent: chosen, inferred: inf.intent, confidence: inf.confidence });
  }
  /* Restore the original record order — planning order was only for allocation. */
  const byId = new Map(plan.map((p) => [p.evidenceId, p]));
  return records.map((r) => byId.get(r.id)).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Deterministic structural variation                                  */
/* ------------------------------------------------------------------ */
/* A stable per-candidate seed. Includes the userKey so two different users
   with identical evidence receive different structural choices — without ever
   comparing, storing, or reading each other's text. */
export function variationSeed(userKey, evidenceId, salt = '') {
  return parseInt(
    crypto.createHash('sha256').update(`${userKey}\u0000${evidenceId}\u0000${salt}`).digest('hex').slice(0, 8),
    16,
  );
}

function pick(list, seed, offset = 0) {
  if (!list || !list.length) return '';
  return list[(seed + offset) % list.length];
}

/* ------------------------------------------------------------------ */
/* Sentence assembly primitives                                        */
/* ------------------------------------------------------------------ */
const CONNECTIVES = {
  method: ['using', 'through', 'via', 'with'],
  scope: ['across', 'spanning', 'covering'],
  purpose: ['to', 'so that'],
  result: ['reducing', 'removing', 'cutting'],
};

/* Truncating a noun phrase mid-preposition ("…billing records in") produces
   sentences that read as broken. Clip only at a content-word boundary. */
const DANGLING = /^(in|on|of|for|to|with|by|and|or|the|a|an|at|as|from|into|across|using|via|through|that|which|per)$/i;
function clipPhrase(phrase, maxWords) {
  const words = String(phrase || '').split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  let out = words.slice(0, maxWords);
  while (out.length > 2 && DANGLING.test(out[out.length - 1])) out.pop();
  return out.join(' ');
}

const clean = (s) => String(s || '')
  .replace(/\s+/g, ' ')
  .replace(/\s+([,.;:])/g, '$1')
  .replace(/,\s*,/g, ',')
  .replace(/\.\.+$/, '.')
  .trim();

/* Remove a trailing prepositional phrase whose content already appeared
   earlier in the same sentence ("… for the ticket module across the ticket
   module"). Recombination can produce these; a reader never should. */
function dropRepeatedTail(text) {
  let t = String(text);
  const TAIL = /\s+(?:across|spanning|covering|for|using|via|through|with|built on|to)\s+([^,.;]{4,80})$/i;
  for (let i = 0; i < 2; i += 1) {
    const m = t.match(TAIL);
    if (!m) break;
    const tail = m[1].trim().toLowerCase().replace(/^(the|a|an)\s+/, '');
    const head = t.slice(0, m.index).toLowerCase();
    if (tail && head.includes(tail)) t = t.slice(0, m.index);
    else break;
  }
  return t;
}

function finish(s) {
  let t = clean(dropRepeatedTail(s));
  if (!t) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += '.';
  /* Never leave a dangling connective. */
  if (/\b(using|through|via|with|across|and|to|by|for)\.$/i.test(t)) return '';
  return t;
}

function gerund(base) {
  const b = String(base || '').toLowerCase();
  if (!b) return '';
  if (/e$/.test(b) && !/ee$/.test(b)) return `${b.slice(0, -1)}ing`;
  if (/[^aeiou][aeiou][bdgklmnprt]$/.test(b) && b.length <= 5) return `${b}${b.slice(-1)}ing`;
  return `${b}ing`;
}

/* Verb register mapping — SAME semantic family only. This never promotes a
   contributor to an architect: `built → developed` is a register change,
   `built → architected` is a claim change and is not in any map. */
const REGISTER_MAP = {
  student: {
    owned: 'worked on', standardised: 'documented', standardized: 'documented',
    architected: 'designed', led: 'coordinated', established: 'set up', drove: 'supported',
    spearheaded: 'ran', defined: 'documented',
  },
  early: {
    architected: 'designed', established: 'set up', spearheaded: 'ran', drove: 'supported',
  },
  mid: {},
  senior: {},
  executive: {},
};

function registerAdjust(verb, seniority) {
  const map = REGISTER_MAP[seniority] || {};
  return map[String(verb || '').toLowerCase()] || verb;
}

/* Choose an intent-appropriate verb from the domain vocabulary — but ONLY if
   it is in the same semantic family as the candidate's own verb, or the
   candidate had no leading verb at all (weak opener case). */
const SEMANTIC_FAMILIES = {
  build: ['built', 'developed', 'implemented', 'created', 'wrote', 'delivered', 'shipped', 'launched', 'produced', 'assembled'],
  automate: ['automated', 'scripted', 'scheduled', 'orchestrated', 'templated', 'parameterised', 'codified', 'self-serviced'],
  change: ['migrated', 'moved', 'ported', 'consolidated', 'replatformed', 'upgraded', 'refactored', 'restructured', 'rebuilt', 'containerised'],
  operate: ['maintained', 'supported', 'operated', 'ran', 'monitored', 'administered', 'managed'],
  own: ['owned', 'ran', 'operated', 'managed', 'maintained'],
  improve: ['improved', 'optimised', 'optimized', 'tuned', 'reduced', 'streamlined', 'stabilised', 'stabilized', 'hardened', 'strengthened'],
  standardise: ['standardised', 'standardized', 'documented', 'baselined', 'formalised', 'aligned', 'consolidated'],
  design: ['designed', 'modelled', 'modeled', 'structured', 'specified', 'architected', 'laid out', 'partitioned'],
  investigate: ['debugged', 'diagnosed', 'investigated', 'traced', 'triaged', 'reproduced', 'root-caused', 'isolated', 'resolved'],
  analyse: ['analysed', 'analyzed', 'quantified', 'benchmarked', 'evaluated', 'segmented', 'measured', 'compared', 'reviewed'],
  integrate: ['integrated', 'connected', 'wired', 'embedded', 'onboarded', 'added'],
  lead: ['led', 'mentored', 'coached', 'coordinated', 'facilitated', 'chaired', 'guided', 'supervised'],
  secure: ['secured', 'hardened', 'restricted', 'encrypted', 'gated', 'scanned', 'enforced', 'remediated'],
  test: ['tested', 'validated', 'verified', 'certified', 'reconciled', 'checked'],
  communicate: ['presented', 'briefed', 'reported', 'documented', 'published', 'aligned'],
};

function familyOf(verb) {
  const v = String(verb || '').toLowerCase();
  for (const [fam, list] of Object.entries(SEMANTIC_FAMILIES)) {
    if (list.includes(v)) return fam;
  }
  return '';
}

function sameFamilyAlternatives(verb, vocab, intent) {
  const fam = familyOf(verb);
  if (!fam) return [];
  const family = SEMANTIC_FAMILIES[fam] || [];
  const intentVerbs = (vocab.verbs?.[intent] || []).map((v) => v.toLowerCase());
  /* Prefer domain verbs that are also in the same semantic family. */
  const preferred = intentVerbs.filter((v) => family.includes(v));
  const rest = family.filter((v) => v !== String(verb).toLowerCase() && !preferred.includes(v));
  return [...preferred, ...rest];
}

/* ------------------------------------------------------------------ */
/* Collocation upgrade — grounded phrasing                             */
/* ------------------------------------------------------------------ */
function upgradeWithCollocation(phrase, evidence, vocab) {
  if (!phrase) return phrase;
  const eligible = eligibleCollocations(vocab, evidence.rawText);
  if (!eligible.length) return phrase;
  let out = phrase;
  for (const c of eligible.slice(0, 2)) {
    /* Replace a bare head noun with the full collocation only when the bare
       noun stands alone (not already part of the collocation). */
    const bare = new RegExp(`(?<![\\w-])(${c.head})(?![\\w-])`, 'i');
    if (!bare.test(out)) continue;
    if (new RegExp(c.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(out)) continue;
    /* Upgrading "forecast" to "rolling forecast" inside "rolling 13-week cash
       forecast" produces a stutter. Only upgrade when the modifier words are
       not already in the phrase being rewritten. */
    const modifierWords = c.phrase.toLowerCase().replace(c.head.toLowerCase(), '').trim().split(/\s+/).filter(Boolean);
    if (modifierWords.some((w) => new RegExp(`(?<![a-z])${w}`, 'i').test(out))) continue;
    out = out.replace(bare, c.phrase);
    break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The strategies                                                      */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
   DE-NOMINALISATION  (P2.7)

   The single highest-value edit a human resume writer makes, and a
   purely structural one — no fact is added, removed or altered.

     "Responsible for deployment configuration of Java 17 services"
   →  "Configured Java 17 service deployments"

   Weak resumes are dense with buried verbs: "responsible for X
   management", "worked on Y development", "handled Z migration".
   The verb is already in the sentence, wearing a noun costume. Taking
   the costume off is safe because the verb was the candidate's own
   word, and it is what makes a rewrite read as edited rather than as
   synonym-swapped.
 * ------------------------------------------------------------------ */
const NOMINALISATIONS = new Map(Object.entries({
  configuration: 'configure', management: 'manage', development: 'develop',
  deployment: 'deploy', implementation: 'implement', migration: 'migrate',
  automation: 'automate', integration: 'integrate', optimisation: 'optimise',
  optimization: 'optimize', maintenance: 'maintain', administration: 'administer',
  monitoring: 'monitor', testing: 'test', validation: 'validate',
  provisioning: 'provision', orchestration: 'orchestrate', analysis: 'analyse',
  creation: 'create', execution: 'execute', coordination: 'coordinate',
  documentation: 'document', remediation: 'remediate', reconciliation: 'reconcile',
  verification: 'verify', delivery: 'deliver', resolution: 'resolve',
  troubleshooting: 'troubleshoot', refactoring: 'refactor', onboarding: 'onboard',
  provision: 'provision', reporting: 'report', forecasting: 'forecast',
  budgeting: 'budget', scheduling: 'schedule', procurement: 'procure',
  recruitment: 'recruit', training: 'train', negotiation: 'negotiate',
  installation: 'install', upgradation: 'upgrade', upgrade: 'upgrade',
  enhancement: 'enhance', standardisation: 'standardise', standardization: 'standardize',
  consolidation: 'consolidate', modernisation: 'modernise', modernization: 'modernize',
}));

/* Pluralise the buried noun so the remainder still reads as a noun phrase:
   "deployment configuration of Java 17 services"
     → verb "configure", object "Java 17 service deployments" */
/* Mass nouns have no plural. "accesses", "softwares" and "infrastructures"
   are the tell that a machine wrote the sentence. */
const UNCOUNTABLE = new Set([
  'access', 'support', 'maintenance', 'software', 'hardware', 'data',
  'infrastructure', 'security', 'compliance', 'training', 'feedback',
  'research', 'content', 'traffic', 'storage', 'documentation', 'monitoring',
  'testing', 'work', 'staff', 'equipment', 'tooling', 'governance',
  'automation', 'reporting', 'analytics', 'throughput', 'latency', 'uptime',
]);

function pluralise(word) {
  const w = String(word || '');
  if (!w) return w;
  if (UNCOUNTABLE.has(w.toLowerCase())) return w;
  if (/(s|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

function singularise(word) {
  const w = String(word || '');
  if (/ies$/i.test(w)) return `${w.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/i.test(w)) return w.slice(0, -2);
  if (/[^s]s$/i.test(w)) return w.slice(0, -1);
  return w;
}

/**
 * Find a buried verb in an object phrase and return the un-buried pieces.
 * Returns null when there is nothing to un-bury — silence is correct here,
 * because forcing the transform would mangle phrases it does not fit.
 */
export function denominalise(objectPhrase) {
  const phrase = String(objectPhrase || '').trim();
  if (!phrase) return null;

  /* The buried verb must be at the HEAD of the phrase. Without this guard,
     "GitLab CI pipelines for build, test and deployment of banking services"
     matches on the trailing "deployment of ..." and comes back as
     "banking service GitLab CI pipelines for build, test and deployments",
     which is worse than the input in every respect. A nominalisation buried
     behind a "for"/"and"/comma clause belongs to a subordinate phrase and is
     not the sentence's real verb. */
  const headOnly = phrase.split(/\s+(?:for|to|and|with|across|in|on)\s+|,/i)[0].trim();
  if (!headOnly) return null;

  /* Shape 1: "<modifier?> <nominal> of <rest>" */
  let m = headOnly.match(/^([a-z0-9][\w-]*(?:\s+[\w-]+){0,2}\s+)?([a-z]+(?:tion|ment|ance|ence|ing|sion))\s+of\s+(.+)$/i);
  if (m) {
    const [, lead, nominal, rest] = m;
    const verb = NOMINALISATIONS.get(nominal.toLowerCase());
    if (verb) {
      const modifier = (lead || '').trim();
      const restWords = rest.trim().split(/\s+/);
      if (!modifier) {
        /* "migration of legacy reporting jobs" → migrate + "legacy reporting jobs".
           The nominal IS the verb now, so it must not also stay as a noun. */
        return { verb, object: restWords.join(' ') };
      }
      /* "deployment configuration of Java 17 services"
         → configure + "Java 17 service deployments" */
      const head = NOMINALISATIONS.has(modifier.toLowerCase())
        ? pluralise(modifier.toLowerCase())
        : `${modifier} ${pluralise(nominal.toLowerCase())}`;
      restWords[restWords.length - 1] = singularise(restWords[restWords.length - 1]);
      return { verb, object: `${restWords.join(' ')} ${head}`.replace(/\s+/g, ' ').trim() };
    }
  }

  /* Shape 2: "<rest> <nominal>" → verb + pluralised rest.
     "pipeline automation" → automate + "pipelines" */
  m = headOnly.match(/^(.+?)\s+([a-z]+)$/i);
  if (m) {
    const [, rest, nominal] = m;
    const verb = NOMINALISATIONS.get(nominal.toLowerCase());
    if (verb && rest.split(/\s+/).length <= 5) {
      const words = rest.trim().split(/\s+/);
      words[words.length - 1] = pluralise(singularise(words[words.length - 1]));
      /* Anything the head clause dropped is re-attached unchanged, so no
         detail is lost by the transform. */
      const tail = phrase.slice(headOnly.length).trim();
      return { verb, object: `${words.join(' ')}${tail ? ` ${tail}` : ''}` };
    }
  }

  return null;
}

function buildStrategyCandidates(evidence, ctx) {
  const { vocab, seniority, intent, seed, targetTerms, voice } = ctx;
  const out = [];
  const add = (strategy, structure, text) => {
    const t = finish(text);
    if (t) out.push({ text: t, strategy, structure });
  };

  const tense = evidence.tense === 'present' ? 'present' : 'past';
  const baseVerb = evidence.actionBase || '';
  const alternatives = sameFamilyAlternatives(baseVerb, vocab, intent);

  const conjug = (v) => {
    if (!v) return '';
    const info = verbInfo(v);
    /* A verb the dictionary does not know is kept exactly as the candidate
       wrote it — guessing a conjugation would change their words. */
    if (!info && evidence.verbKnown === false && String(v).toLowerCase() === String(evidence.action).toLowerCase()) {
      return String(evidence.action).charAt(0).toUpperCase() + String(evidence.action).slice(1);
    }
    return conjugateVerb(info?.base || v, tense);
  };

  /* When the source had a weak opener with no verb at all, we must supply one.
     Only intent-appropriate, low-authority verbs are permitted, and the
     validator still checks the result. */
  /* Each weak opener has a FAITHFUL restatement. "Responsible for X" really is
     an ownership statement; "helped with X" really is not. Mapping them
     correctly is how vagueness is removed without inflating the claim. */
  const WEAK_OPENER_VERBS = {
    'responsible for': ['owned', 'ran', 'maintained', 'managed'],
    'duties included': ['owned', 'ran', 'maintained'],
    'worked on': ['developed', 'built', 'implemented', 'maintained'],
    'involved in': ['contributed to', 'supported', 'worked across'],
    'participated in': ['contributed to', 'supported'],
    'helped with': ['supported', 'contributed to'],
    'helped to': ['supported', 'contributed to'],
    'assisted with': ['supported', 'contributed to'],
    'contributed to the': ['contributed to', 'supported'],
    'was part of': ['contributed to', 'supported'],
    'part of': ['contributed to', 'supported'],
    'tasked with': ['handled', 'ran', 'delivered'],
    'exposure to': ['used', 'worked with'],
    'familiar with': ['used', 'worked with'],
  };

  const fallbackVerb = () => {
    const mapped = WEAK_OPENER_VERBS[String(evidence.weakOpener || '').toLowerCase()];
    if (mapped) {
      /* Ownership restatements still respect the seniority ceiling. */
      const allowed = ctx.ownershipCeiling >= 3 ? mapped : mapped.filter((v) => !/^(owned|managed|ran)$/i.test(v));
      const objectStem = String(evidence.object || '').toLowerCase();
      const usable = (allowed.length ? allowed : ['supported']).filter((v) => !objectStem.includes(v.slice(0, 5)));
      return registerAdjust(pick(usable.length ? usable : allowed, seed), seniority);
    }
    const objectStem = String(evidence.object || '').toLowerCase();
    const list = (vocab.verbs?.[intent] || [])
      .filter((v) => !/^(led|architected|established|defined|drove)$/i.test(v))
      /* never open with a verb whose stem is already the object — "automated
         certificate automation" is a tautology, not a sentence */
      .filter((v) => !objectStem.includes(String(v).toLowerCase().slice(0, 5)));
    return registerAdjust(pick(list.length ? list : ['handled', 'ran', 'supported'], seed), seniority);
  };

  const primary = conjug(registerAdjust(baseVerb || fallbackVerb(), seniority));
  const altVerb = alternatives.length ? conjug(registerAdjust(pick(alternatives, seed, 1), seniority)) : primary;

  const object = upgradeWithCollocation(evidence.object, evidence, vocab);
  const method = evidence.method;
  /* Reuse the preposition the candidate wrote; only fall back to the seeded
     pool when the span was reconstructed rather than quoted. */
  const withMethod = (offset) => (method
    ? ` ${evidence.methodConnective || pick(CONNECTIVES.method, seed, offset)} ${method}`
    : '');
  const scope = evidence.scope;
  const outcome = evidence.outcome;
  const outcomeVerb = evidence.outcomeVerb;
  const purpose = evidence.purpose;

  /* Prefer JD terminology only where it is an exact alias of a term the
     candidate already used — enforced upstream by targetTerms construction. */
  const applyTargetTerms = (s) => {
    let t = s;
    for (const { from, to } of targetTerms || []) {
      const re = new RegExp(`(?<![\\w-])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i');
      if (re.test(t) && !new RegExp(to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(t)) {
        t = t.replace(re, to);
        break; // one alignment per sentence — never keyword stuffing
      }
    }
    return t;
  };

  /* ---- A. technical_precision : ACTION → SYSTEM → SCALE ---- */
  if (object) {
    const parts = [primary, object];
    if (method) parts.push(withMethod(0).trim());
    if (scope) parts.push(`${pick(CONNECTIVES.scope, seed, 1)} ${scope}`);
    add('technical_precision', 'ACTION → SYSTEM → SCALE', parts.join(' '));
  }

  /* ---- B. impact_led : CHANGE → RESULT (outcome fronted) ---- */
  if (outcome && baseVerb) {
    const resultVerbMap = {
      reducing: 'Reduced', cutting: 'Cut', improving: 'Improved', increasing: 'Increased',
      saving: 'Saved', boosting: 'Boosted', lowering: 'Lowered', eliminating: 'Eliminated',
      removing: 'Removed', shortening: 'Shortened', accelerating: 'Accelerated',
      enabling: 'Enabled', allowing: 'Allowed', supporting: 'Supported',
    };
    const lead = resultVerbMap[outcomeVerb];
    if (lead) {
      add('impact_led', 'RESULT → CHANGE',
        `${lead} ${outcome} by ${gerund(baseVerb)} ${object}${withMethod(2)}`);
    } else {
      add('impact_led', 'CHANGE → RESULT',
        `${primary} ${object}${withMethod(0)}, ${outcomeVerb} ${outcome}`);
    }
  } else if (object && (method || scope)) {
    /* No stated outcome: state the change and the concrete condition it
       changed — never invent a result. */
    add('impact_led', 'CHANGE → CONDITION',
      `${primary} ${object}${scope ? ` ${pick(CONNECTIVES.scope, seed)} ${scope}` : ''}${method ? `,${withMethod(3)}` : ''}`);
  }

  /* ---- C. ownership_led : OWNERSHIP → SCOPE → TECHNOLOGY ----
     Only offered when the evidence actually asserts ownership. */
  const evidenceOwns = /\b(own(?:ed|ing)?|led|managed|maintained|operated|responsible for|end[- ]to[- ]end|ran)\b/i.test(evidence.rawText);
  if (evidenceOwns && object && ctx.ownershipCeiling >= 3) {
    const ownVerb = conjug(registerAdjust(pick(['owned', 'ran', 'maintained', 'operated'], seed, 2), seniority));
    add('ownership_led', 'OWNERSHIP → SCOPE → TECHNOLOGY',
      `${ownVerb} ${object}${scope ? ` ${pick(CONNECTIVES.scope, seed, 2)} ${scope}` : ''}${method ? `, built on ${method}` : ''}`);
  }

  /* ---- D. architecture_led : SYSTEM → CHANGE → CONSEQUENCE ---- */
  if (object && (method || scope) && /\b(design|architect|structur|schema|pattern|module|platform|system|service|pipeline|cluster|contract)\w*/i.test(`${object} ${method} ${evidence.rawText}`)) {
    const consequence = outcome ? `, ${outcomeVerb || 'reducing'} ${outcome}` : '';
    add('architecture_led', 'ARCHITECTURE → IMPLEMENTATION → CONSEQUENCE',
      `${primary} ${object}${withMethod(1)}${scope ? ` ${pick(CONNECTIVES.scope, seed)} ${scope}` : ''}${consequence}`);
  }

  /* ---- E. concise_ats : the shortest defensible form ---- */
  if (object) {
    const shortObject = clipPhrase(object, 12);
    const tech = (evidence.skillsDisplay || [])
      .filter(isNamedTool)
      .filter((t) => !new RegExp(`(?<![a-z0-9])${String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(shortObject))
      .slice(0, 2).join(' and ');
    add('concise_ats', 'ACTION → SYSTEM',
      `${primary} ${shortObject}${tech ? ` ${pick(CONNECTIVES.method, seed, 4)} ${tech}` : ''}`);
  }

  /* ---- F. seniority_adjusted ---- */
  if (object) {
    /* Register openers are only usable when the source verb puts us in a known
       semantic family. With no source verb (a weak opener), the faithful
       restatement from fallbackVerb() is the only safe lead — otherwise
       "worked on X" would silently become "owned X". */
    const fam = familyOf(baseVerb);
    const registerVerbs = fam
      ? (ctx.register?.openers || []).filter((v) => (SEMANTIC_FAMILIES[fam] || []).includes(v))
      : [];
    const rv = registerVerbs.length ? conjug(pick(registerVerbs, seed, 3)) : primary;
    add('seniority_adjusted', 'REGISTER → SYSTEM → CONTEXT',
      `${rv} ${object}${scope ? ` ${pick(CONNECTIVES.scope, seed, 3)} ${scope}` : ''}${outcome ? `, ${outcomeVerb || 'reducing'} ${outcome}` : withMethod(5)}`);
  }

  /* ---- I. authorized_action : same-level alternatives from the EVIDENCE ----
     Rewritten for A.1. This family used to ask the OBJECT which verbs sound
     natural and then claim them, which is how "Worked on a Spring Boot
     service" acquired "Designed"/"Developed"/"Deployed". Collocation strength
     answers "what sounds natural?"; it cannot answer "what did they do?".

     Now the evidence layer produces the AUTHORIZED SET and objectVerbFit only
     ranks within it. The language layer can no longer add a claim. */
  {
    const objectPhrase = evidence.object || '';
    const authorized = authorizedActionsFor(evidence, {
      recordActions: ctx.recordActions || [],
    });
    if (authorized.length && objectPhrase) {
      const ranked = rankAuthorizedVerbs({ object: objectPhrase, authorizedVerbs: authorized });
      const evidencedLevel = evidenceResponsibilityLevel(evidence.rawText || '');
      const cap = evidencedLevel === null ? RESPONSIBILITY.EXECUTED : evidencedLevel;
      for (const base of ranked.slice(0, 5)) {
        /* Prepositional verbs ("contribute TO", "participate IN") are
           ungrammatical bare — "Contribute Spring Boot service". They are
           realized by the contribution family below, which supplies the
           preposition. */
        if (PREPOSITIONAL_VERBS[base] !== undefined) continue;
        const claims = claimedResponsibilityLevel(`${base} x`);
        if (claims !== null && claims > cap) continue;
        const objHead = headNoun(objectPhrase);
        if (objHead && objHead.slice(0, 5) === String(base).slice(0, 5)) continue;
        const v = conjug(registerAdjust(base, seniority));
        if (!v) continue;
        const tail = outcome
          ? `, ${outcomeVerb || 'reducing'} ${outcome}`
          : purpose ? ` to ${purpose}` : '';
        add('authorized_action', 'AUTHORIZED VERB → OBJECT → CONTEXT',
          `${v} ${objectPhrase}${scope ? ` ${pick(CONNECTIVES.scope, seed, 5)} ${scope}` : ''}${withMethod(7)}${tail}`);
      }
    }
  }

  /* ---- J. contribution_safe : stronger writing at the SAME claim level ----
     A contribution-level bullet still deserves to read better. What it does
     not deserve is a promotion. "Worked on X for Y" → "Contributed to X
     supporting Y" is tighter and more specific without asserting anything new
     about what the person actually did. */
  {
    const prov = classifyActionProvenance(evidence, { recordActions: ctx.recordActions || [] });
    const isContribution = prov.category === PROVENANCE.CONTRIBUTION_ONLY
      || prov.category === PROVENANCE.UNKNOWN_ACTION;
    const objectPhrase = evidence.object || '';
    const associationOnly = String(evidence.weakOpener || '').toLowerCase() === 'worked with';
    if (isContribution && objectPhrase && !associationOnly) {
      const readableObject = restoreSourceDeterminer(objectPhrase, evidence.rawText || '');
      const opener = String(evidence.weakOpener || '').toLowerCase();
      const preferredContributionVerbs = /^(worked on|involved in|participated in|part of|contributed to the)$/.test(opener)
        ? ['contribute']
        : /^(helped|helped with|helped to|assisted|assisted with|assisted in|supported)$/.test(opener)
          ? ['support', 'contribute']
          : ['contribute', 'support'];
      for (const base of preferredContributionVerbs) {
        if (!prov.authorized.includes(base)) continue;
        const verb = pastTense(base);
        /* "support X" can imply operational support, which is more specific
           than mere involvement. For a CONTRIBUTION_ONLY source, keep support
           explicitly at the work level: "Supported work on X". */
        const lead = base === 'support'
          ? `${verb} work on `
          : `${verb} ${PREPOSITIONAL_VERBS[base] || ''} `;
        /* "for internal ticket routing" reads better as "supporting internal
           ticket routing" once the sentence already opens with a contribution
           verb — it avoids "Contributed to X for Y", which stacks two weak
           prepositions. */
        const purposeClause = purpose
          ? ` supporting ${purpose}`
          : scope ? ` ${pick(CONNECTIVES.scope, seed, 5)} ${scope}` : '';
        add('contribution_safe', 'CONTRIBUTION VERB → OBJECT → PURPOSE',
          `${lead}${readableObject}${purposeClause}${withMethod(7)}`);
      }
    }
  }

  /* ---- H. denominalised : buried verb → real verb (P2.7) ----
     Structural only. The verb was already the candidate's word; it was
     just wearing a noun. This is the family that makes the difference
     between "Ran deployment configuration of X" and "Configured X
     deployments", and it is why the engine reads as edited rather than
     as thesaurused. */
  {
    const nom = denominalise(evidence.object || '');
    if (nom) {
      const nomVerb = conjug(registerAdjust(nom.verb, seniority));
      /* The un-buried verb must still respect the ownership ceiling: a
         "managed" recovered from "management" is an ownership word, and a
         candidate whose evidence tops out below that does not get it. */
      const ownershipWord = /^(managed?|owned?|led|directed)$/i.test(nom.verb);
      if (nomVerb && (!ownershipWord || ctx.ownershipCeiling >= 3)) {
        const tail = outcome
          ? `, ${outcomeVerb || 'reducing'} ${outcome}`
          : purpose ? ` to ${purpose}` : '';
        add('denominalised', 'BURIED VERB → OBJECT → CONTEXT',
          `${nomVerb} ${nom.object}${scope ? ` ${pick(CONNECTIVES.scope, seed, 5)} ${scope}` : ''}${withMethod(7)}${tail}`);

        /* A second, tighter variant without the method clause, so the
           reranker has a genuinely shorter option for concise mode. */
        if (method) {
          add('denominalised', 'BURIED VERB → OBJECT',
            `${nomVerb} ${nom.object}${scope ? ` ${pick(CONNECTIVES.scope, seed, 5)} ${scope}` : ''}${tail}`);
        }
      }
    }
  }

  /* ---- G. domain_natural : collocation-forward phrasing ---- */
  if (object) {
    const natural = upgradeWithCollocation(
      upgradeWithCollocation(object, evidence, vocab),
      { ...evidence, rawText: `${evidence.rawText} ${method} ${scope}` },
      vocab,
    );
    const naturalMethod = method ? upgradeWithCollocation(method, evidence, vocab) : '';
    add('domain_natural', 'ACTION → DOMAIN OBJECT → EFFECT',
      `${altVerb} ${natural}${scope ? ` ${pick(CONNECTIVES.scope, seed, 4)} ${scope}` : ''}${naturalMethod ? ` ${evidence.methodConnective || pick(CONNECTIVES.method, seed, 6)} ${naturalMethod}` : ''}${outcome ? `, ${outcomeVerb || 'reducing'} ${outcome}` : purpose ? ` to ${purpose}` : ''}`);
  }

  /* ---- Preserve the original as a candidate. Sometimes the candidate's own
     sentence is genuinely the best one, and the scorer should be able to say
     so rather than being forced to change something. ---- */
  add('original', 'ORIGINAL', evidence.rawText);

  /* Apply JD terminology alignment + candidate spelling convention. */
  return out.map((c) => ({
    ...c,
    text: applySpellingConvention(applyTargetTerms(c.text), voice),
  }));
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */
/**
 * Compose validated candidate sentences for one evidence record.
 * Returns ONLY candidates that survived the truth validator.
 */
/* Structures that lead with, or carry, a supported outcome. Used by
   preferOutcomeLed modes to order candidates before scoring. */
const OUTCOME_LED_STRUCTURES = new Set([
  'RESULT_FIRST', 'ACTION_OBJECT_RESULT', 'ACTION_TECH_PURPOSE_RESULT',
  'CONTEXT_ACTION_OUTCOME', 'RESPONSIBILITY_SCOPE_IMPACT',
]);

/* Defence in depth: a forbidden JD term must never reach the reranker, let
   alone the document. The leakage audit is the backstop, not the only stop. */
function introducesForbidden(text, original, forbiddenTerms) {
  if (!forbiddenTerms || !forbiddenTerms.size) return false;
  for (const term of forbiddenTerms) {
    const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
    if (re.test(text) && !re.test(original)) return true;
  }
  return false;
}

export function composeCandidates(evidence, {
  roleFamily = 'general', seniority = 'mid', intent = 'delivery',
  userKey = 'anon', targetTerms = [], voice = null, ownershipCeiling = 3,
  globalPermittedSkills = null, aiCandidates = [], minCandidates = 5,
  maxCandidates = 4, ownershipBias = 0, preferOutcomeLed = false,
  forbiddenTerms = null, targetBulletLength = 24,
} = {}) {
  const vocab = vocabularyFor(roleFamily, { seniority });
  const seed = variationSeed(userKey, evidence.id, intent);
  /* Ownership bias can LOWER the effective ceiling but never raise it.
     A leadership-focused mode does not create leadership evidence; it only
     prefers ownership language among candidates the evidence already allows. */
  const effectiveCeiling = Math.max(0, ownershipCeiling + Math.min(0, ownershipBias));
  const ctx = {
    vocab, seniority, intent, seed, targetTerms, voice,
    ownershipCeiling: effectiveCeiling, register: vocab.register,
    preferOwnership: ownershipBias > 0, targetBulletLength,
  };

  /* When the candidate's own sentence names no system, technology, scope,
     method or number, there is nothing to recombine. Swapping its verb would
     dress up an empty claim, so the original stands and the engine reports a
     thin-evidence gap asking the user for the missing detail instead. */
  const anchorless = !evidence.hasConcreteAnchor && !evidence.method && !evidence.scope && !evidence.outcome;
  const raw = anchorless
    ? [{ text: finish(evidence.rawText), strategy: 'original', structure: 'ORIGINAL' }]
    : buildStrategyCandidates(evidence, ctx);
  for (const ai of aiCandidates) {
    raw.push({ text: finish(applySpellingConvention(ai.text, voice)), strategy: ai.strategy || 'ai_synthesis', structure: 'AI' });
  }

  /* Deduplicate on normalised form. */
  const seen = new Set();
  const unique = [];
  for (const c of raw) {
    if (!c.text) continue;
    const norm = c.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    unique.push(c);
  }

  /* THE GATE. */
  const accepted = [];
  const rejected = [];
  for (const c of unique) {
    if (introducesForbidden(c.text, evidence.rawText, forbiddenTerms)) {
      rejected.push({
        ...c,
        violations: [{
          type: 'UNSUPPORTED_REQUIREMENT_LEAKAGE', severity: 'critical',
          message: 'Candidate introduced a job-description term the evidence does not support.',
        }],
      });
      continue;
    }
    const v = validateAgainstEvidence(c.text, evidence, {
      ownershipCeiling: effectiveCeiling, globalPermittedSkills, seniority,
    });
    if (v.ok) {
      /* Carry the NAMED verdicts forward. Without this the later audit stage
         sees NOT_RUN for checks that were in fact run here, and — correctly,
         given what it can see — reverts a change that was already verified. */
      accepted.push({ ...c, truth: { ok: true, checks: v.checked }, verdicts: v.verdicts });
    }
    else rejected.push({ ...c, violations: v.blocking });
  }

  /* Outcome-led ordering for modes that ask for it. Ordering only — every
     candidate here has already passed the truth gate. */
  if (preferOutcomeLed && accepted.length > 1) {
    accepted.sort((a, b) => {
      const av = OUTCOME_LED_STRUCTURES.has(a.structure) ? 1 : 0;
      const bv = OUTCOME_LED_STRUCTURES.has(b.structure) ? 1 : 0;
      return bv - av;
    });
  }

  /* Never return nothing: the candidate's own sentence is always safe because
     it IS the evidence. If even that failed (impossible by construction), the
     caller keeps the original untouched. */
  if (!accepted.length) {
    accepted.push({ text: finish(evidence.rawText), strategy: 'original', structure: 'ORIGINAL', truth: { ok: true, checks: 0 } });
  }

  /* Every truth-passing candidate is returned. Truncating here would discard
     by GENERATION ORDER, which is arbitrary — the de-nominalised family is
     built last and was being cut before the reranker ever scored it, so the
     best sentence in the set never competed. Selection belongs to the
     reranker; generation belongs here.

     The set is bounded by construction (one candidate per composition family,
     ~9 max), so P2.26's "no unbounded candidate expansion" still holds.
     `maxCandidates` remains only as a pathological-input safety ceiling. */
  const CEILING = Math.max(maxCandidates, 12);
  const bounded = accepted.length > CEILING ? accepted.slice(0, CEILING) : accepted;

  return {
    version: BULLET_COMPOSER_VERSION,
    evidenceId: evidence.id,
    intent,
    generated: unique.length,
    accepted: bounded,
    rejected,
    rejectedCount: rejected.length,
    metMinimum: bounded.length >= Math.min(minCandidates, maxCandidates),
  };
}

export default {
  BULLET_COMPOSER_VERSION, STRATEGIES, INTENTS,
  inferIntent, planSectionIntents, composeCandidates, variationSeed,
};
