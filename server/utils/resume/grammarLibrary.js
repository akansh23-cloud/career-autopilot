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
  'TRANSFORM', 'DOCUMENT', 'COMMUNICATE', 'SCALE', 'TRAIN', 'PREDICT', 'REMEDIATE', 'DIAGNOSE',
]);

const V = (past, present, group) => ({ past, present, group });
export const VERB_DICTIONARY = {
  build: V('Built', 'Build', 'BUILD'),
  create: V('Created', 'Create', 'BUILD'),
  implement: V('Implemented', 'Implement', 'BUILD'),
  engineer: V('Engineered', 'Engineer', 'BUILD'),
  construct: V('Constructed', 'Construct', 'BUILD'),
  establish: V('Established', 'Establish', 'BUILD'),
  assemble: V('Assembled', 'Assemble', 'BUILD'),
  provision: V('Provisioned', 'Provision', 'BUILD'),
  bootstrap: V('Bootstrapped', 'Bootstrap', 'BUILD'),
  instantiate: V('Instantiated', 'Instantiate', 'BUILD'),
  initialize: V('Initialized', 'Initialize', 'BUILD'),
  scaffold: V('Scaffolded', 'Scaffold', 'BUILD'),
  materialize: V('Materialized', 'Materialize', 'BUILD'),
  'stand-up': V('Stood up', 'Stand up', 'BUILD'),
  seed: V('Seeded', 'Seed', 'BUILD'),
  produce: V('Produced', 'Produce', 'BUILD'),
  fabricate: V('Fabricated', 'Fabricate', 'BUILD'),
  develop: V('Developed', 'Develop', 'DEVELOP'),
  extend: V('Extended', 'Extend', 'DEVELOP'),
  evolve: V('Evolved', 'Evolve', 'DEVELOP'),
  integrate: V('Integrated', 'Integrate', 'DEVELOP'),
  ship: V('Shipped', 'Ship', 'DEVELOP'),
  launch: V('Launched', 'Launch', 'DEVELOP'),
  prototype: V('Prototyped', 'Prototype', 'DEVELOP'),
  configure: V('Configured', 'Configure', 'DEVELOP'),
  customize: V('Customized', 'Customize', 'DEVELOP'),
  author: V('Authored', 'Author', 'DEVELOP'),
  compose: V('Composed', 'Compose', 'DEVELOP'),
  embed: V('Embedded', 'Embed', 'DEVELOP'),
  connect: V('Connected', 'Connect', 'DEVELOP'),
  augment: V('Augmented', 'Augment', 'DEVELOP'),
  ingest: V('Ingested', 'Ingest', 'DEVELOP'),
  adapt: V('Adapted', 'Adapt', 'DEVELOP'),
  iterate: V('Iterated', 'Iterate', 'DEVELOP'),
  modularize: V('Modularized', 'Modularize', 'DEVELOP'),
  encapsulate: V('Encapsulated', 'Encapsulate', 'DEVELOP'),
  enable: V('Enabled', 'Enable', 'DEVELOP'),
  wire: V('Wired', 'Wire', 'DEVELOP'),
  design: V('Designed', 'Design', 'DESIGN'),
  architect: V('Architected', 'Architect', 'DESIGN'),
  model: V('Modeled', 'Model', 'DESIGN'),
  define: V('Defined', 'Define', 'DESIGN'),
  devise: V('Devised', 'Devise', 'DESIGN'),
  formulate: V('Formulated', 'Formulate', 'DESIGN'),
  structure: V('Structured', 'Structure', 'DESIGN'),
  specify: V('Specified', 'Specify', 'DESIGN'),
  conceptualize: V('Conceptualized', 'Conceptualize', 'DESIGN'),
  blueprint: V('Blueprinted', 'Blueprint', 'DESIGN'),
  shape: V('Shaped', 'Shape', 'DESIGN'),
  partition: V('Partitioned', 'Partition', 'DESIGN'),
  outline: V('Outlined', 'Outline', 'DESIGN'),
  frame: V('Framed', 'Frame', 'DESIGN'),
  draft: V('Drafted', 'Draft', 'DESIGN'),
  diagram: V('Diagrammed', 'Diagram', 'DESIGN'),
  schematize: V('Schematized', 'Schematize', 'DESIGN'),
  automate: V('Automated', 'Automate', 'AUTOMATE'),
  orchestrate: V('Orchestrated', 'Orchestrate', 'AUTOMATE'),
  streamline: V('Streamlined', 'Streamline', 'AUTOMATE'),
  script: V('Scripted', 'Script', 'AUTOMATE'),
  codify: V('Codified', 'Codify', 'AUTOMATE'),
  schedule: V('Scheduled', 'Schedule', 'AUTOMATE'),
  systematize: V('Systematized', 'Systematize', 'AUTOMATE'),
  parameterize: V('Parameterized', 'Parameterize', 'AUTOMATE'),
  templatize: V('Templatized', 'Templatize', 'AUTOMATE'),
  industrialize: V('Industrialized', 'Industrialize', 'AUTOMATE'),
  optimize: V('Optimized', 'Optimize', 'OPTIMIZE'),
  tune: V('Tuned', 'Tune', 'OPTIMIZE'),
  refactor: V('Refactored', 'Refactor', 'OPTIMIZE'),
  accelerate: V('Accelerated', 'Accelerate', 'OPTIMIZE'),
  consolidate: V('Consolidated', 'Consolidate', 'OPTIMIZE'),
  simplify: V('Simplified', 'Simplify', 'OPTIMIZE'),
  standardize: V('Standardized', 'Standardize', 'OPTIMIZE'),
  rationalize: V('Rationalized', 'Rationalize', 'OPTIMIZE'),
  compress: V('Compressed', 'Compress', 'OPTIMIZE'),
  rightsize: V('Rightsized', 'Rightsize', 'OPTIMIZE'),
  parallelize: V('Parallelized', 'Parallelize', 'OPTIMIZE'),
  rebalance: V('Rebalanced', 'Rebalance', 'OPTIMIZE'),
  refine: V('Refined', 'Refine', 'OPTIMIZE'),
  'fine-tune': V('Fine-tuned', 'Fine-tune', 'OPTIMIZE'),
  debottleneck: V('Debottlenecked', 'Debottleneck', 'OPTIMIZE'),
  deliver: V('Delivered', 'Deliver', 'DELIVER'),
  deploy: V('Deployed', 'Deploy', 'DELIVER'),
  release: V('Released', 'Release', 'DELIVER'),
  execute: V('Executed', 'Execute', 'DELIVER'),
  introduce: V('Introduced', 'Introduce', 'DELIVER'),
  rollout: V('Rolled out', 'Roll out', 'DELIVER'),
  operationalize: V('Operationalized', 'Operationalize', 'DELIVER'),
  commission: V('Commissioned', 'Commission', 'DELIVER'),
  promote: V('Promoted', 'Promote', 'DELIVER'),
  activate: V('Activated', 'Activate', 'DELIVER'),
  enablement: V('Enabled', 'Enable', 'DELIVER'),
  operate: V('Operated', 'Operate', 'OPERATE'),
  maintain: V('Maintained', 'Maintain', 'OPERATE'),
  administer: V('Administered', 'Administer', 'OPERATE'),
  support: V('Supported', 'Support', 'OPERATE'),
  troubleshoot: V('Troubleshot', 'Troubleshoot', 'OPERATE'),
  resolve: V('Resolved', 'Resolve', 'OPERATE'),
  stabilize: V('Stabilized', 'Stabilize', 'OPERATE'),
  sustain: V('Sustained', 'Sustain', 'OPERATE'),
  run: V('Ran', 'Run', 'OPERATE'),
  triage: V('Triaged', 'Triage', 'OPERATE'),
  restore: V('Restored', 'Restore', 'OPERATE'),
  recover: V('Recovered', 'Recover', 'OPERATE'),
  administer: V('Administered', 'Administer', 'OPERATE'),
  service: V('Serviced', 'Service', 'OPERATE'),
  patch: V('Patched', 'Patch', 'OPERATE'),
  backfill: V('Backfilled', 'Backfill', 'OPERATE'),
  host: V('Hosted', 'Host', 'OPERATE'),
  lead: V('Led', 'Lead', 'LEAD'),
  mentor: V('Mentored', 'Mentor', 'LEAD'),
  coordinate: V('Coordinated', 'Coordinate', 'LEAD'),
  drive: V('Drove', 'Drive', 'LEAD'),
  guide: V('Guided', 'Guide', 'LEAD'),
  coach: V('Coached', 'Coach', 'LEAD'),
  facilitate: V('Facilitated', 'Facilitate', 'LEAD'),
  spearhead: V('Spearheaded', 'Spearhead', 'LEAD'),
  champion: V('Championed', 'Champion', 'LEAD'),
  delegate: V('Delegated', 'Delegate', 'LEAD'),
  mobilize: V('Mobilized', 'Mobilize', 'LEAD'),
  organize: V('Organized', 'Organize', 'LEAD'),
  chair: V('Chaired', 'Chair', 'LEAD'),
  steer: V('Steered', 'Steer', 'LEAD'),
  sponsor: V('Sponsored', 'Sponsor', 'LEAD'),
  analyze: V('Analyzed', 'Analyze', 'ANALYZE'),
  evaluate: V('Evaluated', 'Evaluate', 'ANALYZE'),
  investigate: V('Investigated', 'Investigate', 'ANALYZE'),
  profile: V('Profiled', 'Profile', 'ANALYZE'),
  assess: V('Assessed', 'Assess', 'ANALYZE'),
  diagnose: V('Diagnosed', 'Diagnose', 'ANALYZE'),
  benchmark: V('Benchmarked', 'Benchmark', 'ANALYZE'),
  examine: V('Examined', 'Examine', 'ANALYZE'),
  interpret: V('Interpreted', 'Interpret', 'ANALYZE'),
  quantify: V('Quantified', 'Quantify', 'ANALYZE'),
  correlate: V('Correlated', 'Correlate', 'ANALYZE'),
  reconcile: V('Reconciled', 'Reconcile', 'ANALYZE'),
  query: V('Queried', 'Query', 'ANALYZE'),
  identify: V('Identified', 'Identify', 'ANALYZE'),
  forecast: V('Forecasted', 'Forecast', 'ANALYZE'),
  compare: V('Compared', 'Compare', 'ANALYZE'),
  segment: V('Segmented', 'Segment', 'ANALYZE'),
  classify: V('Classified', 'Classify', 'ANALYZE'),
  derive: V('Derived', 'Derive', 'ANALYZE'),
  calculate: V('Calculated', 'Calculate', 'ANALYZE'),
  decompose: V('Decomposed', 'Decompose', 'ANALYZE'),
  scrutinize: V('Scrutinized', 'Scrutinize', 'ANALYZE'),
  triangulate: V('Triangulated', 'Triangulate', 'ANALYZE'),
  interrogate: V('Interrogated', 'Interrogate', 'ANALYZE'),
  dissect: V('Dissected', 'Dissect', 'ANALYZE'),
  parse: V('Parsed', 'Parse', 'ANALYZE'),
  improve: V('Improved', 'Improve', 'IMPROVE'),
  reduce: V('Reduced', 'Reduce', 'IMPROVE'),
  increase: V('Increased', 'Increase', 'IMPROVE'),
  enhance: V('Enhanced', 'Enhance', 'IMPROVE'),
  strengthen: V('Strengthened', 'Strengthen', 'IMPROVE'),
  lower: V('Lowered', 'Lower', 'IMPROVE'),
  boost: V('Boosted', 'Boost', 'IMPROVE'),
  elevate: V('Elevated', 'Elevate', 'IMPROVE'),
  minimize: V('Minimized', 'Minimize', 'IMPROVE'),
  shorten: V('Shortened', 'Shorten', 'IMPROVE'),
  uplift: V('Uplifted', 'Uplift', 'IMPROVE'),
  eliminate: V('Eliminated', 'Eliminate', 'IMPROVE'),
  decrease: V('Decreased', 'Decrease', 'IMPROVE'),
  amplify: V('Amplified', 'Amplify', 'IMPROVE'),
  maximize: V('Maximized', 'Maximize', 'IMPROVE'),
  reinforce: V('Reinforced', 'Reinforce', 'IMPROVE'),
  advance: V('Advanced', 'Advance', 'IMPROVE'),
  sharpen: V('Sharpened', 'Sharpen', 'IMPROVE'),
  migrate: V('Migrated', 'Migrate', 'MIGRATE'),
  modernize: V('Modernized', 'Modernize', 'MIGRATE'),
  port: V('Ported', 'Port', 'MIGRATE'),
  upgrade: V('Upgraded', 'Upgrade', 'MIGRATE'),
  transition: V('Transitioned', 'Transition', 'MIGRATE'),
  replatform: V('Replatformed', 'Replatform', 'MIGRATE'),
  convert: V('Converted', 'Convert', 'MIGRATE'),
  relocate: V('Relocated', 'Relocate', 'MIGRATE'),
  transfer: V('Transferred', 'Transfer', 'MIGRATE'),
  shift: V('Shifted', 'Shift', 'MIGRATE'),
  move: V('Moved', 'Move', 'MIGRATE'),
  secure: V('Secured', 'Secure', 'SECURE'),
  harden: V('Hardened', 'Harden', 'SECURE'),
  audit: V('Audited', 'Audit', 'SECURE'),
  remediate: V('Remediated', 'Remediate', 'SECURE'),
  enforce: V('Enforced', 'Enforce', 'SECURE'),
  protect: V('Protected', 'Protect', 'SECURE'),
  safeguard: V('Safeguarded', 'Safeguard', 'SECURE'),
  defend: V('Defended', 'Defend', 'SECURE'),
  shield: V('Shielded', 'Shield', 'SECURE'),
  fortify: V('Fortified', 'Fortify', 'SECURE'),
  isolate: V('Isolated', 'Isolate', 'SECURE'),
  restrict: V('Restricted', 'Restrict', 'SECURE'),
  encrypt: V('Encrypted', 'Encrypt', 'SECURE'),
  contain: V('Contained', 'Contain', 'SECURE'),
  mask: V('Masked', 'Mask', 'SECURE'),
  test: V('Tested', 'Test', 'TEST'),
  validate: V('Validated', 'Validate', 'TEST'),
  verify: V('Verified', 'Verify', 'TEST'),
  inspect: V('Inspected', 'Inspect', 'TEST'),
  exercise: V('Exercised', 'Exercise', 'TEST'),
  qualify: V('Qualified', 'Qualify', 'TEST'),
  reproduce: V('Reproduced', 'Reproduce', 'TEST'),
  certify: V('Certified', 'Certify', 'TEST'),
  'regression-test': V('Regression-tested', 'Regression-test', 'TEST'),
  'smoke-test': V('Smoke-tested', 'Smoke-test', 'TEST'),
  'load-test': V('Load-tested', 'Load-test', 'TEST'),
  'stress-test': V('Stress-tested', 'Stress-test', 'TEST'),
  check: V('Checked', 'Check', 'TEST'),
  probe: V('Probed', 'Probe', 'TEST'),
  confirm: V('Confirmed', 'Confirm', 'TEST'),
  assure: V('Assured', 'Assure', 'TEST'),
  monitor: V('Monitored', 'Monitor', 'MONITOR'),
  instrument: V('Instrumented', 'Instrument', 'MONITOR'),
  observe: V('Observed', 'Observe', 'MONITOR'),
  track: V('Tracked', 'Track', 'MONITOR'),
  trace: V('Traced', 'Trace', 'MONITOR'),
  measure: V('Measured', 'Measure', 'MONITOR'),
  detect: V('Detected', 'Detect', 'MONITOR'),
  visualize: V('Visualized', 'Visualize', 'MONITOR'),
  report: V('Reported', 'Report', 'MONITOR'),
  alert: V('Alerted', 'Alert', 'MONITOR'),
  log: V('Logged', 'Log', 'MONITOR'),
  baseline: V('Baselined', 'Baseline', 'MONITOR'),
  surface: V('Surfaced', 'Surface', 'MONITOR'),
  watch: V('Watched', 'Watch', 'MONITOR'),
  poll: V('Polled', 'Poll', 'MONITOR'),
  collaborate: V('Collaborated', 'Collaborate', 'COLLABORATE'),
  partner: V('Partnered', 'Partner', 'COLLABORATE'),
  align: V('Aligned', 'Align', 'COLLABORATE'),
  liaise: V('Liaised', 'Liaise', 'COLLABORATE'),
  synchronize: V('Synchronized', 'Synchronize', 'COLLABORATE'),
  engage: V('Engaged', 'Engage', 'COLLABORATE'),
  convene: V('Convened', 'Convene', 'COLLABORATE'),
  consult: V('Consulted', 'Consult', 'COLLABORATE'),
  broker: V('Brokered', 'Broker', 'COLLABORATE'),
  cooperate: V('Cooperated', 'Cooperate', 'COLLABORATE'),
  interface: V('Interfaced', 'Interface', 'COLLABORATE'),
  'co-create': V('Co-created', 'Co-create', 'COLLABORATE'),
  network: V('Networked', 'Network', 'COLLABORATE'),
  research: V('Researched', 'Research', 'RESEARCH'),
  publish: V('Published', 'Publish', 'RESEARCH'),
  experiment: V('Experimented', 'Experiment', 'RESEARCH'),
  explore: V('Explored', 'Explore', 'RESEARCH'),
  synthesize: V('Synthesized', 'Synthesize', 'RESEARCH'),
  survey: V('Surveyed', 'Survey', 'RESEARCH'),
  review: V('Reviewed', 'Review', 'RESEARCH'),
  study: V('Studied', 'Study', 'RESEARCH'),
  discover: V('Discovered', 'Discover', 'RESEARCH'),
  sell: V('Sold', 'Sell', 'SELL'),
  negotiate: V('Negotiated', 'Negotiate', 'SELL'),
  pitch: V('Pitched', 'Pitch', 'SELL'),
  manage: V('Managed', 'Manage', 'MANAGE'),
  own: V('Owned', 'Own', 'MANAGE'),
  oversee: V('Oversaw', 'Oversee', 'MANAGE'),
  plan: V('Planned', 'Plan', 'MANAGE'),
  govern: V('Governed', 'Govern', 'MANAGE'),
  prioritize: V('Prioritized', 'Prioritize', 'MANAGE'),
  direct: V('Directed', 'Direct', 'MANAGE'),
  supervise: V('Supervised', 'Supervise', 'MANAGE'),
  steward: V('Stewarded', 'Steward', 'MANAGE'),
  sequence: V('Sequenced', 'Sequence', 'MANAGE'),
  scope: V('Scoped', 'Scope', 'MANAGE'),
  transform: V('Transformed', 'Transform', 'TRANSFORM'),
  redesign: V('Redesigned', 'Redesign', 'TRANSFORM'),
  overhaul: V('Overhauled', 'Overhaul', 'TRANSFORM'),
  revamp: V('Revamped', 'Revamp', 'TRANSFORM'),
  restructure: V('Restructured', 'Restructure', 'TRANSFORM'),
  reengineer: V('Reengineered', 'Reengineer', 'TRANSFORM'),
  reshape: V('Reshaped', 'Reshape', 'TRANSFORM'),
  rework: V('Reworked', 'Rework', 'TRANSFORM'),
  reinvent: V('Reinvented', 'Reinvent', 'TRANSFORM'),
  recast: V('Recast', 'Recast', 'TRANSFORM'),
  remodel: V('Remodeled', 'Remodel', 'TRANSFORM'),
  reconfigure: V('Reconfigured', 'Reconfigure', 'TRANSFORM'),
  reorganize: V('Reorganized', 'Reorganize', 'TRANSFORM'),
  document: V('Documented', 'Document', 'DOCUMENT'),
  articulate: V('Articulated', 'Articulate', 'DOCUMENT'),
  catalogue: V('Catalogued', 'Catalogue', 'DOCUMENT'),
  map: V('Mapped', 'Map', 'DOCUMENT'),
  formalize: V('Formalized', 'Formalize', 'DOCUMENT'),
  record: V('Recorded', 'Record', 'DOCUMENT'),
  annotate: V('Annotated', 'Annotate', 'DOCUMENT'),
  summarize: V('Summarized', 'Summarize', 'DOCUMENT'),
  curate: V('Curated', 'Curate', 'DOCUMENT'),
  capture: V('Captured', 'Capture', 'DOCUMENT'),
  register: V('Registered', 'Register', 'DOCUMENT'),
  chronicle: V('Chronicled', 'Chronicle', 'DOCUMENT'),
  inventory: V('Inventoried', 'Inventory', 'DOCUMENT'),
  index: V('Indexed', 'Index', 'DOCUMENT'),
  itemize: V('Itemized', 'Itemize', 'DOCUMENT'),
  enumerate: V('Enumerated', 'Enumerate', 'DOCUMENT'),
  communicate: V('Communicated', 'Communicate', 'COMMUNICATE'),
  present: V('Presented', 'Present', 'COMMUNICATE'),
  brief: V('Briefed', 'Brief', 'COMMUNICATE'),
  influence: V('Influenced', 'Influence', 'COMMUNICATE'),
  convey: V('Conveyed', 'Convey', 'COMMUNICATE'),
  advocate: V('Advocated', 'Advocate', 'COMMUNICATE'),
  socialize: V('Socialized', 'Socialize', 'COMMUNICATE'),
  demonstrate: V('Demonstrated', 'Demonstrate', 'COMMUNICATE'),
  explain: V('Explained', 'Explain', 'COMMUNICATE'),
  translate: V('Translated', 'Translate', 'COMMUNICATE'),
  clarify: V('Clarified', 'Clarify', 'COMMUNICATE'),
  relay: V('Relayed', 'Relay', 'COMMUNICATE'),
  showcase: V('Showcased', 'Showcase', 'COMMUNICATE'),
  disseminate: V('Disseminated', 'Disseminate', 'COMMUNICATE'),
  broadcast: V('Broadcast', 'Broadcast', 'COMMUNICATE'),
  announce: V('Announced', 'Announce', 'COMMUNICATE'),
  scale: V('Scaled', 'Scale', 'SCALE'),
  expand: V('Expanded', 'Expand', 'SCALE'),
  grow: V('Grew', 'Grow', 'SCALE'),
  replicate: V('Replicated', 'Replicate', 'SCALE'),
  broaden: V('Broadened', 'Broaden', 'SCALE'),
  multiply: V('Multiplied', 'Multiply', 'SCALE'),
  train: V('Trained', 'Train', 'TRAIN'),
  educate: V('Educated', 'Educate', 'TRAIN'),
  instruct: V('Instructed', 'Instruct', 'TRAIN'),
  upskill: V('Upskilled', 'Upskill', 'TRAIN'),
  onboard: V('Onboarded', 'Onboard', 'TRAIN'),
  teach: V('Taught', 'Teach', 'TRAIN'),
  prepare: V('Prepared', 'Prepare', 'TRAIN'),
  orient: V('Oriented', 'Orient', 'TRAIN'),
  equip: V('Equipped', 'Equip', 'TRAIN'),
  predict: V('Predicted', 'Predict', 'PREDICT'),
  anticipate: V('Anticipated', 'Anticipate', 'PREDICT'),
  estimate: V('Estimated', 'Estimate', 'PREDICT'),
  infer: V('Inferred', 'Infer', 'PREDICT'),
  project: V('Projected', 'Project', 'PREDICT'),
  simulate: V('Simulated', 'Simulate', 'PREDICT'),
  extrapolate: V('Extrapolated', 'Extrapolate', 'PREDICT'),
  approximate: V('Approximated', 'Approximate', 'PREDICT'),
  rectify: V('Rectified', 'Rectify', 'REMEDIATE'),
  correct: V('Corrected', 'Correct', 'REMEDIATE'),
  repair: V('Repaired', 'Repair', 'REMEDIATE'),
  fix: V('Fixed', 'Fix', 'REMEDIATE'),
  address: V('Addressed', 'Address', 'REMEDIATE'),
  amend: V('Amended', 'Amend', 'REMEDIATE'),
  redress: V('Redressed', 'Redress', 'REMEDIATE'),
  debug: V('Debugged', 'Debug', 'DIAGNOSE'),
  pinpoint: V('Pinpointed', 'Pinpoint', 'DIAGNOSE'),
  localize: V('Localized', 'Localize', 'DIAGNOSE'),
  'root-cause': V('Root-caused', 'Root-cause', 'DIAGNOSE'),

  /* Phase 25–30 vocabulary expansion. These verbs are intentionally mapped
     to existing semantic families so deterministic alternatives remain
     meaning-preserving rather than merely sounding more impressive. */
  package: V('Packaged', 'Package', 'DEVELOP'),
  containerize: V('Containerized', 'Containerize', 'DEVELOP'),
  serialize: V('Serialized', 'Serialize', 'DEVELOP'),
  deserialize: V('Deserialized', 'Deserialize', 'DEVELOP'),
  tokenize: V('Tokenized', 'Tokenize', 'DEVELOP'),
  hydrate: V('Hydrated', 'Hydrate', 'DEVELOP'),
  decouple: V('Decoupled', 'Decouple', 'DESIGN'),
  normalize: V('Normalized', 'Normalize', 'DESIGN'),
  denormalize: V('Denormalized', 'Denormalize', 'DESIGN'),
  delineate: V('Delineated', 'Delineate', 'DESIGN'),
  federate: V('Federated', 'Federate', 'DESIGN'),
  batch: V('Batched', 'Batch', 'AUTOMATE'),
  pipeline: V('Pipelined', 'Pipeline', 'AUTOMATE'),
  trigger: V('Triggered', 'Trigger', 'AUTOMATE'),
  cache: V('Cached', 'Cache', 'OPTIMIZE'),
  memoize: V('Memoized', 'Memoize', 'OPTIMIZE'),
  vectorize: V('Vectorized', 'Vectorize', 'OPTIMIZE'),
  precompute: V('Precomputed', 'Precompute', 'OPTIMIZE'),
  deduplicate: V('Deduplicated', 'Deduplicate', 'OPTIMIZE'),
  calibrate: V('Calibrated', 'Calibrate', 'OPTIMIZE'),
  snapshot: V('Snapshotted', 'Snapshot', 'OPERATE'),
  rollback: V('Rolled back', 'Roll back', 'OPERATE'),
  authenticate: V('Authenticated', 'Authenticate', 'SECURE'),
  authorize: V('Authorized', 'Authorize', 'SECURE'),
  sanitize: V('Sanitized', 'Sanitize', 'SECURE'),
  segregate: V('Segregated', 'Segregate', 'SECURE'),
  rotate: V('Rotated', 'Rotate', 'SECURE'),
  revoke: V('Revoked', 'Revoke', 'SECURE'),
  attest: V('Attested', 'Attest', 'SECURE'),
  quarantine: V('Quarantined', 'Quarantine', 'SECURE'),
  'fuzz-test': V('Fuzz-tested', 'Fuzz-test', 'TEST'),
  'contract-test': V('Contract-tested', 'Contract-test', 'TEST'),
  'canary-test': V('Canary-tested', 'Canary-test', 'TEST'),
  'chaos-test': V('Chaos-tested', 'Chaos-test', 'TEST'),
  sample: V('Sampled', 'Sample', 'MONITOR'),
  checkpoint: V('Checkpointed', 'Checkpoint', 'MONITOR'),
  hypothesize: V('Hypothesized', 'Hypothesize', 'RESEARCH'),
  allocate: V('Allocated', 'Allocate', 'MANAGE'),
  budget: V('Budgeted', 'Budget', 'MANAGE'),
  rank: V('Ranked', 'Rank', 'ANALYZE'),
  score: V('Scored', 'Score', 'ANALYZE'),
  aggregate: V('Aggregated', 'Aggregate', 'ANALYZE'),
  shard: V('Sharded', 'Shard', 'SCALE'),
  'cross-train': V('Cross-trained', 'Cross-train', 'TRAIN'),
  ensemble: V('Ensembled', 'Ensemble', 'PREDICT'),
  mitigate: V('Mitigated', 'Mitigate', 'REMEDIATE'),
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
  P('act-process-tech-outcome', ['DEVOPS', 'CLOUD', 'DATA_ENGINEERING', 'OPERATIONS', 'GENERIC'],
    ['action', 'process', 'tech', 'outcome'], ['outcomeValue', 'scope'],
    (f, verb) => j(verb, ' ', f.process, f.scope ? ` across ${f.scope}` : '', ` using ${list(f.tech)}`, ', ', outcomePhrase(f))),
  P('act-system-method-outcome', ['DEVOPS', 'CLOUD', 'CYBERSECURITY', 'OPERATIONS', 'GENERIC'],
    ['action', 'system', 'method', 'outcome'], ['outcomeValue'],
    (f, verb) => j(verb, ' ', f.system, ` through ${f.method}`, ', ', outcomePhrase(f))),
  P('act-object-purpose-result', ['SOFTWARE_ENGINEERING', 'PRODUCT', 'CONSULTING', 'STUDENT_PROJECT', 'GENERIC'],
    ['action', 'object', 'purpose', 'result'], ['tech'],
    (f, verb) => j(verb, ' ', f.object, f.tech?.length ? ` using ${list(f.tech)}` : '', ` to ${f.purpose}`, `, resulting in ${String(f.result).replace(/\.$/, '')}.`)),
  P('act-object-method-result', ['FINANCE', 'CONSULTING', 'MARKETING', 'OPERATIONS', 'ANALYZE', 'GENERIC'],
    ['action', 'object', 'method', 'result'], ['scope'],
    (f, verb) => j(verb, ' ', f.object, f.scope ? ` across ${f.scope}` : '', ` through ${f.method}`, `, producing ${String(f.result).replace(/\.$/, '')}.`)),
  P('lead-scope-object-result', ['LEADERSHIP', 'MANAGE', 'PRODUCT'],
    ['action', 'scope', 'object', 'result'], [],
    (f, verb) => j(verb, ' ', f.scope, ` delivering ${f.object}`, `, resulting in ${String(f.result).replace(/\.$/, '')}.`)),
  P('act-scope-method-outcome', ['DEVOPS', 'CLOUD', 'OPERATIONS', 'CONSULTING', 'LEADERSHIP', 'GENERIC'],
    ['action', 'scope', 'method', 'outcome'], ['outcomeValue'],
    (f, verb) => j(verb, ' ', f.scope, ` through ${f.method}`, ', ', outcomePhrase(f))),
  P('act-process-purpose-result', ['PRODUCT', 'OPERATIONS', 'SOFTWARE_ENGINEERING', 'STUDENT_PROJECT', 'GENERIC'],
    ['action', 'process', 'purpose', 'result'], ['tech'],
    (f, verb) => j(verb, ' ', f.process, f.tech?.length ? ` using ${list(f.tech)}` : '', ` to ${f.purpose}`, `, yielding ${String(f.result).replace(/\.$/, '')}.`)),
  P('act-object-tech-scope-result', ['SOFTWARE_ENGINEERING', 'DEVOPS', 'CLOUD', 'DATA_ENGINEERING', 'GENERIC'],
    ['action', 'object', 'tech', 'scope', 'result'], [],
    (f, verb) => j(verb, ' ', f.object, ` using ${list(f.tech)}`, ` across ${f.scope}`, `, delivering ${String(f.result).replace(/\.$/, '')}.`)),
  P('lead-object-method-result', ['LEADERSHIP', 'MANAGE', 'CONSULTING', 'PRODUCT'],
    ['action', 'object', 'method', 'result'], ['scope'],
    (f, verb) => j(verb, ' ', f.object, f.scope ? ` across ${f.scope}` : '', ` through ${f.method}`, `, delivering ${String(f.result).replace(/\.$/, '')}.`)),
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
