import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, layoutCSS, buildLayoutHTML } from '../web/src/lib/templateOs/compiler.js';
import { resolveRenderDesign } from '../web/src/lib/templateOs/renderDesign.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';

const balanced = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'balanced-two-column');
const professional = structuredClone(getResumeFixture('mid-developer').data);

test('Phase 9 Balanced Two Column uses premium 38/62 narrative composition', () => {
  const c = compileTemplate(balanced);
  assert.equal(c.ok, true, c.validation?.errors?.join('; '));
  assert.deepEqual(c.tree.columns.map((x) => x.width), [0.38, 0.62]);
  assert.equal(c.tokens.skills.id, 'compact-matrix');
  assert.equal(c.tokens.visual.columnTreatment.id, 'editorial-split');
  const d = resolveRenderDesign(c);
  assert.equal(d.columns.referenceRegion, 'left');
  assert.ok(d.columns.dividerWidthPt > 0);
  assert.ok(d.columns.referenceSectionGapScale < 1);
});

test('Balanced Two Column HTML keeps reference and narrative regions distinct with a gutter rule', () => {
  const c = compileTemplate(balanced);
  const html = buildLayoutHTML(c, professional);
  const css = layoutCSS(c);
  assert.match(html, /t-col-left/);
  assert.match(html, /t-col-right/);
  assert.match(css, /grid-template-columns:0\.38fr 0\.62fr/);
  assert.match(css, /\.t-columns::after\{/);
  assert.match(css, /border-left:0\.8px solid var\(--tpl-rule\)/);
  assert.match(css, /\.t-col-left \.t-section\{margin-bottom:/);
  assert.match(css, /\.t-col-left \.t-h2\{font-size:/);
});

test('Balanced Two Column vector PDF mirrors premium split without stealing column width', () => {
  const c = compileTemplate(balanced);
  const pdf = renderTemplatePdf(c, professional, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
  assert.equal(pdf.renderDesignVersion, 'template-render-design-v12-reference-premium-families');
  assert.equal(pdf.version, 'template-pdf-writer-v18-owned-pagination-reference-premium-families');
  const [left, right] = pdf.geometry.columns;
  assert.equal(left.id, 'left');
  assert.equal(right.id, 'right');
  assert.ok(right.w > left.w * 1.5, `${right.w}/${left.w}`);
  assert.equal(pdf.geometry.columnDividers.length, 1);
  const divider = pdf.geometry.columnDividers[0];
  assert.ok(divider.x > left.x + left.w);
  assert.ok(divider.x < right.x);
});

test('Balanced Two Column keeps narrative sections on right and reference sections on left', () => {
  const c = compileTemplate(balanced);
  const byKey = Object.fromEntries(c.tree.sections.map((s) => [s.key, s.region]));
  assert.equal(byKey.summary, 'right');
  assert.equal(byKey.experience, 'right');
  assert.equal(byKey.projects, 'right');
  assert.equal(byKey.skills, 'left');
  assert.equal(byKey.education, 'left');
  assert.equal(byKey.certifications, 'left');
});
