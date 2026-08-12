/* ============================================================
   MODE + DEPTH STRATEGY  (P1.5, P1.6)
   ------------------------------------------------------------
   Every property declared here is CONSUMED somewhere downstream.
   A strategy key that nothing reads is a lie told to the reader,
   so the rule for this file is: if you add a key, add the code
   that reads it in the same change, or do not add the key.

   The consumer map is documented per key so the next person can
   verify the claim by grep rather than by trust.

   Free vs premium is depth, never engine. Both run the same
   deterministic pipeline with the same truth rules; premium runs
   more of it.
   ============================================================ */

export const TAILORING_MODES_VERSION = 'tailoring-modes-v2';

/* Reranker weight profiles. Consumed by bulletScoring.rerankCandidates
   via canonicalTailoringService → narrativeEngine ctx.weights. */
const BASE_WEIGHTS = Object.freeze({
  jdRelevance: 20,
  specificity: 15,
  domainAuthenticity: 15,
  evidenceUtilisation: 15,
  naturalness: 10,
  seniorityConsistency: 10,
  atsSemantics: 10,
  diversity: 5,
});

function weights(overrides) {
  return Object.freeze({ ...BASE_WEIGHTS, ...overrides });
}

/**
 * MODES
 *
 * targetBulletLength          → contentStrategy budget + scoreConciseness target
 * prioritizeMatchedRequirements → reranker jdRelevance weight + intent preference
 * recomposeSummary            → narrativeEngine summary stage
 * intentPreference            → planSectionIntents(preferred)
 * rerankDepth                 → how many ranked candidates are retained per bullet
 * preferOutcomeLed            → composition family ordering (result-led families first)
 * projectFirst                → contentStrategy section weighting
 * preferCanonicalTerminology  → terminology alignment aggressiveness
 * ownershipBias               → how eagerly (still ceiling-bound) ownership verbs are used
 */
export const MODES = Object.freeze({
  balanced: Object.freeze({
    id: 'balanced',
    label: 'Balanced',
    targetBulletLength: 24,
    prioritizeMatchedRequirements: true,
    recomposeSummary: true,
    intentPreference: ['delivery', 'impact', 'scale'],
    rerankDepth: 4,
    preferOutcomeLed: false,
    projectFirst: false,
    preferCanonicalTerminology: true,
    ownershipBias: 0,
    weights: weights({}),
  }),

  'achievement-focus': Object.freeze({
    id: 'achievement-focus',
    label: 'Achievement focus',
    targetBulletLength: 26,
    prioritizeMatchedRequirements: true,
    recomposeSummary: true,
    /* Outcome-carrying intents first, so a bullet that HAS a supported
       result is written result-forward instead of task-forward. */
    intentPreference: ['impact', 'optimisation', 'scale', 'delivery'],
    rerankDepth: 5,
    preferOutcomeLed: true,
    projectFirst: false,
    preferCanonicalTerminology: true,
    ownershipBias: 0,
    weights: weights({ specificity: 20, evidenceUtilisation: 18, jdRelevance: 17, diversity: 4 }),
  }),

  'leadership-focus': Object.freeze({
    id: 'leadership-focus',
    label: 'Leadership focus',
    targetBulletLength: 26,
    prioritizeMatchedRequirements: true,
    recomposeSummary: true,
    intentPreference: ['ownership', 'collaboration', 'impact', 'delivery'],
    rerankDepth: 5,
    preferOutcomeLed: true,
    projectFirst: false,
    preferCanonicalTerminology: true,
    /* +1 nudge, still hard-capped by the evidence ownership ceiling.
       This can never move a bullet above what its evidence supports. */
    ownershipBias: 1,
    weights: weights({ seniorityConsistency: 14, domainAuthenticity: 16, diversity: 4, naturalness: 9 }),
  }),

  fresher: Object.freeze({
    id: 'fresher',
    label: 'Fresher / early career',
    targetBulletLength: 22,
    prioritizeMatchedRequirements: true,
    recomposeSummary: true,
    intentPreference: ['learning', 'delivery', 'collaboration'],
    rerankDepth: 4,
    preferOutcomeLed: false,
    /* Projects and coursework carry the resume when employment does not. */
    projectFirst: true,
    preferCanonicalTerminology: true,
    /* Negative bias: never let a student resume drift into ownership language. */
    ownershipBias: -1,
    weights: weights({ specificity: 18, domainAuthenticity: 17, seniorityConsistency: 14, jdRelevance: 16, diversity: 3 }),
  }),

  'ats-optimize': Object.freeze({
    id: 'ats-optimize',
    label: 'ATS optimise',
    targetBulletLength: 22,
    prioritizeMatchedRequirements: true,
    recomposeSummary: true,
    intentPreference: ['delivery', 'scale', 'impact'],
    rerankDepth: 5,
    preferOutcomeLed: false,
    projectFirst: false,
    preferCanonicalTerminology: true,
    weights: weights({ atsSemantics: 20, jdRelevance: 24, naturalness: 8, diversity: 3, domainAuthenticity: 12 }),
    ownershipBias: 0,
  }),

  concise: Object.freeze({
    id: 'concise',
    label: 'Concise',
    /* Materially shorter target, and conciseness is weighted into the
       reranker rather than merely declared. */
    targetBulletLength: 17,
    prioritizeMatchedRequirements: true,
    recomposeSummary: true,
    intentPreference: ['delivery', 'impact'],
    rerankDepth: 4,
    preferOutcomeLed: false,
    projectFirst: false,
    preferCanonicalTerminology: true,
    ownershipBias: 0,
    weights: weights({ conciseness: 18, jdRelevance: 18, specificity: 14, naturalness: 12, diversity: 3 }),
  }),
});

