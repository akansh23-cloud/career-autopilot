import { test } from 'node:test';
import assert from 'node:assert/strict';

import { piConfig, ALL_SOURCES, COMMUNITY_SOURCES, COMMUNITY_ONLY_IP_CAP } from '../server/services/problemIntelligence/config.js';
import { computeIPReadiness } from '../server/services/problemIntelligence/ipReadinessService.js';
import { validateIndiaCRI, ipCapFromCRI } from '../server/services/problemIntelligence/indiaCriValidatorService.js';
import { simplifyProject, EXPLAINER_AUDIENCES } from '../server/services/problemIntelligence/simplifiedExplainerService.js';
import { priorArtSearchPlan, claimDirections, evidenceChecklist, scoreEvidence, disclosureRiskCheck, diagramPlan, experimentPlan } from '../server/services/problemIntelligence/patentWorkflowService.js';
import { scoreSourceQuality, assessPrivacyRisk, computeSourceMix } from '../server/services/problemIntelligence/sourceQualityService.js';
import { stripIdentifiers, neutralize, filterCommunitySignal } from '../server/services/innovationMemory/privacyFilterService.js';
import { similarityScore, isNearDuplicate, NEAR_DUPLICATE_THRESHOLD } from '../server/services/innovationMemory/similarity.js';
import { normalizeCommunitySignal, classifySignal } from '../server/services/problemIntelligence/connectors/communityCommon.js';
import { fetchReddit } from '../server/services/problemIntelligence/connectors/redditConnector.js';
import { fetchDiscourse } from '../server/services/problemIntelligence/connectors/discourseConnector.js';
import { fetchHashnode } from '../server/services/problemIntelligence/connectors/hashnodeConnector.js';

const techProject = {
  title: 'Edge anomaly detector reducing latency',
  painPoint: 'sensor latency and hardware fault detection is slow and manual',
  proposedSolution: 'real-time signal fusion on an edge device reduces latency and improves accuracy',
  noveltyAngle: 'a novel signal-fusion pipeline running on-device',
  affectedUsers: 'IoT operators', sourcesUsed: 4, evidenceStrength: 60, targetUser: 'IoT operators',
};
const bizProject = {
  title: 'Subscription marketplace', painPoint: 'billing and pricing friction',
  proposedSolution: 'a pricing and checkout flow matching users with loyalty coupons', sourcesUsed: 3, evidenceStrength: 40,
};
const algoProject = {
  title: 'A churn classifier', painPoint: 'predicting churn',
  proposedSolution: 'a neural net model that predicts churn using a mathematical formula', sourcesUsed: 3, evidenceStrength: 40,
};

/* ---------------- config ---------------- */
test('config exposes 11 sources, 6 community sources, community-only IP cap = 55', () => {
  assert.equal(ALL_SOURCES.length, 11);
  assert.equal(COMMUNITY_SOURCES.length, 6);
  assert.equal(COMMUNITY_ONLY_IP_CAP, 55);
  const c = piConfig({});
  assert.equal(c.community.enabled, false);             // OFF by default
  assert.equal(c.community.hackernews.enabled, true);   // HN default ON
  assert.equal(c.community.reddit.enabled, false);      // Reddit default OFF
  assert.equal(c.memory.enabled, true);                 // memory default ON (keyword)
});

/* ---------------- India CRI / Section 3(k) ---------------- */
test('India 3(k): business-method idea is high risk and caps IP at 50', () => {
  const cri = validateIndiaCRI(bizProject);
  assert.equal(cri.section3kRisk, 'high');
  assert.equal(cri.flags.businessMethod, true);
  assert.equal(ipCapFromCRI(cri), 50);
});

test('India 3(k): algorithm-only idea is high risk and caps IP at 45', () => {
  const cri = validateIndiaCRI(algoProject);
  assert.equal(cri.section3kRisk, 'high');
  assert.equal(cri.flags.algorithmOnly, true);
  assert.equal(ipCapFromCRI(cri), 45);
});

