import test from 'node:test';
import assert from 'node:assert/strict';
import { discover, synthesizeProject, assessIPReadiness } from '../server/services/problemIntelligence/index.js';

test('problem intelligence fallback discovers manual cluster without API keys', async () => {
  const res = await discover({ domain: 'DevOps', technology: 'Cloud', targetUser: 'Students', problem: 'Teams waste time debugging Kubernetes deployment failures', sources: ['manual'], limit: 3 });
  assert.equal(res.ok, true);
  assert.ok(res.clusters.length >= 1);
  assert.equal(res.mode, 'fallback-draft');
});

test('source-backed project synthesis includes build, cost and IP guardrails', async () => {
  const cluster = {
    id: 'c1', title: 'Kubernetes deployment failure diagnosis', domain: 'DevOps', technology: 'Cloud', targetUser: 'Students', summary: 'DevOps teams manually inspect deployment failures.',
    keywords: ['kubernetes', 'deployment', 'failure'], sourceBacked: true, confidence: 'medium', signals: [{ source: 'github', sourceId: '1', title: 'Deployment fails', sourceUrl: 'https://github.com/x/y/issues/1', contentSummary: 'users need better root cause explanation', extractedPainPoints: [{ currentWorkaround: 'manual kubectl inspection' }] }], sourceCitations: [{ source: 'github', title: 'Deployment fails', url: 'https://github.com/x/y/issues/1' }], evidenceStrengthScore: 72, severityScore: 65, patentPotentialScore: 60, recommendedRoute: 'patent-review'
  };
  const p = synthesizeProject(cluster, { domain: 'DevOps', technology: 'Cloud', targetUser: 'Students' });
  assert.match(p.title, /Deployment Failure|Kubernetes|DevOps/i);
  assert.ok(p.mvpScope.length >= 4);
  assert.ok(p.costEstimate.indiaMvpCostBand);
  assert.ok(p.ipReadiness.overall <= 75, 'prototype/prior-art caps should prevent fake high scores');
});

test('IP readiness caps score when prior-art and prototype evidence are missing', () => {
  const score = assessIPReadiness({ title: 'AI dashboard app', proposedSolution: 'software dashboard only', noveltyAngle: 'generic dashboard', technicalChallenge: 'algorithm only' }, { sourceBacked: false, patentPotentialScore: 80 }, {});
  assert.ok(score.overall <= 55);
  assert.ok(score.capsApplied.length >= 2);
});
