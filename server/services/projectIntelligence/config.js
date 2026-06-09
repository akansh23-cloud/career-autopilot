/* ============================================================
   Project Intelligence OS — configuration + knowledge base
   ------------------------------------------------------------
   Single source of truth for env-driven behaviour. Degrades
   safely when no AI key is present (deterministic/fallback
   mode). Nothing here throws.
   ============================================================ */

export const pjConfig = (env = process.env) => {
  const anthropicKey = env.ANTHROPIC_API_KEY || '';
  const provider = anthropicKey ? 'anthropic' : 'fallback';
  return {
    // Master switch — default ON. Set PROJECT_INTELLIGENCE_ENABLED=0 to hide it.
    enabled: env.PROJECT_INTELLIGENCE_ENABLED !== '0',
    anthropicKey,
    aiProvider: provider,
    aiModel: env.AI_MODEL || 'claude-sonnet-4-20250514',
    // Recommendation knobs.
    maxRecommendations: Number(env.PROJECT_INTELLIGENCE_MAX_RECS) || 6,
    similarityThreshold: Number(env.PROJECT_INTELLIGENCE_SIMILARITY) || 0.55,
  };
};

export const resolveActiveProvider = (cfg = pjConfig()) => (cfg.anthropicKey ? 'anthropic' : 'fallback');

export const PROJECT_INTELLIGENCE_DISCLAIMER =
  'Recommendations are generated from your profile signals (target role, resume, skills, GitHub and saved jobs). ' +
  'They are guidance, not guarantees. Resume bullets are only marked "verified" once real proof exists.';

export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced', 'research-grade'];

/* ------------------------------------------------------------------ */
/* Role knowledge base — drives gap detection + project archetypes.    */
/* Each role family lists the skills + proof artifacts recruiters look  */
/* for, plus seed project archetypes that create that proof.            */
/* ------------------------------------------------------------------ */
export const ROLE_FAMILIES = {
  'data engineer': {
    coreSkills: ['SQL', 'Python', 'Spark', 'Airflow', 'dbt', 'AWS', 'Kafka', 'Data Modeling', 'Snowflake'],
    proofSignals: ['ETL/ELT pipeline repo', 'data-quality checks', 'orchestration DAG', 'cloud deployment'],
    archetypes: [
      { key: 'elt-quality', title: 'End-to-end ELT pipeline with a data-quality dashboard',
        skills: ['Python', 'dbt', 'Airflow', 'SQL', 'Data Modeling'], difficulty: 'advanced',
        problem: 'Data roles need proof of reliable pipelines with quality gates, not just notebooks.',
        proof: ['ELT pipeline repo', 'dbt tests + docs', 'Great Expectations checks', 'Airflow DAG', 'deployed dashboard'] },
      { key: 'streaming', title: 'Real-time streaming pipeline (Kafka → Spark → warehouse)',
        skills: ['Kafka', 'Spark', 'Python', 'SQL'], difficulty: 'advanced',
        problem: 'Streaming is asked for in JDs but most candidates only show batch work.',
        proof: ['Kafka producer/consumer', 'Spark structured streaming job', 'late-data handling', 'throughput benchmark'] },
      { key: 'lakehouse', title: 'Lakehouse on Iceberg/Delta with time-travel queries',
        skills: ['Spark', 'AWS', 'SQL', 'Data Modeling'], difficulty: 'advanced',
        problem: 'Lakehouse architecture is a hot JD keyword with little candidate proof.',
        proof: ['Iceberg/Delta tables', 'partition/compaction job', 'time-travel demo', 'cost notes'] },
    ],
  },
  'devops engineer': {
    coreSkills: ['Docker', 'Kubernetes', 'CI/CD', 'Terraform', 'AWS', 'Prometheus', 'Linux', 'Helm'],
    proofSignals: ['IaC repo', 'CI/CD pipeline', 'observability dashboards', 'troubleshooting writeup'],
    archetypes: [
      { key: 'k8s-failure', title: 'Kubernetes deployment failure analyzer',
        skills: ['Kubernetes', 'CI/CD', 'Docker', 'Python'], difficulty: 'intermediate',
        problem: 'Engineers waste hours correlating CI logs with pod events to find why a deploy failed.',
        proof: ['log upload + parser', 'root-cause engine', 'fix suggestions', 'CI workflow', 'live demo'] },
      { key: 'iac-platform', title: 'Self-service Terraform platform with policy checks',
        skills: ['Terraform', 'AWS', 'CI/CD', 'Helm'], difficulty: 'advanced',
        problem: 'Teams need guardrailed infra provisioning, not hand-rolled clickops.',
        proof: ['Terraform modules', 'policy-as-code (OPA)', 'CI plan/apply', 'cost + drift report'] },
      { key: 'observability', title: 'Observability stack with SLO alerting',
        skills: ['Prometheus', 'Kubernetes', 'Docker'], difficulty: 'intermediate',
        problem: 'On-call teams lack actionable SLO-based alerts and dashboards.',
        proof: ['Prometheus + Grafana', 'SLO/burn-rate alerts', 'runbook', 'load-test evidence'] },
    ],
  },
  'software engineer': {
    coreSkills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'SQL', 'REST', 'Testing', 'System Design'],
    proofSignals: ['full-stack app repo', 'tests + CI', 'deployed demo', 'architecture diagram'],
    archetypes: [
      { key: 'fullstack-saas', title: 'Multi-tenant SaaS with auth, billing and a dashboard',
        skills: ['React', 'Node.js', 'SQL', 'REST', 'Testing'], difficulty: 'intermediate',
        problem: 'Recruiters want a deployable product with auth, data and tests — not a to-do app.',
        proof: ['deployed app', 'auth + RBAC', 'test suite + CI', 'README with architecture'] },
      { key: 'realtime-collab', title: 'Real-time collaborative editor with conflict resolution',
        skills: ['TypeScript', 'React', 'Node.js', 'System Design'], difficulty: 'advanced',
        problem: 'Real-time sync shows depth in concurrency and system design.',
        proof: ['CRDT/OT sync', 'presence + cursors', 'load test', 'design writeup'] },
    ],
  },
  'ml engineer': {
    coreSkills: ['Python', 'PyTorch', 'TensorFlow', 'MLOps', 'Docker', 'SQL', 'LLM', 'Vector DB'],
    proofSignals: ['model repo', 'served inference API', 'evaluation report', 'MLOps pipeline'],
    archetypes: [
      { key: 'rag-app', title: 'Production RAG assistant with evaluation harness',
        skills: ['Python', 'LLM', 'Vector DB', 'Docker'], difficulty: 'intermediate',
        problem: 'Most LLM demos lack retrieval quality evaluation and guardrails.',
        proof: ['retrieval pipeline', 'eval harness (recall/faithfulness)', 'served API', 'cost notes'] },
      { key: 'mlops', title: 'MLOps pipeline: train → register → serve → monitor',
        skills: ['MLOps', 'Python', 'Docker', 'PyTorch'], difficulty: 'advanced',
        problem: 'ML roles need lifecycle proof, not a single notebook.',
        proof: ['training pipeline', 'model registry', 'served endpoint', 'drift monitoring'] },
    ],
  },
  'frontend engineer': {
    coreSkills: ['JavaScript', 'TypeScript', 'React', 'CSS', 'Accessibility', 'Testing', 'Performance'],
    proofSignals: ['polished UI repo', 'a11y audit', 'lighthouse score', 'component tests'],
    archetypes: [
      { key: 'design-system', title: 'Accessible component library with a docs site',
        skills: ['React', 'TypeScript', 'Accessibility', 'Testing'], difficulty: 'intermediate',
        problem: 'Frontend roles value reusable, accessible, tested components.',
        proof: ['component library', 'a11y audit', 'Storybook/docs', 'visual + unit tests'] },
    ],
  },
};

