import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeResumeDocument, RESUME_DOCUMENT_VERSION } from '../server/utils/resume/resumeDocument.js';
import { makeRuntimeTemplateCatalog, SERVER_RUNTIME_TEMPLATE_CATALOG_VERSION } from '../server/utils/templateOs/runtimeCatalog.js';
import { makeTemplateStore, TEMPLATE_STORE_VERSION } from '../server/utils/templateOs/store.js';
import { rankTemplates } from '../server/utils/resume/templateRecommender.js';
import { TEMPLATE_OS_BUILTINS, BUILTIN_CERTIFICATION } from '../web/src/lib/templateOs/builtins.js';
import { RESUME_TEMPLATES, getResumeTemplate, templateVersionOf } from '../web/src/lib/resumeTemplateRegistry.js';
import {
  installRuntimeTemplateRows, installRuntimeTemplateVersionRow,
  clearRuntimeTemplateCatalog, RUNTIME_TEMPLATE_CATALOG_VERSION,
} from '../web/src/lib/runtimeTemplateCatalog.js';

const clone = (v) => structuredClone(v);
const base = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');
const alt = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'cloud-infrastructure-pro');

function proofDef(source, version) {
  return {
    ...clone(source),
    id: 'runtime-version-pin-proof',
    name: 'Runtime Version Pin Proof',
    version,
    status: 'PUBLISHED',
    license: { ...(source.license || {}), licenseStatus: 'INTERNAL_ORIGINAL', productionEnabled: true },
  };
}
const v1 = proofDef(base, 1);
const v2 = proofDef(alt, 2);
const cert = { ...(BUILTIN_CERTIFICATION['technical-sidebar'] || {}), certified: true, atsLevel: 'HIGH', evidence: 'real-pdf-text-layer' };
const row1 = { templateId: v1.id, version: 1, status: 'PUBLISHED', source: 'test', definition: v1, certification: cert };
const row2 = { templateId: v2.id, version: 2, status: 'PUBLISHED', source: 'test', definition: v2, certification: cert };

function fakeDb() {
  return {
    saveTemplateDefinition: async () => ({ ok: true, version: 3 }),
    listTemplateDefinitions: async () => [row2],
    getTemplateDefinition: async ({ templateId, version }) => {
      if (templateId !== v1.id) return null;
      if (Number(version) === 1) return row1;
      if (Number(version) === 2 || version == null) return row2;
      return null;
    },
  };
}


test('template store caches the database-authoritative version after process restart', async () => {
  const id = 'phase18-db-version-authority';
  const definition = { ...proofDef(base, 1), id, name: 'DB Version Authority' };
  const db = {
    saveTemplateDefinition: async () => ({ ok: true, version: 6 }),
    listTemplateDefinitions: async () => [],
    getTemplateDefinition: async () => null,
  };
  const store = makeTemplateStore(db, () => true);
  const saved = await store.save({ definition, status: 'DRAFT', source: 'test' });
  assert.match(TEMPLATE_STORE_VERSION, /db-authoritative-version/);
  assert.equal(saved.version, 6);
  const exact = await store.get(id, { version: 6 });
  assert.equal(exact.version, 6);
  assert.equal(exact.definition.version, 6);
});

test('canonical ResumeDocument preserves an exact templateVersion and keeps legacy docs unpinned', () => {
  const legacy = normalizeResumeDocument({ templateId: 'atlas' });
  const pinned = normalizeResumeDocument({ templateId: v1.id, templateVersion: 7 });
  assert.equal(legacy.templateVersion, null);
  assert.equal(pinned.templateVersion, 7);
  assert.match(RESUME_DOCUMENT_VERSION, /template-pin/);
});

test('server runtime catalog resolves latest and exact historical versions independently', async () => {
  const catalog = makeRuntimeTemplateCatalog(fakeDb(), () => true);
  assert.match(SERVER_RUNTIME_TEMPLATE_CATALOG_VERSION, /template-pin/);
  const latest = await catalog.resolve(v1.id);
  const exact = await catalog.resolve(v1.id, 1, { strictVersion: true });
  const missing = await catalog.resolve(v1.id, 99, { strictVersion: true });
  assert.equal(latest.templateVersion, 2);
  assert.equal(exact.templateVersion, 1);
  assert.equal(exact.definition.layout.type, v1.layout.type);
  assert.equal(missing, null);
});

