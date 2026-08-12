/* Canonical resume tailoring service — public surface.
   Import from here, never from the internals. */
export {
  CANONICAL_TAILORING_VERSION, TAILORING_QUOTA_BUCKET, TailoringRequestError,
  runTailoring, tailorForJob, enhanceResume, optimizeForAts, previewTailoring,
  assistBullet, assistSummary, rerankSelection,
} from './canonicalTailoringService.js';

export {
  AI_BOUNDARY_VERSION, AiCallInsideTailoringBoundaryError,
  runInsideTailoringBoundary, runOutsideTailoringBoundary,
  insideTailoringBoundary, currentBoundary, assertNoAiInsideBoundary,
  boundaryCounters, resetBoundaryCounters,
} from './aiBoundary.js';

export {
  TAILORING_MODES_VERSION, MODES, DEPTHS, OPERATIONS,
  resolveMode, resolveDepth, depthForPlan,
} from './modes.js';
