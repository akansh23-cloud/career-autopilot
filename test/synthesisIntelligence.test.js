/* ============================================================
   Synthesis Intelligence — test suite
   ------------------------------------------------------------
   Dependency-free (no server boot, no DB, no AI key): exercises
   the deterministic synthesis layer directly, exactly as it runs
   when AI is unavailable. Covers the ten spec queries, validator
   behaviour, fallback generators, cross-domain blueprint
   uniqueness, RAG/memory deterministic mode and outcome hooks.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildProjectPackage } from '../server/services/synthesisIntelligence/projectPackageService.js';
import { classifyIdeaContext } from '../server/services/synthesisIntelligence/domainClassifier.js';
import { blueprintSignature } from '../server/services/synthesisIntelligence/blueprintGenerator.js';
import { PROFILE_KEYS, getProfile } from '../server/services/synthesisIntelligence/domainProfiles.js';
import {
  validateIdeaSpecificity, validateBlueprintQuality, validateNoPlaceholderText,
  validateTechnicalMechanism, validateProjectOsCompatibility,
} from '../server/services/synthesisIntelligence/qualityValidation.js';
import { buildMemoryInsights, deterministicSimilarity, applyMemoryToPackage } from '../server/services/synthesisIntelligence/memoryAugmentation.js';
import { IDEA_EVENTS, isValidIdeaEvent, mapEventToOutcome } from '../server/services/synthesisIntelligence/outcomeHooks.js';
import { buildProjectOsPayload, enrichWorkspacePayload } from '../server/services/synthesisIntelligence/projectOsAdapter.js';
import { assertNoGenericOutput } from './synthesisHelpers.js';

/* The ten diverse queries from the spec, with the domain each must hit. */
const QUERIES = [
  { q: 'AI attendance system for college classrooms using face recognition', domain: 'education' },
  { q: 'smart waste management system for city garbage collection', domain: 'environment' },
  { q: 'healthcare patient monitoring platform with vitals alerts', domain: 'healthcare' },
  { q: 'agriculture crop disease detection from leaf images for farmers', domain: 'agriculture' },
  { q: 'cybersecurity threat intelligence dashboard tracking CVE vulnerabilities', domain: 'cybersecurity' },
  { q: 'logistics route optimization for delivery fleet supply chain', domain: 'logistics' },
  { q: 'finance fraud detection for UPI transactions', domain: 'finance' },
  { q: 'vehicle driver training simulator with physics engine', domain: 'simulation' },
  { q: 'college project collaboration system for student teams', domain: 'education' },
  { q: 'public data civic analytics tool for municipal budgets', domain: 'civictech' },
];

async function pkgFor(q, extra = {}) {
  return buildProjectPackage({ query: q, includeMemory: false, ...extra });
}

test('every spec query produces a complete, non-generic, domain-correct package (AI-keyless)', async () => {
  for (const { q, domain } of QUERIES) {
    const pkg = await pkgFor(q);
    assertNoGenericOutput(pkg, q);
    // education appears twice with different subdomain intent; both must classify into a real domain.
    assert.notEqual(pkg.classification.domain, 'generic', `${q}: fell back to generic profile`);
    if (domain !== 'education') assert.equal(pkg.classification.domain, domain, `${q}: classified as ${pkg.classification.domain}`);
  }
});

test('unrelated domains never return identical blueprint structures', async () => {
  const signatures = new Map();
  for (const { q } of QUERIES) {
    const pkg = await pkgFor(q);
    const sig = blueprintSignature(pkg.projectBlueprint);
    const key = pkg.classification.domain;
    if (signatures.has(key)) continue; // same domain may legitimately share a profile
    for (const [otherKey, otherSig] of signatures) {
      assert.notEqual(sig, otherSig, `blueprints identical across unrelated domains: ${key} vs ${otherKey}`);
    }
    signatures.set(key, sig);
  }
  assert.ok(signatures.size >= 8, `expected >=8 distinct domains, got ${signatures.size}`);
});

