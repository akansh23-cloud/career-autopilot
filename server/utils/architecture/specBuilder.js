/* ============================================================
   ARCHITECTURE SPEC BUILDER  (deterministic)
   ------------------------------------------------------------
   Input  : project input + pattern match
   Output : structured architectureSpec with multiple views
            (groups, nodes, edges, annotations, legend, risks).
   No AI, no network, no randomness — same input ⇒ same spec
   (except generatedAt). Node/edge ids are stable so refine and
   diffing work predictably.
   ============================================================ */
import { CAPABILITY_CATALOG, DIAGRAM_TEMPLATES, VIEW_TYPES } from './knowledgeBase.js';
import { decoratedLabel, normalizeProvider } from './serviceMapper.js';

export const SPEC_VERSION = 'architecture-spec-v1';
export const TARGET_LEVELS = ['mvp', 'production', 'enterprise', 'college_saas'];

const cap = (id) => CAPABILITY_CATALOG[id] || { label: id, layer: 'app', icon: 'box', nodeType: 'service' };
const nid = (capability) => `n-${capability}`;
const uniq = (arr) => Array.from(new Set(arr));

/* ---- decide the active capability set ---- */
export function resolveCapabilities(input, match, opts = {}) {
  const level = TARGET_LEVELS.includes(opts.targetLevel) ? opts.targetLevel : 'production';
  const sig = match.signals || {};
  const base = [...(match.pattern.requiredCapabilities || [])];

  // Stack-driven additions: technologies the user explicitly named always
  // earn their capability a place in the architecture (Redis → cache,
  // Kafka → event bus, Snowflake → warehouse, ...).
  for (const c of match.stackCapabilities || []) if (!base.includes(c)) base.push(c);

  // Signal-driven additions beyond the pattern defaults.
  if (sig.hasAI && !base.includes('ai')) base.push('ai');
  if (sig.hasPayments && !base.includes('payments')) base.push('payments');
  if (sig.hasUploads && !base.includes('objectStorage')) base.push('objectStorage');
  if (sig.hasStream && !base.includes('streamProcessor')) base.push('streamProcessor', 'eventBus');
  if (sig.hasAdmin && !base.includes('auditLog')) base.push('auditLog', 'rbac', 'adminUser');

  // Maturity-level additions.
  if (level !== 'mvp') {
    for (const c of ['logging', 'alerting', 'dlq']) if (!base.includes(c) && (c !== 'dlq' || base.includes('queue'))) base.push(c);
  }
  if (level === 'enterprise') {
    for (const c of ['tracing', 'iac', 'waf', 'auditLog']) if (!base.includes(c)) base.push(c);
  }
  if (level === 'college_saas') {
    for (const c of ['rbac', 'auditLog', 'adminUser']) if (!base.includes(c)) base.push(c);
  }

  // MVP trims optional weight (keeps the core production hygiene), but never
  // drops a capability the user explicitly named in their tech stack.
  let list = uniq(base);
  if (level === 'mvp') {
    const named = new Set(match.stackCapabilities || []);
    const optional = new Set(['waf', 'tracing', 'eventBus', 'search', 'iac', 'dataWarehouse']);
    list = list.filter((c) => named.has(c) || !optional.has(c) || (match.pattern.id === 'event-driven-pipeline' && c === 'eventBus'));
  }
  return list;
}

/* ---- node factory ---- */
let techAttribution = {}; // capability → user-named technologies (set per build)
function makeNode(capability, { provider = 'generic', group = null, riskLevel = 'normal', extra = {} } = {}) {
  const c = cap(capability);
  return {
    id: nid(capability),
    label: decoratedLabel(capability, provider),
    type: c.nodeType,
    icon: c.icon,
    group,
    provider: normalizeProvider(provider),
    capability,
    description: extra.description || '',
    technologies: extra.technologies
      || (techAttribution[capability]?.length ? techAttribution[capability].slice(0, 3).map(String) : null)
      || c.technologies || [],
    riskLevel,
    metadata: extra.metadata || {},
  };
}

