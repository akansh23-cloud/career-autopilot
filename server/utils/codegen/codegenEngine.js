/* ============================================================
   Codegen — deterministic engine. Renders starter files from the
   workspace plan via the template registry. No AI involved.
   ============================================================ */
import { arr, str, obj, pascal } from '../workspace/planUtils.js';
import { hasTemplate, renderTemplate } from './templateRegistry.js';

/* Build the render context a template needs from the plan + file entry. */
export function buildTemplateContext(plan = {}, fileEntry = null) {
  const p = obj(plan);
  const summary = obj(p.projectSummary);
  const entity = str(p.primaryEntity) || 'Item';
  const path = str(obj(fileEntry).path);
  const base = {
    projectName: summary.title || p.title || 'my-project',
    projectTitle: summary.title || p.title || 'My project',
    shortDescription: summary.shortDescription || '',
    entity,
    features: obj(obj(p.stack), {}).features || detectFeaturesFromPlan(p),
    tasks: arr(p.tasks),
    apis: arr(p.apiPlan),
    models: arr(p.databaseModels),
    proofRequirements: arr(p.proofRequirements),
    deploymentPlan: obj(p.deploymentPlan),
    architectureSpec: obj(p.architecture).architectureSpec || null,
    workspacePlanExport: exportablePlan(p),
    /* v2 domain context — every schema-driven template reads these. */
    domain: obj(p.domain),
    featureSpecs: arr(p.featureSpecs),
    hasAuth: String(!!obj(obj(p.stack).features).auth),
  };
  /* Route files planned with a starter template — serverEntry mounts these. */
  base.routeFiles = arr(p.fileTree)
    .filter((f) => /backend\/routes\/[A-Za-z0-9_-]+\.routes\.js$/.test(f.path) && f.templateKey)
    .map((f) => {
      const file = f.path.split('/').pop();
      const stem = file.replace(/\.routes\.js$/, '').replace(/[^A-Za-z0-9]+(.)/g, (_, ch) => ch.toUpperCase());
      return { file, importName: `${stem}Routes` };
    });
  /* Honest doc status: an API is "starter" only when the generated backend
     actually wires a placeholder route for it. */
  base.apis = annotateApisImplemented(p, base.routeFiles);
  if (!fileEntry) return base;

  /* ---- v2 per-file domain binding -------------------------------------
     A schema/model file binds to ONE entity; a feature file binds to ONE
     compiled feature spec (and the task number that owns it, so the code,
     the guide and `npm run check NN` all agree). */
  const entities = arr(base.domain.entities);
  const bySlug = (sl) => entities.find((x) => x.slug === sl || x.slugPlural === sl) || null;
  const byName = (nm) => entities.find((x) => x.name === nm) || null;

  const schemaMatch = path.match(/backend\/schemas\/([a-z0-9-]+)\.schema\.js$/);
  if (schemaMatch) base.entityDef = bySlug(schemaMatch[1]) || entities[0] || null;
  const modelMatch2 = path.match(/backend\/models\/([A-Za-z0-9]+)\.js$/);
  if (modelMatch2) base.entityDef = byName(modelMatch2[1]) || null;
  if (!base.entityDef) base.entityDef = entities[0] || null;

  const spec = arr(p.featureSpecs).find((sp) =>
    sp.serviceFile === path || sp.viewFile === path || path.endsWith(`tests/acceptance/${sp.slug}.test.js`));
  if (spec) {
    base.feature = spec;
    base.featureTaskNo = featureTaskNo(p, spec.id);
  }

  // Per-file specialization derived from the planned path.
  const m = path.match(/views\/([A-Za-z0-9]+)\.jsx$/);
  if (m) base.componentName = m[1];
  const cm = path.match(/components\/([A-Za-z0-9]+)\.jsx$/);
  if (cm) base.componentName = cm[1];
  if (/health\.routes/.test(path)) base.routeKind = 'health';
  if (/auth\.routes/.test(path)) base.routeKind = 'auth';
  if (/scoringService/.test(path)) base.serviceKind = 'scoring';
  if (/uploadService/.test(path)) base.serviceKind = 'upload';
  if (/tests\/health/.test(path)) base.testKind = 'health';
  const mm = path.match(/models\/([A-Za-z0-9]+)\.js$/);
  if (mm) {
    base.modelName = mm[1];
    const model = arr(p.databaseModels).find((x) => x.name === mm[1]);
    if (model) base.fields = model.fields;
  }
  if (/App\.jsx$/.test(path)) {
    base.views = arr(p.fileTree)
      .filter((f) => /frontend\/src\/views\/([A-Za-z0-9]+)\.jsx$/.test(f.path))
      .map((f) => {
        const name = f.path.match(/views\/([A-Za-z0-9]+)\.jsx$/)[1];
        return { name: name.replace(/([a-z])([A-Z])/g, '$1 $2'), file: name };
      });
  }
  return base;
}

/* A trimmed plan snapshot safe to embed in the ZIP (no userId). */
function exportablePlan(p) {
  const clone = { ...obj(p) };
  delete clone.userId;
  return clone;
}

/* Mark which planned APIs the generated starter backend actually wires.
   Keep this in sync with the route templates: health, entity CRUD (+upload/
   +score when those features are on), auth, admin, recruiter. Everything
   else (e.g. payments) is documented as planned only. */
