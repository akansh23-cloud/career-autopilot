/* ============================================================
   Service — patent / project bridge
   ------------------------------------------------------------
   - assembleDisclosure(): builds the invention-disclosure package
     (AI-augmented, deterministic fallback) with the mandatory
     disclaimer and public-disclosure warning.
   - toProjectPayload(): shapes a GeneratedInnovationProject into
     a record the EXISTING project store can persist verbatim.
   - toPatentIdeaPayload(): shapes it for db.createPatentIdeas so
     it lands in the existing Patent OS, carrying source-backed
     problem, novelty angle, prior-art queries and readiness.
   ============================================================ */
import { getAIProvider } from './ai/aiProvider.js';
import { INNOVATION_DISCLAIMER } from './config.js';
import { sanitizeText } from './util.js';

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

export async function assembleDisclosure({ project, priorArtRecords = [] }, cfg) {
  const ai = getAIProvider(cfg);
  const d = await ai.generateDisclosure({ project });
  const priorArtComparison = priorArtRecords.length
    ? priorArtRecords.map((r) => `• ${r.title} — overlap: ${r.technicalOverlap || 'n/a'}; differentiator: ${r.differentiator || 'n/a'}; blocking risk: ${r.blockingRisk || 'Unknown'}`).join('\n')
    : 'No prior-art records added yet — external prior-art risk is UNKNOWN. Complete the Prior-Art Workspace before relying on this section.';
  return {
    title: sanitizeText(d.title || project.title, 200),
    technicalField: sanitizeText(d.technicalField, 600),
    background: sanitizeText(d.background || project.painPoint, 1200),
    problem: sanitizeText(d.problem || project.painPoint, 1200),
    existingLimitations: sanitizeText(d.existingLimitations || project.whyExistingSolutionsFail, 1200),
    proposedInvention: sanitizeText(d.proposedInvention || project.proposedSolution, 1500),
    systemComponents: arr(d.systemComponents),
    technicalWorkflow: sanitizeText(d.technicalWorkflow, 1200),
    novelTechnicalContribution: sanitizeText(d.novelTechnicalContribution || project.noveltyAngle, 800),
    advantages: arr(d.advantages),
    alternativeEmbodiments: arr(d.alternativeEmbodiments),
    prototypeEvidence: sanitizeText(d.prototypeEvidence, 800) || '[Link your repo, demo, and a measured result.]',
    priorArtComparison: sanitizeText(priorArtComparison, 2500),
    possibleClaimDirections: arr(d.possibleClaimDirections),
    drawingsChecklist: arr(d.drawingsChecklist),
    publicDisclosureWarning: sanitizeText(d.publicDisclosureWarning, 600) || 'Do NOT publicly disclose before IP-cell review — public disclosure can jeopardise patentability.',
    attorneyReviewNotes: sanitizeText(d.attorneyReviewNotes, 800),
    disclaimer: INNOVATION_DISCLAIMER,
    aiProvider: d._ai?.provider || 'fallback',
    confidence: d._ai?.confidence || 'low',
  };
}

/* Shape for the EXISTING project store (frontend persists via saveProject). */
export function toProjectPayload(project, blueprint = {}, cost = {}) {
  return {
    title: project.title,
    type: 'innovation',
    source: 'innovation-os',
    problem: project.painPoint,
    solution: project.proposedSolution,
    domain: project.domain,
    skills: project.requiredSkills || [],
    roadmap: blueprint.weeklyRoadmap || [],
    githubChecklist: blueprint.githubRepoStructure || [],
    demoChecklist: [blueprint.demoScript].filter(Boolean),
    evidenceChecklist: blueprint.evidenceChecklist || [],
    architecture: blueprint.systemArchitecture || '',
    costEstimate: cost.indiaCostBands || null,
    sourceCitations: project.sourceCitations || [],
    createdFrom: 'Innovation & Patent Intelligence OS',
  };
}

/* Shape for db.createPatentIdeas (existing Patent OS). */
export function toPatentIdeaPayload(project, ipReadiness = {}) {
  return {
    title: project.title,
    domain: project.domain || '',
    targetUser: project.targetUser || '',
    problem: project.painPoint || '',
    existingSolutions: project.whyExistingSolutionsFail || '',
    proposedSolution: project.proposedSolution || '',
    technicalMechanism: project.noveltyAngle || '',
    noveltyAngle: project.noveltyAngle || '',
    marketUseCase: project.affectedUsers || '',
    implementationPlan: (project.mvpScope || []).join('; '),
    tags: (project.requiredSkills || []).slice(0, 8),
    source: 'innovation-os',
    score: { overall: ipReadiness.overall || 0, grade: ipReadiness.label || '', riskLevel: ipReadiness.section3kWarning ? 'Section 3(k) risk' : 'See readiness' },
    riskWarnings: [ipReadiness.section3kWarning].filter(Boolean),
    strengtheningSuggestions: ipReadiness.requiredEvidenceToImprove || [],
  };
}

export default { assembleDisclosure, toProjectPayload, toPatentIdeaPayload };
