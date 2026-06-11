/* Guided Project Workspace — database model planner (deterministic). */
import { did, slug } from './planUtils.js';

export function planDatabaseModels(project = {}, stack = {}, entity = 'Item') {
  const f = stack.features || {};
  const type = stack.database === 'sql' ? 'table' : 'collection';
  const models = [];
  const add = (name, fields, relationships = []) => models.push({
    id: did('mdl', name),
    name, type, fields, relationships,
    linkedApis: [], linkedTasks: [],
    status: 'planned',
  });

  if (f.auth) {
    add('User', [
      { name: 'email', type: 'String', required: true, note: 'unique, lowercase' },
      { name: 'name', type: 'String' },
      { name: 'passwordHash', type: 'String', note: 'TODO: bcrypt — never store plaintext' },
      { name: 'role', type: 'String', note: `enum: user${f.admin ? ', admin' : ''}${f.recruiter ? ', recruiter' : ''}` },
      { name: 'createdAt', type: 'Date' },
    ]);
  }
  add(entity, [
    ...(f.auth ? [{ name: 'userId', type: 'ObjectId → User', required: true, note: 'owner; index' }] : []),
    { name: 'title', type: 'String', required: true },
    { name: 'description', type: 'String' },
    { name: 'status', type: 'String', note: 'enum: draft, active, archived' },
    ...(f.upload ? [{ name: 'fileName', type: 'String' }, { name: 'fileUrl', type: 'String', note: 'TODO: storage location' }, { name: 'fileSize', type: 'Number' }] : []),
    ...(f.ai ? [{ name: 'score', type: 'Number', note: 'deterministic backend scoring; AI never changes this number' }, { name: 'scoreBreakdown', type: 'Mixed' }] : []),
    { name: 'createdAt', type: 'Date' }, { name: 'updatedAt', type: 'Date' },
  ], f.auth ? [{ to: 'User', kind: 'belongsTo', via: 'userId' }] : []);

  if (f.payments) {
    add('PaymentRecord', [
      { name: 'userId', type: 'ObjectId → User', required: true },
      { name: 'orderId', type: 'String', note: 'gateway order id (sandbox)' },
      { name: 'amount', type: 'Number' },
      { name: 'status', type: 'String', note: 'created | paid | failed' },
      { name: 'createdAt', type: 'Date' },
    ], [{ to: 'User', kind: 'belongsTo', via: 'userId' }]);
  }
  return models.slice(0, 8);
}

/* Cross-link helper: attach api/model/task ids to each other after planning. */
export function linkPlan({ screens = [], apis = [], models = [], tasks = [] }) {
  const modelByName = new Map(models.map((m) => [m.name.toLowerCase(), m]));
  for (const api of apis) {
    if (api.linkedModel) {
      const m = modelByName.get(String(api.linkedModel).toLowerCase());
      if (m) { m.linkedApis.push(api.id); api.linkedModel = m.id; } else api.linkedModel = null;
    }
  }
  for (const scr of screens) {
    const screenSlug = slug(scr.name);
    for (const api of apis) {
      if (api.path.includes(screenSlug) || (scr.name === 'Dashboard' && /GET \/api\/\w+s$/.test(`${api.method} ${api.path}`))) {
        scr.linkedApis.push(api.id);
        if (!api.linkedScreen) api.linkedScreen = scr.id;
      }
    }
  }
  for (const t of tasks) {
    for (const id of t.linkedApis || []) {
      const api = apis.find((a) => a.id === id);
      if (api) api.linkedTask = t.id;
    }
    for (const id of t.linkedModels || []) {
      const m = models.find((x) => x.id === id);
      if (m) m.linkedTasks.push(t.id);
    }
    for (const id of t.linkedScreens || []) {
      const s = screens.find((x) => x.id === id);
      if (s) s.linkedTasks.push(t.id);
    }
  }
  return { screens, apis, models, tasks };
}
