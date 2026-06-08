import { test } from 'node:test';
import assert from 'node:assert/strict';

import { piConfig, resolveActiveProvider } from '../server/services/problemIntelligence/config.js';
import { fetchManual } from '../server/services/problemIntelligence/connectors/manualProblemConnector.js';
import { dedupeSignals } from '../server/services/problemIntelligence/dedupeService.js';
import { clusterSignals } from '../server/services/problemIntelligence/clusteringService.js';
import { scoreClusters, scoreCluster } from '../server/services/problemIntelligence/opportunityScoringService.js';
import { computeIPReadiness } from '../server/services/problemIntelligence/ipReadinessService.js';
import { getAIProvider } from '../server/services/problemIntelligence/ai/aiProvider.js';
import { parseLooseJSON, jaccard, extractKeywords } from '../server/services/problemIntelligence/util.js';

const now = new Date();
const sig = (id, title, summary, extra = {}) => ({
  source: extra.source || 'github', sourceId: String(id), sourceUrl: 'https://example.com/' + id,
  title, contentSummary: summary, rawTextHash: extra.hash || ('h' + id), tags: extra.tags || [],
  engagement: extra.engagement || { comments: 4, reactions: 6 }, sourceCreatedAt: now, lastActivityAt: now,
  extractedPainPoints: [],
});

/* ---- connectors: manual normalization (no network) ---- */
test('manual connector normalizes problems and never requires network', () => {
  const r = fetchManual({ manualProblems: [{ title: 'CI logs are impossible to correlate with pod crashes', description: 'devops teams waste hours', tags: ['devops'] }, 'plain string problem'] });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'manual');
  assert.equal(r.signals.length, 2);
  for (const s of r.signals) {
    assert.ok(s.rawTextHash, 'has a content hash');
    assert.ok(s.title.length > 0);
    assert.equal(s.sourceUrl, '', 'no URL is auto-attached/fetched');
    assert.ok(Array.isArray(s.tags));
  }
});

test('manual connector drops empty entries safely', () => {
  const r = fetchManual({ manualProblems: [{ title: '' }, null, ''] });
  assert.equal(r.signals.length, 0);
});

/* ---- dedupe ---- */
test('dedupe removes signals sharing a content hash', () => {
  const signals = [sig(1, 'A', 'aaa', { hash: 'same' }), sig(2, 'A copy', 'aaa', { hash: 'same' }), sig(3, 'B', 'bbb', { hash: 'diff' })];
  const { signals: out, skipped } = dedupeSignals(signals);
  assert.equal(out.length, 2);
  assert.equal(skipped, 1);
});

/* ---- clustering ---- */
test('clustering groups related signals and separates unrelated ones', () => {
  const signals = [
    sig(1, 'Deployment fails with cryptic kubernetes pod errors', 'deploy failure kubernetes events pod status correlate logs root cause'),
    sig(2, 'Hard to correlate CI logs with kubernetes pod crash', 'correlate kubernetes events pod status root cause deployment failure logs'),
    sig(3, 'Best css framework for styling buttons', 'styling buttons css tailwind components frontend design'),
  ];
  const { clusters } = clusterSignals(signals, { domain: 'DevOps', targetUser: 'DevOps Teams' });
  assert.ok(clusters.length >= 2, 'unrelated css signal should not merge with devops ones');
  const biggest = clusters.slice().sort((a, b) => b.signalCount - a.signalCount)[0];
  assert.ok(biggest.signalCount >= 2, 'the two devops signals should cluster together');
  assert.ok(biggest.title && biggest.title.length > 4);
});

/* ---- opportunity scoring caps ---- */
test('opportunity scoring never returns an inflated patent score', () => {
  const { clusters } = clusterSignals([
    sig(1, 'Need root cause analysis for failed deployments', 'root cause deployment failure pipeline logs correlate explain'),
    sig(2, 'Correlate ci logs and kubernetes events', 'correlate ci logs kubernetes events pod crash root cause'),
  ], { domain: 'DevOps' });
  const scored = scoreClusters(clusters);
  for (const c of scored) {
    assert.ok(c.patentPotentialScore <= 70, `patentPotential ${c.patentPotentialScore} must be capped <= 70`);
    for (const k of ['evidenceStrengthScore', 'severityScore', 'buildFeasibilityScore']) {
      assert.ok(c[k] >= 0 && c[k] <= 100, `${k} in range`);
    }
  }
});

test('scoreCluster is deterministic for the same input', () => {
  const c = { title: 'x', summary: 'deployment failure correlate logs', domain: 'DevOps', signalCount: 2, signals: [sig(1, 'a', 'b'), sig(2, 'c', 'd')], keywords: ['deployment', 'logs'] };
  const a = scoreCluster({ ...c });
  const b = scoreCluster({ ...c });
  assert.deepEqual(a, b);
});

/* ---- AI provider: fallback when no keys ---- */
test('resolveActiveProvider falls back to deterministic when no key is present', () => {
  const cfg = piConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '' });
  assert.equal(resolveActiveProvider(cfg), 'fallback');
});

test('fallback AI provider produces low-confidence deterministic output and never crashes on empty cluster', async () => {
  const cfg = piConfig({ ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '' });
  const ai = getAIProvider(cfg);
  const proj = await ai.synthesizeProject({ cluster: {}, skills: [], purpose: 'portfolio' });
  assert.ok(proj && proj.title, 'returns a project with a title even on empty input');
  assert.equal(proj._ai.confidence, 'low');
  assert.equal(proj._ai.provider, 'fallback');
});

