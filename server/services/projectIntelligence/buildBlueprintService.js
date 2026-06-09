/* ============================================================
   Task 6 — Build Blueprint V2
   ------------------------------------------------------------
   A practical, student-buildable blueprint. Deterministic; reuses
   the diagram model so screens/APIs/schema line up with the
   architecture diagrams. AI never required.
   ============================================================ */
import { asList, uniq, lc } from './util.js';
import { deriveProjectModel } from './projectDiagramService.js';

export function buildBlueprintV2({ project = {}, recommendation = {}, explainer = {} } = {}) {
  const m = deriveProjectModel({ project, recommendation, explainer });
  const title = m.title;
  const skills = uniq(asList(recommendation.skills).concat(asList(project.skillsCovered)).concat(asList(project.skills)));
  const problem = recommendation.problemStatement || project.problemStatement || project.summary || 'A specific, repeated workflow problem current tools handle poorly.';

  const frontendScreens = m.isAnalyzer ? ['Landing', 'Upload', 'Results / Root cause', 'Report export']
    : m.isPipeline ? ['Dashboard', 'Job runner', 'Run detail', 'Metrics']
      : ['Landing', 'Auth', 'Workspace / core task', 'Results dashboard', 'Settings'];

  const databaseSchema = m.isAnalyzer
    ? ['users(id, email, created_at)', 'uploads(id, user_id FK, filename, size, created_at)', 'analyses(id, upload_id FK, root_cause, status, created_at)', 'recommendations(id, analysis_id FK, text, priority)']
    : m.isPipeline
      ? ['jobs(id, name, schedule, created_at)', 'runs(id, job_id FK, status, started_at, finished_at)', 'quality_checks(id, run_id FK, name, passed)', 'metrics(id, run_id FK, rows_in, rows_out, freshness)']
      : ['users(id, email, password_hash, role, created_at)', 'workspaces(id, owner_id FK, name)', 'items(id, workspace_id FK, payload jsonb, created_at)'];

  const envVars = ['NODE_ENV', 'PORT', 'DATABASE_URL', 'SESSION_SECRET']
    .concat(m.integrations.includes('LLM API') ? ['LLM_API_KEY'] : [])
    .concat(m.integrations.includes('GitHub API') ? ['GITHUB_TOKEN'] : [])
    .concat(m.integrations.includes('Kafka') ? ['KAFKA_BROKERS'] : []);

  const coreAlgorithm = m.isAnalyzer
    ? '1) Parse the uploaded input into structured records. 2) Run rule/heuristic matchers (and optionally a model) to rank likely root causes. 3) Map each cause to a fix recommendation with a confidence. 4) Persist + render the ranked report.'
    : m.isPipeline
      ? '1) Extract from the source in batches. 2) Apply idempotent transforms. 3) Run data-quality assertions (not-null, ranges, freshness). 4) Load only validated rows into the warehouse. 5) Emit run metrics.'
      : '1) Validate input. 2) Apply the core domain operation. 3) Persist the result transactionally. 4) Return a view model for the dashboard.';

  return {
    productDefinition: `${title}: a ${recommendation.targetRole || project.targetRole || 'engineering'} project that solves "${String(problem).slice(0, 140)}".`,
    mvpScope: m.modules.slice(0, Math.min(4, m.modules.length)),
    outOfScope: ['Billing / payments', 'Multi-tenant orgs', 'Native mobile apps', 'Anything off the core happy path'],
    featureBreakdown: m.modules.map((mod, i) => ({ feature: mod, priority: i < 3 ? 'P0' : i < 5 ? 'P1' : 'P2' })),
    frontendScreens,
    backendApis: m.apis,
    databaseSchema,
    externalApis: m.integrations.length ? m.integrations : ['(none required for the MVP)'],
    environmentVariables: uniq(envVars),
    folderStructure: [
      'client/', '  src/', '    components/', '    pages/', 'server/', '  routes/', '  services/', '  db/',
      '.github/workflows/ci.yml', 'docker-compose.yml', '.env.example', 'README.md', 'tests/',
    ].join('\n'),
    coreAlgorithm,
    testPlan: ['Unit tests for the core service / engine', 'API integration tests for each endpoint', 'One end-to-end happy-path test', 'A data-quality / edge-case test for the hardest input'],
    deploymentPlan: ['Containerise client + API', `Managed ${m.db}`, 'CI runs lint + tests on every push', 'Deploy frontend (Vercel) + API (Render/Railway)', 'Add a health-check endpoint'],
    demoScript: [
      `Open the live URL for ${title}.`,
      m.isAnalyzer ? 'Upload a broken input and show the instant root-cause report.' : m.isPipeline ? 'Trigger a job and show data landing with quality checks passing.' : 'Complete the core task end-to-end in under a minute.',
      'Open the GitHub repo: README, architecture diagram, tests, CI badge.',
      'Close on the measurable result (time saved / accuracy / throughput).',
    ],
    readmeSections: ['Problem', 'Solution', 'Architecture (diagram)', 'Tech stack', 'Local setup', 'Running tests', 'Deployment', 'Screenshots / demo', 'Results / benchmarks'],
    githubChecklist: ['Public repo with a clear name', 'README with problem/solution/architecture', '.env.example (no secrets committed)', 'CI workflow (lint + tests)', 'Tests folder', 'License', 'Topics/tags set for discoverability'],
    skills: skills.slice(0, 8),
  };
}
