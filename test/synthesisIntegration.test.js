/* ============================================================
   Synthesis Intelligence — integration bridge test suite
   ------------------------------------------------------------
   Dependency-free (no server boot, no DB, no AI key). Covers:
   - ensureProjectPackage / normalizeProjectPackage (legacy enrichment,
     gap-filling with warnings, never crashes)
   - toProjectOsWorkspacePayload / toPatentOsPayload adapters
   - workspace plan enrichment + normalizeCustomProject compatibility
   - patent scoring / strengthening / prior-art with a project package
     (mechanism raises depth, weak evidence lowers confidence, IP-weak
     domains capped, no-package path byte-identical = backward compat)
   - conservative IP language (no patentability guarantees)
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureProjectPackage, normalizeProjectPackage, mergeLegacyIdeaWithProjectPackage,
  toProjectOsWorkspacePayload, enrichWorkspacePlanWithSynthesis, toPatentOsPayload,
  extractTechnicalMechanism, extractEvidenceConfidence,
} from '../server/services/synthesisIntelligence/integrationBridge.js';
import { buildProjectPackage } from '../server/services/synthesisIntelligence/projectPackageService.js';
import { scorePatentIdea } from '../server/utils/patentScoringEngine.js';
import { strengthenIdea } from '../server/utils/ideaStrengtheningEngine.js';
import { priorArtPlan } from '../server/utils/priorArtEngine.js';
import { normalizeCustomProject } from '../server/utils/workspace/customProjectBuilder.js';
import { buildWorkspacePlan } from '../server/utils/workspace/workspaceBuilder.js';
import { assertNoGenericOutput } from './synthesisHelpers.js';

const GUARANTEE = /\bis guaranteed\b|\bdefinitely patentable\b|\bwill be granted\b|\bguarantees? a patent\b|\bassured (of )?approval\b/i;

async function fullPkg(q = 'healthcare patient monitoring platform with vitals alerts') {
  return buildProjectPackage({ query: q, includeMemory: false });
}

/* ---- ensureProjectPackage / normalizeProjectPackage ---- */

test('ensureProjectPackage: a provided package is normalized and returned as-is (source: provided)', async () => {
  const pkg = await fullPkg();
  const { pkg: out, source } = await ensureProjectPackage({ projectPackage: pkg });
  assert.equal(source, 'provided');
  assertNoGenericOutput(out, 'provided package');
  assert.equal(out.classification.domain, 'healthcare');
});

test('ensureProjectPackage: a legacy idea/blueprint is enriched into a full package (source: enriched)', async () => {
  const { pkg, source } = await ensureProjectPackage({
    idea: { title: 'CVE Risk Radar', problemStatement: 'security teams drown in unranked vulnerability feeds', skills: ['Node.js'] },
    blueprint: { techStack: ['Node.js', 'React'] },
    understanding: { domain: 'cybersecurity', targetUser: 'security analysts' },
  });
  assert.equal(source, 'enriched');
  assertNoGenericOutput(pkg, 'legacy enrichment');
  assert.equal(pkg.classification.domain, 'cybersecurity');
  assert.ok(extractTechnicalMechanism(pkg).length > 40);
});

test('normalizeProjectPackage: partial legacy package gets every gap filled with explicit warnings', async () => {
  const full = await fullPkg();
  const partial = { title: full.title, projectBlueprint: full.projectBlueprint }; // no brief/evidence/quality/osPayload
  const out = normalizeProjectPackage(partial);
  assertNoGenericOutput(out, 'normalized partial');
  const w = out.quality.warnings.join(' ');
  assert.match(w, /build brief/i);
  assert.match(w, /evidence summary/i);
  assert.match(w, /Project OS payload/i);
});

test('normalizeProjectPackage: non-package input returns null; ensureProjectPackage never throws', async () => {
  assert.equal(normalizeProjectPackage({ title: 'just a title' }), null);
  assert.equal(normalizeProjectPackage(null), null);
  const { pkg, source } = await ensureProjectPackage({});
  // Even an empty request degrades to a generic (but complete) package, not a crash.
  assert.ok(pkg === null || (pkg.projectOsPayload && source === 'enriched'));
});

/* ---- extraction utilities ---- */

test('extractTechnicalMechanism prefers package brief, falls back to legacy noveltyAngle, else empty', async () => {
  const pkg = await fullPkg();
  assert.ok(extractTechnicalMechanism({ projectPackage: pkg }).length > 40);
  assert.ok(extractTechnicalMechanism({ noveltyAngle: 'a streaming anomaly detection pipeline over device vitals with escalation rules' }).length > 40);
  assert.equal(extractTechnicalMechanism({ noveltyAngle: 'short' }), '');
});

