// Project OS — Builder Mode "Build Guide" generator (deterministic, pure).
//
// This module turns ANY Project OS / Project Studio / Patent-converted project
// into a structured, step-by-step Build Guide. It is intentionally PURE: no
// `window`, no DOM, no network, no AI key. That keeps it safe to import from the
// React UI, from the Express server routes, AND from `node --test`.
//
// AI is optional everywhere else in the app; Builder Mode never depends on it.
// If an AI layer ever wants to enrich the prose, it MUST pass the result through
// `normalizeBuildGuide()` so the UI only ever renders a validated shape.

import { detectPattern } from './projectBuildPatterns.js';
import { normalizeArchitecture, architectureToTasks, hasArchitectureData } from './architectureToBuildGuide.js';
import { classifyTaskType } from './taskTypeClassifier.js';
import { detectDomain } from './domainImplementationRecipes.js';
import { buildCodeLevelGuide, normalizeCodeLevelGuide } from './codeLevelGuideGenerator.js';

/* ------------------------------------------------------------------ *
 * Small, dependency-free helpers (no app imports → safe in any env).  *
 * ------------------------------------------------------------------ */
const isArr = Array.isArray;
const arr = (v) => (isArr(v) ? v.filter((x) => x != null) : []);
const obj = (v) => (v && typeof v === 'object' && !isArr(v) ? v : {});
const str = (v, fallback = '') => {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const uniq = (list) => Array.from(new Set(arr(list).map((s) => String(s).trim()).filter(Boolean)));

export function slugify(s = '', max = 40) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'project';
}

const TYPES = ['Frontend', 'Backend', 'Full Stack', 'DevOps', 'Data', 'AI/ML', 'Cloud', 'Cybersecurity'];

/* Infer a build "type" when a project doesn't carry one (e.g. Patent-converted). */
function inferType(project) {
  if (TYPES.includes(project.type)) return project.type;
  const hay = (uniq([...(project.techStack || []), ...(project.skillsCovered || [])]).join(' ') + ' ' + str(project.targetRole)).toLowerCase();
  const has = (...k) => k.some((x) => hay.includes(x));
  if (has('terraform', 'kubernetes', 'k8s', 'helm', 'ci/cd', 'jenkins', 'ansible', 'devops')) return 'DevOps';
  if (has('lambda', 'serverless', 's3', 'eks', 'cloudformation', 'gcp', 'azure')) return 'Cloud';
  if (has('tensorflow', 'pytorch', 'ml', 'machine learning', 'nlp', 'llm', 'model', 'scikit')) return 'AI/ML';
  if (has('spark', 'hadoop', 'etl', 'airflow', 'snowflake', 'pipeline', 'iceberg', 'warehouse', 'dbt', 'kafka')) return 'Data';
  if (has('owasp', 'pentest', 'siem', 'vulnerability', 'security', 'cyber')) return 'Cybersecurity';
  if (has('react', 'vue', 'angular', 'svelte', 'frontend', 'tailwind')) return 'Frontend';
  if (has('express', 'spring', 'django', 'fastapi', 'api', 'backend')) return 'Backend';
  return 'Full Stack';
}

/* Capability flags drive which stages/tasks a guide includes. */
function capabilities(type) {
  switch (type) {
    case 'Frontend': return { backend: false, frontend: true, db: false, data: false, ml: false, infra: false };
    case 'Backend': return { backend: true, frontend: false, db: true, data: false, ml: false, infra: false };
    case 'DevOps': return { backend: true, frontend: false, db: false, data: false, ml: false, infra: true };
    case 'Cloud': return { backend: true, frontend: false, db: true, data: false, ml: false, infra: true };
    case 'Data': return { backend: true, frontend: false, db: true, data: true, ml: false, infra: false };
    case 'AI/ML': return { backend: true, frontend: false, db: false, data: false, ml: true, infra: false };
    case 'Cybersecurity': return { backend: true, frontend: false, db: false, data: false, ml: false, infra: true };
    case 'Full Stack':
    default: return { backend: true, frontend: true, db: true, data: false, ml: false, infra: false };
  }
}

/* The primary backend/runtime language hint, used to pick concrete commands. */
function runtime(project, type) {
  const hay = uniq([...(project.techStack || []), ...(project.skillsCovered || [])]).join(' ').toLowerCase();
  if (/python|fastapi|django|flask|airflow|pytorch|pandas|scikit/.test(hay) || type === 'Data' || type === 'AI/ML') return 'python';
  if (/java|spring/.test(hay)) return 'java';
  if (/go\b|golang/.test(hay)) return 'go';
  return 'node';
}

/* ------------------------------------------------------------------ *
 * Prerequisites                                                       *
 * ------------------------------------------------------------------ */
function buildPrerequisites(project, type, rt) {
  const out = [
    { name: 'Git', description: 'Version control to track your work and push proof to GitHub.', required: true, checkCommand: 'git --version', installLink: 'https://git-scm.com/downloads', completed: false },
    { name: 'A code editor', description: 'VS Code (or similar) for editing project files.', required: true, checkCommand: 'code --version', installLink: 'https://code.visualstudio.com/', completed: false },
    { name: 'A GitHub account', description: 'To host the repository and serve as recruiter-visible proof.', required: true, checkCommand: 'gh auth status', installLink: 'https://github.com/join', completed: false },
  ];
  if (rt === 'node') out.push({ name: 'Node.js 18+', description: 'JavaScript runtime + npm for the app and tooling.', required: true, checkCommand: 'node -v', installLink: 'https://nodejs.org/', completed: false });
  if (rt === 'python') out.push({ name: 'Python 3.10+', description: 'Runtime for the backend / pipeline / model code.', required: true, checkCommand: 'python --version', installLink: 'https://www.python.org/downloads/', completed: false });
  if (rt === 'java') out.push({ name: 'JDK 17+ & Maven', description: 'To compile and run the service.', required: true, checkCommand: 'java -version', installLink: 'https://adoptium.net/', completed: false });
  if (rt === 'go') out.push({ name: 'Go 1.21+', description: 'To build and run the service.', required: true, checkCommand: 'go version', installLink: 'https://go.dev/dl/', completed: false });

  const caps = capabilities(type);
  if (caps.db) out.push({ name: 'A database', description: 'PostgreSQL or MongoDB to persist app data. Docker is the easiest local option.', required: false, checkCommand: 'docker --version', installLink: 'https://www.docker.com/products/docker-desktop/', completed: false });
  if (caps.infra) out.push({ name: 'Docker', description: 'Container runtime for building and shipping images.', required: true, checkCommand: 'docker --version', installLink: 'https://www.docker.com/products/docker-desktop/', completed: false });
  if (type === 'DevOps' || type === 'Cloud') out.push({ name: 'Cloud CLI', description: 'AWS/GCP/Azure CLI to provision and deploy infrastructure.', required: false, checkCommand: 'aws --version', installLink: 'https://aws.amazon.com/cli/', completed: false });
  return out;
}

/* ------------------------------------------------------------------ *
 * Setup section                                                       *
 * ------------------------------------------------------------------ */
function buildSetup(project, type, rt) {
  const slug = slugify(project.title);
  const commands = ['git init', `# create the project folder structure (see below)`];
  if (rt === 'node') commands.push('npm init -y');
  if (rt === 'python') commands.push('python -m venv .venv', 'source .venv/bin/activate  # (Windows: .venv\\Scripts\\activate)');
  commands.push('git add -A', 'git commit -m "chore: initialize project"');

  const folder = arr(String(project.repoStructure || project.folderStructure || '').split('\n')).map((l) => str(l)).filter(Boolean);
  const folderStructure = folder.length ? folder : defaultFolder(type, rt);

  const env = [];
  if (rt === 'node' || rt === 'python') env.push('PORT=5000');
  if (capabilities(type).db) env.push('DATABASE_URL=postgres://localhost:5432/' + slug.replace(/-/g, '_'));
  if (capabilities(type).backend) env.push('NODE_ENV=development');

  return {
    overview: `Set up a clean local workspace for "${str(project.title, 'your project')}". You will create the repository, scaffold the folder structure, install the core stack (${uniq(project.techStack).slice(0, 4).join(', ') || 'your chosen stack'}), and confirm everything runs before writing features.`,
    commands,
    folderStructure,
    environmentVariables: env,
    expectedOutput: [
      'A new git repository with at least one commit.',
      rt === 'node' ? 'A package.json at the project root.' : rt === 'python' ? 'An activated virtual environment.' : 'A buildable project skeleton.',
      'The folder structure above created (empty files are fine for now).',
    ],
  };
}

