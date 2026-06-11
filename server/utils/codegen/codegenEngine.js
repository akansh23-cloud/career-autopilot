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
  };
  if (!fileEntry) return base;

  // Per-file specialization derived from the planned path.
  const m = path.match(/views\/([A-Za-z0-9]+)\.jsx$/);
  if (m) base.componentName = m[1];
  const cm = path.match(/components\/([A-Za-z0-9]+)\.jsx$/);
  if (cm) base.componentName = cm[1];
  if (/health\.routes/.test(path)) base.routeKind = 'health';
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
  return {
    generatedFiles: [{ path: filePath, templateKey: key, language: rendered.language, content: rendered.content, label: rendered.label }],
    warnings,
  };
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
