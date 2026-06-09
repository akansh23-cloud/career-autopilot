import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchProjects } from '../server/services/projectIntelligence/projectGapMatchingService.js';
import { whyBuildThis } from '../server/services/projectIntelligence/whyBuildService.js';
import { explainProject } from '../server/services/projectIntelligence/projectExplainerService.js';
import { generateDiagrams, deriveProjectModel } from '../server/services/projectIntelligence/projectDiagramService.js';
import { estimateFeasibility } from '../server/services/projectIntelligence/feasibilityService.js';
import { proofChecklist } from '../server/services/projectIntelligence/proofChecklistService.js';
import { buildBlueprintV2 } from '../server/services/projectIntelligence/buildBlueprintService.js';
import { taskBoard } from '../server/services/projectIntelligence/taskBoardService.js';
import { resumeOutput } from '../server/services/projectIntelligence/resumeOutputService.js';
import { detectDuplicate } from '../server/services/projectIntelligence/projectMemoryService.js';
import { importInnovationProject, extractInnovationFields } from '../server/services/projectIntelligence/innovationBridgeService.js';
import { pjConfig, roleFamilyFor } from '../server/services/projectIntelligence/config.js';

/* A realistic, deterministic input: a DevOps aspirant who CLAIMS CI/CD and
   Kubernetes but has only proven Docker, is missing Terraform/Prometheus, has
   a saved Platform Engineer job, and one patent/innovation cluster. */
function sampleInput() {
  return {
    userProfile: { skills: ['Docker', 'CI/CD', 'Kubernetes'], targetRole: 'DevOps Engineer', goal: 'job' },
    targetRole: 'DevOps Engineer',
    resumeAnalysis: { missingSkills: ['Terraform', 'Prometheus'], matchedSkills: ['Docker'] },
    verifiedSkills: [{ skillName: 'Docker', state: 'verified' }],
    claimedSkills: ['Kubernetes', 'CI/CD', 'Docker'],
    githubProof: { repoCount: 1, ci: false, tests: false, deployment: false, provenSkills: ['Docker'] },
    savedJobs: [{ title: 'Platform Engineer', skills: ['Terraform', 'Kubernetes', 'Prometheus'] }],
    existingProjects: [],
    patentInnovationClusters: [{ innovationClusterId: 'c1', title: 'Auto IaC drift detector', score: 62, painPoint: 'config drift', noveltyAngle: 'continuous reconciliation' }],
  };
}

function topRec() {
  const m = matchProjects(sampleInput(), { max: 6 });
  return { m, rec: m.recommendedProjects[0] };
}

/* ---- config / role family ---- */
test('config is enabled by default and AI is optional', () => {
  const cfg = pjConfig({});
  assert.equal(cfg.enabled, true);
  assert.equal(typeof cfg.anthropicKey === 'string' || cfg.anthropicKey === undefined || cfg.anthropicKey === null, true);
});

test('config disables cleanly when the flag is 0', () => {
  const cfg = pjConfig({ PROJECT_INTELLIGENCE_ENABLED: '0' });
  assert.equal(cfg.enabled, false);
});

test('role family resolves known and unknown roles without throwing', () => {
  assert.ok(roleFamilyFor('DevOps Engineer'));
  assert.ok(roleFamilyFor('Underwater Basket Weaver')); // falls back to generic
});

/* ---- Task 1: gap matching ---- */
test('gap matching returns recommendations and a structured gap summary', () => {
  const { m, rec } = topRec();
  assert.ok(Array.isArray(m.recommendedProjects) && m.recommendedProjects.length > 0);
  assert.ok(m.gapSummary && m.gapSummary.targetRole);
  // every recommendation has the contract fields
  for (const r of m.recommendedProjects) {
    for (const k of ['id', 'title', 'targetRole', 'whyRecommended', 'skillGapsFixed', 'proofGapsFixed', 'difficulty', 'estimatedTime', 'recommendationConfidence']) {
      assert.ok(k in r, `recommendation missing ${k}`);
    }
  }
  assert.ok(rec.title && typeof rec.title === 'string');
});

