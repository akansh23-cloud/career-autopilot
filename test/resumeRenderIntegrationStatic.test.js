import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const studio = fs.readFileSync(new URL('../web/src/views/ResumeStudio.jsx', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../web/src/lib/resumeOs.js', import.meta.url), 'utf8');
const resumeRoutes = fs.readFileSync(new URL('../server/routes/resumeOsRoutes.js', import.meta.url), 'utf8');
const templateRoutes = fs.readFileSync(new URL('../server/routes/templateOsRoutes.js', import.meta.url), 'utf8');

test('Resume Studio normal PDF export uses canonical server renderer', () => {
  assert.match(studio, /downloadResumePdf\(doc, tplX/);
  assert.doesNotMatch(studio, /renderTemplatePdf\(compiledX/);
  assert.doesNotMatch(studio, /exportResumePDF\(structured, tplX/);
});

test('client uses canonical PDF endpoints', () => {
  assert.match(client, /\/api\/resume-os\/export\/pdf/);
  assert.match(client, /\/api\/template-os\/export\/pdf/);
});

test('both server export surfaces delegate to ResumeRenderService', () => {
  assert.match(resumeRoutes, /renderResumePdf\(/);
  assert.match(templateRoutes, /renderResumePdf\(/);
});


test('legacy and Template OS previews share the Template OS compiler used by export', () => {
  assert.match(studio, /const definition = tpl\.engine === 'template-os' \? tpl\.definition : fromLegacyTemplate\(tpl\)/);
  assert.match(studio, /buildLayoutHTML\(compiled, structured/);
});

test('Playwright is a production dependency for the Chromium provider', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.dependencies?.playwright);
});

const editor = fs.readFileSync(new URL('../web/src/views/Editor.jsx', import.meta.url), 'utf8');
const templateComponents = fs.readFileSync(new URL('../web/src/components/ResumeTemplates.jsx', import.meta.url), 'utf8');

test('Editor built-in PDF export uses canonical server renderer', () => {
  assert.match(editor, /downloadResumePdf\(doc, \{ id: tplId \}/);
  assert.match(editor, /custom-upload/); // transient custom template is the documented legacy exception until Phase 3
});

test('template preview modal built-in PDF export uses canonical server renderer', () => {
  assert.match(templateComponents, /downloadResumePdf\(doc, \{ id: templateId \}/);
  assert.match(templateComponents, /custom-upload/);
});

test('Editor preview uses canonical Template OS compiler for built-in templates', () => {
  assert.match(templateComponents, /getCanonicalResumeTemplate\(templateId\)/);
  assert.match(templateComponents, /buildLayoutHTML\(compiled, structured/);
});
