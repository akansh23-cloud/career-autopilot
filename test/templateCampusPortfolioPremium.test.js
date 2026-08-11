import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, buildLayoutHTML, layoutCSS } from '../web/src/lib/templateOs/compiler.js';
import { resolveRenderDesign } from '../web/src/lib/templateOs/renderDesign.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { TEMPLATE_OS_BUILTINS, BUILTIN_CERTIFICATION } from '../web/src/lib/templateOs/builtins.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';

const campus = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'campus-portfolio');
const fullStudent = structuredClone(getResumeFixture('student-project-heavy').data);
const targetedStudent = structuredClone(fullStudent);
targetedStudent.projects = targetedStudent.projects.slice(0, 3);
targetedStudent.achievements = targetedStudent.achievements.slice(0, 2);

test('Phase 13 Campus Portfolio is education/project-first with a compact student rail', () => {
  assert.ok(campus, 'missing campus-portfolio builtin');
  const c = compileTemplate(campus);
  assert.equal(c.ok, true, c.validation?.errors?.join('; '));
  assert.equal(c.tree.layoutType, 'sidebar-right');
  assert.deepEqual(c.tree.columns.map((x) => x.width), [0.7, 0.3]);
  assert.deepEqual(c.tree.sections.map((s) => s.key).slice(0, 4), ['summary', 'education', 'projects', 'experience']);
  assert.equal(c.tokens.header.id, 'student');
  assert.equal(c.tokens.skills.id, 'sidebar-groups');
  assert.equal(c.tokens.projects.id, 'student-portfolio');
  assert.equal(c.tokens.education.id, 'campus-featured');
  assert.equal(c.tokens.typography.id, 'student-premium');
  assert.equal(c.tokens.colors.id, 'campus-blue');
  assert.equal(c.tokens.visual.sidebarPanel.id, 'student-rail');
  assert.equal(c.tokens.visual.summaryTreatment.id, 'student-intro');
  assert.equal(BUILTIN_CERTIFICATION['campus-portfolio'].atsLevel, 'HIGH');
});

test('Campus HTML uses grouped skills, featured education and project portfolio hierarchy without pill/progress UI', () => {
  const c = compileTemplate(campus);
  const design = resolveRenderDesign(c);
  const html = buildLayoutHTML(c, targetedStudent);
  const css = layoutCSS(c);
  assert.equal(design.sidebar.heightMode, 'content');
  assert.equal(design.education.layout, 'featured');
  assert.equal(design.projects.maxBullets, 3);
  assert.match(html, /t-edu-featured/);
  assert.match(html, /t-edu-degree/);
  assert.match(html, /t-skillgroup-sidebar/);
  assert.match(html, /data-section="projects"/);
  assert.match(css, /border-left:1\.4px solid/);
  assert.doesNotMatch(html + css, /progress-bar|skill-rating|star-rating/);
});

test('Campus vector PDF keeps targeted student resume one-page with content-height rail and education/project content', () => {
  const c = compileTemplate(campus);
  const pdf = renderTemplatePdf(c, targetedStudent, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
  assert.equal(pdf.version, 'template-pdf-writer-v18-owned-pagination-reference-premium-families');
  assert.equal(pdf.renderDesignVersion, 'template-render-design-v12-reference-premium-families');
  const rail = pdf.geometry.sidebarPanels[0];
  assert.ok(rail, 'missing sidebar panel geometry');
  assert.equal(rail.mode, 'content');
  assert.ok(rail.height < 400, `student rail should be content-height, got ${rail.height}`);
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  assert.match(raw, /Ishaan Patel/);
  assert.match(raw, /Nirma University/);
  assert.match(raw, /B\.Tech CSE/);
  assert.match(raw, /SignSpeak/);
  assert.match(raw, /Research Intern/);
  assert.match(raw, /DeepLearning\.AI ML/);
});

test('Campus full project-heavy fixture remains within declared two-page capability', () => {
  const c = compileTemplate(campus);
  const pdf = renderTemplatePdf(c, fullStudent, { sizeId: 'a4' });
  assert.ok(pdf.pageCount >= 1 && pdf.pageCount <= 2, `unexpected page count ${pdf.pageCount}`);
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  for (const name of ['SignSpeak', 'AgriScan', 'NoteWeave', 'QuizForge', 'TrackMyBus']) assert.match(raw, new RegExp(name));
});
