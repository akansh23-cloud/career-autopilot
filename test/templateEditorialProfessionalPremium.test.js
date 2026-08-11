import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, buildLayoutHTML, layoutCSS } from '../web/src/lib/templateOs/compiler.js';
import { resolveRenderDesign } from '../web/src/lib/templateOs/renderDesign.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';

const editorial = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional');
const professional = structuredClone(getResumeFixture('mid-developer').data);

test('Phase 10 Editorial Professional uses premium single-column editorial primitives', () => {
  const c = compileTemplate(editorial);
  assert.equal(c.ok, true, c.validation?.errors?.join('; '));
  assert.equal(c.tokens.typography.id, 'editorial-premium');
  assert.equal(c.tokens.experience.id, 'editorial');
  assert.equal(c.tokens.divider.id, 'editorial-line');
  assert.equal(c.tokens.visual.singleColumnTreatment.id, 'editorial-flow');
  assert.equal(c.tokens.visual.summaryTreatment.id, 'editorial-lead');
  const d = resolveRenderDesign(c);
  assert.equal(d.version, 'template-render-design-v12-reference-premium-families');
  assert.equal(d.singleColumn.contentWidthScale, 0.94);
  assert.ok(d.summary.sizePt > d.typography.bodyPt);
  assert.equal(d.summary.color, c.tokens.colors.muted);
});

test('Editorial HTML uses narrower narrative measure, lead summary and inline hairline headings', () => {
  const c = compileTemplate(editorial);
  const html = buildLayoutHTML(c, professional);
  const css = layoutCSS(c);
  assert.match(html, /t-header-layout-editorial/);
  assert.match(css, /\.t-page > \.t-section\{width:94%/);
  assert.match(css, /\.t-section\[data-section="summary"\] \.t-p\{font-size:/);
  assert.match(css, /display:flex;align-items:center;gap:10px/);
  assert.match(css, /border-top:0\.8px solid var\(--tpl-rule\)/);
});

test('Editorial vector PDF mirrors narrowed flow and editorial heading rules', () => {
  const c = compileTemplate(editorial);
  const pdf = renderTemplatePdf(c, professional, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
  assert.equal(pdf.version, 'template-pdf-writer-v18-owned-pagination-reference-premium-families');
  assert.equal(pdf.renderDesignVersion, 'template-render-design-v12-reference-premium-families');
  assert.equal(pdf.geometry.columns.length, 1);
  const main = pdf.geometry.columns[0];
  const fullContent = 595.28 - pdf.geometry.marginPt * 2;
  assert.ok(main.w < fullContent * 0.95 && main.w > fullContent * 0.93, `${main.w}/${fullContent}`);
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  assert.match(raw, /PRIYA NAIR/);
  assert.match(raw, /Software Engineer II/);
  assert.match(raw, /OpenShelf/);
});
