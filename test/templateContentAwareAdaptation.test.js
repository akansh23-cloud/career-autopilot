import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, adaptTreeToShape, buildLayoutHTML } from '../web/src/lib/templateOs/compiler.js';
import { analyzeResumeShape } from '../web/src/lib/templateOs/shape.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';

const tpl = (id) => TEMPLATE_OS_BUILTINS.find((d) => d.id === id);
const fixture = (id) => structuredClone(getResumeFixture(id).data);

function shaped(templateId, fixtureId) {
  const doc = fixture(fixtureId);
  const shape = analyzeResumeShape(doc);
  return { doc, shape, compiled: adaptTreeToShape(compileTemplate(tpl(templateId)), shape) };
}

test('ResumeShape v2 understands renderer-structured resumes and exposes adaptation pressure', () => {
  const devops = analyzeResumeShape(fixture('devops-cloud'));
  assert.equal(devops.version, 'resume-shape-v4-full-sections');
  assert.equal(devops.skillCount, 26);
  assert.equal(devops.skillDensity, 'high');
  assert.equal(devops.experienceCount, 2);
  assert.equal(devops.careerStage, 'mid');
  assert.equal(devops.layoutPressure, 'high');

  const student = analyzeResumeShape(fixture('student-project-heavy'));
  assert.equal(student.careerStage, 'student');
  assert.equal(student.projectCount, 5);
  assert.equal(student.projectDensity, 'high');
  assert.equal(student.educationImportance, 'high');
});

test('sparse technical rail yields page width back to narrative and honors declared fallbacks only', () => {
  const { compiled } = shaped('technical-sidebar', 'missing-sections');
  assert.equal(compiled.adaptation.version, 'shape-adaptation-v2');
  const side = compiled.tree.columns.find((c) => c.id === 'sidebar');
  const main = compiled.tree.columns.find((c) => c.id === 'main');
  assert.ok(side.width < 0.31, `expected sparse rail below base width, got ${side.width}`);
  assert.ok(main.width > 0.69, `expected wider narrative column, got ${main.width}`);
  const achievement = compiled.tree.sections.find((s) => s.key === 'achievements');
  assert.equal(achievement.region, 'sidebar');
  assert.ok(compiled.adaptation.moves.some((m) => m.section === 'achievements'));
});

test('dense skills compact rail rhythm without reducing the base body typography', () => {
  const def = tpl('technical-sidebar');
  const base = compileTemplate(def);
  const { compiled, shape } = shaped('technical-sidebar', 'overlong-skill-dump');
  assert.equal(shape.skillDensity, 'high');
  assert.ok(compiled.tokens.skills.groupGapScale < base.tokens.skills.groupGapScale);
  assert.ok(compiled.tokens.skills.itemSizeScale < base.tokens.skills.itemSizeScale);
  assert.equal(compiled.tokens.typography.bodyFontPx, base.tokens.typography.bodyFontPx);
  assert.equal(compiled.tokens.spacing.marginMm, base.tokens.spacing.marginMm);
  assert.ok(compiled.adaptation.adjustments.some((a) => a.type === 'skill-density'));
});

test('project-heavy student uses compact project geometry while retaining student project semantics', () => {
  const { compiled, shape, doc } = shaped('campus-portfolio', 'student-project-heavy');
  assert.equal(shape.projectDensity, 'high');
  assert.equal(compiled.tokens.projects.maxBullets, 2);
  assert.equal(compiled.tokens.projects.tight, true);
  assert.match(compiled.tokens.projects.id, /shape-compact$/);
  assert.equal(compiled.tokens.projects.badge, true);
  assert.ok(compiled.adaptation.adjustments.some((a) => a.type === 'project-density'));
  const html = buildLayoutHTML(compiled, doc);
  assert.match(html, /data-section="projects"/);
  assert.match(html, /SignSpeak/);
});

test('experience-heavy two-column resume prioritizes the narrative column', () => {
  const base = compileTemplate(tpl('balanced-two-column'));
  const { compiled, shape } = shaped('balanced-two-column', 'senior-long');
  assert.equal(shape.experiencePriority, 'high');
  const baseRight = base.tree.columns.find((c) => c.id === 'right').width;
  const right = compiled.tree.columns.find((c) => c.id === 'right').width;
  const left = compiled.tree.columns.find((c) => c.id === 'left').width;
  assert.ok(right > baseRight, `expected narrative width > ${baseRight}, got ${right}`);
  assert.equal(Number((right + left).toFixed(3)), 1);
  assert.ok(compiled.tokens.experience.itemGapScale < base.tokens.experience.itemGapScale);
});

test('actual PDF consumes the adapted column geometry rather than the static template widths', () => {
  const { compiled, doc } = shaped('technical-sidebar', 'missing-sections');
  const pdf = renderTemplatePdf(compiled, doc, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
  const side = compiled.tree.columns.find((c) => c.id === 'sidebar');
  const main = compiled.tree.columns.find((c) => c.id === 'main');
  const pdfSide = pdf.geometry.columns.find((c) => c.id === 'sidebar');
  const pdfMain = pdf.geometry.columns.find((c) => c.id === 'main');
  const pdfSideShare = pdfSide.w / (pdfSide.w + pdfMain.w);
  const pdfMainShare = pdfMain.w / (pdfSide.w + pdfMain.w);
  assert.ok(Math.abs(pdfSideShare - side.width) < 0.001, `${pdfSideShare} != ${side.width}`);
  assert.ok(Math.abs(pdfMainShare - main.width) < 0.001, `${pdfMainShare} != ${main.width}`);
});
