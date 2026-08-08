/* Guided Project Workspace — expected file tree planner (deterministic).

   v2: the tree is DOMAIN-SHAPED and BUILDABLE.
   - entity files are named after the real domain entity (Patient, Invoice…)
   - one schema file feeds model + validator + store + form + table + seed
   - every non-builtin MVP feature gets a backend module, a screen and an
     acceptance test, so no task in the roadmap is ever "no files"
   - scripts/ gives the student setup, dev, doctor and check in one command

   Every entry carries a templateKey when codegen can render a starter
   version, and starterPackIncluded when it ships in the ZIP. */
import { did, slug, pascal, camel, arr, obj, str } from './planUtils.js';

export function planFileTree(project = {}, stack = {}, { screens = [], apis = [], models = [], entity = 'Item', domain = null, featureSpecs = [] } = {}) {
  const f = stack.features || {};
  const d = obj(domain);
  const primary = obj(d.primary);
  const E = primary.name || pascal(entity);
  const e = primary.slug || slug(entity);
  const ePlural = primary.slugPlural || `${e}s`;
  const eCamel = primary.camel || camel(entity);
  const entities = arr(d.entities).length ? arr(d.entities) : [{ name: E, slug: e, slugPlural: ePlural, camel: eCamel }];
  const feats = arr(featureSpecs);
  const standalone = feats.filter((x) => !x.builtin);

  const files = [];
  const add = (path, purpose, opts = {}) => files.push({
    path, type: opts.type || 'file', purpose,
    relatedTasks: [], linkedApis: opts.apis || [], linkedModels: opts.models || [],
    templateKey: opts.templateKey || null,
    starterPackIncluded: opts.pack !== false && !!opts.templateKey,
    kind: opts.kind || 'code',
    featureId: opts.featureId || null,
    status: 'planned',
    verificationStatus: 'unverified',
  });

  /* ---------------- Root ---------------- */
  add('README.md', 'What this is, how to run it in three commands, and what you still have to build.', { templateKey: 'readmeV2' });
  add('SETUP.md', 'Step-by-step local setup commands.', { templateKey: 'setupMd' });
  add('TASKS.md', 'Task checklist exported from the workspace plan.', { templateKey: 'tasksMd' });
  add('.env.example', 'Env var NAMES with safe defaults (never real secrets).', { templateKey: 'envExampleV2' });
  add('package.json', 'Root scripts: setup, dev, test, check, doctor, seed.', { templateKey: 'rootPackageV2' });
  add('docker-compose.yml', 'Optional: local MongoDB via Docker.', { templateKey: 'dockerCompose' });
  add('.github/workflows/ci.yml', 'CI: install + test on every push. Red until you build the features — that is honest.', { templateKey: 'ciWorkflowV2' });

  /* ---------------- Scripts (one-command experience) ---------------- */
  add('scripts/setup.mjs', 'One command from ZIP to running app: installs both workspaces and writes .env.', { templateKey: 'setupScript' });
  add('scripts/dev.mjs', 'Runs API + web together with prefixed logs. No extra dependency.', { templateKey: 'devScript' });
  add('scripts/doctor.mjs', 'Diagnoses the four things that break a first run, with the exact fix for each.', { templateKey: 'doctorScript' });

  /* ---------------- Docs ---------------- */
  add('docs/architecture.md', 'Architecture summary exported from Architecture OS.', { templateKey: 'docArchitecture' });
  add('docs/api-plan.md', 'Planned endpoints reference.', { templateKey: 'docApiPlan' });
  add('docs/database-models.md', 'Planned models reference.', { templateKey: 'docModels' });
  add('docs/deployment-guide.md', 'Deployment steps + env vars.', { templateKey: 'docDeployment' });
  add('docs/proof-requirements.md', 'What counts as verifiable proof for this project.', { templateKey: 'docProof' });

  /* ---------------- Backend: schema first ---------------- */
  add('backend/package.json', 'Backend dependencies + scripts (test runs tests/ recursively so acceptance tests are never skipped).', { templateKey: 'packageBackendV2' });
  add('backend/server.js', 'Express entry: mounts routes + features, seeds memory mode, one error handler.', { templateKey: 'serverEntryV2' });
  add('backend/config/env.js', 'Env loading with safe defaults — missing values never block startup while you build.', { templateKey: 'envConfigV2' });
  add('backend/lib/store.js', 'Storage adapter — memory mode and MongoDB expose identical methods.', { templateKey: 'storeAdapter' });
  add('backend/lib/seedData.js', 'Demo rows so the first run is never an empty screen.', { templateKey: 'seedData' });
  add('backend/scripts/seed.js', 'Seeds a real database with the demo rows.', { templateKey: 'seedScript' });
  add('backend/routes/health.routes.js', 'Health check route.', { templateKey: 'expressRoute' });

  for (const ent of entities) {
    add(`backend/schemas/${ent.slug}.schema.js`, `SINGLE SOURCE OF TRUTH for ${ent.name} fields — model, validator, form and table all read this.`, { templateKey: 'domainSchema', kind: 'schema' });
    add(`backend/models/${ent.name}.js`, `Mongoose model for ${ent.name}.`, { templateKey: 'domainModel', models: models.filter((m) => m.name === ent.name).map((m) => m.id) });
  }
  add(`backend/services/${eCamel}Service.js`, `${E} business logic — the interesting part.`, { templateKey: 'domainService' });
  add(`backend/controllers/${eCamel}Controller.js`, `${E} request handlers.`, { templateKey: 'domainController' });
  add(`backend/routes/${ePlural}.routes.js`, `${E} CRUD routes — working from the first run.`, { templateKey: 'domainRoutes', apis: apis.filter((a) => a.path.includes(`/${ePlural}`)).map((a) => a.id) });

  if (f.auth) {
    add('backend/routes/auth.routes.js', 'Auth routes — register/login/me starter placeholders (no real credential check yet).', { templateKey: 'authRoute' });
    add('backend/models/User.js', 'Mongoose User model.', { templateKey: 'mongooseModel', models: models.filter((m) => m.name === 'User').map((m) => m.id) });
  }
  if (f.upload) add('backend/services/uploadService.js', 'File upload handling (TODO storage choice).', { templateKey: 'expressService' });
  if (f.admin) add('backend/routes/admin.routes.js', 'Admin routes — role-gated placeholder (role check not implemented yet).', { templateKey: 'adminRoute' });
  if (f.recruiter) add('backend/routes/recruiter.routes.js', 'Recruiter routes — role-gated placeholder.', { templateKey: 'recruiterRoute' });
  if (f.queue) add('backend/workers/worker.js', 'Background worker placeholder (planned only).', { pack: false });
  if (f.payments) add('backend/routes/payments.routes.js', 'Payment order route (SANDBOX placeholder; planned only).', { pack: false });

  /* ---------------- Backend: one module per feature you must build ---------------- */
  for (const spec of standalone) {
    add(spec.serviceFile, `Feature "${spec.name}" — ${spec.method} ${spec.path}. Answers 501 until you implement it.`,
      { templateKey: 'featureModule', kind: 'feature', featureId: spec.id });
  }

  /* ---------------- Backend: tests (smoke green, acceptance red) ---------------- */
  add('backend/tests/helpers/server.js', 'Boots the real app on a free port for tests. No dependencies.', { templateKey: 'testHelper', kind: 'test' });
  add('backend/tests/smoke.test.js', 'Foundation tests — these pass on day one and must keep passing.', { templateKey: 'smokeTest', kind: 'test' });
  for (const spec of standalone) {
    add(`backend/tests/acceptance/${spec.slug}.test.js`, `Acceptance test for "${spec.name}" — RED until you build it.`,
      { templateKey: 'acceptanceTest', kind: 'acceptance', featureId: spec.id });
  }

  /* ---------------- Frontend ---------------- */
  add('frontend/package.json', 'Frontend dependencies + scripts.', { templateKey: 'packageFrontend' });
  add('frontend/index.html', 'Vite entry HTML.', { templateKey: 'indexHtml' });
  add('frontend/vite.config.js', 'Vite config with the /api proxy that removes CORS from your life.', { templateKey: 'viteConfigV2' });
  add('frontend/src/main.jsx', 'React entry.', { templateKey: 'mainJsx' });
  add('frontend/src/App.jsx', 'App shell + tab navigation across your screens.', { templateKey: 'appShell' });
  add('frontend/src/styles.css', 'Starter styling — plain CSS, no framework.', { templateKey: 'appStyles' });
  add('frontend/src/lib/api.js', 'Fetch wrapper for the backend API.', { templateKey: 'apiClient' });
  add('frontend/src/lib/schema.js', `Frontend copy of the ${E} field definitions — form and table read this.`, { templateKey: 'schemaClient', kind: 'schema' });
  add(`frontend/src/components/${E}Form.jsx`, `${E} form, generated from the schema.`, { templateKey: 'entityForm' });
  add(`frontend/src/components/${E}Table.jsx`, `${E} table, columns generated from the schema.`, { templateKey: 'entityTable' });
  add('frontend/src/views/Dashboard.jsx', `Working list + create + delete screen for ${E}.`, { templateKey: 'dashboardView' });
  for (const spec of standalone) {
    add(spec.viewFile, `Screen for "${spec.name}".`, { templateKey: 'featureView', kind: 'feature', featureId: spec.id });
  }
  if (f.upload) add('frontend/src/components/FileUploadBox.jsx', 'Reusable upload dropzone (TODO wiring).', { templateKey: 'reactComponent' });
  if (f.auth) add('frontend/src/views/SignIn.jsx', 'Sign-in screen (TODO real auth).', { templateKey: 'reactPage' });

  /* ---------------- Workspace exports ---------------- */
  add('workspace/workspace-plan.json', 'Snapshot of this workspace plan.', { templateKey: 'workspaceJson' });
  add('workspace/architecture-spec.json', 'Architecture OS spec snapshot.', { templateKey: 'architectureJson' });
  add('workspace/verification-checklist.json', 'Proof checklist snapshot.', { templateKey: 'checklistJson' });

  return files.map((x) => ({ ...x, id: did('file', x.path) })).slice(0, 90);
}
