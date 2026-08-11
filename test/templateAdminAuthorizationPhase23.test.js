import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TEMPLATE_ADMIN_AUTH_VERSION, TEMPLATE_ADMIN_CAPABILITIES,
  isRuntimeCatalogRequest, isProductionPublishedTemplate,
  publicTemplateProjection, safeTemplateAudit,
} from '../server/utils/templateOs/adminPolicy.js';
import { makeTemplateStore } from '../server/utils/templateOs/store.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { VERB_DICTIONARY, verbInfo, verbAlternatives } from '../server/utils/resume/grammarLibrary.js';
import { ROLE_ACTION_VERBS } from '../server/utils/resume/roleDictionaries.js';

const routeSource = fs.readFileSync(new URL('../server/routes/templateOsRoutes.js', import.meta.url), 'utf8');
const builderSource = fs.readFileSync(new URL('../web/src/views/TemplateBuilder.jsx', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../web/src/lib/templateOsApi.js', import.meta.url), 'utf8');

function routeLine(path) {
  return routeSource.split('\n').find((line) => line.includes(path)) || '';
}

test('Phase 23 authorization policy separates runtime catalog reads from builder administration', () => {
  assert.equal(TEMPLATE_ADMIN_AUTH_VERSION, 'template-admin-auth-v1-server-authoritative');
  assert.ok(TEMPLATE_ADMIN_CAPABILITIES.length >= 8);
  assert.equal(isRuntimeCatalogRequest({ query: { catalog: '1', publishedOnly: '1' } }), true);
  assert.equal(isRuntimeCatalogRequest({ query: { catalog: '1' } }), false);
  assert.equal(isRuntimeCatalogRequest({ query: { publishedOnly: '1' } }), false);
  assert.equal(isRuntimeCatalogRequest({ query: {} }), false);

  const published = { templateId: 'x', version: 2, status: 'PUBLISHED', source: 'db', definition: { id: 'x', license: { licenseStatus: 'INTERNAL_ORIGINAL', productionEnabled: true } }, certification: { certified: true }, createdBy: 'private@example.com', internalNote: 'secret' };
  assert.equal(isProductionPublishedTemplate(published), true);
  assert.equal(isProductionPublishedTemplate({ ...published, status: 'DRAFT' }), false);
  assert.equal(isProductionPublishedTemplate({ ...published, definition: { ...published.definition, license: { licenseStatus: 'INTERNAL_ORIGINAL', productionEnabled: false } } }), false);
  assert.equal(isProductionPublishedTemplate({ ...published, definition: { ...published.definition, license: { productionEnabled: true } } }), false, 'missing explicit cleared license state must fail closed');
  const projection = publicTemplateProjection(published);
  assert.equal(projection.templateId, 'x');
  assert.equal(projection.createdBy, undefined);
  assert.equal(projection.internalNote, undefined);
});

test('Phase 23 API wiring makes every Template Builder operation server-admin-only', () => {
  for (const path of [
    "/api/template-os/validate", "/api/template-os/save", "/api/template-os/import", "/api/template-os/generate",
    "/api/template-os/certify", "/api/template-os/thumbnail", "/api/template-os/import-package", "/api/template-os/status",
  ]) {
    const line = routeLine(path);
    assert.ok(line.includes('requireAuth'), path);
    assert.ok(line.includes('requireTemplateAdmin'), `${path} missing server-side admin guard`);
  }
  assert.ok(routeLine('/api/template-os/admin/access').includes('requireTemplateAdmin'));
  assert.ok(routeLine("/api/template-os/templates',").includes('requireAdminUnlessRuntimeCatalog'));
  assert.ok(routeSource.includes("if (!isProductionPublishedTemplate(row)) return res.status(404).json({ ok: false, error: 'not_found' });"), 'render/export must reject unpublished definitions');
  assert.ok(routeSource.includes("error: 'not_deep_certified'"), 'publish must require deep real-PDF certification');
  assert.ok(routeSource.includes("def.license = { ...def.license, licenseStatus: 'LICENSE_PENDING', productionEnabled: false };"), 'external JSON import must not self-clear licensing');
});

test('Template Builder trusts the server access probe and binds save/certify/publish to an exact stored version', () => {
  assert.ok(apiSource.includes("adminAccess: () => api.get('/api/template-os/admin/access')"));
  assert.ok(apiSource.includes("saveDefinition: (payload) => api.post('/api/template-os/save', payload)"));
  assert.ok(builderSource.includes('TemplateOsApi.adminAccess()'));
  assert.ok(!builderSource.includes("const isAdmin = user?.role === 'admin'"));
  assert.ok(builderSource.includes('TemplateOsApi.saveDefinition({ definition: draft,'));
  assert.ok(builderSource.includes('templateId: draft.id, version: activeVersion'));
  assert.ok(builderSource.includes('version: activeVersion, status: \'PUBLISHED\''));
  assert.ok(builderSource.includes('savedFingerprint === draftFingerprint'));
  assert.ok(builderSource.includes('certifiedFingerprint === draftFingerprint'));
});

test('Template store can bind a deep certification to the exact immutable version without creating another version', async () => {
  const store = makeTemplateStore({}, () => false);
  const def = structuredClone(TEMPLATE_OS_BUILTINS.find((x) => x.id === 'editorial-professional'));
  def.id = 'phase23-cert-binding';
  def.name = 'Phase 23 Cert Binding';
  def.version = 1;
  const saved = await store.save({ definition: def, status: 'DRAFT', source: 'builder', certification: { certified: true, evidence: 'html-estimate' } });
  assert.equal(saved.version, 1);
  const certification = { certified: true, evidence: 'real-pdf-text-layer', atsLevel: 'VERY_HIGH' };
  const updated = await store.setCertification({ templateId: def.id, version: 1, certification });
  assert.equal(updated.ok, true);
  const row = await store.get(def.id, { version: 1 });
  assert.deepEqual(row.certification, certification);
  assert.equal(row.version, 1);
});

test('admin audit projection is bounded and never carries request bodies or user-controlled nested data', () => {
  const audit = safeTemplateAudit({ action: 'status'.repeat(30), templateId: 'x'.repeat(200), version: '3', status: 'PUBLISHED', source: 'builder', body: { secret: true } });
  assert.ok(audit.action.length <= 64);
  assert.ok(audit.templateId.length <= 80);
  assert.equal(audit.version, 3);
  assert.equal(audit.body, undefined);
  assert.deepEqual(Object.keys(audit).sort(), ['action', 'source', 'status', 'templateId', 'version'].sort());
});

test('Phase 23 vocabulary adds precise technical and professional alternatives while all role actions remain recognized', () => {
  assert.ok(Object.keys(VERB_DICTIONARY).length >= 285);
  for (const word of ['modularized', 'encapsulated', 'outlined', 'refined', 'shielded', 'probed', 'cooperated', 'interfaced', 'reshaped', 'captured', 'chronicled', 'clarified', 'showcased', 'extrapolated', 'rectified', 'corrected']) {
    assert.ok(verbInfo(word), word);
  }
  assert.deepEqual(verbAlternatives('fix', 3), ['rectify', 'correct', 'repair']);
  assert.ok(verbAlternatives('document', 20).includes('capture'));
  assert.ok(verbAlternatives('transform', 20).includes('reinvent'));
  for (const [role, verbs] of Object.entries(ROLE_ACTION_VERBS)) {
    for (const verb of verbs) assert.ok(verbInfo(verb), `${role}: ${verb}`);
  }
});
