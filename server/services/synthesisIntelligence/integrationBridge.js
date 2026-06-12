/* ============================================================
   Synthesis Intelligence — integration bridge
   ------------------------------------------------------------
   Shared conversion layer that makes the synthesis project
   package the standard intelligence payload across:
   - Career Intelligence  → Project OS  (/api/intelligence/create-project)
   - Career Intelligence  → Patent OS   (/api/intelligence/send-to-patent)
   - Standalone Patent OS (/api/patents/ideas/generate, strengthen,
     score, prior-art-plan)
   - Innovation OS bridges (convert-to-project / convert-to-patent)

   Principles:
   - Synthesis intelligence is the INPUT layer. Project OS keeps
     owning workspace generation; Patent OS keeps owning IP
     evaluation. The bridge only normalizes, enriches, and adapts.
   - Backward compatible: legacy ideas/blueprints without a
     projectPackage are enriched on the fly; missing pieces are
     filled with deterministic fallbacks plus explicit warnings —
     never crashes on old records.
   - Conservative IP language only (IP-readiness, prior-art risk,
     technical differentiation/effect, faculty/IP-cell review).
   Dependency-free beyond the synthesis layer itself; no AI, no DB.
   ============================================================ */
import { classifyIdeaContext } from './domainClassifier.js';
import { generateBuildBrief } from './buildBriefGenerator.js';
import { generateProjectBlueprint } from './blueprintGenerator.js';
import { buildEvidenceSummary } from './evidenceGroundingService.js';
import { buildProjectOsPayload } from './projectOsAdapter.js';
import { computeQualityScores } from './qualityValidation.js';
import { buildProjectPackage } from './projectPackageService.js';
import { sanitizeText } from '../problemIntelligence/util.js';

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const str = (v, max = 2000) => sanitizeText(String(v == null ? '' : v), max);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ---- extraction utilities -------------------------------------- */

/** Pull the best available technical mechanism from any payload shape
 *  (project package, build brief, patent idea, legacy idea). */
export function extractTechnicalMechanism(payload = {}) {
  const candidates = [
    payload?.buildBrief?.technicalMechanism,
    payload?.projectPackage?.buildBrief?.technicalMechanism,
    payload?.technicalMechanism,
    payload?.projectPackage?.projectOsPayload?.technicalMechanism,
    payload?.projectOsPayload?.technicalMechanism,
    payload?.noveltyAngle, // legacy ideas often carry the mechanism here
  ];
  for (const c of candidates) {
    const v = str(c, 600);
    if (v.trim().length >= 25) return v;
  }
  return '';
}

/** Summarize evidence confidence from a package or legacy idea.
 *  Returns { level: 'low'|'medium'|'high', communityOnly, total, groundingScore }. */
export function extractEvidenceConfidence(payload = {}) {
  const pkg = payload?.projectPackage || payload;
  const es = pkg?.evidenceSummary || payload?.evidenceSummary || null;
  if (es) {
    const meta = es._meta || {};
    const level = meta.confidenceLevel || (/high/i.test(str(es.confidenceImpact, 200)) ? 'high' : /medium/i.test(str(es.confidenceImpact, 200)) ? 'medium' : 'low');
    return {
      level,
      communityOnly: !!meta.communityOnly,
      total: Number(meta.total) || 0,
      groundingScore: Number(pkg?.quality?.evidenceGroundingScore ?? payload?.quality?.evidenceGroundingScore) || 0,
    };
  }
  // Legacy provenance fields (Innovation OS projects / patent ideas).
  const communityOnly = !!payload?.sourceMix?.communityOnly;
  const strength = Number(payload?.evidenceStrength) || 0;
  const total = Number(payload?.sourcesUsed) || 0;
  const level = total === 0 || communityOnly || strength < 25 ? 'low' : strength >= 50 ? 'high' : 'medium';
  return { level, communityOnly, total, groundingScore: strength };
}

/* ---- normalization / enrichment -------------------------------- */

function looksLikePackage(input) {
  return isObj(input) && (isObj(input.buildBrief) || isObj(input.projectBlueprint) || isObj(input.projectOsPayload));
}

/**
 * normalizeProjectPackage — take a possibly-partial project package
 * (e.g. from an older saved record or a client round-trip) and fill
 * every missing piece deterministically, recording a warning per gap.
 * Returns null when the input is not package-like at all.
 */
