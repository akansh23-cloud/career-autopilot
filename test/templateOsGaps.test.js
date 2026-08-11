/* ============================================================
   TEMPLATE OS V1.1 — gap closures
   Real PDF text layer, owned pagination, package ingestion,
   thumbnails, and the admin/publish surface.
   ============================================================ */
/* an admin session is needed to prove the publish gates; set before the
   server module is imported, exactly like the other privileged-route tests */
process.env.ADMIN_EMAILS = 'template-os-admin@ca.local';

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  TEMPLATE_OS_BUILTINS, BUILTIN_CERTIFICATION, TEMPLATE_FIXTURES, TEMPLATE_OS_VERSIONS,
  compileTemplate, renderTemplatePdf, extractPdfText, validateRenderedPdf, pdfEncodeText,
  certifyDefinition, certifyDefinitionDeep, buildTemplateThumbnail, thumbnailDataUri,
  wrapText, textWidth, scoreReadingOrder, measureLayoutGeometry, canMeasure, estimateGeometry,
} from '../web/src/lib/templateOs/index.js';
import { readTemplatePackage, sanitizePackageCss, PACKAGE_LIMITS } from '../server/utils/templateOs/packageImport.js';
import { RESUME_TEMPLATES } from '../web/src/lib/resumeTemplateRegistry.js';
import { makeClient, startServer, stopServer } from './helpers.js';

const ADMIN_EMAIL = 'template-os-admin@ca.local';

const senior = TEMPLATE_FIXTURES.find((f) => f.id === 'senior-technical').structured;
const twoPage = TEMPLATE_FIXTURES.find((f) => f.id === 'two-page').structured;
const sidebarDef = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');

/* ------------------------------------------------------------ pdf writer -- */
test('pdf writer: emits a real, deterministic PDF with a text layer', async () => {
  const compiled = compileTemplate(sidebarDef);
  const a = renderTemplatePdf(compiled, senior, { sizeId: 'a4' });
  const b = renderTemplatePdf(compiled, senior, { sizeId: 'a4' });
  assert.deepEqual(Buffer.from(a.bytes), Buffer.from(b.bytes), 'same input → identical bytes');
  assert.equal(Buffer.from(a.bytes.slice(0, 5)).toString(), '%PDF-', 'real PDF header');
  assert.ok(Buffer.from(a.bytes).toString('latin1').includes('%%EOF'));
  assert.ok(a.bytes.length > 2000);

  const extracted = await extractPdfText(a.bytes);
  assert.equal(extracted.pageCount, a.pageCount);
  assert.ok(extracted.text.includes('Rohan Iyer'));
  assert.ok(extracted.text.includes('CloudWorks'));
  assert.ok(/Delivered measurable outcome/.test(extracted.text), 'bullet text is selectable, not rasterized');
});