test('India 3(k): clear technical effect is low risk (no cap)', () => {
  const cri = validateIndiaCRI(techProject);
  assert.equal(cri.section3kRisk, 'low');
  assert.equal(cri.flags.technicalEffect, true);
  assert.equal(ipCapFromCRI(cri), 100);
  assert.ok(!/patentable/i.test(cri.patentRouteVerdict)); // never says "patentable"
});

/* ---------------- IP readiness caps ---------------- */
test('IP readiness: community-only evidence never exceeds 55', () => {
  const ip = computeIPReadiness({ project: { ...techProject }, priorArtRecords: [{ riskLevel: 'low' }], hasPrototypeEvidence: true, communityOnly: true });
  assert.ok(ip.overall <= 55, `expected <=55 got ${ip.overall}`);
  assert.ok(ip.scoreExplanation.scoreCapsApplied.some((c) => /community/i.test(c)));
});

test('IP readiness: no 90+ without source + prior-art + prototype + technical effect', () => {
  const ip = computeIPReadiness({ project: { ...techProject, sourcesUsed: 0, evidenceStrength: 0 }, priorArtRecords: [], hasPrototypeEvidence: false });
  assert.ok(ip.overall < 90);
  assert.ok(ip.capApplied != null);
});

test('IP readiness: business-method idea is capped low and not routed to patent', () => {
  const ip = computeIPReadiness({ project: bizProject, priorArtRecords: [{ riskLevel: 'low' }], hasPrototypeEvidence: true });
  assert.ok(ip.overall <= 50);
  assert.notEqual(ip.recommendedIPRoute, 'patent');
  assert.equal(ip.section3k.section3kRisk, 'high');
});

test('IP readiness: scoreExplanation has all required fields', () => {
  const ip = computeIPReadiness({ project: techProject, priorArtRecords: [], hasPrototypeEvidence: false });
  for (const k of ['whyThisScore', 'scoreCapsApplied', 'missingEvidence', 'strengths', 'weaknesses', 'nextActions']) {
    assert.ok(k in ip.scoreExplanation, `missing ${k}`);
  }
});

/* ---------------- simplified explainer ---------------- */
test('explainer returns full shape with clarity scores (deterministic, no AI key)', async () => {
  const out = await simplifyProject({ project: techProject, audience: 'beginner', detailLevel: 'simple' }, piConfig({}));
  for (const k of ['oneLineSummary', 'painPoint', 'whatToBuild', 'mvpModules', 'demoMoment', 'clarityScores', 'confidence', 'whatNotToBuildYet']) {
    assert.ok(k in out, `missing ${k}`);
  }
  for (const k of ['painClarity', 'buildClarity', 'demoClarity', 'ipAngleClarity']) {
    assert.equal(typeof out.clarityScores[k], 'number');
  }
  assert.equal(out.confidence, 'low'); // no AI key
});

test('explainer recruiter mode hides IP/novelty detail', async () => {
  const out = await simplifyProject({ project: techProject, audience: 'recruiter' }, piConfig({}));
  assert.equal(out.audience, 'recruiter');
  assert.ok(/confidential|not disclosed/i.test(out.patentAngleSimple));
  assert.equal(EXPLAINER_AUDIENCES.length, 5);
});

/* ---------------- prior-art search plan ---------------- */
test('prior-art search plan returns query buckets + classification + disclaimer', () => {
  const p = priorArtSearchPlan(techProject);
  for (const k of ['searchQueries', 'patentSearchQueries', 'paperSearchQueries', 'productSearchQueries', 'githubSearchQueries', 'classificationHints', 'noveltyQuestions', 'redFlags', 'differentiationChecklist']) {
    assert.ok(Array.isArray(p[k]), `${k} not array`);
  }
  assert.ok(/unknown/i.test(p.disclaimer));
});

