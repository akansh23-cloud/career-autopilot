import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RESUME_TEMPLATES } from '../web/src/lib/resumeTemplateRegistry.js';
import { TEMPLATES as EDITOR_TEMPLATES } from '../web/src/lib/resumeTemplates.js';
import {
  TEMPLATE_PREVIEW_CACHE_VERSION, TEMPLATE_PREVIEW_WIDTH, TEMPLATE_PREVIEW_HEIGHT,
  cachedTemplatePreviewUrl,
} from '../web/src/lib/templateOs/previewAssets.js';
import {
  TEMPLATE_PREVIEW_FIXTURE_VERSION, previewFixtureIdForTemplate, getTemplatePreviewStructured,
} from '../web/src/lib/templateOs/previewFixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_ROOT = path.join(ROOT, 'web', 'public', 'template-previews');
const manifest = JSON.parse(fs.readFileSync(path.join(PREVIEW_ROOT, 'manifest.json'), 'utf8'));

function pngInfo(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length };
}

test('preview cache has explicit versioning and stable URL invalidation', () => {
  assert.equal(TEMPLATE_PREVIEW_CACHE_VERSION, 'template-preview-cache-v1');
  assert.equal(TEMPLATE_PREVIEW_FIXTURE_VERSION, 'template-preview-fixtures-v1');
  assert.equal(TEMPLATE_PREVIEW_WIDTH, 360);
  assert.equal(TEMPLATE_PREVIEW_HEIGHT, 509);
  assert.equal(
    cachedTemplatePreviewUrl('technical-sidebar', { surface: 'resume-studio', templateVersion: 3 }),
    '/template-previews/resume-studio/technical-sidebar.png?pc=template-preview-cache-v1&tv=3',
  );
  assert.equal(
    cachedTemplatePreviewUrl('modern-pro', { surface: 'editor' }),
    '/template-previews/editor/modern-pro.png?pc=template-preview-cache-v1&tv=1',
  );
});

test('every static Resume Studio template has a real cached PNG at gallery size', () => {
  assert.equal(manifest.version, TEMPLATE_PREVIEW_CACHE_VERSION);
  assert.equal(manifest.surfaces['resume-studio'].length, RESUME_TEMPLATES.length);
  const manifestIds = new Set(manifest.surfaces['resume-studio'].map((r) => r.id));
  for (const tpl of RESUME_TEMPLATES) {
    assert.ok(manifestIds.has(tpl.id), `manifest missing ${tpl.id}`);
    const file = path.join(PREVIEW_ROOT, 'resume-studio', `${tpl.id}.png`);
    assert.ok(fs.existsSync(file), `preview missing ${tpl.id}`);
    const info = pngInfo(file);
    assert.deepEqual({ width: info.width, height: info.height }, { width: 360, height: 509 });
    assert.ok(info.bytes > 5000, `preview too small/suspicious: ${tpl.id}`);
  }
});

test('Template OS premium builtins are cached from the actual vector PDF renderer', () => {
  const rows = new Map(manifest.surfaces['resume-studio'].map((r) => [r.id, r]));
  const premium = RESUME_TEMPLATES.filter((t) => t.engine === 'template-os');
  assert.ok(premium.length >= 7);
  for (const tpl of premium) {
    const row = rows.get(tpl.id);
    assert.equal(row.renderer, 'template-os-vector-pdf', tpl.id);
    assert.equal(row.templateVersion, tpl.definition.version || 1);
    assert.equal(row.fixtureId, previewFixtureIdForTemplate(tpl.definition));
  }
});

test('legacy/V3/V4 Resume Studio previews use the actual renderer block markup + CSS', () => {
  const rows = new Map(manifest.surfaces['resume-studio'].map((r) => [r.id, r]));
  for (const tpl of RESUME_TEMPLATES.filter((t) => t.engine !== 'template-os')) {
    assert.equal(rows.get(tpl.id)?.renderer, 'resume-renderer-blocks-css', tpl.id);
  }
});

test('legacy Resume Editor gallery has cached output from its real HTML renderer', () => {
  assert.equal(manifest.surfaces.editor.length, EDITOR_TEMPLATES.length);
  const rows = new Map(manifest.surfaces.editor.map((r) => [r.id, r]));
  for (const tpl of EDITOR_TEMPLATES) {
    const row = rows.get(tpl.id);
    assert.equal(row?.renderer, 'resume-templates-html', tpl.id);
    const file = path.join(PREVIEW_ROOT, 'editor', `${tpl.id}.png`);
    assert.ok(fs.existsSync(file), `editor preview missing ${tpl.id}`);
    const info = pngInfo(file);
    assert.equal(info.width, 360);
    assert.equal(info.height, 509);
  }
});

test('preview fixtures are deterministic and role-aware without AI/user data', () => {
  assert.equal(previewFixtureIdForTemplate({ id: 'campus-portfolio', category: 'student' }), 'student-project-heavy');
  assert.equal(previewFixtureIdForTemplate({ id: 'executive-technology', category: 'executive' }), 'senior-long');
  assert.equal(previewFixtureIdForTemplate({ id: 'cloud-infrastructure-pro', category: 'technical' }), 'devops-cloud');
  const a = getTemplatePreviewStructured({ id: 'technical-sidebar', category: 'technical' });
  const b = getTemplatePreviewStructured({ id: 'technical-sidebar', category: 'technical' });
  assert.deepEqual(a, b);
  assert.notEqual(a, b); // callers receive clones, never a shared mutable fixture
});

test('Resume Studio uses cached previews first and keeps SVG only as fallback', () => {
  const src = fs.readFileSync(path.join(ROOT, 'web', 'src', 'views', 'ResumeStudio.jsx'), 'utf8');
  assert.match(src, /cachedTemplatePreviewUrl\(t\.id/);
  assert.match(src, /fallback:\s*thumbnailDataUri\(def\)/);
  assert.match(src, /fallbackPreviewOnError/);
  assert.doesNotMatch(src, /deterministic SVG wireframes — 34 cards/);
});

test('legacy Editor template cards use image cache and do not create live iframes unless cache fails', () => {
  const src = fs.readFileSync(path.join(ROOT, 'web', 'src', 'components', 'ResumeTemplates.jsx'), 'utf8');
  assert.match(src, /cachedTemplatePreviewUrl\(tpl\.id, \{ surface: 'editor'/);
  assert.match(src, /cachedPreviewFailed/);
  assert.match(src, /ResumePaper data=\{data\}/); // fallback remains available
});