let edgeSeq = 0;
function edge(from, to, label = '', o = {}) {
  edgeSeq += 1;
  return {
    id: `e-${from.replace(/^n-/, '')}-${to.replace(/^n-/, '')}-${edgeSeq}`,
    from, to, label,
    protocol: o.protocol || 'https',
    direction: o.direction || 'forward',
    dataType: o.dataType || '',
    security: o.security || 'tls',
    async: !!o.async,
    criticality: o.criticality || 'normal',
  };
}

const groupDef = (g) => ({ icon: null, style: null, parentId: null, ...g });
const templateGroups = (type) => (DIAGRAM_TEMPLATES[type]?.groups || []).map(groupDef);

/* Filter a template's groups to those that actually hold nodes (keeps parents). */
function pruneGroups(groups, nodes) {
  const used = new Set(nodes.map((n) => n.group).filter(Boolean));
  const keep = new Set();
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
  for (const id of used) {
    let g = byId[id];
    while (g && !keep.has(g.id)) { keep.add(g.id); g = byId[g.parentId]; }
  }
  return groups.filter((g) => keep.add ? keep.has(g.id) : true);
}

function legendFor(nodes) {
  const types = uniq(nodes.map((n) => n.type));
  const LEGEND = {
    actor: 'Actor / user', external: 'External system', service: 'Application service',
    datastore: 'Data store', queue: 'Queue / event channel', pipeline: 'Delivery pipeline',
    security: 'Security control', monitor: 'Observability',
  };
  return types.map((t) => ({ type: t, label: LEGEND[t] || t }));
}

function makeView(type, { title, description, groups, nodes, edges, annotations = [], risks = [], recommendations = [] }) {
  const t = DIAGRAM_TEMPLATES[type] || {};
  return {
    id: `view-${type}`,
    title: title || t.title || type,
    type,
    layout: t.layout || 'layered',
    description: description || t.description || '',
    groups: pruneGroups(groups ?? templateGroups(type), nodes),
    nodes,
    edges,
    annotations,
    legend: legendFor(nodes),
    risks,
    recommendations,
  };
}

const has = (caps, c) => caps.includes(c);

/* ============ per-view builders ============ */

function vSystemContext(caps, ctx) {
  const { provider, title } = ctx;
  const nodes = [];
  if (has(caps, 'user')) nodes.push(makeNode('user', { provider, group: 'g-actors' }));
  if (has(caps, 'adminUser')) nodes.push({ ...makeNode('adminUser', { provider, group: 'g-actors' }), label: 'Admin / Operator' });
  nodes.push({ ...makeNode('backend', { provider, group: 'g-system' }), id: 'n-system', label: title, capability: 'backend', icon: 'box', description: 'The system under design' });
  const externals = [];
  if (has(caps, 'payments')) externals.push(makeNode('payments', { provider, group: 'g-external' }));
  if (has(caps, 'ai')) externals.push({ ...makeNode('ai', { provider, group: 'g-external' }), type: 'external', label: 'AI / LLM Provider' });
  if (has(caps, 'externalSystem')) externals.push(makeNode('externalSystem', { provider, group: 'g-external' }));
  if (has(caps, 'notifications')) externals.push({ ...makeNode('notifications', { provider, group: 'g-external' }), type: 'external', label: 'Email / Notification Provider' });
  nodes.push(...externals);

  const E = [];
  if (has(caps, 'user')) E.push(edge('n-user', 'n-system', 'uses', { dataType: 'requests' }));
  if (has(caps, 'adminUser')) E.push(edge('n-adminUser', 'n-system', 'administers'));
  externals.forEach((x) => E.push(edge('n-system', x.id, 'integrates with')));
  return makeView('systemContext', { nodes, edges: E });
}