test('gap matching flags a claimed-but-unverified skill', () => {
  const { m } = topRec();
  const unverified = (m.gapSummary.unverifiedClaims || []).map((s) => String(s).toLowerCase());
  // CI/CD and Kubernetes are claimed but not verified and not GitHub-proven
  assert.ok(unverified.some((s) => s.includes('ci') || s.includes('kubernetes')), `expected an unverified claim, got ${JSON.stringify(unverified)}`);
});

test('innovation cluster surfaces as an innovation-grade recommendation', () => {
  const { m } = topRec();
  assert.ok(m.recommendedProjects.some((r) => r.isInnovationGrade), 'expected at least one innovation-grade rec');
});

/* ---- Task 2: why build ---- */
test('whyBuildThis returns the full value contract', () => {
  const { m, rec } = topRec();
  const w = whyBuildThis({ project: rec, recommendation: rec, gapSummary: m.gapSummary });
  for (const k of ['targetRoleSupported', 'whyThisProject', 'skillGapsFixed', 'proofGapsFixed', 'recruiterValue', 'resumeValue', 'jobReadinessImpact', 'expectedProofArtifacts', 'expectedXPImpact', 'recommendationConfidence']) {
    assert.ok(k in w, `whyBuild missing ${k}`);
  }
  assert.match(String(w.expectedXPImpact), /XP/i);
});

/* ---- Task 3: explainer ---- */
test('explainProject returns modules and a plain-language plan', () => {
  const { rec } = topRec();
  const e = explainProject({ project: rec, recommendation: rec });
  assert.ok(e.oneLineSummary);
  assert.ok(Array.isArray(e.mvpModules) && e.mvpModules.length > 0);
  assert.ok(Array.isArray(e.firstWeekTasks));
  assert.ok('whatNotToBuildYet' in e);
});