test('extractEvidenceConfidence reads package meta and legacy provenance', async () => {
  const community = [
    { source: 'reddit', sourceType: 'community_pain_point', title: 'nurse alarm fatigue', relevanceScore: 50, trustScore: 30 },
  ];
  const pkg = await buildProjectPackage({ query: 'healthcare patient monitoring platform', evidence: community, evidenceStrength: 30, includeMemory: false });
  const c = extractEvidenceConfidence(pkg);
  assert.equal(c.communityOnly, true);
  assert.equal(c.level, 'low');
  // Legacy provenance shape (Innovation OS project record).
  const legacy = extractEvidenceConfidence({ sourceMix: { communityOnly: false }, evidenceStrength: 60, sourcesUsed: 5 });
  assert.equal(legacy.level, 'high');
  assert.equal(extractEvidenceConfidence({}).level, 'low');
});

/* ---- Project OS adapters ---- */

test('toProjectOsWorkspacePayload returns a valid workspace input; legacy overrides win; intelligence block complete', async () => {
  const pkg = await fullPkg('logistics route optimization for delivery fleet supply chain');
  const input = toProjectOsWorkspacePayload(pkg, { title: 'My Legacy Title', techStack: 'Vue, FastAPI' });
  assert.equal(input.title, 'My Legacy Title');
  assert.equal(input.techStack, 'Vue, FastAPI');
  assert.ok(input.problemStatement.length > 40);
  assert.ok(input.mvpFeatures.length > 10);
  const intel = input.intelligence;
  for (const k of ['technicalMechanism', 'buildBrief', 'milestones', 'requiredRoles', 'requiredSkills', 'prototypeEvidenceChecklist', 'testingDeploymentProofChecklist', 'ipReadinessPossibility', 'quality', 'evidenceConfidence', 'warnings']) {
    assert.ok(k in intel, `intelligence block missing ${k}`);
  }
  // Feeds the EXISTING Project OS pipeline unchanged.
  const project = normalizeCustomProject(input);
  assert.equal(project.title, 'My Legacy Title');
  assert.ok(project.techStack.includes('Vue'));
  const plan = enrichWorkspacePlanWithSynthesis(buildWorkspacePlan({ project, userId: 'u1' }), pkg);
  assert.ok(plan.tasks.length > 0 && plan.roadmap, 'workspace generation must still work');
  for (const k of ['buildBrief', 'architectureLayers', 'modules', 'milestones', 'testingPlan', 'deploymentPlan', 'proofChecklist', 'ipReadinessNote', 'evidenceSummary', 'quality']) {
    assert.ok(k in plan.synthesis, `plan.synthesis missing ${k}`);
  }
});

test('enrichWorkspacePlanWithSynthesis is a no-op without a package and never mutates engine sections', async () => {
  const project = normalizeCustomProject({ title: 'Plain project', problemStatement: 'p', techStack: 'React, Node.js' });
  const plain = buildWorkspacePlan({ project, userId: 'u1' });
  const before = JSON.stringify({ tasks: plain.tasks.length, roadmap: plain.roadmap });
  assert.equal(enrichWorkspacePlanWithSynthesis(plain, null), plain);
  const pkg = await fullPkg();
  enrichWorkspacePlanWithSynthesis(plain, pkg);
  assert.equal(JSON.stringify({ tasks: plain.tasks.length, roadmap: plain.roadmap }), before, 'engine sections must be untouched');
});

/* ---- Patent OS adapter ---- */

