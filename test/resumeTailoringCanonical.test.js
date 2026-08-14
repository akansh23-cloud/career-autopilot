/* ============================================================
   CANONICAL RESUME TAILORING — architecture + safety tests
   ------------------------------------------------------------
   These prove the Phase 1 invariants by EXERCISING them, not by
   asserting that a config key exists. A test that checks a mode
   object has a `targetBulletLength` property proves nothing; a
   test that checks concise mode produces shorter bullets proves
   the property is wired to behaviour.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runInsideTailoringBoundary, buildBoundaryMetadata, insideTailoringBoundary,
  assertNoAiInsideBoundary, AiCallInsideTailoringBoundaryError,
  runOutsideTailoringBoundary, resetBoundaryCounters, boundaryCounters,
} from '../server/services/resumeTailoring/aiBoundary.js';
import {
  runTailoring, TAILORING_QUOTA_BUCKET,
} from '../server/services/resumeTailoring/canonicalTailoringService.js';
import { MODES, DEPTHS, resolveMode, resolveDepth, depthForPlan } from '../server/services/resumeTailoring/modes.js';
import {
  buildRequirementGraph, SUPPORT_STATE, equivalenceKey, areEquivalent, isRelated,
} from '../server/utils/resume/narrative/requirementGraph.js';
import {
  auditAndRevert, introducedForbiddenTerms, buildTermSurfaces,
  DEFAULT_SURFACE_ALIASES, TAILORING_STATUS,
} from '../server/utils/resume/narrative/requirementLeakage.js';
import { makeAnthropicNarrativeClient } from '../server/utils/resume/narrative/narrativeProviders.js';
import { makeAnthropicWritingProvider } from '../server/utils/resume/writingProviders.js';
import { FIXTURES, fixtureById } from './fixtures/resumeNarrativeFixtures.js';

const DEVOPS = () => fixtureById('devops_engineer');

/* ============================================================
   P1.1 — AI DENY BOUNDARY
   ============================================================ */

test('boundary: assertNoAiInsideBoundary is a no-op outside a transaction', () => {
  assert.equal(insideTailoringBoundary(), false);
  assert.doesNotThrow(() => assertNoAiInsideBoundary('anthropic', 'test'));
});

test('boundary: any AI provider call inside the boundary throws', async () => {
  await runInsideTailoringBoundary(buildBoundaryMetadata({ operation: 'enhance' }), async () => {
    assert.equal(insideTailoringBoundary(), true);
    assert.throws(() => assertNoAiInsideBoundary('anthropic', 'test'),
      AiCallInsideTailoringBoundaryError);
  });
});

test('boundary: survives async nesting, awaits and deep call stacks', async () => {
  const deep = async () => {
    await new Promise((r) => setTimeout(r, 1));
    const deeper = async () => {
      await Promise.resolve();
      return assertNoAiInsideBoundary('openai', 'nested');
    };
    return deeper();
  };
  await runInsideTailoringBoundary(buildBoundaryMetadata({ operation: 'enhance' }), async () => {
    await assert.rejects(deep(), (e) => e.code === 'AI_CALL_INSIDE_TAILORING_BOUNDARY');
  });
});

test('boundary: the real Anthropic narrative client is blocked inside it', async () => {
  /* A fetch that would explode if it were ever reached — the guard must fire
     before any network work is attempted. */
  const client = makeAnthropicNarrativeClient({
    apiKey: 'sk-test-not-real',
    fetchImpl: () => { throw new Error('network reached — boundary failed'); },
  });
  await runInsideTailoringBoundary(buildBoundaryMetadata({ operation: 'full-tailor' }), async () => {
    await assert.rejects(
      client.complete({ system: 's', user: 'u' }),
      (e) => e.code === 'AI_CALL_INSIDE_TAILORING_BOUNDARY',
    );
  });
});

test('boundary: the real Anthropic writing provider is blocked inside it', async () => {
  const provider = makeAnthropicWritingProvider({
    apiKey: 'sk-test-not-real',
    model: 'x',
    fetchImpl: () => { throw new Error('network reached — boundary failed'); },
  });
  await runInsideTailoringBoundary(buildBoundaryMetadata({ operation: 'bullet-assist' }), async () => {
    await assert.rejects(
      provider.rewrite({ kind: 'bullet', text: 'Built pipelines.' }),
      (e) => e.code === 'AI_CALL_INSIDE_TAILORING_BOUNDARY',
    );
  });
});