function vContainer(caps, ctx) {
  const { provider } = ctx;
  const nodes = [];
  const E = [];
  const groupOf = (c) => ({ actor: 'g-actors', edge: 'g-edge', app: 'g-app', async: 'g-async', data: 'g-data', external: 'g-external', security: 'g-app', observability: 'g-app', cicd: 'g-app' }[cap(c).layer] || 'g-app');
  const containerCaps = caps.filter((c) => !['monitoring', 'logging', 'tracing', 'alerting', 'dashboard', 'cicdPipeline', 'sourceRepo', 'registry', 'iac', 'backup', 'dlq', 'adminUser'].includes(c));
  for (const c of containerCaps) nodes.push(makeNode(c, { provider, group: groupOf(c) }));
  const id = (c) => nid(c);
  const hub = has(caps, 'backend') ? id('backend') : has(caps, 'serverlessFn') ? id('serverlessFn') : nodes.find((n) => n.group === 'g-app')?.id;

  // Edge chain: user → cdn/waf → lb/gateway → frontend/backend
  let prev = has(caps, 'user') ? id('user') : null;
  for (const c of ['cdn', 'waf', 'loadBalancer', 'apiGateway']) {
    if (has(containerCaps, c)) { if (prev) E.push(edge(prev, id(c))); prev = id(c); }
  }
  if (has(caps, 'frontend')) {
    if (prev) E.push(edge(prev, id('frontend'), 'serves SPA'));
    if (hub) E.push(edge(id('frontend'), hub, 'REST / JSON', { dataType: 'api' }));
  } else if (prev && hub && prev !== hub) E.push(edge(prev, hub));

  if (hub) {
    if (has(caps, 'authService')) E.push(edge(hub, id('authService'), 'authn'));
    if (has(caps, 'rbac')) E.push(edge(hub, id('rbac'), 'authz'));
    if (has(caps, 'cache')) E.push(edge(hub, id('cache'), 'hot reads'));
    for (const db of ['relationalDb', 'documentDb', 'search', 'vectorDb', 'dataWarehouse']) {
      if (has(containerCaps, db)) E.push(edge(hub, id(db), 'read/write', { dataType: 'records' }));
    }
    if (has(caps, 'objectStorage')) E.push(edge(hub, id('objectStorage'), 'files', { dataType: 'objects' }));
    if (has(caps, 'queue')) E.push(edge(hub, id('queue'), 'enqueue jobs', { async: true }));
    if (has(caps, 'eventBus')) E.push(edge(hub, id('eventBus'), 'publish events', { async: true }));
    if (has(caps, 'secrets')) E.push(edge(hub, id('secrets'), 'fetch secrets'));
    if (has(caps, 'ai')) E.push(edge(hub, id('ai'), 'inference', { dataType: 'prompts' }));
    if (has(caps, 'embedding')) E.push(edge(hub, id('embedding'), 'embed', { async: true }));
    if (has(caps, 'payments')) E.push(edge(hub, id('payments'), 'charge / webhook'));
    if (has(caps, 'decisionEngine')) E.push(edge(hub, id('decisionEngine'), 'score / decide'));
    if (has(caps, 'ingestion')) E.push(edge(id('ingestion'), hub, 'normalized data'));
  }
  if (has(caps, 'queue') && has(caps, 'worker')) {
    E.push(edge(id('queue'), id('worker'), 'consume', { async: true }));
    for (const db of ['relationalDb', 'documentDb', 'vectorDb', 'dataWarehouse']) if (has(containerCaps, db)) { E.push(edge(id('worker'), id(db), 'write results', { async: true })); break; }
  }
  if (has(caps, 'eventBus') && has(caps, 'streamProcessor')) {
    E.push(edge(id('eventBus'), id('streamProcessor'), 'stream', { async: true }));
    if (has(containerCaps, 'dataWarehouse')) E.push(edge(id('streamProcessor'), id('dataWarehouse'), 'load', { async: true }));
  }
  if (has(caps, 'scheduler') && has(caps, 'queue')) E.push(edge(id('scheduler'), id('queue'), 'scheduled jobs', { async: true }));
  if (has(caps, 'notifications') && has(caps, 'queue')) E.push(edge(id('queue'), id('notifications'), 'notify', { async: true }));

  return makeView('container', { nodes, edges: E });
}

