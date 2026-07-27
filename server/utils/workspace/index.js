/* Guided Project Workspace — engine public surface. */
export { buildWorkspacePlan, recalculatePlan, applyTaskPatch, applyArchitecturePatch } from './workspaceBuilder.js';
export { normalizeCustomProject, derivePrimaryEntity, deriveFeatures } from './customProjectBuilder.js';
export { calculateProgress, currentPhase, nextBestAction, detectRisks } from './progressCalculator.js';
export { validateWorkspacePlan, runVerification } from './workspaceValidator.js';
export { STATUS_LANGUAGE, TASK_STATUSES } from './planUtils.js';
export { planGuide, planChecks } from './guidePlanner.js';
