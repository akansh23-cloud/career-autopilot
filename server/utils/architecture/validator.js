/* ============================================================
   ARCHITECTURE VALIDATOR  (deterministic)
   ------------------------------------------------------------
   Runs best-practice checks against an architectureSpec and
   computes a quality score per category. No AI involved —
   the score is auditable and reproducible.
   ============================================================ */

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/* Every check: { id, category, severity, requires(caps, spec) → boolean, message, recommendation } */
const CHECKS = [
  { id: 'chk-auth', category: 'security', severity: 'critical', need: ['authService'], message: 'Authentication present', missing: 'No authentication component', recommendation: 'Add an identity/auth service (sessions or JWT) before exposing any protected route.' },
  { id: 'chk-rbac', category: 'security', severity: 'high', need: ['rbac'], message: 'Authorization / RBAC present', missing: 'No authorization (RBAC) layer', recommendation: 'Add role-based authorization checks on every protected resource — never trust client roles.' },
  { id: 'chk-rate-limit', category: 'security', severity: 'high', need: ['rateLimiter', 'waf'], message: 'Rate limiting present', missing: 'No rate limiting at the edge', recommendation: 'Add rate limiting (and ideally a WAF) in front of public endpoints.' },
  { id: 'chk-secrets', category: 'security', severity: 'critical', need: ['secrets'], message: 'Secrets management present', missing: 'No secrets manager', recommendation: 'Store credentials in a secrets vault injected at runtime — never in code or images.' },
  { id: 'chk-audit', category: 'security', severity: 'medium', need: ['auditLog'], message: 'Audit logging present', missing: 'No audit log', recommendation: 'Add append-only audit logs for admin / recruiter / college flows.' },
  { id: 'chk-db', category: 'dataDesign', severity: 'critical', need: ['relationalDb', 'documentDb', 'dataWarehouse', 'vectorDb'], message: 'Primary datastore present', missing: 'No primary database', recommendation: 'Add a system-of-record datastore appropriate to the access patterns.' },
  { id: 'chk-backup', category: 'reliability', severity: 'high', need: ['backup'], message: 'Backup & restore present', missing: 'No backup/restore plan', recommendation: 'Add scheduled backups with a tested restore runbook for the primary datastore.' },
  { id: 'chk-monitoring', category: 'observability', severity: 'critical', need: ['monitoring'], message: 'Monitoring present', missing: 'No monitoring/metrics', recommendation: 'Add metrics, dashboards and health checks for every service.' },
  { id: 'chk-logging', category: 'observability', severity: 'high', need: ['logging'], message: 'Centralized logging present', missing: 'No centralized logging', recommendation: 'Ship structured logs with request IDs to a central store.' },
  { id: 'chk-alerting', category: 'observability', severity: 'medium', need: ['alerting'], message: 'Alerting present', missing: 'No alerting', recommendation: 'Alert on SLO breaches (latency, error rate, saturation).' },
  { id: 'chk-cicd', category: 'deploymentReadiness', severity: 'high', need: ['cicdPipeline'], message: 'CI/CD pipeline present', missing: 'No CI/CD pipeline', recommendation: 'Automate lint + test + build + deploy with health checks and rollback.' },
  { id: 'chk-queue', category: 'scalability', severity: 'medium', need: ['queue', 'eventBus'], message: 'Async queue present', missing: 'No queue for long-running tasks', recommendation: 'Move slow or spiky work to a queue + worker so requests stay fast.' },
  { id: 'chk-cache', category: 'scalability', severity: 'medium', need: ['cache'], message: 'Cache present', missing: 'No caching layer', recommendation: 'Add a read cache (e.g. Redis) for hot reads with explicit TTLs.' },
  { id: 'chk-object-storage', category: 'dataDesign', severity: 'medium', need: ['objectStorage'], message: 'Object storage present', missing: 'No object storage for uploaded files', recommendation: 'Store large/binary assets in object storage, never in the DB.', onlyIf: (spec) => /upload|file|document|image|media|pdf|resume/i.test(`${spec.title} ${spec.description}`) || (spec.capabilities || []).includes('frontend') },
  { id: 'chk-dlq', category: 'reliability', severity: 'medium', need: ['dlq'], message: 'Error handling / DLQ present', missing: 'No retry/DLQ strategy for async work', recommendation: 'Add a dead-letter queue and idempotent, retry-safe handlers.', onlyIf: (spec) => (spec.capabilities || []).includes('queue') || (spec.capabilities || []).includes('eventBus') },
  { id: 'chk-env-sep', category: 'deploymentReadiness', severity: 'medium', need: [], message: 'Environment separation documented', missing: 'No environment separation noted', recommendation: 'Keep dev / staging / prod isolated with separate credentials.', custom: (spec) => (spec.views || []).some((v) => (v.annotations || []).some((a) => /environment separation/i.test(a))) },
  { id: 'chk-worker', category: 'scalability', severity: 'low', need: ['worker', 'streamProcessor', 'serverlessFn'], message: 'Async processing capacity present', missing: 'No background processing capacity', recommendation: 'Add workers for jobs that should not run in the request path.' },
  { id: 'chk-iac', category: 'maintainability', severity: 'low', need: ['iac'], message: 'Infrastructure as code present', missing: 'No IaC', recommendation: 'Define infrastructure as code for reproducible environments.' },
  { id: 'chk-tracing', category: 'observability', severity: 'low', need: ['tracing'], message: 'Distributed tracing present', missing: 'No distributed tracing', recommendation: 'Add tracing once you have more than one service in the request path.', onlyIf: (spec) => spec.targetLevel === 'enterprise' },
];

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 5, low: 2 };

