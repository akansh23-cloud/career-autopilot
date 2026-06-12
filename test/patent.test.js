import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePatentIdea } from '../server/utils/patentScoringEngine.js';
import { generateIdeasDeterministic } from '../server/utils/ideaGenerationEngine.js';
import { strengthenIdea } from '../server/utils/ideaStrengtheningEngine.js';
import { priorArtPlan } from '../server/utils/priorArtEngine.js';
import { generateDisclosure, convertToProject } from '../server/utils/disclosureEngine.js';
import { getUserPatentMemory, buildGenerationContext, suggestNextActions } from '../server/utils/patentMemoryEngine.js';
import { startServer, stopServer, makeClient } from './helpers.js';

/* ---- Scoring: generic penalized, technical mechanism rewarded ---- */
test('patent scoring penalizes a generic "AI app" idea', () => {
  const r = scorePatentIdea({ title: 'AI app for resume analysis', problem: 'resumes are hard to score', proposedSolution: 'an AI app that scores resumes' });
  assert.ok(r.overall < 35, `expected weak score, got ${r.overall}`);
  assert.equal(r.grade, 'Not recommended');
  assert.ok(r.missingPieces.length > 0);
});

test('patent scoring rewards a concrete technical mechanism', () => {
  const r = scorePatentIdea({
    title: 'Proof-weighted skill-credibility graph',
    problem: 'recruiters cannot trust self-claimed skills',
    proposedSolution: 'updates candidate skill credibility from multiple proof sources',
    technicalMechanism: 'a graph algorithm fusing repository behavior, deployment verification, peer validation and recruiter outcome feedback into adaptive per-skill credibility weights with anomaly detection',
    processingLogic: 'ingest, normalize, reliability-weight, propagate through skill graph, recompute',
    inputData: 'commits, deploy logs, endorsements', outputResult: 'real-time credibility score with confidence',
    feedbackLoop: 'recruiter outcomes recalibrate source weights',
    noveltyAngle: 'multi-source proof fusion with outcome-driven adaptive weighting',
    marketUseCase: 'reduces mis-hires by 30%', implementationPlan: 'graph DB + pipeline',
  });
  assert.ok(r.overall >= 70, `expected strong score, got ${r.overall}`);
  assert.ok(['Promising', 'Strong candidate'].includes(r.grade));
});

test('patent scoring is deterministic', () => {
  const idea = { title: 'x', technicalMechanism: 'algorithm pipeline feedback loop fusion' };
  assert.deepEqual(scorePatentIdea(idea), scorePatentIdea(idea));
});

/* ---- Generation: never generic, always has a mechanism ---- */
test('deterministic generation always includes a technical mechanism', () => {
  const ideas = generateIdeasDeterministic({ domain: 'Healthcare', targetUser: 'clinics', problem: 'missed early signals', technology: 'AI/ML', goal: 'increase safety' }, 5);
  assert.equal(ideas.length, 5);
  for (const i of ideas) assert.ok(i.technicalMechanism.length > 40, 'idea must carry a technical mechanism');
});

/* ---- Strengthening: weak idea improves ---- */
test('strengthening a weak idea increases its score', () => {
  const weak = { title: 'AI app for tax saving', domain: 'Fintech', problem: 'people miss deductions', proposedSolution: 'an AI app for tax saving' };
  const r = strengthenIdea(weak);
  assert.ok(r.scoreAfter > r.scoreBefore, `expected improvement, ${r.scoreBefore} -> ${r.scoreAfter}`);
  assert.ok(r.changes.length > 0);
  assert.ok(r.idea.technicalMechanism.length > 40);
});

/* ---- Prior-art plan ---- */
test('prior-art plan produces queries and classification hints without claiming completeness', () => {
  const plan = priorArtPlan({ title: 'Anomaly detection pipeline', technicalMechanism: 'streaming ml detection', domain: 'Cybersecurity', tags: ['ml'] });
  assert.ok(plan.queries.googlePatents.length > 0);
  assert.ok(plan.classificationHints.length > 0);
  assert.ok(/not a completed search|suggested/i.test(plan.note));
  assert.ok(plan.disclaimer.includes('not legal advice'));
});

/* ---- Disclosure + project converter ---- */
test('disclosure generation produces a structured draft with a disclaimer', () => {
  const d = generateDisclosure({ title: 'Test invention', domain: 'AI', problem: 'p', proposedSolution: 's' });
  assert.ok(d.systemComponents.length > 0);
  assert.ok(d.claimDirections.length > 0);
  assert.ok(d.disclaimer.includes('not legal advice'));
});

test('convert-to-project yields a buildable plan', () => {
  const p = convertToProject({ title: 'Test engine', domain: 'AI', technicalMechanism: 'ml pipeline', tags: ['ml'] });
  assert.ok(p.backendApis.length > 0);
  assert.ok(p.resumeBullets.length > 0);
  assert.ok(Array.isArray(p.evidenceChecklist));
});

/* ---- Memory / self-learning context ---- */
test('memory favors strong domains and avoids rejected ones', () => {
  const ideas = [{ _id: '1', title: 'Good graph engine', domain: 'Healthcare', score: { overall: 80 } }, { _id: '2', title: 'Generic app', domain: 'Retail' }];
  const feedback = [{ ideaId: '2', feedbackType: 'too generic' }];
  const mem = getUserPatentMemory({ ideas, feedback });
  assert.ok(mem.strongDomains.includes('Healthcare'));
  assert.ok(mem.commonWeaknesses.includes('too generic'));
  const ctx = buildGenerationContext(mem, 'Healthcare');
  assert.ok(ctx.context.length > 0);
  assert.ok(ctx.why.length > 0);
});

