// Project OS — Architecture → Builder Mode mapper.
//
// Converts a project's architecture / blueprint / API design / database design /
// deployment plan into concrete, project-specific builder tasks. It is the
// bridge that makes Builder Mode an "architecture-backed MVP execution
// workspace": components become implementation tasks, API design becomes
// endpoint tasks, database design becomes model tasks, deployment plan becomes
// deployment tasks.
//
// Every reader is defensive: missing, string, array, and object inputs are all
// handled without throwing, so a malformed/partial architecture never crashes
// guide generation.
//
// PURE module: no window/DOM/network/AI.

const isArr = Array.isArray;
const isObj = (v) => v && typeof v === 'object' && !isArr(v);
const str = (v) => (v == null ? '' : (typeof v === 'string' ? v : (typeof v === 'number' || typeof v === 'boolean') ? String(v) : ''));
const clean = (s) => str(s).trim();

function asStrList(v) {
  if (v == null) return [];
  if (typeof v === 'string') return v.split(/[\n,;|]+/).map((x) => x.trim()).filter(Boolean);
  if (isArr(v)) {
    return v.map((x) => {
      if (typeof x === 'string') return x.trim();
      if (isObj(x)) return clean(x.name || x.title || x.label || x.component || x.module || x.service || x.screen || '');
      return '';
    }).filter(Boolean);
  }
  if (isObj(v)) {
    // e.g. { "Log Parser": {...}, "Dashboard": {...} } → keys
    return Object.keys(v).map((k) => k.trim()).filter(Boolean);
  }
  return [];
}

function firstPresent(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v != null && !(isArr(v) && v.length === 0) && !(typeof v === 'string' && !v.trim())) return v;
  }
  return undefined;
}

function slug(s = '', max = 40) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'item';
}
function pascal(s = '') {
  return String(s).replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'Item';
}
function camel(s = '') { const p = pascal(s); return p.charAt(0).toLowerCase() + p.slice(1); }
function singular(s = '') { return s.endsWith('ies') ? s.slice(0, -3) + 'y' : s.endsWith('s') ? s.slice(0, -1) : s; }

/* ------------------------------------------------------------------ *
 * Normalize architecture out of a project's many possible fields.     *
 * Returns a stable, fully-defensive shape.                            *
 * ------------------------------------------------------------------ */
