import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, layoutCSS, buildLayoutHTML } from '../web/src/lib/templateOs/compiler.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { TEMPLATE_FIXTURES } from '../web/src/lib/templateOs/shape.js';

const senior = TEMPLATE_FIXTURES.find((f) => f.id === 'senior-technical').structured;
const technical = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');
const editorial = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional');

test('technical templates resolve reusable premium visual primitives', () => {
  const c = compileTemplate(technical);
  assert.equal(c.ok, true);
  assert.equal(c.tokens.visual.headerRule.id, 'hairline');
  assert.equal(c.tokens.visual.sidebarPanel.id, 'premium-content');
  assert.equal(c.tokens.visual.certificationBlock.id, 'accent');
  assert.equal(c.tokens.visual.projectMeta.id, 'accent');
  assert.equal(c.tokens.visual.verifiedBadge.id, 'soft');
});

test('HTML renderer applies shared header, sidebar, certification, project, and badge treatments', () => {
  const c = compileTemplate(technical);
  const css = layoutCSS(c);
  const html = buildLayoutHTML(c, senior);
  assert.match(css, /border-bottom:0\.8px solid var\(--tpl-rule\)/);
  assert.match(css, /border-right:1\.5px solid var\(--tpl-accent\)/);
  assert.match(css, /data-section="certifications"/);
  assert.match(css, /data-section="projects"/);
  assert.match(css, /background:var\(--tpl-side\)/);
  assert.match(html, /class="t-project-verified t-verified">VERIFIED/);
});

test('vector PDF emits reusable line primitives while preserving searchable text', () => {
  const c = compileTemplate(technical);
  const pdf = renderTemplatePdf(c, senior, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  assert.match(raw, / RG [0-9.]+ w [0-9.]+ [0-9.]+ m [0-9.]+ [0-9.]+ l S Q/);
  assert.match(raw, /CERTIFICATIONS/);
  assert.match(raw, /Zero-Downtime Migration/);
  assert.ok((raw.match(/ l S Q/g) || []).length >= 8, 'expected header/section/sidebar visual lines in the PDF');
});

test('editorial layouts retain restrained hairline/short-rule visual identity without sidebar decoration', () => {
  const c = compileTemplate(editorial);
  assert.equal(c.tokens.visual.headerRule.id, 'hairline');
  assert.equal(c.tokens.visual.sidebarPanel.id, 'none');
  const pdf = renderTemplatePdf(c, senior, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  assert.match(raw, /SUMMARY/);
  assert.ok((raw.match(/ l S Q/g) || []).length >= 5, 'expected editorial header and short section rules');
});
