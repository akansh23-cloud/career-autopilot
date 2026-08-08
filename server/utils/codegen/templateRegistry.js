/* Codegen — template registry. The ONLY way starter code is produced:
   no template key → no file. This is also the security allowlist for
   the starter pack ZIP.

   Two generations live here:
   - TEMPLATES     (v1) generic skeletons, still used for auth/upload/docs
   - TEMPLATES_V2  (v2) schema-driven, runnable, test-backed buildable code

   v2 keys win on collision, so upgrading a file type is a one-line
   change in fileTreePlanner (point the path at the v2 key). */
import { TEMPLATES } from './templates.js';
import { TEMPLATES_V2 } from './templatesV2.js';

const ALL = { ...TEMPLATES, ...TEMPLATES_V2 };

export function listTemplates() {
  return Object.entries(ALL).map(([key, t]) => ({ key, label: t.label, language: t.language }));
}
export function hasTemplate(key) { return Object.prototype.hasOwnProperty.call(ALL, String(key || '')); }
export function renderTemplate(key, ctx = {}) {
  if (!hasTemplate(key)) throw new Error(`Unknown template key: ${key}`);
  const t = ALL[key];
  return { templateKey: key, label: t.label, language: t.language, content: t.render(ctx) };
}
export { ALL as TEMPLATE_MAP };
