// Architecture Diagram OS — engine + API tests.
// Exercises the deterministic engine (pattern matching, spec building,
// Mermaid/SVG adapters, validation, refine) and the new /api/architecture/*
// endpoints, plus backward compatibility of the legacy generate route.
// Runs under `node --test` with no browser, DB, network or AI key.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { matchPattern } from '../server/utils/architecture/patternMatcher.js';
import { buildSpec, resolveCapabilities } from '../server/utils/architecture/specBuilder.js';
import { validateSpec, runChecks, scoreSpec } from '../server/utils/architecture/validator.js';
import { viewToMermaid, specToLegacyMermaid, viewToSvg } from '../server/utils/architecture/mermaidAdapter.js';
import { refineSpec, parseInstruction } from '../server/utils/architecture/refineEngine.js';
import { generateArchitectureSpec } from '../server/utils/architecture/index.js';

// The legacy in-app parser must be able to read what the adapter emits.
import { parseGraph, layoutGraph } from '../web/src/lib/architecture.js';

import { startServer, stopServer, makeClient } from './helpers.js';

const RAG_INPUT = {
  title: 'DocBrain',
  description: 'A RAG platform: upload documents, generate embeddings, and answer questions with an LLM.',
  techStack: ['React', 'Node.js', 'MongoDB', 'Pinecone', 'Anthropic'],
};
const MARKETPLACE_INPUT = {
  title: 'SkillSwap',
  description: 'A two-sided marketplace where sellers create listings and buyers checkout with Razorpay payments.',
  techStack: ['React', 'Express', 'PostgreSQL'],
};
const PIPELINE_INPUT = {
  title: 'TxnStream',
  description: 'Real-time streaming ETL: Kafka events processed with Spark into a Snowflake warehouse.',
  techStack: ['Kafka', 'Spark', 'Snowflake', 'Airflow'],
};

/* ============ pattern matching ============ */

test('pattern matcher picks the AI/RAG pattern for RAG projects', () => {
  const m = matchPattern(RAG_INPUT);
  assert.equal(m.patternId, 'ai-rag-platform');
  assert.ok(['high', 'medium'].includes(m.confidence));
  assert.ok(m.reasons.length > 0);
});

test('pattern matcher picks marketplace and event-driven patterns from signals', () => {
  assert.equal(matchPattern(MARKETPLACE_INPUT).patternId, 'marketplace-platform');
  assert.equal(matchPattern(PIPELINE_INPUT).patternId, 'event-driven-pipeline');
});

test('pattern matcher falls back to three-tier SaaS with no signals', () => {
  const m = matchPattern({ title: 'X', description: '' });
  assert.equal(m.patternId, 'three-tier-saas');
  assert.equal(m.confidence, 'low');
});

/* ============ spec generation ============ */

test('spec builder produces structured views with groups, nodes and edges', () => {
  const m = matchPattern(RAG_INPUT);
  const spec = buildSpec(RAG_INPUT, m, { cloudProvider: 'aws', targetLevel: 'production' });
  assert.equal(spec.provider, 'aws');
  assert.equal(spec.targetLevel, 'production');
  assert.ok(Array.isArray(spec.views) && spec.views.length >= 5);
  for (const v of spec.views) {
    assert.ok(v.id && v.type && Array.isArray(v.nodes) && Array.isArray(v.edges) && Array.isArray(v.groups));
    assert.ok(v.nodes.length > 0, `${v.type} has nodes`);
    for (const e of v.edges) {
      assert.ok(v.nodes.some((n) => n.id === e.from), `${v.type} edge from exists`);
      assert.ok(v.nodes.some((n) => n.id === e.to), `${v.type} edge to exists`);
    }
  }
  // AWS deployment view uses provider-mapped names + VPC/subnet grouping.
  const dep = spec.views.find((v) => v.type === 'deployment');
  assert.ok(dep.groups.some((g) => g.type === 'vpc'));
  assert.ok(dep.nodes.some((n) => /S3|ElastiCache|SQS|ECS|Lambda|Secrets Manager/i.test(n.label)));
});

