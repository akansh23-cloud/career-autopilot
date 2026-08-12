/* ============================================================
   DOMAIN VOCABULARY INTELLIGENCE — Narrative stage 6
   ------------------------------------------------------------
   Not a list of 200 power verbs. A vocabulary PROFILE per role
   family, carrying four different kinds of knowledge:

     verbs        what practitioners in this field actually say,
                  bucketed by INTENT (automation, reliability,
                  migration, ownership, analysis …) so the verb
                  is chosen by what the bullet must communicate.

     nouns        the domain's real technical nouns.

     collocations word pairs practitioners genuinely use together
                  ("configuration drift", "release gate",
                  "reconciliation break"). Collocations are what
                  make writing sound domain-authentic — far more
                  than verb variety does.

     register     seniority-appropriate framing. A fresher does
                  not "establish engineering standards"; a staff
                  engineer does not "assist with tasks".

   USAGE RULE (enforced by the composer, not by this file):
   a collocation may only be used when its HEAD NOUN is already
   present in the candidate's own evidence. Vocabulary shapes
   *how* a fact is said, never *what* is claimed.
   ============================================================ */
import { resolveDictionary } from '../roleDictionaries.js';
import { canonicalSkill } from '../skillOntology.js';

export const DOMAIN_VOCABULARY_VERSION = 'domain-vocabulary-v1';

/* Intent taxonomy shared with the bullet intent planner. */
export const INTENTS = Object.freeze([
  'scale', 'architecture', 'ownership', 'automation', 'reliability', 'security',
  'performance', 'delivery', 'leadership', 'migration', 'troubleshooting',
  'cost', 'data', 'product_impact', 'operational_excellence', 'innovation',
  'analysis', 'compliance', 'stakeholder', 'research',
]);

/* Cross-domain verbs that never sound wrong. Deliberately small — the point
   is that each family overrides with its own vocabulary. */
const BASE_VERBS = {
  automation: ['automated', 'scripted', 'scheduled', 'templated'],
  ownership: ['owned', 'ran', 'maintained', 'managed'],
  delivery: ['delivered', 'shipped', 'released', 'rolled out'],
  migration: ['migrated', 'moved', 'consolidated', 'ported'],
  architecture: ['designed', 'structured', 'modelled', 'laid out'],
  reliability: ['stabilised', 'hardened', 'recovered', 'contained'],
  troubleshooting: ['diagnosed', 'traced', 'isolated', 'resolved'],
  performance: ['tuned', 'profiled', 'optimised', 'reduced'],
  scale: ['scaled', 'extended', 'expanded', 'grew'],
  security: ['secured', 'restricted', 'audited', 'enforced'],
  cost: ['reduced', 'consolidated', 'rationalised', 'right-sized'],
  data: ['modelled', 'ingested', 'reconciled', 'validated'],
  analysis: ['analysed', 'quantified', 'benchmarked', 'segmented'],
  leadership: ['led', 'coordinated', 'mentored', 'reviewed'],
  product_impact: ['launched', 'defined', 'prioritised', 'validated'],
  operational_excellence: ['standardised', 'documented', 'streamlined', 'instrumented'],
  innovation: ['prototyped', 'piloted', 'introduced', 'trialled'],
  compliance: ['documented', 'evidenced', 'reconciled', 'certified'],
  stakeholder: ['aligned', 'briefed', 'partnered with', 'facilitated'],
  research: ['investigated', 'evaluated', 'characterised', 'replicated'],
};

/* -----------------------------------------------------------------
   Role-family vocabulary profiles.
   `verbs` are merged over BASE_VERBS; `collocations` are the real
   differentiator; `avoid` lists corporate words that read as filler
   inside THIS domain specifically.
   ----------------------------------------------------------------- */
