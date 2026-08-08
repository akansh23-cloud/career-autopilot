// Career Project Studio — project generation.
// A rich DETERMINISTIC generator always works offline. Server AI endpoints
// (/api/projects/*) enhance the output when available; on any failure we fall
// back to the deterministic output so the UI never breaks.

import { api } from './api.js';
import { uid } from './projectStore.js';
import { generateMermaid } from './architecture.js';

export const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
export const DURATIONS = ['Weekend', '1 week', '2 weeks', '1 month'];
export const TYPES = ['Frontend', 'Backend', 'Full Stack', 'DevOps', 'Data', 'AI/ML', 'Cloud', 'Cybersecurity'];

const dedupe = (arr) => Array.from(new Set((arr || []).map((s) => String(s).trim()).filter(Boolean)));
const titleCase = (s = '') => s.replace(/\b\w/g, (c) => c.toUpperCase());

/* infer a project type from skills/role when the user hasn't chosen one */
export function inferType(skills = [], role = '') {
  const hay = (skills.join(' ') + ' ' + role).toLowerCase();
  const has = (...k) => k.some((x) => hay.includes(x));
  if (has('terraform', 'kubernetes', 'k8s', 'docker', 'ci/cd', 'cicd', 'jenkins', 'ansible', 'devops')) return 'DevOps';
  if (has('aws', 'azure', 'gcp', 'cloud', 'eks', 'lambda', 's3', 'serverless')) return 'Cloud';
  if (has('tensorflow', 'pytorch', 'ml', 'machine learning', 'nlp', 'llm', 'model', 'ai')) return 'AI/ML';
  if (has('spark', 'hadoop', 'etl', 'airflow', 'snowflake', 'data pipeline', 'iceberg', 'warehouse')) return 'Data';
  if (has('security', 'pentest', 'owasp', 'siem', 'vulnerability', 'cyber')) return 'Cybersecurity';
  if (has('react', 'vue', 'angular', 'frontend', 'css', 'tailwind', 'ui')) return 'Frontend';
  if (has('node', 'express', 'spring', 'django', 'api', 'backend', 'postgres', 'mongodb')) return 'Backend';
  return 'Full Stack';
}

