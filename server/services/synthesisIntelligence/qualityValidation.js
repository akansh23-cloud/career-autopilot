/* ============================================================
   Synthesis Intelligence — quality validation
   ------------------------------------------------------------
   Reusable validators that block generic output from shipping:
   validateIdeaSpecificity, validateBlueprintQuality,
   validateNoPlaceholderText, validateTechnicalMechanism,
   validateProjectOsCompatibility — plus the quality scoring
   used in every project package. Deterministic, dependency-free.
   ============================================================ */
import { lc, clamp } from '../problemIntelligence/util.js';
import { GENERIC_MARKER_LINES } from './domainProfiles.js';
import { isWeakTitle } from './buildBriefGenerator.js';

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

export const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /\bTBD\b|\bTODO\b|to be (decided|determined|defined)/i,
  /\[(insert|add|your|describe)[^\]]*\]/i,
  /<[a-z ]*(placeholder|here)[a-z ]*>/i,
  /\byour idea here\b|\bsomething useful\b|\bfill (this|in)\b/i,
  /\bexample\.com\/replace\b/i,
];

const VAGUE_MECHANISM = /^(a |an |the )?(simple |basic |generic )?(dashboard|website|web ?app|crud app|admin panel|workflow|portal|landing page)\.?$/i;
const GENERIC_MECHANISM_PHRASES = /\b(just|simply|basic crud|generic (dashboard|workflow)|standard web app)\b/i;
const MECHANISM_CLASSES = /(simulation|anomaly|scoring|ranking|fusion|event-driven|alert|optimi[sz]ation|route|vision|inference|knowledge graph|telemetry|recommendation|validation|correlation|prediction|verification|retrieval|escalation|state machine|pipeline|graph|engine)/i;

function collectStrings(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { for (const v of value) collectStrings(v, out); return out; }
  if (typeof value === 'object') { for (const v of Object.values(value)) collectStrings(v, out); return out; }
  return out;
}

/* ---- 1. idea specificity ---- */
export function validateIdeaSpecificity(idea = {}) {
  const issues = [];
  const title = idea.title || idea.buildBrief?._meta?.title || '';
  if (isWeakTitle(title)) issues.push(`Title is vague or generic: "${title || '(empty)'}"`);
  const targets = arr(idea.targetUsers || idea.buildBrief?.targetUsers);
  if (!targets.length) issues.push('No target users specified.');
  else if (targets.every((t) => /^(end )?users?$|^people$|^everyone$/i.test(String(t).trim()))) issues.push('Target users are generic ("users"/"people") — name a concrete user group.');
  const problem = idea.problem || idea.painPoint || idea.problemStatement || idea.buildBrief?.problem || '';
  if (String(problem).trim().length < 40) issues.push('Problem statement is missing or too thin to act on.');
  return { ok: issues.length === 0, issues };
}

/* ---- 2. blueprint quality ---- */
export function validateBlueprintQuality(blueprint = {}) {
  const issues = [];
  if (!arr(blueprint.architecture).length) issues.push('Blueprint is missing architecture.');
  if (!arr(blueprint.mvpScope).length) issues.push('Blueprint is missing MVP scope.');
  if (!arr(blueprint.milestones).length) issues.push('Blueprint is missing milestones.');
  if (!arr(blueprint.proofChecklist).length) issues.push('Blueprint is missing a proof checklist.');
  if (!arr(blueprint.databaseModels).length) issues.push('Blueprint is missing database/data models.');
  if (!arr(blueprint.testingPlan).length) issues.push('Blueprint is missing a testing plan.');
  // Generic-marker check: a blueprint that is mostly generic-profile lines is
  // blueprint-only boilerplate, not a domain-aware plan.
  const lines = [...arr(blueprint.architecture), ...arr(blueprint.milestones), ...arr(blueprint.mvpScope)];
  if (lines.length) {
    const genericHits = lines.filter((l) => GENERIC_MARKER_LINES.has(String(l).replace(/^M\d+:\s*/, ''))).length;
    if (genericHits / lines.length > 0.6) issues.push('Blueprint relies on generic boilerplate lines — it lacks domain-specific modules.');
  }
  return { ok: issues.length === 0, issues };
}

/* ---- 3. placeholder text ---- */
export function validateNoPlaceholderText(payload = {}) {
  const issues = [];
  const strings = collectStrings(payload);
  for (const s of strings) {
    for (const re of PLACEHOLDER_PATTERNS) {
      if (re.test(s)) { issues.push(`Placeholder text detected: "${String(s).slice(0, 80)}"`); break; }
    }
    if (issues.length >= 5) break;
  }
  return { ok: issues.length === 0, issues };
}

/* ---- 4. technical mechanism ---- */
export function validateTechnicalMechanism(payload = {}) {
  const issues = [];
  const mech = String(payload.technicalMechanism || payload.buildBrief?.technicalMechanism || '').trim();
  if (!mech) issues.push('No technical mechanism specified — every project must name its core technical mechanism.');
  else if (mech.length < 25) issues.push('Technical mechanism is too vague — describe what the mechanism actually computes.');
  else if (VAGUE_MECHANISM.test(mech) || GENERIC_MECHANISM_PHRASES.test(mech)) issues.push('Technical mechanism only describes a generic dashboard/workflow — name a real computational mechanism (e.g. anomaly detection pipeline, route optimization algorithm).');
  else if (!MECHANISM_CLASSES.test(mech)) issues.push('Technical mechanism does not match any recognized mechanism class — sharpen it (simulation engine, scoring engine, sensor fusion, etc.).');
  return { ok: issues.length === 0, issues };
}