/* ---------------- claim directions ---------------- */
test('claim directions are plain-language, include disclaimer, never legal claims', async () => {
  const d = await claimDirections({ project: techProject }, piConfig({}));
  assert.ok(/not a legal patent claim/i.test(d.disclaimer));
  assert.ok(Array.isArray(d.likelyNotClaimable) && d.likelyNotClaimable.length > 0);
  assert.ok('section3kRisk' in d);
});

/* ---------------- evidence checklist + scoring ---------------- */
test('evidence checklist has all buckets', () => {
  const e = evidenceChecklist(techProject);
  for (const k of ['requiredEvidence', 'recommendedEvidence', 'benchmarkEvidence', 'demoEvidence', 'ipEvidence', 'recruiterEvidence', 'missingCriticalEvidence']) {
    assert.ok(Array.isArray(e[k]), `${k} not array`);
  }
});

test('scoreEvidence rewards verified repo + benchmark and flags prototype', () => {
  const none = scoreEvidence([]);
  assert.equal(none.hasPrototypeEvidence, false);
  const some = scoreEvidence([{ type: 'github', verified: true }, { type: 'benchmark' }, { type: 'video' }]);
  assert.equal(some.hasPrototypeEvidence, true);
  assert.ok(some.prototypeEvidenceScore > none.prototypeEvidenceScore);
});

/* ---------------- disclosure risk ---------------- */
test('disclosure risk: already-disclosed tech project is high risk', () => {
  const r = disclosureRiskCheck({ project: { ...techProject, publicDisclosureStatus: 'already_disclosed' }, action: 'make_public' });
  assert.equal(r.riskLevel, 'high');
  assert.ok(r.doNotShare.length > 0);
  assert.ok(typeof r.safeToShareSummary === 'string');
});

/* ---------------- diagram plan ---------------- */
test('diagram plan returns 5 figures + mermaid (no image generation)', () => {
  const d = diagramPlan(techProject);
  assert.equal(d.figures.length, 5);
  assert.ok(d.mermaidDiagrams.length >= 3);
  assert.ok(d.diagramChecklist.length > 0);
});

/* ---------------- experiment plan ---------------- */
test('experiment plan returns baseline/proposed/metrics/result table', () => {
  const x = experimentPlan({ ...techProject, currentWorkaround: 'manual debugging' });
  assert.ok(x.baseline && x.proposedMethod);
  assert.ok(Array.isArray(x.metrics) && x.metrics.length > 0);
  assert.ok(Array.isArray(x.resultTableTemplate) && x.resultTableTemplate.length > 0);
});

/* ---------------- source quality + privacy ---------------- */
test('source quality scores community lower than technical sources', () => {
  const gh = scoreSourceQuality({ source: 'github', title: 'x', contentSummary: 'y'.repeat(250), extractedPainPoints: ['a', 'b'] });
  const rd = scoreSourceQuality({ source: 'reddit', title: 'x', contentSummary: 'y' });
  assert.ok(gh > rd);
});

test('privacy: sensitive community content flagged high; reddit medium', () => {
  assert.equal(assessPrivacyRisk({ source: 'github', title: 'depression tracker' }), 'high');
  assert.equal(assessPrivacyRisk({ source: 'reddit', title: 'tooling pain' }), 'medium');
});

test('privacy filter strips usernames/emails/handles and neutralizes first person', () => {
  const stripped = stripIdentifiers('contact bob@x.com or @alice u/charlie /u/dave 555-123-4567');
  assert.ok(!/@alice/.test(stripped));
  assert.ok(!/charlie/.test(stripped));
  assert.ok(!/bob@x\.com/.test(stripped));
  const n = neutralize('I cannot correlate my logs');
  assert.ok(/users/.test(n) && !/\bI\b/.test(n));
});