const PRESETS = {
  Frontend: {
    stack: ['React', 'Vite', 'TypeScript', 'Tailwind CSS', 'React Query', 'Vitest', 'Playwright'],
    architecture: 'Component-driven SPA with a typed API layer, client-side routing, state via hooks/React Query, and a design-system of reusable accessible components.',
    deployment: ['Build static bundle (Vite)', 'Deploy to Vercel/Netlify', 'Configure preview deploys per PR', 'Add Lighthouse CI budget'],
    testing: ['Unit tests for components (Vitest + Testing Library)', 'Accessibility checks (axe)', 'E2E happy paths (Playwright)'],
    db: null,
  },
  Backend: {
    stack: ['Node.js', 'Express', 'PostgreSQL', 'Prisma', 'JWT Auth', 'Zod', 'Jest', 'Swagger/OpenAPI'],
    architecture: 'Layered REST API (routes → controllers → services → repository) with input validation, auth middleware, structured logging, and a relational database accessed through an ORM.',
    deployment: ['Containerise with Docker', 'Provision managed Postgres', 'Deploy to Render/Railway/Fly.io', 'Add health checks + log drains'],
    testing: ['Unit tests for services (Jest)', 'Integration tests against a test DB', 'Contract tests for the OpenAPI spec'],
    db: ['users(id, email, password_hash, role, created_at)', 'items(id, user_id FK, title, status, created_at)', 'audit_log(id, user_id FK, action, meta jsonb, ts)'],
  },
  'Full Stack': {
    stack: ['React', 'TypeScript', 'Node.js', 'Express', 'PostgreSQL', 'Prisma', 'Tailwind CSS', 'JWT', 'Docker'],
    architecture: 'Monorepo with a React client and an Express API sharing TypeScript types. Auth via JWT, a relational DB through Prisma, and a CI pipeline that builds, tests and deploys both apps.',
    deployment: ['Dockerise client + API', 'Deploy API to Render, client to Vercel', 'Wire env-based API URLs', 'Add CI/CD with GitHub Actions'],
    testing: ['Frontend unit + a11y tests', 'API integration tests', 'One full E2E user journey (Playwright)'],
    db: ['users(id, email, password_hash, name, created_at)', 'projects(id, user_id FK, title, body, status)', 'comments(id, project_id FK, user_id FK, text, created_at)'],
  },
  DevOps: {
    stack: ['Docker', 'Kubernetes', 'Terraform', 'GitHub Actions', 'Helm', 'Prometheus', 'Grafana', 'AWS EKS'],
    architecture: 'A sample app packaged as a container, infrastructure defined as code (Terraform), deployed to a managed Kubernetes cluster via Helm, with a CI/CD pipeline and observability stack.',
    deployment: ['Terraform provisions VPC + EKS', 'GitHub Actions builds + pushes image to ECR', 'Helm chart deploys to cluster', 'Prometheus/Grafana for metrics, alerts on SLOs'],
    testing: ['terraform validate + plan in CI', 'Container image scan (Trivy)', 'Smoke test after deploy', 'Rollback drill'],
    db: null,
  },
  Data: {
    stack: ['Python', 'Apache Airflow', 'Apache Spark', 'PostgreSQL', 'dbt', 'Pandas', 'Great Expectations', 'Docker'],
    architecture: 'A batch ETL/ELT pipeline: ingest raw data, transform with Spark/dbt, load into a warehouse, validate with data-quality checks, and orchestrate with Airflow DAGs.',
    deployment: ['Containerise Airflow + workers', 'Schedule DAGs', 'Persist to warehouse (Postgres/Snowflake)', 'Publish a metrics dashboard'],
    testing: ['Unit tests for transforms (pytest)', 'Data-quality assertions (Great Expectations)', 'DAG integrity tests'],
    db: ['raw_events(event_id, payload jsonb, ingested_at)', 'dim_user(user_id, attrs...)', 'fact_activity(id, user_id FK, metric, value, day)'],
  },
  'AI/ML': {
    stack: ['Python', 'PyTorch / scikit-learn', 'FastAPI', 'Hugging Face', 'MLflow', 'Docker', 'Streamlit'],
    architecture: 'An ML service: prepare a dataset, train/evaluate a model with experiment tracking, serve predictions behind a FastAPI endpoint, and expose a small demo UI.',
    deployment: ['Track experiments in MLflow', 'Containerise the inference API (FastAPI)', 'Deploy to a GPU/CPU host', 'Demo UI on Streamlit/Spaces'],
    testing: ['Data + feature tests', 'Model evaluation thresholds (accuracy/F1)', 'API contract tests', 'Drift check stub'],
    db: ['datasets(id, name, version, uri)', 'runs(id, dataset_id FK, params jsonb, metrics jsonb, created_at)'],
  },
  Cloud: {
    stack: ['AWS (Lambda, API Gateway, S3, DynamoDB)', 'Terraform', 'Node.js/Python', 'CloudWatch', 'GitHub Actions'],
    architecture: 'A serverless application: API Gateway → Lambda → DynamoDB/S3, defined as infrastructure-as-code, with least-privilege IAM, monitoring, and an automated deploy pipeline.',
    deployment: ['Terraform provisions all resources', 'CI deploys Lambda + API Gateway', 'Static assets to S3 + CloudFront', 'Alarms in CloudWatch'],
    testing: ['Unit tests for handlers', 'Local emulation (SAM/LocalStack)', 'IAM policy review', 'Post-deploy smoke test'],
    db: ['items table (PK: id, GSI: userId-createdAt)', 'S3 bucket for assets/uploads'],
  },
  Cybersecurity: {
    stack: ['Python', 'OWASP ZAP', 'Docker', 'Burp Suite', 'Nmap', 'GitHub Actions', 'A deliberately vulnerable app'],
    architecture: 'A security lab: deploy a target app, run automated + manual assessments, document findings against OWASP Top 10, and integrate a security gate into CI.',
    deployment: ['Containerise the lab', 'Run automated scans in CI (ZAP)', 'Generate a findings report', 'Add a remediation PR'],
    testing: ['Reproducible exploit steps', 'Severity scoring (CVSS)', 'Regression scan after fixes'],
    db: null,
  },
};

const TYPE_TITLE = {
  Frontend: (s) => `Accessible ${s[0] || 'analytics'} dashboard with a reusable component library`,
  Backend: (s) => `Production-grade REST API with ${s[0] || 'auth'} and observability`,
  'Full Stack': (s) => `Full-stack ${s[0] || 'task'} platform with auth, CI/CD and tests`,
  DevOps: (s) => `Production-grade CI/CD deployment on ${/(eks|kubernetes|k8s)/i.test(s.join(' ')) ? 'AWS EKS' : 'Kubernetes'}`,
  Data: (s) => `End-to-end ${s[0] || 'analytics'} data pipeline with quality checks`,
  'AI/ML': (s) => `${s[0] || 'ML'} model served as an API with experiment tracking`,
  Cloud: (s) => `Serverless ${s[0] || 'application'} on AWS with infrastructure-as-code`,
  Cybersecurity: (s) => `Security assessment lab covering the OWASP Top 10`,
};