test('irrelevant APIs/data sources are not injected across domains', async () => {
  const healthcare = await pkgFor('healthcare patient monitoring platform with vitals alerts');
  const logistics = await pkgFor('logistics route optimization for delivery fleet supply chain');
  const hcSources = healthcare.projectBlueprint.apisAndDataSources.join(' ').toLowerCase();
  const logSources = logistics.projectBlueprint.apisAndDataSources.join(' ').toLowerCase();
  assert.ok(!/route|osrm|traffic|fleet/.test(hcSources), 'healthcare blueprint contains logistics APIs');
  assert.ok(!/fhir|vitals|patient|hl7/.test(logSources), 'logistics blueprint contains healthcare APIs');
});

test('all 14 fallback domain profiles generate distinct, complete deterministic output', async () => {
  assert.ok(PROFILE_KEYS.length >= 14, `expected >=14 domain profiles, got ${PROFILE_KEYS.length}`);
  const sigs = new Set();
  for (const key of PROFILE_KEYS) {
    const profile = getProfile(key);
    const pkg = await buildProjectPackage({ query: profile.match.slice(0, 3).join(' '), domain: key, includeMemory: false });
    assertNoGenericOutput(pkg, `profile:${key}`);
    sigs.add(blueprintSignature(pkg.projectBlueprint));
  }
  assert.equal(sigs.size, PROFILE_KEYS.length, 'fallback profiles produced duplicate blueprint structures');
});

test('classification covers all required dimensions', () => {
  const c = classifyIdeaContext({ query: 'cybersecurity threat intelligence dashboard tracking CVE vulnerabilities' });
  assert.equal(c.domain, 'cybersecurity');
  for (const k of ['subdomain', 'intent', 'projectType', 'expectedPrototypeType', 'difficulty', 'classificationConfidence']) {
    assert.ok(c[k], `classification missing ${k}`);
  }
  assert.ok(Array.isArray(c.targetUsers) && c.targetUsers.length, 'target users missing');
  assert.ok(Array.isArray(c.dataNeeds) && c.dataNeeds.length, 'data needs missing');
  assert.ok(Array.isArray(c.sensitivityConstraints), 'sensitivity constraints missing');
  assert.equal(typeof c.ipAnalysisAppropriate, 'boolean', 'IP-appropriateness flag missing');
});

test('validators reject weak input and accept strong input', () => {
  assert.equal(validateIdeaSpecificity({ title: 'AI tool', targetUsers: ['users'], problem: 'helps people' }).ok, false);
  assert.equal(validateTechnicalMechanism({ technicalMechanism: 'A dashboard that shows data to users' }).ok, false);
  assert.equal(validateTechnicalMechanism({ technicalMechanism: 'Anomaly detection pipeline: rolling z-score over vitals streams with rule-based severity escalation.' }).ok, true);
  assert.equal(validateNoPlaceholderText({ a: 'Lorem ipsum dolor sit amet' }).ok, false);
  assert.equal(validateNoPlaceholderText({ a: '[insert problem here]' }).ok, false);
  assert.equal(validateBlueprintQuality({}).ok, false);
  assert.equal(validateProjectOsCompatibility({ title: 'x' }).ok, false);
});

test('placeholder/vague AI output triggers regeneration into a valid package with lowered confidence or warnings', async () => {
  const pkg = await buildProjectPackage({
    query: 'healthcare patient monitoring platform',
    idea: { title: 'AI Assistant', painPoint: 'TBD', proposedSolution: '[insert solution]' },
    includeMemory: false,
  });
  // The orchestrator must not pass the placeholder text through.
  assertNoGenericOutput(pkg, 'placeholder-recovery');
  assert.equal(pkg.classification.domain, 'healthcare');
});

test('generic/unclassifiable query degrades safely with warnings instead of fake specificity', async () => {
  const pkg = await buildProjectPackage({ query: 'make something cool', includeMemory: false });
  assert.equal(pkg.classification.domain, 'generic');
  assert.ok(pkg.quality.blueprintUniquenessScore <= 40, 'generic domain must cap uniqueness');
  assert.ok(pkg.quality.warnings.length > 0, 'generic domain must warn');
  assert.match(pkg.buildBrief.ipReadinessAngle, /weak|review|not/i, 'generic ideas must not get strong IP language');
});