export function normalizeProjectPackage(input) {
  if (!looksLikePackage(input)) return null;
  const pkg = { ...input };
  const warnings = [];
  const title = str(pkg.title || pkg.buildBrief?._meta?.title || pkg.projectOsPayload?.title, 200) || 'Untitled project';

  // Re-derive a full classification for any regeneration we need.
  const classification = classifyIdeaContext({
    query: `${title} ${str(pkg.buildBrief?.problem, 200)}`.trim(),
    domain: pkg.classification?.domain || '',
  });
  if (pkg.classification?.difficulty) classification.difficulty = pkg.classification.difficulty;

  if (!isObj(pkg.evidenceSummary)) {
    pkg.evidenceSummary = buildEvidenceSummary({ evidence: [], evidenceStrength: 0, classification });
    warnings.push('No evidence summary was stored — a low-confidence summary was generated; validate sources before relying on this idea.');
  }
  if (!isObj(pkg.buildBrief)) {
    pkg.buildBrief = generateBuildBrief({ classification, idea: { title }, evidence: pkg.evidenceSummary, skills: [] });
    warnings.push('No build brief was stored — a deterministic brief was generated from the title and domain.');
  }
  if (!isObj(pkg.projectBlueprint)) {
    pkg.projectBlueprint = generateProjectBlueprint({ classification, brief: pkg.buildBrief, evidenceCitations: [], query: title });
    warnings.push('No project blueprint was stored — a domain-profile blueprint was generated.');
  }
  if (!extractTechnicalMechanism(pkg)) {
    pkg.buildBrief.technicalMechanism = pkg.buildBrief.technicalMechanism
      || str(`${classification.domainLabel} mechanism: see build brief — regenerate this idea for a concrete mechanism.`, 300);
    warnings.push('No technical mechanism was stored — IP-readiness and technical-depth confidence are reduced until one is defined.');
  }
  if (!isObj(pkg.quality)) {
    pkg.quality = computeQualityScores({ buildBrief: pkg.buildBrief, projectBlueprint: pkg.projectBlueprint, evidenceSummary: pkg.evidenceSummary, classification });
  }
  if (!isObj(pkg.projectOsPayload)) {
    pkg.projectOsPayload = buildProjectOsPayload({ title, classification, buildBrief: pkg.buildBrief, projectBlueprint: pkg.projectBlueprint, quality: pkg.quality });
    warnings.push('No Project OS payload was stored — one was generated via the adapter.');
  }

  pkg.title = title;
  pkg.summary = str(pkg.summary || pkg.buildBrief.overview, 400);
  pkg.classification = pkg.classification || {
    domain: classification.domain, subdomain: classification.subdomain, intent: classification.intent,
    projectType: classification.projectType, expectedPrototypeType: classification.expectedPrototypeType,
    difficulty: classification.difficulty, confidence: classification.classificationConfidence,
    ipAnalysisAppropriate: classification.ipAnalysisAppropriate,
  };
  if (warnings.length) {
    pkg.quality.warnings = Array.from(new Set([...arr(pkg.quality.warnings), ...warnings]));
    pkg.projectOsPayload.warnings = Array.from(new Set([...arr(pkg.projectOsPayload.warnings), ...warnings])).slice(0, 8);
  }
  return pkg;
}

/**
 * ensureProjectPackage — the single entry every route uses.
 * - If `input.projectPackage` exists → normalize it (fill gaps safely).
 * - Otherwise → enrich the legacy idea/blueprint through the synthesis
 *   layer (deterministic, AI-keyless).
 * Returns { pkg, source: 'provided' | 'enriched' }.
 * Never throws — on internal failure returns { pkg: null, source: 'unavailable' }.
 */