test('pdf writer: owns pagination — long content spans pages, letter differs from A4', () => {
  const compiled = compileTemplate(TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional'));
  const long = renderTemplatePdf(compiled, twoPage, { sizeId: 'a4' });
  const short = renderTemplatePdf(compiled, senior, { sizeId: 'a4' });
  assert.ok(long.pageCount >= 2, `expected multi-page, got ${long.pageCount}`);
  assert.equal(short.pageCount, 1);
  const letter = renderTemplatePdf(compiled, twoPage, { sizeId: 'letter' });
  assert.notDeepEqual(Buffer.from(letter.bytes), Buffer.from(long.bytes), 'page size changes the document');
});

test('pdf writer: wraps with real base-14 metrics, not character counts', async () => {
  const { PDF_FONTS } = await import('../web/src/lib/templateOs/pdfWriter.js');
  const helv = PDF_FONTS.helv;
  /* identical character counts, very different real widths */
  assert.ok(textWidth('WWWWWWWW', helv, 10) > textWidth('iiiiiiii', helv, 10) * 3);
  const narrow = wrapText('iiii iiii iiii iiii iiii iiii', helv, 10, 100);
  const wide = wrapText('WWWW WWWW WWWW WWWW WWWW WWWW', helv, 10, 100);
  assert.ok(wide.length > narrow.length, 'wider glyphs need more lines at the same column width');
  assert.ok(wrapText('', helv, 10, 100).length === 0);
  /* a single unbreakable word still emits a line rather than looping forever */
  assert.equal(wrapText('Supercalifragilisticexpialidocious', helv, 10, 20).length, 1);
});

test('pdf writer: transliterates outside WinAnsi deterministically and reports it consistently', () => {
  assert.equal(pdfEncodeText('Zoë Núñez-Ōkawa'), 'Zoë Núñez-Okawa');
  assert.equal(pdfEncodeText('日本語'), '');
  assert.equal(pdfEncodeText('plain ASCII'), 'plain ASCII');
});

/* ------------------------------------------------------ pdf certification -- */
test('deep certification: every builtin passes on a REAL PDF text layer, with page regimes reported', async () => {
  for (const def of TEMPLATE_OS_BUILTINS) {
    const c = await certifyDefinitionDeep(def, { sizeIds: ['a4'] });
    assert.equal(c.certified, true, `${def.id} failed: order ${c.minOrderScore} integrity ${c.minIntegrity}`);
    assert.equal(c.evidence, 'real-pdf-text-layer');
    assert.equal(c.label, 'Career Autopilot PDF parse checks passed');
    assert.ok(c.minIntegrity >= 90, def.id);
    assert.ok(c.minOrderScore >= 85, def.id);
    assert.ok(c.pdf.roundTripOk, `${def.id}: written pages must equal parsed pages`);
    /* the honest bit: a rail that reads perfectly on one page is reported
       separately from what happens when content spills onto a second */
    assert.ok(['VERY_HIGH', 'HIGH'].includes(c.atsLevel), def.id);
    if (c.pdf.multiPage) assert.ok(['VERY_HIGH', 'HIGH', 'BALANCED'].includes(c.atsLevelMultiPage));
    assert.ok(c.htmlOnly.atsLevel, 'html estimate retained for comparison');
  }
});

test('deep certification catches a genuinely bad layout', async () => {
  const scrambled = JSON.parse(JSON.stringify(sidebarDef));
  scrambled.id = 'scrambled-order';
  scrambled.sectionOrder = ['certifications', 'education', 'skills', 'projects', 'experience', 'summary', 'achievements'];
  const compiled = compileTemplate(scrambled);
  const pdf = renderTemplatePdf(compiled, senior);
  const extracted = await extractPdfText(pdf.bytes);
  const { CANONICAL_ORDER } = await import('../web/src/lib/templateOs/compiler.js');
  const score = scoreReadingOrder(senior, extracted.text, CANONICAL_ORDER);
  assert.ok(score.score < 60, `scrambled PDF should read badly, scored ${score.score}`);
});

test('certification snapshot shipped with the builtins matches live measurement', async () => {
  for (const def of TEMPLATE_OS_BUILTINS) {
    const snap = BUILTIN_CERTIFICATION[def.id];
    assert.ok(snap, `${def.id} missing from BUILTIN_CERTIFICATION`);
    const live = await certifyDefinitionDeep(def, { sizeIds: ['a4', 'letter'] });
    assert.equal(snap.certified, live.certified, `${def.id} certified drifted`);
    assert.equal(snap.atsLevel, live.atsLevel, `${def.id} atsLevel drifted`);
    assert.equal(snap.atsLevelMultiPage, live.atsLevelMultiPage, `${def.id} multi-page level drifted`);
    assert.equal(snap.minIntegrity, live.minIntegrity, `${def.id} integrity drifted`);
    assert.equal(snap.minOrderScore, live.minOrderScore, `${def.id} order drifted`);
    assert.equal(snap.evidence, 'real-pdf-text-layer');
  }
});

test('validateRenderedPdf reports per-field recovery', async () => {
  const r = await validateRenderedPdf(compileTemplate(sidebarDef), senior, { sizeId: 'a4' });
  assert.equal(r.criticalOk, true);
  assert.equal(r.checks.companies, true);
  assert.equal(r.checks.dates, true);
  assert.equal(r.integrity, 100);
  assert.equal(r.roundTripOk, true);
});

/* --------------------------------------------------------------- geometry -- */
test('geometry: measurement falls back to the estimate under Node and both agree on page counts', () => {
  assert.equal(canMeasure(), false, 'no DOM in tests');
  const compiled = compileTemplate(TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional'));
  const measured = measureLayoutGeometry(compiled, twoPage, { sizeId: 'a4' });
  assert.equal(measured.measured, false, 'honest flag: this is an estimate, not a measurement');
  assert.equal(measured.pageCount, estimateGeometry(compiled, twoPage, { sizeId: 'a4' }).pageCount);
  /* and the PDF writer — which does real typographic layout — agrees it is long */
  assert.ok(renderTemplatePdf(compiled, twoPage).pageCount >= 2);
});

/* ------------------------------------------------------------- thumbnails -- */
test('thumbnails: deterministic SVG for every template, legacy included, no script surface', async () => {
  const { fromLegacyTemplate } = await import('../web/src/lib/templateOs/adapter.js');
  for (const t of RESUME_TEMPLATES) {
    const def = t.engine === 'template-os' ? t.definition : fromLegacyTemplate(t);
    const svg = buildTemplateThumbnail(def);
    assert.ok(svg.startsWith('<svg'), t.id);
    assert.ok(svg.includes('</svg>'), t.id);
    assert.ok(!/<script|onload=|javascript:/i.test(svg), `${t.id} thumbnail must be inert`);
    assert.ok(svg.length < 40000, `${t.id} thumbnail should stay small`);
  }
  const a = buildTemplateThumbnail(sidebarDef);
  const b = buildTemplateThumbnail(sidebarDef);
  assert.equal(a, b);
  /* sidebar geometry actually shows up in the wireframe */
  const single = buildTemplateThumbnail(TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional'));
  assert.notEqual(a, single);
  assert.ok(thumbnailDataUri(sidebarDef).startsWith('data:image/svg+xml;base64,'));
});

/* --------------------------------------------------------- package import -- */
const makePackage = async (files) => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
};

test('package import: valid package normalizes, tints from allowlisted CSS, and cannot self-publish', async () => {
  const def = JSON.parse(JSON.stringify(sidebarDef));
  def.id = 'packaged-sidebar'; def.name = 'Packaged Sidebar'; delete def.license;
  const buf = await makePackage({
    'template-package/template.json': JSON.stringify(def),
    'template-package/styles.css': ':root{--tpl-accent:#123456;--tpl-side:#eef;}',
    'template-package/metadata.json': JSON.stringify({ source: 'Acme Design Co', licenseName: 'CC-BY-4.0' }),
    'template-package/LICENSE': 'CC BY 4.0 full text here',
    'template-package/preview.webp': new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80]),
    'template-package/assets/logo.png': new Uint8Array([137,80,78,71,13,10,26,10]),
  });
  const r = await readTemplatePackage(buf);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.definition.colors.accent, '#123456', 'allowlisted variable applied');
  assert.equal(r.definition.license.licenseStatus, 'LICENSE_PENDING');
  assert.equal(r.definition.license.productionEnabled, false);
  assert.equal(r.definition.license.source, 'Acme Design Co');
  assert.equal(r.definition.status, 'DRAFT');
  assert.ok(r.hasLicenseFile);
  assert.equal(r.assets.length, 2);
  assert.equal(r.css.ok, true);
  assert.deepEqual(r.css.rejected, []);
});

