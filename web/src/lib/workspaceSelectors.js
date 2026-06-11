// Guided Project Workspace v1 — pure selectors/helpers.
// No React, no fetch — unit-testable with node --test.

export const WORKSPACE_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'visual', label: 'Visual Preview' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'files', label: 'Files' },
  { id: 'apis', label: 'APIs' },
  { id: 'database', label: 'Database' },
  { id: 'tests', label: 'Tests' },
  { id: 'deployment', label: 'Deployment' },
  { id: 'proof', label: 'Proof' },
  { id: 'patent', label: 'Patent' },
];

export const TASK_COLUMNS = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'ready', label: 'Ready' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'done', label: 'Done' },
  { id: 'verified', label: 'Verified' },
];

export const STATUS_TONE = {
  planned: 'default', generated: 'cyan', backlog: 'default', ready: 'cyan',
  in_progress: 'amber', blocked: 'rose', done: 'mint', verified: 'violet',
  pending: 'default', passed: 'mint', failed: 'rose',
};

export function statusLabel(s = '') {
  const map = {
    backlog: 'Backlog', ready: 'Ready', in_progress: 'In Progress', blocked: 'Blocked',
    done: 'Done', verified: 'Verified', planned: 'Planned', generated: 'Generated', pending: 'Pending',
  };
  return map[s] || (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Planned');
}

export function tasksByColumn(plan) {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const cols = {};
  for (const c of TASK_COLUMNS) cols[c.id] = [];
  for (const t of tasks) (cols[t.status] || cols.backlog).push(t);
  return cols;
}

export function progressOf(plan) {
  const p = plan?.progress || {};
  return {
    totalTasks: p.totalTasks ?? (plan?.tasks?.length || 0),
    doneTasks: p.doneTasks ?? 0,
    verifiedTasks: p.verifiedTasks ?? 0,
    blockedTasks: p.blockedTasks ?? 0,
    percentDone: p.percentDone ?? 0,
    percentVerified: p.percentVerified ?? 0,
  };
}

export function designScoreOf(plan) {
  const a = plan?.architecture || {};
  return a.designScore ?? a.validation?.score?.overallScore ?? null;
}

export function findById(list, id) {
  if (!Array.isArray(list) || !id) return null;
  return list.find((x) => x?.id === id || x?.path === id) || null;
}

export function itemForInspector(plan, selected) {
  if (!plan || !selected?.type || !selected?.id) return null;
  const { type, id } = selected;
  switch (type) {
    case 'task': return { type, item: findById(plan.tasks, id) };
    case 'file': return { type, item: findById(plan.fileTree, id) };
    case 'api': return { type, item: findById(plan.apiPlan, id) };
    case 'model': return { type, item: findById(plan.databaseModels, id) };
    case 'screen': return { type, item: findById(plan.visualPreview?.screens, id) };
    case 'proof': return { type, item: findById(plan.proofRequirements, id) };
    case 'test': return { type, item: findById(plan.testPlan, id) };
    default: return null;
  }
}

export function linkedEntities(plan, task) {
  if (!plan || !task) return { files: [], apis: [], models: [], screens: [] };
  const pick = (list, ids, key = 'id') =>
    (Array.isArray(ids) ? ids : []).map((i) => (list || []).find((x) => x?.[key] === i)).filter(Boolean);
  return {
    files: pick(plan.fileTree, task.linkedFiles, 'id'),
    apis: pick(plan.apiPlan, task.linkedApis),
    models: pick(plan.databaseModels, task.linkedModels),
    screens: pick(plan.visualPreview?.screens, task.linkedScreens),
  };
}

export function fileBadge(file) {
  if (!file) return 'Planned';
  if (file.verificationStatus === 'verified') return 'Verified';
  if (file.status === 'generated') return 'Generated';
  if (file.templateKey && file.starterPackIncluded) return 'Starter template';
  if (file.templateKey) return 'Template available';
  return 'Manual — you implement this';
}

/* Mirrors the plan onto the project object stored client-side so the
   workspace survives a DB-less backend. */
export function mergePlanIntoProject(project, workspacePlan) {
  if (!project) return project;
  return { ...project, workspacePlan, workspacePlanUpdatedAt: new Date().toISOString() };
}

/* Tolerates strings, arrays, null or missing — Patent tab safety. */
export function asList(v) {
  if (Array.isArray(v)) return v.filter((x) => x != null && String(x).trim() !== '');
  if (v == null || v === '') return [];
  return [v];
}

export function validCustomInput(form = {}) {
  const errors = [];
  if (!String(form.title || '').trim()) errors.push('Project title is required.');
  if (!String(form.problemStatement || '').trim()) errors.push('Problem statement is required.');
  return { ok: errors.length === 0, errors };
}
