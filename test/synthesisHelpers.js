/* ============================================================
   Shared regression helper — synthesis output quality gate
   ------------------------------------------------------------
   Import assertNoGenericOutput(pkg) in any test that touches idea
   generation. It fails the test if the old "generic output" bug
   ever returns:
   - placeholder text anywhere in the package
   - vague title ("Assistant for end users", "AI tool", ...)
   - blueprint-only output without a build brief
   - missing/vague technical mechanism (dashboard-only)
   - missing Project OS payload (or incomplete payload)
   - high IP-readiness language without technical differentiation
   Dependency-free: imports only the synthesis modules under test.
   ============================================================ */
import assert from 'node:assert/strict';
import {
  validateNoPlaceholderText,
  validateTechnicalMechanism,
  validateProjectOsCompatibility,
} from '../server/services/synthesisIntelligence/qualityValidation.js';
import { isWeakTitle } from '../server/services/synthesisIntelligence/buildBriefGenerator.js';

const BRIEF_REQUIRED = [
  'overview', 'problem', 'targetUsers', 'whyItMatters', 'proposedSolution',
  'technicalMechanism', 'keyModules', 'dataSources', 'expectedOutput', 'skillsGained',
  'facultyEvaluationValue', 'recruiterValue', 'ipReadinessAngle', 'risksAndLimitations',
];

const BLUEPRINT_REQUIRED = [
  'architecture', 'techStack', 'mvpScope', 'advancedScope', 'apisAndDataSources',
  'databaseModels', 'milestones', 'testingPlan', 'deploymentPlan', 'proofChecklist',
];

const IP_OVERCLAIM = /\b(is|are|definitely|certainly|surely)\s+(guaranteed|assured)\s+(novelty|novel|patentable|approval)|\bwill (definitely )?be granted\b|\bdefinitely patentable\b|\bguarantees? (a )?patent\b/i;

export function assertNoGenericOutput(pkg, label = 'package') {
  assert.ok(pkg && typeof pkg === 'object', `${label}: package missing`);

  // 1. No vague title.
  assert.ok(pkg.title && pkg.title.length >= 12, `${label}: title too short: "${pkg.title}"`);
  assert.ok(!isWeakTitle(pkg.title), `${label}: vague/generic title: "${pkg.title}"`);

  // 2. No blueprint-only output — build brief must be present and complete.
  assert.ok(pkg.buildBrief, `${label}: buildBrief missing (blueprint-only output)`);
  for (const k of BRIEF_REQUIRED) {
    const v = pkg.buildBrief[k];
    const ok = Array.isArray(v) ? v.length > 0 : String(v || '').trim().length > 0;
    assert.ok(ok, `${label}: buildBrief.${k} is empty`);
  }

  // 3. Blueprint complete.
  assert.ok(pkg.projectBlueprint, `${label}: projectBlueprint missing`);
  for (const k of BLUEPRINT_REQUIRED) {
    assert.ok(Array.isArray(pkg.projectBlueprint[k]) && pkg.projectBlueprint[k].length > 0, `${label}: projectBlueprint.${k} is empty`);
  }

  // 4. Technical mechanism present and not dashboard-only.
  const mech = validateTechnicalMechanism({ technicalMechanism: pkg.buildBrief.technicalMechanism });
  assert.ok(mech.ok, `${label}: weak technical mechanism — ${mech.issues.join('; ')}`);

  // 5. No placeholder text anywhere.
  const ph = validateNoPlaceholderText(pkg);
  assert.ok(ph.ok, `${label}: placeholder text found — ${ph.issues.join('; ')}`);

  // 6. Project OS payload present and complete.
  const os = validateProjectOsCompatibility(pkg.projectOsPayload || {});
  assert.ok(os.ok, `${label}: Project OS payload invalid — ${os.issues.join('; ')}`);

  // 7. IP-readiness never overclaims, and weak-IP domains stay conservative.
  const ipText = `${pkg.buildBrief.ipReadinessAngle} ${pkg.projectOsPayload.ipReadinessPossibility}`;
  assert.ok(!IP_OVERCLAIM.test(ipText), `${label}: IP language overclaims novelty/approval`);
  assert.match(ipText, /review|caution|weak|not guaranteed|never|validate|risk/i, `${label}: IP language lacks conservative framing`);

  // 8. Quality block exists with all four scores.
  assert.ok(pkg.quality, `${label}: quality block missing`);
  for (const k of ['specificityScore', 'evidenceGroundingScore', 'blueprintUniquenessScore', 'technicalDepthScore']) {
    assert.equal(typeof pkg.quality[k], 'number', `${label}: quality.${k} missing`);
  }
}

export default { assertNoGenericOutput };
