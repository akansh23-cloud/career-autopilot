/* ============================================================
   Career Intelligence Engine tests.
   NODE_ENV=test → ciConfig().networkAllowed === false, so every
   live source is skipped: no network, fully deterministic.
   ============================================================ */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { ciConfig, sourceRunnable, NEW_SOURCES, REUSED_SOURCES } from '../server/services/collectiveIntelligence/config.js';
import { detectIntent } from '../server/services/collectiveIntelligence/intentRouter.js';
import { routeSources } from '../server/services/collectiveIntelligence/sourceRouter.js';
import { makeEvidence, fromCommunitySignal, dedupeEvidence, SOURCE_TYPES } from '../server/services/collectiveIntelligence/normalizer.js';
import { scoreIdea } from '../server/services/collectiveIntelligence/intelligenceScoringService.js';
import { withCache, cacheKey, _clearMemoryCache } from '../server/services/collectiveIntelligence/sourceCache.js';
import { runCareerIntelligence } from '../server/services/collectiveIntelligence/careerIntelligenceEngine.js';
import { fetchWikipedia } from '../server/services/problemIntelligence/connectors/wikipediaConnector.js';
import { fetchYouTube } from '../server/services/problemIntelligence/connectors/youtubeConnector.js';
import { fetchGoogleMaps } from '../server/services/problemIntelligence/connectors/googleMapsConnector.js';
import { fetchONET } from '../server/services/problemIntelligence/connectors/onetConnector.js';
import { startServer, stopServer, makeClient } from './helpers.js';

/* ================= intent router ================= */
test('intent: healthcare AI project with patent + resume needs', () => {
  const u = detectIntent('Create a healthcare AI project that can help my resume and may have patent potential');
  assert.equal(u.primaryIntent, 'healthcare_project');
  assert.equal(u.needs.patent, true);
  assert.equal(u.needs.resume, true);
  assert.equal(u.needs.project, true);
  assert.ok(['high', 'medium', 'low'].includes(u.confidence));
});

test('intent: cybersecurity CVE project routes to security', () => {
  const u = detectIntent('Create a cybersecurity project with real CVE data');
  assert.equal(u.primaryIntent, 'security_project');
});

test('intent: SaaS idea for shop owners → startup + target user extraction', () => {
  const u = detectIntent('Find a SaaS idea for mid-range shop owners');
  assert.equal(u.primaryIntent, 'startup_idea');
  assert.ok(u.targetUser.toLowerCase().includes('shop'), `targetUser was: ${u.targetUser}`);
});

test('intent: mode override forces the requested intent family', () => {
  const u = detectIntent('something with data', { mode: 'patent' });
  assert.equal(u.primaryIntent, 'patent_research');
});

test('intent: career roadmap query', () => {
  const u = detectIntent('What skills do I need to become a data engineer? Build me a learning roadmap');
  assert.ok(['career_roadmap', 'learning_plan'].includes(u.primaryIntent));
});

/* ================= source router ================= */
test('router: patent intent prefers research sources', () => {
  const cfg = ciConfig();
  const u = detectIntent('Find patentable AI/ML ideas for online exams', { mode: 'patent' });
  const r = routeSources(u, { cfg });
  // In test mode nothing is runnable; the plan itself must still rank research sources.
  assert.ok(Array.isArray(r.selected));
  assert.ok(Array.isArray(r.skipped));
  const considered = [...r.selected, ...r.skipped.map((s) => s.source)];
  for (const want of ['crossref', 'openalex', 'arxiv']) {
    assert.ok(considered.includes(want), `${want} should be considered for patent intent`);
  }
});

test('router: security intent considers NVD', () => {
  const cfg = ciConfig();
  const u = detectIntent('Create a cybersecurity project with real CVE data');
  const r = routeSources(u, { cfg });
  const considered = [...r.selected, ...r.skipped.map((s) => s.source)];
  assert.ok(considered.includes('nvd'));
});

test('router: manual source selection is respected', () => {
  const cfg = ciConfig();
  const u = detectIntent('any project');
  const r = routeSources(u, { cfg, selectedSources: ['wikipedia', 'nasa'] });
  const considered = [...r.selected, ...r.skipped.map((s) => s.source)];
  assert.ok(considered.includes('wikipedia') && considered.includes('nasa'));
  assert.ok(!considered.includes('youtube'), 'unselected sources must not be considered');
});

test('router: respects maxSources cap', () => {
  const cfg = { ...ciConfig(), networkAllowed: true }; // pretend network on for cap check
  const u = detectIntent('Build me a DevOps project using real public data');
  const r = routeSources(u, { cfg, maxSources: 3 });
  assert.ok(r.selected.length <= 3, `selected ${r.selected.length} > cap 3`);
});