test('spec generation is deterministic for the same input', () => {
  const m1 = matchPattern(RAG_INPUT);
  const m2 = matchPattern(RAG_INPUT);
  const a = buildSpec(RAG_INPUT, m1, { cloudProvider: 'gcp', targetLevel: 'enterprise' });
  const b = buildSpec(RAG_INPUT, m2, { cloudProvider: 'gcp', targetLevel: 'enterprise' });
  const strip = (s) => JSON.stringify({ ...s, generatedAt: null });
  assert.equal(strip(a), strip(b));
});

test('mvp level trims optional capabilities; enterprise adds tracing/waf/iac', () => {
  const m = matchPattern(MARKETPLACE_INPUT);
  const mvp = resolveCapabilities(MARKETPLACE_INPUT, m, { targetLevel: 'mvp' });
  const ent = resolveCapabilities(MARKETPLACE_INPUT, m, { targetLevel: 'enterprise' });
  assert.ok(!mvp.includes('tracing'));
  assert.ok(ent.includes('tracing') && ent.includes('iac') && ent.includes('waf'));
});

test('patent figure view is included and figure-ready (numbered modules, no patentability claim)', () => {
  const pkg = generateArchitectureSpec(RAG_INPUT, { targetLevel: 'production' });
  const fig = pkg.architectureSpec.views.find((v) => v.type === 'patentFigure');
  assert.ok(fig, 'patentFigure view present');
  assert.ok(fig.nodes.some((n) => /^1\d\d /.test(n.label)), 'reference numerals');
  assert.ok(fig.annotations.some((a) => /NOT a claim/i.test(a)));
});

/* ============ Mermaid adapter + legacy renderer compatibility ============ */

test('mermaid adapter emits graph TD the legacy parser can read', () => {
  const pkg = generateArchitectureSpec(MARKETPLACE_INPUT, {});
  for (const [type, mermaid] of Object.entries(pkg.mermaidViews)) {
    assert.ok(mermaid.startsWith('graph TD'), `${type} starts with graph TD`);
    const { nodes, edges } = parseGraph(mermaid);
    assert.ok(nodes.length > 0, `${type} parses nodes`);
    assert.ok(edges.length > 0, `${type} parses edges`);
    const layout = layoutGraph(mermaid); // must not hang or throw
    assert.ok(layout.nodes.length > 0);
  }
});

test('legacy keys (component/dataFlow/deployment/security) are always present', () => {
  const pkg = generateArchitectureSpec({ title: 'Tiny', description: 'simple web app' }, {});
  const legacy = specToLegacyMermaid(pkg.architectureSpec);
  for (const k of ['component', 'dataFlow', 'deployment', 'security']) {
    assert.ok(typeof legacy[k] === 'string' && legacy[k].includes('graph TD'), `legacy ${k}`);
    assert.ok(pkg.mermaidViews[k], `mermaidViews also exposes ${k}`);
  }
});

test('viewToMermaid and viewToSvg never throw on malformed views', () => {
  for (const bad of [{}, { nodes: null }, { nodes: [{}], edges: [{ from: 'x' }] }]) {
    assert.ok(typeof viewToMermaid(bad) === 'string');
    assert.ok(viewToSvg(bad).startsWith('<svg'));
  }
});

test('svg export contains group boundaries and node labels', () => {
  const pkg = generateArchitectureSpec(RAG_INPUT, { cloudProvider: 'aws' });
  const dep = pkg.architectureSpec.views.find((v) => v.type === 'deployment');
  const svg = viewToSvg(dep, { title: 'DocBrain — Deployment' });
  assert.ok(svg.includes('<rect') && svg.includes('VPC') && svg.includes('DocBrain'));
});

/* ============ validation ============ */

test('validation flags missing critical items and scores categories 0-100', () => {
  const bare = { title: 'Bare', description: '', targetLevel: 'production', capabilities: ['frontend', 'backend'], views: [] };
  const v = validateSpec(bare);
  assert.ok(v.checks.some((c) => c.id === 'chk-auth' && c.status === 'fail'));
  assert.ok(v.missingCriticalItems.length >= 3);
  for (const k of ['overallScore', 'security', 'scalability', 'reliability', 'observability', 'maintainability', 'deploymentReadiness', 'dataDesign', 'costAwareness']) {
    assert.ok(v.score[k] >= 0 && v.score[k] <= 100, `${k} in range`);
  }
});

