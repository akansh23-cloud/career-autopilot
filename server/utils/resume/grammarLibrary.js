/* ============================================================
   GRAMMAR LIBRARY — deterministic bullet grammar for Resume OS
   ------------------------------------------------------------
   • PATTERNS: category-scoped sentence templates. Every pattern
     declares required + optional slots; a pattern is only
     eligible when ALL of its required slots have real values —
     missing fields can never produce broken grammar, and the
     compiler can never invent slot values (Truth Engine rule).
   • ACTION VERBS: contextual verb dictionaries + repetition
     detection with meaning-preserving alternatives.
   • TENSE ENGINE: current vs past conjugation + consistency
     detection.
   ============================================================ */

/* ------------------------------------------------ verbs ---- */
/* verb (base form) -> { past, present, group } */
export const VERB_GROUPS = Object.freeze([
  'BUILD', 'DEVELOP', 'DESIGN', 'AUTOMATE', 'OPTIMIZE', 'DELIVER', 'OPERATE', 'LEAD',
  'ANALYZE', 'IMPROVE', 'MIGRATE', 'SECURE', 'TEST', 'MONITOR', 'COLLABORATE', 'RESEARCH', 'SELL', 'MANAGE',
]);

const V = (past, present, group) => ({ past, present, group });
export const VERB_DICTIONARY = {
  build: V('Built', 'Build', 'BUILD'),
  create: V('Created', 'Create', 'BUILD'),
  implement: V('Implemented', 'Implement', 'BUILD'),
  engineer: V('Engineered', 'Engineer', 'BUILD'),
  construct: V('Constructed', 'Construct', 'BUILD'),
  develop: V('Developed', 'Develop', 'DEVELOP'),
  ship: V('Shipped', 'Ship', 'DEVELOP'),
  launch: V('Launched', 'Launch', 'DEVELOP'),
  prototype: V('Prototyped', 'Prototype', 'DEVELOP'),
  design: V('Designed', 'Design', 'DESIGN'),
  architect: V('Architected', 'Architect', 'DESIGN'),
  model: V('Modeled', 'Model', 'DESIGN'),
  automate: V('Automated', 'Automate', 'AUTOMATE'),
  orchestrate: V('Orchestrated', 'Orchestrate', 'AUTOMATE'),
  streamline: V('Streamlined', 'Streamline', 'AUTOMATE'),
  script: V('Scripted', 'Script', 'AUTOMATE'),
  optimize: V('Optimized', 'Optimize', 'OPTIMIZE'),
  tune: V('Tuned', 'Tune', 'OPTIMIZE'),
  refactor: V('Refactored', 'Refactor', 'OPTIMIZE'),
  accelerate: V('Accelerated', 'Accelerate', 'OPTIMIZE'),
  deliver: V('Delivered', 'Deliver', 'DELIVER'),
  deploy: V('Deployed', 'Deploy', 'DELIVER'),
  release: V('Released', 'Release', 'DELIVER'),
  operate: V('Operated', 'Operate', 'OPERATE'),
  maintain: V('Maintained', 'Maintain', 'OPERATE'),
  administer: V('Administered', 'Administer', 'OPERATE'),
  support: V('Supported', 'Support', 'OPERATE'),
  lead: V('Led', 'Lead', 'LEAD'),
  mentor: V('Mentored', 'Mentor', 'LEAD'),
  coordinate: V('Coordinated', 'Coordinate', 'LEAD'),
  drive: V('Drove', 'Drive', 'LEAD'),
  analyze: V('Analyzed', 'Analyze', 'ANALYZE'),
  evaluate: V('Evaluated', 'Evaluate', 'ANALYZE'),
  investigate: V('Investigated', 'Investigate', 'ANALYZE'),
  profile: V('Profiled', 'Profile', 'ANALYZE'),
  improve: V('Improved', 'Improve', 'IMPROVE'),
  reduce: V('Reduced', 'Reduce', 'IMPROVE'),
  increase: V('Increased', 'Increase', 'IMPROVE'),
  enhance: V('Enhanced', 'Enhance', 'IMPROVE'),
  migrate: V('Migrated', 'Migrate', 'MIGRATE'),
  modernize: V('Modernized', 'Modernize', 'MIGRATE'),
  port: V('Ported', 'Port', 'MIGRATE'),
  upgrade: V('Upgraded', 'Upgrade', 'MIGRATE'),
  secure: V('Secured', 'Secure', 'SECURE'),
  harden: V('Hardened', 'Harden', 'SECURE'),
  audit: V('Audited', 'Audit', 'SECURE'),
  test: V('Tested', 'Test', 'TEST'),
  validate: V('Validated', 'Validate', 'TEST'),
  verify: V('Verified', 'Verify', 'TEST'),
  monitor: V('Monitored', 'Monitor', 'MONITOR'),
  instrument: V('Instrumented', 'Instrument', 'MONITOR'),
  observe: V('Observed', 'Observe', 'MONITOR'),
  collaborate: V('Collaborated', 'Collaborate', 'COLLABORATE'),
  partner: V('Partnered', 'Partner', 'COLLABORATE'),
  research: V('Researched', 'Research', 'RESEARCH'),
  publish: V('Published', 'Publish', 'RESEARCH'),
  sell: V('Sold', 'Sell', 'SELL'),
  negotiate: V('Negotiated', 'Negotiate', 'SELL'),
  pitch: V('Pitched', 'Pitch', 'SELL'),
  manage: V('Managed', 'Manage', 'MANAGE'),
  own: V('Owned', 'Own', 'MANAGE'),
  oversee: V('Oversaw', 'Oversee', 'MANAGE'),
  plan: V('Planned', 'Plan', 'MANAGE'),
};

