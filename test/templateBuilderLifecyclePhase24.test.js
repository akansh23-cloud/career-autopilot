import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TEMPLATE_LIFECYCLE_VERSION, TEMPLATE_PRIMARY_LIFECYCLE,
  canTransitionTemplate, templateLifecycleSummary, templateDefinitionFingerprint,
} from '../web/src/lib/templateOs/lifecycle.js';
import { makeTemplateStore, TEMPLATE_STORE_VERSION } from '../server/utils/templateOs/store.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { VERB_DICTIONARY, VERB_GROUPS, verbInfo, verbAlternatives } from '../server/utils/resume/grammarLibrary.js';
import { ROLE_ACTION_VERBS } from '../server/utils/resume/roleDictionaries.js';

const routeSource = fs.readFileSync(new URL('../server/routes/templateOsRoutes.js', import.meta.url), 'utf8');
const builderSource = fs.readFileSync(new URL('../web/src/views/TemplateBuilder.jsx', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../web/src/lib/templateOsApi.js', import.meta.url), 'utf8');
const dbSource = fs.readFileSync(new URL('../db.js', import.meta.url), 'utf8');

const deepCert = { certified: true, evidence: 'real-pdf-text-layer', atsLevel: 'VERY_HIGH', minIntegrity: 98, minOrderScore: 97 };
function row(status = 'DRAFT', { certified = false, license = true } = {}) {
  return {
    templateId: 'phase24', version: 1, status,
    definition: { id: 'phase24', license: { licenseStatus: license ? 'INTERNAL_ORIGINAL' : 'LICENSE_PENDING', productionEnabled: license } },
    certification: certified ? deepCert : { certified: false, evidence: 'html-estimate' },
  };
}

test('Phase 24 lifecycle is an explicit Draft → Validating → Certified → Approved → Published state machine', () => {
  assert.match(TEMPLATE_LIFECYCLE_VERSION, /immutable-approval/);
  assert.deepEqual(TEMPLATE_PRIMARY_LIFECYCLE, ['DRAFT', 'VALIDATING', 'CERTIFIED', 'APPROVED', 'PUBLISHED']);
  assert.equal(canTransitionTemplate(row('DRAFT'), 'VALIDATING').ok, true);
  assert.equal(canTransitionTemplate(row('DRAFT'), 'PUBLISHED').ok, false, 'publish cannot skip lifecycle gates');
  assert.equal(canTransitionTemplate(row('VALIDATING', { certified: true }), 'CERTIFIED').ok, true);
  assert.equal(canTransitionTemplate(row('CERTIFIED', { certified: true, license: false }), 'APPROVED').error, 'license_clearance_required');
  assert.equal(canTransitionTemplate(row('CERTIFIED', { certified: true, license: true }), 'APPROVED').ok, true);
  assert.equal(canTransitionTemplate(row('APPROVED', { certified: true, license: true }), 'PUBLISHED').ok, true);
  assert.equal(canTransitionTemplate(row('PUBLISHED', { certified: true }), 'DRAFT').ok, false, 'published content cannot be reopened in place');
  assert.equal(canTransitionTemplate(row('PUBLISHED', { certified: true }), 'DISABLED').ok, true);
});

test('lifecycle summary exposes release gates without pretending an uncertified draft is production-ready', () => {
  const draft = templateLifecycleSummary(row('DRAFT'));
  assert.equal(draft.gates.certify, true);
  assert.equal(draft.gates.approve, false);
  assert.equal(draft.gates.publish, false);
  const certified = templateLifecycleSummary(row('CERTIFIED', { certified: true, license: true }));
  assert.equal(certified.deepCertified, true);
  assert.equal(certified.licenseCleared, true);
  assert.equal(certified.gates.approve, true);
  const published = templateLifecycleSummary(row('PUBLISHED', { certified: true, license: true }));
  assert.equal(published.gates.forkToEdit, true);
  assert.equal(published.published, true);
});

test('definition fingerprint ignores lifecycle metadata but treats license/design changes as real content edits', () => {
  const base = structuredClone(TEMPLATE_OS_BUILTINS.find((x) => x.id === 'editorial-professional'));
  const f1 = templateDefinitionFingerprint({ ...base, version: 1, status: 'DRAFT', certification: null, atsLevel: 'HIGH' });
  const f2 = templateDefinitionFingerprint({ ...base, version: 9, status: 'PUBLISHED', certification: deepCert, atsLevel: 'VERY_HIGH' });
  assert.equal(f1, f2);
  const changedLicense = structuredClone(base);
  changedLicense.license = { ...changedLicense.license, licenseStatus: 'LICENSED', source: 'new-license-proof' };
  assert.notEqual(f1, templateDefinitionFingerprint(changedLicense));
  const changedDesign = structuredClone(base);
  changedDesign.description = `${changedDesign.description} revised`;
  assert.notEqual(f1, templateDefinitionFingerprint(changedDesign));
});

test('template store preserves lifecycle history and published v1 while a content edit forks immutable v2', async () => {
  const store = makeTemplateStore({}, () => false);
  const def = structuredClone(TEMPLATE_OS_BUILTINS.find((x) => x.id === 'editorial-professional'));
  def.id = 'phase24-lifecycle-store-proof'; def.name = 'Phase 24 Lifecycle Store Proof'; def.version = 1; def.status = 'DRAFT';
  const first = await store.save({ definition: def, status: 'DRAFT', source: 'builder', createdBy: 'admin@example.com' });
  assert.match(TEMPLATE_STORE_VERSION, /lifecycle-history/);
  await store.setStatus({ templateId: def.id, version: first.version, status: 'VALIDATING', actor: 'admin@example.com', reason: 'cert-start' });
  await store.setCertification({ templateId: def.id, version: first.version, certification: deepCert });
  await store.setStatus({ templateId: def.id, version: first.version, status: 'CERTIFIED', actor: 'admin@example.com', reason: 'cert-pass' });
  await store.setStatus({ templateId: def.id, version: first.version, status: 'APPROVED', actor: 'reviewer@example.com', reason: 'release-approval' });
  await store.setStatus({ templateId: def.id, version: first.version, status: 'PUBLISHED', actor: 'admin@example.com', reason: 'publish' });
  const edited = { ...def, description: 'New immutable revision' };
  const second = await store.save({ definition: edited, status: 'DRAFT', source: 'builder', createdBy: 'admin@example.com', baseVersion: 1, changeNote: 'Premium spacing revision' });
  assert.equal(second.version, 2);
  const history = await store.history(def.id);
  assert.equal(history.length, 2);
  const v2 = history.find((x) => x.version === 2);
  const v1 = history.find((x) => x.version === 1);
  assert.equal(v2.status, 'DRAFT');
  assert.equal(v2.baseVersion, 1);
  assert.equal(v1.status, 'PUBLISHED');
  assert.equal(v1.lifecycle.history.at(-1).to, 'PUBLISHED');
  assert.equal(v1.lifecycle.approvedBy, 'reviewer@example.com');
  assert.equal(v1.lifecycle.publishedBy, 'admin@example.com');
});

test('Phase 24 server exposes version history and enforces approval before publication', () => {
  assert.ok(routeSource.includes("'/api/template-os/templates/:templateId/history'"));
  assert.ok(routeSource.includes('canTransitionTemplate(row, req.body.status)'));
  assert.ok(routeSource.includes("status: 'VALIDATING'"));
  assert.ok(routeSource.includes("status: 'CERTIFIED'"));
  assert.ok(routeSource.includes("'CERTIFIED', 'APPROVED', 'DISABLED'"));
  assert.ok(routeSource.includes("'PUBLISHED'"));
  assert.ok(routeSource.includes("error: 'immutable_version_requires_fork'"));
  assert.ok(routeSource.includes('baseVersion'));
  assert.ok(apiSource.includes('history: (templateId)'));
});

test('Template Builder shows lifecycle gates, version history, explicit approval, and safe published forks', () => {
  assert.ok(builderSource.includes('TEMPLATE_PRIMARY_LIFECYCLE.map'));
  assert.ok(builderSource.includes('const approve = async () =>'));
  assert.ok(builderSource.includes("activeStatus !== 'APPROVED'"));
  assert.ok(builderSource.includes('TemplateOsApi.history(templateId)'));
  assert.ok(builderSource.includes("['PUBLISHED', 'DISABLED', 'GENERATED', 'LICENSE_PENDING']"));
  assert.ok(builderSource.includes('Save as new version'));
  assert.ok(builderSource.includes('templateDefinitionFingerprint'));
  assert.ok(builderSource.includes('definition content: immutable') || builderSource.toLowerCase().includes('definition content: immutable'));
});

test('Mongo persistence records base version, lifecycle history, approval and publication metadata', () => {
  assert.match(dbSource, /baseVersion:\s*\{ type: Number, default: null \}/);
  assert.match(dbSource, /lifecycle:\s*\{ type: mongoose\.Schema\.Types\.Mixed/);
  assert.match(dbSource, /listTemplateDefinitionVersions/);
  assert.match(dbSource, /lifecycle\.history/);
  assert.match(dbSource, /lifecycle\.approvedAt/);
  assert.match(dbSource, /lifecycle\.publishedAt/);
});

test('Phase 24 vocabulary expands precise action families and keeps every role verb grammar-recognized', () => {
  assert.ok(Object.keys(VERB_DICTIONARY).length >= 338);
  assert.ok(VERB_GROUPS.includes('DIAGNOSE'));
  for (const word of ['debugged', 'root-caused', 'pinpointed', 'fine-tuned', 'debottlenecked', 'templatized', 'industrialized', 'triangulated', 'scrutinized', 'disseminated', 'reconfigured', 'recast', 'itemized', 'oriented']) {
    assert.ok(verbInfo(word), word);
  }
  assert.deepEqual(verbAlternatives('debug', 10), ['pinpoint', 'localize', 'root-cause']);
  assert.ok(verbAlternatives('transform', 20).includes('recast'));
  assert.ok(verbAlternatives('document', 30).includes('itemize'));
  for (const [role, verbs] of Object.entries(ROLE_ACTION_VERBS)) {
    for (const verb of verbs) assert.ok(verbInfo(verb), `${role}: ${verb}`);
  }
});