function roadmapFor(type, level, duration, skills) {
  const phases = [];
  phases.push({ phase: 'Setup & design', tasks: ['Define scope and success criteria', 'Set up repo, tooling and CI skeleton', 'Sketch architecture and data model'] });
  phases.push({ phase: 'Core build', tasks: [`Implement the core ${type} functionality`, `Apply the target skills: ${skills.slice(0, 4).join(', ') || 'core stack'}`, 'Write the primary modules with clean structure'] });
  if (level !== 'Beginner') phases.push({ phase: 'Hardening', tasks: ['Add tests and validation', 'Add logging/observability or quality checks', 'Handle edge cases and errors'] });
  phases.push({ phase: 'Ship & prove', tasks: ['Deploy to a public URL', 'Write the README with screenshots', 'Record results / metrics for the resume'] });
  if (level === 'Advanced' || duration === '1 month') phases.push({ phase: 'Stretch', tasks: ['Add a second integration or scale concern', 'Performance/security pass', 'Polish demo + write a short post'] });
  return phases;
}
function tasksFromRoadmap(roadmap) {
  const tasks = [];
  roadmap.forEach((p) => p.tasks.forEach((t) => tasks.push({ id: uid('t'), title: `${p.phase}: ${t}`, status: 'todo' })));
  return tasks;
}
function checklistFor(type) {
  return [
    'Repo created with clear README', 'Core feature working end-to-end', 'Tests written and passing',
    'Deployed to a public URL', 'Screenshots/demo added', 'Resume bullets written', 'LinkedIn post drafted',
  ].map((label) => ({ label, done: false }));
}
function resumeBulletsFor(title, type, skills) {
  const s = skills.slice(0, 5);
  return [
    `Built ${title} using ${s.slice(0, 3).join(', ') || 'a modern stack'}, demonstrating hands-on ${type} skills.`,
    `Implemented ${s[0] || 'core features'} and ${s[1] || 'automated workflows'}, reducing manual effort and improving reliability.`,
    `Deployed the project to a public environment with CI/CD and documented the architecture in a README.`,
    `Wrote tests and added monitoring/quality checks to ensure correctness and maintainability.`,
  ];
}
function readmeFor(p) {
  return `# ${p.title}

> ${p.problemStatement}

## Overview
${p.useCase}

**Target role:** ${p.targetRole}  ·  **Difficulty:** ${p.difficulty}  ·  **Duration:** ${p.duration}

## Skills demonstrated
${p.skillsCovered.map((s) => `- ${s}`).join('\n')}

## Tech stack
${p.techStack.map((s) => `- ${s}`).join('\n')}

## Architecture
${p.architecture}

## Getting started
\`\`\`bash
git clone <repo-url>
cd ${p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}
# install dependencies and run (see project docs)
\`\`\`

## Project structure
\`\`\`
${p.repoStructure}
\`\`\`

## Deployment
${p.deploymentPlan.map((s) => `- ${s}`).join('\n')}

## Testing
${p.testingPlan.map((s) => `- ${s}`).join('\n')}

## Demo
- Live demo: ${p.liveDemoUrl || '<add-url>'}
- Repository: ${p.githubUrl || '<add-url>'}

## License
MIT`;
}
function repoStructureFor(type) {
  if (type === 'DevOps' || type === 'Cloud') return `infra/\n  main.tf\n  variables.tf\n  outputs.tf\nk8s/ (or serverless/)\n  deployment.yaml\n  service.yaml\napp/\n  Dockerfile\n  src/\n.github/workflows/\n  ci.yml\nREADME.md`;
  if (type === 'Data') return `dags/\n  pipeline_dag.py\ntransforms/\n  models/ (dbt)\ntests/\n  test_transforms.py\ndocker-compose.yml\nREADME.md`;
  if (type === 'AI/ML') return `data/\nnotebooks/\nsrc/\n  train.py\n  evaluate.py\n  serve.py (FastAPI)\nmodels/\ntests/\nREADME.md`;
  if (type === 'Frontend') return `src/\n  components/\n  pages/\n  hooks/\n  lib/\ntests/\nindex.html\nvite.config.ts\nREADME.md`;
  if (type === 'Cybersecurity') return `lab/\n  target-app/\nscans/\n  zap-baseline.conf\nreports/\n  findings.md\n.github/workflows/security.yml\nREADME.md`;
  return `client/\n  src/\nserver/\n  src/\n  routes/\n  services/\nprisma/\n  schema.prisma\n.github/workflows/ci.yml\ndocker-compose.yml\nREADME.md`;
}
function interviewFor(type, skills) {
  const base = [
    { q: `Walk me through the architecture of this project.`, a: `Describe the main components, how data/requests flow between them, and one key trade-off you made (e.g. consistency vs. latency, simplicity vs. flexibility).` },
    { q: `Why did you choose this tech stack?`, a: `Tie each choice to a requirement — e.g. the framework for productivity, the database for the data shape, the deploy target for cost/scale — and mention one alternative you rejected and why.` },
    { q: `What was the hardest problem and how did you solve it?`, a: `Pick a concrete bug or design challenge, explain the symptom, how you diagnosed root cause, the fix, and how you verified it.` },
    { q: `How did you test and deploy it?`, a: `Explain your test layers and your CI/CD pipeline, and how you'd catch a regression before it reaches users.` },
  ];
  skills.slice(0, 3).forEach((s) => base.push({ q: `How did you use ${s} in this project?`, a: `Explain the specific role ${s} played, a concrete configuration/decision, and how you'd extend or scale it.` }));
  return base;
}
function linkedinFor(p) {
  return `🚀 Just shipped: ${p.title}

I built this to level up toward ${p.targetRole} roles and to prove these skills with real work, not just a checklist.

What it does: ${p.useCase}

🛠 Stack: ${p.techStack.slice(0, 6).join(', ')}
✅ Skills demonstrated: ${p.skillsCovered.slice(0, 6).join(', ')}

🔗 Code: ${p.githubUrl || '[GitHub link]'}
🌐 Demo: ${p.liveDemoUrl || '[live demo link]'}

Open to feedback and to connecting with others building in this space.

#${p.targetRole.replace(/[^a-zA-Z]/g, '')} #buildinpublic #portfolio`;
}