/* ================= config / key degradation ================= */
test('config: youtube + googlemaps + onet + census are OFF by default', () => {
  const cfg = ciConfig({});
  assert.equal(cfg.sources.youtube.enabled, false);
  assert.equal(cfg.sources.googlemaps.enabled, false);
  assert.equal(cfg.sources.onet.enabled, false);
  assert.equal(cfg.sources.census.enabled, false);
});

test('config: key-required sources are not runnable without keys even when enabled', () => {
  const cfg = ciConfig({ YOUTUBE_DISCOVERY_ENABLED: '1', NODE_ENV: 'production' });
  cfg.networkAllowed = true;
  assert.equal(sourceRunnable('youtube', cfg), false, 'enabled but keyless youtube must not run');
  const cfg2 = ciConfig({ YOUTUBE_DISCOVERY_ENABLED: '1', YOUTUBE_API_KEY: 'k', NODE_ENV: 'production' });
  cfg2.networkAllowed = true;
  assert.equal(sourceRunnable('youtube', cfg2), true);
});

test('config: network is disabled in test mode so no connector can fire', () => {
  const cfg = ciConfig();
  assert.equal(cfg.networkAllowed, false);
  for (const s of [...NEW_SOURCES, ...REUSED_SOURCES.filter((x) => x !== 'manual')]) {
    assert.equal(sourceRunnable(s, cfg), false, `${s} must be skipped in tests`);
  }
});

/* ================= connectors: missing-key degradation ================= */
test('connectors: youtube/googlemaps/onet return disabled (no throw, no network) without keys', async () => {
  const cfg = ciConfig();
  for (const fn of [fetchYouTube, fetchGoogleMaps, fetchONET]) {
    const r = await fn({ query: 'test', cfg });
    assert.equal(r.ok, false);
    assert.equal(r.disabled, true);
    assert.ok(Array.isArray(r.items) && r.items.length === 0);
  }
});

test('connectors: wikipedia skips cleanly when network is off', async () => {
  const r = await fetchWikipedia({ query: 'machine learning', cfg: ciConfig() });
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.items));
});

/* ================= normalizer ================= */
test('normalizer: makeEvidence produces the common shape and strips secrets from metadata', () => {
  const e = makeEvidence({
    source: 'wikipedia', sourceType: 'encyclopedia_context',
    title: 'Test article', summary: 'A summary', url: 'https://example.com',
    queryKeywords: ['test'], metadata: { apiKey: 'SECRET', token: 'SECRET', pages: 3 },
  });
  for (const f of ['id', 'source', 'sourceType', 'title', 'summary', 'url', 'relevanceScore', 'freshnessScore', 'trustScore', 'tags', 'evidenceType', 'metadata']) {
    assert.ok(f in e, `missing field ${f}`);
  }
  assert.ok(SOURCE_TYPES.includes(e.sourceType));
  const meta = JSON.stringify(e.metadata).toLowerCase();
  assert.ok(!meta.includes('secret'), 'secrets must never survive normalization');
  assert.equal(e.metadata.pages, 3);
});

test('normalizer: converts existing community signals (arxiv → research_paper)', () => {
  const e = fromCommunitySignal({ source: 'arxiv', title: 'Deep learning for X', contentSummary: 'paper abstract', sourceUrl: 'https://arxiv.org/abs/1', tags: ['ml'] }, ['deep', 'learning']);
  assert.equal(e.sourceType, 'research_paper');
  const g = fromCommunitySignal({ source: 'github', title: 'bug: crash', contentSummary: 'issue', sourceUrl: '' }, []);
  assert.equal(g.sourceType, 'code_signal');
  const r = fromCommunitySignal({ source: 'reddit', title: 'pain', contentSummary: 'ugh', sourceUrl: '' }, []);
  assert.equal(r.sourceType, 'community_pain_point');
});

test('normalizer: dedupe removes same-url/title evidence', () => {
  const a = makeEvidence({ source: 'wikipedia', sourceType: 'encyclopedia_context', title: 'Same', url: 'https://x.com/1' });
  const b = makeEvidence({ source: 'crossref', sourceType: 'research_paper', title: 'Same', url: 'https://x.com/1' });
  const c = makeEvidence({ source: 'nasa', sourceType: 'public_dataset', title: 'Other', url: 'https://x.com/2' });
  assert.equal(dedupeEvidence([a, b, c]).length, 2);
});