function defaultFolder(type, rt) {
  const caps = capabilities(type);
  const lines = [];
  if (caps.backend) lines.push(rt === 'python' ? 'server/' : 'server/', '  index.js (or app.py)', '  routes/', '  services/');
  if (caps.db) lines.push('  models/');
  if (caps.frontend) lines.push('web/', '  src/', '    components/', '    pages/');
  if (caps.data) lines.push('pipeline/', '  ingest/', '  transform/', '  orchestration/');
  if (caps.ml) lines.push('ml/', '  train.py', '  evaluate.py', '  serve.py');
  if (caps.infra) lines.push('infra/', '  main.tf', '.github/workflows/');
  lines.push('tests/', 'README.md');
  return lines;
}

/* ------------------------------------------------------------------ *
 * Stages + tasks (the heart of "project-specific" guidance)           *
 * ------------------------------------------------------------------ */
function task(id, t) {
  return {
    id,
    title: str(t.title),
    objective: str(t.objective),
    filesToCreate: arr(t.filesToCreate).map(str),
    filesToEdit: arr(t.filesToEdit).map(str),
    commands: arr(t.commands).map(str),
    implementationSteps: arr(t.implementationSteps).map(str),
    expectedOutput: arr(t.expectedOutput).map(str),
    validationSteps: arr(t.validationSteps).map(str),
    commonErrors: arr(t.commonErrors).map(str),
    commitMessage: str(t.commitMessage),
    completionCriteria: arr(t.completionCriteria).map(str),
    status: 'todo',
  };
}