/* Generic fallback used when the role is unknown. */
export const GENERIC_FAMILY = {
  coreSkills: ['JavaScript', 'Python', 'SQL', 'Git', 'Testing', 'Deployment', 'APIs'],
  proofSignals: ['deployed app repo', 'README', 'tests', 'architecture diagram'],
  archetypes: [
    { key: 'workflow-tool', title: 'A focused workflow tool that solves one real, repeated problem',
      skills: ['JavaScript', 'APIs', 'SQL', 'Deployment'], difficulty: 'intermediate',
      problem: 'A specific, repeated workflow that current tools handle poorly.',
      proof: ['deployed app', 'README + screenshots', 'one core workflow end-to-end', 'tests'] },
  ],
};

export function roleFamilyFor(role = '') {
  const r = String(role || '').toLowerCase();
  for (const [name, fam] of Object.entries(ROLE_FAMILIES)) {
    const head = name.split(' ')[0];
    if (r.includes(name) || r.includes(head)) return { name, ...fam };
  }
  // keyword heuristics
  if (/data|etl|warehouse|spark|pipeline/.test(r)) return { name: 'data engineer', ...ROLE_FAMILIES['data engineer'] };
  if (/devops|sre|platform|infra|cloud/.test(r)) return { name: 'devops engineer', ...ROLE_FAMILIES['devops engineer'] };
  if (/ml|machine learning|ai|data scien/.test(r)) return { name: 'ml engineer', ...ROLE_FAMILIES['ml engineer'] };
  if (/front.?end|ui/.test(r)) return { name: 'frontend engineer', ...ROLE_FAMILIES['frontend engineer'] };
  if (/back.?end|full.?stack|software|developer|engineer/.test(r)) return { name: 'software engineer', ...ROLE_FAMILIES['software engineer'] };
  return { name: 'generic', ...GENERIC_FAMILY };
}
