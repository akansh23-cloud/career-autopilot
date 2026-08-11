import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { RESUME_TEMPLATES, getResumeTemplate, getResumeTemplateCatalog } from '../web/src/lib/resumeTemplateRegistry.js';
import {
  installRuntimeTemplateRows, clearRuntimeTemplateCatalog,
  getRuntimeTemplateCards, mergeTemplateCatalog,
  RUNTIME_TEMPLATE_CATALOG_VERSION,
} from '../web/src/lib/runtimeTemplateCatalog.js';
import { TEMPLATE_OS_BUILTINS, BUILTIN_CERTIFICATION } from '../web/src/lib/templateOs/builtins.js';
import { makeTemplateStore } from '../server/utils/templateOs/store.js';
import { makeRuntimeTemplateCatalog, SERVER_RUNTIME_TEMPLATE_CATALOG_VERSION } from '../server/utils/templateOs/runtimeCatalog.js';
import { compileTemplate, adaptTreeToShape } from '../web/src/lib/templateOs/compiler.js';
import { analyzeResumeShape } from '../web/src/lib/templateOs/shape.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { getTemplatePreviewStructured } from '../web/src/lib/templateOs/previewFixtures.js';
import { rankTemplates } from '../server/utils/resume/templateRecommender.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const clone = (x) => JSON.parse(JSON.stringify(x));

