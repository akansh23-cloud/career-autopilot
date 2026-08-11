import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, normalizeTemplateDensity, normalizeResumeDensityToTemplateMode, buildLayoutHTML, DENSITY_ENGINE_VERSION } from '../web/src/lib/templateOs/compiler.js';
import { resolveRenderDesign } from '../web/src/lib/templateOs/renderDesign.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';

const technical = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');
const editorial = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional');
const doc = structuredClone(getResumeFixture('devops-cloud').data);

const compile = (def, density) => compileTemplate(def, density ? { density } : {});

test('premium density vocabulary maps legacy ResumeDocument values without changing storage', () => {
  assert.equal(DENSITY_ENGINE_VERSION, 'template-density-v1');
  assert.equal(normalizeResumeDensityToTemplateMode('comfortable'), 'spacious');
  assert.equal(normalizeResumeDensityToTemplateMode('compact'), 'balanced');
  assert.equal(normalizeResumeDensityToTemplateMode('tight'), 'compact');
  assert.equal(normalizeTemplateDensity('spacious'), 'spacious');
  assert.equal(normalizeTemplateDensity('balanced'), 'balanced');
  assert.equal(normalizeTemplateDensity('unknown'), null);
});

test('density modes change spacing and margins monotonically while preserving typography', () => {
  const compact = compile(technical, 'compact');
  const balanced = compile(technical, 'balanced');
  const spacious = compile(technical, 'spacious');
  assert.ok(compact.tokens.spacing.marginMm < balanced.tokens.spacing.marginMm);
  assert.ok(balanced.tokens.spacing.marginMm < spacious.tokens.spacing.marginMm);
  assert.ok(compact.tokens.spacing.sectionGapPx < balanced.tokens.spacing.sectionGapPx);
  assert.ok(balanced.tokens.spacing.sectionGapPx < spacious.tokens.spacing.sectionGapPx);
  assert.ok(compact.tokens.spacing.itemGapPx < balanced.tokens.spacing.itemGapPx);
  assert.ok(compact.tokens.spacing.bulletGapPx < balanced.tokens.spacing.bulletGapPx);
  assert.equal(compact.tokens.typography.bodyFontPx, balanced.tokens.typography.bodyFontPx);
  assert.equal(spacious.tokens.typography.bodyFontPx, balanced.tokens.typography.bodyFontPx);
  assert.ok(compact.tokens.spacing.marginMm >= 10);
});

test('template hand-tuned base spacing is preserved when no explicit density is requested', () => {
  const base = compile(editorial);
  const spacious = compile(editorial, 'spacious');
  assert.equal(base.tokens.spacing.densityMode, 'spacious');
  assert.equal(base.tokens.spacing.marginMm, 18);
  assert.equal(base.tokens.spacing.sectionGapPx, 17);
  assert.deepEqual(
    { margin: base.tokens.spacing.marginMm, section: base.tokens.spacing.sectionGapPx, item: base.tokens.spacing.itemGapPx, bullet: base.tokens.spacing.bulletGapPx },
    { margin: spacious.tokens.spacing.marginMm, section: spacious.tokens.spacing.sectionGapPx, item: spacious.tokens.spacing.itemGapPx, bullet: spacious.tokens.spacing.bulletGapPx },
  );
});

test('HTML and PDF consume the same density contract', () => {
  for (const mode of ['compact', 'balanced', 'spacious']) {
    const compiled = compile(technical, mode);
    const design = resolveRenderDesign(compiled);
    const html = buildLayoutHTML(compiled, doc);
    const pdf = renderTemplatePdf(compiled, doc, { sizeId: 'a4' });
    assert.equal(design.density.mode, mode);
    assert.match(html, new RegExp(`padding:${design.spacing.marginMm}mm`));
    assert.equal(pdf.pageCount, 1);
    assert.equal(pdf.renderDesignVersion, 'template-render-design-v12-reference-premium-families');
  }
});

test('compact/balanced/spacious alter metadata rhythm without changing font safety', () => {
  const compact = resolveRenderDesign(compile(technical, 'compact'));
  const balanced = resolveRenderDesign(compile(technical, 'balanced'));
  const spacious = resolveRenderDesign(compile(technical, 'spacious'));
  assert.equal(compact.density.metadataLayout, 'condensed');
  assert.equal(balanced.density.metadataLayout, 'standard');
  assert.equal(spacious.density.metadataLayout, 'open');
  assert.ok(compact.experience.metaGapPx < balanced.experience.metaGapPx);
  assert.ok(balanced.experience.metaGapPx < spacious.experience.metaGapPx);
  assert.equal(compact.typography.bodyPx, balanced.typography.bodyPx);
  assert.equal(spacious.typography.bodyPx, balanced.typography.bodyPx);
  assert.ok(compact.typography.bodyPx >= 9.5);
});