const FAMILIES = {
  devops: {
    label: 'DevOps',
    matches: [/devops/, /release engineer/, /build engineer/, /ci\/?cd engineer/],
    verbs: {
      automation: ['automated', 'templated', 'parameterised', 'codified', 'scripted'],
      delivery: ['released', 'promoted', 'rolled out', 'gated', 'shipped'],
      reliability: ['stabilised', 'hardened', 'contained', 'rolled back', 'recovered'],
      operational_excellence: ['standardised', 'consolidated', 'baselined', 'instrumented'],
      migration: ['migrated', 'replatformed', 'containerised', 'consolidated'],
      security: ['gated', 'scanned', 'rotated', 'restricted', 'hardened'],
      troubleshooting: ['triaged', 'root-caused', 'traced', 'reproduced'],
      ownership: ['owned', 'ran', 'operated', 'maintained'],
    },
    nouns: ['deployment', 'pipeline', 'cluster', 'rollout', 'release', 'manifest', 'artifact', 'runtime', 'configuration', 'secret', 'namespace', 'image', 'agent', 'runner', 'environment'],
    collocations: [
      ['pipeline', 'deployment pipeline'], ['pipeline', 'build pipeline'], ['pipeline', 'release pipeline'],
      ['configuration', 'configuration drift'], ['configuration', 'runtime configuration'], ['configuration', 'deployment configuration'],
      ['release', 'release workflow'], ['release', 'release gate'], ['release', 'release step'],
      ['rollout', 'rollout validation'], ['rollout', 'rollout strategy'],
      ['cluster', 'cluster capacity'], ['cluster', 'cluster access'],
      ['artifact', 'artifact repository'], ['artifact', 'build artifact'],
      ['secret', 'secret rotation'], ['secret', 'secret management'],
      ['manifest', 'deployment manifest'], ['image', 'container image'],
      ['environment', 'environment promotion'], ['environment', 'environment parity'],
      ['deployment', 'deployment frequency'], ['runtime', 'runtime configuration'],
    ],
    avoid: ['synergy', 'cutting-edge', 'game-changing', 'best-in-class', 'transformative'],
  },
  sre: {
    label: 'Site Reliability Engineering',
    matches: [/\bsre\b/, /site reliability/, /production engineer/],
    verbs: {
      reliability: ['stabilised', 'contained', 'mitigated', 'absorbed', 'degraded gracefully'],
      troubleshooting: ['root-caused', 'triaged', 'traced', 'correlated', 'reproduced'],
      operational_excellence: ['instrumented', 'alerted on', 'documented', 'runbooked'],
      performance: ['reduced', 'tuned', 'shed load from', 'profiled'],
    },
    nouns: ['incident', 'alert', 'runbook', 'error budget', 'saturation', 'latency', 'availability', 'postmortem', 'on-call', 'toil', 'dashboard', 'probe'],
    collocations: [
      ['incident', 'incident response'], ['incident', 'incident review'], ['alert', 'alert noise'], ['alert', 'alert threshold'],
      ['runbook', 'runbook coverage'], ['latency', 'tail latency'], ['availability', 'availability target'],
      ['on-call', 'on-call rotation'], ['toil', 'operational toil'], ['dashboard', 'service dashboard'],
      ['probe', 'health probe'], ['postmortem', 'blameless postmortem'],
    ],
    avoid: ['cutting-edge', 'world-class', 'seamless'],
  },
  platform: {
    label: 'Platform Engineering',
    matches: [/platform engineer/, /internal developer platform/, /infrastructure engineer/],
    verbs: {
      architecture: ['designed', 'modelled', 'abstracted', 'layered'],
      ownership: ['owned', 'operated', 'maintained', 'supported'],
      operational_excellence: ['standardised', 'templated', 'documented', 'paved'],
      automation: ['self-serviced', 'automated', 'codified', 'templated'],
    },
    nouns: ['platform', 'module', 'blueprint', 'golden path', 'tenant', 'guardrail', 'provisioning', 'catalog', 'abstraction', 'onboarding'],
    collocations: [
      ['platform', 'platform capability'], ['module', 'reusable module'], ['module', 'terraform module'],
      ['guardrail', 'policy guardrail'], ['provisioning', 'self-service provisioning'],
      ['tenant', 'tenant isolation'], ['onboarding', 'team onboarding'], ['catalog', 'service catalog'],
      ['path', 'golden path'], ['blueprint', 'infrastructure blueprint'],
    ],
    avoid: ['revolutionary', 'cutting-edge'],
  },
  cloud: {
    label: 'Cloud Engineering',
    matches: [/cloud engineer/, /cloud architect/, /cloud infrastructure/, /aws engineer/, /azure engineer/],
    verbs: {
      migration: ['migrated', 'replatformed', 'lifted', 'consolidated', 'landed'],
      cost: ['right-sized', 'reserved', 'rationalised', 'reduced'],
      security: ['scoped', 'restricted', 'encrypted', 'isolated'],
      architecture: ['designed', 'segmented', 'zoned', 'peered'],
    },
    nouns: ['account', 'landing zone', 'subnet', 'workload', 'instance', 'bucket', 'policy', 'role', 'region', 'endpoint', 'quota'],
    collocations: [
      ['zone', 'landing zone'], ['policy', 'least-privilege policy'], ['policy', 'IAM policy'],
      ['workload', 'production workload'], ['account', 'account boundary'], ['region', 'multi-region deployment'],
      ['quota', 'service quota'], ['endpoint', 'private endpoint'], ['instance', 'instance family'],
      ['cost', 'cloud spend'], ['bucket', 'object storage'],
    ],
    avoid: ['cutting-edge', 'holistic'],
  },
  backend: {
    label: 'Backend Engineering',
    matches: [/backend/, /server[- ]side/, /api engineer/],
    verbs: {
      architecture: ['designed', 'decoupled', 'modelled', 'partitioned'],
      performance: ['cached', 'batched', 'indexed', 'profiled', 'reduced'],
      delivery: ['shipped', 'released', 'exposed', 'versioned'],
      reliability: ['retried', 'idempotency-guarded', 'rate-limited', 'hardened'],
    },
    nouns: ['endpoint', 'service', 'schema', 'contract', 'queue', 'worker', 'transaction', 'payload', 'index', 'cache', 'migration', 'handler'],
    collocations: [
      ['endpoint', 'API endpoint'], ['contract', 'API contract'], ['schema', 'database schema'],
      ['queue', 'message queue'], ['worker', 'background worker'], ['transaction', 'transaction boundary'],
      ['cache', 'cache layer'], ['index', 'database index'], ['migration', 'schema migration'],
      ['service', 'downstream service'], ['payload', 'request payload'], ['handler', 'request handler'],
    ],
    avoid: ['robust', 'seamless', 'cutting-edge'],
  },
  frontend: {
    label: 'Frontend Engineering',
    matches: [/frontend/, /front[- ]end/, /\bui engineer/, /web developer/],
    verbs: {
      architecture: ['componentised', 'structured', 'co-located', 'typed'],
      performance: ['lazy-loaded', 'code-split', 'memoised', 'reduced'],
      delivery: ['shipped', 'released', 'rolled out'],
      product_impact: ['implemented', 'built', 'launched'],
    },
    nouns: ['component', 'route', 'state', 'bundle', 'render', 'accessibility', 'viewport', 'form', 'token', 'layout'],
    collocations: [
      ['component', 'reusable component'], ['bundle', 'bundle size'], ['state', 'application state'],
      ['render', 'render path'], ['accessibility', 'keyboard accessibility'], ['token', 'design token'],
      ['route', 'client-side route'], ['form', 'form validation'], ['layout', 'responsive layout'],
    ],
    avoid: ['pixel-perfect', 'cutting-edge', 'seamless'],
  },
  fullstack: {
    label: 'Full Stack Engineering',
    matches: [/full[- ]?stack/],
    verbs: {
      delivery: ['shipped', 'built', 'released', 'delivered'],
      architecture: ['designed', 'wired', 'structured', 'modelled'],
    },
    nouns: ['feature', 'endpoint', 'component', 'schema', 'flow', 'integration'],
    collocations: [
      ['feature', 'end-to-end feature'], ['flow', 'user flow'], ['integration', 'third-party integration'],
      ['endpoint', 'API endpoint'], ['schema', 'data schema'],
    ],
    avoid: ['cutting-edge'],
  },
  data_engineering: {
    label: 'Data Engineering',
    matches: [/data engineer/, /etl developer/, /analytics engineer/, /data platform/],
    verbs: {
      data: ['modelled', 'ingested', 'reconciled', 'partitioned', 'backfilled', 'deduplicated'],
      automation: ['orchestrated', 'scheduled', 'automated', 'parameterised'],
      performance: ['tuned', 'repartitioned', 'pruned', 'reduced'],
      reliability: ['validated', 'checkpointed', 'quarantined', 'reconciled'],
      migration: ['migrated', 'consolidated', 're-pointed', 'landed'],
    },
    nouns: ['pipeline', 'table', 'partition', 'schema', 'ingestion', 'batch', 'stream', 'warehouse', 'lakehouse', 'lineage', 'contract', 'job', 'checkpoint'],
    collocations: [
      ['pipeline', 'ingestion pipeline'], ['pipeline', 'batch pipeline'], ['pipeline', 'streaming pipeline'],
      ['table', 'fact table'], ['table', 'dimension table'], ['partition', 'partition strategy'],
      ['schema', 'schema evolution'], ['contract', 'data contract'], ['lineage', 'column-level lineage'],
      ['job', 'scheduled job'], ['batch', 'batch window'], ['warehouse', 'warehouse layer'],
      ['quality', 'data quality check'], ['load', 'incremental load'], ['checkpoint', 'stream checkpoint'],
    ],
    avoid: ['cutting-edge', 'big data solutions', 'robust'],
  },
  data_science: {
    label: 'Data Science',
    matches: [/data scientist/, /research scientist/, /applied scientist/],
    verbs: {
      analysis: ['analysed', 'quantified', 'segmented', 'characterised'],
      research: ['evaluated', 'ablated', 'replicated', 'hypothesised'],
      data: ['engineered features from', 'labelled', 'sampled', 'stratified'],
      performance: ['tuned', 'calibrated', 'regularised'],
    },
    nouns: ['model', 'feature', 'baseline', 'validation', 'cohort', 'distribution', 'signal', 'experiment', 'metric', 'label'],
    collocations: [
      ['model', 'baseline model'], ['feature', 'feature set'], ['validation', 'cross-validation'],
      ['experiment', 'offline experiment'], ['metric', 'evaluation metric'], ['distribution', 'class distribution'],
      ['cohort', 'holdout cohort'], ['signal', 'predictive signal'], ['label', 'label quality'],
    ],
    avoid: ['cutting-edge', 'state-of-the-art solutions', 'AI-powered'],
  },
  machine_learning: {
    label: 'Machine Learning Engineering',
    matches: [/machine learning engineer/, /\bml engineer/, /mlops/, /deep learning/],
    verbs: {
      delivery: ['served', 'deployed', 'packaged', 'versioned'],
      performance: ['quantised', 'batched', 'tuned', 'reduced'],
      reliability: ['monitored', 'shadow-tested', 'gated'],
      data: ['engineered features from', 'versioned', 'validated'],
    },
    nouns: ['model', 'inference', 'training run', 'checkpoint', 'feature store', 'drift', 'serving', 'pipeline', 'artifact'],
    collocations: [
      ['inference', 'inference latency'], ['model', 'model registry'], ['drift', 'feature drift'],
      ['serving', 'model serving'], ['run', 'training run'], ['store', 'feature store'],
      ['pipeline', 'training pipeline'], ['artifact', 'model artifact'],
    ],
    avoid: ['cutting-edge', 'revolutionary AI'],
  },
  cybersecurity: {
    label: 'Cybersecurity',
    matches: [/security engineer/, /cyber ?security/, /appsec/, /soc analyst/, /penetration test/, /infosec/],
    verbs: {
      security: ['hardened', 'restricted', 'segmented', 'revoked', 'quarantined'],
      compliance: ['evidenced', 'documented', 'mapped', 'attested'],
      troubleshooting: ['investigated', 'traced', 'contained', 'triaged'],
      operational_excellence: ['baselined', 'instrumented', 'catalogued'],
    },
    nouns: ['finding', 'control', 'exposure', 'privilege', 'boundary', 'detection', 'signature', 'vulnerability', 'baseline', 'incident'],
    collocations: [
      ['finding', 'critical finding'], ['control', 'preventive control'], ['control', 'detective control'],
      ['privilege', 'least privilege'], ['exposure', 'external exposure'], ['detection', 'detection rule'],
      ['vulnerability', 'vulnerability backlog'], ['boundary', 'trust boundary'], ['baseline', 'security baseline'],
    ],
    avoid: ['bulletproof', 'unhackable', 'cutting-edge'],
  },
  qa: {
    label: 'Quality Engineering',
    matches: [/\bqa\b/, /test engineer/, /quality assurance/, /sdet/],
    verbs: {
      automation: ['automated', 'parameterised', 'scripted'],
      reliability: ['stabilised', 'de-flaked', 'gated'],
      troubleshooting: ['reproduced', 'isolated', 'bisected'],
    },
    nouns: ['suite', 'case', 'regression', 'coverage', 'fixture', 'flake', 'harness', 'assertion'],
    collocations: [
      ['suite', 'regression suite'], ['coverage', 'test coverage'], ['flake', 'flaky test'],
      ['harness', 'test harness'], ['case', 'edge case'], ['fixture', 'test fixture'],
    ],
    avoid: ['bug-free', 'cutting-edge'],
  },
  product: {
    label: 'Product Management',
    matches: [/product manager/, /product owner/, /\bapm\b/, /product lead/],
    verbs: {
      product_impact: ['launched', 'shipped', 'defined', 'scoped'],
      stakeholder: ['aligned', 'briefed', 'negotiated with', 'facilitated'],
      analysis: ['segmented', 'quantified', 'instrumented', 'validated'],
      leadership: ['prioritised', 'sequenced', 'ran', 'chaired'],
    },
    nouns: ['roadmap', 'requirement', 'backlog', 'release', 'cohort', 'funnel', 'discovery', 'spec', 'adoption', 'retention'],
    collocations: [
      ['roadmap', 'quarterly roadmap'], ['backlog', 'delivery backlog'], ['funnel', 'activation funnel'],
      ['discovery', 'customer discovery'], ['spec', 'product spec'], ['adoption', 'feature adoption'],
      ['requirement', 'acceptance criteria'], ['release', 'phased release'], ['cohort', 'user cohort'],
    ],
    avoid: ['synergy', 'game-changing', 'disruptive', 'best-in-class'],
  },
  business_analysis: {
    label: 'Business Analysis',
    matches: [/business analyst/, /systems analyst/, /process analyst/],
    verbs: {
      analysis: ['mapped', 'documented', 'quantified', 'traced'],
      stakeholder: ['facilitated', 'aligned', 'gathered from', 'walked through'],
      compliance: ['evidenced', 'reconciled', 'signed off'],
    },
    nouns: ['requirement', 'process', 'workflow', 'stakeholder', 'specification', 'handoff', 'exception', 'control'],
    collocations: [
      ['requirement', 'functional requirement'], ['process', 'as-is process'], ['process', 'to-be process'],
      ['workflow', 'approval workflow'], ['specification', 'functional specification'],
      ['handoff', 'operational handoff'], ['exception', 'exception handling'],
    ],
    avoid: ['synergy', 'value-add', 'best-in-class'],
  },
  finance: {
    label: 'Finance',
    matches: [/financial analyst/, /\bfp&a\b/, /finance manager/, /treasury/, /controller/, /investment analyst/],
    verbs: {
      analysis: ['modelled', 'forecast', 'variance-analysed', 'reconciled'],
      compliance: ['reconciled', 'evidenced', 'substantiated', 'certified'],
      cost: ['rationalised', 'reduced', 'reallocated'],
      stakeholder: ['presented to', 'briefed', 'partnered with'],
    },
    nouns: ['forecast', 'variance', 'accrual', 'reconciliation', 'close', 'exposure', 'covenant', 'ledger', 'provision', 'valuation'],
    collocations: [
      ['close', 'month-end close'], ['variance', 'variance analysis'], ['forecast', 'rolling forecast'],
      ['reconciliation', 'balance sheet reconciliation'], ['exposure', 'credit exposure'],
      ['ledger', 'general ledger'], ['provision', 'impairment provision'], ['model', 'three-statement model'],
    ],
    avoid: ['synergy', 'value-add', 'results-driven'],
  },
  accounting: {
    label: 'Accounting',
    matches: [/accountant/, /accounts payable/, /accounts receivable/, /audit associate/, /bookkeep/],
    verbs: {
      compliance: ['reconciled', 'substantiated', 'evidenced', 'certified'],
      operational_excellence: ['standardised', 'documented', 'streamlined'],
      analysis: ['reviewed', 'traced', 'aged'],
    },
    nouns: ['journal', 'entry', 'reconciliation', 'ledger', 'close', 'accrual', 'invoice', 'audit trail', 'control'],
    collocations: [
      ['entry', 'journal entry'], ['close', 'period close'], ['trail', 'audit trail'],
      ['reconciliation', 'account reconciliation'], ['invoice', 'invoice matching'], ['control', 'internal control'],
    ],
    avoid: ['results-driven', 'dynamic'],
  },
  consulting: {
    label: 'Consulting',
    matches: [/consultant/, /strategy associate/, /advisory/],
    verbs: {
      analysis: ['sized', 'benchmarked', 'diagnosed', 'quantified'],
      stakeholder: ['advised', 'facilitated', 'presented to', 'aligned'],
      delivery: ['delivered', 'ran', 'led'],
    },
    nouns: ['engagement', 'workstream', 'deliverable', 'diagnostic', 'recommendation', 'steering committee', 'baseline'],
    collocations: [
      ['workstream', 'client workstream'], ['diagnostic', 'current-state diagnostic'],
      ['recommendation', 'prioritised recommendation'], ['deliverable', 'client deliverable'],
      ['committee', 'steering committee'], ['case', 'business case'],
    ],
    avoid: ['synergy', 'best-in-class', 'thought leadership'],
  },
  marketing: {
    label: 'Marketing',
    matches: [/marketing/, /growth manager/, /content strategist/, /brand manager/, /seo/, /demand generation/],
    verbs: {
      product_impact: ['launched', 'ran', 'positioned', 'published'],
      analysis: ['segmented', 'attributed', 'tested', 'measured'],
      stakeholder: ['briefed', 'coordinated with', 'partnered with'],
    },
    nouns: ['campaign', 'channel', 'audience', 'creative', 'funnel', 'landing page', 'segment', 'copy', 'cadence'],
    collocations: [
      ['campaign', 'lifecycle campaign'], ['channel', 'paid channel'], ['audience', 'audience segment'],
      ['funnel', 'acquisition funnel'], ['page', 'landing page'], ['test', 'A/B test'],
      ['cadence', 'publishing cadence'], ['creative', 'creative variant'],
    ],
    avoid: ['cutting-edge', 'game-changing', 'synergy', 'best-in-class'],
  },
  sales: {
    label: 'Sales',
    matches: [/sales/, /account executive/, /business development/, /\bbdr\b/, /\bsdr\b/],
    verbs: {
      product_impact: ['closed', 'won', 'expanded', 'renewed'],
      stakeholder: ['prospected', 'qualified', 'negotiated with', 'presented to'],
      ownership: ['owned', 'managed', 'ran'],
    },
    nouns: ['pipeline', 'quota', 'territory', 'account', 'deal', 'renewal', 'objection', 'discovery call'],
    collocations: [
      ['pipeline', 'qualified pipeline'], ['account', 'named account'], ['deal', 'deal cycle'],
      ['renewal', 'renewal rate'], ['call', 'discovery call'], ['territory', 'territory plan'],
    ],
    avoid: ['results-driven', 'go-getter', 'rockstar'],
  },
  hr: {
    label: 'Human Resources',
    matches: [/human resources/, /\bhr\b/, /recruiter/, /talent acquisition/, /people operations/],
    verbs: {
      operational_excellence: ['standardised', 'documented', 'streamlined'],
      stakeholder: ['partnered with', 'advised', 'coached', 'briefed'],
      product_impact: ['ran', 'launched', 'closed'],
    },
    nouns: ['requisition', 'pipeline', 'onboarding', 'policy', 'cycle', 'offer', 'engagement survey', 'attrition'],
    collocations: [
      ['requisition', 'open requisition'], ['cycle', 'performance cycle'], ['pipeline', 'candidate pipeline'],
      ['onboarding', 'onboarding programme'], ['offer', 'offer acceptance'], ['policy', 'HR policy'],
    ],
    avoid: ['people person', 'results-driven'],
  },
  operations: {
    label: 'Operations',
    matches: [/operations manager/, /\bops\b/, /supply chain/, /logistics/, /service delivery/],
    verbs: {
      operational_excellence: ['standardised', 'streamlined', 'documented', 'sequenced'],
      cost: ['reduced', 'consolidated', 'rationalised'],
      reliability: ['stabilised', 'contained', 'escalated'],
    },
    nouns: ['throughput', 'backlog', 'SLA', 'handover', 'shift', 'vendor', 'inventory', 'escalation', 'cycle time'],
    collocations: [
      ['time', 'cycle time'], ['backlog', 'work backlog'], ['handover', 'shift handover'],
      ['escalation', 'escalation path'], ['vendor', 'vendor SLA'], ['inventory', 'inventory turn'],
    ],
    avoid: ['synergy', 'best-in-class'],
  },
  mechanical: {
    label: 'Mechanical Engineering',
    matches: [/mechanical engineer/, /design engineer/, /manufacturing engineer/, /\bcad\b/],
    verbs: {
      architecture: ['designed', 'dimensioned', 'toleranced', 'modelled'],
      analysis: ['simulated', 'validated', 'characterised', 'tested'],
      operational_excellence: ['standardised', 'documented', 'released'],
    },
    nouns: ['assembly', 'tolerance', 'fixture', 'drawing', 'load case', 'material', 'prototype', 'BOM', 'clearance'],
    collocations: [
      ['drawing', 'production drawing'], ['assembly', 'sub-assembly'], ['tolerance', 'tolerance stack-up'],
      ['case', 'load case'], ['prototype', 'functional prototype'], ['BOM', 'bill of materials'],
      ['analysis', 'finite element analysis'],
    ],
    avoid: ['cutting-edge', 'innovative solutions'],
  },
  electrical: {
    label: 'Electrical Engineering',
    matches: [/electrical engineer/, /power systems/, /substation/],
    verbs: {
      architecture: ['designed', 'sized', 'specified', 'routed'],
      analysis: ['tested', 'commissioned', 'measured', 'verified'],
      compliance: ['certified', 'documented', 'inspected'],
    },
    nouns: ['circuit', 'load', 'panel', 'relay', 'schematic', 'earthing', 'switchgear', 'harness', 'rating'],
    collocations: [
      ['study', 'load flow study'], ['schematic', 'wiring schematic'], ['panel', 'control panel'],
      ['relay', 'protection relay'], ['test', 'commissioning test'], ['rating', 'fault rating'],
    ],
    avoid: ['cutting-edge'],
  },
  electronics: {
    label: 'Electronics / Embedded',
    matches: [/electronics engineer/, /embedded/, /firmware/, /\bvlsi\b/, /\bpcb\b/],
    verbs: {
      architecture: ['designed', 'laid out', 'specified', 'partitioned'],
      analysis: ['characterised', 'debugged', 'probed', 'validated'],
      performance: ['reduced', 'tuned', 'optimised'],
    },
    nouns: ['board', 'firmware', 'register', 'interrupt', 'bring-up', 'schematic', 'peripheral', 'trace', 'bus'],
    collocations: [
      ['bring-up', 'board bring-up'], ['layout', 'PCB layout'], ['driver', 'device driver'],
      ['handler', 'interrupt handler'], ['bus', 'serial bus'], ['budget', 'power budget'],
    ],
    avoid: ['cutting-edge'],
  },
  civil: {
    label: 'Civil Engineering',
    matches: [/civil engineer/, /structural engineer/, /site engineer/, /construction/],
    verbs: {
      architecture: ['designed', 'detailed', 'specified', 'sequenced'],
      compliance: ['inspected', 'certified', 'documented'],
      operational_excellence: ['coordinated', 'scheduled', 'supervised'],
    },
    nouns: ['drawing', 'reinforcement', 'survey', 'quantity', 'foundation', 'inspection', 'programme', 'specification'],
    collocations: [
      ['drawing', 'GFC drawing'], ['survey', 'site survey'], ['quantity', 'bill of quantities'],
      ['inspection', 'quality inspection'], ['programme', 'construction programme'], ['design', 'structural design'],
    ],
    avoid: ['cutting-edge'],
  },
  research: {
    label: 'Research',
    matches: [/research/, /\bphd\b/, /scientist/, /\br&d\b/],
    verbs: {
      research: ['investigated', 'characterised', 'replicated', 'ablated', 'published'],
      analysis: ['quantified', 'compared', 'benchmarked'],
      innovation: ['prototyped', 'formulated', 'derived'],
    },
    nouns: ['study', 'protocol', 'dataset', 'hypothesis', 'apparatus', 'literature', 'reproducibility', 'finding'],
    collocations: [
      ['review', 'literature review'], ['study', 'pilot study'], ['protocol', 'experimental protocol'],
      ['analysis', 'statistical analysis'], ['dataset', 'benchmark dataset'],
    ],
    avoid: ['groundbreaking', 'revolutionary'],
  },
  graduate: {
    label: 'Graduate / Fresher',
    matches: [/fresher/, /graduate trainee/, /intern\b/, /trainee/, /student/],
    verbs: {
      delivery: ['built', 'implemented', 'developed', 'completed'],
      analysis: ['analysed', 'compared', 'documented'],
      leadership: ['coordinated', 'presented', 'contributed to'],
    },
    nouns: ['project', 'coursework', 'prototype', 'module', 'dataset', 'assignment', 'capstone'],
    collocations: [
      ['project', 'capstone project'], ['project', 'academic project'], ['prototype', 'working prototype'],
      ['module', 'coursework module'], ['dataset', 'public dataset'],
    ],
    avoid: ['spearheaded', 'architected', 'championed', 'transformed', 'strategic vision'],
  },
  general: {
    label: 'General Professional',
    matches: [],
    verbs: {},
    nouns: ['process', 'workflow', 'report', 'system', 'stakeholder', 'documentation', 'review'],
    collocations: [
      ['process', 'operating process'], ['review', 'peer review'], ['report', 'weekly report'],
      ['documentation', 'internal documentation'],
    ],
    avoid: ['synergy', 'results-driven', 'dynamic professional', 'cutting-edge'],
  },
};

