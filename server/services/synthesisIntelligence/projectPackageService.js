/* ============================================================
   Synthesis Intelligence — project package orchestrator
   ------------------------------------------------------------
   buildProjectPackage() is the single entry point used by:
   - Career Intelligence (careerIntelligenceEngine)
   - Problem Intelligence project synthesis (projectSynthesisService)
   - Project OS conversion (problemIntelligenceRoutes)

   Pipeline (fully deterministic — works with no AI key):
     classify → evidence summary → build brief → blueprint
     → Project OS payload → quality scores → full validation
     → on failure: regenerate from the best fallback profile,
       lower confidence, surface warnings
     → optional Innovation-Memory augmentation (RAG layer).
   ============================================================ */
import { classifyIdeaContext } from './domainClassifier.js';
import { generateBuildBrief } from './buildBriefGenerator.js';
import { generateProjectBlueprint } from './blueprintGenerator.js';
import { buildEvidenceSummary } from './evidenceGroundingService.js';
import { buildProjectOsPayload } from './projectOsAdapter.js';
import { computeQualityScores, validateProjectPackage } from './qualityValidation.js';
import { retrieveIdeaMemory, applyMemoryToPackage } from './memoryAugmentation.js';
import { PLACEHOLDER_PATTERNS } from './qualityValidation.js';
import { sanitizeText } from '../problemIntelligence/util.js';

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

/* Drop any incoming idea field that contains placeholder text (TBD,
   lorem ipsum, [insert ...]) so weak AI output is regenerated from the
   domain profile instead of leaking through to the user. */
function scrubIdea(idea = {}) {
  const out = {};
  for (const [k, v] of Object.entries(idea)) {
    if (typeof v !== 'string') { out[k] = v; continue; }
    const hasPlaceholder = PLACEHOLDER_PATTERNS.some((p) => p.test(v));
    if (!hasPlaceholder) out[k] = v;
  }
  return out;
}

function assembleOnce({ classification, idea, evidence, evidenceStrength, skills, query, seedContext = null }) {
  const evidenceSummary = buildEvidenceSummary({ evidence, evidenceStrength, classification });
  const buildBrief = generateBuildBrief({ classification, idea, evidence: evidenceSummary, skills });
  const evidenceCitations = arr(evidence).slice(0, 3).map((e) => e.sourceName || e.platform || e.title).filter(Boolean);
  const projectBlueprint = generateProjectBlueprint({ classification, brief: buildBrief, evidenceCitations, query, seedContext });
  const title = buildBrief._meta.title;
  const quality = computeQualityScores({ buildBrief, projectBlueprint, evidenceSummary, classification });
  const projectOsPayload = buildProjectOsPayload({ title, classification, buildBrief, projectBlueprint, quality });
  return {
    title,
    summary: sanitizeText(buildBrief.overview, 400),
    buildBrief,
    projectBlueprint,
    evidenceSummary,
    quality,
    projectOsPayload,
    classification: {
      domain: classification.domain,
      subdomain: classification.subdomain,
      intent: classification.intent,
      projectType: classification.projectType,
      expectedPrototypeType: classification.expectedPrototypeType,
      difficulty: classification.difficulty,
      confidence: classification.classificationConfidence,
      ipAnalysisAppropriate: classification.ipAnalysisAppropriate,
    },
  };
}

/* Pick the strongest non-generic fallback profile when the first
   assembly fails validation: highest scoring alternative domain. */
function bestFallbackClassification(classification) {
  const scores = classification.allScores || {};
  const ranked = Object.entries(scores)
    .filter(([key]) => key !== classification.domain)
    .sort((a, b) => b[1] - a[1]);
  const nextKey = ranked.length && ranked[0][1] > 0 ? ranked[0][0] : classification.domain;
  return { ...classification, domain: nextKey === classification.domain ? 'generic' : nextKey };
}

export async function buildProjectPackage({
  query = '',
  idea = {},
  cluster = null,
  evidence = [],
  evidenceStrength = 0,
  skills = [],
  domain = '',
  technology = '',
  targetUser = '',
  difficulty = '',
  purpose = '',
  userId = null,
  email = '',
  collegeId = '',
  cfg = null,
  memoryCandidates = [],
  includeMemory = true,
  seedContext = null, // Phase 2: { userId, projectId, title } → deterministic per-project variation (opt-in)
} = {}) {
  const classification = classifyIdeaContext({
    query: query || idea.title || '',
    domain,
    technology,
    targetUser,
    cluster,
    evidence,
  });
  if (difficulty) classification.difficulty = difficulty;
  if (purpose === 'patent' || purpose === 'ip') classification.intent = 'patent_readiness';

  const cleanIdea = scrubIdea(idea);
  let pkg = assembleOnce({ classification, idea: cleanIdea, evidence, evidenceStrength, skills, query, seedContext });
  let validation = validateProjectPackage(pkg);

  if (!validation.ok) {
    // Regenerate from the best available fallback generator, then
    // lower confidence and keep both rounds of warnings visible.
    const retryClassification = bestFallbackClassification(classification);
    const retry = assembleOnce({ classification: retryClassification, idea: cleanIdea, evidence, evidenceStrength, skills, query, seedContext });
    const retryValidation = validateProjectPackage(retry);
    if (retryValidation.issues.length < validation.issues.length) {
      pkg = retry;
      validation = retryValidation;
    }
    if (!validation.ok) {
      pkg.quality.warnings = Array.from(new Set([
        ...arr(pkg.quality.warnings),
        'Output failed strict validation even after regeneration — confidence lowered; review before building.',
        ...validation.issues.slice(0, 4),
      ]));
      pkg.quality.specificityScore = Math.min(pkg.quality.specificityScore, 45);
      pkg.quality.technicalDepthScore = Math.min(pkg.quality.technicalDepthScore, 50);
      pkg.projectOsPayload.warnings = arr(pkg.quality.warnings).slice(0, 6);
    }
  }

  pkg.validation = { ok: validation.ok, issueCount: validation.issues.length };

  if (includeMemory) {
    try {
      const memory = await retrieveIdeaMemory({
        userId,
        email,
        collegeId,
        idea: { title: pkg.title, domain: pkg.classification.domain, technicalMechanism: pkg.buildBrief.technicalMechanism, tags: classification.keywords },
        cfg,
        fallbackCandidates: memoryCandidates,
      });
      pkg = applyMemoryToPackage(pkg, memory);
    } catch {
      // Memory layer is an enhancement — never let it break synthesis.
    }
  }

  return pkg;
}

export default { buildProjectPackage };
