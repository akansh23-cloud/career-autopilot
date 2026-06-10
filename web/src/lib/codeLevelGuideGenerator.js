// Project OS — Builder Mode v3: code-level guide generator.
//
// Turns a single builder task into structured, implementation-level guidance:
// file plans, API contract, database schema, frontend/backend guides, test
// guide, and a devops guide — choosing only the sections that apply to the
// task's type. It is a GUIDE generator, not a code generator: it provides
// plans, contracts, function names, sample shapes and test ideas, never large
// source dumps.
//
// Pure + fully defensive: every input may be missing/malformed; nothing throws.

import { classifyTaskType } from './taskTypeClassifier.js';
import { apiRecipe, entityFields, entityRelationship, componentRecipe, KUBERNETES_FAILURE_PATTERNS, ROOT_CAUSE_RULES_FILE } from './domainImplementationRecipes.js';

const isArr = Array.isArray;
const arr = (v) => (isArr(v) ? v.filter((x) => x != null) : []);
const str = (v) => (v == null ? '' : (typeof v === 'string' ? v : (typeof v === 'number' || typeof v === 'boolean') ? String(v) : ''));
const clean = (s) => str(s).trim();
const API_BASE = 'http://localhost:5000';

function pascal(s = '') { return String(s).replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'Item'; }