function vDeployment(caps, ctx) {
  const { provider } = ctx;
  const P = normalizeProvider(provider);
  const regionLabel = { aws: 'AWS Region', azure: 'Azure Region', gcp: 'GCP Region', generic: 'Cloud Region' }[P];
  const vpcLabel = { aws: 'VPC', azure: 'Virtual Network', gcp: 'VPC Network', generic: 'Private Network' }[P];
  const groups = templateGroups('deployment').map((g) =>
    g.id === 'g-region' ? { ...g, label: regionLabel } : g.id === 'g-vpc' ? { ...g, label: vpcLabel } : g);

  const nodes = [];
  if (has(caps, 'user')) nodes.push(makeNode('user', { provider, group: 'g-internet' }));
  for (const c of ['dns', 'cdn', 'waf', 'apiGateway']) if (has(caps, c)) nodes.push(makeNode(c, { provider, group: 'g-edge' }));
  if (has(caps, 'loadBalancer')) nodes.push(makeNode('loadBalancer', { provider, group: 'g-public' }));
  else nodes.push({ ...makeNode('loadBalancer', { provider, group: 'g-public' }), description: 'Implicit platform load balancer' });
  const compute = has(caps, 'serverlessFn') ? 'serverlessFn' : 'computeContainer';
  nodes.push({ ...makeNode(compute, { provider, group: 'g-private' }), description: 'App + worker workloads', metadata: { stacked: true } });
  if (has(caps, 'worker')) nodes.push(makeNode('worker', { provider, group: 'g-private' }));
  for (const c of ['relationalDb', 'documentDb', 'cache', 'dataWarehouse']) if (has(caps, c)) nodes.push(makeNode(c, { provider, group: 'g-datasubnet' }));
  for (const c of ['objectStorage', 'queue', 'eventBus', 'secrets', 'monitoring', 'backup']) if (has(caps, c)) nodes.push(makeNode(c, { provider, group: 'g-managed' }));

  const E = [];
  const id = nid;
  let entry = null;
  if (has(caps, 'user')) entry = id('user');
  const chain = ['dns', 'cdn', 'waf', 'apiGateway'].filter((c) => has(caps, c));
  let prev = entry;
  for (const c of chain) { if (prev) E.push(edge(prev, id(c))); prev = id(c); }
  E.push(edge(prev || id('loadBalancer'), id('loadBalancer')));
  E.push(edge(id('loadBalancer'), id(compute), 'route'));
  if (has(caps, 'worker')) E.push(edge(id(compute), id('worker'), 'jobs', { async: true }));
  for (const c of ['relationalDb', 'documentDb', 'cache', 'dataWarehouse']) if (has(caps, c)) E.push(edge(id(compute), id(c), '', { security: 'private subnet' }));
  for (const c of ['objectStorage', 'queue', 'eventBus', 'secrets']) if (has(caps, c)) E.push(edge(id(compute), id(c), '', { security: 'IAM' }));
  if (has(caps, 'monitoring')) E.push(edge(id(compute), id('monitoring'), 'telemetry', { async: true }));
  if (has(caps, 'backup')) {
    const db = ['relationalDb', 'documentDb', 'dataWarehouse'].find((c) => has(caps, c));
    if (db) E.push(edge(id(db), id('backup'), 'scheduled backups', { async: true }));
  }
  const annotations = [`Environment separation: dev / staging / prod as isolated ${P === 'generic' ? 'environments' : 'accounts/subscriptions/projects'}.`];
  return makeView('deployment', { groups, nodes, edges: E, annotations });
}

