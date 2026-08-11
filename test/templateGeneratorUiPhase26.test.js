import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Phase 26 Template Builder exposes deterministic generator controls and diversity evidence', () => {
  const src = fs.readFileSync(new URL('../web/src/views/TemplateBuilder.jsx', import.meta.url), 'utf8');
  for (const marker of ['Deterministic Generator', 'generatorGoal', 'runGenerator', 'Load candidate', 'uniqueArchetypes', 'minPairDistance']) {
    assert.ok(src.includes(marker), `missing ${marker}`);
  }
});

test('Phase 26 generator UI loads candidates into normal lifecycle rather than publishing directly', () => {
  const src = fs.readFileSync(new URL('../web/src/views/TemplateBuilder.jsx', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('const loadGeneratedCandidate'), src.indexOf('const loadGeneratedCandidate') + 1800);
  assert.ok(/status:\s*['"]DRAFT['"]/.test(fn));
  assert.ok(fn.includes('productionEnabled: false'));
  assert.ok(!/publish/i.test(fn));
});

test('Phase 26 server generator returns structural evidence with definitions', () => {
  const src = fs.readFileSync(new URL('../server/routes/templateOsRoutes.js', import.meta.url), 'utf8');
  assert.ok(src.includes('diversityScore'));
  assert.ok(src.includes('archetype'));
  assert.ok(src.includes('rationale'));
  assert.ok(src.includes('signature'));
});
