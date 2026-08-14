import test from 'node:test';
import assert from 'node:assert/strict';
import { fromStructuredResume } from '../server/utils/resume/resumeDocument.js';
import { renderResumePdf } from '../server/services/resumeRender/resumeRenderService.js';
import { hasUnsupportedVectorGlyphs } from '../server/services/resumeRender/renderUtils.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';

const def = TEMPLATE_OS_BUILTINS.find((x) => x.id === 'cloud-infrastructure-pro') || TEMPLATE_OS_BUILTINS[0];

test('auto renderer uses vector for compatible Latin resume and preserves selectable text', async () => {
  const doc = fromStructuredResume(getResumeFixture('devops-cloud').data);
  doc.templateId = def.id; doc.pageSize = 'a4';
  const out = await renderResumePdf({ doc, definition: def, provider: 'auto' });
  assert.equal(out.selectedProvider, 'vector');
  assert.ok(out.bytes.length > 1000);
  assert.equal(out.validation.selectableText, true);
  assert.equal(out.validation.criticalOk, true);
  assert.match(out.extractedText, /Rahul Verma/i);
  assert.ok(out.renderSignature.length >= 32);
});

test('unicode detection prevents vector character loss', async () => {
  const doc = fromStructuredResume(getResumeFixture('devops-cloud').data);
  doc.contact.name = 'आरव शर्मा';
  assert.equal(hasUnsupportedVectorGlyphs(doc), true);
  await assert.rejects(() => renderResumePdf({ doc, definition: def, provider: 'vector' }), /vector_renderer_cannot_preserve_unicode/);
});

test('auto renderer uses an HTML Unicode provider and preserves Devanagari text', async () => {
  const doc = fromStructuredResume(getResumeFixture('devops-cloud').data);
  doc.contact.name = 'आरव शर्मा';
  doc.summary = 'क्लाउड और DevOps इंजीनियर, Kubernetes और AWS अनुभव के साथ।';
  doc.templateId = def.id; doc.pageSize = 'a4';
  const out = await renderResumePdf({ doc, definition: def, provider: 'auto' });
  assert.ok(['chromium', 'weasyprint'].includes(out.selectedProvider));
  assert.ok(['playwright', 'chromium-cli', 'weasyprint'].includes(out.engine));
  assert.equal(out.validation.selectableText, true);
  const compact = out.extractedText.replace(/\s+/g, '');
  assert.match(compact, /आरवशर्मा/);
  assert.match(compact, /क्लाउड/);
});

test('render signature is stable for unchanged document/template', async () => {
  const doc = fromStructuredResume(getResumeFixture('missing-sections').data);
  const a = await renderResumePdf({ doc, definition: def, provider: 'vector' });
  const b = await renderResumePdf({ doc, definition: def, provider: 'vector' });
  assert.equal(a.renderSignature, b.renderSignature);
});