/* ---------------- Part 5/6 — industry-level detail builders ---------------- */
const PERSONAS = {
  Frontend: ['End user browsing the app', 'Returning power user', 'Admin/content editor'],
  Backend: ['API consumer (frontend/mobile)', 'Authenticated end user', 'Service-to-service caller'],
  'Full Stack': ['End user', 'Authenticated user managing their data', 'Admin managing the platform'],
  DevOps: ['Platform/SRE engineer', 'Developer shipping a service', 'On-call responder'],
  Data: ['Data analyst querying the warehouse', 'Pipeline operator', 'Downstream dashboard consumer'],
  'AI/ML': ['End user requesting a prediction', 'ML engineer training models', 'Reviewer auditing results'],
  Cloud: ['End user of the serverless app', 'Cloud engineer (IaC)', 'Billing/ops owner'],
  Cybersecurity: ['Security analyst', 'App owner remediating findings', 'Auditor reviewing the report'],
};
const NFR = ['Performance (p95 latency budget)', 'Security (auth, input validation, secrets)', 'Reliability (error handling, retries)', 'Observability (logging/metrics)', 'Accessibility & responsive UX', 'Maintainability (tests, docs)'];

function featuresFor(type, skills) {
  const s = skills.slice(0, 4);
  return {
    mustHave: [
      `Core ${type} workflow working end-to-end`,
      'User-facing screens / endpoints for the primary task',
      `Persistence of the main entity`,
      'Basic input validation and error states',
    ],
    goodToHave: [
      'Authentication and per-user data',
      `Use of ${s[0] || 'the key skill'} in a real feature`,
      'Search, filter or pagination',
      'Empty / loading / error UI states',
    ],
    advanced: [
      'Role-based access (admin vs user)',
      'Rate limiting / caching',
      `Integration with ${s[1] || 'an external API'}`,
      'CI/CD with automated tests on each push',
    ],
    roles: ['Anonymous visitor', 'Authenticated user', 'Admin'],
    nonFunctional: NFR,
  };
}
function technicalArchitectureFor(type, preset, skills) {
  const stack = preset.stack;
  const pick = (re, def) => stack.find((x) => re.test(x)) || def;
  return {
    frontend: ['Frontend', 'Full Stack'].includes(type) || /react|vue|next|tailwind/i.test(stack.join(' ')) ? pick(/react|vue|next|svelte/i, 'React + Vite') + ' (component-driven, typed API layer)' : 'Minimal UI / CLI / demo page',
    backend: ['Backend', 'Full Stack', 'AI/ML', 'Cloud'].includes(type) ? pick(/express|fastapi|spring|node|django/i, 'Node.js + Express') + ' (routes -> controllers -> services)' : 'N/A or thin function layer',
    database: preset.db ? pick(/postgres|mongo|dynamo|sql|prisma/i, 'PostgreSQL') : 'None (stateless) or object storage',
    apis: 'REST (JSON) with versioned routes and OpenAPI docs',
    authentication: /jwt|auth|oauth/i.test(skills.join(' ') + stack.join(' ')) ? 'JWT access tokens + refresh, hashed passwords (bcrypt)' : 'Optional JWT auth',
    storage: /s3|bucket|upload|file/i.test(stack.join(' ')) ? 'Object storage (S3-compatible) for uploads' : 'Database-backed; object storage if files are needed',
    integrations: pick(/stripe|razorpay|kafka|redis|openai|anthropic/i, 'One external API or queue'),
    deployment: preset.deployment[0] || 'Containerised deploy to a managed host',
    monitoring: 'Structured logging + basic metrics (latency, error rate); alerts on SLOs',
    cicd: 'GitHub Actions: lint -> test -> build -> deploy on main',
  };
}
function dataModelFor(type, preset) {
  if (!preset.db) {
    return [{ name: 'config', fields: ['key (string, PK)', 'value (json)', 'updated_at (timestamp)'], sample: { key: 'feature.enabled', value: true, updated_at: '2025-01-01T00:00:00Z' } }];
  }
  return preset.db.map((line) => {
    const name = line.split('(')[0].trim();
    const fields = (line.match(/\(([^)]*)\)/)?.[1] || '').split(',').map((f) => f.trim()).filter(Boolean);
    const sample = {};
    fields.slice(0, 4).forEach((f, i) => { const key = f.split(/\s+/)[0]; sample[key] = key.includes('id') ? i + 1 : key.includes('email') ? 'user@example.com' : key.includes('created') ? '2025-01-01T00:00:00Z' : `sample_${key}`; });
    return { name, fields, sample };
  });
}
function apiDesignFor(type, skills) {
  if (['Frontend'].includes(type)) {
    return [{ method: 'GET', endpoint: '/api/items', purpose: 'List items for the current view', request: 'query: ?page=1&q=', response: '{ items: [], total: number }', auth: false, validation: 'page>=1; q optional string' }];
  }
  return [
    { method: 'POST', endpoint: '/api/auth/register', purpose: 'Create a user account', request: '{ email, password, name }', response: '{ user, token }', auth: false, validation: 'valid email; password >= 8 chars; name required' },
    { method: 'POST', endpoint: '/api/auth/login', purpose: 'Authenticate and issue a JWT', request: '{ email, password }', response: '{ user, token }', auth: false, validation: 'email + password required; rate-limited' },
    { method: 'GET', endpoint: '/api/items', purpose: 'List the current user\u2019s items', request: 'query: ?page=&status=', response: '{ items: [], total }', auth: true, validation: 'valid JWT; page numeric' },
    { method: 'POST', endpoint: '/api/items', purpose: 'Create an item', request: '{ title, body }', response: '{ item }', auth: true, validation: 'title 1-120 chars; body optional' },
  ];
}