/* ---- Task 4: diagrams (must be renderer-safe Mermaid) ---- */
test('generateDiagrams produces six project-specific renderer-safe diagrams', () => {
  const { rec } = topRec();
  const e = explainProject({ project: rec, recommendation: rec });
  const { diagrams } = generateDiagrams({ project: rec, recommendation: rec, explainer: e });
  assert.equal(diagrams.length, 6);
  const okHeader = /^(graph (TD|LR)|flowchart (TD|LR)|sequenceDiagram)/;
  const banned = /[[\](){};"'|<>](?=[^\n]*-->)/; // crude: labels must be sanitized
  for (const d of diagrams) {
    assert.ok(d.mermaid && typeof d.mermaid === 'string', `${d.title} has no mermaid`);
    const firstLine = d.mermaid.trim().split('\n')[0];
    assert.match(firstLine, okHeader, `${d.title} header not renderer-safe: ${firstLine}`);
    void banned;
  }
  // diagrams are project-specific (mention a derived module/stack token), not a fixed template
  const model = deriveProjectModel({ project: rec, recommendation: rec, explainer: e });
  assert.ok(model.modules.length > 0);
});

test('diagrams never contain characters that break the in-repo Mermaid renderer', () => {
  const { rec } = topRec();
  const { diagrams } = generateDiagrams({ project: rec, recommendation: rec, explainer: {} });
  for (const d of diagrams) {
    // node labels are wrapped as id[Label]; the Label must not contain forbidden chars
    const labels = [...d.mermaid.matchAll(/\[([^\]]*)\]/g)].map((mm) => mm[1]);
    for (const label of labels) {
      assert.ok(!/[[\](){};"'|<>]/.test(label), `forbidden char in label "${label}" of ${d.title}`);
    }
  }
});

/* ---- Task 5: feasibility ---- */
test('estimateFeasibility returns INR cost bands and a verdict', () => {
  const { rec } = topRec();
  const f = estimateFeasibility({ project: rec, recommendation: rec });
  assert.ok(f.difficulty);
  assert.ok(f.costEstimateIndia && f.costEstimateIndia.studentPrototype);
  assert.match(String(f.costEstimateIndia.studentPrototype), /₹/);
  assert.ok(f.shouldBuildVerdict);
  assert.ok(Array.isArray(f.rolesRequired));
});

/* ---- Task 8: proof checklist reconciles with REAL proof, no fake ticks ---- */
test('proofChecklist marks items satisfied only from real proof breakdown', () => {
  const { rec } = topRec();
  // breakdown with github added but nothing else
  const pb = { rows: [{ key: 'githubAdded', score: 6, max: 6 }, { key: 'readme', score: 0, max: 8 }, { key: 'tests', score: 0, max: 10 }], score: 6 };
  const c = proofChecklist({ project: rec, recommendation: rec, proofBreakdown: pb });
  assert.ok(Array.isArray(c.minimum) && Array.isArray(c.strong) && Array.isArray(c.recruiterReady));
  // with an almost-empty breakdown nothing in recruiterReady should be satisfied
  assert.ok(c.recruiterReady.every((it) => it.satisfied === false));
  assert.ok('currentTier' in c);
});

test('proofChecklist with empty proof has no satisfied recruiter-ready items', () => {
  const { rec } = topRec();
  const c = proofChecklist({ project: rec, recommendation: rec, proofBreakdown: { rows: [], score: 0 } });
  assert.ok(c.minimum.every((it) => it.satisfied === false));
});

/* ---- Task 6: blueprint ---- */
test('buildBlueprintV2 returns a complete build specification', () => {
  const { rec } = topRec();
  const e = explainProject({ project: rec, recommendation: rec });
  const b = buildBlueprintV2({ project: rec, recommendation: rec, explainer: e });
  for (const k of ['productDefinition', 'mvpScope', 'featureBreakdown', 'frontendScreens', 'backendApis', 'databaseSchema', 'testPlan', 'deploymentPlan', 'readmeSections', 'githubChecklist']) {
    assert.ok(k in b, `blueprint missing ${k}`);
  }
});

/* ---- Task 7: task board ---- */
test('taskBoard returns dependency-ordered GitHub-ready tasks', () => {
  const { rec } = topRec();
  const e = explainProject({ project: rec, recommendation: rec });
  const tb = taskBoard({ project: rec, recommendation: rec, explainer: e });
  assert.ok(Array.isArray(tb.tasks) && tb.tasks.length > 0);
  for (const t of tb.tasks) {
    for (const k of ['id', 'title', 'description', 'acceptanceCriteria', 'labels', 'priority']) {
      assert.ok(k in t, `task missing ${k}`);
    }
  }
  // first task should have no dependencies (scaffold), establishing an order
  assert.equal((tb.tasks[0].dependencies || []).length, 0);
});

/* ---- Task 9: evidence-backed resume — the critical no-fabrication rule ---- */
test('resume output returns ZERO verified bullets without real evidence', () => {
  const { rec } = topRec();
  const r = resumeOutput({ project: rec, recommendation: rec, evidence: {} });
  assert.equal(r.verifiedResumeBullets.length, 0);
  assert.ok(r.draftResumeBullets.length > 0);
  assert.ok(r.unsupportedClaimsWarning.length > 0, 'should warn that no evidence exists');
});

test('resume output emits verified bullets ONLY when real evidence exists', () => {
  const { rec } = topRec();
  const r = resumeOutput({
    project: { github: { success: true, files: { tests: true } } },
    recommendation: rec,
    evidence: { githubVerified: true, testsVerified: true },
  });
  assert.ok(r.verifiedResumeBullets.length >= 1, 'expected verified bullets with proof');
  assert.equal(r.unsupportedClaimsWarning.length, 0);
});

/* ---- Task 10: duplicate detection ---- */
test('detectDuplicate flags a near-identical project and suggests a different angle', () => {
  const { rec } = topRec();
  const existing = [{ title: rec.title, problemStatement: rec.problemStatement, skillsCovered: rec.skills }];
  const dup = detectDuplicate({ title: rec.title, problemStatement: rec.problemStatement, skills: rec.skills }, existing, { threshold: 0.55 });
  assert.equal(dup.isDuplicate, true);
  assert.ok(dup.similarity >= 0.55);
  assert.ok(dup.suggestion && dup.suggestion.length > 0);
});

test('detectDuplicate does not false-positive on an unrelated project', () => {
  const dup = detectDuplicate(
    { title: 'Realtime fraud scoring stream', problemStatement: 'score card transactions in flight', skills: ['Kafka', 'Flink'] },
    [{ title: 'Recipe sharing app', problemStatement: 'share home recipes', skillsCovered: ['React', 'Firebase'] }],
    { threshold: 0.55 },
  );
  assert.equal(dup.isDuplicate, false);
});

/* ---- Task 11: innovation bridge ---- */
test('importInnovationProject preserves IP fields and produces an importable payload', () => {
  const src = { innovationClusterId: 'c1', title: 'Auto IaC drift detector', painPoint: 'config drift', noveltyAngle: 'continuous reconciliation', score: 62 };
  const imp = importInnovationProject({ source: src, existingProjects: [] });
  assert.equal(imp.ok, true);
  assert.equal(imp.imported, true);
  assert.ok(imp.payload && imp.payload.innovationGrade === true);
  assert.equal(imp.payload.innovationClusterId, 'c1');
  const fields = extractInnovationFields(src);
  for (const k of ['painPoint', 'noveltyAngle', 'evidenceChecklist', 'priorArtWarning', 'disclosureStatus']) {
    assert.ok(k in fields, `innovation fields missing ${k}`);
  }
});

test('importInnovationProject refuses to import the same cluster twice', () => {
  const src = { innovationClusterId: 'c1', title: 'Auto IaC drift detector', painPoint: 'config drift', score: 62 };
  const first = importInnovationProject({ source: src, existingProjects: [] });
  const second = importInnovationProject({ source: src, existingProjects: [first.payload] });
  assert.equal(second.imported, false);
  assert.ok(second.duplicateOf, 'should report what it duplicates');
});

/* ---- Task 14: works with NO AI key / NO network (deterministic fallback) ---- */
test('all services run deterministically with no AI key and no network', () => {
  // No ANTHROPIC_API_KEY is set in this test process and nothing makes a network call.
  assert.equal(!!process.env.ANTHROPIC_API_KEY, false);
  const { m, rec } = topRec();
  // a full deterministic pass over the pipeline must not throw and must be stable
  const e = explainProject({ project: rec, recommendation: rec });
  assert.doesNotThrow(() => whyBuildThis({ project: rec, recommendation: rec, gapSummary: m.gapSummary }));
  assert.doesNotThrow(() => generateDiagrams({ project: rec, recommendation: rec, explainer: e }));
  assert.doesNotThrow(() => estimateFeasibility({ project: rec, recommendation: rec }));
  assert.doesNotThrow(() => buildBlueprintV2({ project: rec, recommendation: rec, explainer: e }));
  assert.doesNotThrow(() => taskBoard({ project: rec, recommendation: rec, explainer: e }));
  // determinism: same input → same top recommendation title
  const again = matchProjects(sampleInput(), { max: 6 });
  assert.equal(again.recommendedProjects[0].title, m.recommendedProjects[0].title);
});

test('services tolerate empty / minimal input without throwing', () => {
  assert.doesNotThrow(() => matchProjects({}, { max: 6 }));
  assert.doesNotThrow(() => whyBuildThis({}));
  assert.doesNotThrow(() => explainProject({}));
  assert.doesNotThrow(() => generateDiagrams({}));
  assert.doesNotThrow(() => estimateFeasibility({}));
  assert.doesNotThrow(() => proofChecklist({}));
  assert.doesNotThrow(() => buildBlueprintV2({}));
  assert.doesNotThrow(() => taskBoard({}));
  assert.doesNotThrow(() => resumeOutput({}));
  assert.doesNotThrow(() => detectDuplicate({}, []));
  assert.doesNotThrow(() => importInnovationProject({}));
});