function buildStages(project, type, rt) {
  const slug = slugify(project.title);
  const name = str(project.title, 'the project');
  const caps = capabilities(type);
  const stages = [];

  /* ---- Stage 1: Setup & repository (always) ---- */
  stages.push({
    id: 'stage-setup',
    title: 'Project setup & repository',
    goal: 'Create the repo, scaffold the structure, and make your first commit.',
    estimatedTime: '1–2 hours',
    status: 'todo',
    tasks: [
      task('stage-setup-1', {
        title: 'Initialize the repository and folder structure',
        objective: 'Have a version-controlled, well-structured starting point.',
        filesToCreate: ['README.md', '.gitignore'],
        commands: ['git init', rt === 'node' ? 'npm init -y' : rt === 'python' ? 'python -m venv .venv' : 'echo "init"', 'git add -A', 'git commit -m "chore: initialize project"'],
        implementationSteps: [
          'Create the project folder and open it in your editor.',
          'Create the folders listed in the Local Setup section.',
          `Add a short README.md titled "${name}" with a one-line description.`,
          'Add a .gitignore for node_modules / .venv / .env.',
          'Make the first commit.',
        ],
        expectedOutput: ['`git log` shows one commit.', 'The folder structure exists.'],
        validationSteps: ['Run `git status` — the tree should be clean after committing.'],
        commonErrors: ['Forgetting .gitignore and committing node_modules — remove it and re-commit.'],
        commitMessage: 'chore: initialize project',
        completionCriteria: ['Repo initialized', 'First commit made'],
      }),
      task('stage-setup-2', {
        title: 'Configure environment variables',
        objective: 'Keep configuration out of source code and document required vars.',
        filesToCreate: ['.env.example', '.env'],
        commands: rt === 'node' ? ['npm install dotenv'] : rt === 'python' ? ['pip install python-dotenv'] : [],
        implementationSteps: [
          'Create .env.example listing every variable (no secrets).',
          'Copy it to .env and fill in local values (PORT, DATABASE_URL, etc.).',
          'Load env vars at startup (dotenv / os.environ).',
        ],
        expectedOutput: ['.env.example committed; .env ignored by git.'],
        validationSteps: ['Confirm `.env` is listed in `.gitignore` and not tracked.'],
        commonErrors: ['Committing real secrets — rotate them and add .env to .gitignore.'],
        commitMessage: 'chore: add environment configuration',
        completionCriteria: ['.env.example committed', 'Secrets excluded from git'],
      }),
    ],
  });

  /* ---- Stage 2: Backend foundation ---- */
  if (caps.backend) {
    const tasks = [
      task('stage-backend-1', {
        title: 'Create the backend health-check API',
        objective: 'Confirm the backend server is running.',
        filesToCreate: [rt === 'python' ? 'server/app.py' : 'server/index.js'],
        commands: rt === 'node'
          ? ['npm install express cors dotenv', 'node server/index.js']
          : rt === 'python'
            ? ['pip install fastapi uvicorn', 'uvicorn server.app:app --reload --port 5000']
            : ['# start your server'],
        implementationSteps: rt === 'node'
          ? ['Import express and cors.', 'Create an Express app and enable JSON + CORS.', 'Add GET /api/health.', `Return { status: "ok", service: "${slug}" }.`, 'Start the server on PORT from env or 5000.']
          : ['Create the app object.', 'Add a GET /api/health route.', `Return { "status": "ok", "service": "${slug}" }.`, 'Run the server on PORT from env or 5000.'],
        expectedOutput: [`GET /api/health returns { "status": "ok", "service": "${slug}" }.`],
        validationSteps: ['Open http://localhost:5000/api/health in a browser or Postman.', 'Confirm the JSON status is "ok".'],
        commonErrors: ['Port already in use → change PORT or stop the other process.', 'CORS errors from the frontend → enable cors() middleware.'],
        commitMessage: 'feat: add backend health check API',
        completionCriteria: ['/api/health returns ok', 'Server starts without errors'],
      }),
    ];
    if (caps.db) {
      tasks.push(task('stage-backend-2', {
        title: 'Define the primary data model',
        objective: 'Model the core entity the app stores.',
        filesToCreate: [rt === 'python' ? 'server/models.py' : 'server/models/Item.js'],
        commands: rt === 'node' ? ['npm install mongoose  # or your ORM/driver'] : ['pip install sqlalchemy  # or your ORM'],
        implementationSteps: [
          `Identify the core entity for "${name}" (e.g. a record the app creates).`,
          'Define its fields, types, and required constraints.',
          'Add createdAt/updatedAt timestamps.',
          'Connect to the database using DATABASE_URL.',
        ],
        expectedOutput: ['The app connects to the DB at startup and the model is registered.'],
        validationSteps: ['Insert one test record and read it back.'],
        commonErrors: ['DB connection refused → confirm the database is running and DATABASE_URL is correct.'],
        commitMessage: 'feat: add primary data model',
        completionCriteria: ['Model defined', 'DB connection verified'],
      }));
    }
    tasks.push(task('stage-backend-3', {
      title: `Implement the core ${type} endpoint`,
      objective: `Deliver the main capability of "${name}" behind a real API.`,
      filesToCreate: [rt === 'python' ? 'server/routes.py' : 'server/routes/core.js'],
      filesToEdit: [rt === 'python' ? 'server/app.py' : 'server/index.js'],
      commands: [],
      implementationSteps: [
        'Decide the primary resource and its create/read operations.',
        'Add POST to create the resource (validate the request body).',
        'Add GET to list/return the resource(s).',
        'Return clear JSON responses and proper status codes.',
        'Wire the route file into the server entry point.',
      ],
      expectedOutput: ['POST creates a record and returns 201 with the created object.', 'GET returns the stored records as JSON.'],
      validationSteps: ['Create one record via Postman, then list it back.', 'Send an invalid body and confirm a 400 with a helpful message.'],
      commonErrors: ['Missing body parser → ensure express.json()/request parsing is enabled.', 'Unvalidated input → add validation before persisting.'],
      commitMessage: `feat: implement core ${type.toLowerCase()} endpoint`,
      completionCriteria: ['Create + read endpoints work', 'Input is validated'],
    }));
    stages.push({ id: 'stage-backend', title: 'Backend foundation', goal: `Stand up the API that powers "${name}".`, estimatedTime: '4–8 hours', status: 'todo', tasks });
  }

  /* ---- Stage: Data pipeline (Data only) ---- */
  if (caps.data) {
    stages.push({
      id: 'stage-data', title: 'Data pipeline', goal: 'Build an ingest → transform → load flow with quality checks.', estimatedTime: '6–10 hours', status: 'todo',
      tasks: [
        task('stage-data-1', { title: 'Build the ingestion step', objective: 'Pull raw data into a landing area.', filesToCreate: ['pipeline/ingest/extract.py'], commands: ['pip install pandas requests'], implementationSteps: ['Read from the source (file/API/DB).', 'Write raw output to a landing folder/table.', 'Log row counts.'], expectedOutput: ['Raw data lands and the row count is logged.'], validationSteps: ['Run the ingest step and confirm output files/rows exist.'], commonErrors: ['Schema drift → log and quarantine bad rows instead of crashing.'], commitMessage: 'feat: add data ingestion step', completionCriteria: ['Ingest runs', 'Row counts logged'] }),
        task('stage-data-2', { title: 'Build the transform + quality checks', objective: 'Clean/shape the data and assert quality.', filesToCreate: ['pipeline/transform/model.sql', 'pipeline/transform/checks.py'], commands: [], implementationSteps: ['Transform raw → curated (dedupe, type, join).', 'Add data-quality assertions (not-null, ranges, uniqueness).', 'Fail the run if assertions fail.'], expectedOutput: ['Curated dataset produced; quality checks pass.'], validationSteps: ['Introduce a bad row and confirm the check fails.'], commonErrors: ['Silent nulls → assert not-null on keys.'], commitMessage: 'feat: add transforms and data-quality checks', completionCriteria: ['Transform runs', 'Quality checks enforced'] }),
        task('stage-data-3', { title: 'Orchestrate the pipeline', objective: 'Run the steps on a schedule with retries.', filesToCreate: ['pipeline/orchestration/dag.py'], commands: [], implementationSteps: ['Define a DAG/workflow (Airflow/cron) with ingest → transform → load.', 'Add retries and alerting on failure.'], expectedOutput: ['The full pipeline runs end-to-end from one command/trigger.'], validationSteps: ['Trigger the DAG and confirm all tasks succeed in order.'], commonErrors: ['No idempotency → make steps safe to re-run.'], commitMessage: 'feat: orchestrate the pipeline', completionCriteria: ['End-to-end run succeeds'] }),
      ],
    });
  }

  /* ---- Stage: Model (AI/ML only) ---- */
  if (caps.ml) {
    stages.push({
      id: 'stage-ml', title: 'Model: train, evaluate, serve', goal: 'Train a model, measure it, and serve predictions.', estimatedTime: '6–12 hours', status: 'todo',
      tasks: [
        task('stage-ml-1', { title: 'Prepare the dataset', objective: 'Load and split data reproducibly.', filesToCreate: ['ml/data.py'], commands: ['pip install scikit-learn pandas'], implementationSteps: ['Load the dataset.', 'Split into train/validation/test with a fixed seed.', 'Document the schema.'], expectedOutput: ['Reproducible train/val/test splits.'], validationSteps: ['Re-run and confirm identical splits with the same seed.'], commonErrors: ['Data leakage → split before any fitting/scaling.'], commitMessage: 'feat: add dataset preparation', completionCriteria: ['Reproducible splits'] }),
        task('stage-ml-2', { title: 'Train + evaluate with a metric threshold', objective: 'Train a baseline and record metrics.', filesToCreate: ['ml/train.py', 'ml/evaluate.py'], commands: ['python ml/train.py'], implementationSteps: ['Train a baseline model.', 'Evaluate on the test set (accuracy/F1/etc.).', 'Persist the model artifact and metrics.'], expectedOutput: ['A saved model + a metrics file meeting a stated threshold.'], validationSteps: ['Confirm the metric meets your documented minimum.'], commonErrors: ['Overfitting → check train vs. test gap.'], commitMessage: 'feat: train and evaluate model', completionCriteria: ['Model trained', 'Metric threshold met'] }),
        task('stage-ml-3', { title: 'Serve predictions behind an API', objective: 'Expose the model via FastAPI.', filesToCreate: ['ml/serve.py'], commands: ['pip install fastapi uvicorn', 'uvicorn ml.serve:app --reload'], implementationSteps: ['Load the saved model at startup.', 'Add POST /predict that returns a prediction.', 'Validate the input payload.'], expectedOutput: ['POST /predict returns a prediction for a valid input.'], validationSteps: ['Send a sample payload and confirm a sensible response.'], commonErrors: ['Loading the model per-request → load once at startup.'], commitMessage: 'feat: serve model predictions', completionCriteria: ['/predict works'] }),
      ],
    });
  }

  /* ---- Stage: Frontend / UI ---- */
  if (caps.frontend) {
    stages.push({
      id: 'stage-frontend', title: 'Frontend / UI', goal: `Build the interface users interact with for "${name}".`, estimatedTime: '5–10 hours', status: 'todo',
      tasks: [
        task('stage-frontend-1', { title: 'Scaffold the frontend app', objective: 'A running dev server with the base app shell.', filesToCreate: ['web/index.html', 'web/src/main.jsx', 'web/src/App.jsx'], commands: ['npm create vite@latest web -- --template react', 'cd web && npm install', 'npm run dev'], implementationSteps: ['Scaffold a Vite + React app.', 'Render an app shell with the project name.', 'Confirm the dev server runs.'], expectedOutput: ['The dev server shows the app shell in the browser.'], validationSteps: ['Open the dev URL and confirm the shell renders without console errors.'], commonErrors: ['Wrong Node version → use Node 18+.'], commitMessage: 'feat: scaffold frontend app', completionCriteria: ['Dev server runs', 'App shell renders'] }),
        task('stage-frontend-2', { title: 'Build the primary screen', objective: 'Implement the main user-facing view.', filesToCreate: ['web/src/pages/Home.jsx'], filesToEdit: ['web/src/App.jsx'], commands: [], implementationSteps: ['Identify the main task a user performs.', 'Build the form/list/dashboard for it.', 'Handle loading and empty states.'], expectedOutput: ['The main screen renders with loading and empty states handled.'], validationSteps: ['Interact with the screen; confirm states behave.'], commonErrors: ['Unhandled empty state → show a friendly placeholder.'], commitMessage: 'feat: build primary screen', completionCriteria: ['Primary screen works', 'Empty/loading states handled'] }),
        task('stage-frontend-3', { title: 'Connect the frontend to the API', objective: 'Wire real data from the backend into the UI.', filesToCreate: ['web/src/lib/api.js'], filesToEdit: ['web/src/pages/Home.jsx'], commands: [], implementationSteps: ['Create a small fetch wrapper that reads the API base URL from env.', 'Call the backend create/read endpoints.', 'Render the returned data and surface errors.'], expectedOutput: ['The UI displays data fetched from the backend.'], validationSteps: ['Create a record in the UI and confirm it appears after refresh.'], commonErrors: ['CORS errors → enable CORS on the backend.', 'Hard-coded URLs → read the base URL from env.'], commitMessage: 'feat: connect frontend to API', completionCriteria: ['UI reads/writes via the API'] }),
      ],
    });
  }

  /* ---- Stage: Infrastructure (DevOps / Cloud / Security) ---- */
  if (caps.infra) {
    stages.push({
      id: 'stage-infra', title: 'Infrastructure & pipeline', goal: 'Containerize, define infrastructure as code, and automate the pipeline.', estimatedTime: '6–12 hours', status: 'todo',
      tasks: [
        task('stage-infra-1', { title: 'Containerize the app', objective: 'A reproducible image you can run anywhere.', filesToCreate: ['Dockerfile', '.dockerignore'], commands: [`docker build -t ${slug} .`, `docker run -p 5000:5000 ${slug}`], implementationSteps: ['Write a multi-stage Dockerfile.', 'Add a .dockerignore.', 'Build and run the image locally.'], expectedOutput: ['The container runs and the health check responds.'], validationSteps: ['Hit the health endpoint of the running container.'], commonErrors: ['Huge images → use a slim base + multi-stage build.'], commitMessage: 'feat: containerize the app', completionCriteria: ['Image builds', 'Container runs'] }),
        task('stage-infra-2', { title: 'Define infrastructure as code', objective: 'Provision resources declaratively.', filesToCreate: ['infra/main.tf', 'infra/variables.tf'], commands: ['terraform init', 'terraform validate', 'terraform plan'], implementationSteps: ['Define the minimum resources (compute, network, registry).', 'Use variables for anything environment-specific.', 'Run validate + plan (apply only when ready).'], expectedOutput: ['`terraform plan` produces a clean, reviewable plan.'], validationSteps: ['Run `terraform validate` with no errors.'], commonErrors: ['Hard-coded secrets in tf → use variables / a secrets manager.'], commitMessage: 'feat: add infrastructure as code', completionCriteria: ['terraform validate passes'] }),
        task('stage-infra-3', { title: 'Automate the CI/CD pipeline', objective: 'Build, test, and deploy on every push.', filesToCreate: ['.github/workflows/ci.yml'], commands: [], implementationSteps: ['Add a workflow that installs, lints, tests, and builds.', 'Add a deploy job gated on the main branch.', 'Cache dependencies for speed.'], expectedOutput: ['The pipeline runs green on push and produces a deployable artifact.'], validationSteps: ['Push a commit and confirm the workflow passes.'], commonErrors: ['Secrets in logs → use repository secrets, never echo them.'], commitMessage: 'ci: add build/test/deploy pipeline', completionCriteria: ['Pipeline runs green'] }),
      ],
    });
  }

  /* ---- Stage: Testing & quality (always) ---- */
  stages.push({
    id: 'stage-testing', title: 'Testing & quality', goal: 'Prove the core behavior with automated tests.', estimatedTime: '3–6 hours', status: 'todo',
    tasks: [
      task('stage-testing-1', {
        title: 'Add unit tests for the core logic',
        objective: 'Lock in correct behavior of the most important function/module.',
        filesToCreate: [rt === 'python' ? 'tests/test_core.py' : 'tests/core.test.js'],
        commands: rt === 'node' ? ['npm install -D vitest', 'npx vitest run'] : rt === 'python' ? ['pip install pytest', 'pytest -q'] : ['# run your tests'],
        implementationSteps: ['Pick the most critical pure function/module.', 'Write tests for the happy path and one edge case.', 'Run the tests and make them pass.'],
        expectedOutput: ['At least 2 passing unit tests.'],
        validationSteps: ['Run the test command — all green.'],
        commonErrors: ['Testing implementation details → test observable behavior.'],
        commitMessage: 'test: add unit tests for core logic',
        completionCriteria: ['Unit tests pass'],
      }),
      task('stage-testing-2', {
        title: 'Add one integration / end-to-end test',
        objective: 'Verify the pieces work together.',
        filesToCreate: [rt === 'python' ? 'tests/test_integration.py' : 'tests/integration.test.js'],
        commands: [],
        implementationSteps: [caps.frontend ? 'Test one full user journey (open → act → result).' : 'Test one full request → response → persistence flow.', 'Assert the externally-visible outcome.'],
        expectedOutput: ['One integration/E2E test that exercises the real flow.'],
        validationSteps: ['Run the test against a running app/server.'],
        commonErrors: ['Flaky tests → wait on conditions, not fixed timers.'],
        commitMessage: 'test: add integration test',
        completionCriteria: ['Integration test passes'],
      }),
    ],
  });

  /* ---- Stage: Deployment (always) ---- */
  stages.push({
    id: 'stage-deploy', title: 'Deployment', goal: `Ship "${name}" to a public URL.`, estimatedTime: '2–5 hours', status: 'todo',
    tasks: [
      task('stage-deploy-1', {
        title: 'Deploy to a public environment',
        objective: 'Make the project reachable on the internet.',
        filesToCreate: [],
        commands: [],
        implementationSteps: ['Choose a host (Render/Railway/Fly.io/Vercel/cloud).', 'Set the production environment variables.', 'Deploy the build.', 'Note the public URL.'],
        expectedOutput: ['A public URL that serves the app.'],
        validationSteps: ['Open the public URL and confirm it loads.', 'Hit /api/health on the deployed URL.'],
        commonErrors: ['Missing env vars in prod → set them in the host dashboard.', 'Build works locally but not in prod → check Node/Python versions.'],
        commitMessage: 'chore: configure production deployment',
        completionCriteria: ['Public URL works', 'Health check passes in prod'],
      }),
    ],
  });

  /* ---- Stage: Proof & submission (always) ---- */
  stages.push({
    id: 'stage-proof', title: 'Proof & submission', goal: 'Create recruiter-visible proof and submit it in the workspace.', estimatedTime: '2–4 hours', status: 'todo',
    tasks: [
      task('stage-proof-1', {
        title: 'Write the README with screenshots',
        objective: 'Make the repo self-explanatory and impressive.',
        filesToEdit: ['README.md'],
        commands: [],
        implementationSteps: ['Add overview, stack, architecture, setup, and a demo section.', 'Embed 1–2 screenshots or a short GIF.', 'Add the live URL and repo link.'],
        expectedOutput: ['A complete README a recruiter could skim in 60 seconds.'],
        validationSteps: ['Open the README on GitHub and confirm images render.'],
        commonErrors: ['Broken image paths → use repo-relative or uploaded URLs.'],
        commitMessage: 'docs: complete README with screenshots',
        completionCriteria: ['README complete', 'Screenshots embedded'],
      }),
      task('stage-proof-2', {
        title: 'Submit proof in the Project Workspace',
        objective: 'Attach GitHub + live URL + screenshots so verification can run.',
        filesToCreate: [],
        commands: [],
        implementationSteps: ['Open the Project Workspace → GitHub Sync and paste the repo URL.', 'Open Verification and paste the live demo URL.', 'Upload screenshots in the Proof Checklist.', 'Generate the recruiter summary.'],
        expectedOutput: ['The workspace shows your GitHub score, live verification, and proof score.'],
        validationSteps: ['Confirm the proof score reflects the attached evidence.'],
        commonErrors: ['Marking build tasks complete is NOT proof — you still need real GitHub/live evidence to verify.'],
        commitMessage: '', // this is an in-app action, not a code commit
        completionCriteria: ['GitHub + live URL attached', 'Proof submitted in workspace'],
      }),
    ],
  });

  return stages;
}

