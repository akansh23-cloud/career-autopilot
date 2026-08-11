import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTemplateCandidates, templateStructuralDistance, TEMPLATE_SYNTHESIS_VERSION, TEMPLATE_GENERATOR_DIVERSITY_VERSION } from '../web/src/lib/templateOs/synthesis.js';
import { validateTemplateDefinition } from '../web/src/lib/templateOs/dsl.js';
import { PRIMITIVES } from '../web/src/lib/templateOs/primitives.js';

test('Phase 25 generator returns structurally diverse deterministic candidates', () => {
  const goal = { targetRoles: ['Senior DevOps Engineer'], careerStage: 'senior', atsPriority: 'high', density: 'balanced' };
  const a = generateTemplateCandidates(goal, { limit: 6 });
  const b = generateTemplateCandidates(goal, { limit: 6 });
  assert.equal(a.version, TEMPLATE_SYNTHESIS_VERSION);
  assert.equal(a.diversity.version, TEMPLATE_GENERATOR_DIVERSITY_VERSION);
  assert.deepEqual(a.candidates.map((x) => x.def.id), b.candidates.map((x) => x.def.id));
  assert.equal(a.kept, 6);
  assert.equal(a.diversity.uniqueArchetypes, 6);
  assert.ok(a.diversity.uniqueLayouts >= 3);
  assert.ok(a.diversity.minPairDistance >= 0.4);
});

test('Phase 25 generator prefers a new archetype before cosmetic variants', () => {
  const r = generateTemplateCandidates({ targetRoles: ['Security Engineer'], careerStage: 'mid', visualStyle: 'technical' }, { limit: 6 });
  assert.equal(new Set(r.candidates.map((x) => x.archetype)).size, r.candidates.length);
  for (let i = 0; i < r.candidates.length; i += 1) for (let j = i + 1; j < r.candidates.length; j += 1) {
    assert.ok(templateStructuralDistance(r.candidates[i].def, r.candidates[j].def) > 0.35);
  }
});

test('Phase 25 preserves student-first section priorities even in non-student archetypes', () => {
  const r = generateTemplateCandidates({ targetRoles: ['Graduate Software Engineer'], careerStage: 'student' }, { limit: 6 });
  assert.equal(r.kept, 6);
  for (const candidate of r.candidates) {
    assert.equal(candidate.def.sectionOrder[0], 'summary');
    assert.ok(candidate.def.sectionOrder.indexOf('education') < candidate.def.sectionOrder.indexOf('experience'));
  }
});

test('generated candidates remain valid, non-production TemplateDefinitions', () => {
  const r = generateTemplateCandidates({ targetRoles: ['Product Manager'], careerStage: 'senior' }, { limit: 6 });
  for (const candidate of r.candidates) {
    const validation = validateTemplateDefinition(candidate.def, { primitives: PRIMITIVES });
    assert.equal(validation.ok, true, JSON.stringify(validation.errors));
    assert.equal(candidate.def.status, 'GENERATED');
    assert.equal(candidate.def.license.productionEnabled, false);
    assert.ok(candidate.rationale.length > 20);
  }
});
