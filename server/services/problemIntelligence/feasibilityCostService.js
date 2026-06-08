/* ============================================================
   Service — MVP feasibility & cost
   ------------------------------------------------------------
   Realistic BANDS, never fake exact numbers. AI augments; the
   deterministic fallback already yields sensible India cost
   bands and difficulty. Normalizes the output shape.
   ============================================================ */
import { getAIProvider } from './ai/aiProvider.js';

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced', 'research-grade', 'startup-grade'];
const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

const DEFAULT_BANDS = {
  studentPrototype: '₹0–₹2,000',
  polishedDemo: '₹2,000–₹10,000',
  hardwareCloudHeavy: '₹10,000–₹50,000',
  startupGrade: '₹50,000+',
};

export async function estimateFeasibilityAndCost({ project }, cfg) {
  const ai = getAIProvider(cfg);
  const e = await ai.estimateFeasibilityAndCost({ project });
  const difficulty = DIFFICULTIES.includes(e.difficulty) ? e.difficulty : 'intermediate';
  const bands = e.indiaCostBands && typeof e.indiaCostBands === 'object' ? { ...DEFAULT_BANDS, ...e.indiaCostBands } : DEFAULT_BANDS;
  return {
    difficulty,
    teamSize: e.teamSize || '2–3',
    rolesRequired: arr(e.rolesRequired),
    mustHaveSkills: arr(e.mustHaveSkills).length ? arr(e.mustHaveSkills) : arr(project.requiredSkills),
    goodToHaveSkills: arr(e.goodToHaveSkills),
    resourcesRequired: arr(e.resourcesRequired),
    cloudApiHardwareNotes: e.cloudApiHardwareNotes || '',
    indiaCostBands: bands,
    timeline: e.timeline || '3–4 weeks',
    executionRisks: arr(e.executionRisks),
    mvpVsAdvanced: e.mvpVsAdvanced || '',
    shouldYouBuildVerdict: e.shouldYouBuildVerdict || '',
    confidence: e._ai?.confidence || 'low',
    aiProvider: e._ai?.provider || 'fallback',
  };
}

export default { estimateFeasibilityAndCost };
