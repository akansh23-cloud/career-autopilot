/* ============================================================
   INDUSTRY-LEVEL ARCHITECTURE GENERATOR  (deterministic-first)
   ------------------------------------------------------------
   Produces a production-grade architecture spec from a project description:
   executive summary, recommended style, component/data-flow/deployment/
   security Mermaid diagrams, database + API + security design, scalability,
   failure handling, observability, CI/CD, cost/trade-offs, gaps, and a
   maturity score. No AI is required for the score or structure — AI (in the
   route) may only enrich prose. Default style = modular monolith; we only
   recommend microservices when scale/team complexity clearly justifies it.

   Mermaid strings use the simple `graph TD` subset the in-app renderer
   (web/src/lib/architecture.js + ProofViews.jsx ArchitectureDiagram) supports:
   Id["label"], Id[("db")], Id(("ext")), edges via -->.
   ============================================================ */

export const ARCH_VERSION = 'architecture-v1';
export const ARCH_LEVELS = ['mvp', 'production', 'enterprise', 'college_saas'];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n);
const lc = (s) => String(s || '').toLowerCase();
const esc = (s = '') => String(s).replace(/"/g, "'").replace(/[[\]]/g, '');

/* Detect technology signals from the stack/description. */
function detect(project) {
  const stack = `${(project.techStack || []).join(' ')} ${project.description || ''} ${project.title || ''}`.toLowerCase();
  return {
    stack,
    frontend: /react|next|vue|angular|svelte|tailwind|vite|frontend|web|ui/.test(stack),
    backend: /express|node|fastapi|django|spring|flask|api|backend|go|rails/.test(stack),
    db: /mongo|postgres|mysql|dynamo|sql|prisma|database|redis/.test(stack),
    mongo: /mongo/.test(stack),
    dynamo: /dynamo/.test(stack),
    cache: /redis|cache|memcached/.test(stack),
    queue: /kafka|rabbitmq|sqs|queue|pubsub|event/.test(stack),
    auth: /jwt|auth|oauth|clerk|cognito|session/.test(stack),
    cloud: /aws|lambda|s3|gcp|azure|render|railway|vercel|netlify|cloud|serverless/.test(stack),
    ci: /docker|kubernetes|terraform|github actions|ci\/cd|helm|jenkins|pipeline/.test(stack),
    storage: /s3|blob|object storage|gcs|bucket|upload/.test(stack),
    ai: /ai|llm|gpt|openai|anthropic|rag|embedding|ml|model/.test(stack),
    realtime: /websocket|socket|realtime|real-time|streaming/.test(stack),
    payments: /stripe|razorpay|payment|billing/.test(stack),
  };
}

/* Recommend an architecture style. Microservices ONLY when justified. */
function recommendStyle(level, sig, project) {
  const teamSize = Number(project.teamSize || 0);
  const scaleHint = /millions|high traffic|scale|distributed|microservice/.test(sig.stack);
  if (level === 'enterprise' && (scaleHint || teamSize >= 8)) {
    return {
      style: 'Service-oriented (selective microservices)',
      rationale: 'Enterprise scale and/or a large team justifies splitting a few high-load or independently-deployed capabilities into services — but keep the core a modular monolith to avoid premature distributed-systems complexity.',
    };
  }
  return {
    style: 'Production-ready modular monolith',
    rationale: 'A single deployable app with clear internal modules (API, domain, data, jobs) is the right default: fastest to ship, easiest to operate, and easy to split later if real scale demands it. Avoid microservices until traffic, team size, or independent deploy cadence force the split.',
  };
}

/* ---- Mermaid diagrams (renderer-compatible) ---- */
function componentDiagram(sig) {
  const L = ['graph TD', '  User["User / Client"]'];
  const hasFE = sig.frontend;
  if (hasFE) { L.push('  FE["Frontend (SPA)"]'); L.push('  User --> FE'); }
  L.push('  API["API / App Service"]');
  L.push(hasFE ? '  FE --> API' : '  User --> API');
  if (sig.auth) { L.push('  Auth["Auth / Identity"]'); L.push('  API --> Auth'); }
  if (sig.cache) { L.push('  Cache[("Cache")]'); L.push('  API --> Cache'); }
  if (sig.db) { L.push(`  DB[("${esc(sig.mongo ? 'MongoDB' : sig.dynamo ? 'DynamoDB' : 'PostgreSQL')}")]`); L.push('  API --> DB'); }
  if (sig.queue) { L.push('  Queue["Message Queue"]'); L.push('  API --> Queue'); L.push('  Worker["Background Worker"]'); L.push('  Queue --> Worker'); if (sig.db) L.push('  Worker --> DB'); }
  if (sig.storage) { L.push('  Store[("Object Storage")]'); L.push('  API --> Store'); }
  if (sig.ai) { L.push('  AI(("AI / LLM"))'); L.push('  API --> AI'); }
  if (sig.payments) { L.push('  Pay(("Payments"))'); L.push('  API --> Pay'); }
  return L.join('\n');
}

function dataFlowDiagram(sig) {
  const L = ['graph TD', '  Req["Incoming Request"]', '  Edge["CDN / Load Balancer"]', '  Req --> Edge'];
  L.push('  App["App Service"]'); L.push('  Edge --> App');
  if (sig.auth) { L.push('  AuthZ["AuthN / AuthZ"]'); L.push('  App --> AuthZ'); }
  if (sig.cache) { L.push('  Cache[("Read Cache")]'); L.push('  App --> Cache'); }
  if (sig.db) { L.push('  Data[("Primary DB")]'); L.push('  App --> Data'); }
  if (sig.queue) { L.push('  Async["Async Jobs"]'); L.push('  App --> Async'); }
  L.push('  Resp["Response"]'); L.push('  App --> Resp');
  return L.join('\n');
}

function deploymentDiagram(sig, level) {
  const L = ['graph TD', '  Dev["Developer"]', '  Repo["Git Repository"]', '  Dev --> Repo'];
  L.push('  CI["CI/CD Pipeline"]'); L.push('  Repo --> CI');
  if (sig.ci || level !== 'mvp') { L.push('  Registry["Container Registry"]'); L.push('  CI --> Registry'); }
  L.push(level === 'mvp' ? '  Host["Managed Host (PaaS)"]' : '  Runtime["Container Runtime"]');
  L.push(sig.ci || level !== 'mvp' ? '  Registry --> Runtime' : '  CI --> Host');
  const target = level === 'mvp' ? 'Host' : 'Runtime';
  if (sig.db) { L.push('  DB[("Managed DB")]'); L.push(`  ${target} --> DB`); }
  L.push('  Mon["Monitoring"]'); L.push(`  ${target} --> Mon`);
  return L.join('\n');
}

function securityDiagram(sig) {
  const L = ['graph TD', '  Client["Client"]', '  WAF["WAF / Rate Limit"]', '  Client --> WAF', '  TLS["TLS Termination"]', '  WAF --> TLS', '  Gate["AuthN / AuthZ"]', '  TLS --> Gate', '  App["App (input validation)"]', '  Gate --> App'];
  if (sig.db) { L.push('  Secrets["Secrets Manager"]'); L.push('  App --> Secrets'); L.push('  Data[("Encrypted DB")]'); L.push('  App --> Data'); }
  L.push('  Audit["Audit Log"]'); L.push('  App --> Audit');
  return L.join('\n');
}

/* ---- Maturity score (deterministic) ---- */
function maturity(sig, level) {
  const isProd = level !== 'mvp';
  const isEnt = level === 'enterprise';
  const m = {
    scalability: clamp((sig.cache ? 5 : 0) + (sig.queue ? 5 : 0) + (sig.cloud ? 3 : 0) + (isEnt ? 2 : 0), 0, 15),
    security: clamp((sig.auth ? 6 : 2) + (isProd ? 5 : 1) + (isEnt ? 4 : 2), 0, 15),
    maintainability: clamp(8 + (sig.ci ? 4 : 0) + (isProd ? 3 : 0), 0, 15),
    dataDesign: clamp((sig.db ? 8 : 2) + (sig.cache ? 3 : 0) + (isEnt ? 4 : 2), 0, 15),
    observability: clamp((isProd ? 5 : 1) + (sig.cloud ? 3 : 0) + (isEnt ? 2 : 0), 0, 10),
    deploymentReadiness: clamp((sig.ci ? 5 : 1) + (sig.cloud ? 3 : 1) + (isProd ? 2 : 0), 0, 10),
    costEfficiency: clamp(level === 'mvp' ? 9 : isEnt ? 6 : 8, 0, 10),
    failureHandling: clamp((sig.queue ? 4 : 1) + (isProd ? 4 : 1) + (isEnt ? 2 : 1), 0, 10),
  };
  const total = Object.values(m).reduce((a, b) => a + b, 0);
  return { breakdown: m, total: round(total), max: 100 };
}

/* ---- Gaps (explicit, deterministic) ---- */
function gaps(sig, level) {
  const g = [];
  if (!sig.queue && level !== 'mvp') g.push('No async queue — long-running or spiky work will block requests; add a queue + worker.');
  if (!sig.cache) g.push('No caching layer — hot reads hit the database directly; add a read cache (e.g. Redis).');
  if (!sig.storage && /upload|file|image|media/.test(sig.stack)) g.push('No object storage — store large/binary assets in object storage, not the DB.');
  if (level !== 'mvp') g.push('Confirm centralized monitoring, metrics and alerting are in place (logs + traces + dashboards).');
  g.push('Define a backup & restore plan with tested recovery for the primary datastore.');
  if (!sig.ci) g.push('No CI/CD detected — add automated build, test and deploy pipelines.');
  if (level === 'enterprise') g.push('Add audit logging, secrets rotation, and rate limiting at the edge for enterprise readiness.');
  if (!sig.auth) g.push('No authentication detected — add identity, session/JWT handling and authorization checks.');
  return g;
}

export function generateArchitecture(project = {}, opts = {}) {
  const level = ARCH_LEVELS.includes(lc(opts.level)) ? lc(opts.level) : 'production';
  const sig = detect(project);
  const rec = recommendStyle(level, sig, project);
  const score = maturity(sig, level);
  const title = project.title || 'Application';

  const dbChoice = sig.mongo ? 'MongoDB (document)' : sig.dynamo ? 'DynamoDB (key-value)' : 'PostgreSQL (relational)';

  return {
    architectureVersion: ARCH_VERSION,
    level,
    executiveSummary: `${title} is best built as a ${rec.style.toLowerCase()}. ${rec.rationale} The design below targets a "${level}" maturity level with a maturity score of ${score.total}/100; address the listed gaps to raise it.`,
    recommendedStyle: rec,
    diagrams: {
      component: componentDiagram(sig),
      dataFlow: dataFlowDiagram(sig),
      deployment: deploymentDiagram(sig, level),
      security: securityDiagram(sig),
    },
    databaseDesign: {
      primary: dbChoice,
      notes: [
        `Use ${dbChoice} as the system of record.`,
        sig.cache ? 'Use the cache for hot reads with explicit TTLs and invalidation on write.' : 'Add a read cache once read latency or DB load becomes a concern.',
        'Index by access pattern, not by guesswork; add composite indexes for frequent filters.',
        'Keep migrations versioned and reversible.',
      ],
    },
    apiDesign: {
      style: sig.ai ? 'REST + streaming endpoints for AI responses' : 'REST (resource-oriented), versioned under /api/v1',
      notes: [
        'Validate every input at the boundary; never trust client data.',
        'Use consistent error envelopes and HTTP status codes.',
        'Paginate list endpoints; rate-limit public ones.',
        sig.auth ? 'Protect mutating routes with authN + authorization checks.' : 'Add authentication before exposing any mutating route.',
      ],
    },
    securityDesign: [
      'TLS everywhere; HSTS on.',
      sig.auth ? 'AuthN via sessions/JWT with short-lived tokens and refresh.' : 'Add authentication (sessions or JWT).',
      'Authorization checks on every protected resource (no client-trusted roles).',
      'Secrets in a secrets manager / env — never in the repo or frontend.',
      'Input validation + output encoding to prevent injection/XSS.',
      'Rate limiting and basic WAF at the edge.',
      level === 'enterprise' ? 'Audit logging and secrets rotation.' : 'Plan for audit logging as you grow.',
    ],
    scalabilityPlan: [
      'Start stateless app instances behind a load balancer; scale horizontally.',
      sig.cache ? 'Cache hot reads; cap DB connections with a pool.' : 'Add caching when read load grows.',
      sig.queue ? 'Offload slow/spiky work to the queue + workers.' : 'Introduce a queue when requests start doing slow work inline.',
      'Add read replicas before sharding; shard only when a single primary is the proven bottleneck.',
    ],
    failureHandling: [
      'Timeouts + retries with backoff on every external call.',
      'Circuit-breakers for flaky dependencies.',
      sig.queue ? 'Dead-letter queue for poison messages.' : 'Idempotent handlers so retries are safe.',
      'Graceful degradation: serve cached/partial data when a dependency is down.',
      'Tested backups and a documented restore runbook.',
    ],
    observability: [
      'Structured logs with request IDs.',
      'Metrics (latency, error rate, saturation) on dashboards.',
      'Distributed tracing across service boundaries.',
      'Alerting on SLO breaches, not just raw errors.',
    ],
    cicdPlan: [
      'Trunk-based or short-lived branches with required PR checks.',
      'CI: lint + test + build on every push.',
      level === 'mvp' ? 'CD: auto-deploy to a managed host on green main.' : 'CD: build image, push to registry, deploy to runtime with health checks and rollback.',
      'Infrastructure as code for reproducible environments.',
    ],
    costTradeoffs: [
      `${level === 'mvp' ? 'MVP: optimize for speed and low fixed cost (managed PaaS, single instance).' : 'Production: balance reliability and cost — right-size instances, autoscale, and watch egress.'}`,
      'Prefer managed services early (DB, queue) to cut ops cost; revisit when spend justifies self-hosting.',
      'Cache and async work reduce DB cost and improve tail latency.',
    ],
    gaps: gaps(sig, level),
    maturityScore: score,
  };
}

export default { generateArchitecture, ARCH_VERSION, ARCH_LEVELS };