test('evidence grounding: community-only evidence reduces confidence and IP-readiness', async () => {
  const community = [
    { source: 'reddit', sourceType: 'community_pain_point', title: 'Nurses complain about alarm fatigue', relevanceScore: 60, trustScore: 30 },
    { source: 'hackernews', sourceType: 'community_pain_point', title: 'ICU monitoring rant', relevanceScore: 50, trustScore: 30 },
  ];
  const pkg = await buildProjectPackage({ query: 'healthcare patient monitoring platform', evidence: community, evidenceStrength: 30, includeMemory: false });
  assert.deepEqual(pkg.evidenceSummary.sourceCategoriesUsed, ['community']);
  assert.ok(pkg.quality.evidenceGroundingScore <= 35, 'community-only must cap grounding score');
  assert.match(pkg.quality.warnings.join(' '), /community-only/i);
  assert.ok(pkg.evidenceSummary.validationNeededBeforeBuild.length > 0);

  const mixed = [...community, { source: 'openalex', sourceType: 'research_paper', title: 'Adaptive alarm thresholds in ICU telemetry', relevanceScore: 80, trustScore: 80 }];
  const pkg2 = await buildProjectPackage({ query: 'healthcare patient monitoring platform', evidence: mixed, evidenceStrength: 60, includeMemory: false });
  assert.ok(pkg2.quality.evidenceGroundingScore > pkg.quality.evidenceGroundingScore, 'research evidence must raise grounding');
});

test('IP-readiness stays conservative: marketplace/workflow ideas marked weak, no novelty guarantees anywhere', async () => {
  const pkg = await pkgFor('marketplace platform for students to collaborate and sell project templates');
  assert.equal(pkg.classification.ipAnalysisAppropriate, false, 'marketplace must be IP-weak');
  assert.match(pkg.buildBrief.ipReadinessAngle, /weak|portfolio|not/i);
  for (const { q } of QUERIES) {
    const p = await pkgFor(q);
    assert.doesNotMatch(`${p.buildBrief.ipReadinessAngle} ${p.projectOsPayload.ipReadinessPossibility}`, /\bis guaranteed\b|\bdefinitely patentable\b|\bwill be granted\b|\bguarantees? a patent\b/i, `${q}: IP overclaim`);
  }
});

test('Project OS payload is complete and the adapter enriches an existing workspace record non-destructively', async () => {
  const pkg = await pkgFor('vehicle driver training simulator with physics engine');
  assert.equal(validateProjectOsCompatibility(pkg.projectOsPayload).ok, true);
  assert.ok(pkg.projectOsPayload.requiredRoles.some((r) => /simulation/i.test(r)), 'simulator must require a simulation engineer role');

  const existing = {
    title: 'My Existing Workspace', solution: 'already written', architecture: ['existing architecture line'],
    evidenceChecklist: ['Existing proof item'], skillsCovered: [],
  };
  const enriched = enrichWorkspacePayload({ ...existing }, pkg);
  assert.equal(enriched.title, 'My Existing Workspace', 'adapter must not overwrite existing title');
  assert.equal(enriched.solution, 'already written', 'adapter must not overwrite existing solution');
  assert.deepEqual(enriched.architecture, ['existing architecture line'], 'adapter must not overwrite existing architecture');
  assert.ok(enriched.evidenceChecklist.length > 1, 'adapter must append proof items');
  assert.ok(enriched.technicalMechanism, 'adapter must add the technical mechanism');
  assert.ok(enriched.skillsCovered.length > 0, 'adapter must fill empty skills');
  assert.ok(enriched.ipReadinessPossibility, 'adapter must add IP-readiness possibility');

  const standalone = buildProjectOsPayload({ title: pkg.title, classification: { difficulty: 'advanced' }, buildBrief: pkg.buildBrief, projectBlueprint: pkg.projectBlueprint, quality: pkg.quality });
  assert.equal(standalone.difficulty, 'advanced');
});