export async function ensureProjectPackage(input = {}, context = {}) {
  try {
    const provided = normalizeProjectPackage(input.projectPackage || (looksLikePackage(input) ? input : null));
    if (provided) return { pkg: provided, source: 'provided' };

    const idea = isObj(input.idea) ? input.idea : (isObj(input.patentIdea) ? input.patentIdea : {});
    const blueprint = isObj(input.blueprint) ? input.blueprint : {};
    const understanding = isObj(input.understanding) ? input.understanding : {};
    const query = str(
      input.query || idea.title || blueprint.title || `${idea.domain || understanding.domain || ''} ${idea.problem || idea.problemStatement || ''}`,
      300,
    ).trim() || 'general project idea';

    const pkg = await buildProjectPackage({
      query,
      idea: {
        title: idea.title || blueprint.title || '',
        painPoint: idea.problem || idea.problemStatement || blueprint.problemStatement || '',
        proposedSolution: idea.proposedSolution || '',
        noveltyAngle: idea.noveltyAngle || idea.technicalMechanism || '',
      },
      evidence: arr(input.evidence),
      evidenceStrength: Number(input.evidenceStrength) || 0,
      skills: arr(idea.skills || blueprint.techStack || idea.tags),
      domain: idea.domain || understanding.domain || context.domain || '',
      technology: idea.technology || context.technology || '',
      targetUser: str(idea.targetUser || idea.targetUsers || blueprint.targetUsers || understanding.targetUser, 120),
      difficulty: str(understanding.difficulty || idea.difficulty, 30).toLowerCase(),
      purpose: context.purpose || '',
      includeMemory: false,
    });
    return { pkg, source: 'enriched' };
  } catch {
    return { pkg: null, source: 'unavailable' };
  }
}

/* ---- legacy merge ----------------------------------------------- */

/** Fill empty fields of a legacy idea from a project package without
 *  overwriting anything the legacy record already has. */
export function mergeLegacyIdeaWithProjectPackage(legacyIdea = {}, pkg = null) {
  if (!pkg) return legacyIdea;
  const out = { ...legacyIdea };
  const fill = (key, value, max = 2000) => {
    if (!str(out[key], max).trim() && str(value, max).trim()) out[key] = str(value, max);
  };
  fill('title', pkg.title, 200);
  fill('problem', pkg.buildBrief?.problem);
  fill('problemStatement', pkg.buildBrief?.problem);
  fill('proposedSolution', pkg.buildBrief?.proposedSolution);
  fill('technicalMechanism', pkg.buildBrief?.technicalMechanism, 600);
  fill('noveltyAngle', pkg.buildBrief?.ipReadinessAngle, 600);
  fill('marketUseCase', arr(pkg.buildBrief?.targetUsers).join('; '), 300);
  fill('implementationPlan', arr(pkg.projectBlueprint?.mvpScope).join('; '));
  if (!arr(out.tags).length) out.tags = arr(pkg.projectOsPayload?.requiredSkills).slice(0, 8);
  out.projectPackage = pkg;
  return out;
}

/* ---- adapters ---------------------------------------------------- */

/**
 * toProjectOsWorkspacePayload — shape a project package into the input
 * the EXISTING Project OS pipeline expects (normalizeCustomProject →
 * buildWorkspacePlan), plus an `intelligence` provenance block. Legacy
 * values passed in `overrides` always win, preserving old behavior.
 */
export function toProjectOsWorkspacePayload(pkg, overrides = {}) {
  if (!pkg) return { ...overrides };
  const os = pkg.projectOsPayload || {};
  const bp = pkg.projectBlueprint || {};
  const brief = pkg.buildBrief || {};
  const base = {
    title: str(os.title || pkg.title, 140),
    problemStatement: str(os.problemStatement || brief.problem),
    targetUsers: arr(os.targetUsers).join('; ') || str(brief.targetUsers, 300),
    category: pkg.classification?.domain ? `${cap1(pkg.classification.domain)} app` : 'Web App',
    difficulty: cap1(str(os.difficulty || pkg.classification?.difficulty || 'intermediate', 30)),
    techStack: arr(bp.techStack).join(', '),
    mvpFeatures: arr(bp.mvpScope).join(', '),
    advancedFeatures: arr(bp.advancedScope).join(', '),
    flags: { patent: pkg.classification?.ipAnalysisAppropriate === true },
  };
  const merged = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    const empty = v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
    if (!empty) merged[k] = v;
  }
  merged.intelligence = {
    ...(isObj(overrides.intelligence) ? overrides.intelligence : {}),
    technicalMechanism: extractTechnicalMechanism(pkg),
    buildBrief: brief,
    milestones: arr(os.milestones),
    requiredRoles: arr(os.requiredRoles),
    requiredSkills: arr(os.requiredSkills),
    prototypeEvidenceChecklist: arr(os.prototypeEvidenceChecklist),
    testingDeploymentProofChecklist: arr(os.testingDeploymentProofChecklist),
    ipReadinessPossibility: str(os.ipReadinessPossibility, 500),
    quality: pkg.quality || null,
    evidenceConfidence: extractEvidenceConfidence(pkg),
    warnings: arr(os.warnings),
  };
  return merged;
}

