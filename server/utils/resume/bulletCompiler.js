/* ============================================================
   BULLET COMPILER — deterministic sentence assembly (no AI)
   ------------------------------------------------------------
   compileBullet(facts) picks the richest eligible grammar
   pattern for the given category and renders it. HARD RULE:
   the output may only ever contain values supplied in `facts`
   — every metric/tech/scope in the sentence traces to an input
   field (guarded by containsOnlyProvidedNumbers below and by
   the Truth Engine at the document level).

   QUANTIFICATION ENGINE: for weak bullets, identifies WHICH
   structured fields would strengthen them and asks — it never
   invents the values.
   ============================================================ */
import { eligiblePatterns, conjugateVerb, verbInfo, tenseForContext } from './grammarLibrary.js';

export const COMPILER_VERSION = 'bullet-compiler-v2-vocabulary';

const clean = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');

export function normalizeFacts(facts = {}) {
  const f = {};
  for (const k of ['action', 'object', 'scope', 'outcome', 'outcomeValue', 'method', 'purpose', 'system', 'process', 'metric', 'result']) {
    f[k] = clean(facts[k]).slice(0, 160);
  }
  f.tech = Array.isArray(facts.tech)
    ? facts.tech.map(clean).filter(Boolean).slice(0, 6)
    : clean(facts.tech) ? clean(facts.tech).split(/\s*,\s*/).slice(0, 6) : [];
  f.category = clean(facts.category).toUpperCase() || 'GENERIC';
  f.tense = facts.tense === 'present' ? 'present' : facts.current ? 'present' : 'past';
  return f;
}

/* Numbers in output must all appear in input facts (fabrication guard). */
export function containsOnlyProvidedNumbers(text, facts) {
  const inputNums = new Set(JSON.stringify(facts).match(/\d+(?:\.\d+)?/g) || []);
  for (const n of String(text).match(/\d+(?:\.\d+)?/g) || []) {
    if (!inputNums.has(n)) return false;
  }
  return true;
}

/* Rank: more slots used = richer sentence; deterministic tiebreak by id. */
function patternRichness(p, f) {
  const filled = [...p.required, ...p.optional].filter((k) => {
    const v = f[k];
    return Array.isArray(v) ? v.length : v;
  }).length;
  return filled;
}

export function compileBullet(rawFacts = {}) {
  const f = normalizeFacts(rawFacts);
  const candidates = eligiblePatterns(f, f.category);
  if (!candidates.length) {
    return {
      ok: false, reason: 'insufficient_fields', compilerVersion: COMPILER_VERSION,
      missing: suggestMissingForCompile(f),
      text: '',
    };
  }
  const best = candidates
    .map((p) => ({ p, rich: patternRichness(p, f) }))
    .sort((a, b) => b.rich - a.rich || a.p.id.localeCompare(b.p.id))[0].p;

  const tense = tenseForContext({ current: f.tense === 'present' });
  const verb = f.action ? conjugateVerb(verbInfo(f.action)?.base || f.action, tense) : '';
  let text = best.render(f, verb, tense);
  text = text.replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1').replace(/\.\.$/, '.').trim();
  if (text && !/[.!?]$/.test(text)) text += '.';
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1);

  const safe = containsOnlyProvidedNumbers(text, f);
  return {
    ok: safe, compilerVersion: COMPILER_VERSION,
    patternId: best.id, text: safe ? text : '',
    reason: safe ? null : 'fabricated_number_blocked',
    facts: f,
  };
}

function suggestMissingForCompile(f) {
  const need = [];
  if (!f.action && !f.system) need.push({ field: 'action', question: 'What did you do? (e.g. automated, built, migrated)' });
  if (!f.object && !f.system && !f.process) need.push({ field: 'object', question: 'What did you work on? (e.g. deployment pipeline, billing service)' });
  return need;
}

/* ------------------------------------------------ quantification ---- */
export const QUANTIFICATION_VERSION = 'quantification-v1';

/* Category -> which fields would add measurable scope. Questions only —
   the user supplies values; the compiler never guesses them. */
const QUESTION_BANK = {
  deployment: [
    { field: 'scope', question: 'How many applications or environments did this cover?' },
    { field: 'outcomeValue', question: 'Roughly how much manual effort or time was reduced (e.g. 80%, 6 hrs/week)?' },
    { field: 'metric', question: 'Did deployment frequency or failure rate change measurably?' },
  ],
  pipeline: [
    { field: 'scope', question: 'How much data or how many jobs did the pipeline handle (e.g. 2TB/day, 40 jobs)?' },
    { field: 'outcomeValue', question: 'Did runtime or cost drop by a measurable amount?' },
  ],
  api: [
    { field: 'scope', question: 'What request volume or number of consumers did the API serve?' },
    { field: 'outcomeValue', question: 'Did latency or error rate improve by a known amount?' },
  ],
  team: [
    { field: 'scope', question: 'How many people or teams were involved?' },
  ],
  cost: [
    { field: 'outcomeValue', question: 'How much cost was saved (₹ / $ / %)?' },
  ],
  generic: [
    { field: 'scope', question: 'What scale did this operate at (users, records, requests, teams)?' },
    { field: 'outcomeValue', question: 'Is there a number that shows the improvement (%, time, money)?' },
  ],
};

function categorizeBulletText(text) {
  const t = String(text).toLowerCase();
  if (/deploy|release|ci\/cd|pipeline.*deploy/.test(t)) return 'deployment';
  if (/pipeline|etl|ingest|spark|airflow|batch/.test(t)) return 'pipeline';
  if (/\bapi\b|endpoint|service/.test(t)) return 'api';
  if (/team|mentor|led|coordinated/.test(t)) return 'team';
  if (/cost|spend|budget|billing/.test(t)) return 'cost';
  return 'generic';
}

export function quantificationPrompts(bullet) {
  const text = String(bullet?.text || bullet || '');
  if (/\d/.test(text)) return { needed: false, questions: [] }; // already quantified
  const cat = categorizeBulletText(text);
  return {
    needed: true, category: cat, version: QUANTIFICATION_VERSION,
    questions: (QUESTION_BANK[cat] || QUESTION_BANK.generic).slice(0, 3),
  };
}

export default { COMPILER_VERSION, QUANTIFICATION_VERSION, compileBullet, normalizeFacts, containsOnlyProvidedNumbers, quantificationPrompts };