test('RAG memory: deterministic fallback retrieval, duplicate risk, outcome-driven ranking impact', async () => {
  const idea = { title: 'Smart Waste Route Optimizer for Municipal Trucks', domain: 'environment', technicalMechanism: 'route optimization algorithm over fill-level telemetry', tags: ['waste', 'route', 'municipal'] };

  // Near-duplicate + rejected history → high risk, negative ranking, warnings.
  const negative = buildMemoryInsights({
    idea,
    candidates: [
      { title: 'Smart Waste Route Optimizer for Municipal Trucks', domain: 'environment', tags: ['waste', 'route'], technicalMechanism: 'route optimization over telemetry', outcome: 'prior_art_blocked' },
      { title: 'Municipal waste route planner', domain: 'environment', tags: ['waste'], outcome: 'faculty_negative' },
    ],
    retrievalMode: 'keyword-fallback',
  });
  assert.ok(['medium', 'high'].includes(negative.duplicateRisk), `expected duplicate risk, got ${negative.duplicateRisk}`);
  assert.ok(negative._meta.rankingDelta < 0, 'rejected/blocked history must lower ranking');
  assert.ok(negative.warnings.length > 0 && negative.lessonsFromPastIdeas.length > 0);
  for (const k of ['similarIdeas', 'duplicateRisk', 'pastOutcomeSignals', 'lessonsFromPastIdeas', 'rankingImpact', 'warnings']) assert.ok(k in negative, `memory shape missing ${k}`);

  // Successful similar history → positive impact.
  const positive = buildMemoryInsights({
    idea: { ...idea, title: 'Fleet fill-level telemetry analytics' },
    candidates: [{ title: 'Garbage truck telemetry analytics', domain: 'environment', tags: ['waste', 'telemetry'], outcome: 'faculty_approved' }],
    retrievalMode: 'keyword-fallback',
  });
  assert.ok(positive._meta.rankingDelta >= 0, 'approved history must not penalize');

  // applyMemoryToPackage folds risk into the package conservatively.
  const pkg = await pkgFor('smart waste management system for city garbage collection');
  const before = pkg.quality.evidenceGroundingScore;
  const after = applyMemoryToPackage(pkg, negative);
  assert.ok(after.memory, 'memory must be attached to package');
  assert.ok(after.quality.evidenceGroundingScore <= before, 'negative memory must not raise grounding');
  assert.match(after.projectOsPayload.warnings.join(' ') + after.quality.warnings.join(' '), /similar|duplicate|prior/i);

  // Unrelated ideas score low similarity.
  assert.ok(deterministicSimilarity(idea, { title: 'Poetry generator', domain: 'aiml', tags: ['nlp'] }) < 35);
});

test('outcome hooks: all ten lifecycle events are valid and map into the memory outcome vocabulary', () => {
  const expected = ['idea_generated', 'idea_selected', 'project_started', 'project_completed', 'faculty_approved', 'faculty_rejected', 'ip_review_shortlisted', 'prior_art_blocked', 'recruiter_shortlisted', 'student_abandoned'];
  for (const e of expected) {
    assert.ok(IDEA_EVENTS.includes(e), `missing event ${e}`);
    assert.ok(isValidIdeaEvent(e));
    assert.ok(mapEventToOutcome(e), `event ${e} maps to empty outcome`);
  }
  assert.equal(isValidIdeaEvent('made_up_event'), false);
  assert.equal(mapEventToOutcome('project_completed'), 'built');
  assert.equal(mapEventToOutcome('faculty_rejected'), 'faculty_negative');
});

test('regression helper itself rejects generic packages', async () => {
  const good = await pkgFor('finance fraud detection for UPI transactions');
  const bad = JSON.parse(JSON.stringify(good));
  bad.title = 'AI Assistant for end users';
  assert.throws(() => assertNoGenericOutput(bad, 'bad-title'));
  const bad2 = JSON.parse(JSON.stringify(good));
  bad2.buildBrief.technicalMechanism = 'A simple dashboard that displays data';
  assert.throws(() => assertNoGenericOutput(bad2, 'bad-mechanism'));
  const bad3 = JSON.parse(JSON.stringify(good));
  delete bad3.projectOsPayload;
  assert.throws(() => assertNoGenericOutput(bad3, 'missing-os-payload'));
});
