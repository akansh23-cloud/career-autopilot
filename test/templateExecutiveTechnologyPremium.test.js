import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, buildLayoutHTML, layoutCSS } from '../web/src/lib/templateOs/compiler.js';
import { resolveRenderDesign } from '../web/src/lib/templateOs/renderDesign.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { TEMPLATE_OS_BUILTINS, BUILTIN_CERTIFICATION } from '../web/src/lib/templateOs/builtins.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';

const executive = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'executive-technology');
const senior = structuredClone(getResumeFixture('senior-long').data);

// Add a second leadership-oriented project so the compact project contract is exercised.
senior.projects.push({
  name: 'Architecture Decision System',
  techStack: 'RFC workflow, platform governance',
  link: 'github.com/meerak/architecture-rfcs',
  bullets: ['Standardized architecture reviews across nine teams.', 'Reduced repeated design escalations by introducing reusable decision records.'],
});

test('Phase 12 registers a true Executive Technology template with leadership-first content order', () => {
  assert.ok(executive, 'missing executive-technology builtin');
  const c = compileTemplate(executive);
  assert.equal(c.ok, true, c.validation?.errors?.join('; '));
  assert.equal(c.tree.layoutType, 'single-column');
  assert.deepEqual(c.tree.sections.map((s) => s.key).slice(0, 4), ['summary', 'achievements', 'experience', 'skills']);
  assert.equal(c.tokens.header.id, 'executive');
  assert.equal(c.tokens.experience.id, 'executive-impact');
  assert.equal(c.tokens.typography.id, 'executive-premium');
  assert.equal(c.tokens.colors.id, 'executive-navy');
  assert.equal(c.tokens.visual.singleColumnTreatment.id, 'executive-flow');
  assert.equal(c.tokens.visual.summaryTreatment.id, 'executive-lead');
  assert.equal(BUILTIN_CERTIFICATION['executive-technology'].atsLevel, 'VERY_HIGH');
});

test('Executive HTML uses inverse leadership band, impact-led experience, restrained skill rows and premium narrative measure', () => {
  const c = compileTemplate(executive);
  const d = resolveRenderDesign(c);
  const html = buildLayoutHTML(c, senior);
  const css = layoutCSS(c);
  assert.equal(d.header.layout, 'band');
  assert.equal(d.header.align, 'left');
  assert.equal(d.singleColumn.contentWidthScale, 0.955);
  assert.ok(d.summary.sizePx > d.typography.bodyPx);
  assert.equal(d.experience.leadBullet, 'strong');
  assert.match(html, /t-header-layout-band/);
  assert.match(html, /t-lead-strong/);
  assert.match(html, /data-section="achievements"/);
  assert.match(css, /width:95\.5%/);
  assert.match(css, /background:#18283d|background:var\(--tpl-accent\)/);
});

test('Executive vector PDF preserves senior content in one or two readable A4 pages', () => {
  const c = compileTemplate(executive);
  const pdf = renderTemplatePdf(c, senior, { sizeId: 'a4' });
  assert.ok(pdf.pageCount >= 1 && pdf.pageCount <= 2, `unexpected page count ${pdf.pageCount}`);
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  assert.match(raw, /MEERA KRISHNAN/);
  assert.match(raw, /STAFF SOFTWARE ENGINEER/);
  assert.match(raw, /Built architecture guild covering 60\+ engineers/);
  assert.match(raw, /FinEdge/);
  assert.match(raw, /AWS Solutions Architect Professional/);
  assert.ok(pdf.geometry.columns.length === 1);
});