function runtimeDef(id = 'runtime-market-pro', version = 2) {
  const base = clone(TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional'));
  return {
    ...base,
    id,
    name: 'Runtime Market Pro',
    version,
    status: 'PUBLISHED',
    license: { ...(base.license || {}), licenseStatus: 'INTERNAL_ORIGINAL', productionEnabled: true },
  };
}

test('Phase 17 client catalog: only published production rows install; static catalog is not mutated', () => {
  clearRuntimeTemplateCatalog();
  const staticCount = RESUME_TEMPLATES.length;
  const def = runtimeDef();
  const result = installRuntimeTemplateRows([
    { templateId: def.id, version: 2, status: 'PUBLISHED', source: 'db', definition: def, certification: { certified: true, atsLevel: 'HIGH', evidence: 'real-pdf-text-layer' } },
    { templateId: 'draft-hidden', version: 1, status: 'DRAFT', source: 'db', definition: { ...def, id: 'draft-hidden' } },
    { templateId: 'license-hidden', version: 1, status: 'PUBLISHED', source: 'db', definition: { ...def, id: 'license-hidden', license: { licenseStatus: 'LICENSE_PENDING', productionEnabled: false } } },
  ], { staticTemplates: RESUME_TEMPLATES });

  assert.equal(result.version, RUNTIME_TEMPLATE_CATALOG_VERSION);
  assert.equal(result.installed, 1);
  assert.equal(result.rejected, 2);
  assert.equal(RESUME_TEMPLATES.length, staticCount, 'runtime install must not mutate code-shipped registry');
  assert.equal(getRuntimeTemplateCards().length, 1);

  const catalog = getResumeTemplateCatalog();
  assert.equal(catalog.length, staticCount + 1);
  const card = catalog.find((t) => t.id === def.id);
  assert.ok(card);
  assert.equal(card.runtime, true);
  assert.equal(card.templateVersion, 2);
  assert.equal(card.certification.certified, true);
  assert.equal(getResumeTemplate(def.id).id, def.id, 'normal resolver must see installed runtime cards');
  clearRuntimeTemplateCatalog();
});

test('Phase 17 client catalog: newer stored definition replaces same static id; builtin snapshot is skipped', () => {
  clearRuntimeTemplateCatalog();
  const staticDef = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional');
  const builtinRow = {
    templateId: staticDef.id, version: staticDef.version, status: 'PUBLISHED', source: 'builtin', definition: clone(staticDef),
    certification: BUILTIN_CERTIFICATION[staticDef.id],
  };
  let result = installRuntimeTemplateRows([builtinRow], { staticTemplates: RESUME_TEMPLATES });
  assert.equal(result.installed, 0);
  assert.equal(result.skippedBuiltins, 1);

  const upgraded = { ...clone(staticDef), version: Number(staticDef.version || 1) + 1, name: 'Editorial Professional Runtime V2' };
  result = installRuntimeTemplateRows([{
    templateId: upgraded.id, version: upgraded.version, status: 'PUBLISHED', source: 'db', definition: upgraded,
    certification: { certified: true, atsLevel: 'VERY_HIGH', evidence: 'real-pdf-text-layer' },
  }], { staticTemplates: RESUME_TEMPLATES });
  assert.equal(result.installed, 1);
  const merged = mergeTemplateCatalog(RESUME_TEMPLATES);
  assert.equal(merged.length, RESUME_TEMPLATES.length, 'same-id runtime upgrade replaces; it does not duplicate');
  assert.equal(getResumeTemplate('editorial-professional').name, 'Editorial Professional Runtime V2');
  assert.equal(getResumeTemplate('editorial-professional').templateVersion, upgraded.version);
  clearRuntimeTemplateCatalog();
});

test('Phase 17 server catalog: stored drafts are invisible until published; published definition participates in resolution', async () => {
  const store = makeTemplateStore(null, () => false);
  const serverCatalog = makeRuntimeTemplateCatalog(null, () => false);
  assert.equal(serverCatalog.version, SERVER_RUNTIME_TEMPLATE_CATALOG_VERSION);

  const def = runtimeDef('server-runtime-phase17', 1);
  const saved = await store.save({
    definition: def, status: 'DRAFT', source: 'test',
    certification: { certified: true, atsLevel: 'HIGH', evidence: 'real-pdf-text-layer' },
  });
  let cards = await serverCatalog.listPublishedCards();
  assert.equal(cards.some((t) => t.id === def.id), false, 'draft must not enter Resume OS runtime catalog');

  await store.setStatus({ templateId: def.id, version: saved.version, status: 'PUBLISHED' });
  cards = await serverCatalog.listPublishedCards();
  const published = cards.find((t) => t.id === def.id);
  assert.ok(published, 'published runtime definition must enter Resume OS catalog');
  assert.equal(published.engine, 'template-os');
  assert.equal(published.templateVersion, saved.version);
  assert.equal((await serverCatalog.resolve(def.id)).id, def.id);
});


test('Phase 17 runtime-only card renders through Template OS and participates in deterministic ranking', () => {
  clearRuntimeTemplateCatalog();
  const def = runtimeDef('runtime-renderable-phase17', 4);
  def.supportedRoles = ['devops', 'cloud', 'platform', 'sre'];
  installRuntimeTemplateRows([{
    templateId: def.id, version: def.version, status: 'PUBLISHED', source: 'db', definition: def,
    certification: { certified: true, atsLevel: 'HIGH', evidence: 'real-pdf-text-layer' },
  }], { staticTemplates: RESUME_TEMPLATES });

  assert.equal(RESUME_TEMPLATES.some((t) => t.id === def.id), false, 'proof template must not be code-shipped');
  const card = getResumeTemplate(def.id);
  const structured = getTemplatePreviewStructured(card);
  const compiled = adaptTreeToShape(compileTemplate(card.definition), analyzeResumeShape(structured, { targetRole: 'DevOps Engineer' }));
  const pdf = renderTemplatePdf(compiled, structured, { sizeId: 'a4' });
  assert.equal(pdf.pageCount >= 1, true);
  assert.equal(Buffer.from(pdf.bytes).subarray(0, 5).toString(), '%PDF-');

  const ranked = rankTemplates(getResumeTemplateCatalog(), { ...structured, targetRole: 'DevOps Engineer' }, { targetRole: 'DevOps Engineer', atsPreference: 'high', pageTarget: 1 });
  assert.ok(ranked.ranked.some((t) => t.id === def.id), 'published runtime card must participate in deterministic recommendation');
  clearRuntimeTemplateCatalog();
});

test('Phase 17 wiring: catalog API returns definitions and Resume Studio consumes merged runtime catalog with preview fallback', () => {
  const routes = readFileSync(join(root, 'server/routes/templateOsRoutes.js'), 'utf8');
  const studio = readFileSync(join(root, 'web/src/views/ResumeStudio.jsx'), 'utf8');
  const api = readFileSync(join(root, 'web/src/lib/templateOsApi.js'), 'utf8');
  const resumeRoutes = readFileSync(join(root, 'server/routes/resumeOsRoutes.js'), 'utf8');

  assert.match(routes, /publishedOnly/);
  assert.match(routes, /catalog \? \{ \.\.\.base, definition: t\.definition, certification \}/);
  assert.match(api, /templates\?catalog=1&publishedOnly=1/);
  assert.match(studio, /installRuntimeTemplateRows\(catalog\.templates/);
  assert.match(studio, /templates=\{templateCatalog\}/);
  assert.match(studio, /fallbackPreviewOnError/);
  assert.match(studio, /RUNTIME · V/);
  assert.match(resumeRoutes, /runtimeTemplates\.listPublishedCards\(\)/);
  assert.match(resumeRoutes, /runtimeTemplates\.resolve\(doc\.templateId, doc\.templateVersion, \{ strictVersion:/);
});