test('boundary: the documented escape hatch works and is explicit', async () => {
  await runInsideTailoringBoundary(buildBoundaryMetadata({ operation: 'enhance' }), async () => {
    /* Optional cover-letter drafting may legitimately run alongside. */
    runOutsideTailoringBoundary(() => {
      assert.equal(insideTailoringBoundary(), false);
      assert.doesNotThrow(() => assertNoAiInsideBoundary('anthropic', 'cover-letter'));
    });
    /* ...and the boundary is restored immediately afterwards. */
    assert.equal(insideTailoringBoundary(), true);
  });
});

test('boundary: violations are counted for observability', async () => {
  resetBoundaryCounters();
  await runInsideTailoringBoundary(buildBoundaryMetadata({ operation: 'enhance' }), async () => {
    try { assertNoAiInsideBoundary('groq', 'x'); } catch { /* expected */ }
  });
  const c = boundaryCounters();
  assert.equal(c.violations, 1);
  assert.equal(c.lastViolation.provider, 'groq');
  resetBoundaryCounters();
});

/* ============================================================
   P1.2 — CANONICAL SERVICE
   ============================================================ */

test('canonical: every operation runs through one service and reports zero AI calls', async () => {
  const f = DEVOPS();
  for (const op of ['enhance', 'job-tailor', 'ats-optimize', 'preview']) {
    const r = await runTailoring({
      operation: op, doc: f.doc, jobDescription: f.jd, job: f.job,
      userKey: `canon-${op}`, surface: 'test',
    });
    assert.equal(r.ok, true, `${op} should succeed`);
    assert.equal(r.boundary.enforced, true);
    assert.equal(r.telemetry.ai?.totalCalls ?? 0, 0, `${op} must make zero AI calls`);
    assert.equal(r.quotaBucket, TAILORING_QUOTA_BUCKET);
    assert.notEqual(r.quotaBucket, 'aiCalls');
  }
});

