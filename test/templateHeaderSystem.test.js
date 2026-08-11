import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, buildLayoutHTML, layoutCSS } from '../web/src/lib/templateOs/compiler.js';
import { resolveRenderDesign } from '../web/src/lib/templateOs/renderDesign.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { PRIMITIVES } from '../web/src/lib/templateOs/primitives.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';

const devops = structuredClone(getResumeFixture('devops-cloud').data);
const student = structuredClone(getResumeFixture('student-project-heavy').data);
const senior = structuredClone(getResumeFixture('senior-long').data);
const technical = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');
const balanced = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'balanced-two-column');
const editorial = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional');
const campus = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'campus-portfolio');

function executiveDef() {
  const def = structuredClone(editorial);
  def.id = 'test-executive-header';
  def.name = 'Test Executive Header';
  def.headerStyle = { primitive: 'executive' };
  def.colors = { preset: 'navy' };
  def.typography = { preset: 'executive-serif' };
  return def;
}

test('Phase 8 exposes five genuinely distinct premium header primitives', () => {
  for (const id of ['technical', 'editorial', 'corporate', 'executive', 'student']) {
    assert.ok(PRIMITIVES.headers[id], `missing ${id} header primitive`);
  }
  assert.equal(PRIMITIVES.headers.technical.layout, 'technical');
  assert.equal(PRIMITIVES.headers.editorial.layout, 'editorial');
  assert.equal(PRIMITIVES.headers.corporate.layout, 'split');
  assert.equal(PRIMITIVES.headers.executive.layout, 'band');
  assert.equal(PRIMITIVES.headers.student.layout, 'student');
});

test('builtin families use distinct header systems rather than color-only variants', () => {
  assert.equal(technical.headerStyle.primitive, 'technical');
  assert.equal(balanced.headerStyle.primitive, 'corporate');
  assert.equal(editorial.headerStyle.primitive, 'editorial');
  assert.equal(campus.headerStyle.primitive, 'student');
});

test('Technical header shares vertical-accent + grid contract across HTML and PDF', () => {
  const c = compileTemplate(technical);
  const d = resolveRenderDesign(c);
  const html = buildLayoutHTML(c, devops);
  const css = layoutCSS(c);
  assert.equal(d.header.layout, 'technical');
  assert.equal(d.header.accentMark, 'vertical');
  assert.equal(d.header.contactLayout, 'grid');
  assert.match(html, /t-header-primary t-header-primary-accent/);
  assert.match(html, /t-contact-grid/);
  assert.match(css, /t-header-primary-accent\{border-left:/);
  const pdf = renderTemplatePdf(c, devops, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
  assert.equal(pdf.renderDesignVersion, 'template-render-design-v12-reference-premium-families');
  assert.equal(pdf.version, 'template-pdf-writer-v18-owned-pagination-reference-premium-families');
});

test('Corporate header renders split identity/contact geometry', () => {
  const c = compileTemplate(balanced);
  const d = resolveRenderDesign(c);
  const html = buildLayoutHTML(c, devops);
  const css = layoutCSS(c);
  assert.equal(d.header.layout, 'split');
  assert.equal(d.header.contactAlign, 'right');
  assert.match(html, /t-header-layout-split/);
  assert.match(html, /t-header-split/);
  assert.match(html, /t-contact-split/);
  assert.match(css, /grid-template-columns:minmax\(0,0\.62fr\) minmax\(0,0\.38fr\)/);
  const pdf = renderTemplatePdf(c, devops, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
});

test('Editorial header is compact inline editorial hierarchy, not stacked contact rows', () => {
  const c = compileTemplate(editorial);
  const d = resolveRenderDesign(c);
  const html = buildLayoutHTML(c, devops);
  assert.equal(d.header.layout, 'editorial');
  assert.equal(d.header.contactLayout, 'inline');
  assert.equal(d.header.titleCase, 'upper');
  assert.match(html, /t-header-layout-editorial/);
  assert.doesNotMatch(html, /t-contact-stacked/);
  const pdf = renderTemplatePdf(c, devops, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
});

test('Student header uses centered short accent signature while preserving one-page fixture', () => {
  const c = compileTemplate(campus);
  const d = resolveRenderDesign(c);
  const html = buildLayoutHTML(c, student);
  assert.equal(d.header.layout, 'student');
  assert.equal(d.header.accentMark, 'short-rule');
  assert.match(html, /t-header-short-accent/);
  const pdf = renderTemplatePdf(c, student, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
});

test('Executive header renders an inverse full-width band without changing resume facts', () => {
  const c = compileTemplate(executiveDef());
  assert.equal(c.ok, true, c.validation?.errors?.join('; '));
  const d = resolveRenderDesign(c);
  assert.equal(d.header.layout, 'band');
  assert.equal(d.header.bandBackgroundColor, c.tokens.colors.accent);
  assert.equal(d.header.nameColor, '#ffffff');
  const html = buildLayoutHTML(c, senior);
  assert.match(html, /t-header-layout-band/);
  assert.match(html, /<h1 class="t-name">Meera Krishnan<\/h1>/);
  assert.match(html, /text-transform:uppercase/);
  const pdf = renderTemplatePdf(c, senior, { sizeId: 'a4' });
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  assert.match(raw, /MEERA KRISHNAN/);
  assert.match(raw, /Staff Software Engineer/);
  assert.ok(pdf.pageCount >= 1 && pdf.pageCount <= 2);
});