/* ------------------------------------------------------------------ *
 * Testing / Deployment / GitHub / Proof sections                      *
 * ------------------------------------------------------------------ */
function buildTestingGuide(project, type, rt) {
  const planned = uniq(project.testingPlan);
  return {
    unitTests: planned.length ? planned.slice(0, 4) : ['Unit-test the core function/module (happy path + one edge case).'],
    integrationTests: [capabilities(type).frontend ? 'One end-to-end user journey.' : 'One request → response → persistence flow.'],
    manualTests: ['Hit /api/health and confirm "ok".', 'Walk the primary user flow by hand once.'],
    commands: rt === 'node' ? ['npx vitest run'] : rt === 'python' ? ['pytest -q'] : ['# run tests'],
    expectedResults: ['All automated tests pass.', 'The manual walk-through succeeds with no console/server errors.'],
  };
}

function buildDeploymentGuide(project, type, rt) {
  const planned = uniq(project.deploymentPlan);
  const caps = capabilities(type);
  return {
    target: caps.infra ? 'Containerized deploy (cloud / Kubernetes)' : caps.frontend && caps.backend ? 'Frontend on Vercel/Netlify, API on Render/Railway' : caps.frontend ? 'Static host (Vercel/Netlify)' : 'Managed host (Render/Railway/Fly.io)',
    services: caps.db ? ['App/API host', 'Managed database'] : caps.infra ? ['Container registry', 'Compute/cluster'] : ['App host'],
    environmentVariables: ['PORT', ...(caps.db ? ['DATABASE_URL'] : []), 'NODE_ENV (or equivalent)'],
    buildCommand: rt === 'node' ? 'npm install && npm run build' : rt === 'python' ? 'pip install -r requirements.txt' : 'make build',
    startCommand: rt === 'node' ? 'node server/index.js' : rt === 'python' ? 'uvicorn server.app:app --host 0.0.0.0 --port $PORT' : './app',
    deploymentSteps: planned.length ? planned : ['Push to the host', 'Set production env vars', 'Deploy', 'Verify the public health check'],
    healthCheckUrl: '/api/health',
    commonDeploymentErrors: ['Missing env vars in production.', 'Wrong runtime version vs. local.', 'Database not reachable from the host (check network/SSL).'],
  };
}

