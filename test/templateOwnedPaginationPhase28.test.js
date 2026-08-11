import test from 'node:test';
import assert from 'node:assert/strict';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { compileTemplate, adaptTreeToShape, balancePageComposition } from '../web/src/lib/templateOs/compiler.js';
import { analyzeResumeShape } from '../web/src/lib/templateOs/shape.js';
import { renderTemplatePdf, PDF_WRITER_VERSION, OWNED_PAGINATION_VERSION } from '../web/src/lib/templateOs/pdfWriter.js';

const byId = (id) => TEMPLATE_OS_BUILTINS.find((x) => x.id === id);

test('Phase 28 exposes owned semantic pagination telemetry', () => {
  const structured = structuredClone(getResumeFixture('senior-long').data);
  const compiled = compileTemplate(byId('executive-technology'));
  const pdf = renderTemplatePdf(compiled, structured, { sizeId: 'a4', rebalanceOrphans: false });
  assert.match(PDF_WRITER_VERSION, /owned-pagination/);
  assert.equal(pdf.geometry.pagination.version, OWNED_PAGINATION_VERSION);
  assert.equal(pdf.geometry.pagination.semanticSectionGroups, true);
  assert.equal(pdf.geometry.pagination.noBrowserPageBreaks, true);
  assert.ok(pdf.geometry.pagination.preventedGroupOrphans >= 1);
});

test('semantic heading/role groups are protected before the page break', () => {
  const structured = structuredClone(getResumeFixture('senior-long').data);
  const compiled = compileTemplate(byId('executive-technology'));
  const pdf = renderTemplatePdf(compiled, structured, { sizeId: 'a4', rebalanceOrphans: false });
  assert.equal(pdf.pageCount, 2);
  assert.ok(pdf.geometry.pagination.preventedGroupOrphans >= 1);
});

test('premium two-page rebalance still moves a complete late section instead of individual lines', () => {
  const structured = structuredClone(getResumeFixture('senior-long').data);
  const base = adaptTreeToShape(compileTemplate(byId('executive-technology')), analyzeResumeShape(structured, { targetRole: 'Director of Engineering' }));
  const pdf = renderTemplatePdf(balancePageComposition(base, structured, { sizeId: 'a4' }), structured, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 2);
  assert.equal(pdf.geometry.orphanRebalance?.applied, true);
  assert.equal(pdf.geometry.orphanRebalance?.sectionKey, 'skills');
  assert.ok(pdf.geometry.pageUsage[1].utilization >= 0.40);
});
