/* Guided Project Workspace — API planner (deterministic). */
import { did, slug, camel } from './planUtils.js';

export function planApis(project = {}, stack = {}, entity = 'Item') {
  const f = stack.features || {};
  const e = slug(entity);
  const apis = [];
  const add = (method, path, purpose, opts = {}) => apis.push({
    id: did('api', method, path),
    method, path, purpose,
    authRequired: opts.auth !== false,
    roles: opts.roles || ['user'],
    requestBody: opts.req || null,
    responseBody: opts.res || null,
    linkedScreen: opts.screen || null,
    linkedModel: opts.model || null,
    linkedTask: null,
    status: 'planned',
  });

  add('GET', '/api/health', 'Liveness check: returns ok + db status. Used by deployment health checks.', { auth: false, res: '{ ok, db, uptime }' });
  if (f.auth) {
    add('POST', '/api/auth/login', 'Start a session (TODO: wire real credential/OAuth check).', { auth: false, req: '{ email, password }', res: '{ ok, user }', model: 'User' });
    add('POST', '/api/auth/logout', 'Destroy the session.', { res: '{ ok }' });
    add('GET', '/api/auth/me', 'Return the signed-in user.', { res: '{ user }', model: 'User' });
  }
  add('GET', `/api/${e}s`, `List the signed-in user's ${entity.toLowerCase()}s.`, { res: `{ items: ${entity}[] }`, model: entity });
  add('POST', `/api/${e}s`, `Create a ${entity.toLowerCase()}.`, { req: `{ ${camel(entity)} fields }`, res: `{ item: ${entity} }`, model: entity });
  add('GET', `/api/${e}s/:id`, `Fetch one ${entity.toLowerCase()}.`, { res: `{ item: ${entity} }`, model: entity });
  add('PATCH', `/api/${e}s/:id`, `Update a ${entity.toLowerCase()}.`, { req: '{ partial fields }', res: '{ item }', model: entity });
  add('DELETE', `/api/${e}s/:id`, `Delete a ${entity.toLowerCase()}.`, { res: '{ ok }', model: entity });
  if (f.upload) add('POST', `/api/${e}s/upload`, `Upload a ${entity.toLowerCase()} file (multipart). TODO: pick storage (disk/S3).`, { req: 'multipart/form-data file', res: '{ item, fileMeta }', model: entity });
  if (f.ai) add('POST', `/api/${e}s/:id/score`, 'Run scoring. v1 is a deterministic placeholder — backend owns the numbers; AI adds prose only.', { res: '{ score, breakdown }', model: entity });
  if (f.payments) add('POST', '/api/payments/order', 'Create a payment order (SANDBOX only; secrets via env, never committed).', { req: '{ amount }', res: '{ orderId }' });
  if (f.admin) add('GET', '/api/admin/users', 'Admin-only user list.', { roles: ['admin'], res: '{ users }', model: 'User' });
  if (f.recruiter) add('GET', '/api/recruiter/candidates', 'Recruiter-role candidate list.', { roles: ['recruiter'], res: '{ candidates }' });
  return apis.slice(0, 20);
}