function vDataFlow(caps, ctx) {
  const { provider } = ctx;
  const nodes = [];
  const E = [];
  const id = nid;
  const steps = [];
  if (has(caps, 'user')) steps.push('user');
  for (const c of ['cdn', 'waf', 'apiGateway', 'loadBalancer']) if (has(caps, c)) { steps.push(c); break; }
  if (has(caps, 'frontend')) steps.push('frontend');
  steps.push(has(caps, 'backend') ? 'backend' : has(caps, 'serverlessFn') ? 'serverlessFn' : 'ingestion');
  if (has(caps, 'authService')) steps.push('authService');
  if (has(caps, 'cache')) steps.push('cache');
  const db = ['relationalDb', 'documentDb', 'vectorDb', 'dataWarehouse'].find((c) => has(caps, c));
  if (db) steps.push(db);
  const flow = steps.filter(Boolean);
  for (const c of flow) nodes.push(makeNode(c, { provider }));
  flow.forEach((c, i) => {
    if (i === 0) return;
    const labels = {
      authService: `${i}. verify session`, cache: `${i}. check cache`,
      [db]: `${i}. ${has(caps, 'cache') ? 'cache miss → query DB' : 'query DB'}`,
    };
    E.push(edge(nid(flow[i - 1]), nid(c), labels[c] || `${i}. request`, { dataType: 'request' }));
  });
  let n = flow.length;
  if (has(caps, 'queue') && has(caps, 'worker')) {
    nodes.push(makeNode('queue', { provider }), makeNode('worker', { provider }));
    const hub = has(caps, 'backend') ? id('backend') : has(caps, 'serverlessFn') ? id('serverlessFn') : nodes[0].id;
    E.push(edge(hub, id('queue'), `${n}. enqueue slow work`, { async: true })); n += 1;
    E.push(edge(id('queue'), id('worker'), `${n}. process async`, { async: true })); n += 1;
    if (db) E.push(edge(id('worker'), nid(db), `${n}. persist result`, { async: true }));
  }
  const annotations = ['Numbers show the order of the core request path; dashed edges are asynchronous.'];
  return makeView('dataFlow', { nodes, edges: E, annotations });
}

function vSecurity(caps, ctx) {
  const { provider } = ctx;
  const nodes = [];
  const E = [];
  const id = nid;
  if (has(caps, 'user')) nodes.push({ ...makeNode('user', { provider, group: 'g-untrusted' }), description: 'Untrusted client' });
  for (const c of ['waf', 'rateLimiter']) if (has(caps, c)) nodes.push(makeNode(c, { provider, group: 'g-edge-sec' }));
  nodes.push({ ...makeNode('loadBalancer', { provider, group: 'g-edge-sec' }), label: 'TLS Termination', icon: 'shield', capability: 'loadBalancer' });
  for (const c of ['authService', 'rbac']) if (has(caps, c)) nodes.push(makeNode(c, { provider, group: 'g-app-sec' }));
  const hub = has(caps, 'backend') ? 'backend' : 'serverlessFn';
  nodes.push({ ...makeNode(hub, { provider, group: 'g-app-sec' }), label: 'App (input validation)' });
  if (has(caps, 'secrets')) nodes.push(makeNode('secrets', { provider, group: 'g-app-sec' }));
  const db = ['relationalDb', 'documentDb', 'dataWarehouse'].find((c) => has(caps, c));
  if (db) nodes.push({ ...makeNode(db, { provider, group: 'g-data-sec' }), label: 'Encrypted Data Store', riskLevel: 'high' });
  if (has(caps, 'auditLog')) nodes.push(makeNode('auditLog', { provider, group: 'g-data-sec' }));

  let prev = has(caps, 'user') ? id('user') : null;
  for (const c of ['waf', 'rateLimiter']) if (has(caps, c)) { if (prev) E.push(edge(prev, id(c))); prev = id(c); }
  E.push(edge(prev || id('loadBalancer'), id('loadBalancer'), 'TLS 1.2+'));
  prev = id('loadBalancer');
  for (const c of ['authService', 'rbac']) if (has(caps, c)) { E.push(edge(prev, id(c), c === 'authService' ? 'authenticate' : 'authorize')); prev = id(c); }
  E.push(edge(prev, id(hub)));
  if (has(caps, 'secrets')) E.push(edge(id(hub), id('secrets'), 'runtime secrets', { security: 'IAM' }));
  if (db) E.push(edge(id(hub), id(db), 'encrypted at rest + in transit', { security: 'tls+kms' }));
  if (has(caps, 'auditLog')) E.push(edge(id(hub), id('auditLog'), 'append-only audit events'));
  const risks = [];
  if (!has(caps, 'waf')) risks.push('No WAF at the edge — acceptable for MVP, required for enterprise.');
  if (!has(caps, 'auditLog')) risks.push('No audit log — add one before admin/recruiter flows go live.');
  return makeView('security', { nodes, edges: E, risks });
}