test('piConfig does not throw with a completely empty environment', () => {
  assert.doesNotThrow(() => piConfig({}));
  const cfg = piConfig({});
  assert.equal(typeof cfg.enabled, 'boolean');
});

/* ---- IP readiness hard caps (the safety-critical part) ---- */
const sourcedProject = {
  title: 'Edge-side anomaly detector for deployment pipelines',
  painPoint: 'Teams cannot correlate CI logs with kubernetes pod crashes, wasting hours per failed deploy across many services.',
  proposedSolution: 'A system that fuses CI logs, kubernetes events and pod status in real time, computing a latency-bounded root-cause signal on the edge with a fault-correlation pipeline.',
  noveltyAngle: 'A real-time signal-fusion pipeline reducing correlation latency via an incremental hardware-aware index.',
  affectedUsers: 'DevOps teams running many microservices',
  sourcesUsed: 4, evidenceStrength: 60,
  buildBlueprint: { systemArchitecture: 'edge collector + correlation engine + store', coreAlgorithm: 'incremental fusion', backendApis: ['/ingest', '/correlate'], databaseSchema: ['events'], testPlan: ['unit'], mvpScope: ['ingest', 'correlate'] },
};

test('fresh idea with no prior-art and no prototype is hard-capped low', () => {
  const r = computeIPReadiness({ project: sourcedProject, priorArtRecords: [], hasPrototypeEvidence: false });
  assert.ok(r.overall <= 65, `no prior-art cap (65) must apply, got ${r.overall}`);
  assert.ok(r.appliedCaps.some((c) => c.cap === 65), 'no-prior-art cap recorded');
  assert.ok(r.appliedCaps.some((c) => c.cap === 75), 'no-prototype cap recorded');
  assert.equal(r.priorArtStatus, 'External prior-art risk unknown.');
  assert.notEqual(r.label, 'High priority for IP review');
});

test('idea with no source evidence is capped at 55', () => {
  const r = computeIPReadiness({ project: { ...sourcedProject, sourcesUsed: 0, evidenceStrength: 0 }, priorArtRecords: [], hasPrototypeEvidence: false });
  assert.ok(r.overall <= 55, `no-source cap (55) must apply, got ${r.overall}`);
  assert.ok(r.appliedCaps.some((c) => c.cap === 55));
});

test('business-method-only idea is capped at 50 and flagged for Section 3(k)', () => {
  const biz = { title: 'Subscription billing marketplace', painPoint: 'pricing and billing for a marketplace subscription', proposedSolution: 'a marketplace with subscription pricing, billing and discount coupons', noveltyAngle: 'better pricing model', sourcesUsed: 3, evidenceStrength: 40 };
  const r = computeIPReadiness({ project: biz, priorArtRecords: [{ title: 'x', blockingRisk: 'Low' }], hasPrototypeEvidence: true });
  assert.ok(r.overall <= 50, `business-method cap (50) must apply, got ${r.overall}`);
  assert.ok(r.section3kWarning && r.section3kWarning.length > 0);
  assert.ok(r.flags.businessMethodOnly);
});

test('algorithm-only idea with no technical effect is capped at 45', () => {
  const algo = { title: 'A neural net classifier', painPoint: 'classification is hard', proposedSolution: 'a machine learning model that predicts categories using a neural net classifier and a mathematical formula', noveltyAngle: 'a new model architecture', sourcesUsed: 3, evidenceStrength: 40 };
  const r = computeIPReadiness({ project: algo, priorArtRecords: [{ title: 'x', blockingRisk: 'Low' }], hasPrototypeEvidence: true });
  assert.ok(r.overall <= 45, `algorithm-only cap (45) must apply, got ${r.overall}`);
  assert.ok(r.flags.algorithmOnly);
});

test('adding prior-art and prototype lifts caps but score stays bounded and honest', () => {
  const fresh = computeIPReadiness({ project: sourcedProject, priorArtRecords: [], hasPrototypeEvidence: false });
  const strengthened = computeIPReadiness({
    project: sourcedProject,
    priorArtRecords: [{ title: 'Related patent', blockingRisk: 'Low', differentiator: 'no real-time edge fusion' }],
    hasPrototypeEvidence: true,
  });
  assert.ok(strengthened.overall >= fresh.overall, 'evidence should not lower the score');
  assert.ok(strengthened.overall <= 100);
  assert.ok(Array.isArray(strengthened.requiredEvidenceToImprove));
});

test('computeIPReadiness always returns the 12 factors and a safe label', () => {
  const r = computeIPReadiness({ project: sourcedProject, priorArtRecords: [], hasPrototypeEvidence: false });
  const keys = Object.keys(r.factors);
  assert.equal(keys.length, 12, `expected 12 factors, got ${keys.length}`);
  const allowed = ['High priority for IP review', 'Worth structured review', 'Needs technical strengthening', 'Low patent-readiness', 'Not suitable for patent route'];
  assert.ok(allowed.includes(r.label), `label "${r.label}" must be one of the safe labels`);
});

/* ---- robustness: invalid AI/source responses ---- */
test('parseLooseJSON returns null on garbage instead of throwing', () => {
  assert.equal(parseLooseJSON('not json at all'), null);
  assert.equal(parseLooseJSON(''), null);
  assert.deepEqual(parseLooseJSON('```json\n{"a":1}\n```'), { a: 1 });
});

test('jaccard and extractKeywords behave on empty input', () => {
  assert.equal(jaccard([], []), 0);
  assert.ok(Array.isArray(extractKeywords('', 5)));
});