export const DEFAULT_MODE = 'balanced';

/**
 * DEPTHS
 *
 * alternativesPerBullet → bulletComposer candidate ceiling (real cap)
 * rerankKeep            → candidates retained after ranking
 * requirementDepth      → requirement statements analysed by the requirement graph
 * consistencyPasses     → repairDocument invocations
 * evidenceAnalysis      → 'standard' | 'expanded' cross-record relationship analysis
 * summaryCandidates     → summary structures attempted
 * maxUnits              → hard bound on bullets processed (performance ceiling)
 */
export const DEPTHS = Object.freeze({
  standard: Object.freeze({
    id: 'standard',
    label: 'Standard',
    alternativesPerBullet: 4,
    rerankKeep: 4,
    requirementDepth: 40,
    consistencyPasses: 1,
    evidenceAnalysis: 'standard',
    summaryCandidates: 4,
    maxUnits: 40,
  }),
  deep: Object.freeze({
    id: 'deep',
    label: 'Deep (premium)',
    alternativesPerBullet: 8,
    rerankKeep: 8,
    requirementDepth: 120,
    consistencyPasses: 2,
    evidenceAnalysis: 'expanded',
    summaryCandidates: 8,
    maxUnits: 60,
  }),
});

export const DEFAULT_DEPTH = 'standard';

/* Operations the canonical service exposes. Legacy routes map onto these;
   there is no second tailoring intelligence behind any of them. */
export const OPERATIONS = Object.freeze([
  'full-tailor',
  'enhance',
  'job-tailor',
  'selection-rerank',
  'bullet-assist',
  'summary-assist',
  'ats-optimize',
  'preview',
]);

/* Which engine mode ('enhance' vs 'tailor') each operation runs in, and
   whether a job description is required for it to be meaningful. */
export const OPERATION_SHAPE = Object.freeze({
  'full-tailor': { engineMode: 'tailor', requiresJd: true },
  'job-tailor': { engineMode: 'tailor', requiresJd: true },
  'ats-optimize': { engineMode: 'tailor', requiresJd: true },
  preview: { engineMode: 'tailor', requiresJd: false },
  'selection-rerank': { engineMode: 'tailor', requiresJd: false },
  enhance: { engineMode: 'enhance', requiresJd: false },
  'bullet-assist': { engineMode: 'enhance', requiresJd: false },
  'summary-assist': { engineMode: 'enhance', requiresJd: false },
});

export function resolveMode(mode) {
  const key = String(mode || '').trim() || DEFAULT_MODE;
  return MODES[key] || MODES[DEFAULT_MODE];
}

export function resolveDepth(depth) {
  const key = String(depth || '').trim() || DEFAULT_DEPTH;
  return DEPTHS[key] || DEPTHS[DEFAULT_DEPTH];
}

/**
 * Plans that are entitled to deep computation. This is the ONLY place plan
 * affects tailoring, and it affects depth of deterministic work — never
 * which engine runs.
 */
export function depthForPlan(plan, requested) {
  const premium = plan === 'premium' || plan === 'admin' || plan === 'pro';
  if (requested === 'deep') return premium ? DEPTHS.deep : DEPTHS.standard;
  return DEPTHS[DEFAULT_DEPTH];
}

export default {
  TAILORING_MODES_VERSION, MODES, DEPTHS, OPERATIONS, OPERATION_SHAPE,
  DEFAULT_MODE, DEFAULT_DEPTH, resolveMode, resolveDepth, depthForPlan,
};
