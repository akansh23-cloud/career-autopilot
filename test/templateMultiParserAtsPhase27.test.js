import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { compileTemplate } from '../web/src/lib/templateOs/compiler.js';
import { TEMPLATE_FIXTURES } from '../web/src/lib/templateOs/shape.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { parseOwnedPdfTextItems, auditOwnedPdfAcrossParsers, ATS_PARSER_PROFILES, MULTI_PARSER_ATS_VERSION } from '../web/src/lib/templateOs/multiParserAts.js';
import { certifyDefinitionMultiParser, TEMPLATE_CERTIFICATION_VERSION } from '../web/src/lib/templateOs/certification.js';

const fixture = TEMPLATE_FIXTURES.find((x) => x.id === 'senior-technical').structured;
const byId = (id) => TEMPLATE_OS_BUILTINS.find((x) => x.id === id);

test('Phase 27 parses actual text-placement operators from the owned vector PDF', () => {
  const compiled = compileTemplate(byId('signature-engineering'));
  const pdf = renderTemplatePdf(compiled, fixture, { sizeId: 'a4' });
  const pages = parseOwnedPdfTextItems(pdf.bytes);
  assert.ok(pages.length >= 1);
  assert.ok(pages.flat().some((x) => x.text.includes('Rohan')));
  assert.ok(pages.flat().every((x) => Number.isFinite(x.x) && Number.isFinite(x.y)));
});

test('single-column flagship remains robust across all parser models', () => {
  const audit = auditOwnedPdfAcrossParsers(compileTemplate(byId('signature-engineering')), fixture, { sizeId: 'a4' });
  assert.equal(audit.version, MULTI_PARSER_ATS_VERSION);
  assert.equal(audit.parsers.length, ATS_PARSER_PROFILES.length);
  assert.equal(audit.allCritical, true);
  assert.equal(audit.robustness, 'VERY_HIGH');
  assert.ok(audit.parsers.every((x) => x.integrity >= 90 && x.orderScore >= 90));
});

test('multi-column certification reports visual-order risk without pretending named ATS behavior', () => {
  const cert = certifyDefinitionMultiParser(byId('technical-sidebar'), { sizeIds: ['a4'], fixtureIds: ['senior-technical'] });
  assert.equal(cert.certified, true);
  assert.equal(cert.parserSummary.find((x) => x.id === 'semantic-stream').minOrderScore, 100);
  assert.ok(cert.minOrderScore < 100);
  assert.match(cert.note, /do not claim behavior of named ATS vendors/i);
});

test('main certification contract is explicitly multi-parser aware', () => {
  assert.match(TEMPLATE_CERTIFICATION_VERSION, /multi-parser/);
  const cert = certifyDefinitionMultiParser(byId('balanced-two-column'), { sizeIds: ['a4'], fixtureIds: ['senior-technical'] });
  assert.equal(cert.certified, true);
  assert.ok(['BALANCED', 'HIGH', 'VERY_HIGH'].includes(cert.worstRobustness));
});