const PAST_TO_BASE = Object.fromEntries(Object.entries(VERB_DICTIONARY).map(([b, v]) => [v.past.toLowerCase(), b]));

export function verbInfo(word) {
  const w = String(word || '').toLowerCase().trim();
  if (VERB_DICTIONARY[w]) return { base: w, ...VERB_DICTIONARY[w] };
  if (PAST_TO_BASE[w]) { const b = PAST_TO_BASE[w]; return { base: b, ...VERB_DICTIONARY[b] }; }
  return null;
}

export function conjugateVerb(base, tense = 'past') {
  const v = verbInfo(base);
  if (!v) { // unknown verbs: past = +ed heuristic ONLY when already looks past; else return as-typed capitalised
    const w = String(base || '').trim();
    return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
  }
  return tense === 'present' ? v.present : v.past;
}

/* Alternatives from the SAME semantic group — replacing never changes meaning class. */
export function verbAlternatives(word, limit = 4) {
  const v = verbInfo(word);
  if (!v) return [];
  return Object.entries(VERB_DICTIONARY)
    .filter(([b, x]) => x.group === v.group && b !== v.base)
    .map(([b]) => b)
    .slice(0, limit);
}

/* Detect repeated starting verbs across bullets. */
export function detectVerbRepetition(bullets = [], threshold = 3) {
  const counts = new Map();
  for (const b of bullets) {
    const first = String(b.text || b || '').trim().split(/\s+/)[0] || '';
    const v = verbInfo(first);
    const key = v ? v.base : first.toLowerCase();
    if (!key) continue;
    if (!counts.has(key)) counts.set(key, { count: 0, display: first, isKnown: !!v });
    counts.get(key).count++;
  }
  const repeated = [...counts.entries()]
    .filter(([, x]) => x.count >= threshold)
    .map(([base, x]) => ({ verb: x.display, base, count: x.count, alternatives: x.isKnown ? verbAlternatives(base) : [] }));
  return { repeated, counts: Object.fromEntries([...counts.entries()].map(([k, v2]) => [k, v2.count])) };
}

/* ------------------------------------------------ tense ---- */
export function tenseForContext({ current = false } = {}) { return current ? 'present' : 'past'; }

/* Flags bullets whose leading verb tense conflicts with the role's tense. */
export function detectTenseIssues(bullets = []) {
  const issues = [];
  for (const b of bullets) {
    const text = String(b.text || '').trim();
    const first = text.split(/\s+/)[0] || '';
    const v = verbInfo(first);
    if (!v) continue;
    const expected = tenseForContext({ current: !!b.current });
    const isPastForm = first.toLowerCase() === v.past.toLowerCase();
    const actual = isPastForm ? 'past' : 'present';
    if (actual !== expected) {
      issues.push({
        bulletId: b.id || null, itemId: b.itemId || null, section: b.section || '',
        text: text.slice(0, 90), expected, actual,
        suggestion: conjugateVerb(v.base, expected) + text.slice(first.length),
      });
    }
  }
  return issues;
}

/* ------------------------------------------------ patterns ---- */
/* Slots: action(base verb) object tech scope outcome outcomeValue method purpose system process metric result */
export const PATTERN_CATEGORIES = Object.freeze([
  'SOFTWARE_ENGINEERING', 'DEVOPS', 'CLOUD', 'DATA_ENGINEERING', 'DATA_SCIENCE', 'ML_AI',
  'CYBERSECURITY', 'PRODUCT', 'FINANCE', 'CONSULTING', 'MARKETING', 'SALES', 'OPERATIONS',
  'HR', 'STUDENT_PROJECT', 'LEADERSHIP', 'RESEARCH', 'GENERIC',
]);