test('a full production spec passes the critical checks and scores well', () => {
  const pkg = generateArchitectureSpec(MARKETPLACE_INPUT, { targetLevel: 'production' });
  const v = pkg.validation;
  const failedCritical = v.checks.filter((c) => c.severity === 'critical' && c.status === 'fail');
  assert.equal(failedCritical.length, 0);
  assert.ok(v.score.overallScore >= 70, `overall ${v.score.overallScore}`);
  assert.ok(pkg.architectureSpec.bestPracticeChecks.length > 0, 'checks attached to spec');
});

test('scoring is pure: same checks + spec give the same score', () => {
  const pkg = generateArchitectureSpec(RAG_INPUT, {});
  const checks = runChecks(pkg.architectureSpec);
  assert.deepEqual(scoreSpec(pkg.architectureSpec, checks), scoreSpec(pkg.architectureSpec, checks));
});

/* ============ refine ============ */

test('parseInstruction recognizes adds and removes', () => {
  const p = parseInstruction('Add Redis cache and an SQS queue. Remove the WAF.');
  assert.ok(p.add.includes('cache') && p.add.includes('queue') && p.add.includes('worker'));
  assert.ok(p.remove.includes('waf'));
  assert.equal(p.recognized, true);
});

test('refineSpec adds requested components, bumps version and reports a diff', () => {
  const base = generateArchitectureSpec({ title: 'Plain', description: 'simple crud app' }, { targetLevel: 'mvp' }).architectureSpec;
  const { architectureSpec: refined, diffSummary } = refineSpec(base, 'Add Redis cache, SQS queue, worker service, monitoring, backup flow, and CI/CD.');
  assert.equal(refined.version, base.version + 1);
  for (const c of ['cache', 'queue', 'worker', 'monitoring', 'backup', 'cicdPipeline']) {
    assert.ok(refined.capabilities.includes(c), `capability ${c}`);
  }
  const container = refined.views.find((v) => v.type === 'container');
  assert.ok(container.nodes.some((n) => n.capability === 'cache'));
  assert.ok(container.nodes.some((n) => n.capability === 'queue'));
  assert.ok(diffSummary.recognized && diffSummary.added.length >= 4);
});

test('refineSpec removes components on remove instructions', () => {
  const base = generateArchitectureSpec(MARKETPLACE_INPUT, { targetLevel: 'production' }).architectureSpec;
  assert.ok(base.capabilities.includes('cache'));
  const { architectureSpec: refined, diffSummary } = refineSpec(base, 'Remove the cache for now.');
  assert.ok(!refined.capabilities.includes('cache'));
  assert.ok(diffSummary.removed.length >= 1);
});

test('refineSpec with an unrecognized instruction is a safe no-op diff', () => {
  const base = generateArchitectureSpec(MARKETPLACE_INPUT, {}).architectureSpec;
  const { architectureSpec: refined, diffSummary } = refineSpec(base, 'make it nicer please');
  assert.equal(diffSummary.recognized, false);
  assert.deepEqual([...refined.capabilities].sort(), [...base.capabilities].sort());
});

/* ============ API endpoints ============ */

let server, base, client;
before(async () => {
  ({ server, base } = await startServer());
  client = makeClient(base);
  await client.devLogin('Arch Tester', 'arch-tester@example.com');
});
after(async () => { await stopServer(server); });

test('POST /api/architecture/spec requires auth', async () => {
  const anon = makeClient(base);
  await anon.bootstrap();
  const r = await anon.post('/api/architecture/spec', { title: 'X' });
  assert.equal(r.status, 401);
});