test('pinDocument migrates legacy docs once but never upgrades an existing pin', async () => {
  const catalog = makeRuntimeTemplateCatalog(fakeDb(), () => true);
  const legacy = await catalog.pinDocument({ templateId: v1.id, templateVersion: null });
  const pinned = await catalog.pinDocument({ templateId: v1.id, templateVersion: 1 });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.pinned.templateVersion, 2);
  assert.equal(legacy.migratedLegacyPin, true);
  assert.equal(pinned.ok, true);
  assert.equal(pinned.pinned.templateVersion, 1);
  assert.equal(pinned.migratedLegacyPin, false);
});

test('client catalog can hydrate historical v1 while keeping v2 as latest gallery card', () => {
  clearRuntimeTemplateCatalog();
  installRuntimeTemplateRows([row2], { staticTemplates: RESUME_TEMPLATES });
  assert.match(RUNTIME_TEMPLATE_CATALOG_VERSION, /template-pin/);
  assert.equal(getResumeTemplate(v1.id).templateVersion, 2);
  assert.equal(getResumeTemplate(v1.id, 1, { strictVersion: true }), null);
  const hydrated = installRuntimeTemplateVersionRow(row1);
  assert.equal(hydrated.installed, true);
  assert.equal(getResumeTemplate(v1.id).templateVersion, 2);
  assert.equal(getResumeTemplate(v1.id, 1, { strictVersion: true }).templateVersion, 1);
  clearRuntimeTemplateCatalog();
});

test('template recommendations carry the exact template version selected', () => {
  clearRuntimeTemplateCatalog();
  installRuntimeTemplateRows([row2], { staticTemplates: RESUME_TEMPLATES });
  const templates = [...RESUME_TEMPLATES, getResumeTemplate(v1.id)];
  const doc = normalizeResumeDocument({ targetRole: 'Senior DevOps Engineer', experience: [{ company: 'A', role: 'DevOps Engineer', startDate: '2022-01', endDate: '2026-01', bullets: [{ text: 'Built deployment automation.' }] }] });
  const ranked = rankTemplates(templates, doc, { targetRole: 'Senior DevOps Engineer', atsPreference: 'high' });
  const proof = ranked.ranked.find((r) => r.id === v1.id);
  assert.equal(proof.templateVersion, 2);
  clearRuntimeTemplateCatalog();
});

test('static template version helper is deterministic', () => {
  assert.equal(templateVersionOf(getResumeTemplate('atlas')), 1);
  const builtin = getResumeTemplate('technical-sidebar');
  assert.equal(templateVersionOf(builtin), Number(builtin.definition.version || 1));
});

test('Resume Studio source pins version on selection, preview and export paths', async () => {
  const src = await readFile(new URL('../web/src/views/ResumeStudio.jsx', import.meta.url), 'utf8');
  assert.match(src, /withPinnedTemplate\(doc, t\)/);
  assert.match(src, /templateVersion:\s*templateVersionOf\(selectedTemplate\)/);
  assert.match(src, /getResumeTemplate\(debouncedDoc\.templateId, debouncedDoc\.templateVersion, \{ strictVersion:/);
  assert.match(src, /getResumeTemplate\(doc\.templateId, doc\.templateVersion, \{ strictVersion:/);
  assert.match(src, /TemplateOsApi\.get\(doc\.templateId, doc\.templateVersion\)/);
});

test('persistence schema and runtime server routes carry templateVersion', async () => {
  const db = await readFile(new URL('../db.js', import.meta.url), 'utf8');
  const routes = await readFile(new URL('../server/routes/resumeOsRoutes.js', import.meta.url), 'utf8');
  assert.match(db, /templateVersion:\s*\{ type: Number, default: null \}/);
  assert.match(db, /templateId templateVersion lastScore/);
  assert.match(routes, /pinDocument\(doc, \{ strictExisting: true \}\)/);
  assert.match(routes, /templateVersion:\s*Number\(template\?\.templateVersion/);
  assert.match(routes, /resolve\(doc\.templateId, doc\.templateVersion, \{ strictVersion:/);
});