export function normalizeArchitecture(project = {}) {
  const p = isObj(project) ? project : {};
  const arch = isObj(p.architecture) ? p.architecture : {};
  const archInt = isObj(p.architectureIntelligence) ? p.architectureIntelligence : {};
  const blueprint = isObj(p.blueprint) ? p.blueprint : {};
  const industry = isObj(p.industry) ? p.industry : {};
  const archDiagram = isObj(p.architectureDiagram) ? p.architectureDiagram : {};
  const systemArch = isObj(industry.systemArchitecture) ? industry.systemArchitecture : {};

  /* components / modules / services / screens */
  const components = uniqStr([
    ...asStrList(firstPresent(p, ['components', 'modules', 'services', 'screens'])),
    ...asStrList(firstPresent(arch, ['components', 'modules', 'services', 'screens'])),
    ...asStrList(firstPresent(archInt, ['components', 'modules', 'services', 'screens', 'frontendScreens'])),
    ...asStrList(firstPresent(blueprint, ['components', 'modules', 'services', 'screens'])),
    ...asStrList(firstPresent(archDiagram, ['components', 'modules', 'nodes'])),
    ...asStrList(firstPresent(systemArch, ['components', 'modules', 'services'])),
  ]);
  const screens = uniqStr([
    ...asStrList(p.screens), ...asStrList(arch.screens), ...asStrList(blueprint.screens),
    ...asStrList(firstPresent(archInt, ['screens', 'frontendScreens'])),
  ]);

  /* APIs — read architectureIntelligence + older shapes too */
  const apiRaw = firstPresent(p, ['apiDesign', 'apis', 'apiEndpoints', 'endpoints'])
    || firstPresent(archInt, ['apiDesign', 'apis', 'endpoints'])
    || firstPresent(arch, ['apiDesign', 'apis', 'endpoints'])
    || firstPresent(blueprint, ['apiDesign', 'apis', 'endpoints'])
    || firstPresent(industry, ['apiDesign', 'apis'])
    || firstPresent(systemArch, ['apiDesign', 'apis', 'endpoints']);
  const apis = normalizeApis(apiRaw);

  /* Entities */
  const dbRaw = firstPresent(p, ['databaseDesign', 'databaseSchema', 'dataModel', 'entities', 'models'])
    || firstPresent(archInt, ['databaseDesign', 'databaseSchema', 'dataModel', 'entities', 'models'])
    || firstPresent(arch, ['databaseDesign', 'databaseSchema', 'dataModel', 'entities'])
    || firstPresent(blueprint, ['databaseDesign', 'databaseSchema', 'entities', 'models'])
    || firstPresent(industry, ['dataModel', 'databaseDesign'])
    || firstPresent(systemArch, ['dataModel', 'entities']);
  const entities = normalizeEntities(dbRaw);

  /* Deployment */
  const deployRaw = firstPresent(p, ['deploymentPlan', 'deployment', 'deploymentTargets'])
    || firstPresent(archInt, ['deploymentPlan', 'deployment', 'deploymentTargets'])
    || firstPresent(arch, ['deploymentPlan', 'deployment'])
    || firstPresent(industry, ['deploymentPlan', 'deployment'])
    || firstPresent(systemArch, ['deploymentPlan', 'deployment']);
  const deployment = normalizeDeployment(deployRaw);

  /* Soft extras (kept for completeness / future use) */
  const security = asStrList(firstPresent(p, ['securityPlan', 'security']) || firstPresent(archInt, ['securityPlan', 'security']) || firstPresent(arch, ['securityPlan', 'security']));
  const testing = asStrList(firstPresent(p, ['testingPlan']) || firstPresent(archInt, ['testingPlan']) || firstPresent(arch, ['testingPlan']));
  const proof = asStrList(firstPresent(p, ['proofChecklist']) || firstPresent(archInt, ['proofChecklist']) || firstPresent(arch, ['proofChecklist']));

  return { components, screens, apis, entities, deployment, security, testing, proof };
}

function uniqStr(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const v = clean(x);
    const k = v.toLowerCase();
    if (v && !seen.has(k)) { seen.add(k); out.push(v); }
  }
  return out;
}

function normalizeApis(raw) {
  const out = [];
  const seen = new Set();
  const push = (method, path, purpose) => {
    const m = (clean(method) || 'POST').toUpperCase();
    const pth = clean(path);
    if (!pth) return;
    const key = m + ' ' + pth.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ method: m, path: pth, purpose: clean(purpose) });
  };
  if (isArr(raw)) {
    for (const it of raw) {
      if (typeof it === 'string') {
        // "POST /api/x — purpose" or "POST /api/x"
        const m = it.match(/\b(GET|POST|PUT|PATCH|DELETE)\b/i);
        const pathMatch = it.match(/\/[^\s]+/);
        push(m ? m[1] : 'POST', pathMatch ? pathMatch[0] : '', it.replace(/.*[—:-]\s*/, ''));
      } else if (isObj(it)) {
        push(it.method, it.path || it.endpoint || it.route || it.url, it.purpose || it.description || it.summary);
      }
    }
  } else if (isObj(raw)) {
    // { "/api/x": "purpose", ... }
    for (const [k, v] of Object.entries(raw)) {
      const m = k.match(/\b(GET|POST|PUT|PATCH|DELETE)\b/i);
      const pathMatch = k.match(/\/[^\s]+/);
      push(m ? m[1] : 'POST', pathMatch ? pathMatch[0] : k, typeof v === 'string' ? v : (isObj(v) ? (v.purpose || v.description) : ''));
    }
  } else if (typeof raw === 'string') {
    return normalizeApis(raw.split(/\n+/));
  }
  return out;
}