test('toPatentOsPayload preserves every legacy field, fills empties, adds synthesis block + conservative risks', async () => {
  const pkg = await buildProjectPackage({ query: 'marketplace platform for students to sell project templates', includeMemory: false });
  const legacy = {
    title: 'Legacy Title', problem: 'legacy problem text stays', technicalMechanism: '',
    claimsOutline: ['claim 1'], priorArtSignals: [{ title: 'sig' }], riskWarnings: ['existing warning'],
    score: { overall: 42, grade: '', riskLevel: 'Unassessed' },
  };
  const out = toPatentOsPayload(pkg, legacy);
  assert.equal(out.title, 'Legacy Title');
  assert.equal(out.problem, 'legacy problem text stays');
  assert.deepEqual(out.claimsOutline, ['claim 1']);
  assert.deepEqual(out.score, legacy.score, 'Patent OS score is never touched by the bridge');
  assert.ok(out.technicalMechanism.length > 40, 'empty mechanism filled from package');
  for (const k of ['technicalMechanism', 'buildBrief', 'projectBlueprint', 'evidenceSummary', 'quality', 'projectOsPayload', 'evidenceConfidence', 'ipReadinessAngle']) {
    assert.ok(k in out.synthesis, `synthesis block missing ${k}`);
  }
  assert.ok(out.riskWarnings.includes('existing warning'));
  assert.match(out.riskWarnings.join(' '), /weak ground for IP|faculty\/IP-cell/i, 'marketplace must carry the IP-weak warning');
  assert.ok(!GUARANTEE.test(JSON.stringify(out.synthesis)), 'no patentability guarantee language');
});

test('toPatentOsPayload handles a missing package (legacy-only) without changes or crashes', () => {
  const legacy = { title: 'Old idea', problem: 'p', technicalMechanism: 'an old mechanism description that is long enough to keep' };
  const out = toPatentOsPayload(null, legacy);
  assert.equal(out.title, 'Old idea');
  assert.equal(out.technicalMechanism, legacy.technicalMechanism);
  assert.ok(!out.synthesis, 'no synthesis block without a package');
});

test('mergeLegacyIdeaWithProjectPackage fills only empty fields', async () => {
  const pkg = await fullPkg();
  const merged = mergeLegacyIdeaWithProjectPackage({ title: 'Keep Me', problem: '' }, pkg);
  assert.equal(merged.title, 'Keep Me');
  assert.ok(merged.problem.length > 40);
  assert.equal(merged.projectPackage, pkg);
});

/* ---- Patent scoring with synthesis input ---- */

const BASE_IDEA = {
  title: 'Vitals anomaly platform', domain: 'Healthcare',
  problem: 'clinicians miss early deterioration signals across disconnected monitors',
  proposedSolution: 'a monitoring platform for clinical teams',
};

