/* Codegen — template registry. The ONLY way starter code is produced:
   no template key → no file. This is also the security allowlist for
   the starter pack ZIP. */
import { TEMPLATES } from './templates.js';

export function listTemplates() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, language: t.language }));
}
export function hasTemplate(key) { return Object.prototype.hasOwnProperty.call(TEMPLATES, String(key || '')); }
export function renderTemplate(key, ctx = {}) {
  if (!hasTemplate(key)) throw new Error(`Unknown template key: ${key}`);
  const t = TEMPLATES[key];
  return { templateKey: key, label: t.label, language: t.language, content: t.render(ctx) };
}
