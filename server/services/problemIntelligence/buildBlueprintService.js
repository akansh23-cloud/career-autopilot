/* ============================================================
   Service — build blueprint
   ------------------------------------------------------------
   Produces a practical, start-tomorrow blueprint for a synth'd
   project. AI augments; deterministic fallback guarantees output.
   Always returns the full 16-section structure the spec requires.
   ============================================================ */
import { getAIProvider } from './ai/aiProvider.js';

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

export async function generateBuildBlueprint({ project }, cfg) {
  const ai = getAIProvider(cfg);
  const bp = await ai.generateBuildBlueprint({ project });
  return {
    productDefinition: bp.productDefinition || '',
    mvpScope: arr(bp.mvpScope).length ? arr(bp.mvpScope) : arr(project.mvpScope),
    outOfScope: arr(bp.outOfScope),
    featureBreakdown: arr(bp.featureBreakdown),
    frontendScreens: arr(bp.frontendScreens),
    backendApis: arr(bp.backendApis),
    databaseSchema: arr(bp.databaseSchema),
    systemArchitecture: bp.systemArchitecture || '',
    dataFlow: bp.dataFlow || '',
    coreAlgorithm: bp.coreAlgorithm || '',
    githubRepoStructure: arr(bp.githubRepoStructure),
    weeklyRoadmap: arr(bp.weeklyRoadmap),
    testPlan: arr(bp.testPlan),
    demoScript: bp.demoScript || '',
    deploymentPlan: bp.deploymentPlan || '',
    evidenceChecklist: arr(bp.evidenceChecklist),
    confidence: bp._ai?.confidence || 'low',
    aiProvider: bp._ai?.provider || 'fallback',
  };
}

export default { generateBuildBlueprint };