function buildGithubPlan(project, stages) {
  const slug = slugify(project.title);
  const commits = [];
  for (const s of stages) {
    for (const t of arr(s.tasks)) {
      if (!t.commitMessage) continue;
      commits.push({
        stage: s.title,
        message: t.commitMessage,
        filesIncluded: uniq([...(t.filesToCreate || []), ...(t.filesToEdit || [])]),
        proofValue: `Shows you can ${t.title.toLowerCase()} — a concrete, reviewable commit.`,
      });
    }
  }
  return {
    repoName: slug,
    branchStrategy: 'Trunk-based: short-lived feature branches → PR → merge into main. Keep commits small and meaningful.',
    commits,
    suggestedIssues: stages.map((s) => `${s.title}: ${s.goal}`),
  };
}

function buildProofSubmission(project) {
  const innovation = obj(project.innovation);
  const required = ['Public GitHub repository with meaningful commit history', 'A complete README (overview, setup, architecture, demo)', 'Working deployment at a public URL'];
  if (uniq(innovation.evidenceChecklist).length) required.push(...uniq(innovation.evidenceChecklist).slice(0, 3));
  return {
    requiredEvidence: uniq(required),
    optionalEvidence: ['Screenshots or a short demo GIF', 'A LinkedIn "build in public" post', 'Test coverage / CI badge'],
    verificationChecklist: [
      'Run GitHub Sync in the Project Workspace and confirm a score.',
      'Run live-link Verification and confirm the URL is reachable.',
      'Confirm the proof score reflects the attached evidence.',
    ],
    resumeUnlockConditions: [
      'Verified resume bullets require REAL proof — a synced GitHub repo and/or a verified live demo — not just checked-off build tasks.',
      'Build progress measures execution; proof verification measures evidence. They are tracked separately.',
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Architecture- & pattern-driven enrichment                           *
 * ------------------------------------------------------------------ *
 * Makes the guide truly project-specific by:
 *   1. detecting the project pattern (keyword library),
 *   2. extracting explicit architecture (components/APIs/entities/deploy),
 *   3. filling missing categories from the pattern,
 *   4. converting all of that into concrete tasks,
 *   5. injecting them into the right stages, deduped, with generic
 *      backbone tasks superseded by the specific ones.
 */
function normTitleKey(title = '') {
  return String(title)
    .toLowerCase()
    .replace(/^\s*(create|build|implement|add|setup|set up|configure|deploy|make)\b/, '')
    .replace(/\b(the|a|an|backend|frontend|core|primary)\b/g, ' ')
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function dedupeTasks(tasks) {
  const byId = new Set();
  const byTitle = new Set();
  const out = [];
  for (const t of arr(tasks)) {
    if (!t || !t.id) continue;
    if (byId.has(t.id)) continue;
    const tk = normTitleKey(t.title);
    if (tk && byTitle.has(tk)) continue;
    byId.add(t.id);
    if (tk) byTitle.add(tk);
    out.push(t);
  }
  return out;
}

const STAGE_ORDER = ['stage-setup', 'stage-backend', 'stage-data', 'stage-ml', 'stage-frontend', 'stage-infra', 'stage-testing', 'stage-deploy', 'stage-proof'];

function findStage(stages, id) { return stages.find((s) => s.id === id) || null; }

function enrichWithArchitecture(stages, project, type, rt) {
  const slugName = slugify(project.title);
  const explicit = safeNormalizeArchitecture(project);
  const det = safeDetectPattern(project);
  const pat = det.pattern;
  const architectureBacked = safeHasArchitecture(project);

  // Effective architecture: explicit wins; otherwise fall back to the pattern's
  // suggestions so even keyword-only projects become specific.
  const eff = {
    components: explicit.components.length ? explicit.components : (pat ? arr(pat.suggestedComponents) : []),
    screens: explicit.screens,
    apis: explicit.apis.length ? explicit.apis : (pat ? arr(pat.suggestedApis) : []),
    entities: explicit.entities.length ? explicit.entities : (pat ? arr(pat.suggestedEntities) : []),
    deployment: explicit.deployment,
  };

  let grouped = { frontend: [], backend: [], deploy: [], all: [] };
  try { grouped = architectureToTasks(eff, { slug: slugName, type, rt }); }
  catch { grouped = { frontend: [], backend: [], deploy: [], all: [] }; }

  let nextStages = stages.map((s) => ({ ...s, tasks: arr(s.tasks).slice() }));

  const ensureStage = (id, def) => {
    let s = findStage(nextStages, id);
    if (!s) { s = { id, ...def, tasks: [] }; nextStages.push(s); }
    return s;
  };

  // Inject backend tasks (models + APIs + backend services).
  if (grouped.backend.length) {
    const s = ensureStage('stage-backend', { title: 'Backend foundation', goal: `Stand up the API that powers "${str(project.title, 'the project')}".`, estimatedTime: '4–8 hours', status: 'todo' });
    // health task (if present) stays first; specifics follow.
    s.tasks = s.tasks.concat(grouped.backend);
    // Supersede generic backbone tasks with the specific ones.
    if (grouped.backend.some((t) => t.id.startsWith('arch-api-'))) s.tasks = s.tasks.filter((t) => t.id !== 'stage-backend-3');
    if (grouped.backend.some((t) => t.id.startsWith('arch-model-'))) s.tasks = s.tasks.filter((t) => t.id !== 'stage-backend-2');
  }

  // Inject frontend component tasks.
  if (grouped.frontend.length) {
    const s = ensureStage('stage-frontend', { title: 'Frontend / UI', goal: `Build the interface users interact with for "${str(project.title, 'the project')}".`, estimatedTime: '5–10 hours', status: 'todo' });
    s.tasks = s.tasks.concat(grouped.frontend);
    if (grouped.frontend.length) s.tasks = s.tasks.filter((t) => t.id !== 'stage-frontend-2');
  }

  // Inject deployment tasks.
  if (grouped.deploy.length) {
    const s = ensureStage('stage-deploy', { title: 'Deployment', goal: `Ship "${str(project.title, 'the project')}" to a public URL.`, estimatedTime: '2–5 hours', status: 'todo' });
    s.tasks = s.tasks.concat(grouped.deploy);
    s.tasks = s.tasks.filter((t) => t.id !== 'stage-deploy-1');
  }

  // Dedupe each stage and drop any now-empty injected stage.
  nextStages = nextStages.map((s) => ({ ...s, tasks: dedupeTasks(s.tasks) })).filter((s) => s.tasks.length > 0);

  // Stable ordering.
  nextStages.sort((a, b) => {
    const ia = STAGE_ORDER.indexOf(a.id); const ib = STAGE_ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  // Metadata for the UI.
  const generatedFrom = ['Project context'];
  if (architectureBacked) generatedFrom.unshift('Architecture');
  if (obj(project.blueprint) && Object.keys(obj(project.blueprint)).length) generatedFrom.push('Blueprint');
  if (pat && det.score > 0) generatedFrom.push(`Pattern: ${pat.label}`);

  const patternMatched = !!(pat && det.score > 0);
  const confidence = (architectureBacked && patternMatched) ? 'High' : (architectureBacked || patternMatched) ? 'Medium' : 'Low';

  const missingInputs = [];
  if (!explicit.components.length) missingInputs.push('No architecture components found');
  if (!explicit.apis.length) missingInputs.push('No API design found');
  if (!explicit.entities.length) missingInputs.push('No database schema found');
  if (!(explicit.deployment.frontend || explicit.deployment.backend || explicit.deployment.database || explicit.deployment.steps.length)) missingInputs.push('No deployment target found');

  const architectureInputs = {
    components: arr(eff.components).map((c) => str(typeof c === 'string' ? c : (c && c.name))).filter(Boolean),
    apis: arr(eff.apis).map((a) => (a && a.path ? `${(a.method || 'POST')} ${a.path}` : str(a))).filter(Boolean),
    entities: arr(eff.entities).map((e) => str(typeof e === 'string' ? e : (e && e.entity))).filter(Boolean),
    deployment: [eff.deployment.frontend, eff.deployment.backend, eff.deployment.database].filter(Boolean),
  };

  const meta = {
    architectureBacked,
    pattern: patternMatched ? { id: pat.id, label: pat.label } : null,
    patternConfidence: confidence,
    confidence,
    generatedFrom,
    missingInputs,
    architectureInputs,
    commonProofItems: patternMatched ? arr(pat.commonProofItems) : [],
  };

  return { stages: nextStages, meta };
}

/* Defensive wrappers so a throwing/edge-case import never breaks generation. */
function safeNormalizeArchitecture(project) {
  try {
    const a = normalizeArchitecture(project) || {};
    return {
      components: arr(a.components), screens: arr(a.screens), apis: arr(a.apis),
      entities: arr(a.entities), deployment: a.deployment || { frontend: '', backend: '', database: '', steps: [] },
    };
  } catch {
    return { components: [], screens: [], apis: [], entities: [], deployment: { frontend: '', backend: '', database: '', steps: [] } };
  }
}
function safeDetectPattern(project) {
  try { return detectPattern(project) || { pattern: null, score: 0, matched: [] }; }
  catch { return { pattern: null, score: 0, matched: [] }; }
}
function safeHasArchitecture(project) {
  try { return !!hasArchitectureData(project); } catch { return false; }
}

/* ------------------------------------------------------------------ *
 * Progress                                                            *
 * ------------------------------------------------------------------ */
export function emptyProgress() {
  return { prerequisites: {}, tasks: {}, stages: {}, currentStageId: null, updatedAt: null };
}

/* Apply a saved progress map onto a freshly-generated guide (sets statuses). */
function applyProgress(guide, progress) {
  const p = obj(progress);
  const pre = obj(p.prerequisites);
  const tk = obj(p.tasks);
  const stg = obj(p.stages);
  guide.prerequisites = arr(guide.prerequisites).map((q) => ({ ...q, completed: q.name in pre ? !!pre[q.name] : !!q.completed }));
  for (const s of arr(guide.stages)) {
    for (const t of arr(s.tasks)) {
      if (t.id in tk) t.status = tk[t.id] ? 'done' : 'todo';
    }
    const tasks = arr(s.tasks);
    const explicit = s.id in stg ? !!stg[s.id] : null;
    const allTasksDone = tasks.length > 0 && tasks.every((t) => t.status === 'done');
    if (explicit === true || allTasksDone) s.status = 'done';
    else if (tasks.some((t) => t.status === 'done')) s.status = 'in_progress';
    else s.status = 'todo';
  }
  return guide;
}

/* Pure progress math used by the UI header and the PATCH route. */
export function computeProgress(guide) {
  const stages = arr(guide && guide.stages);
  let total = 0;
  let done = 0;
  let stagesDone = 0;
  let currentStage = null;
  let nextTask = null;
  for (const s of stages) {
    const tasks = arr(s.tasks);
    const sDone = tasks.length > 0 && tasks.every((t) => t.status === 'done');
    if (sDone) stagesDone += 1;
    for (const t of tasks) {
      total += 1;
      if (t.status === 'done') done += 1;
      else if (!nextTask) { nextTask = t; if (!currentStage) currentStage = s; }
    }
  }
  if (!currentStage) currentStage = stages[stages.length - 1] || null;
  const progressPercent = total ? Math.round((done / total) * 100) : 0;
  const nextAction = nextTask
    ? `Next action: ${nextTask.title}.`
    : (total ? 'All build tasks complete — submit your proof in the Project Workspace.' : 'Generate the build guide to see your next action.');
  return {
    completedTasks: done,
    totalTasks: total,
    completedStages: stagesDone,
    totalStages: stages.length,
    progressPercent: clamp(progressPercent, 0, 100),
    currentStageId: currentStage ? currentStage.id : null,
    currentStageTitle: currentStage ? currentStage.title : '—',
    nextAction,
  };
}

/* Immutable progress updates (used by the UI checkboxes + PATCH route). */
export function setTaskProgress(progress, taskId, done) {
  const p = { ...emptyProgress(), ...obj(progress) };
  p.tasks = { ...obj(p.tasks), [String(taskId)]: !!done };
  p.updatedAt = new Date().toISOString();
  return p;
}
export function setPrerequisiteProgress(progress, name, done) {
  const p = { ...emptyProgress(), ...obj(progress) };
  p.prerequisites = { ...obj(p.prerequisites), [String(name)]: !!done };
  p.updatedAt = new Date().toISOString();
  return p;
}
export function setStageProgress(progress, stageId, done, taskIds = []) {
  const p = { ...emptyProgress(), ...obj(progress) };
  p.stages = { ...obj(p.stages), [String(stageId)]: !!done };
  const tasks = { ...obj(p.tasks) };
  for (const id of arr(taskIds)) tasks[String(id)] = !!done;
  p.tasks = tasks;
  p.updatedAt = new Date().toISOString();
  return p;
}

/* ------------------------------------------------------------------ *
 * Public API: generate + validate + normalize + markdown              *
 * ------------------------------------------------------------------ */
export function generateBuildGuide(project, options = {}) {
  const p = obj(project);
  const type = inferType(p);
  const rt = runtime(p, type);
  const backbone = buildStages(p, type, rt);

  // Make the guide project-specific: detect the pattern, pull in architecture
  // (explicit or pattern-inferred), and inject concrete tasks + metadata.
  const enriched = enrichWithArchitecture(backbone, p, type, rt);
  const stages = enriched.stages;
  const meta = enriched.meta;

  // v3: attach code-level guidance to every task, then strip internal hints.
  const domain = detectDomain(p, meta.pattern && meta.pattern.id);
  const apiStrings = arr(meta.architectureInputs && meta.architectureInputs.apis);
  for (const s of stages) {
    s.tasks = arr(s.tasks).map((t) => {
      const taskType = classifyTaskType(t);
      let codeLevelGuide;
      try { codeLevelGuide = buildCodeLevelGuide({ ...t, taskType }, { project: p, type, rt, domain, apis: apiStrings }); }
      catch { codeLevelGuide = normalizeCodeLevelGuide(null); }
      const out = { ...t, taskType, codeLevelGuide };
      delete out._api; delete out._entity; delete out._component; delete out._componentBucket; delete out._bucket;
      return out;
    });
  }

  const proof = buildProofSubmission(p);
  if (meta.commonProofItems && meta.commonProofItems.length) {
    proof.requiredEvidence = uniq([...proof.requiredEvidence, ...meta.commonProofItems]);
  }

  let guide = {
    projectId: str(p.id || p.projectId, ''),
    title: str(p.title, 'Untitled project'),
    summary: str(p.summary || p.useCase || p.problemStatement, `A ${type} project that produces recruiter-visible proof of work.`).slice(0, 280),
    targetRole: str(p.targetRole || p.role, 'Software Engineer'),
    difficulty: str(p.difficulty, 'Intermediate'),
    estimatedDuration: str(p.duration || p.estimatedDuration, '1 week'),
    type,
    currentStage: '',
    progressPercent: 0,
    nextAction: '',
    // architecture / pattern metadata (used by the Builder UI badges + inputs panel)
    architectureBacked: meta.architectureBacked,
    pattern: meta.pattern,
    confidence: meta.confidence,
    generatedFrom: meta.generatedFrom,
    missingInputs: meta.missingInputs,
    architectureInputs: meta.architectureInputs,
    codeLevelConfidence: meta.confidence,
    prerequisites: buildPrerequisites(p, type, rt),
    setup: buildSetup(p, type, rt),
    stages,
    testingGuide: buildTestingGuide(p, type, rt),
    deploymentGuide: buildDeploymentGuide(p, type, rt),
    githubPlan: buildGithubPlan(p, stages),
    proofSubmission: proof,
    exportFormats: ['markdown', 'json'],
    generatedBy: meta.architectureBacked ? 'architecture-backed' : (meta.pattern ? 'pattern+deterministic' : 'deterministic'),
  };

  guide = applyProgress(guide, options.progress);
  const prog = computeProgress(guide);
  guide.progressPercent = prog.progressPercent;
  guide.currentStage = prog.currentStageTitle;
  guide.currentStageId = prog.currentStageId;
  guide.nextAction = prog.nextAction;
  guide.progress = prog;
  return guide;
}

/* Shape validation for AI-sourced guides. Returns true only for a usable guide. */
export function validateBuildGuide(guide) {
  if (!guide || typeof guide !== 'object' || isArr(guide)) return false;
  if (!isArr(guide.stages) || guide.stages.length === 0) return false;
  for (const s of guide.stages) {
    if (!s || typeof s !== 'object') return false;
    if (!isArr(s.tasks)) return false;
    for (const t of s.tasks) {
      if (!t || typeof t !== 'object' || !t.id || !t.title) return false;
    }
  }
  return true;
}

/* Defensive normalizer — guarantees the full shape so the UI never crashes,
   even on a partial/malformed object (e.g. from an AI provider or old cache). */
export function normalizeBuildGuide(guide, project = {}) {
  if (!validateBuildGuide(guide)) return generateBuildGuide(project);
  const g = obj(guide);
  const stages = arr(g.stages).map((s, si) => ({
    id: str(s.id, `stage-${si}`),
    title: str(s.title, `Stage ${si + 1}`),
    goal: str(s.goal),
    estimatedTime: str(s.estimatedTime),
    status: str(s.status, 'todo'),
    tasks: arr(s.tasks).map((t, ti) => {
      const base = {
        id: str(t.id, `stage-${si}-${ti}`),
        title: str(t.title, `Task ${ti + 1}`),
        objective: str(t.objective),
        taskType: str(t.taskType) || classifyTaskType(t),
        filesToCreate: arr(t.filesToCreate).map(str),
        filesToEdit: arr(t.filesToEdit).map(str),
        commands: arr(t.commands).map(str),
        implementationSteps: arr(t.implementationSteps).map(str),
        expectedOutput: arr(t.expectedOutput).map(str),
        validationSteps: arr(t.validationSteps).map(str),
        commonErrors: arr(t.commonErrors).map(str),
        commitMessage: str(t.commitMessage),
        completionCriteria: arr(t.completionCriteria).map(str),
        status: str(t.status, 'todo'),
      };
      // Old guides may lack codeLevelGuide — synthesize one so the UI is consistent.
      base.codeLevelGuide = t.codeLevelGuide
        ? normalizeCodeLevelGuide(t.codeLevelGuide)
        : (() => { try { return buildCodeLevelGuide(base, {}); } catch { return normalizeCodeLevelGuide(null); } })();
      return base;
    }),
  }));
  const setup = obj(g.setup);
  const testing = obj(g.testingGuide);
  const deploy = obj(g.deploymentGuide);
  const gh = obj(g.githubPlan);
  const proof = obj(g.proofSubmission);
  const out = {
    projectId: str(g.projectId),
    title: str(g.title, 'Untitled project'),
    summary: str(g.summary),
    targetRole: str(g.targetRole, 'Software Engineer'),
    difficulty: str(g.difficulty, 'Intermediate'),
    estimatedDuration: str(g.estimatedDuration, '1 week'),
    type: str(g.type, 'Full Stack'),
    currentStage: str(g.currentStage),
    progressPercent: clamp(Number(g.progressPercent) || 0, 0, 100),
    nextAction: str(g.nextAction),
    architectureBacked: !!g.architectureBacked,
    pattern: (g.pattern && typeof g.pattern === 'object') ? { id: str(g.pattern.id), label: str(g.pattern.label) } : null,
    confidence: ['High', 'Medium', 'Low'].includes(g.confidence) ? g.confidence : 'Low',
    codeLevelConfidence: ['High', 'Medium', 'Low'].includes(g.codeLevelConfidence) ? g.codeLevelConfidence : (['High', 'Medium', 'Low'].includes(g.confidence) ? g.confidence : 'Low'),
    generatedFrom: arr(g.generatedFrom).map(str).filter(Boolean),
    missingInputs: arr(g.missingInputs).map(str).filter(Boolean),
    architectureInputs: {
      components: arr(g.architectureInputs && g.architectureInputs.components).map(str).filter(Boolean),
      apis: arr(g.architectureInputs && g.architectureInputs.apis).map(str).filter(Boolean),
      entities: arr(g.architectureInputs && g.architectureInputs.entities).map(str).filter(Boolean),
      deployment: arr(g.architectureInputs && g.architectureInputs.deployment).map(str).filter(Boolean),
    },
    prerequisites: arr(g.prerequisites).map((q) => ({
      name: str(q.name), description: str(q.description), required: !!q.required,
      checkCommand: str(q.checkCommand), installLink: str(q.installLink), completed: !!q.completed,
    })),
    setup: {
      overview: str(setup.overview),
      commands: arr(setup.commands).map(str),
      folderStructure: arr(setup.folderStructure).map(str),
      environmentVariables: arr(setup.environmentVariables).map(str),
      expectedOutput: arr(setup.expectedOutput).map(str),
    },
    stages,
    testingGuide: {
      unitTests: arr(testing.unitTests).map(str),
      integrationTests: arr(testing.integrationTests).map(str),
      manualTests: arr(testing.manualTests).map(str),
      commands: arr(testing.commands).map(str),
      expectedResults: arr(testing.expectedResults).map(str),
    },
    deploymentGuide: {
      target: str(deploy.target),
      services: arr(deploy.services).map(str),
      environmentVariables: arr(deploy.environmentVariables).map(str),
      buildCommand: str(deploy.buildCommand),
      startCommand: str(deploy.startCommand),
      deploymentSteps: arr(deploy.deploymentSteps).map(str),
      healthCheckUrl: str(deploy.healthCheckUrl, '/api/health'),
      commonDeploymentErrors: arr(deploy.commonDeploymentErrors).map(str),
    },
    githubPlan: {
      repoName: str(gh.repoName, slugify(g.title)),
      branchStrategy: str(gh.branchStrategy),
      commits: arr(gh.commits).map((c) => ({
        stage: str(c.stage), message: str(c.message),
        filesIncluded: arr(c.filesIncluded).map(str), proofValue: str(c.proofValue),
      })),
      suggestedIssues: arr(gh.suggestedIssues).map(str),
    },
    proofSubmission: {
      requiredEvidence: arr(proof.requiredEvidence).map(str),
      optionalEvidence: arr(proof.optionalEvidence).map(str),
      verificationChecklist: arr(proof.verificationChecklist).map(str),
      resumeUnlockConditions: arr(proof.resumeUnlockConditions).map(str),
    },
    exportFormats: arr(g.exportFormats).map(str).length ? arr(g.exportFormats).map(str) : ['markdown', 'json'],
    generatedBy: str(g.generatedBy, 'deterministic'),
  };
  const prog = computeProgress(out);
  out.progressPercent = prog.progressPercent;
  out.currentStage = prog.currentStageTitle;
  out.currentStageId = prog.currentStageId;
  out.nextAction = prog.nextAction;
  out.progress = prog;
  return out;
}

/* ------------------------------------------------------------------ *
 * Markdown export                                                     *
 * ------------------------------------------------------------------ */
function bullets(list, prefix = '- ') {
  return arr(list).map((x) => `${prefix}${str(x)}`).join('\n');
}

export function buildGuideToMarkdown(guide) {
  const g = normalizeBuildGuide(guide, {});
  const L = [];
  L.push(`# Build Guide — ${g.title}`, '');
  L.push(`> ${g.summary}`, '');
  L.push(`**Target role:** ${g.targetRole}  ·  **Difficulty:** ${g.difficulty}  ·  **Duration:** ${g.estimatedDuration}  ·  **Type:** ${g.type}`, '');
  L.push(`**Progress:** ${g.progressPercent}% — ${g.nextAction}`, '');

  L.push('## 1. Prerequisites', '');
  for (const q of g.prerequisites) {
    L.push(`- **${q.name}**${q.required ? ' (required)' : ' (optional)'} — ${q.description}`);
    if (q.checkCommand) L.push(`  - Check: \`${q.checkCommand}\``);
    if (q.installLink) L.push(`  - Install: ${q.installLink}`);
  }
  L.push('');

  L.push('## 2. Local setup', '');
  if (g.setup.overview) L.push(g.setup.overview, '');
  if (g.setup.commands.length) { L.push('**Commands**', '', '```bash', ...g.setup.commands, '```', ''); }
  if (g.setup.folderStructure.length) { L.push('**Folder structure**', '', '```', ...g.setup.folderStructure, '```', ''); }
  if (g.setup.environmentVariables.length) { L.push('**Environment variables**', '', '```', ...g.setup.environmentVariables, '```', ''); }
  if (g.setup.expectedOutput.length) { L.push('**Expected output**', bullets(g.setup.expectedOutput), ''); }

  L.push('## 3. Implementation roadmap', '');
  g.stages.forEach((s, i) => L.push(`${i + 1}. **${s.title}** — ${s.goal} _(${s.estimatedTime || 'n/a'})_`));
  L.push('');

  L.push('## 4. Step-by-step tasks', '');
  for (const s of g.stages) {
    L.push(`### ${s.title}`, '');
    if (s.goal) L.push(`_Goal: ${s.goal}_`, '');
    for (const t of s.tasks) {
      L.push(`#### Task: ${t.title}`, '');
      if (t.taskType) L.push(`_Type: ${t.taskType}_`, '');
      if (t.objective) L.push(`**Goal:** ${t.objective}`, '');
      if (t.filesToCreate.length) L.push('**Files to create:**', bullets(t.filesToCreate), '');
      if (t.filesToEdit.length) L.push('**Files to edit:**', bullets(t.filesToEdit), '');
      if (t.commands.length) L.push('**Commands:**', '', '```bash', ...t.commands, '```', '');
      if (t.implementationSteps.length) L.push('**Implementation:**', t.implementationSteps.map((x, i) => `${i + 1}. ${str(x)}`).join('\n'), '');
      // v3 — code-level guidance
      const clg = t.codeLevelGuide;
      if (clg && typeof clg === 'object') {
        if (clg.overview) L.push('**Code-level overview:**', clg.overview, '');
        if (arr(clg.filePlans).length) {
          L.push('**File plan:**', '');
          for (const fp of clg.filePlans) {
            L.push(`- \`${str(fp.path)}\`${fp.purpose ? ` — ${str(fp.purpose)}` : ''}`);
            if (arr(fp.responsibilities).length) L.push(`  - Responsibilities: ${fp.responsibilities.join('; ')}`);
          }
          L.push('');
        }
        const c = clg.apiContract;
        if (c) {
          L.push('**API contract:**', '', '```', `${str(c.method)} ${str(c.path)}`, `Request: ${str(c.requestBody)}`, `Response: ${str(c.responseBody)}`, '```', '');
          if (arr(c.validationRules).length) L.push('Validation:', bullets(c.validationRules), '');
          if (arr(c.errorCases).length) L.push('Error cases:', bullets(c.errorCases), '');
        }
        const db = clg.databaseSchema;
        if (db) {
          L.push('**Database schema:**', `Entity: \`${str(db.entity)}\``, '');
          if (arr(db.fields).length) L.push('Fields:', bullets(db.fields), '');
          if (db.sampleDocument && Object.keys(db.sampleDocument).length) L.push('Sample document:', '', '```json', JSON.stringify(db.sampleDocument, null, 2), '```', '');
          if (arr(db.indexes).length) L.push(`Indexes: ${db.indexes.join(', ')}`, '');
          if (db.relationship) L.push(`Relationships: ${str(db.relationship)}`, '');
        }
        const fe = clg.frontendGuide;
        if (fe) {
          L.push('**Frontend guide:**', `Component: \`${str(fe.componentName)}\``, '');
          if (arr(fe.state).length) L.push(`State: ${fe.state.join(', ')}`, '');
          if (arr(fe.apiCalls).length) L.push('API calls:', bullets(fe.apiCalls), '');
          L.push(`States — loading: ${str(fe.loadingState)}; empty: ${str(fe.emptyState)}; error: ${str(fe.errorState)}; success: ${str(fe.successState)}`, '');
        }
        const be = clg.backendGuide;
        if (be && arr(be.businessLogicSteps).length) {
          L.push('**Backend logic:**', be.businessLogicSteps.map((x, i) => `${i + 1}. ${str(x)}`).join('\n'), '');
          if (arr(be.edgeCases).length) L.push('Edge cases:', bullets(be.edgeCases), '');
        }
        const tg = clg.testGuide;
        if (tg && arr(tg.curlCommands).length) L.push('**Test (curl):**', '', '```bash', ...tg.curlCommands, '```', '');
        if (tg && arr(tg.expectedResults).length) L.push('Expected:', bullets(tg.expectedResults), '');
        const dv = clg.devopsGuide;
        if (dv) {
          if (arr(dv.envVars).length) L.push(`**Env vars:** ${dv.envVars.join(', ')}`, '');
          if (dv.healthCheck) L.push(`**Health check:** ${str(dv.healthCheck)}`, '');
        }
      }
      if (t.expectedOutput.length) L.push('**Expected output:**', bullets(t.expectedOutput), '');
      if (t.validationSteps.length) L.push('**Validation:**', bullets(t.validationSteps), '');
      if (t.commonErrors.length) L.push('**Common errors:**', bullets(t.commonErrors), '');
      if (t.commitMessage) L.push('**Commit:**', '', '```bash', `git commit -m "${t.commitMessage}"`, '```', '');
      if (t.completionCriteria.length) L.push('**Done when:**', bullets(t.completionCriteria), '');
    }
  }

  L.push('## 5. Testing guide', '');
  if (g.testingGuide.unitTests.length) L.push('**Unit tests:**', bullets(g.testingGuide.unitTests), '');
  if (g.testingGuide.integrationTests.length) L.push('**Integration tests:**', bullets(g.testingGuide.integrationTests), '');
  if (g.testingGuide.manualTests.length) L.push('**Manual tests:**', bullets(g.testingGuide.manualTests), '');
  if (g.testingGuide.commands.length) L.push('**Commands:**', '', '```bash', ...g.testingGuide.commands, '```', '');
  if (g.testingGuide.expectedResults.length) L.push('**Expected results:**', bullets(g.testingGuide.expectedResults), '');

  L.push('## 6. Deployment guide', '');
  L.push(`**Target:** ${g.deploymentGuide.target}`);
  if (g.deploymentGuide.services.length) L.push(`**Services:** ${g.deploymentGuide.services.join(', ')}`);
  if (g.deploymentGuide.environmentVariables.length) L.push(`**Env vars:** ${g.deploymentGuide.environmentVariables.join(', ')}`);
  if (g.deploymentGuide.buildCommand) L.push(`**Build:** \`${g.deploymentGuide.buildCommand}\``);
  if (g.deploymentGuide.startCommand) L.push(`**Start:** \`${g.deploymentGuide.startCommand}\``);
  if (g.deploymentGuide.healthCheckUrl) L.push(`**Health check:** \`${g.deploymentGuide.healthCheckUrl}\``);
  if (g.deploymentGuide.deploymentSteps.length) L.push('', '**Steps:**', bullets(g.deploymentGuide.deploymentSteps));
  if (g.deploymentGuide.commonDeploymentErrors.length) L.push('', '**Common errors:**', bullets(g.deploymentGuide.commonDeploymentErrors));
  L.push('');

  L.push('## 7. GitHub commit plan', '');
  L.push(`**Repo:** ${g.githubPlan.repoName}`);
  if (g.githubPlan.branchStrategy) L.push(`**Branch strategy:** ${g.githubPlan.branchStrategy}`);
  L.push('');
  for (const c of g.githubPlan.commits) {
    L.push(`- \`${c.message}\` — _${c.stage}_${c.filesIncluded.length ? ` (${c.filesIncluded.join(', ')})` : ''}`);
  }
  L.push('');

  L.push('## 8. Proof submission checklist', '');
  if (g.proofSubmission.requiredEvidence.length) L.push('**Required evidence:**', bullets(g.proofSubmission.requiredEvidence), '');
  if (g.proofSubmission.optionalEvidence.length) L.push('**Optional evidence:**', bullets(g.proofSubmission.optionalEvidence), '');
  if (g.proofSubmission.verificationChecklist.length) L.push('**Verification:**', bullets(g.proofSubmission.verificationChecklist), '');

  L.push('## 9. Resume bullet unlock conditions', '');
  L.push(bullets(g.proofSubmission.resumeUnlockConditions), '');

  return L.join('\n');
}

export default {
  generateBuildGuide,
  normalizeBuildGuide,
  validateBuildGuide,
  computeProgress,
  emptyProgress,
  setTaskProgress,
  setPrerequisiteProgress,
  setStageProgress,
  buildGuideToMarkdown,
  slugify,
};
