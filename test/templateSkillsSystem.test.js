import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, buildLayoutHTML, layoutCSS } from '../web/src/lib/templateOs/compiler.js';
import { resolveRenderDesign } from '../web/src/lib/templateOs/renderDesign.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { PRIMITIVES } from '../web/src/lib/templateOs/primitives.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';

const technical = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');
const balanced = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'balanced-two-column');
const editorial = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional');
const fixture = structuredClone(getResumeFixture('devops-cloud').data);

test('premium skill primitives cover compact sidebar groups, categorized lists, matrix and inline rows', () => {
  assert.equal(PRIMITIVES.skills['sidebar-groups'].mode, 'sidebar-groups');
  assert.equal(PRIMITIVES.skills.categorized.mode, 'categorized');
  assert.equal(PRIMITIVES.skills['compact-matrix'].mode, 'matrix');
  assert.equal(PRIMITIVES.skills.inline.mode, 'inline');
  assert.equal(technical.skillStyle.primitive, 'sidebar-groups');
});

test('Technical Sidebar renders categorized pill-free skill runs instead of one database row per skill', () => {
  const c = compileTemplate(technical);
  const html = buildLayoutHTML(c, fixture);
  const css = layoutCSS(c);
  assert.match(html, /t-skillgroup t-skillgroup-sidebar/);
  assert.match(html, /<p class="t-skillhead">CLOUD<\/p>/);
  assert.match(html, /<span class="t-skilltoken">AWS<\/span><span class="t-skillsep">·<\/span><span class="t-skilltoken">EKS<\/span>/);
  assert.doesNotMatch(html, /<div class="t-skillrow">AWS<\/div>/);
  assert.match(css, /\.t-skillsep\{display:inline-block;color:var\(--tpl-rule\)/);
  assert.match(css, /\.t-skillgroup-sidebar \.t-skilltokens\{font-size:/);
});

test('shared skill render contract keeps technical rail compact and readable in vector PDF', () => {
  const c = compileTemplate(technical);
  const d = resolveRenderDesign(c);
  assert.equal(d.skills.mode, 'sidebar-groups');
  assert.equal(d.skills.labelCase, 'upper');
  assert.ok(d.skills.sidebarItemPt >= 6.3, `unexpectedly small skill text: ${d.skills.sidebarItemPt}`);
  const pdf = renderTemplatePdf(c, fixture, { sizeId: 'a4' });
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  assert.equal(pdf.pageCount, 1);
  assert.equal(pdf.renderDesignVersion, 'template-render-design-v12-reference-premium-families');
  const cloud = raw.indexOf('(CLOUD)');
  const aws = raw.indexOf('AWS', cloud);
  const kube = raw.indexOf('Kubernetes', aws);
  assert.ok(cloud >= 0 && aws > cloud && kube > aws, { cloud, aws, kube });
});

test('professional skill modes retain category meaning without pill UI', () => {
  const categorized = buildLayoutHTML(compileTemplate(balanced), fixture);
  assert.match(categorized, /t-skillmatrix/);
  assert.match(categorized, /t-skill-matrix-row/);
  const inline = buildLayoutHTML(compileTemplate(editorial), fixture);
  assert.match(inline, /t-skill-inline-row/);
  assert.match(inline, /t-skill-label/);
  assert.doesNotMatch(inline, /skill-pill|progress|rating/i);
});