const P = (id, categories, required, optional, render) => ({ id, categories, required, optional, render });
const j = (...xs) => xs.filter(Boolean).join('');
const list = (v) => (Array.isArray(v) ? v.filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1') : String(v || ''));

export const PATTERNS = [
  P('act-obj-tech-outcome', ['GENERIC', 'SOFTWARE_ENGINEERING', 'DEVOPS', 'CLOUD', 'DATA_ENGINEERING'],
    ['action', 'object', 'tech', 'outcome'], ['outcomeValue', 'scope'],
    (f, verb) => j(verb, ' ', f.object, f.scope ? ` across ${f.scope}` : '', ` using ${list(f.tech)}`, ', ', outcomePhrase(f))),
  P('act-obj-tech', ['GENERIC', 'SOFTWARE_ENGINEERING', 'STUDENT_PROJECT', 'DATA_ENGINEERING', 'ML_AI'],
    ['action', 'object', 'tech'], ['scope'],
    (f, verb) => j(verb, ' ', f.object, f.scope ? ` for ${f.scope}` : '', ` using ${list(f.tech)}`, '.')),
  P('act-obj-scope-outcome', ['GENERIC', 'OPERATIONS', 'CONSULTING', 'PRODUCT', 'LEADERSHIP'],
    ['action', 'object', 'scope', 'outcome'], ['outcomeValue'],
    (f, verb) => j(verb, ' ', f.object, ` across ${f.scope}`, ', ', outcomePhrase(f))),
  P('designed-system-tech-purpose', ['SOFTWARE_ENGINEERING', 'DESIGN', 'CLOUD', 'DATA_ENGINEERING', 'GENERIC'],
    ['system', 'tech', 'purpose'], [],
    (f, verb, tense) => j(tense === 'present' ? 'Design' : 'Designed', ' ', f.system, ` using ${list(f.tech)}`, ` to ${f.purpose}`, '.')),
  P('implemented-system-scope-result', ['SOFTWARE_ENGINEERING', 'DEVOPS', 'CLOUD', 'GENERIC'],
    ['system', 'scope', 'result'], [],
    (f, verb, tense) => j(tense === 'present' ? 'Implement' : 'Implemented', ' ', f.system, ` supporting ${f.scope}`, ` with ${f.result}`, '.')),
  P('optimized-process-method-metric', ['OPTIMIZE', 'DEVOPS', 'DATA_ENGINEERING', 'OPERATIONS', 'FINANCE', 'GENERIC'],
    ['process', 'method', 'metric'], ['outcomeValue'],
    (f, verb, tense) => j(tense === 'present' ? 'Optimize' : 'Optimized', ' ', f.process, ` through ${f.method}`, `, reducing ${f.metric}`, f.outcomeValue ? ` by ${f.outcomeValue}` : '', '.')),
  P('act-obj-outcome', ['GENERIC', 'SALES', 'MARKETING', 'HR', 'PRODUCT'],
    ['action', 'object', 'outcome'], ['outcomeValue'],
    (f, verb) => j(verb, ' ', f.object, ', ', outcomePhrase(f))),
  P('act-obj', ['GENERIC', 'STUDENT_PROJECT'],
    ['action', 'object'], [],
    (f, verb) => j(verb, ' ', f.object, '.')),
  P('led-team-object-outcome', ['LEADERSHIP', 'MANAGE', 'GENERIC'],
    ['action', 'scope', 'object'], ['outcome', 'outcomeValue'],
    (f, verb) => j(verb, ' ', f.scope, ` to ${f.object}`, f.outcome ? `, ${outcomePhrase(f)}` : '.')),
  P('research-topic-method-result', ['RESEARCH', 'DATA_SCIENCE', 'ML_AI'],
    ['action', 'object', 'method'], ['result'],
    (f, verb) => j(verb, ' ', f.object, ` using ${f.method}`, f.result ? `, producing ${f.result}` : '', '.')),
  P('secured-system-method', ['CYBERSECURITY', 'SECURE'],
    ['action', 'system', 'method'], ['outcome', 'outcomeValue'],
    (f, verb) => j(verb, ' ', f.system, ` by ${f.method}`, f.outcome ? `, ${outcomePhrase(f)}` : '.')),
  P('analyzed-data-tech-insight', ['DATA_SCIENCE', 'DATA_ENGINEERING', 'FINANCE', 'ANALYZE'],
    ['action', 'object', 'tech', 'result'], [],
    (f, verb) => j(verb, ' ', f.object, ` with ${list(f.tech)}`, ` to surface ${f.result}`, '.')),
];

function outcomePhrase(f) {
  const val = f.outcomeValue ? ` by ${f.outcomeValue}` : '';
  const out = String(f.outcome || '').trim().replace(/\.$/, '');
  if (!out) return '';
  // "reducing manual deployment effort by 80%."
  return `${out}${val}.`;
}

/* Patterns whose EVERY required slot is filled. */
export function eligiblePatterns(facts = {}, category = 'GENERIC') {
  const has = (k) => {
    const v = facts[k];
    return Array.isArray(v) ? v.filter(Boolean).length > 0 : String(v || '').trim().length > 0;
  };
  return PATTERNS.filter((p) =>
    (p.categories.includes(category) || p.categories.includes('GENERIC')) &&
    p.required.every(has));
}

export default {
  VERB_GROUPS, VERB_DICTIONARY, verbInfo, conjugateVerb, verbAlternatives,
  detectVerbRepetition, tenseForContext, detectTenseIssues,
  PATTERN_CATEGORIES, PATTERNS, eligiblePatterns,
};