function normalizeEntities(raw) {
  const out = [];
  const seen = new Set();
  const push = (name, fields) => {
    const n = pascal(clean(name));
    if (!n || n === 'Item' && !clean(name)) return;
    if (!clean(name)) return;
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ entity: n, fields: uniqStr(asFieldList(fields)) });
  };
  if (isArr(raw)) {
    for (const it of raw) {
      if (typeof it === 'string') {
        // "users(id, email, role)" or "User: id, email"
        const name = it.split(/[(:]/)[0];
        const inside = (it.match(/\(([^)]*)\)/)?.[1]) || it.split(':')[1] || '';
        push(name, inside);
      } else if (isObj(it)) {
        push(it.entity || it.name || it.table || it.model, it.fields || it.columns || it.attributes);
      }
    }
  } else if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw)) push(k, isObj(v) ? (v.fields || v.columns) : v);
  } else if (typeof raw === 'string') {
    return normalizeEntities(raw.split(/\n+/));
  }
  return out;
}

function asFieldList(v) {
  if (v == null) return [];
  if (typeof v === 'string') return v.split(/[\n,;]+/).map((f) => f.trim().split(/\s+/)[0]).filter(Boolean);
  if (isArr(v)) return v.map((f) => (typeof f === 'string' ? f.trim().split(/\s+/)[0] : (isObj(f) ? clean(f.name || f.field) : ''))).filter(Boolean);
  if (isObj(v)) return Object.keys(v);
  return [];
}

function normalizeDeployment(raw) {
  const out = { frontend: '', backend: '', database: '', steps: [] };
  if (isObj(raw)) {
    out.frontend = clean(isArr(raw.frontend) ? raw.frontend[0] : raw.frontend);
    out.backend = clean(isArr(raw.backend) ? raw.backend[0] : raw.backend);
    out.database = clean(isArr(raw.database) ? raw.database[0] : raw.database);
    // collect any string steps present
    for (const v of Object.values(raw)) {
      if (typeof v === 'string') out.steps.push(v.trim());
      else if (isArr(v)) for (const s of v) if (typeof s === 'string') out.steps.push(s.trim());
    }
  } else if (isArr(raw)) {
    out.steps = raw.map((s) => clean(typeof s === 'string' ? s : (isObj(s) ? (s.step || s.title) : ''))).filter(Boolean);
    // infer targets from the step text
    const hay = out.steps.join(' ').toLowerCase();
    if (/vercel|netlify|cloudfront|pages/.test(hay)) out.frontend = out.frontend || matchTarget(hay, ['vercel', 'netlify', 'cloudfront']);
    if (/render|railway|fly\.io|heroku|ecs|lambda/.test(hay)) out.backend = out.backend || matchTarget(hay, ['render', 'railway', 'fly.io', 'heroku', 'ecs', 'lambda']);
    if (/atlas|neon|rds|postgres|mongo|supabase/.test(hay)) out.database = out.database || matchTarget(hay, ['mongodb atlas', 'atlas', 'neon', 'rds', 'supabase', 'postgres']);
  } else if (typeof raw === 'string') {
    out.steps = [raw.trim()].filter(Boolean);
  }
  out.steps = uniqStr(out.steps);
  return out;
}
function matchTarget(hay, names) { return (names.find((n) => hay.includes(n)) || '').replace(/\b\w/g, (c) => c.toUpperCase()); }

/* ------------------------------------------------------------------ *
 * Task builders — turn normalized architecture into builder tasks.    *
 * Each returns full-shape task objects with deterministic IDs so      *
 * saved progress survives regeneration.                               *
 * ------------------------------------------------------------------ */