/* ================= scoring ================= */
test('scoring: returns all nine scores in 0..100 with reasons', () => {
  const evidence = [
    makeEvidence({ source: 'reddit', sourceType: 'community_pain_point', title: 'Everyone struggles with X', queryKeywords: ['x'] }),
    makeEvidence({ source: 'datagov', sourceType: 'public_dataset', title: 'X dataset', queryKeywords: ['x'] }),
    makeEvidence({ source: 'crossref', sourceType: 'research_paper', title: 'X research', queryKeywords: ['x'] }),
  ];
  const u = detectIntent('build an x project with patent potential');
  const { scores, reasons, overall } = scoreIdea({ idea: { title: 'X helper', problemStatement: 'solves x', skills: ['react'], dataSources: ['datagov'] }, evidence, understanding: u });
  const keys = ['marketNeedScore', 'noveltyScore', 'resumeValueScore', 'buildFeasibilityScore', 'datasetAvailabilityScore', 'recruiterImpactScore', 'patentPotentialScore', 'sourceConfidenceScore', 'difficultyScore'];
  for (const k of keys) {
    assert.ok(k in scores, `missing ${k}`);
    assert.ok(scores[k] >= 0 && scores[k] <= 100, `${k} out of range: ${scores[k]}`);
    assert.ok(typeof reasons[k] === 'string' && reasons[k].length > 0, `${k} needs a reason`);
  }
  assert.ok(overall >= 0 && overall <= 100);
});

test('scoring: dataset evidence raises datasetAvailabilityScore', () => {
  const u = detectIntent('a data project');
  const withDs = scoreIdea({ idea: { title: 'A', problemStatement: 'p' }, evidence: [makeEvidence({ source: 'datagov', sourceType: 'public_dataset', title: 'ds' })], understanding: u });
  const without = scoreIdea({ idea: { title: 'A', problemStatement: 'p' }, evidence: [], understanding: u });
  assert.ok(withDs.scores.datasetAvailabilityScore > without.scores.datasetAvailabilityScore);
});

/* ================= cache ================= */
test('cache: coalesces duplicate calls and serves cached results', async () => {
  _clearMemoryCache();
  let calls = 0;
  const fn = async () => { calls++; return { ok: true, source: 't', items: [1] }; };
  const cfg = ciConfig();
  const [a, b] = await Promise.all([
    withCache('t', 'same query', {}, fn, cfg),
    withCache('t', 'same query', {}, fn, cfg),
  ]);
  assert.equal(calls, 1, 'in-flight duplicate must coalesce');
  assert.deepEqual(a.items, b.items);
  const c = await withCache('t', 'same query', {}, fn, cfg);
  assert.equal(calls, 1, 'second round must come from cache');
  assert.equal(c.cached, true);
});

test('cache: failures are not cached', async () => {
  _clearMemoryCache();
  let calls = 0;
  const fail = async () => { calls++; return { ok: false, source: 't2', items: [], error: 'boom' }; };
  const cfg = ciConfig();
  await withCache('t2', 'q', {}, fail, cfg);
  await withCache('t2', 'q', {}, fail, cfg);
  assert.equal(calls, 2, 'failed results must be retried, not cached');
});

test('cache: key is stable and normalized', () => {
  assert.equal(cacheKey('s', '  Hello WORLD ', { a: 1 }), cacheKey('s', 'hello world', { a: 1 }));
  assert.notEqual(cacheKey('s', 'hello', { a: 1 }), cacheKey('s', 'hello', { a: 2 }));
});

/* ================= engine (offline / partial-failure behavior) ================= */
test('engine: returns full structured output with zero live sources (graceful degradation)', async () => {
  const out = await runCareerIntelligence({ query: 'Create a healthcare AI project that can help my resume and may have patent potential', mode: 'auto' });
  assert.equal(out.ok, true);
  for (const f of ['queryUnderstanding', 'sourcesChecked', 'evidence', 'painPoints', 'research', 'datasets', 'marketSignals', 'skillSignals', 'opportunityClusters', 'recommendedIdeas', 'bestIdea', 'projectBlueprint', 'patentAngle', 'resumeValue', 'skillXpMapping', 'limitations', 'actions']) {
    assert.ok(f in out, `engine output missing ${f}`);
  }
  assert.ok(out.recommendedIdeas.length >= 1, 'must still recommend an idea from the query alone');
  assert.ok(out.bestIdea && out.bestIdea.scores, 'best idea must be scored');
  assert.ok(out.limitations.some((l) => /offline|test mode/i.test(l)), 'must disclose offline mode');
  // Patent output must carry the not-legal-advice label.
  assert.ok(JSON.stringify(out.patentAngle).toLowerCase().includes('not legal advice'));
  // Resume/XP must stay draft/suggested only.
  assert.ok(JSON.stringify(out.resumeValue).toLowerCase().includes('verif'));
  assert.ok(JSON.stringify(out.skillXpMapping).toLowerCase().includes('suggest'));
});