/** Additive enrichment of a generated workspace plan — never replaces
 *  the workspace engine's own sections. */
export function enrichWorkspacePlanWithSynthesis(workspacePlan, pkg) {
  if (!workspacePlan || !pkg) return workspacePlan;
  const os = pkg.projectOsPayload || {};
  workspacePlan.synthesis = {
    summary: str(pkg.summary, 400),
    buildBrief: pkg.buildBrief || null,
    architectureLayers: arr(pkg.projectBlueprint?.architecture),
    modules: arr(pkg.buildBrief?.keyModules),
    skills: arr(os.requiredSkills),
    milestones: arr(os.milestones),
    testingPlan: arr(pkg.projectBlueprint?.testingPlan),
    deploymentPlan: arr(pkg.projectBlueprint?.deploymentPlan),
    proofChecklist: arr(os.prototypeEvidenceChecklist),
    ipReadinessNote: str(os.ipReadinessPossibility, 500),
    evidenceSummary: pkg.evidenceSummary || null,
    quality: pkg.quality || null,
    warnings: arr(os.warnings),
  };
  return workspacePlan;
}

/**
 * toPatentOsPayload — shape a project package into the Patent OS idea
 * record. Extends safely: every existing/legacy field passed in
 * `legacy` is preserved; the package only fills empty fields and adds
 * a `synthesis` block. Patent OS scoring stays the IP evaluator.
 */
export function toPatentOsPayload(pkg, legacy = {}) {
  const out = mergeLegacyIdeaWithProjectPackage({ ...legacy }, pkg);
  if (!pkg) return out;
  const bp = pkg.projectBlueprint || {};
  const brief = pkg.buildBrief || {};
  const confidence = extractEvidenceConfidence(pkg);

  // Patent-engine-friendly structured fields (only when empty).
  if (!str(out.inputData, 500).trim()) out.inputData = arr(brief.dataSources).join('; ').slice(0, 500);
  if (!str(out.processingLogic, 800).trim()) out.processingLogic = arr(bp.architecture).slice(0, 5).join(' → ').slice(0, 800);
  if (!str(out.outputResult, 400).trim()) out.outputResult = str(brief.expectedOutput, 400);
  if (!str(out.targetUser, 200).trim()) out.targetUser = arr(brief.targetUsers).join('; ').slice(0, 200);
  if (!str(out.domain, 60).trim()) out.domain = str(pkg.classification?.domain, 60);

  out.synthesis = {
    technicalMechanism: extractTechnicalMechanism(pkg),
    buildBrief: brief,
    projectBlueprint: {
      architecture: arr(bp.architecture), techStack: arr(bp.techStack), mvpScope: arr(bp.mvpScope),
      databaseModels: arr(bp.databaseModels), milestones: arr(bp.milestones), proofChecklist: arr(bp.proofChecklist),
    },
    evidenceSummary: pkg.evidenceSummary || null,
    quality: pkg.quality || null,
    projectOsPayload: pkg.projectOsPayload || null,
    evidenceConfidence: confidence,
    ipReadinessAngle: str(brief.ipReadinessAngle, 500),
    ipAnalysisAppropriate: pkg.classification?.ipAnalysisAppropriate !== false,
  };

  // Conservative risk surfacing — additive, never removes legacy warnings.
  const extraRisks = [];
  if (pkg.classification?.ipAnalysisAppropriate === false) {
    extraRisks.push('Domain is weak ground for IP (generic workflow/marketplace pattern) — treat as portfolio build unless a specific technical mechanism with technical effect is defined; needs faculty/IP-cell review.');
  }
  if (confidence.communityOnly) extraRisks.push('Evidence is community-only — prior-art risk and confidence are reduced until verified technical/research sources are added.');
  if (confidence.total === 0) extraRisks.push('No source evidence backs this idea yet — run a dedicated prior-art search before relying on IP-readiness.');
  out.riskWarnings = Array.from(new Set([...arr(out.riskWarnings), ...extraRisks])).slice(0, 8);
  return out;
}

export default {
  normalizeProjectPackage, ensureProjectPackage, mergeLegacyIdeaWithProjectPackage,
  toProjectOsWorkspacePayload, enrichWorkspacePlanWithSynthesis, toPatentOsPayload,
  extractTechnicalMechanism, extractEvidenceConfidence,
};