/* -----------------------------------------------------------------
   Seniority register. These are FRAMING permissions, not verb tables.
   `maxOwnership` caps how much authority language may be used at all.
   ----------------------------------------------------------------- */
export const SENIORITY_REGISTER = Object.freeze({
  student: {
    label: 'Graduate',
    maxOwnership: 1,
    preferredIntents: ['delivery', 'automation', 'analysis', 'data', 'architecture'],
    discouragedIntents: ['leadership', 'ownership'],
    openers: ['built', 'implemented', 'developed', 'analysed', 'created', 'wrote', 'tested'],
    forbidden: ['architected', 'spearheaded', 'established company-wide', 'defined the strategy', 'drove organisational'],
    scopeWords: ['project', 'coursework', 'prototype'],
  },
  early: {
    label: 'Early career',
    maxOwnership: 2,
    preferredIntents: ['delivery', 'automation', 'troubleshooting', 'data', 'analysis'],
    discouragedIntents: ['leadership'],
    openers: ['built', 'implemented', 'automated', 'developed', 'supported', 'improved', 'debugged'],
    forbidden: ['architected the platform', 'defined the strategy', 'drove organisational'],
    scopeWords: ['service', 'module', 'workflow'],
  },
  mid: {
    label: 'Mid career',
    maxOwnership: 3,
    preferredIntents: ['ownership', 'automation', 'migration', 'reliability', 'operational_excellence', 'data', 'performance'],
    discouragedIntents: [],
    openers: ['owned', 'automated', 'standardised', 'migrated', 'integrated', 'improved', 'rebuilt'],
    forbidden: ['defined the company strategy'],
    scopeWords: ['service', 'platform', 'pipeline', 'environment'],
  },
  senior: {
    label: 'Senior',
    maxOwnership: 4,
    preferredIntents: ['architecture', 'ownership', 'leadership', 'migration', 'reliability', 'cost', 'operational_excellence'],
    discouragedIntents: [],
    openers: ['designed', 'led', 'owned', 'established', 'consolidated', 'set the direction for', 'reviewed'],
    forbidden: [],
    scopeWords: ['platform', 'estate', 'organisation-wide', 'programme'],
  },
  executive: {
    label: 'Executive',
    maxOwnership: 5,
    preferredIntents: ['leadership', 'architecture', 'cost', 'product_impact', 'stakeholder'],
    discouragedIntents: [],
    openers: ['set', 'led', 'established', 'restructured', 'directed', 'sponsored'],
    forbidden: [],
    scopeWords: ['function', 'organisation', 'portfolio', 'business unit'],
  },
});

