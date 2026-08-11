/* ============================================================
   TEMPLATE OS V1 — engine + route tests
   ============================================================ */
process.env.ADMIN_EMAILS = 'template-os-admin@ca.local';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTemplateDefinition, sanitizeTemplateDefinition, extendTemplate,
  PRIMITIVES, compileTemplate, adaptTreeToShape, buildLayoutHTML, estimateGeometry,
  analyzeResumeShape, scoreReadingOrder, TEMPLATE_FIXTURES, CANONICAL_ORDER,
  certifyDefinition, generateTemplateCandidates, fromLegacyTemplate, toRegistryCard,
  TEMPLATE_OS_BUILTINS, TEMPLATE_OS_VERSIONS,
} from '../web/src/lib/templateOs/index.js';
import { RESUME_TEMPLATES } from '../web/src/lib/resumeTemplateRegistry.js';
import { extractTextFromHtml } from '../server/utils/resume/atsParseSimulator.js';
import { makeClient, startServer, stopServer } from './helpers.js';

const ADMIN_EMAIL = 'template-os-admin@ca.local';

const senior = TEMPLATE_FIXTURES.find((f) => f.id === 'senior-technical').structured;
const sidebarDef = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');

/* ---------------------------------------------------------------- DSL ---- */
test('DSL: builtins validate; broken definitions rejected with reasons', () => {
  for (const def of TEMPLATE_OS_BUILTINS) {
    const v = validateTemplateDefinition(def, { primitives: PRIMITIVES });
    assert.equal(v.ok, true, `${def.id}: ${v.errors.join('; ')}`);
  }
  const bad = JSON.parse(JSON.stringify(sidebarDef));
  bad.layout.columns[0].width = 0.6; // sum != 1 AND sidebar too wide
  const v1 = validateTemplateDefinition(bad, { primitives: PRIMITIVES });
  assert.equal(v1.ok, false);
  assert.ok(v1.errors.some((e) => /sum to 1/.test(e)));

  const bad2 = JSON.parse(JSON.stringify(sidebarDef));
  bad2.headerStyle.primitive = 'holographic';
  assert.ok(validateTemplateDefinition(bad2, { primitives: PRIMITIVES }).errors.some((e) => /unknown headers primitive/.test(e)));

  const bad3 = JSON.parse(JSON.stringify(sidebarDef));
  bad3.typography = { ...bad3.typography, bodyFontPx: 7 };
  assert.ok(validateTemplateDefinition(bad3, { primitives: PRIMITIVES }).errors.some((e) => /below floor/.test(e)));

  const bad4 = JSON.parse(JSON.stringify(sidebarDef));
  bad4.sectionPlacement.skills = 'gutter';
  assert.ok(validateTemplateDefinition(bad4, { primitives: PRIMITIVES }).errors.some((e) => /unknown region/.test(e)));
});

test('DSL: sanitization rejects scripts, eval, handlers, remote urls; passes clean defs', () => {
  for (const evil of [
    { name: '<script>alert(1)</script>' },
    { colors: { accent: 'javascript:void(0)' } },
    { description: 'x onclick=steal()' },
    { sectionStyles: { divider: 'url(https://evil.example/x.css)' } },
    { typography: { font: 'expression(alert(1))' } },
  ]) {
    const r = sanitizeTemplateDefinition({ ...JSON.parse(JSON.stringify(sidebarDef)), ...evil });
    assert.equal(r.ok, false, JSON.stringify(evil));
    assert.ok(r.rejected.length >= 1);
  }
  const clean = sanitizeTemplateDefinition(sidebarDef);
  assert.equal(clean.ok, true);
  assert.equal(typeof clean.def.render, 'undefined');
});

test('DSL: inheritance merges deep, tracks parent, keeps base immutable', () => {
  const base = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');
  const child = extendTemplate(base, { id: 'child-x', name: 'Child X', colors: { preset: 'teal' } });
  assert.equal(child.parentTemplateId, base.id);
  assert.equal(child.colors.preset, 'teal');
  assert.equal(child.layout.type, 'sidebar-left');
  assert.equal(base.colors.preset, 'slate'); // untouched
  assert.equal(validateTemplateDefinition(child, { primitives: PRIMITIVES }).ok, true);
});