const MILESTONE_TITLES = ['Setup', 'UI layout', 'Backend setup', 'Database', 'Authentication', 'Core feature', 'Testing', 'Deployment', 'README + portfolio', 'Interview prep'];
function milestonesFor(type, skills) {
  const s = skills.slice(0, 4);
  const M = (n, title, goal, tasks, expectedOutput, commonMistakes, verification) => ({ n, title, goal, tasks, expectedOutput, commonMistakes, verification });
  return [
    M(1, 'Setup', 'Get a clean, version-controlled project skeleton running.',
      ['Install Node.js LTS (or Python) and Git', 'Create a new public GitHub repo and clone it', 'Initialise the project and commit a "hello world" run', 'Add a .gitignore and a README stub'],
      'Repo on GitHub with a running starter and first commit.',
      'Committing node_modules / secrets; skipping .gitignore.',
      ['App starts locally', 'First commit pushed to GitHub']),
    M(2, 'UI layout', 'Build the static screens before wiring real data.',
      ['Sketch the screens (home, detail, form)', 'Build components with placeholder data', 'Add loading / empty / error states', 'Make it responsive'],
      'Clickable UI shell with placeholder content.',
      'Wiring APIs before the layout is stable; ignoring empty/error states.',
      ['All primary screens render', 'Looks correct on mobile width']),
    M(3, 'Backend setup', 'Stand up an API the frontend can call.',
      ['Create the server (Express/FastAPI)', 'Add a /health route', `Add the first real route for the core entity`, 'Enable CORS for local dev'],
      'API responds to /health and one real route.',
      'No validation; returning stack traces to the client.',
      ['/health returns 200', 'Core route returns JSON']),
    M(4, 'Database', 'Persist data instead of using in-memory arrays.',
      ['Provision a local DB (Docker is easiest)', 'Define the schema / models', 'Wire create + read for the core entity', 'Add seed data for testing'],
      'Data survives a server restart.',
      'Hard-coding credentials; no migrations.',
      ['Create then read returns saved row', 'DB schema committed']),
    M(5, 'Authentication', 'Protect user data with real auth.',
      ['Add register + login routes', 'Hash passwords (bcrypt)', 'Issue and verify JWTs', 'Guard protected routes with middleware'],
      'Only logged-in users can access their data.',
      'Storing plaintext passwords; putting secrets in the repo.',
      ['Login returns a token', 'Protected route rejects missing/invalid token']),
    M(6, 'Core feature', `Deliver the headline ${type} capability end-to-end.`,
      [`Implement the main ${type} workflow using ${s.slice(0, 2).join(', ') || 'the core stack'}`, 'Connect frontend to the real API', 'Handle the unhappy paths', 'Polish the primary user journey'],
      'A user can complete the core task start-to-finish.',
      'Scope creep; leaving TODOs in the critical path.',
      ['End-to-end happy path works', 'Errors are shown gracefully']),
    M(7, 'Testing', 'Prove it works and keep it working.',
      ['Write unit tests for core logic', 'Add API/integration tests for key routes', 'Add one end-to-end UI test', 'Run the full suite locally'],
      'A passing test suite you can run with one command.',
      'Testing only the happy path; flaky tests with real network calls.',
      ['Tests pass locally', 'A failing case actually fails the suite']),
    M(8, 'Deployment', 'Ship it to a public URL.',
      ['Add a Dockerfile and/or deploy config', 'Set environment variables in the host', 'Deploy frontend and backend', 'Smoke-test the live URL'],
      'A public live demo anyone can open.',
      'Secrets committed to the repo; forgetting to set env vars in prod.',
      ['Live URL loads', 'Core feature works in production']),
    M(9, 'README + portfolio', 'Make the work legible to a recruiter in 60 seconds.',
      ['Write the README (problem, features, stack, setup)', 'Add screenshots / a short demo GIF', 'Document the architecture + API', 'Link the live demo and repo'],
      'A README a stranger can follow to run and understand it.',
      'No screenshots; "TODO" sections; no run instructions.',
      ['README has setup + screenshots', 'Architecture is documented']),
    M(10, 'Interview prep', 'Be able to defend every decision.',
      ['Write a 60-second pitch', 'Prepare answers on architecture, trade-offs and scaling', 'Note the hardest bug and how you fixed it', 'Generate resume bullets + a recruiter summary'],
      'You can explain the project end-to-end without notes.',
      'Memorising answers instead of understanding; no metrics.',
      ['60-second pitch ready', 'Can answer "why this stack?"']),
  ];
}
function mentorTasksFor(type, skills) {
  const s = skills.slice(0, 4);
  const T = (title, why, filesToCreate, steps, expectedOutput, howToTest, commonMistakes) =>
    ({ id: uid('gt'), title, why, filesToCreate, steps, expectedOutput, howToTest, commonMistakes, status: 'todo' });
  return [
    T('Initialise repo + tooling', 'A clean base prevents "works on my machine" issues later.',
      ['.gitignore', 'README.md', 'package.json'],
      ['Run the project init command', 'Add .gitignore for the language', 'Create a public GitHub repo and push'],
      'Repo builds/runs locally and is on GitHub.',
      'Clone fresh in a temp folder and run it.',
      'Committing node_modules or secrets.'),
    T('Build the API auth endpoint', 'Auth is the most-asked interview topic and gates user data.',
      ['server/routes/auth.js', 'server/middleware/auth.js'],
      ['Create POST /api/auth/register', 'Validate email/password', 'Hash password with bcrypt', 'Save user to the DB', 'Return a signed JWT'],
      'Register + login return a token; protected routes need it.',
      'Test with curl/Postman: register, then call a protected route with the token.',
      'Returning the password hash; not validating input.'),
    T(`Implement the core ${type} feature`, 'This is the headline of the project and your resume bullet.',
      ['server/services/core.js', 'client/src/pages/Main.jsx'],
      [`Wire the main ${type} workflow using ${s.slice(0, 2).join(', ') || 'the stack'}`, 'Connect UI to the API', 'Handle loading/error states'],
      'A user completes the core task end-to-end.',
      'Walk the happy path, then break the network and confirm the error UI.',
      'Leaving the unhappy path unhandled.'),
    T('Add tests + CI', 'Tests are proof; CI shows discipline recruiters look for.',
      ['tests/core.test.js', '.github/workflows/ci.yml'],
      ['Write unit tests for core logic', 'Add an API test for a key route', 'Add a GitHub Actions workflow to run them'],
      'Green CI badge on the repo.',
      'Push a branch and watch the workflow run.',
      'Tests that hit real external services.'),
    T('Deploy + verify', 'A live link is the single strongest portfolio signal.',
      ['Dockerfile', 'vercel.json or render.yaml'],
      ['Containerise or configure the host', 'Set env vars in prod', 'Deploy and open the live URL'],
      'A public live demo of the project.',
      'Open the URL in incognito and complete the core task.',
      'Forgetting prod env vars; committing secrets.'),
  ];
}
function testingPlanDetailed(type) {
  return {
    unit: ['Pure functions / services with edge inputs', 'Validation logic', 'Reducers / state transitions'],
    api: ['Each route: success + 400 + 401 cases', 'Auth middleware accepts/rejects correctly', 'Pagination and filtering'],
    ui: ['Renders primary screens', 'Loading / empty / error states', 'One full user journey (e2e)'],
    manual: ['Sign up -> log in -> core task -> log out', 'Refresh persists data', 'Try invalid inputs everywhere', 'Mobile width check'],
    edgeCases: ['Empty data set', 'Very long input / large list', 'Expired/invalid token', 'Network failure mid-request', 'Duplicate submit / double click'],
  };
}
function deploymentPlanDetailed(type, preset) {
  return {
    frontend: ['Build static bundle', 'Deploy to Vercel/Netlify', 'Point it at the prod API URL'],
    backend: preset.deployment,
    database: ['Use a managed DB (Neon/Railway/Atlas)', 'Run migrations on deploy', 'Restrict network access'],
    envVars: ['DATABASE_URL', 'JWT_SECRET', 'API_BASE_URL', '(any 3rd-party keys)'],
    customDomain: 'Optional: map a custom domain + HTTPS.',
    verification: ['Open the live URL', 'Complete the core task in prod', 'Check logs for errors', 'Run the in-app "Verify live demo" check'],
  };
}
function buildIndustryDetails(p, type, preset, skills) {
  return {
    overview: {
      whoShouldBuild: `Aspiring ${p.targetRole}s who need recruiter-visible proof of ${skills.slice(0, 3).join(', ') || 'core skills'}.`,
      realWorldProblem: p.problemStatement,
      expectedOutcome: 'A deployed app, a clear README, an architecture diagram, tests, and an interview-ready story.',
    },
    businessContext: {
      problemStatement: p.problemStatement,
      personas: PERSONAS[type] || PERSONAS['Full Stack'],
      coreWorkflows: ['Onboard / sign in', `Perform the core ${type} task`, 'View / manage results', 'Admin oversight'],
      realWorldRelevance: `Mirrors how real ${type} systems are built and operated in industry.`,
      industryScenario: `A small team needs a ${type.toLowerCase()} solution shipped quickly with production hygiene.`,
    },
    features: featuresFor(type, skills),
    technicalArchitecture: technicalArchitectureFor(type, preset, skills),
    dataModel: dataModelFor(type, preset),
    apiDesign: apiDesignFor(type, skills),
    folderStructure: p.repoStructure,
    milestones: milestonesFor(type, skills),
    guideTasks: mentorTasksFor(type, skills),
    testingPlan: testingPlanDetailed(type),
    deploymentPlan: deploymentPlanDetailed(type, preset),
  };
}