test('scorePatentIdea without a package is byte-identical to the legacy path (backward compatibility)', () => {
  const a = scorePatentIdea(BASE_IDEA);
  const b = scorePatentIdea(BASE_IDEA, {});
  const c = scorePatentIdea(BASE_IDEA, { priorArtRecords: [] });
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

test('a strong package mechanism raises technical depth; its absence keeps the score lower', async () => {
  const pkg = await fullPkg();
  const withPkg = scorePatentIdea(BASE_IDEA, { projectPackage: pkg });
  const withoutPkg = scorePatentIdea(BASE_IDEA);
  assert.ok(withPkg.factors.technicalDepth > withoutPkg.factors.technicalDepth, `expected depth lift, ${withoutPkg.factors.technicalDepth} -> ${withPkg.factors.technicalDepth}`);
  assert.match(withPkg.reasons.join(' '), /technical mechanism|technical depth/i);
});

test('weak/community-only evidence in the package lowers prior-art distance and confidence', async () => {
  const community = [{ source: 'reddit', sourceType: 'community_pain_point', title: 'rant', relevanceScore: 40, trustScore: 20 }];
  const weakPkg = await buildProjectPackage({ query: 'healthcare patient monitoring platform', evidence: community, evidenceStrength: 20, includeMemory: false });
  const research = [...community, { source: 'openalex', sourceType: 'research_paper', title: 'adaptive alarm thresholds', relevanceScore: 80, trustScore: 80 }];
  const strongPkg = await buildProjectPackage({ query: 'healthcare patient monitoring platform', evidence: research, evidenceStrength: 60, includeMemory: false });
  const weak = scorePatentIdea(BASE_IDEA, { projectPackage: weakPkg });
  const strong = scorePatentIdea(BASE_IDEA, { projectPackage: strongPkg });
  assert.ok(weak.factors.priorArtDistance < strong.factors.priorArtDistance, 'community-only must lower prior-art distance');
  assert.match(weak.reasons.join(' '), /community-only|confidence/i);
});

test('IP-weak domains (generic marketplace/workflow) are capped and never high IP-ready', async () => {
  const pkg = await buildProjectPackage({ query: 'marketplace platform for students to collaborate and sell templates', includeMemory: false });
  assert.equal(pkg.classification.ipAnalysisAppropriate, false);
  const idea = {
    title: 'Student template marketplace', domain: 'Marketplace',
    problem: 'students cannot sell templates', proposedSolution: 'a marketplace platform',
    technicalMechanism: 'an algorithm pipeline with scoring, ranking, optimization, feedback loop, anomaly detection, classification, prediction, verification and adaptive weighting of multi-source real-time data fusion',
    processingLogic: 'ingest, normalize, weight, fuse, score, calibrate', inputData: 'listings and behavior', outputResult: 'ranked listings with confidence',
    feedbackLoop: 'outcomes recalibrate weights', noveltyAngle: 'adaptive multi-source weighting', marketUseCase: 'reduces search time by 30%', implementationPlan: 'pipeline',
  };
  const sc = scorePatentIdea(idea, { projectPackage: pkg });
  assert.ok(sc.overall <= 50, `IP-weak domain must be capped, got ${sc.overall}`);
  assert.equal(sc.riskLevel, 'High');
  assert.match(sc.reasons.join(' '), /weak ground for IP|faculty\/IP-cell/i);
  assert.ok(!['Strong candidate', 'Promising'].includes(sc.grade));
});

/* ---- prior-art plan with synthesis input ---- */

test('prior-art plan reflects the package domain and technical mechanism', async () => {
  const pkg = await fullPkg('agriculture crop disease detection from leaf images for farmers');
  const plan = priorArtPlan({ title: 'Crop helper', tags: [] }, { projectPackage: pkg });
  const text = JSON.stringify(plan).toLowerCase();
  assert.ok(/agricult|crop|leaf|disease|image/.test(plan.keywords.join(' ')), `keywords must reflect the domain, got ${plan.keywords.join(', ')}`);
  assert.match(plan.differentiationAngles[0], /technical mechanism/i);
  assert.ok(text.includes('not a completed search') || /suggested/i.test(plan.note), 'plan must not claim completeness');
  // Backward compatible without a package.
  const legacyPlan = priorArtPlan({ title: 'Anomaly detection pipeline', technicalMechanism: 'streaming ml detection', domain: 'Cybersecurity', tags: ['ml'] });
  assert.ok(legacyPlan.queries.googlePatents.length > 0 && legacyPlan.classificationHints.length > 0);
});

test('prior-art plan surfaces weak-evidence and IP-weak risks from the package', async () => {
  const pkg = await buildProjectPackage({ query: 'marketplace platform for students to collaborate and sell templates', includeMemory: false });
  const plan = priorArtPlan({ title: 'Marketplace', tags: [] }, { projectPackage: pkg });
  assert.match(plan.riskAreas.join(' '), /weak ground for IP/i);
  assert.match(plan.riskAreas.join(' '), /community-only|no source evidence|weak or community-only/i);
});

/* ---- strengthening with synthesis input ---- */

test('strengthening adopts the package domain-specific mechanism instead of generic boilerplate', async () => {
  const pkg = await fullPkg('finance fraud detection for UPI transactions');
  const weak = { title: 'Fraud tool', domain: 'Finance', problem: 'fraud losses', proposedSolution: 'a tool' };
  const withPkg = strengthenIdea(weak, { projectPackage: pkg });
  assert.ok(withPkg.scoreAfter > withPkg.scoreBefore);
  assert.equal(withPkg.idea.technicalMechanism, pkg.buildBrief.technicalMechanism, 'must adopt the package mechanism');
  assert.match(withPkg.changes.join(' '), /synthesis project package/i);
  // Without a package the legacy boilerplate path is unchanged.
  const withoutPkg = strengthenIdea(weak);
  assert.match(withoutPkg.idea.technicalMechanism, /fusing multiple/i);
});

/* ---- conservative IP language everywhere ---- */

test('no payload produced by the bridge contains patentability-guarantee language', async () => {
  for (const q of ['healthcare patient monitoring platform', 'marketplace for students', 'cybersecurity threat intelligence dashboard tracking CVE vulnerabilities']) {
    const pkg = await buildProjectPackage({ query: q, includeMemory: false });
    const patent = toPatentOsPayload(pkg, {});
    const workspace = toProjectOsWorkspacePayload(pkg, {});
    assert.ok(!GUARANTEE.test(JSON.stringify(patent)), `${q}: patent payload overclaims`);
    assert.ok(!GUARANTEE.test(JSON.stringify(workspace.intelligence)), `${q}: workspace payload overclaims`);
    assert.match(patent.synthesis.ipReadinessAngle, /review|caution|weak|not|risk|validate/i, `${q}: IP angle lacks conservative framing`);
  }
});