/* -----------------------------------------------------------------
   Resolution
   ----------------------------------------------------------------- */
const FAMILY_KEYS = Object.keys(FAMILIES);

export function resolveRoleFamily(roleText = '', { skills = [] } = {}) {
  const t = String(roleText || '').toLowerCase();
  for (const key of FAMILY_KEYS) {
    const f = FAMILIES[key];
    if ((f.matches || []).some((re) => re.test(t))) return key;
  }
  /* Fall back to the existing role dictionary so we keep one taxonomy. */
  const dict = resolveDictionary(roleText);
  const mapped = {
    'DevOps Engineer': 'devops', 'Cloud Engineer': 'cloud', 'Data Engineer': 'data_engineering',
    'Data Scientist': 'data_science', 'Data Analyst': 'data_science', 'Software Engineer': 'backend',
    'Frontend Developer': 'frontend', 'Backend Developer': 'backend', 'Full Stack Developer': 'fullstack',
    'QA Engineer': 'qa', 'Product Manager': 'product', 'Business Analyst': 'business_analysis',
    'HR / Recruiter': 'hr',
  }[dict.name];
  if (mapped) return mapped;

  /* Last resort: infer from the skill mix. */
  const canon = new Set(skills.map(canonicalSkill));
  const votes = [
    ['data_engineering', ['spark', 'airflow', 'snowflake', 'etl', 'pyspark', 'dbt', 'kafka']],
    ['devops', ['kubernetes', 'docker', 'jenkins', 'terraform', 'ci/cd', 'helm', 'openshift']],
    ['frontend', ['react', 'css', 'html', 'typescript', 'next.js']],
    ['backend', ['node.js', 'spring boot', 'rest api', 'postgresql', 'java']],
    ['data_science', ['machine learning', 'pandas', 'scikit-learn', 'tensorflow', 'pytorch']],
  ];
  let best = null; let bestScore = 0;
  for (const [fam, list] of votes) {
    const score = list.filter((s) => canon.has(canonicalSkill(s))).length;
    if (score > bestScore) { best = fam; bestScore = score; }
  }
  return bestScore >= 2 ? best : 'general';
}