export function runChecks(spec = {}) {
  const caps = new Set(spec.capabilities || []);
  const checks = [];
  for (const c of CHECKS) {
    if (c.onlyIf && !c.onlyIf(spec)) continue;
    const pass = c.custom ? !!c.custom(spec) : c.need.length === 0 ? true : c.need.some((n) => caps.has(n));
    checks.push({
      id: c.id,
      category: c.category,
      severity: c.severity,
      status: pass ? 'pass' : 'fail',
      message: pass ? c.message : c.missing,
      recommendation: pass ? '' : c.recommendation,
    });
  }
  return checks;
}

/* Category scores 0–100 from check pass-rates (severity-weighted) + capability bonuses. */
export function scoreSpec(spec = {}, checks = null) {
  const allChecks = checks || runChecks(spec);
  const caps = new Set(spec.capabilities || []);
  const catScore = (category, bonusFn) => {
    const rel = allChecks.filter((c) => c.category === category);
    let total = 0; let earned = 0;
    for (const c of rel) {
      const w = SEVERITY_WEIGHT[c.severity] || 4;
      total += w;
      if (c.status === 'pass') earned += w;
    }
    let base = total ? (earned / total) * 100 : 70;
    if (bonusFn) base = bonusFn(base);
    return clamp(base);
  };

  const breakdown = {
    scalability: catScore('scalability', (b) => b + (caps.has('loadBalancer') || caps.has('apiGateway') ? 5 : 0)),
    security: catScore('security', (b) => b + (caps.has('waf') ? 4 : 0)),
    reliability: catScore('reliability', (b) => b + (caps.has('queue') ? 5 : 0) + (caps.has('monitoring') ? 5 : 0)),
    observability: catScore('observability'),
    maintainability: catScore('maintainability', (b) => Math.max(b, 55) + (caps.has('cicdPipeline') ? 15 : 0) + ((spec.views || []).length >= 5 ? 10 : 0)),
    deploymentReadiness: catScore('deploymentReadiness', (b) => b + (caps.has('registry') ? 8 : 0)),
    dataDesign: catScore('dataDesign', (b) => b + (caps.has('cache') ? 5 : 0)),
    costAwareness: clamp(
      (spec.targetLevel === 'mvp' ? 85 : spec.targetLevel === 'enterprise' ? 65 : 75)
      + (caps.has('serverlessFn') ? 8 : 0) + (caps.has('cache') ? 5 : 0)
    ),
  };
  const weights = { scalability: 1.2, security: 1.5, reliability: 1.2, observability: 1, maintainability: 1, deploymentReadiness: 1, dataDesign: 1, costAwareness: 0.6 };
  const wSum = Object.values(weights).reduce((a, b) => a + b, 0);
  const overall = clamp(Object.entries(breakdown).reduce((a, [k, v]) => a + v * weights[k], 0) / wSum);
  return { overallScore: overall, ...breakdown };
}

/* Full validation report for an architectureSpec. */
export function validateSpec(spec = {}) {
  const checks = runChecks(spec);
  const score = scoreSpec(spec, checks);
  const failing = checks.filter((c) => c.status === 'fail');
  const missingCriticalItems = failing.filter((c) => c.severity === 'critical' || c.severity === 'high').map((c) => c.message);
  const recommendations = failing
    .sort((a, b) => (SEVERITY_WEIGHT[b.severity] || 0) - (SEVERITY_WEIGHT[a.severity] || 0))
    .map((c) => c.recommendation)
    .filter(Boolean);
  const warnings = failing.map((c) => `[${c.severity}] ${c.message}`);
  return { checks, score, missingCriticalItems, recommendations, warnings };
}

export default { runChecks, scoreSpec, validateSpec };