function vCicd(caps, ctx) {
  const { provider } = ctx;
  const nodes = [
    { ...makeNode('user', { provider, group: 'g-dev' }), id: 'n-developer', label: 'Developer', capability: 'user' },
    makeNode('sourceRepo', { provider, group: 'g-dev' }),
    makeNode('cicdPipeline', { provider, group: 'g-pipeline' }),
  ];
  const E = [
    edge('n-developer', nid('sourceRepo'), '1. push / PR'),
    edge(nid('sourceRepo'), nid('cicdPipeline'), '2. trigger'),
  ];
  let n = 3;
  let prev = nid('cicdPipeline');
  if (has(caps, 'registry')) {
    nodes.push(makeNode('registry', { provider, group: 'g-pipeline' }));
    E.push(edge(prev, nid('registry'), `${n}. build + scan + push image`)); n += 1; prev = nid('registry');
  }
  const compute = has(caps, 'serverlessFn') ? 'serverlessFn' : 'computeContainer';
  nodes.push({ ...makeNode(compute, { provider, group: 'g-runtime' }), label: 'Staging → Production' });
  E.push(edge(prev, nid(compute), `${n}. deploy with health checks + rollback`)); n += 1;
  if (has(caps, 'iac')) {
    nodes.push(makeNode('iac', { provider, group: 'g-pipeline' }));
    E.push(edge(nid('iac'), nid(compute), 'provision infra', { async: true }));
  }
  if (has(caps, 'monitoring')) {
    nodes.push(makeNode('monitoring', { provider, group: 'g-runtime' }));
    E.push(edge(nid(compute), nid('monitoring'), `${n}. verify post-deploy`));
  }
  const annotations = ['Quality gates: lint + tests + build must pass before deploy. Rollback is automated on failed health checks.'];
  return makeView('cicd', { nodes, edges: E, annotations });
}

function vObservability(caps, ctx) {
  const { provider } = ctx;
  const nodes = [];
  const E = [];
  const hub = has(caps, 'backend') ? 'backend' : has(caps, 'serverlessFn') ? 'serverlessFn' : 'streamProcessor';
  nodes.push({ ...makeNode(hub, { provider, group: 'g-sources' }), label: 'App Services' });
  if (has(caps, 'worker')) nodes.push(makeNode('worker', { provider, group: 'g-sources' }));
  for (const c of ['logging', 'monitoring', 'tracing']) if (has(caps, c)) nodes.push(makeNode(c, { provider, group: 'g-collect' }));
  if (!has(caps, 'monitoring')) nodes.push(makeNode('monitoring', { provider, group: 'g-collect' }));
  for (const c of ['alerting', 'dashboard']) if (has(caps, c) || c === 'dashboard') nodes.push(makeNode(c, { provider, group: 'g-act' }));
  for (const src of [hub, has(caps, 'worker') ? 'worker' : null].filter(Boolean)) {
    for (const sink of ['logging', 'monitoring', 'tracing']) {
      if (nodes.some((nn) => nn.capability === sink)) E.push(edge(nid(src), nid(sink), { logging: 'structured logs', monitoring: 'metrics', tracing: 'spans' }[sink], { async: true }));
    }
  }
  if (nodes.some((nn) => nn.capability === 'alerting')) E.push(edge(nid('monitoring'), nid('alerting'), 'SLO breach alerts'));
  E.push(edge(nid('monitoring'), nid('dashboard'), 'dashboards'));
  const annotations = ['Alert on symptoms (SLOs: latency, error rate, saturation), not just raw errors.'];
  return makeView('observability', { nodes, edges: E, annotations });
}

