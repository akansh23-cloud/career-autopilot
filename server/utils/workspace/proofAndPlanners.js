/* Guided Project Workspace — test plan (deterministic). */
import { did, slug } from './planUtils.js';

export function planTests(project = {}, stack = {}, { entity = 'Item', tasks = [] } = {}) {
  const e = slug(entity);
  const taskId = (re) => (tasks.find((t) => re.test(t.title)) || {}).id || null;
  const tests = [
    {
      id: did('test', 'health'), name: 'backend/tests/health.test.js', type: 'api',
      target: 'GET /api/health', command: 'npm test --prefix backend',
      expectedResult: 'Health endpoint returns { ok: true }', linkedTask: taskId(/backend tests/i), status: 'planned',
    },
    {
      id: did('test', e), name: `backend/tests/${e}.test.js`, type: 'unit',
      target: `${entity} service create/list`, command: 'npm test --prefix backend',
      expectedResult: `${entity} can be created and listed (in-memory or test DB)`, linkedTask: taskId(/backend tests/i), status: 'planned',
    },
    {
      id: did('test', 'frontend smoke'), name: 'frontend smoke check', type: 'manual',
      target: 'Dashboard renders', command: 'npm run dev --prefix frontend',
      expectedResult: 'Dashboard shows the empty state without console errors', linkedTask: taskId(/Dashboard/i), status: 'planned',
    },
  ];
  if ((stack.features || {}).upload) tests.push({
    id: did('test', 'upload'), name: `backend/tests/upload.test.js (planned)`, type: 'api',
    target: `POST /api/${e}s/upload`, command: 'npm test --prefix backend',
    expectedResult: 'Rejects oversized files; accepts a small valid file', linkedTask: taskId(/upload api/i), status: 'planned',
  });
  return tests;
}

/* Deployment plan. Never includes secret values — env var NAMES only. */
export function planDeployment(project = {}, stack = {}) {
  const f = stack.features || {};
  const provider = ['vercel', 'render', 'railway', 'aws', 'gcp', 'azure', 'fly'].includes(stack.cloudProvider) ? stack.cloudProvider : 'generic';
  const requiredEnvVars = ['MONGODB_URI', 'SESSION_SECRET', 'PORT'];
  if (f.upload) requiredEnvVars.push('UPLOAD_DIR (or S3_BUCKET + S3_REGION)');
  if (f.payments) requiredEnvVars.push('PAYMENT_KEY_ID (sandbox)', 'PAYMENT_KEY_SECRET (sandbox — env only, never committed)');
  if (f.ai) requiredEnvVars.push('AI_API_KEY (optional — scoring works deterministically without it)');
  return {
    provider,
    environments: ['local', 'production'],
    requiredEnvVars,
    buildCommand: 'npm run build --prefix frontend',
    startCommand: 'npm start --prefix backend',
    deploySteps: [
      'Provision a MongoDB instance (Atlas free tier works) and set MONGODB_URI',
      'Set all required env vars in the provider dashboard — never commit .env',
      provider === 'vercel' ? 'Deploy backend as serverless functions or a separate service; deploy frontend as the static build' : 'Deploy backend service, then frontend static build (or serve frontend from Express)',
      'Run the health check after deploy',
      'Add the deployed URL to the Proof tab',
    ],
    healthCheckUrl: '/api/health',
    status: 'planned',
  };
}

/* Proof requirements. verificationMethod drives the verify endpoint.

   The demo-video item was removed deliberately: it was redundant with the
   screenshots requirement (both show the app working), not with the
   deployment check (which only proves the server responds). Screenshots win
   because they live in the repo and survive a free-tier deployment being
   suspended months later, when a recruiter actually looks. */
export function planProof(project = {}, stack = {}) {
  // Not every project deploys — a CLI tool, a library, a data pipeline or a
  // notebook has no URL to check. Those items are marked `conditional` and get
  // SKIPPED rather than sitting permanently red.
  const deployable = !!(stack?.frontend || stack?.backend || stack?.deployment);
  const hasBackend = !!stack?.backend;

  const items = [
    ['github_repo', 'GitHub repository connected', 'Public repo containing this project.', true, 'github', false],
    ['readme', 'README.md present and meaningful', 'Explains what it does, why, and how to run it.', true, 'github', false],
    ['screenshots', 'Screenshots committed to the repo', 'At least 2 images in docs/screenshots/, with one embedded in the README.', true, 'github_screenshots', false],
    ['deployed_url', 'Deployed demo URL', 'Publicly reachable deployment.', deployable, 'deployment', !deployable],
    ['tests_passing', 'Tests pass', 'Paste your `npm test` output, or add CI to have it verified automatically.', true, 'tests', false],
    ['api_health', 'API health check reachable', '/api/health returns JSON on the deployed backend.', false, 'api_health', !hasBackend],
    ['architecture_exported', 'Architecture spec generated and saved', 'Architecture OS spec exists for this project (design quality, not implementation proof).', false, 'workspace_local', false],
  ];

  return items.map(([key, title, description, required, verificationMethod, skipped]) => ({
    id: did('proof', key), type: key, title, description,
    required: !!required && !skipped,
    status: skipped ? 'not_applicable' : 'pending',
    skipped: !!skipped,
    verificationMethod,
  }));
}

/* Patent assets — only when the user opted in. Pulls the patentFigure view
   from the Architecture OS spec when present. Never claims patentability. */
export function planPatent(project = {}, stack = {}, architectureSpec = null) {
  const enabled = !!(project.flags && project.flags.patent);
  if (!enabled) return { enabled: false, patentFigure: null, noveltyAngles: [], claimElementCandidates: [], methodFlow: [], notes: [] };
  const f = stack.features || {};
  const views = Array.isArray(architectureSpec?.views) ? architectureSpec.views : [];
  const fig = views.find((v) => v.type === 'patentFigure') || null;
  const noveltyAngles = [];
  if (f.ai) noveltyAngles.push('Deterministic scoring pipeline where the system (not a model) owns the numeric output');
  if (f.upload) noveltyAngles.push('Structured ingestion flow from raw upload to scored, queryable record');
  if (f.queue) noveltyAngles.push('Asynchronous processing pipeline with verifiable state transitions');
  noveltyAngles.push('Combination of the above applied to this specific domain — novelty depends on prior art search');
  const methodFlow = [
    'Receive user input/record', f.upload ? 'Ingest and normalize the uploaded artifact' : 'Normalize the record',
    f.ai ? 'Compute deterministic score + breakdown' : 'Apply domain rules',
    'Persist result with audit trail', 'Surface result to the user role(s)',
  ];
  const claimElementCandidates = [
    'A method comprising receiving a domain record from a client device',
    f.upload ? 'extracting structured fields from an uploaded artifact' : 'normalizing the record into a structured representation',
    f.ai ? 'computing a deterministic score using a rule-based engine' : 'applying a deterministic rule set',
    'storing the result in association with a user account',
  ];
  return {
    enabled: true,
    patentFigure: fig ? { viewId: fig.id || 'patentFigure', title: fig.title || 'Patent figure', source: 'architecture_os' } : null,
    noveltyAngles, claimElementCandidates, methodFlow,
    notes: [
      'These are brainstorm-level candidates from the deterministic planner.',
      'Nothing here is a patentability opinion — run prior-art research in Patent OS and consult a professional before filing.',
    ],
  };
}