test('suggestNextActions reacts to portfolio state', () => {
  const actions = suggestNextActions({ ideas: [{ score: { overall: 40 } }, { score: { overall: 80 } }] });
  assert.ok(actions.some((a) => a.action === 'strengthen'));
});

/* ---- API: auth + user isolation ---- */
test('Patent OS idea generation requires auth', async () => {
  const { server, base } = await startServer();
  try {
    const anon = makeClient(base); await anon.bootstrap();
    const r = await anon.post('/api/patents/ideas/generate', { domain: 'AI' });
    assert.equal(r.status, 401);
  } finally { await stopServer(server); }
});

test('a user cannot fetch a non-existent / other idea', async () => {
  const { server, base } = await startServer();
  try {
    const c = makeClient(base); await c.devLogin('Pat', 'pat@example.com');
    const r = await c.get('/api/patents/ideas/507f1f77bcf86cd799439011');
    assert.equal(r.status, 404);
  } finally { await stopServer(server); }
});

test('Patent OS dashboard + pipeline respond for an authed user', async () => {
  const { server, base } = await startServer();
  try {
    const c = makeClient(base); await c.devLogin('Pat', 'pat@example.com');
    const dash = await c.get('/api/patents/dashboard');
    assert.equal(dash.status, 200);
    assert.ok(dash.json.disclaimer.includes('not legal advice'));
    const pipe = await c.get('/api/patents/pipeline');
    assert.equal(pipe.status, 200);
    assert.equal(pipe.json.statuses.length, 11);
  } finally { await stopServer(server); }
});

test('invalid feedback type is rejected', async () => {
  const { server, base } = await startServer();
  try {
    const c = makeClient(base); await c.devLogin('Pat', 'pat@example.com');
    const r = await c.post('/api/patents/ideas/507f1f77bcf86cd799439011/feedback', { feedbackType: 'banana' });
    assert.equal(r.status, 400);
  } finally { await stopServer(server); }
});

/* ============================================================
   Synthesis Intelligence Integration Sprint — Patent OS tests
   ============================================================ */

test('standalone generation uses the synthesis layer: ideas carry mechanism + evidence context, conservative IP', async () => {
  const { server, base } = await startServer();
  try {
    const c = makeClient(base); await c.devLogin('Synth', 'synth@example.com');
    const r = await c.post('/api/patents/ideas/generate', {
      domain: 'Healthcare', targetUser: 'clinics', problem: 'missed early deterioration signals', technology: 'AI/ML', goal: 'increase safety', useAI: false, count: 3,
    });
    assert.equal(r.status, 200);
    assert.ok(r.json.ideas.length >= 1);
    for (const idea of r.json.ideas) {
      assert.ok(String(idea.technicalMechanism || '').length > 40, 'every idea must carry a technical mechanism');
      assert.ok(idea.synthesis, 'idea must carry the synthesis context block');
      assert.ok(idea.synthesis.evidenceConfidence, 'evidence confidence must be attached');
      assert.equal(idea.synthesis.evidenceConfidence.level, 'low', 'no live evidence → conservative low confidence');
      assert.ok(idea.synthesis.buildableProjectFraming, 'buildable project framing present');
      assert.ok(!/\bis guaranteed\b|\bdefinitely patentable\b|\bwill be granted\b/i.test(JSON.stringify(idea.synthesis)), 'no patentability guarantees');
      assert.ok(idea.score && Number.isFinite(idea.score.overall), 'Patent OS still owns the score');
    }
    assert.ok(/not legal advice/i.test(r.json.disclaimer));
  } finally { await stopServer(server); }
});

test('package-aware scoring: mechanism raises depth, missing mechanism scores lower, generic workflow capped', async () => {
  const { buildProjectPackage } = await import('../server/services/synthesisIntelligence/projectPackageService.js');
  const idea = { title: 'Vitals anomaly platform', domain: 'Healthcare', problem: 'clinicians miss early deterioration signals', proposedSolution: 'a monitoring platform' };
  const pkg = await buildProjectPackage({ query: 'healthcare patient monitoring platform with vitals alerts', includeMemory: false });
  const withPkg = scorePatentIdea(idea, { projectPackage: pkg });
  const withoutPkg = scorePatentIdea(idea);
  assert.ok(withPkg.factors.technicalDepth > withoutPkg.factors.technicalDepth, 'package mechanism must raise technical depth');
  assert.deepEqual(scorePatentIdea(idea), scorePatentIdea(idea, {}), 'no package → legacy path byte-identical');

  const genericPkg = await buildProjectPackage({ query: 'marketplace platform for students to collaborate and sell templates', includeMemory: false });
  const generic = scorePatentIdea({ ...idea, title: 'Student marketplace', proposedSolution: 'a marketplace platform' }, { projectPackage: genericPkg });
  assert.ok(generic.overall <= 50, 'generic workflow/marketplace must never be strong IP-ready');
  assert.equal(generic.riskLevel, 'High');
});

test('package-aware prior-art plan reflects domain and mechanism', async () => {
  const { buildProjectPackage } = await import('../server/services/synthesisIntelligence/projectPackageService.js');
  const pkg = await buildProjectPackage({ query: 'agriculture crop disease detection from leaf images for farmers', includeMemory: false });
  const plan = priorArtPlan({ title: 'Crop helper', tags: [] }, { projectPackage: pkg });
  assert.ok(/crop|leaf|disease|image|agricult/.test(plan.keywords.join(' ')), 'plan keywords must reflect the package domain');
  assert.ok(/technical mechanism/i.test(plan.differentiationAngles[0]), 'plan must lead with the actual mechanism');
});