/* ---------------- Main deterministic builder ---------------- */
export function buildProject(input = {}) {
  const role = input.targetRole || 'Software Engineer';
  const level = LEVELS.includes(input.difficulty) ? input.difficulty : 'Intermediate';
  const duration = DURATIONS.includes(input.duration) ? input.duration : '1 week';
  const missing = dedupe(input.sourceMissingSkills);
  const type = TYPES.includes(input.type) ? input.type : inferType(missing, role);
  const preset = PRESETS[type] || PRESETS['Full Stack'];
  const skillsCovered = dedupe([...missing, ...preset.stack]).slice(0, 12);
  const title = input.title || titleCase(TYPE_TITLE[type](skillsCovered));
  const roadmap = roadmapFor(type, level, duration, skillsCovered);

  const p = {
    id: input.id || uid('proj'),
    title,
    targetRole: role,
    difficulty: level,
    duration,
    type,
    skillsCovered,
    sourceMissingSkills: missing,
    problemStatement: input.problemStatement
      || `Many ${role} candidates list ${missing[0] || 'these skills'} but have no public proof. This project closes that gap with a real, deployable artifact.`,
    useCase: `A practical ${type} project that solves a realistic problem and produces recruiter-visible proof: a working deployment, a clear README, and measurable outcomes.`,
    techStack: preset.stack,
    architecture: preset.architecture,
    steps: roadmap,
    repoStructure: repoStructureFor(type),
    apisTools: preset.stack,
    databaseSchema: preset.db,
    deploymentPlan: preset.deployment,
    testingPlan: preset.testing,
    checklist: checklistFor(type),
    tasks: tasksFromRoadmap(roadmap),
    resumeBullets: [],
    linkedinPost: '',
    interviewQuestions: [],
    readme: '',
    githubUrl: '',
    liveDemoUrl: '',
    screenshots: [],
    proofScore: 0,
    status: 'To Do',
    published: false,
    sourceJob: input.sourceJob || null,
  };
  p.resumeBullets = resumeBulletsFor(p.title, type, skillsCovered);
  p.interviewQuestions = interviewFor(type, skillsCovered);
  p.linkedinPost = linkedinFor(p);
  p.readme = readmeFor(p);
  p.architectureDiagram = generateMermaid(p);
  p.industry = buildIndustryDetails(p, type, preset, skillsCovered);
  p.guideTasks = p.industry.guideTasks;
  return p;
}

