import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, layoutCSS } from '../web/src/lib/templateOs/compiler.js';
import { resolveRenderDesign } from '../web/src/lib/templateOs/renderDesign.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { TEMPLATE_FIXTURES } from '../web/src/lib/templateOs/shape.js';

const senior = TEMPLATE_FIXTURES.find((f) => f.id === 'senior-technical').structured;
const technical = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');

test('Technical Sidebar flagship uses premium content-aware rail geometry', () => {
  const c = compileTemplate(technical);
  assert.equal(c.ok, true);
  assert.deepEqual(c.tree.columns.map((x) => x.width), [0.31, 0.69]);
  assert.equal(c.tokens.visual.sidebarPanel.id, 'premium-content');
  assert.equal(c.tokens.visual.sidebarPanel.heightMode, 'content');
  assert.equal(c.tokens.header.contactGridColumns, 2);
});

test('HTML technical rail uses two-column contact grid and restrained rail headings', () => {
  const c = compileTemplate(technical);
  const css = layoutCSS(c);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.t-col-sidebar \.t-h2\{border-bottom:0/);
  assert.match(css, /\.t-col-sidebar \.t-skillrow\{border-bottom:0/);
});

test('PDF technical rail stops near its content rather than painting to the page foot', () => {
  const c = compileTemplate(technical);
  const design = resolveRenderDesign(c, { sizeId: 'a4' });
  const pdf = renderTemplatePdf(c, senior, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
  assert.equal(pdf.renderDesignVersion, 'template-render-design-v12-reference-premium-families');
  const panel = pdf.geometry.sidebarPanels[0];
  assert.ok(panel, 'expected a sidebar panel geometry record');
  assert.equal(panel.mode, 'content');
  assert.ok(panel.height > 160, `rail too short: ${panel.height}`);
  const fullBody = design.page.pdf.h - design.spacing.marginPt * 2;
  assert.ok(panel.height < fullBody * 0.7, `content rail should not fill most of the body: ${panel.height}/${fullBody}`);
  assert.ok(panel.bottom > design.spacing.marginPt + 80, 'rail should finish well above the bottom page margin');
});
