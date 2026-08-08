/* Guided Project Workspace — database model planner (deterministic). */
import { did, slug } from './planUtils.js';

export function planDatabaseModels(project = {}, stack = {}, entity = 'Item', domain = null) {
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
  /* v2: fields come from the domain model when one was inferred, so the
     Database tab shows the student's real vocabulary (fullName, followUpAt,
     invoiceNumber…) instead of a generic title/description/status triple. */
  const domainEntities = Array.isArray(domain?.entities) ? domain.entities : [];
  if (domainEntities.length) {
    for (const ent of domainEntities) {
      add(ent.name, [
        ...ent.fields.map((fl) => ({
          name: fl.name,
          type: docType(fl),
          required: !!fl.required,
          note: fieldNote(fl),
        })),
        ...(f.upload && ent.role === 'primary' ? [{ name: 'fileName', type: 'String' }, { name: 'fileUrl', type: 'String', note: 'TODO: storage location' }] : []),
        ...(f.ai && ent.role === 'primary' ? [{ name: 'score', type: 'Number', note: 'deterministic backend scoring; AI never changes this number' }] : []),
        { name: 'createdAt', type: 'Date' }, { name: 'updatedAt', type: 'Date' },
      ], ent.fields.filter((fl) => fl.ref).map((fl) => ({ to: fl.ref, kind: 'belongsTo', via: fl.name })));
    }
  } else {
    add(entity, [
      ...(f.auth ? [{ name: 'userId', type: 'ObjectId → User', required: true, note: 'owner; index' }] : []),
      { name: 'title', type: 'String', required: true },
      { name: 'description', type: 'String' },
      { name: 'status', type: 'String', note: 'enum: draft, active, archived' },
      { name: 'createdAt', type: 'Date' }, { name: 'updatedAt', type: 'Date' },
    ], f.auth ? [{ to: 'User', kind: 'belongsTo', via: 'userId' }] : []);
  }

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

/* Human-readable type for the Database tab. */
function docType(fl) {
  switch (fl.type) {
    case 'number': return 'Number';
    case 'boolean': return 'Boolean';
    case 'date': return 'Date';
    case 'ref': return `ObjectId → ${fl.ref}`;
    default: return 'String';
  }
}
function fieldNote(fl) {
  if (fl.type === 'enum' && fl.enumValues?.length) return `enum: ${fl.enumValues.join(', ')}`;
  if (fl.ref) return 'relation; index';
  if (fl.type === 'email') return 'validated as an email address';
  if (fl.type === 'phone') return 'store in E.164 form (+91…)';
  return '';
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
