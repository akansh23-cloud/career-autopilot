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
  /* Assert the PIPELINE, not one local variable name. The previous form pinned
     `buildLayoutHTML(compiled, structured` and so failed the moment the variable
     was renamed while doing the same thing — a test that guards spelling rather
     than behaviour. */
  assert.match(templateComponents, /compileTemplate\(/);
  assert.match(templateComponents, /balancePageComposition\(/);
  assert.match(templateComponents, /buildLayoutHTML\(\w+,\s*structured/);
});

test('Editor preview normalises the parsed shape before compiling', () => {
  /* The Editor holds parsed plain-text data; fromStructuredResume() reads
     `personalInfo` and silently returns an empty document for it. Without this
     adapter the preview renders a blank page and nothing reports a fault. */
  assert.match(templateComponents, /fromParsedResume/);
  assert.match(templateComponents, /fromStructuredResume\(fromParsedResume\(data\)\)/);
});

test('Editor preview never swallows a template compile failure', () => {
  /* A bare catch here hid a DSL validation error across 28 of 51 templates:
     every one silently fell back to the legacy renderer. */
  assert.match(templateComponents, /if \(!compiled\?\.ok\)/);
  assert.match(templateComponents, /console\.error/);
});