test('package import: rejects executables, traversal, oversized archives and broken definitions', async () => {
  const def = JSON.parse(JSON.stringify(sidebarDef)); def.id = 'pkg-2';
  const withJs = await readTemplatePackage(await makePackage({
    'template.json': JSON.stringify(def),
    'hack.js': 'fetch("//evil")',
    '../escape.png': new Uint8Array([1]),
  }));
  assert.equal(withJs.ok, false, 'security-sensitive package entries fail closed');
  assert.equal(withJs.error, 'unsafe_package_entries');
  assert.ok(withJs.rejected.some((x) => /executable|markup/.test(x.reason)));
  assert.ok(withJs.rejected.some((x) => /unsafe path|not part/.test(x.reason)));

  assert.equal((await readTemplatePackage(Buffer.from('not a zip at all'))).error, 'not_a_zip');
  assert.equal((await readTemplatePackage(await makePackage({ 'readme.txt': 'hi' }))).error, 'missing_template_json');
  assert.equal((await readTemplatePackage(await makePackage({ 'template.json': '{ broken' }))).error, 'template_json_unparseable');
  assert.equal((await readTemplatePackage(Buffer.alloc(PACKAGE_LIMITS.maxBytes + 10))).error, 'package_too_large');

  const evil = JSON.parse(JSON.stringify(sidebarDef));
  evil.id = 'pkg-3'; evil.name = '<script>alert(1)</script>';
  assert.equal((await readTemplatePackage(await makePackage({ 'template.json': JSON.stringify(evil) }))).error, 'unsafe_definition');

  const invalid = JSON.parse(JSON.stringify(sidebarDef));
  invalid.id = 'pkg-4'; invalid.layout.columns[0].width = 0.8;
  const bad = await readTemplatePackage(await makePackage({ 'template.json': JSON.stringify(invalid) }));
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'invalid_definition');
  assert.ok(bad.validation.errors.length);
});

