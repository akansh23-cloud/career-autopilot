import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TEMPLATE_OS_BUILTINS, BUILTIN_CERTIFICATION } from '../web/src/lib/templateOs/builtins.js';
import { RESUME_TEMPLATES } from '../web/src/lib/resumeTemplateRegistry.js';
import { validateTemplateDefinition } from '../web/src/lib/templateOs/dsl.js';
import { PRIMITIVES } from '../web/src/lib/templateOs/primitives.js';
import { compileTemplate, buildLayoutHTML } from '../web/src/lib/templateOs/compiler.js';
import { resolveRenderDesign } from '../web/src/lib/templateOs/renderDesign.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';
import { auditOwnedPdfAcrossParsers } from '../web/src/lib/templateOs/multiParserAts.js';

const ids = [
  'precision-engineering-classic', 'heritage-detailed', 'graduate-violet', 'cloud-devops-modern',
  'midnight-technical-rail', 'minimal-serif-ats', 'dark-executive-classic',
  'centered-ats-engineering', 'violet-modern-professional',
];
const byId = (id) => TEMPLATE_OS_BUILTINS.find((x) => x.id === id);

test('reference premium expansion adds nine published Template OS families', () => {
  assert.equal(TEMPLATE_OS_BUILTINS.length, 23);
  assert.equal(RESUME_TEMPLATES.filter((x) => x.engine === 'template-os').length, 23);
  assert.equal(RESUME_TEMPLATES.length, 51);
  for (const id of ids) {
    const def = byId(id);
    assert.ok(def, id);
    assert.equal(def.status, 'PUBLISHED', id);
    assert.equal(def.license.productionEnabled, true, id);
    assert.ok(BUILTIN_CERTIFICATION[id]?.certified, `${id} missing certification snapshot`);
    const valid = validateTemplateDefinition(def, { primitives: PRIMITIVES });
    assert.equal(valid.ok, true, `${id}: ${valid.errors.join('; ')}`);
  }
});

test('soft-chip families keep skill text semantic while rendering premium tokens', () => {
  const fixture = structuredClone(getResumeFixture('devops-cloud').data);
  for (const id of ['cloud-devops-modern', 'violet-modern-professional', 'graduate-violet']) {
    const compiled = compileTemplate(byId(id));
    assert.equal(compiled.tokens.skills.mode, 'chips');
    const html = buildLayoutHTML(compiled, fixture, { bare: true });
    assert.match(html, /t-skillchips/);
    assert.match(html, /t-skillchip/);
    assert.match(html, /AWS/i);
    const pdf = renderTemplatePdf(compiled, fixture, { sizeId: 'a4' });
    assert.ok(pdf.bytes.length > 5000, id);
  }
});

test('midnight rail carries an inverse high-contrast sidebar contract in both renderers', () => {
  const compiled = compileTemplate(byId('midnight-technical-rail'));
  const design = resolveRenderDesign(compiled);
  assert.equal(design.sidebar.heightMode, 'full');
  assert.equal(design.sidebar.textColor, '#f8fafc');
  assert.equal(design.sidebar.chipFillColor, '#273244');
  const html = buildLayoutHTML(compiled, structuredClone(getResumeFixture('devops-cloud').data));
  assert.match(html, /#111827/);
  assert.match(html, /#f8fafc/);
  const pdf = renderTemplatePdf(compiled, structuredClone(getResumeFixture('devops-cloud').data));
  assert.equal(pdf.pageCount, 1);
  assert.ok(pdf.geometry.sidebarPanels.some((x) => x.mode === 'full'));
});

test('reference families remain parser-readable and do not synthesize empty resume sections', () => {
  const fixture = structuredClone(getResumeFixture('missing-sections').data);
  for (const id of ids) {
    const def = byId(id);
    const pdf = renderTemplatePdf(compileTemplate(def), fixture, { sizeId: 'a4' });
    const raw = Buffer.from(pdf.bytes).toString('latin1');
    for (const fake of ['PUBLICATIONS', 'PATENTS', 'VOLUNTEER']) assert.ok(!raw.includes(`(${fake})`), `${id} rendered empty ${fake}`);
  }
  for (const id of ['precision-engineering-classic', 'cloud-devops-modern', 'minimal-serif-ats', 'centered-ats-engineering']) {
    const audit = auditOwnedPdfAcrossParsers(compileTemplate(byId(id)), structuredClone(getResumeFixture('devops-cloud').data), { sizeId: 'a4' });
    assert.equal(audit.allCritical, true, id);
    assert.ok(audit.minIntegrity >= 90, id);
    assert.ok(audit.minOrderScore >= 90, id);
  }
});

test('preview manifest includes every reference family when cache is generated', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../web/public/template-previews/manifest.json', import.meta.url), 'utf8'));
  if (manifest.surfaces['resume-studio'].length < 51) return; // pre-generation development state
  for (const id of ids) {
    const row = manifest.surfaces['resume-studio'].find((x) => x.id === id);
    assert.ok(row, id);
    assert.equal(row.renderer, 'template-os-vector-pdf');
    assert.equal(row.width, 360);
    assert.equal(row.height, 509);
  }
});