export function vocabularyFor(familyKey, { seniority = 'mid' } = {}) {
  const fam = FAMILIES[familyKey] || FAMILIES.general;
  const register = SENIORITY_REGISTER[seniority] || SENIORITY_REGISTER.mid;
  const verbs = {};
  for (const intent of INTENTS) {
    const merged = [...(fam.verbs?.[intent] || []), ...(BASE_VERBS[intent] || [])];
    verbs[intent] = [...new Set(merged)];
  }
  const collocationsByHead = new Map();
  for (const [head, phrase] of fam.collocations || []) {
    const k = head.toLowerCase();
    if (!collocationsByHead.has(k)) collocationsByHead.set(k, []);
    collocationsByHead.get(k).push(phrase);
  }
  return {
    version: DOMAIN_VOCABULARY_VERSION,
    family: familyKey,
    label: fam.label,
    verbs,
    nouns: fam.nouns || [],
    collocations: fam.collocations || [],
    collocationsByHead,
    avoid: [...new Set([...(fam.avoid || []), ...(FAMILIES.general.avoid || [])])],
    register,
    seniority,
  };
}

/**
 * A collocation may only be offered when its HEAD NOUN already appears in the
 * candidate's own text. This is the rule that keeps vocabulary from becoming
 * fabrication: we upgrade "the config" to "deployment configuration" only
 * because the candidate already said config in a deployment context.
 */
export function eligibleCollocations(vocab, evidenceText) {
  const t = String(evidenceText || '').toLowerCase();
  const out = [];
  for (const [head, phrases] of vocab.collocationsByHead.entries()) {
    if (!new RegExp(`(?<![a-z])${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(t)) continue;
    for (const p of phrases) {
      /* Only phrases whose non-head words are also already present, or whose
         modifier is a technology the candidate named, are eligible. */
      const modifier = p.toLowerCase().replace(head.toLowerCase(), '').trim();
      if (!modifier || t.includes(modifier)) out.push({ head, phrase: p, grounded: 'full' });
    }
  }
  return out;
}

export function isDomainNoun(vocab, word) {
  const w = String(word || '').toLowerCase();
  return (vocab.nouns || []).some((n) => w.includes(n));
}

export function listFamilies() {
  return FAMILY_KEYS.map((k) => ({ key: k, label: FAMILIES[k].label }));
}

export default {
  DOMAIN_VOCABULARY_VERSION, INTENTS, SENIORITY_REGISTER,
  resolveRoleFamily, vocabularyFor, eligibleCollocations, isDomainNoun, listFamilies,
};