function mkTask(t) {
  const out = {
    id: str(t.id),
    title: clean(t.title),
    objective: clean(t.objective),
    filesToCreate: (t.filesToCreate || []).map(clean).filter(Boolean),
    filesToEdit: (t.filesToEdit || []).map(clean).filter(Boolean),
    commands: (t.commands || []).map(clean).filter(Boolean),
    implementationSteps: (t.implementationSteps || []).map(clean).filter(Boolean),
    expectedOutput: (t.expectedOutput || []).map(clean).filter(Boolean),
    validationSteps: (t.validationSteps || []).map(clean).filter(Boolean),
    commonErrors: (t.commonErrors || []).map(clean).filter(Boolean),
    commitMessage: clean(t.commitMessage),
    completionCriteria: (t.completionCriteria || []).map(clean).filter(Boolean),
    status: 'todo',
    _bucket: t._bucket || 'backend',
  };
  // Carry structured hints for the code-level guide generator (stripped before final output).
  if (t._api) out._api = t._api;
  if (t._entity) out._entity = t._entity;
  if (t._component) { out._component = t._component; out._componentBucket = t._componentBucket || out._bucket; }
  return out;
}

const UI_RE = /\b(ui|dashboard|screen|page|panel|view|form|flow|chart|cards?|frontend|widget)\b/i;
const SERVICE_RE = /\b(service|engine|analyzer|parser|processor|detector|scorer|matcher|ingest|executor|connector|builder|retrieval|aggregation|api)\b/i;

export function classifyComponent(name = '') {
  if (UI_RE.test(name)) return 'frontend';
  if (SERVICE_RE.test(name)) return 'backend';
  return 'backend';
}

export function componentTask(name, ctx = {}) {
  const bucket = classifyComponent(name);
  const verb = bucket === 'frontend' ? 'Build' : (SERVICE_RE.test(name) ? 'Implement' : 'Build');
  const id = `arch-comp-${slug(name)}`;
  const file = bucket === 'frontend'
    ? `web/src/components/${pascal(name)}.jsx`
    : `server/services/${camel(name)}.js`;
  return mkTask({
    id,
    _bucket: bucket,
    _component: clean(name),
    _componentBucket: bucket,
    title: `${verb} ${clean(name)}`,
    objective: `Implement the "${clean(name)}" ${bucket === 'frontend' ? 'interface' : 'module'} from the project architecture.`,
    filesToCreate: [file],
    implementationSteps: bucket === 'frontend'
      ? [`Create the ${clean(name)} component.`, 'Render its primary content with loading/empty/error states.', 'Wire it to the relevant API once available.']
      : [`Create the ${clean(name)} module.`, 'Implement its core function with clear inputs/outputs.', 'Export it and call it from a route/controller.'],
    expectedOutput: [`The ${clean(name)} ${bucket === 'frontend' ? 'renders and is reachable in the app' : 'runs and returns a result for a sample input'}.`],
    validationSteps: [bucket === 'frontend' ? `Open the app and confirm ${clean(name)} renders.` : `Call ${clean(name)} with a sample input and inspect the output.`],
    commitMessage: `feat: ${verb.toLowerCase()} ${slug(name).replace(/-/g, ' ')}`,
    completionCriteria: [`${clean(name)} implemented`, 'Wired into the app flow'],
  });
}