function vScalingFailure(caps, ctx) {
  const { provider } = ctx;
  const nodes = [
    makeNode('loadBalancer', { provider, group: 'g-traffic' }),
    { ...makeNode(has(caps, 'serverlessFn') ? 'serverlessFn' : 'computeContainer', { provider, group: 'g-scale' }), label: 'App Instances ×N (autoscaled)', metadata: { stacked: true } },
  ];
  const E = [edge(nid('loadBalancer'), nodes[1].id, 'health-checked routing')];
  if (has(caps, 'cache')) { nodes.push(makeNode('cache', { provider, group: 'g-scale' })); E.push(edge(nodes[1].id, nid('cache'), 'reduce DB load')); }
  const db = ['relationalDb', 'documentDb', 'dataWarehouse'].find((c) => has(caps, c));
  if (db) { nodes.push({ ...makeNode(db, { provider, group: 'g-scale' }), label: `${cap(db).label} (primary + replicas)` }); E.push(edge(nodes[1].id, nid(db), 'reads → replicas')); }
  if (has(caps, 'queue')) {
    nodes.push(makeNode('queue', { provider, group: 'g-resilience' }));
    E.push(edge(nodes[1].id, nid('queue'), 'buffer spikes', { async: true }));
    if (has(caps, 'worker')) { nodes.push({ ...makeNode('worker', { provider, group: 'g-resilience' }), label: 'Workers ×N', metadata: { stacked: true } }); E.push(edge(nid('queue'), nid('worker'), 'backpressure-aware consume', { async: true })); }
    if (has(caps, 'dlq')) { nodes.push(makeNode('dlq', { provider, group: 'g-resilience' })); E.push(edge(nid('queue'), nid('dlq'), 'poison messages', { async: true })); }
  }
  if (has(caps, 'backup')) { nodes.push(makeNode('backup', { provider, group: 'g-resilience' })); if (db) E.push(edge(nid(db), nid('backup'), 'tested restore path', { async: true })); }
  const annotations = ['Failure stance: timeouts + retries with backoff on every external call; circuit-breakers for flaky dependencies; graceful degradation when a dependency is down.'];
  return makeView('scalingFailure', { nodes, edges: E, annotations });
}