/* ---- 5. Project OS compatibility ---- */
const PROJECT_OS_REQUIRED = ['title', 'problemStatement', 'targetUsers', 'technicalMechanism', 'requiredRoles', 'requiredSkills', 'difficulty', 'milestones', 'prototypeEvidenceChecklist', 'testingDeploymentProofChecklist', 'ipReadinessPossibility', 'warnings'];
export function validateProjectOsCompatibility(payload = {}) {
  const issues = [];
  for (const key of PROJECT_OS_REQUIRED) {
    if (!(key in payload)) { issues.push(`Project OS payload missing field: ${key}`); continue; }
    const v = payload[key];
    if (key === 'warnings') continue; // may legitimately be empty
    if (Array.isArray(v) && !v.length) issues.push(`Project OS payload field is empty: ${key}`);
    if (typeof v === 'string' && !v.trim()) issues.push(`Project OS payload field is empty: ${key}`);
  }
  return { ok: issues.length === 0, issues };
}

/* ---- quality scoring (0–100 each) ---- */
export function computeQualityScores({ buildBrief = {}, projectBlueprint = {}, evidenceSummary = {}, classification = {} }) {
  const warnings = [];

  // Specificity: title + targets + problem depth + module concreteness.
  let specificity = 0;
  const title = buildBrief._meta?.title || '';
  specificity += isWeakTitle(title) ? 0 : 35;
  const targets = arr(buildBrief.targetUsers);
  specificity += targets.length && !targets.every((t) => /^(end )?users?$/i.test(t)) ? 25 : 0;
  specificity += String(buildBrief.problem || '').length >= 80 ? 20 : String(buildBrief.problem || '').length >= 40 ? 10 : 0;
  specificity += arr(buildBrief.keyModules).length >= 4 ? 20 : arr(buildBrief.keyModules).length >= 2 ? 10 : 0;
  if (specificity < 60) warnings.push('Idea specificity is below target — sharpen the title, target users or problem statement.');

  // Evidence grounding from the evidence summary meta.
  const meta = evidenceSummary._meta || {};
  let grounding = 0;
  if (meta.total > 0) grounding += clamp(meta.total * 8, 0, 40);
  grounding += (evidenceSummary.sourceCategoriesUsed || []).filter((c) => c !== 'community').length * 15;
  if (meta.communityOnly) { grounding = Math.min(grounding, 35); warnings.push('Evidence is community-only — confidence and IP-readiness are reduced.'); }
  if (!meta.total) warnings.push('No live evidence backs this idea — deterministic domain fallback was used.');
  grounding = clamp(grounding, 0, 100);

  // Blueprint uniqueness: penalize generic-marker overlap; reward domain profile use.
  const lines = [...arr(projectBlueprint.architecture), ...arr(projectBlueprint.milestones), ...arr(projectBlueprint.mvpScope)];
  const genericHits = lines.filter((l) => GENERIC_MARKER_LINES.has(String(l).replace(/^M\d+:\s*/, ''))).length;
  const genericRatio = lines.length ? genericHits / lines.length : 1;
  let uniqueness = clamp(Math.round((1 - genericRatio) * 100), 0, 100);
  if (classification.domain === 'generic') { uniqueness = Math.min(uniqueness, 40); warnings.push('No specific domain was detected — the blueprint uses the generic profile. Add domain detail to the query for a stronger plan.'); }

  // Technical depth: mechanism quality + architecture/data-model depth.
  const mechCheck = validateTechnicalMechanism({ technicalMechanism: buildBrief.technicalMechanism });
  let depth = mechCheck.ok ? 50 : 10;
  depth += clamp(arr(projectBlueprint.architecture).length * 6, 0, 24);
  depth += clamp(arr(projectBlueprint.databaseModels).length * 5, 0, 20);
  depth += arr(projectBlueprint.testingPlan).length >= 3 ? 6 : 0;
  depth = clamp(depth, 0, 100);
  if (!mechCheck.ok) warnings.push(...mechCheck.issues);

  return {
    specificityScore: clamp(specificity, 0, 100),
    evidenceGroundingScore: grounding,
    blueprintUniquenessScore: uniqueness,
    technicalDepthScore: depth,
    warnings,
  };
}

/* Run the full validator battery over a project package. */
export function validateProjectPackage(pkg = {}) {
  const checks = {
    specificity: validateIdeaSpecificity({ title: pkg.title, targetUsers: pkg.buildBrief?.targetUsers, problem: pkg.buildBrief?.problem }),
    blueprint: validateBlueprintQuality(pkg.projectBlueprint || {}),
    placeholders: validateNoPlaceholderText(pkg),
    mechanism: validateTechnicalMechanism({ technicalMechanism: pkg.buildBrief?.technicalMechanism }),
    projectOs: validateProjectOsCompatibility(pkg.projectOsPayload || {}),
  };
  const issues = Object.values(checks).flatMap((c) => c.issues);
  return { ok: issues.length === 0, issues, checks };
}

export default {
  PLACEHOLDER_PATTERNS,
  validateIdeaSpecificity,
  validateBlueprintQuality,
  validateNoPlaceholderText,
  validateTechnicalMechanism,
  validateProjectOsCompatibility,
  computeQualityScores,
  validateProjectPackage,
};