test('filterCommunitySignal drops raw text by default and keeps no username', () => {
  const f = filterCommunitySignal({ source: 'reddit', title: 'I hate that I cannot do X, says u/bob', contentSummary: 'my workflow is broken', sourceCommunity: 'r/devops', rawText: 'secret raw comment' });
  assert.equal(f.rawText, undefined);                 // dropped
  assert.equal(f.sourceCommunity, 'r/devops');        // community name OK, not a username
  assert.ok(!/u\/bob/.test(f.title));
});

/* ---------------- source mix / corroboration ---------------- */
test('source mix: community-only is flagged needs-validation; mixed is corroborated', () => {
  const co = computeSourceMix([{ source: 'reddit' }, { source: 'hackernews' }]);
  assert.equal(co.communityOnly, true);
  assert.ok(/validation/i.test(co.validationLabel));
  const mixed = computeSourceMix([{ source: 'reddit' }, { source: 'github' }]);
  assert.equal(mixed.communityOnly, false);
  assert.equal(mixed.corroborated, true);
});

/* ---------------- duplicate detection ---------------- */
test('near-duplicate detection triggers on a highly similar idea', () => {
  const project = { title: 'Deployment failure root-cause analyzer', painPoint: 'correlate ci logs kubernetes pod crash root cause', proposedSolution: 'fuse deployment signals and rank the likely root cause automatically' };
  const candidate = { title: 'Deployment failure root-cause analyzer', keywords: ['deployment', 'failure', 'root', 'cause', 'analyzer', 'correlate', 'logs', 'kubernetes', 'pod', 'crash', 'fuse', 'signals', 'rank', 'likely', 'automatically'] };
  const r = isNearDuplicate(project, [candidate]);
  assert.equal(r.duplicate, true);
  assert.ok(r.score >= NEAR_DUPLICATE_THRESHOLD);
  // a clearly different idea is not a duplicate
  const r2 = isNearDuplicate(project, [{ title: 'Recipe sharing app for students', keywords: ['recipe', 'food', 'cooking', 'social'] }]);
  assert.equal(r2.duplicate, false);
});

test('similarityScore is symmetric-ish and bounded 0..100', () => {
  const s = similarityScore(['a', 'b', 'c'], ['a', 'b', 'd'], 'Title One', 'Title One');
  assert.ok(s >= 0 && s <= 100);
});

/* ---------------- community connectors (no network) ---------------- */
test('Reddit connector is disabled without env/credentials (no network)', async () => {
  const r = await fetchReddit({ goal: 'x' }, { cfg: { reddit: { enabled: false } } });
  assert.equal(r.ok, false);
  assert.equal(r.source, 'reddit');
  assert.ok(/disabled|credential/i.test(r.warning));
  assert.equal(r.signals.length, 0);
});

test('Discourse connector enforces allowlist (no network when empty)', async () => {
  const r = await fetchDiscourse({ goal: 'x' }, { cfg: { discourse: { enabled: true, allowedBaseUrls: [] } } });
  assert.equal(r.ok, false);
  assert.ok(/allowlist/i.test(r.warning));
});

test('Hashnode connector disabled returns safely (no network)', async () => {
  const r = await fetchHashnode({ technology: 'x' }, { cfg: { hashnode: { enabled: false } } });
  assert.equal(r.ok, false);
  assert.equal(r.signals.length, 0);
});

test('community signal normalization produces standard shape + classifies', () => {
  const s = normalizeCommunitySignal({ source: 'hackernews', sourceId: '1', sourceCommunity: 'Hacker News', title: 'Why is there no good tool for X? It is so painful', body: 'developers waste hours' });
  for (const k of ['source', 'title', 'contentSummary', 'extractedPainPoints', 'sentiment', 'signalType', 'rawTextHash', 'engagement']) {
    assert.ok(k in s, `missing ${k}`);
  }
  assert.equal(classifySignal('please add a way to export'), 'feature_request');
  assert.equal(classifySignal('this is broken and impossible to use'), 'complaint');
});