export function apiTask(api, ctx = {}) {
  const method = (api.method || 'POST').toUpperCase();
  const path = api.path || '';
  const segs = path.replace(/^\/?api\/?/, '').split('/').filter(Boolean).filter((s) => !s.startsWith(':'));
  const resource = segs[0] || 'resource';
  const action = segs[1] || '';
  const resSingular = singular(resource);
  const id = `arch-api-${method.toLowerCase()}-${slug(path)}`;
  const routeFile = `server/routes/${camel(resSingular)}Routes.js`;
  const controllerFile = `server/controllers/${camel(resSingular)}Controller.js`;
  const serviceFile = `server/services/${camel(resSingular)}${action ? pascal(action) : ''}Service.js`;
  return mkTask({
    id,
    _bucket: 'backend',
    _api: { method, path, purpose: clean(api.purpose) },
    title: `Create ${method} ${path}`,
    objective: api.purpose || `Implement the ${method} ${path} endpoint.`,
    filesToCreate: [routeFile, controllerFile, serviceFile],
    filesToEdit: ['server/index.js'],
    implementationSteps: [
      `Define the route ${method} ${path} in ${routeFile}.`,
      `Add a controller handler in ${controllerFile} that validates the request and calls the service.`,
      `Implement the service logic in ${serviceFile}.`,
      'Return a clear JSON response with the correct status code.',
      'Mount the route file in the server entry point.',
    ],
    expectedOutput: [api.purpose ? `${api.purpose}.` : `${method} ${path} returns a valid JSON response.`],
    validationSteps: [`Call ${method} ${path} with a sample request (curl/Postman) and confirm the expected response.`, 'Send an invalid request and confirm a 400 with a helpful message.'],
    commonErrors: ['Route not mounted → import and register the router in the server entry point.', 'Unvalidated input → validate before processing.'],
    commitMessage: `feat: add ${method} ${path} endpoint`,
    completionCriteria: [`${method} ${path} works`, 'Input validated', 'Route mounted'],
  });
}

export function entityTask(entity, ctx = {}) {
  const name = pascal(entity.entity || entity.name || 'Item');
  const fields = (entity.fields && entity.fields.length) ? entity.fields : ['id', 'createdAt'];
  const id = `arch-model-${slug(name)}`;
  return mkTask({
    id,
    _bucket: 'backend',
    _entity: { entity: name, fields },
    title: `Create ${name} model`,
    objective: `Define the ${name} entity so the app can persist it.`,
    filesToCreate: [`server/models/${name}.js`],
    implementationSteps: [
      `Define the ${name} schema/model.`,
      `Add the fields: ${fields.join(', ')}.`,
      'Add timestamps and required constraints.',
      'Register the model and connect using DATABASE_URL.',
    ],
    expectedOutput: [`The ${name} model is registered and one record can be created + read back.`],
    validationSteps: [`Insert a sample ${name} and read it back to confirm persistence.`],
    commonErrors: ['DB connection refused → confirm the database is running and DATABASE_URL is set.'],
    commitMessage: `feat: add ${name} model`,
    completionCriteria: [`${name} model defined`, 'Create + read verified'],
  });
}

