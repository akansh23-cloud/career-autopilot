import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, layoutCSS } from '../web/src/lib/templateOs/compiler.js';
import { renderTemplatePdf, PDF_FONTS } from '../web/src/lib/templateOs/pdfWriter.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { TEMPLATE_FIXTURES } from '../web/src/lib/templateOs/shape.js';

const senior = TEMPLATE_FIXTURES.find((f) => f.id === 'senior-technical').structured;
const technical = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');
const editorial = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional');

test('premium typography resolves to readable PDF-scale body text and semantic hierarchy', () => {
  const c = compileTemplate(technical);
  assert.equal(c.ok, true);
  assert.ok(c.tokens.typography.bodyFontPx >= 12.7);
  assert.ok(c.tokens.typography.nameSize >= c.tokens.typography.bodyFontPx * 2);
  assert.ok(c.tokens.typography.roleSize > c.tokens.typography.metaSize);
  assert.ok(c.tokens.typography.headingSize > c.tokens.typography.metaSize);
  const css = layoutCSS(c);
  assert.match(css, /\.t-role\{font-size:/);
  assert.match(css, /\.t-contact\{[^}]*font-size:/);
  assert.match(css, /\.t-skillhead\{[^}]*font-weight:750/);
});

test('technical PDF typography uses controlled mono contact font and remains one page on flagship fixture', () => {
  const c = compileTemplate(technical);
  const pdf = renderTemplatePdf(c, senior, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  assert.match(raw, /\/Courier /);
  assert.match(raw, /\/F5 /);
  assert.ok(pdf.lineCount > 30);
});

test('editorial preset retains serif identity while using the premium scale', () => {
  const c = compileTemplate(editorial);
  assert.equal(c.ok, true);
  assert.match(c.tokens.typography.font, /Georgia|Times/i);
  const pdf = renderTemplatePdf(c, senior, { sizeId: 'a4' });
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  assert.match(raw, new RegExp(`/${PDF_FONTS.times.base}`));
  assert.equal(pdf.pageCount, 1);
});
