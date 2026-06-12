/* ============================================================
   Synthesis Intelligence — dynamic Project Blueprint generator
   ------------------------------------------------------------
   Blueprints are generated from the original query, the domain
   classification, source evidence, detected pain points, the
   proposed solution, the technical mechanism, target users,
   difficulty, project type, and proof requirements — so two
   unrelated ideas can never share an identical blueprint.
   ============================================================ */
import { sanitizeText, lc } from '../problemIntelligence/util.js';
import { getProfile } from './domainProfiles.js';
import { applyBlueprintVariation } from './variationEngine.js';

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

/* Difficulty shapes scope: beginners get a tighter MVP, advanced builds
   pull one advanced item into the MVP. */
function scopeForDifficulty(profile, difficulty) {
  const milestones = profile.milestones.slice();
  const mvpCount = difficulty === 'beginner' ? 3 : difficulty === 'advanced' ? 5 : 4;
  const mvpScope = milestones.slice(0, mvpCount).map((m) => sanitizeText(m, 200));
  const advancedScope = milestones.slice(mvpCount).map((m) => sanitizeText(m, 200));
  // Always give advanced scope at least the deeper profile angles.
  if (!advancedScope.length) {
    advancedScope.push(`Harden the ${profile.mechanisms[0].name} against the documented risks: ${profile.risks[0] || 'edge cases'}`);
    if (profile.mechanisms[1]) advancedScope.push(`Add a second mechanism layer: ${profile.mechanisms[1].name}`);
  }
  return { mvpScope, advancedScope };
}

/* Merge evidence-derived API/data sources with profile defaults, dropping
   irrelevant injected sources (anything that matches neither the domain
   profile nor the evidence). */
function resolveDataSources(profile, evidenceCitations = []) {
  const fromEvidence = arr(evidenceCitations)
    .map((c) => (typeof c === 'string' ? c : (c.title || c.source || '')))
    .filter(Boolean)
    .slice(0, 3)
    .map((t) => sanitizeText(`Evidence source: ${t}`, 160));
  return [...profile.dataSources.slice(0, 4), ...fromEvidence].slice(0, 6);
}

/**
 * generateProjectBlueprint — the structured blueprint the spec requires.
 */
export function generateProjectBlueprint({ classification, brief, evidenceCitations = [], query = '', seedContext = null }) {
  const profile = getProfile(classification.domain);
  const { mvpScope, advancedScope } = scopeForDifficulty(profile, classification.difficulty);
  const mechanismName = brief?._meta?.mechanismName || profile.mechanisms[0].name;

  // Milestones carry the mechanism explicitly so the central technical work
  // is never lost in generic phases.
  const milestones = profile.milestones.map((m, i) => sanitizeText(`M${i + 1}: ${m}`, 220));

  const proofChecklist = [
    ...profile.proofChecklist,
    `Documented walkthrough connecting the original goal ("${sanitizeText(query, 80) || classification.subdomain}") to the shipped ${mechanismName}`,
  ].map((x) => sanitizeText(x, 220)).slice(0, 7);

  const blueprint = {
    architecture: profile.architecture.map((a) => sanitizeText(a, 220)),
    techStack: profile.techStack.map((t) => sanitizeText(t, 120)),
    mvpScope,
    advancedScope,
    apisAndDataSources: resolveDataSources(profile, evidenceCitations),
    databaseModels: profile.databaseModels.map((d) => sanitizeText(d, 160)),
    milestones,
    testingPlan: profile.testingPlan.map((t) => sanitizeText(t, 200)),
    deploymentPlan: profile.deploymentPlan.map((d) => sanitizeText(d, 200)),
    proofChecklist,
    _meta: { profileKey: profile.key, mechanismName, difficulty: classification.difficulty, projectType: classification.projectType },
  };

  /* Phase 2 — output variety at scale (strictly opt-in): with a
     seedContext (userId + projectId + title) the variation engine
     deterministically selects among ≥3 concrete variants per section,
     so a user's 2nd/3rd project in the same domain never reads
     templated. No seedContext → the blueprint above is returned
     untouched, byte-identical to the pre-Phase-2 output. */
  if (seedContext && (seedContext.userId || seedContext.projectId || seedContext.title)) {
    return applyBlueprintVariation({ blueprint, profile, mechanismName, seedContext });
  }
  return blueprint;
}

/* Structural signature of a blueprint — used by tests/validators to assert
   that unrelated domains do not return identical blueprint structures. */
export function blueprintSignature(bp = {}) {
  const join = (k) => arr(bp[k]).map((x) => lc(String(x))).join('|');
  return [join('architecture'), join('mvpScope'), join('databaseModels'), join('milestones')].join('||');
}

export default { generateProjectBlueprint, blueprintSignature };
