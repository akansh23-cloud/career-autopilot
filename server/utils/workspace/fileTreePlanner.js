/* Guided Project Workspace — expected file tree planner (deterministic).
   Every entry carries a templateKey when the codegen engine can render a
   starter version, and starterPackIncluded when it ships in the ZIP. */
import { did, slug, pascal, camel } from './planUtils.js';

export function planFileTree(project = {}, stack = {}, { screens = [], apis = [], models = [], entity = 'Item' } = {}) {
  const f = stack.features || {};
  const e = slug(entity);
  const E = pascal(entity);
  const files = [];
  const add = (path, purpose, opts = {}) => files.push({
    path, type: opts.type || 'file', purpose,
    relatedTasks: [], linkedApis: opts.apis || [], linkedModels: opts.models || [],
    templateKey: opts.templateKey || null,
    starterPackIncluded: opts.pack !== false && !!opts.templateKey,
    status: 'planned',
    verificationStatus: 'unverified',
  });

  // Root
  add('README.md', 'Project overview, setup, honest status notes.', { templateKey: 'readme' });
  add('SETUP.md', 'Step-by-step local setup commands.', { templateKey: 'setupMd' });
  add('TASKS.md', 'Task checklist exported from the workspace plan.', { templateKey: 'tasksMd' });
  add('.env.example', 'Required env vars with placeholder values (never real secrets).', { templateKey: 'envExample' });
  add('docker-compose.yml', 'Optional: local MongoDB via Docker.', { templateKey: 'dockerCompose' });
  add('package.json', 'Root scripts to run frontend + backend together.', { templateKey: 'packageRoot' });
  add('.github/workflows/ci.yml', 'CI placeholder (lint + test on push).', { templateKey: 'ghActions' });

  // Docs
  add('docs/architecture.md', 'Architecture summary exported from Architecture OS.', { templateKey: 'docArchitecture' });
  add('docs/api-plan.md', 'Planned endpoints reference.', { templateKey: 'docApiPlan' });
  add('docs/database-models.md', 'Planned models reference.', { templateKey: 'docModels' });
  add('docs/deployment-guide.md', 'Deployment steps + env vars.', { templateKey: 'docDeployment' });
  add('docs/proof-requirements.md', 'What counts as verifiable proof for this project.', { templateKey: 'docProof' });

  // Frontend
  add('frontend/package.json', 'Frontend dependencies + scripts.', { templateKey: 'packageFrontend' });
  add('frontend/index.html', 'Vite entry HTML.', { templateKey: 'indexHtml' });
  add('frontend/vite.config.js', 'Vite config with /api proxy to the backend.', { templateKey: 'viteConfig' });
  add('frontend/src/main.jsx', 'React entry.', { templateKey: 'mainJsx' });
  add('frontend/src/App.jsx', 'Top-level routes/views.', { templateKey: 'appJsx' });
  add('frontend/src/lib/api.js', 'Fetch wrapper for the backend API.', { templateKey: 'apiClient' });
  add('frontend/src/views/Dashboard.jsx', 'Dashboard screen (list + stats).', { templateKey: 'reactPage' });
  add(`frontend/src/views/${E}Detail.jsx`, `Create/edit a ${entity.toLowerCase()}.`, { templateKey: 'reactPage' });
  if (f.upload) {
    add(`frontend/src/views/Upload${E}.jsx`, 'Upload flow screen.', { templateKey: 'reactPage' });
    add('frontend/src/components/FileUploadBox.jsx', 'Reusable upload dropzone (TODO wiring).', { templateKey: 'reactComponent' });
  }
  if (f.ai) {
    add('frontend/src/views/ScoreResult.jsx', 'Score output screen.', { templateKey: 'reactPage' });
    add('frontend/src/components/ScoreCard.jsx', 'Score display card.', { templateKey: 'reactComponent' });
  }
  if (f.auth) add('frontend/src/views/SignIn.jsx', 'Sign-in screen (TODO real auth).', { templateKey: 'reactPage' });

  // Backend
  add('backend/package.json', 'Backend dependencies + scripts.', { templateKey: 'packageBackend' });
  add('backend/server.js', 'Express entry: middleware, routes, health.', { templateKey: 'serverEntry' });
  add('backend/config/env.js', 'Env loading + validation.', { templateKey: 'envConfig' });
  add('backend/routes/health.routes.js', 'Health check route.', { templateKey: 'expressRoute' });
  add(`backend/routes/${e}s.routes.js`, `${E} CRUD routes.`, { templateKey: 'expressRoute', apis: apis.filter((a) => a.path.includes(`/${e}s`)).map((a) => a.id) });
  add(`backend/controllers/${camel(entity)}Controller.js`, `${E} request handlers.`, { templateKey: 'expressController' });
  add(`backend/services/${camel(entity)}Service.js`, `${E} business logic (DB access lives here).`, { templateKey: 'expressService' });
  add(`backend/models/${E}.js`, `Mongoose model for ${E}.`, { templateKey: 'mongooseModel', models: models.filter((m) => m.name === E).map((m) => m.id) });
  add(`backend/validators/${camel(entity)}Validator.js`, 'Request validation (plain JS, swap in zod/joi later).', { templateKey: 'validatorFile' });
  if (f.auth) {
    add('backend/routes/auth.routes.js', 'Auth routes — register/login/me starter placeholders (no real credential check yet).', { templateKey: 'authRoute' });
    add('backend/models/User.js', 'Mongoose User model.', { templateKey: 'mongooseModel', models: models.filter((m) => m.name === 'User').map((m) => m.id) });
  }
  if (f.upload) add(`backend/services/uploadService.js`, 'File upload handling (TODO storage choice).', { templateKey: 'expressService' });
  if (f.admin) add('backend/routes/admin.routes.js', 'Admin routes — role-gated placeholder (role check not implemented yet).', { templateKey: 'adminRoute' });
  if (f.recruiter) add('backend/routes/recruiter.routes.js', 'Recruiter routes — role-gated placeholder (role check not implemented yet).', { templateKey: 'recruiterRoute' });
  if (f.ai) add(`backend/services/scoringService.js`, 'Deterministic scoring placeholder — backend owns the numbers.', { templateKey: 'expressService' });
  if (f.queue) add('backend/workers/worker.js', 'Background worker placeholder (planned only).', { pack: false });
  if (f.payments) add('backend/routes/payments.routes.js', 'Payment order route (SANDBOX placeholder; planned only).', { pack: false });

  // Tests
  add('backend/tests/health.test.js', 'Health endpoint test (node --test).', { templateKey: 'testFile' });
  add(`backend/tests/${e}.test.js`, `${E} service unit test.`, { templateKey: 'testFile' });

  // Workspace exports
  add('workspace/workspace-plan.json', 'Snapshot of this workspace plan.', { templateKey: 'workspaceJson' });
  add('workspace/architecture-spec.json', 'Architecture OS spec snapshot.', { templateKey: 'architectureJson' });
  add('workspace/verification-checklist.json', 'Proof checklist snapshot.', { templateKey: 'checklistJson' });

  return files.map((x) => ({ ...x, id: did('file', x.path) })).slice(0, 60);
}
