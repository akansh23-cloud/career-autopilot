import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, layoutCSS } from '../web/src/lib/templateOs/compiler.js';
import { resolveRenderDesign } from '../web/src/lib/templateOs/renderDesign.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { TEMPLATE_FIXTURES } from '../web/src/lib/templateOs/shape.js';

const senior = TEMPLATE_FIXTURES.find((f) => f.id === 'senior-technical').structured;
const technical = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');
const editorial = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional');

function rawPdf(def) {
  return Buffer.from(renderTemplatePdf(compileTemplate(def), senior, { sizeId: 'a4' }).bytes).toString('latin1');
}

test('shared render design resolves the same geometry contract for HTML and PDF', () => {
  const c = compileTemplate(technical);
  const design = resolveRenderDesign(c, { sizeId: 'a4' });
  const css = layoutCSS(c, { sizeId: 'a4' });
  assert.equal(design.spacing.columnGapPx, c.tokens.spacing.sectionGapPx + 6);
  assert.equal(design.sidebar.paddingXPt, design.sidebar.paddingXpx * 0.75);
  assert.match(css, new RegExp(`gap:0 ${design.spacing.columnGapPx}px`));
  assert.match(css, new RegExp(`padding:${design.sidebar.paddingYpx}px ${design.sidebar.paddingXpx}px`));
});

test('technical PDF honors grid-style contact layout instead of flattening it to one generic line', () => {
  const c = compileTemplate(technical);
  assert.equal(c.tokens.header.contactLayout, 'grid');
  const pdf = renderTemplatePdf(c, senior, { sizeId: 'a4' });
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  assert.match(raw, /fixture@example\.com/);
  assert.match(raw, /Pune, IN/);
  assert.equal(pdf.pageCount, 1);
  assert.equal(pdf.renderDesignVersion, 'template-render-design-v12-reference-premium-families');
});

test('editorial PDF honors inline contact layout while HTML uses the same resolved spacing', () => {
  const c = compileTemplate(editorial);
  assert.equal(c.tokens.header.contactLayout, 'inline');
  const design = resolveRenderDesign(c);
  const css = layoutCSS(c);
  assert.match(css, new RegExp(`margin-top:${design.header.contactMarginTopPx}px`));
  const raw = rawPdf(editorial);
  assert.match(raw, /fixture@example\.com/);
  assert.match(raw, /linkedin\.com\/in\/fixture/);
});

test('PDF and HTML share the same header/sidebar visual token choices', () => {
  const c = compileTemplate(technical);
  const design = resolveRenderDesign(c);
  assert.equal(design.header.rule.id, c.tokens.visual.headerRule.id);
  assert.equal(design.sidebar.id, c.tokens.visual.sidebarPanel.id);
  const raw = rawPdf(technical);
  assert.ok((raw.match(/ l S Q/g) || []).length >= 8);
});