function vPatentFigure(caps, ctx) {
  const { title } = ctx;
  const nodes = [
    { ...makeNode('user', { group: 'g-fig-actors' }), label: '110 — User Interface', metadata: { figureRef: '110' } },
  ];
  if (has(caps, 'adminUser')) nodes.push({ ...makeNode('adminUser', { group: 'g-fig-actors' }), label: '112 — Admin Interface', metadata: { figureRef: '112' } });
  nodes.push({ ...makeNode('ingestion', { group: 'g-fig-modules' }), label: '120 — Data Intake Module', metadata: { figureRef: '120' } });
  nodes.push({ ...makeNode('backend', { group: 'g-fig-modules' }), label: '130 — Processing Module', metadata: { figureRef: '130' } });
  nodes.push({ ...makeNode('decisionEngine', { group: 'g-fig-engine' }), label: '140 — Decision Engine', metadata: { figureRef: '140' } });
  if (has(caps, 'ai') || has(caps, 'embedding')) nodes.push({ ...makeNode('ai', { group: 'g-fig-engine' }), label: '142 — Model / Inference Unit', metadata: { figureRef: '142' } });
  nodes.push({ ...makeNode(has(caps, 'documentDb') ? 'documentDb' : 'relationalDb', { group: 'g-fig-store' }), label: '150 — Data Store', metadata: { figureRef: '150' } });
  if (has(caps, 'search') || has(caps, 'vectorDb')) nodes.push({ ...makeNode(has(caps, 'vectorDb') ? 'vectorDb' : 'search', { group: 'g-fig-store' }), label: '152 — Index Store', metadata: { figureRef: '152' } });

  const id = (ref) => nodes.find((n) => n.metadata?.figureRef === ref)?.id;
  const E = [
    edge(id('110'), id('120'), 'input data'),
    edge(id('120'), id('130'), 'normalized data'),
    edge(id('130'), id('140'), 'features / candidates'),
    edge(id('140'), id('150'), 'decisions / results'),
  ].filter((e) => e.from && e.to);
  if (id('142')) E.push(edge(id('140'), id('142'), 'inference request'), edge(id('142'), id('140'), 'model output', { direction: 'back' }));
  if (id('152')) E.push(edge(id('130'), id('152'), 'index update'), edge(id('152'), id('140'), 'retrieval', { direction: 'back' }));
  if (id('150')) E.push(edge(id('150'), id('130'), 'feedback / training signal', { direction: 'back', async: true }));
  if (id('112')) E.push(edge(id('112'), id('140'), 'review / override'));
  const annotations = [
    `FIG. 1 — System diagram of ${title}. Reference numerals are illustrative.`,
    'This figure supports a disclosure; it is NOT a claim or assessment of patentability.',
  ];
  return makeView('patentFigure', { nodes, edges: E, annotations });
}

const VIEW_BUILDERS = {
  systemContext: vSystemContext,
  container: vContainer,
  deployment: vDeployment,
  dataFlow: vDataFlow,
  security: vSecurity,
  cicd: vCicd,
  observability: vObservability,
  scalingFailure: vScalingFailure,
  patentFigure: vPatentFigure,
};

/* ---- main entry ---- */
export function buildSpec(input = {}, match, opts = {}) {
  edgeSeq = 0; // deterministic edge ids per build
  techAttribution = match.techByCapability || {}; // real stack names on nodes
  const provider = normalizeProvider(opts.cloudProvider || input.cloudProvider || match.signals?.cloud || 'generic');
  const targetLevel = TARGET_LEVELS.includes(opts.targetLevel) ? opts.targetLevel : 'production';
  const caps = Array.isArray(opts.capabilities) && opts.capabilities.length
    ? uniq(opts.capabilities) // refine engine pins the exact set
    : resolveCapabilities(input, match, { targetLevel });
  const title = String(input.title || 'Application').slice(0, 120);
  const ctx = { provider, targetLevel, title };

  let viewTypes = Array.isArray(opts.diagramTypes) && opts.diagramTypes.length
    ? opts.diagramTypes.filter((t) => VIEW_TYPES.includes(t))
    : [...(match.pattern.recommendedViews || []), 'patentFigure'];
  viewTypes = Array.from(new Set(viewTypes));
  if (!viewTypes.length) viewTypes = ['systemContext', 'container', 'dataFlow', 'security'];

  const views = viewTypes.map((t) => VIEW_BUILDERS[t](caps, ctx)).filter(Boolean);

  return {
    id: `spec-${(input.projectId || title).toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48) || 'project'}`,
    projectId: input.projectId || '',
    title,
    description: String(input.description || input.problemStatement || '').slice(0, 1000),
    provider,
    targetLevel,
    pattern: {
      id: match.patternId,
      name: match.pattern.name,
      category: match.pattern.category,
      confidence: match.confidence,
      reasons: match.reasons,
      antiPatterns: match.pattern.commonAntiPatterns || [],
    },
    generatedAt: new Date().toISOString(),
    version: 1,
    specVersion: SPEC_VERSION,
    capabilities: caps,
    views,
    bestPracticeChecks: [], // filled by validator
    exports: { mermaid: true, json: true, svg: true },
  };
}

export default { buildSpec, resolveCapabilities, SPEC_VERSION, TARGET_LEVELS };