test('engine: never exposes api keys or credentials in output', async () => {
  process.env.YOUTUBE_API_KEY = 'LEAKED-KEY-12345';
  process.env.ONET_PASSWORD = 'LEAKED-PASS-9999';
  try {
    const out = await runCareerIntelligence({ query: 'find a youtube learning project', mode: 'auto' });
    const s = JSON.stringify(out);
    assert.ok(!s.includes('LEAKED-KEY-12345'));
    assert.ok(!s.includes('LEAKED-PASS-9999'));
  } finally {
    delete process.env.YOUTUBE_API_KEY;
    delete process.env.ONET_PASSWORD;
  }
});

/* ================= routes ================= */
let srv, base, c;
before(async () => {
  ({ server: srv, base } = await startServer());
  c = makeClient(base);
  await c.devLogin('Intel Tester', 'intel-tester@example.com');
});
after(async () => { await stopServer(srv); });

test('route: GET /api/intelligence/sources reports status without leaking keys', async () => {
  process.env.YOUTUBE_API_KEY = 'LEAKED-KEY-ROUTE';
  try {
    const r = await c.get('/api/intelligence/sources');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.ok(Array.isArray(r.json.sources) && r.json.sources.length >= NEW_SOURCES.length);
    const yt = r.json.sources.find((s) => s.name === 'youtube');
    assert.ok(yt && typeof yt.keyConfigured === 'boolean' && typeof yt.quotaRisk === 'string');
    assert.ok(!r.text.includes('LEAKED-KEY-ROUTE'), 'keys must never reach the client');
  } finally { delete process.env.YOUTUBE_API_KEY; }
});

test('route: POST /api/intelligence/search returns structured output offline (all sources skipped)', async () => {
  const r = await c.post('/api/intelligence/search', { query: 'Build me a DevOps project using real public data', mode: 'auto' });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.queryUnderstanding.primaryIntent);
  assert.ok(Array.isArray(r.json.sourcesChecked));
  assert.ok(r.json.bestIdea, 'still useful with zero live sources');
  assert.ok(Array.isArray(r.json.limitations) && r.json.limitations.length > 0);
});

test('route: search validates input', async () => {
  const r = await c.post('/api/intelligence/search', { query: 'a' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'invalid_request');
});

test('route: search requires auth', async () => {
  const anon = makeClient(base);
  await anon.bootstrap();
  const r = await anon.post('/api/intelligence/search', { query: 'some valid query here' });
  assert.ok([401, 403].includes(r.status), `expected auth rejection, got ${r.status}`);
});

test('route: create-project returns project payload + workspace plan (client-store persistence)', async () => {
  const search = await c.post('/api/intelligence/search', { query: 'Create a cybersecurity project with real CVE data' });
  const body = {
    idea: search.json.bestIdea,
    blueprint: search.json.projectBlueprint,
    understanding: search.json.queryUnderstanding,
  };
  const r = await c.post('/api/intelligence/create-project', body);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.projectPayload?.title);
  assert.equal(r.json.persistVia, 'client-project-store');
  assert.ok(r.json.workspacePlan, 'guided workspace plan must be generated');
});

test('route: send-to-patent returns labeled payload and degrades without DB', async () => {
  const search = await c.post('/api/intelligence/search', { query: 'Find patentable AI/ML ideas for online exams', mode: 'patent' });
  const r = await c.post('/api/intelligence/send-to-patent', {
    idea: search.json.bestIdea,
    patentAngle: search.json.patentAngle,
    blueprint: search.json.projectBlueprint,
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.patentIdea?.title);
  assert.ok(/not legal advice/i.test(r.json.disclaimer));
});

test('route: resume-output produces draft assets with verification note', async () => {
  const r = await c.post('/api/intelligence/resume-output', {
    idea: { title: 'CVE Risk Radar', skills: ['Node.js', 'React'] },
    blueprint: { techStack: ['Node.js', 'React'] },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.resumeOutput);
  assert.ok(/verif/i.test(r.json.xpNote));
});

test('route: save-memory succeeds (best-effort, DB off)', async () => {
  const r = await c.post('/api/intelligence/save-memory', {
    query: 'cybersecurity CVE project for my-email@example.com',
    idea: { title: 'CVE Risk Radar', problemStatement: 'teams miss critical CVEs' },
    evidence: [],
    marketSignals: [],
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok('saved' in r.json);
});

test('route: existing innovation OS config endpoint still works (no regression)', async () => {
  const r = await c.get('/api/problem-intelligence/config');
  assert.equal(r.status, 200);
});