test('POST /api/architecture/spec returns spec + mermaid views + validation', async () => {
  const r = await client.post('/api/architecture/spec', {
    title: 'Exam Portal',
    description: 'Online exam platform with proctoring, mock tests and grading workers.',
    techStack: ['React', 'Node.js', 'PostgreSQL'],
    cloudProvider: 'aws',
    targetLevel: 'production',
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.equal(r.json.architectureSpec.pattern.id, 'exam-proctoring-platform');
  assert.ok(r.json.architectureSpec.views.length >= 5);
  assert.ok(r.json.mermaidViews.component.includes('graph TD'));
  assert.ok(r.json.validation.score.overallScore >= 0);
  assert.ok(Array.isArray(r.json.warnings) && Array.isArray(r.json.recommendations));
});

test('POST /api/architecture/spec rejects empty input', async () => {
  const r = await client.post('/api/architecture/spec', {});
  assert.equal(r.status, 400);
});

test('POST /api/architecture/validate scores a posted spec', async () => {
  const gen = await client.post('/api/architecture/spec', { title: 'V', description: 'web app', targetLevel: 'mvp' });
  const r = await client.post('/api/architecture/validate', { architectureSpec: gen.json.architectureSpec });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.ok(Array.isArray(r.json.checks) && r.json.checks.length > 0);
  assert.ok(r.json.score.overallScore >= 0 && r.json.score.overallScore <= 100);
  assert.ok(Array.isArray(r.json.missingCriticalItems));
});

test('POST /api/architecture/refine applies an instruction and returns a diff', async () => {
  const gen = await client.post('/api/architecture/spec', { title: 'R', description: 'simple app', targetLevel: 'mvp' });
  const r = await client.post('/api/architecture/refine', {
    architectureSpec: gen.json.architectureSpec,
    instruction: 'Add Redis cache, SQS queue, worker service, monitoring, backup flow, and CI/CD.',
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.ok(r.json.diffSummary.recognized);
  assert.ok(r.json.architectureSpec.capabilities.includes('cache'));
  assert.equal(r.json.architectureSpec.version, gen.json.architectureSpec.version + 1);
});

test('POST /api/architecture/export supports json, mermaid and svg; rejects png honestly', async () => {
  const gen = await client.post('/api/architecture/spec', { title: 'E', description: 'web app' });
  const spec = gen.json.architectureSpec;
  const viewId = spec.views[0].id;
  for (const format of ['json', 'mermaid', 'svg']) {
    const r = await client.post('/api/architecture/export', { architectureSpec: spec, viewId, format });
    assert.equal(r.status, 200, `${format} export ok`);
    assert.ok(r.json.content.length > 20);
  }
  const png = await client.post('/api/architecture/export', { architectureSpec: spec, viewId, format: 'png' });
  assert.equal(png.status, 400);
  assert.equal(png.json.error, 'unsupported_format');
  const missing = await client.post('/api/architecture/export', { architectureSpec: spec, viewId: 'nope', format: 'json' });
  assert.equal(missing.status, 404);
});

test('GET /api/architecture/specs degrades gracefully without a DB', async () => {
  const r = await client.get('/api/architecture/specs?projectId=p1');
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.deepEqual(r.json.specs, []);
});

test('legacy POST /api/architecture/generate still works and now carries the spec', async () => {
  const r = await client.post('/api/architecture/generate', {
    title: 'Legacy Check',
    techStack: ['React', 'Node.js', 'MongoDB'],
    level: 'production',
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  // old contract untouched
  assert.ok(r.json.architecture.diagrams.component.includes('graph TD'));
  assert.ok(r.json.architecture.maturityScore.total >= 0);
  assert.ok(Array.isArray(r.json.architecture.gaps));
  // new additive fields
  assert.ok(r.json.architectureSpec && Array.isArray(r.json.architectureSpec.views));
  assert.ok(r.json.validation?.score?.overallScore >= 0);
  assert.ok(r.json.mermaidViews.component.includes('graph TD'));
});

test('Patent OS: /api/patent/assess additively returns a figure-ready patentFigure', async () => {
  const r = await client.post('/api/patent/assess', {
    title: 'Adaptive Resume Scoring System',
    problemStatement: 'Manual resume screening is slow and inconsistent.',
    technicalSolution: 'A deterministic scoring engine with an AI enrichment layer and feedback loop.',
    skillsCovered: ['Node.js', 'MongoDB', 'ML'],
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  // old contract untouched
  assert.ok(r.json.assessment.patentReadinessScore >= 0);
  assert.ok(r.json.disclosure && r.json.priorArt);
  // new additive figure: modules, decision engine, storage, no patentability claim
  assert.ok(r.json.patentFigure?.view, 'patentFigure view present');
  const fig = r.json.patentFigure.view;
  assert.equal(fig.type, 'patentFigure');
  assert.ok(fig.nodes.some((n) => /Decision Engine/i.test(n.label)));
  assert.ok(fig.annotations.some((a) => /NOT a claim/i.test(a)));
  assert.ok(r.json.patentFigure.mermaid.includes('graph TD'));
});