/* ---------------- AI-enhanced generation (server) with fallback ----------------
   Each function tries the server endpoint and merges the AI result; on ANY
   failure it returns the deterministic local output so the UI keeps working. */
async function tryPost(path, body) {
  try { return await api.post(path, body); } catch { return null; }
}

export async function generateRoadmap(input) {
  const local = buildProject(input);
  const r = await tryPost('/api/projects/generate-roadmap', input);
  if (r && r.ok && r.project) {
    const merged = { ...local, ...r.project, id: local.id, tasks: (r.project.steps ? tasksFromRoadmap(r.project.steps) : local.tasks), generatedBy: r.generatedBy || 'ai' };
    // keep the rich, always-present industry detail + diagram consistent with merged fields
    merged.architectureDiagram = local.architectureDiagram;
    merged.industry = local.industry;
    merged.guideTasks = local.guideTasks;
    if (!merged.repoStructure) merged.repoStructure = local.repoStructure;
    return merged;
  }
  return { ...local, generatedBy: 'template' };
}
export async function generateReadme(project) {
  const r = await tryPost('/api/projects/generate-readme', { project });
  if (r && r.ok && r.readme) return r.readme;
  return readmeFor(project);
}
export async function generateResumeBullets(project) {
  const r = await tryPost('/api/projects/generate-resume-bullets', { project });
  if (r && r.ok && Array.isArray(r.bullets) && r.bullets.length) return r.bullets;
  return resumeBulletsFor(project.title, project.type, project.skillsCovered);
}
export async function generateLinkedinPost(project) {
  const r = await tryPost('/api/projects/generate-linkedin-post', { project });
  if (r && r.ok && r.post) return r.post;
  return linkedinFor(project);
}
export async function generateInterviewPrep(project) {
  const r = await tryPost('/api/projects/generate-interview-prep', { project });
  if (r && r.ok && Array.isArray(r.questions) && r.questions.length) return r.questions;
  return interviewFor(project.type, project.skillsCovered);
}
