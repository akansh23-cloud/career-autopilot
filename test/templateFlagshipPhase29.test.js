import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { validateTemplateDefinition } from '../web/src/lib/templateOs/dsl.js';
import { PRIMITIVES } from '../web/src/lib/templateOs/primitives.js';
import { compileTemplate, adaptTreeToShape, balancePageComposition } from '../web/src/lib/templateOs/compiler.js';
import { analyzeResumeShape } from '../web/src/lib/templateOs/shape.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { auditOwnedPdfAcrossParsers } from '../web/src/lib/templateOs/multiParserAts.js';

const flagship = TEMPLATE_OS_BUILTINS.find((x) => x.id === 'signature-engineering');

test('Phase 29 ships a published Career Autopilot flagship TemplateDefinition', () => {
  assert.ok(flagship);
  assert.equal(flagship.status, 'PUBLISHED');
  assert.equal(flagship.license.productionEnabled, true);
  assert.equal(validateTemplateDefinition(flagship, { primitives: PRIMITIVES }).ok, true);
  assert.equal(flagship.layout.type, 'single-column');
  assert.equal(flagship.typography.preset, 'signature-sans');
  assert.equal(flagship.colors.preset, 'graphite-blue');
});

test('flagship renders a dense engineering fixture as a premium owned PDF', () => {
  const structured = structuredClone(getResumeFixture('devops-cloud').data);
  const compiled = balancePageComposition(adaptTreeToShape(compileTemplate(flagship), analyzeResumeShape(structured, { targetRole: 'Senior DevOps Engineer' })), structured, { sizeId: 'a4' });
  const pdf = renderTemplatePdf(compiled, structured, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
  assert.ok(pdf.bytes.length > 5000);
  assert.ok(pdf.geometry.pageUsage[0].utilization > 0.70);
});

test('flagship earns strong multi-parser extraction rather than a decorative-only score', () => {
  const structured = structuredClone(getResumeFixture('devops-cloud').data);
  const audit = auditOwnedPdfAcrossParsers(compileTemplate(flagship), structured, { sizeId: 'a4' });
  assert.equal(audit.allCritical, true);
  assert.ok(audit.minIntegrity >= 90);
  assert.ok(audit.minOrderScore >= 90);
});