export function deploymentTasks(deployment, ctx = {}) {
  const d = deployment || {};
  const tasks = [];
  if (d.frontend) tasks.push(mkTask({
    id: 'arch-deploy-frontend', _bucket: 'deploy', title: `Deploy frontend to ${d.frontend}`,
    objective: `Publish the frontend to ${d.frontend}.`,
    implementationSteps: [`Connect the repo to ${d.frontend}.`, 'Set the production API base URL as an env var.', 'Trigger a production build + deploy.'],
    expectedOutput: [`The frontend is live on ${d.frontend} at a public URL.`],
    validationSteps: ['Open the public URL and confirm the app loads.'],
    commitMessage: `chore: configure ${slug(d.frontend)} frontend deploy`,
    completionCriteria: ['Frontend live'],
  }));
  if (d.backend) tasks.push(mkTask({
    id: 'arch-deploy-backend', _bucket: 'deploy', title: `Deploy backend to ${d.backend}`,
    objective: `Publish the API to ${d.backend}.`,
    implementationSteps: [`Create a service on ${d.backend}.`, 'Set the build + start commands.', 'Set production env vars.', 'Deploy.'],
    expectedOutput: [`The API is reachable on ${d.backend} and /api/health responds.`],
    validationSteps: [`Hit /api/health on the ${d.backend} URL and confirm "ok".`],
    commitMessage: `chore: configure ${slug(d.backend)} backend deploy`,
    completionCriteria: ['Backend live', 'Health check passes'],
  }));
  if (d.database) tasks.push(mkTask({
    id: 'arch-deploy-database', _bucket: 'deploy', title: `Configure ${d.database} connection`,
    objective: `Provision and connect the production database (${d.database}).`,
    implementationSteps: [`Create a ${d.database} instance.`, 'Copy the connection string into the backend env (DATABASE_URL).', 'Restrict network access.'],
    expectedOutput: [`The deployed backend connects to ${d.database}.`],
    validationSteps: ['Perform one create + read against the production DB.'],
    commitMessage: `chore: connect ${slug(d.database)} database`,
    completionCriteria: ['Production DB connected'],
  }));
  if (tasks.length) {
    tasks.push(mkTask({
      id: 'arch-deploy-env', _bucket: 'deploy', title: 'Set production environment variables',
      objective: 'Configure all required production environment variables.',
      implementationSteps: ['List every required env var (PORT, DATABASE_URL, API_BASE_URL, secrets).', 'Set them in each host dashboard.', 'Redeploy so they take effect.'],
      expectedOutput: ['All services start in production with no missing-env errors.'],
      validationSteps: ['Check deploy logs for missing-env warnings.'],
      commitMessage: 'docs: document production environment variables',
      completionCriteria: ['Env vars set in all hosts'],
    }));
    tasks.push(mkTask({
      id: 'arch-deploy-verify', _bucket: 'deploy', title: 'Verify health endpoint in production',
      objective: 'Confirm the deployed system is healthy end-to-end.',
      implementationSteps: ['Open the public frontend URL.', 'Hit /api/health on the deployed backend.', 'Complete the core flow in production.'],
      expectedOutput: ['Health check returns ok and the core flow works in production.'],
      validationSteps: ['Run the core user journey against the live URLs.'],
      commitMessage: 'chore: verify production health',
      completionCriteria: ['Production health verified'],
    }));
  } else if ((d.steps || []).length) {
    d.steps.slice(0, 6).forEach((s, i) => tasks.push(mkTask({
      id: `arch-deploy-step-${i + 1}`, _bucket: 'deploy', title: clean(s).length > 60 ? `Deployment step ${i + 1}` : `Deploy: ${clean(s)}`,
      objective: clean(s),
      implementationSteps: [clean(s)],
      expectedOutput: ['This deployment step is completed and verified.'],
      validationSteps: ['Confirm the step succeeded with no errors.'],
      commitMessage: `chore: ${slug(s).replace(/-/g, ' ')}`,
      completionCriteria: [clean(s)],
    })));
  }
  return tasks;
}

/* Convert a normalized architecture into grouped, deduped builder tasks. */
export function architectureToTasks(arch, ctx = {}) {
  const a = arch || {};
  const componentNames = uniqStr([...(a.components || []), ...(a.screens || [])]);
  const compTasks = componentNames.map((n) => componentTask(n, ctx));
  const apiTasks = (a.apis || []).map((x) => apiTask(x, ctx));
  const modelTasks = (a.entities || []).map((x) => entityTask(x, ctx));
  const deployTks = deploymentTasks(a.deployment, ctx);

  return {
    frontend: compTasks.filter((t) => t._bucket === 'frontend'),
    backend: [...modelTasks, ...apiTasks, ...compTasks.filter((t) => t._bucket === 'backend')],
    deploy: deployTks,
    all: [...compTasks, ...apiTasks, ...modelTasks, ...deployTks],
  };
}

/* True only when the project carries real architecture inputs (not just a
   keyword-detected pattern). Used for the "architecture-backed" badge + CTA. */
export function hasArchitectureData(project = {}) {
  const a = normalizeArchitecture(project);
  return !!(a.components.length || a.apis.length || a.entities.length || a.deployment.frontend || a.deployment.backend || a.deployment.database || a.deployment.steps.length);
}

export default { normalizeArchitecture, architectureToTasks, componentTask, apiTask, entityTask, deploymentTasks, classifyComponent, hasArchitectureData };