/* ----------------------------------------------------------- compiler ---- */
test('compiler: sidebar tree places sections; HTML uses grid columns; single column stays linear', () => {
  const compiled = compileTemplate(sidebarDef);
  assert.equal(compiled.ok, true);
  const skills = compiled.tree.sections.find((s) => s.key === 'skills');
  assert.equal(skills.region, 'sidebar');
  assert.equal(skills.fallback, 'main');
  const html = buildLayoutHTML(compiled, senior);
  assert.ok(html.includes('t-columns') && html.includes('t-col-sidebar') && html.includes('grid-template-areas'));
  const single = compileTemplate(TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional'));
  assert.ok(!buildLayoutHTML(single, senior).includes('t-col-sidebar'));
});

test('compiler: reading order — extraction meets anchors sequentially even for sidebar/two-column; scrambled order is caught', () => {
  for (const def of TEMPLATE_OS_BUILTINS) {
    const compiled = compileTemplate(def);
    const text = extractTextFromHtml(buildLayoutHTML(compiled, senior));
    const s = scoreReadingOrder(senior, text, compiled.tree.sections.map((x) => x.key));
    assert.ok(s.score >= 95, `${def.id} order ${s.score}`);
  }
  const scrambled = JSON.parse(JSON.stringify(sidebarDef));
  scrambled.sectionOrder = ['certifications', 'education', 'skills', 'projects', 'experience', 'summary', 'achievements'];
  const text = extractTextFromHtml(buildLayoutHTML(compileTemplate(scrambled), senior));
  assert.ok(scoreReadingOrder(senior, text, CANONICAL_ORDER).score < 60);
});

test('compiler: escapes user content in layout HTML', () => {
  const doc = JSON.parse(JSON.stringify(senior));
  doc.personalInfo.name = 'Evil <script>alert(1)</script>';
  const html = buildLayoutHTML(compileTemplate(sidebarDef), doc);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('compiler: adaptation pulls declared fallbacks into a sparse sidebar and reports moves', () => {
  const sparse = TEMPLATE_FIXTURES.find((f) => f.id === 'short-fresher').structured;
  const shape = { skillCount: 3 };
  const compiled = adaptTreeToShape(compileTemplate(sidebarDef), shape);
  assert.ok(compiled.adaptation.moves.length >= 1);
  for (const m of compiled.adaptation.moves) assert.equal(m.to, 'sidebar');
  const html = buildLayoutHTML(compiled, sparse);
  assert.ok(html.includes('t-col-sidebar'));
});

test('compiler: geometry estimates pages deterministically; two-page fixture spans 2 pages', () => {
  const long = TEMPLATE_FIXTURES.find((f) => f.id === 'two-page').structured;
  const compiled = compileTemplate(TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional'));
  const g1 = estimateGeometry(compiled, long, { sizeId: 'a4' });
  const g2 = estimateGeometry(compiled, long, { sizeId: 'a4' });
  assert.deepEqual(g1, g2);
  assert.ok(g1.pageCount >= 2);
  const short = TEMPLATE_FIXTURES.find((f) => f.id === 'short-fresher').structured;
  assert.equal(estimateGeometry(compiled, short, { sizeId: 'a4' }).pageCount, 1);
});

/* -------------------------------------------------------------- shape ---- */
test('shape: deterministic career stage + densities from document facts', () => {
  const shape = analyzeResumeShape({
    targetRole: 'Senior DevOps Engineer',
    summary: 'Cloud engineer with strong delivery record across regulated environments.',
    skills: Array.from({ length: 20 }, (_, i) => ({ name: `Skill${i}`, enabled: true })),
    experience: [{ company: 'A', role: 'Engineer', startDate: '2015-01', endDate: '', current: true, enabled: true, bullets: Array.from({ length: 9 }, () => ({ text: 'Delivered outcome', enabled: true })) }],
    certifications: [{ name: 'AWS SA Pro', enabled: true }, { name: 'CKA', enabled: true }],
    projects: [],
  });
  assert.equal(shape.careerStage, 'senior');
  assert.equal(shape.skillDensity, 'high');
  assert.equal(shape.certificationDensity, 'medium');
  assert.equal(shape.targetRole, 'DevOps Engineer');
  const student = analyzeResumeShape({ experience: [], skills: [], summary: '' });
  assert.equal(student.careerStage, 'student');
  assert.equal(student.educationImportance, 'high');
});

/* ------------------------------------------------------- certification ---- */
test('certification: all builtins pass parse checks with measured ATS levels; honest label', () => {
  for (const def of TEMPLATE_OS_BUILTINS) {
    const c = certifyDefinition(def);
    assert.equal(c.certified, true, def.id);
    assert.equal(c.minIntegrity, 100, def.id);
    assert.ok(c.minOrderScore >= 95, def.id);
    assert.ok(['VERY_HIGH', 'HIGH'].includes(c.atsLevel), def.id);
    assert.equal(c.label, 'Career Autopilot parse checks passed');
    assert.ok(c.scorecard.atsParse >= 90 && typeof c.scorecard.international === 'number');
  }
  /* single column earns VERY_HIGH; multi-column caps at HIGH */
  assert.equal(certifyDefinition(TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional')).atsLevel, 'VERY_HIGH');
  assert.equal(certifyDefinition(sidebarDef).atsLevel, 'HIGH');
});

/* ----------------------------------------------------------- synthesis ---- */
test('synthesis: devops sidebar goal yields validated, certified, ranked candidates — deterministic, never production-enabled', () => {
  const goal = { targetRoles: ['devops'], visualStyle: 'modern technical', atsPriority: 'high', layoutPreference: 'sidebar', careerStage: 'senior', density: 'balanced' };
  const a = generateTemplateCandidates(goal, { limit: 5 });
  const b = generateTemplateCandidates(goal, { limit: 5 });
  assert.ok(a.kept >= 3);
  assert.equal(a.candidates[0].def.id, b.candidates[0].def.id); // deterministic
  for (const c of a.candidates) {
    assert.equal(validateTemplateDefinition(c.def, { primitives: PRIMITIVES }).ok, true);
    assert.equal(c.def.license.productionEnabled, false);
    assert.equal(c.def.status, 'GENERATED');
    assert.ok(c.cert.minIntegrity >= 80);
    assert.ok(c.score <= 100);
  }
  assert.ok(a.candidates[0].def.layout.type.startsWith('sidebar'));
  /* student goal reorders education/projects first */
  const s = generateTemplateCandidates({ targetRoles: ['student'], careerStage: 'student' }, { limit: 3 });
  assert.equal(s.candidates[0].def.sectionOrder[1], 'education');
});

/* -------------------------------------------------------------- adapter --- */
test('adapter: every legacy template migrates to a valid single-column definition; cards project back with required keys', () => {
  const legacy = RESUME_TEMPLATES.filter((t) => t.set !== 'tos');
  assert.equal(legacy.length, 28);
  for (const tpl of legacy) {
    const def = fromLegacyTemplate(tpl);
    const v = validateTemplateDefinition(def, { primitives: PRIMITIVES });
    assert.equal(v.ok, true, `${tpl.id}: ${v.errors.join('; ')}`);
    assert.equal(def.migration.classification, 'MIGRATABLE');
    assert.equal(def.layout.type, 'single-column');
  }
  const card = toRegistryCard(sidebarDef);
  for (const k of ['id', 'name', 'category', 'bestFor', 'atsSafe', 'layoutType', 'pageMode', 'supportsOnePage', 'supportsMultiPage', 'riskLevel', 'description', 'sections', 'previewType', 'badges', 'license', 'theme']) {
    assert.ok(k in card, `card missing ${k}`);
  }
  assert.equal(card.engine, 'template-os');
  assert.equal(card.previewType, 'template-os'); // stays out of legacy certification path
});

test('registry: 51 templates total; 23 Template OS cards published, licensed, with accents for DOCX', () => {
  assert.equal(RESUME_TEMPLATES.length, 51);
  const tos = RESUME_TEMPLATES.filter((t) => t.set === 'tos');
  assert.equal(tos.length, 23);
  for (const t of tos) {
    assert.equal(t.license.productionEnabled, true);
    assert.equal(t.license.licenseStatus, 'INTERNAL_ORIGINAL');
    assert.ok(t.theme.accent, t.id);
    assert.ok(t.definition.exports.docxProfile, t.id);
  }
});

test('engine versions exported for auditability', () => {
  for (const k of ['templateDslVersion', 'layoutCompilerVersion', 'templateCertificationVersion', 'templateSynthesisVersion', 'templateGeneratorDiversityVersion', 'multiParserAtsVersion', 'multiParserCertificationVersion', 'ownedPaginationVersion', 'resumeShapeVersion', 'readingOrderVersion']) {
    assert.ok(TEMPLATE_OS_VERSIONS[k], k);
  }
});

/* --------------------------------------------------------------- routes --- */
test('routes: runtime catalog stays readable while Template Builder operations are server-admin-only', async (t) => {
  const srv = await startServer();
  try {
    const client = makeClient(srv.base);
    await client.devLogin('Tos Tester', 'tos-tester@example.com');
    const admin = makeClient(srv.base);
    await admin.devLogin('Template Admin', ADMIN_EMAIL);

    const versions = await client.get('/api/template-os/versions');
    assert.equal(versions.status, 200);
    assert.ok(versions.json.versions.layoutCompilerVersion);
    assert.match(versions.json.versions.templateAdminAuthVersion, /server-authoritative/);

    /* Builder inventory is admin-only; student-facing runtime catalog is explicit. */
    assert.equal((await client.get('/api/template-os/templates')).status, 403);
    const list = await client.get('/api/template-os/templates?catalog=1&publishedOnly=1');
    assert.equal(list.status, 200);
    assert.ok(list.json.templates.length >= 7);
    assert.ok(list.json.templates.every((x) => x.status === 'PUBLISHED'));
    assert.equal((await client.get('/api/template-os/admin/access')).status, 403);
    assert.equal((await admin.get('/api/template-os/admin/access')).status, 200);

    /* Mutating/internal tooling cannot be reached by an ordinary signed-in user. */
    const good = { ...JSON.parse(JSON.stringify(sidebarDef)), id: 'imported-sidebar', name: 'Imported Sidebar' };
    delete good.license;
    assert.equal((await client.post('/api/template-os/import', { definition: good })).status, 403);
    assert.equal((await client.post('/api/template-os/generate', { targetRoles: ['data engineer'], limit: 2 })).status, 403);

    /* Admin import still sanitizes and external definitions can never self-clear licensing. */
    const evil = { ...JSON.parse(JSON.stringify(sidebarDef)), id: 'evil-import', name: '<script>x</script>' };
    const bad = await admin.post('/api/template-os/import', { definition: evil });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'unsafe_definition');

    const imp = await admin.post('/api/template-os/import', { definition: good });
    assert.equal(imp.status, 200);
    assert.equal(imp.json.certification.certified, true);
    assert.equal((await client.get('/api/template-os/templates/imported-sidebar')).status, 403);
    const fetched = await admin.get('/api/template-os/templates/imported-sidebar');
    assert.equal(fetched.json.template.status, 'DRAFT');
    assert.equal(fetched.json.template.definition.license.productionEnabled, false);
    assert.equal(fetched.json.template.definition.license.licenseStatus, 'LICENSE_PENDING');
    assert.ok(!(await client.get('/api/template-os/templates?catalog=1&publishedOnly=1')).json.templates.some((x) => x.templateId === 'imported-sidebar'));

    const gen = await admin.post('/api/template-os/generate', { targetRoles: ['data engineer'], layoutPreference: 'sidebar', careerStage: 'mid', limit: 4 });
    assert.equal(gen.status, 200);
    assert.ok(gen.json.kept >= 2);

    /* Student-safe deterministic runtime operations remain available. */
    const shape = await client.post('/api/template-os/shape', { doc: { targetRole: 'devops', summary: 'x', skills: [], experience: [], projects: [], certifications: [] } });
    assert.equal(shape.status, 200);
    const render = await client.post('/api/template-os/render', {
      templateId: 'technical-sidebar',
      doc: { contact: { name: 'Route Fixture', email: 'route@example.com' }, summary: 'Testing render.', skills: [{ name: 'AWS', enabled: true }], experience: [], projects: [], certifications: [] },
    });
    assert.equal(render.status, 200);
    assert.ok(render.json.html.includes('Route Fixture'));

    assert.equal((await client.post('/api/template-os/status', { templateId: 'imported-sidebar', version: 1, status: 'PUBLISHED' })).status, 403);
  } finally { await stopServer(srv.server); }
});