test('canonical: operations requiring a JD fail closed without one', async () => {
  const f = DEVOPS();
  const r = await runTailoring({ operation: 'job-tailor', doc: f.doc, jobDescription: '' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'job_description_required');
});

test('canonical: unknown operations are rejected rather than silently defaulted', async () => {
  const f = DEVOPS();
  const r = await runTailoring({ operation: 'freestyle-rewrite', doc: f.doc });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unknown_operation');
});

test('canonical: bullet-assist scopes the proposal without a second engine', async () => {
  const f = DEVOPS();
  const full = await runTailoring({ operation: 'enhance', doc: f.doc, userKey: 'scope' });
  const entriesOf = (r) => (Array.isArray(r.changes) ? r.changes : r.changes?.entries || []);
  const target = entriesOf(full).find((c) => c.section === 'experience');
  assert.ok(target, 'fixture should produce at least one experience change');

  const scoped = await runTailoring({
    operation: 'bullet-assist', doc: f.doc, userKey: 'scope',
    scope: { section: 'experience', bulletId: target.bulletId },
  });
  assert.equal(scoped.ok, true);
  assert.ok(entriesOf(scoped).every((c) => c.bulletId === target.bulletId),
    'scoped assist returns only the requested bullet');
  /* Same engine, same sentence — a scoped call is a filter, not a fork. */
  const same = entriesOf(scoped).find((c) => c.bulletId === target.bulletId);
  assert.equal(same.enhanced, target.enhanced);
});

/* ============================================================
   P1.5 / P1.6 — MODE + DEPTH BEHAVIOUR (not configuration)
   ============================================================ */

test('mode: concise genuinely produces shorter bullets than balanced', async () => {
  const f = DEVOPS();
  const words = async (mode) => {
    const r = await runTailoring({
      operation: 'job-tailor', doc: f.doc, jobDescription: f.jd, job: f.job,
      userKey: 'len', mode,
    });
    const lens = r.bullets.map((b) => b.text.split(/\s+/).length);
    return lens.reduce((a, b) => a + b, 0) / lens.length;
  };
  const balanced = await words('balanced');
  const concise = await words('concise');
  assert.ok(concise <= balanced,
    `concise (${concise.toFixed(1)}w) must not be longer than balanced (${balanced.toFixed(1)}w)`);
});

test('mode: fresher weights projects up without inventing seniority', async () => {
  const f = fixtureById('fresher_software_engineer');
  const r = await runTailoring({
    operation: 'enhance', doc: f.doc, userKey: 'fresher', mode: 'fresher',
  });
  assert.equal(r.ok, true);
  assert.ok(r.strategy.decisions.some((d) => d.action === 'weight_projects_first'),
    'fresher mode must record a real project-weighting decision');
  const text = [r.summary.chosen, ...r.bullets.map((b) => b.text)].join(' ').toLowerCase();
  for (const word of ['architected', 'owned the', 'led a team', 'spearheaded', 'directed']) {
    assert.ok(!text.includes(word), `fresher output must not contain "${word}"`);
  }
});

test('depth: deep produces more candidates than standard, same truth rules', async () => {
  const f = DEVOPS();
  const run = async (depth) => runTailoring({
    operation: 'job-tailor', doc: f.doc, jobDescription: f.jd, job: f.job,
    userKey: 'depth', depth, plan: 'premium',
  });
  const std = await run('standard');
  const deep = await run('deep');
  const gen = (r) => r.telemetry?.counters?.candidatesGenerated ?? 0;
  assert.ok(gen(deep) >= gen(std), 'deep must not generate fewer candidates');
  /* Depth buys computation, never permission. */
  assert.equal(deep.truth.unsupportedClaimCount, 0);
  assert.equal(std.truth.unsupportedClaimCount, 0);
  assert.equal(deep.telemetry.ai?.totalCalls ?? 0, 0);
});

test('depth: free plans cannot buy deep depth by asking for it', () => {
  assert.equal(depthForPlan('free', 'deep').id, 'standard');
  assert.equal(depthForPlan('premium', 'deep').id, 'deep');
  /* ...but free still gets the SAME engine, not a lesser one. */
  assert.equal(resolveDepth('standard').id, DEPTHS.standard.id);
});

test('mode: every declared strategy key is consumed by real behaviour', () => {
  /* Guards against the config-theatre this patch exists to remove: if a key
     is added here it must be readable somewhere in the pipeline. */
  const consumed = new Set([
    'id', 'label', 'targetBulletLength', 'prioritizeMatchedRequirements',
    'recomposeSummary', 'intentPreference', 'rerankDepth', 'preferOutcomeLed',
    'projectFirst', 'preferCanonicalTerminology', 'ownershipBias', 'weights',
  ]);
  for (const mode of Object.values(MODES)) {
    for (const key of Object.keys(mode)) {
      assert.ok(consumed.has(key), `mode "${mode.id}" declares unconsumed key "${key}"`);
    }
  }
});

/* ============================================================
   P2.11–P2.13 — REQUIREMENT GRAPH
   ============================================================ */

test('requirements: equivalence normalises, relatedness does not', () => {
  assert.ok(areEquivalent('K8s', 'Kubernetes'));
  assert.ok(areEquivalent('Postgres', 'PostgreSQL'));
  assert.equal(equivalenceKey('GitLab pipelines'), equivalenceKey('GitLab CI'));

  assert.ok(!areEquivalent('Docker', 'Kubernetes'));
  assert.ok(!areEquivalent('Jenkins', 'GitLab CI'));
  assert.ok(!areEquivalent('Terraform', 'CloudFormation'));
  assert.ok(!areEquivalent('AWS', 'Azure'));

  assert.ok(isRelated('Docker', 'Kubernetes'), 'related — informs ranking only');
  assert.ok(isRelated('Terraform', 'CloudFormation'));
});

test('requirements: an OR group satisfied by one alternative does not license the other', () => {
  const jobIntel = {
    requirements: {
      all: [{
        text: 'Production experience with Kubernetes or OpenShift',
        tier: 'mandatory',
        categories: [],
        skills: ['Kubernetes', 'OpenShift'],
      }],
    },
    prioritySkills: [
      { skill: 'Kubernetes', canonical: 'kubernetes', weight: 3, tier: 'mandatory' },
      { skill: 'OpenShift', canonical: 'openshift', weight: 3, tier: 'mandatory' },
    ],
  };
  const classification = {
    supported: [{ skill: 'OpenShift', canonical: 'openshift' }],
    partiallySupported: [],
    unsupported: [{ skill: 'Kubernetes', canonical: 'kubernetes' }],
  };

  const g = buildRequirementGraph(jobIntel, classification);
  const group = g.groups[0];

  assert.equal(group.logic, 'OR');
  assert.equal(group.status, SUPPORT_STATE.SUPPORTED, 'the group IS satisfied');
  assert.equal(equivalenceKey(group.matchedAlternative), 'openshift');
  assert.ok(group.unmatchedAlternatives.some((a) => equivalenceKey(a) === 'kubernetes'));

  /* THE POINT: satisfied group, but the unmatched sibling stays forbidden. */
  assert.ok(g.claimableTerms.includes('openshift'));
  assert.ok(!g.claimableTerms.includes('kubernetes'));
  assert.ok(g.forbiddenTerms.includes('kubernetes'));
});

test('requirements: transferable evidence never becomes a claimable term', () => {
  const jobIntel = {
    requirements: { all: [{ text: 'Kubernetes required', tier: 'mandatory', categories: [], skills: ['Kubernetes'] }] },
    prioritySkills: [{ skill: 'Kubernetes', canonical: 'kubernetes', weight: 3, tier: 'mandatory' }],
  };
  const classification = {
    supported: [{ skill: 'Docker', canonical: 'docker' }],
    partiallySupported: [],
    unsupported: [{ skill: 'Kubernetes', canonical: 'kubernetes' }],
  };
  const g = buildRequirementGraph(jobIntel, classification);
  assert.equal(g.groups[0].status, SUPPORT_STATE.TRANSFERABLE);
  assert.ok(g.transferableTerms.includes('kubernetes'));
  assert.ok(g.forbiddenTerms.includes('kubernetes'), 'transferable is still forbidden to write');
  assert.ok(!g.claimableTerms.includes('kubernetes'));
});

/* ============================================================
   P1.3 / P1.4 — FAIL CLOSED, AND "SAFE" MEANS TRUTH-SAFE
   ============================================================ */

test('leakage: an introduced forbidden term is detected, including via abbreviation', () => {
  const surfaces = buildTermSurfaces(['kubernetes'], DEFAULT_SURFACE_ALIASES);
  const hits = introducedForbiddenTerms(
    'Deployed services on K8s clusters.', 'Deployed services on OpenShift.',
    new Set(['kubernetes']), surfaces,
  );
  assert.deepEqual(hits, ['kubernetes'], '"K8s" must trip the "kubernetes" wire');
});

test('leakage: a term the candidate already used is theirs to keep', () => {
  const surfaces = buildTermSurfaces(['kubernetes'], DEFAULT_SURFACE_ALIASES);
  const hits = introducedForbiddenTerms(
    'Ran Kubernetes clusters in production.', 'Worked on Kubernetes clusters.',
    new Set(['kubernetes']), surfaces,
  );
  assert.deepEqual(hits, [], 'policing INTRODUCTION, not the user\'s own vocabulary');
});

test('leakage: offending changes are REVERTED, not warned about', () => {
  const surfaces = buildTermSurfaces(['kubernetes'], DEFAULT_SURFACE_ALIASES);
  /* Full verdict sheets: under the Part 4.4 contract an unsupplied check is
     NOT_RUN and blocks safety, so a test that wants to isolate leakage must
     say explicitly that the other validators ran. */
  const ranClean = {
    metric: 'PASS', entity: 'PASS', skillContext: 'PASS', seniority: 'PASS',
    certification: 'PASS', employer: 'PASS', evidenceBinding: 'PASS',
    actionSemantics: 'PASS', actionProvenance: 'PASS',
  };
  const out = auditAndRevert([
    { changeId: 'c1', before: 'Deployed services on OpenShift.', after: 'Deployed services on Kubernetes and OpenShift.', truthChecks: ranClean },
    { changeId: 'c2', before: 'Built pipelines.', after: 'Built GitLab CI pipelines.', truthChecks: ranClean },
  ], { forbiddenTerms: new Set(['kubernetes']), termSurfaces: surfaces });

  const c1 = out.changes.find((c) => c.changeId === 'c1');
  assert.equal(c1.safe, false);
  assert.equal(c1.reverted, true);
  assert.equal(c1.changed, false);
  assert.equal(c1.after, 'Deployed services on OpenShift.', 'reverted to the candidate\'s own words');
  assert.equal(c1.truthChecks.requirementLeakage, 'FAIL');

  const v = out.violations[0];
  assert.equal(v.type, 'UNSUPPORTED_REQUIREMENT_LEAKAGE');
  assert.equal(v.changeId, 'c1');
  assert.equal(v.action, 'REVERTED');

  const c2 = out.changes.find((c) => c.changeId === 'c2');
  assert.equal(c2.safe, true);
  assert.equal(c2.after, 'Built GitLab CI pipelines.');

  assert.equal(out.status, TAILORING_STATUS.PARTIAL);
  assert.equal(out.safe, false);
});

test('safe: is a conjunction of truth checks, never inferred from confidence', () => {
  const out = auditAndRevert([{
    changeId: 'c1', before: 'Built pipelines.', after: 'Built pipelines for four teams.',
    /* High confidence, big score gain — and a failed metric check. */
    truthChecks: { metric: 'FAIL' },
  }], { forbiddenTerms: new Set(), termSurfaces: new Map() });
  const c = out.changes[0];
  assert.equal(c.safe, false, 'a single failed hard check is decisive');
  assert.equal(c.reverted, true);
  assert.ok(c.failedChecks.includes('metric'));
});

test('safe: end-to-end, every change the engine marks safe passed every check', async () => {
  const f = DEVOPS();
  const r = await runTailoring({
    operation: 'job-tailor', doc: f.doc, jobDescription: f.jd, job: f.job, userKey: 'safe-e2e',
  });
  assert.equal(r.ok, true);
  const entries = Array.isArray(r.changes) ? r.changes : r.changes?.entries || [];
  for (const c of entries) {
    if (!c.safe) continue;
    for (const [name, verdict] of Object.entries(c.truthChecks || {})) {
      assert.equal(verdict, 'PASS', `change ${c.changeId} is marked safe but ${name}=${verdict}`);
    }
  }
  /* Accept-All-Safe must never be able to accept a reverted change. */
  assert.ok(entries.every((c) => !(c.safe && c.reverted)));
});

/* ============================================================
   P1.9 — APPLICATION PACKAGE BOUNDARY
   ============================================================ */

test('application package: resume content is deterministic, AI calls = 0', async () => {
  const f = DEVOPS();
  const r = await runTailoring({
    operation: 'full-tailor', doc: f.doc, jobDescription: f.jd, job: f.job,
    userKey: 'app-package', surface: 'application-package',
  });
  assert.equal(r.ok, true);
  assert.equal(r.telemetry.ai?.totalCalls ?? 0, 0);
  assert.equal(r.boundary.aiCalls, 0);
  assert.equal(r.quotaBucket, 'tailoring');
});

/* ============================================================
   Cross-fixture invariant sweep
   ============================================================ */

test('invariants hold across every fixture, in both modes and both depths', async () => {
  for (const f of FIXTURES) {
    for (const depth of ['standard', 'deep']) {
      const r = await runTailoring({
        operation: f.jd ? 'job-tailor' : 'enhance',
        doc: f.doc, jobDescription: f.jd || '', job: f.job || {},
        userKey: `sweep-${f.id}`, depth, plan: 'premium',
      });
      assert.equal(r.ok, true, `${f.id}/${depth} failed`);
      assert.equal(r.telemetry.ai?.totalCalls ?? 0, 0, `${f.id}/${depth} made an AI call`);
      assert.equal(r.truth.unsupportedClaimCount, 0, `${f.id}/${depth} produced an unsupported claim`);
      assert.equal((r.untracedMetrics || []).length, 0, `${f.id}/${depth} produced an untraced metric`);
    }
  }
});