function annotateApisImplemented(p, routeFiles = []) {
  const have = new Set(routeFiles.map((r) => r.file));
  /* v2: the entity path comes from the domain model (patients, invoices…),
     not from lowercasing the entity name and bolting on an "s" — that broke
     for every irregular plural. */
  const primary = obj(obj(p.domain).primary);
  const plural = str(primary.slugPlural) || `${str(p.primaryEntity || 'item').toLowerCase()}s`;
  const entityRouteFile = `${plural}.routes.js`;
  const f = obj(obj(p.stack).features);
  /* Feature modules are real mounted routers too — an endpoint they own is
     shipped (answering 501 by design), so the docs must not call it "planned only". */
  const featurePaths = new Set(arr(p.featureSpecs).map((x) => str(x.path)));
  return arr(p.apiPlan).map((a) => {
    const path = str(a.path);
    let implemented = false;
    if (path === '/api/health') implemented = have.has('health.routes.js');
    else if (path.startsWith('/api/auth/')) implemented = have.has('auth.routes.js');
    else if (path.startsWith('/api/admin/')) implemented = have.has('admin.routes.js');
    else if (path.startsWith('/api/recruiter/')) implemented = have.has('recruiter.routes.js');
    else if (path.startsWith(`/api/${plural}`)) {
      if (/\/upload$/.test(path)) implemented = have.has(entityRouteFile) && f.upload === true;
      else if (/\/score$/.test(path)) implemented = have.has(entityRouteFile) && f.ai === true;
      else implemented = have.has(entityRouteFile);
    }
    if (!implemented && featurePaths.has(path)) implemented = true;
    return { ...a, starterImplemented: implemented };
  });
}

function detectFeaturesFromPlan(p) {
  const f = obj(obj(p.stack).features);
  if (Object.keys(f).length) return f;
  const apis = arr(p.apiPlan).map((a) => a.path).join(' ');
  return { auth: /auth/.test(apis), upload: /upload/.test(apis), ai: /score/.test(apis), payments: /payments/.test(apis) };
}

/* Generate starter content for one planned file. */
export function generateForFile(plan = {}, filePath = '', templateKeyOverride = '') {
  const warnings = [];
  const entry = arr(obj(plan).fileTree).find((f) => f.path === filePath) || null;
  const key = str(templateKeyOverride) || str(obj(entry).templateKey);
  if (!key) return { generatedFiles: [], warnings: [`No starter template is available for "${filePath}" — this file is planned for you to implement manually.`] };
  if (!hasTemplate(key)) return { generatedFiles: [], warnings: [`Template "${key}" is not in the registry — nothing generated.`] };
  const ctx = buildTemplateContext(plan, entry || { path: filePath });
  const rendered = renderTemplate(key, ctx);
  const content = numberTodos(rendered.content, primaryTaskNo(plan, entry));
  return {
    generatedFiles: [{ path: filePath, templateKey: key, language: rendered.language, content, label: rendered.label }],
    warnings,
  };
}

/* Which task owns a compiled feature — used to number its TODOs and to
   print the right `npm run check NN` in the generated code. */
function featureTaskNo(plan, featureId) {
  const t = arr(obj(plan).tasks).find((x) => x.featureId === featureId);
  return t ? String(t.order || 0).padStart(2, '0') : '';
}

/* The file's "primary" task: the earliest task (by order) that links it.
   Its 2-digit number keys the numbered TODOs and the guide steps. */
function primaryTaskNo(plan, entry) {
  if (!entry?.id) return '';
  const owners = arr(obj(plan).tasks)
    .filter((t) => arr(t.linkedFiles).includes(entry.id))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  return owners.length ? String(owners[0].order || 0).padStart(2, '0') : '';
}

/* Rewrite bare `TODO:` markers as `TODO(NN-k):` so the guide, the code and
   `scripts/check.mjs` all speak about the exact same work items. Markers that
   already carry a label (e.g. TODO(roles)) are left untouched. Deterministic:
   same content + task number in → same tags out. */
export function numberTodos(content = '', taskNo = '') {
  if (!taskNo) return content;
  let k = 0;
  return String(content).replace(/TODO:/g, () => `TODO(${taskNo}-${++k}):`);
}

/* Generate the connected file set for a task (its linkedFiles). */
export function generateForTask(plan = {}, taskId = '') {
  const p = obj(plan);
  const task = arr(p.tasks).find((t) => t.id === taskId);
  if (!task) return { generatedFiles: [], warnings: [`Task ${taskId} not found in the plan.`] };
  const fileById = new Map(arr(p.fileTree).map((f) => [f.id, f]));
  const files = arr(task.linkedFiles).map((id) => fileById.get(id)).filter(Boolean);
  const generatedFiles = [];
  const warnings = [];
  if (!files.length) warnings.push(`Task "${task.title}" has no linked starter files — it is planned for manual implementation.`);
  for (const f of files) {
    const out = generateForFile(p, f.path);
    generatedFiles.push(...out.generatedFiles);
    warnings.push(...out.warnings);
  }
  warnings.push('Generated files are STARTER CODE with TODOs — they are not verified or completed work.');
  return { generatedFiles, warnings, task: { id: task.id, title: task.title } };
}