/* ---------------- file plans ---------------- */
function filePlanFor(path) {
  const p = clean(path);
  const f = p.toLowerCase();
  const base = (purpose, responsibilities, exportsArr, importsArr, notes) => ({ path: p, purpose, responsibilities, exports: exportsArr, imports: importsArr, notes });
  if (/routes?\.js$/.test(f)) return base('Express router for this resource.', ['Declare the route + HTTP method', 'Attach validation middleware', 'Delegate to the controller'], ['router'], ['express', './<controller>'], 'Mount this router in the server entry point.');
  if (/controller\.js$/.test(f)) return base('Request/response handler.', ['Read + validate the request', 'Call the service', 'Shape the JSON response + status code'], ['handler functions'], ['../services/<service>'], 'Keep controllers thin — no business logic here.');
  if (/service\.js$/.test(f) || /services\//.test(f)) return base('Business logic module.', ['Implement the core function(s)', 'Talk to models/storage', 'Return plain data (no req/res)'], ['named functions'], ['../models/<Model>'], 'Unit-test this file directly.');
  if (/models\//.test(f) || /model\.js$/.test(f)) return base('Database model/schema.', ['Define fields + types', 'Add required/validation + indexes', 'Export the model'], ['the model'], ['mongoose or the DB client'], 'Register once; reuse everywhere.');
  if (/\.jsx$/.test(f) || /components?\//.test(f)) return base('React component.', ['Render UI with loading/empty/error states', 'Call the API', 'Lift shared state as needed'], ['default component'], ['react', '../lib/api'], 'Keep presentational; fetch in a hook or effect.');
  if (/dockerfile/i.test(f)) return base('Container build definition.', ['Pick a small base image', 'Install deps + copy source', 'Expose the port + start command'], [], [], 'Use a multi-stage build to keep the image small.');
  if (/\.github\/workflows/.test(f) || /\.ya?ml$/.test(f)) return base('CI workflow.', ['Install deps', 'Run lint + tests + build', 'Deploy on main'], [], [], 'Cache deps to speed up CI.');
  if (/index\.js$/.test(f) || /server\.js$/.test(f)) return base('Server entry point (edit).', ['Mount the new router', 'Keep middleware order correct'], [], [], 'Register the router after body parsers + before error handlers.');
  return base('Project file.', ['Implement the responsibility named by the task'], [], [], '');
}

/* ---------------- API contract ---------------- */
function buildApiContract(api, ctx) {
  if (!api || !api.path) return null;
  const method = (api.method || 'POST').toUpperCase();
  const recipe = apiRecipe(method, api.path) || {};
  return {
    method,
    path: api.path,
    purpose: clean(api.purpose) || `Implement ${method} ${api.path}.`,
    requestBody: recipe.requestBody || (method === 'GET' ? 'none (use query/path params)' : '{ /* fields the endpoint accepts */ }'),
    responseBody: recipe.responseBody || '{ /* the JSON this endpoint returns */ }',
    validationRules: arr(recipe.validationRules).length ? recipe.validationRules.slice() : ['Validate required fields', 'Reject malformed input with 400', 'Authorise the caller if the resource is protected'],
    errorCases: arr(recipe.errorCases).length ? recipe.errorCases.slice() : ['400 on invalid input', '404 when the referenced resource is missing', '500 on unexpected failure'],
  };
}

/* ---------------- database schema ---------------- */
function buildDatabaseSchema(entity, ctx) {
  if (!entity) return null;
  const name = pascal(entity.entity || entity.name || 'Item');
  let fields = arr(entity.fields).map(clean).filter(Boolean);
  if (!fields.length) fields = entityFields(name) || ['id', 'createdAt'];
  // Build a sample document from field names.
  const sample = {};
  fields.slice(0, 8).forEach((f) => {
    const k = f.replace(/\s.*$/, '');
    sample[k] = /id$/i.test(k) ? 'string'
      : /count|qty|quantity|score|amount|size|total|similarity|price/i.test(k) ? 0
      : /createdat|updatedat|date|at$/i.test(k) ? '2025-01-01T00:00:00Z'
      : /skills|keywords|inventors|claims|tags|references/i.test(k) ? ['...']
      : 'sample';
  });
  const indexes = fields.filter((f) => /id$/i.test(f) || /^email$/i.test(f)).map((f) => f.replace(/\s.*$/, ''));
  return {
    entity: name,
    fields,
    indexes: indexes.length ? indexes : ['createdAt'],
    sampleDocument: sample,
    validationRules: ['Mark identifying + foreign-key fields required', 'Add timestamps (createdAt/updatedAt)', 'Validate enums/ranges where applicable'],
    relationship: entityRelationship(name),
    seedDataIdea: `Insert 2–3 sample ${name} documents so the UI has data to render during development.`,
  };
}

/* ---------------- frontend guide ---------------- */
function buildFrontendGuide(componentName, ctx) {
  const name = pascal(componentName || 'Screen');
  // Best-effort: pick a related API from the project for the primary call.
  const apiHint = arr(ctx.apis)[0] || '';
  const isDashboard = /dashboard|findings|list|table/i.test(componentName || '');
  return {
    componentName: name,
    props: ['data (optional initial data)', 'onChange / onSelect callbacks as needed'],
    state: isDashboard ? ['items (array)', 'loading (bool)', 'error (string|null)', 'selected (id|null)'] : ['form fields', 'submitting (bool)', 'error (string|null)', 'result (object|null)'],
    apiCalls: [apiHint ? `Call ${apiHint} and store the result in state.` : 'Call the relevant API and store the result in state.'],
    emptyState: 'Show a friendly empty message + a primary action when there is no data yet.',
    loadingState: 'Show a spinner/skeleton while the request is in flight.',
    errorState: 'Show an inline error with a retry button when the request fails.',
    successState: isDashboard ? 'Render the results as cards/table/chart.' : 'Confirm success and show the returned result.',
    manualUiTest: ['Render with no data (empty state).', 'Trigger the API call and confirm loading → success.', 'Force an error and confirm the error UI + retry.'],
  };
}

/* ---------------- backend guide ---------------- */
function pickFile(files, re) { return arr(files).find((f) => re.test(String(f).toLowerCase())) || ''; }
function buildBackendGuide(task, ctx, api, entity) {
  const files = [...arr(task.filesToCreate), ...arr(task.filesToEdit)];
  const routeFile = pickFile(files, /routes?\.js$/);
  const controllerFile = pickFile(files, /controller\.js$/);
  const serviceFile = pickFile(files, /service\.js$/) || pickFile(files, /services\//);
  const modelFile = pickFile(files, /models\//);
  const compRecipe = componentRecipe(task.title || '', ctx && ctx.domain);
  let businessLogicSteps = [];
  const apiR = api && api.path ? apiRecipe(api.method, api.path) : null;
  if (apiR && arr(apiR.businessLogicSteps).length) businessLogicSteps = apiR.businessLogicSteps.slice();
  else if (compRecipe && arr(compRecipe.businessLogicSteps).length) businessLogicSteps = compRecipe.businessLogicSteps.slice();
  else if (entity) businessLogicSteps = [`Define the ${pascal(entity.entity || entity.name)} model.`, 'Wire create + read first.', 'Add validation + indexes.'];
  else businessLogicSteps = ['Validate inputs.', 'Perform the core operation.', 'Persist/return the result.', 'Handle the unhappy path.'];
  const middleware = [];
  if (/upload/i.test(task.title || '')) middleware.push('multer (multipart/form-data file upload)');
  if (apiR && /auth|listings|orders/.test(String(api && api.path)) ) middleware.push('auth (require a logged-in user)');
  middleware.push('input validation');
  return {
    routeFile, controllerFile, serviceFile, modelFile,
    functions: compRecipe ? arr(compRecipe.functions) : [],
    input: compRecipe ? str(compRecipe.input) : '',
    output: compRecipe ? str(compRecipe.output) : '',
    middleware,
    businessLogicSteps,
    edgeCases: compRecipe ? arr(compRecipe.edgeCases) : [],
    sampleFields: compRecipe ? arr(compRecipe.sampleFields) : [],
    testIdeas: compRecipe ? arr(compRecipe.testIdeas) : [],
  };
}

/* ---------------- test guide ---------------- */
function sampleParams(path) {
  // Replace :params with readable sample values: ":uploadId" → "demo-upload-id".
  return String(path).replace(/:([A-Za-z0-9_]+)/g, (_m, n) => 'demo-' + String(n).replace(/_/g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase());
}
function isUploadEndpoint(method, path) {
  // Only an ACTUAL upload endpoint: POST whose final path segment is "upload"
  // (e.g. /api/logs/upload). Not GET /api/findings/:uploadId.
  if (String(method).toUpperCase() !== 'POST') return false;
  const segs = String(path).split('?')[0].split('/').filter(Boolean);
  return /^uploads?$/i.test(segs[segs.length - 1] || '');
}
function buildTestGuide(task, taskType, api) {
  const method = api && api.method ? api.method.toUpperCase() : '';
  const path = api && api.path ? api.path : '';
  const curlCommands = [];
  const expectedResults = [];
  if (taskType === 'backend_api' && path) {
    if (isUploadEndpoint(method, path)) {
      curlCommands.push(`curl -X ${method} ${API_BASE}${path} \\\n  -F "projectId=demo-project" \\\n  -F "file=@sample.log"`);
      expectedResults.push('HTTP 201 with an uploadId in the JSON body.');
    } else if (method === 'GET' || !method) {
      curlCommands.push(`curl ${API_BASE}${sampleParams(path)}`);
      expectedResults.push('HTTP 200 with the expected JSON array/object.');
    } else {
      curlCommands.push(`curl -X ${method} ${API_BASE}${sampleParams(path)} \\\n  -H "Content-Type: application/json" \\\n  -d '{ }'`);
      expectedResults.push('HTTP 2xx with the documented response body.');
    }
  }
  const apiTests = taskType === 'backend_api'
    ? [`${method || 'POST'} ${path}: success path returns the documented body`, 'invalid input returns 400', 'protected route rejects unauthenticated calls (if applicable)']
    : [];
  const unitTestIdeas = (taskType === 'backend_service')
    ? ['Test the core function with a normal input.', 'Test an edge case (empty/unknown input).', 'Test that ranking/ordering is correct.']
    : taskType === 'database' ? ['Create then read a record.', 'Reject a document missing required fields.'] : [];
  const manualTests = taskType === 'frontend'
    ? ['Open the screen with no data (empty state).', 'Load data and confirm it renders.', 'Force an error and confirm the error UI.']
    : ['Run the happy path end-to-end.', 'Try one invalid input and confirm a clear error.'];
  return { manualTests, apiTests, unitTestIdeas, curlCommands, expectedResults };
}

/* ---------------- devops guide ---------------- */
function buildDevopsGuide(task, taskType, ctx) {
  if (taskType !== 'deployment' && taskType !== 'devops') return null;
  const isDocker = /docker/i.test(task.title || '') || /dockerfile/i.test(arr(task.filesToCreate).join(' '));
  const isCi = /github actions|ci\b|workflow/i.test(task.title || '') || /\.github/.test(arr(task.filesToCreate).join(' '));
  return {
    envVars: ['PORT', 'DATABASE_URL', 'API_BASE_URL', 'JWT_SECRET (if auth)'],
    dockerNotes: isDocker || taskType === 'devops' ? 'Multi-stage build: install + build, then copy only the output into a slim runtime image; EXPOSE the port; set the start command.' : '',
    ciSteps: isCi || taskType === 'devops' ? ['Checkout', 'Install dependencies', 'Lint', 'Test', 'Build', 'Deploy on main'] : [],
    deploymentSteps: ['Connect the repo to the host.', 'Set the build + start commands.', 'Set production environment variables.', 'Deploy and watch the logs.'],
    healthCheck: 'GET /api/health should return 200 { status: "ok" } once deployed.',
    commonDeploymentErrors: ['Missing env vars in prod', 'Wrong start command', 'Port not exposed/!= host port', 'Database not reachable from the host'],
    secretHandling: 'Store secrets in the host dashboard / GitHub Actions secrets — never commit them.',
  };
}

/* ---------------- overview ---------------- */
function buildOverview(task, taskType, domain, api, entity) {
  const bits = [];
  if (taskType === 'backend_api' && api) bits.push(`Build the ${api.method || 'POST'} ${api.path} endpoint end-to-end (route → controller → service).`);
  else if (taskType === 'database' && entity) bits.push(`Define the ${pascal(entity.entity || entity.name)} model so the feature can persist data.`);
  else if (taskType === 'frontend') bits.push(`Build the UI for this feature with proper loading/empty/error states.`);
  else if (taskType === 'backend_service') bits.push(`Implement the service logic for this module with clear inputs/outputs.`);
  else if (taskType === 'deployment') bits.push(`Ship this part of the system to a public host and verify it.`);
  else if (taskType === 'devops') bits.push(`Set up the container/CI so the project builds, tests and deploys repeatably.`);
  else bits.push(clean(task.objective) || 'Complete this task following the steps below.');
  if (domain === 'kubernetes' && /root cause|analyzer|parser|detector|finding/i.test(task.title || '')) {
    bits.push(`Match parsed log signals against a rule table (${ROOT_CAUSE_RULES_FILE.path}) covering ${KUBERNETES_FAILURE_PATTERNS.slice(0, 4).map((r) => r.pattern).join(', ')} and more.`);
  }
  return bits.join(' ');
}

/* ---------------- main entry ---------------- */
export function buildCodeLevelGuide(task = {}, ctx = {}) {
  try {
    const t = task || {};
    const taskType = t.taskType || classifyTaskType(t);
    const domain = ctx.domain || 'generic';
    const api = t._api || null;
    const entity = t._entity || null;
    const component = t._component || null;

    const filePlans = [...arr(t.filesToCreate), ...arr(t.filesToEdit)].map(filePlanFor);
    // For Kubernetes analyzer-ish backend tasks, surface the rules file plan.
    if (domain === 'kubernetes' && /root cause|analyzer/i.test(t.title || '') && !filePlans.some((fp) => /rootcauserules/i.test(fp.path))) {
      filePlans.push({ ...ROOT_CAUSE_RULES_FILE });
    }

    const wantsApi = taskType === 'backend_api';
    const wantsDb = taskType === 'database';
    const wantsFe = taskType === 'frontend';
    const wantsBe = taskType === 'backend_api' || taskType === 'backend_service' || taskType === 'database' || taskType === 'integration' || taskType === 'security';

    const apiContract = wantsApi ? buildApiContract(api || inferApiFromTitle(t.title), ctx) : null;
    const databaseSchema = wantsDb ? buildDatabaseSchema(entity || { entity: inferEntityFromTitle(t.title) }, ctx) : null;
    const frontendGuide = wantsFe ? buildFrontendGuide(component || inferComponentFromTitle(t.title), ctx) : null;
    const backendGuide = wantsBe ? buildBackendGuide(t, ctx, apiContract, entity) : null;
    const testGuide = buildTestGuide(t, taskType, apiContract);
    const devopsGuide = buildDevopsGuide(t, taskType, ctx);

    return {
      overview: buildOverview(t, taskType, domain, apiContract, entity || (wantsDb ? { entity: inferEntityFromTitle(t.title) } : null)),
      filePlans,
      apiContract,
      databaseSchema,
      frontendGuide,
      backendGuide,
      testGuide,
      devopsGuide,
    };
  } catch {
    return defaultCodeLevelGuide();
  }
}

function inferApiFromTitle(title = '') {
  const m = String(title).match(/\b(GET|POST|PUT|PATCH|DELETE)\b\s+(\/\S+)/i);
  return m ? { method: m[1].toUpperCase(), path: m[2], purpose: '' } : null;
}
function inferEntityFromTitle(title = '') {
  const m = String(title).match(/(?:create|add|build)\s+(.+?)\s+model/i);
  return m ? m[1] : '';
}
function inferComponentFromTitle(title = '') {
  return String(title).replace(/^\s*(build|implement|create)\s+/i, '').trim();
}

export function defaultCodeLevelGuide() {
  return {
    overview: '',
    filePlans: [],
    apiContract: null,
    databaseSchema: null,
    frontendGuide: null,
    backendGuide: null,
    testGuide: { manualTests: [], apiTests: [], unitTestIdeas: [], curlCommands: [], expectedResults: [] },
    devopsGuide: null,
  };
}

/* Normalize an arbitrary codeLevelGuide-shaped object to the safe full shape. */
export function normalizeCodeLevelGuide(g) {
  const d = defaultCodeLevelGuide();
  if (!g || typeof g !== 'object') return d;
  const tg = g.testGuide && typeof g.testGuide === 'object' ? g.testGuide : {};
  return {
    overview: str(g.overview),
    filePlans: arr(g.filePlans).map((fp) => ({
      path: str(fp && fp.path), purpose: str(fp && fp.purpose),
      responsibilities: arr(fp && fp.responsibilities).map(str), exports: arr(fp && fp.exports).map(str),
      imports: arr(fp && fp.imports).map(str), notes: str(fp && fp.notes),
    })),
    apiContract: g.apiContract && typeof g.apiContract === 'object' ? {
      method: str(g.apiContract.method), path: str(g.apiContract.path), purpose: str(g.apiContract.purpose),
      requestBody: str(g.apiContract.requestBody), responseBody: str(g.apiContract.responseBody),
      validationRules: arr(g.apiContract.validationRules).map(str), errorCases: arr(g.apiContract.errorCases).map(str),
    } : null,
    databaseSchema: g.databaseSchema && typeof g.databaseSchema === 'object' ? {
      entity: str(g.databaseSchema.entity), fields: arr(g.databaseSchema.fields).map(str),
      indexes: arr(g.databaseSchema.indexes).map(str), sampleDocument: g.databaseSchema.sampleDocument || {},
      validationRules: arr(g.databaseSchema.validationRules).map(str),
      relationship: str(g.databaseSchema.relationship), seedDataIdea: str(g.databaseSchema.seedDataIdea),
    } : null,
    frontendGuide: g.frontendGuide && typeof g.frontendGuide === 'object' ? {
      componentName: str(g.frontendGuide.componentName), props: arr(g.frontendGuide.props).map(str),
      state: arr(g.frontendGuide.state).map(str), apiCalls: arr(g.frontendGuide.apiCalls).map(str),
      emptyState: str(g.frontendGuide.emptyState), loadingState: str(g.frontendGuide.loadingState),
      errorState: str(g.frontendGuide.errorState), successState: str(g.frontendGuide.successState),
      manualUiTest: arr(g.frontendGuide.manualUiTest).map(str),
    } : null,
    backendGuide: g.backendGuide && typeof g.backendGuide === 'object' ? {
      routeFile: str(g.backendGuide.routeFile), controllerFile: str(g.backendGuide.controllerFile),
      serviceFile: str(g.backendGuide.serviceFile), modelFile: str(g.backendGuide.modelFile),
      functions: arr(g.backendGuide.functions).map(str), input: str(g.backendGuide.input), output: str(g.backendGuide.output),
      middleware: arr(g.backendGuide.middleware).map(str), businessLogicSteps: arr(g.backendGuide.businessLogicSteps).map(str),
      edgeCases: arr(g.backendGuide.edgeCases).map(str),
      sampleFields: arr(g.backendGuide.sampleFields).map(str), testIdeas: arr(g.backendGuide.testIdeas).map(str),
    } : null,
    testGuide: {
      manualTests: arr(tg.manualTests).map(str), apiTests: arr(tg.apiTests).map(str),
      unitTestIdeas: arr(tg.unitTestIdeas).map(str), curlCommands: arr(tg.curlCommands).map(str),
      expectedResults: arr(tg.expectedResults).map(str),
    },
    devopsGuide: g.devopsGuide && typeof g.devopsGuide === 'object' ? {
      envVars: arr(g.devopsGuide.envVars).map(str), dockerNotes: str(g.devopsGuide.dockerNotes),
      ciSteps: arr(g.devopsGuide.ciSteps).map(str), deploymentSteps: arr(g.devopsGuide.deploymentSteps).map(str),
      healthCheck: str(g.devopsGuide.healthCheck), commonDeploymentErrors: arr(g.devopsGuide.commonDeploymentErrors).map(str),
      secretHandling: str(g.devopsGuide.secretHandling),
    } : null,
  };
}

export default { buildCodeLevelGuide, defaultCodeLevelGuide, normalizeCodeLevelGuide };