test('package CSS sanitizer accepts only palette variables with well-formed values', () => {
  const r = sanitizePackageCss(':root{--tpl-accent:#0f766e;--tpl-rule:not-a-color;--tpl-side:#eef;}@import url(evil.css);');
  assert.equal(r.ok, false);
  assert.deepEqual(r.accepted, {});
  assert.ok(r.rejected.some((x) => /forbidden CSS construct|value failed/.test(x.rule)));
});

/* ------------------------------------------------------------------ routes -- */
test('routes: thumbnail, deep certify, package import, vector PDF export, publish gating', async (t) => {
  const srv = await startServer();
  try {
    const client = makeClient(srv.base);
    await client.devLogin('Gap Tester', 'gap-tester@example.com');
    const admin = makeClient(srv.base);
    await admin.devLogin('Template Admin', ADMIN_EMAIL);

    const versions = (await client.get('/api/template-os/versions')).json.versions;
    for (const k of ['pdfWriterVersion', 'pdfValidationVersion', 'pdfCertificationVersion', 'thumbnailVersion', 'layoutMeasureVersion']) {
      assert.ok(versions[k], `missing ${k}`);
    }
    for (const [key, value] of Object.entries(TEMPLATE_OS_VERSIONS)) assert.deepEqual(versions[key], value, key);
    assert.match(versions.templateAdminAuthVersion, /server-authoritative/);

    assert.equal((await client.post('/api/template-os/thumbnail', { definition: sidebarDef })).status, 403);
    const thumb = await admin.post('/api/template-os/thumbnail', { definition: sidebarDef });
    assert.equal(thumb.status, 200);
    assert.ok(thumb.json.svg.startsWith('<svg'));

    /* deep certification through the API */
    assert.equal((await client.post('/api/template-os/certify', { definition: sidebarDef, sizeIds: ['a4'] })).status, 403);
    const cert = await admin.post('/api/template-os/certify', { definition: sidebarDef, sizeIds: ['a4'] });
    assert.equal(cert.status, 200);
    assert.equal(cert.json.certification.evidence, 'real-pdf-text-layer');
    assert.equal(cert.json.certification.certified, true);
    /* opting out gives the faster HTML estimate, clearly labelled */
    const shallow = await admin.post('/api/template-os/certify', { definition: sidebarDef, deep: false });
    assert.equal(shallow.json.certification.label, 'Career Autopilot parse checks passed');

    /* zip package import lands as a non-production draft */
    const def = JSON.parse(JSON.stringify(sidebarDef));
    def.id = 'route-packaged'; def.name = 'Route Packaged'; delete def.license;
    const buf = await makePackage({
      'template.json': JSON.stringify(def),
      'styles.css': ':root{--tpl-accent:#7f1d1d;}',
      'LICENSE': 'internal use',
    });
    assert.equal((await client.post('/api/template-os/import-package', { packageBase64: buf.toString('base64') })).status, 403);
    const imp = await admin.post('/api/template-os/import-package', { packageBase64: buf.toString('base64') });
    assert.equal(imp.status, 200, JSON.stringify(imp.json).slice(0, 200));
    assert.equal(imp.json.certification.certified, true);
    assert.equal(imp.json.certification.evidence, 'real-pdf-text-layer');
    assert.equal((await client.get('/api/template-os/templates/route-packaged')).status, 403);
    const fetched = await admin.get('/api/template-os/templates/route-packaged');
    assert.equal(fetched.json.template.status, 'DRAFT');
    assert.equal(fetched.json.template.definition.license.productionEnabled, false);
    assert.equal(fetched.json.template.definition.colors.accent, '#7f1d1d');
    /* still hidden from students */
    assert.ok(!(await client.get('/api/template-os/templates?catalog=1&publishedOnly=1')).json.templates.some((x) => x.templateId === 'route-packaged'));

    /* a package carrying a script is refused outright */
    const evilBuf = await makePackage({ 'template.json': JSON.stringify({ ...def, id: 'route-evil', name: '<script>x</script>' }) });
    const evil = await admin.post('/api/template-os/import-package', { packageBase64: evilBuf.toString('base64') });
    assert.equal(evil.status, 400);
    assert.equal(evil.json.error, 'unsafe_definition');
    assert.equal((await admin.post('/api/template-os/import-package', { packageBase64: Buffer.from('nope').toString('base64') })).json.error, 'not_a_zip');

    /* vector PDF export returns a real PDF with a reported page count */
    const pdf = await client.post('/api/template-os/export/pdf', {
      templateId: 'technical-sidebar',
      doc: { contact: { name: 'Vector Export', email: 'vector@example.com' }, summary: 'Exported through the writer.', skills: [{ name: 'AWS', enabled: true }], experience: [], projects: [], certifications: [] },
    });
    assert.equal(pdf.status, 200);
    assert.ok(pdf.headers.get('content-type').includes('application/pdf'));
    assert.ok(pdf.text.startsWith('%PDF-'));
    assert.ok(Number(pdf.headers.get('x-template-pages')) >= 1);

    /* status changes are admin-only */
    const deny = await client.post('/api/template-os/status', { templateId: 'route-packaged', version: 1, status: 'PUBLISHED' });
    assert.equal(deny.status, 403);

    /* Builder-authored internal template: exact-version deep certification is mandatory before publish. */
    const builderDef = JSON.parse(JSON.stringify(sidebarDef));
    builderDef.id = 'phase23-builder-publish'; builderDef.name = 'Phase 23 Builder Publish';
    builderDef.license = { licenseStatus: 'INTERNAL_ORIGINAL', source: 'Career Autopilot design team', productionEnabled: true };
    const savedBuilder = await admin.post('/api/template-os/save', { definition: builderDef });
    assert.equal(savedBuilder.status, 200);
    const builderVersion = savedBuilder.json.saved.version;
    const premature = await admin.post('/api/template-os/status', { templateId: builderDef.id, version: builderVersion, status: 'PUBLISHED' });
    assert.equal(premature.status, 422);
    assert.equal(premature.json.error, 'not_deep_certified');
    const boundCert = await admin.post('/api/template-os/certify', { definition: builderDef, templateId: builderDef.id, version: builderVersion, sizeIds: ['a4'] });
    assert.equal(boundCert.status, 200);
    assert.equal(boundCert.json.boundTo.version, builderVersion);
    assert.equal(boundCert.json.certification.evidence, 'real-pdf-text-layer');
    const published = await admin.post('/api/template-os/status', { templateId: builderDef.id, version: builderVersion, status: 'PUBLISHED' });
    assert.equal(published.status, 200);
    const publicExact = await client.get(`/api/template-os/templates/${builderDef.id}?version=${builderVersion}`);
    assert.equal(publicExact.status, 200);
    assert.equal(publicExact.json.template.createdBy, undefined);
    assert.ok((await client.get('/api/template-os/templates?catalog=1&publishedOnly=1')).json.templates.some((x) => x.templateId === builderDef.id));

    /* an admin still cannot publish a template whose license is not cleared */
    const adminBuf = await makePackage({ 'template.json': JSON.stringify({ ...def, id: 'admin-packaged', name: 'Admin Packaged' }) });
    await admin.post('/api/template-os/import-package', { packageBase64: adminBuf.toString('base64') });
    const blocked = await admin.post('/api/template-os/status', { templateId: 'admin-packaged', version: 1, status: 'PUBLISHED' });
    assert.notEqual(blocked.status, 403, 'ADMIN_EMAILS should have granted the admin role');
    assert.equal(blocked.status, 422);
    assert.equal(blocked.json.error, 'license_not_cleared');
    /* approving as a non-published status is allowed once certified */
    const approved = await admin.post('/api/template-os/status', { templateId: 'admin-packaged', version: 1, status: 'CERTIFIED' });
    assert.equal(approved.status, 200);
  } finally { await stopServer(srv.server); }
});
