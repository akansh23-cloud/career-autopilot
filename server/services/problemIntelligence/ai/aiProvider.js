/* ============================================================
   AI provider — model-agnostic orchestrator
   ------------------------------------------------------------
   Exposes the 8-method interface the services consume:
     extractPainPoints, summarizeSignals, clusterProblems,
     synthesizeProject, generateBuildBlueprint,
     estimateFeasibilityAndCost, assessIPReadiness,
     generateDisclosure
   Picks the configured provider; if it has no key or the call
   fails / returns unparseable output, it transparently falls
   back to the deterministic provider and labels confidence
   accordingly. It NEVER throws and NEVER claims high confidence
   from a single generation.
   ============================================================ */
import { piConfig, resolveActiveProvider } from '../config.js';
import { parseLooseJSON } from '../util.js';
import { fallbackProvider } from './fallbackProvider.js';
import { createAnthropicClient } from './anthropicProvider.js';
import { createOpenAIClient } from './openaiProvider.js';
import { createGeminiClient } from './geminiProvider.js';

function buildClient(cfg) {
  switch (resolveActiveProvider(cfg)) {
    case 'anthropic': return createAnthropicClient(cfg);
    case 'openai':    return createOpenAIClient(cfg);
    case 'gemini':    return createGeminiClient(cfg);
    default:          return null; // fallback
  }
}

const JSON_RULE = 'Respond with ONLY valid minified JSON (no prose, no markdown fences). ';

/* Run an AI generation that must return JSON; on any failure return null so the
   caller can use the deterministic fallback. */
async function aiJSON(client, system, user, maxTokens) {
  if (!client || !client.available) return null;
  try {
    const text = await client.complete(JSON_RULE + system, user, maxTokens);
    const parsed = parseLooseJSON(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

export function getAIProvider(cfg = piConfig()) {
  const client = buildClient(cfg);
  const providerName = client?.available ? client.name : 'fallback';
  const stamp = (obj, ok) => ({ ...obj, _ai: { provider: ok ? providerName : 'fallback', confidence: ok ? 'medium' : 'low' } });

  return {
    providerName,
    usingFallback: providerName === 'fallback',

    async extractPainPoints(input) {
      const signals = (input.signals || []).slice(0, 14)
        .map((s, i) => `[${i}] ${s.title} :: ${String(s.contentSummary || '').slice(0, 240)}`).join('\n');
      const out = await aiJSON(client,
        'You extract concrete, specific pain points from developer/research discussion signals. Generalize across signals; do not copy any single signal verbatim. Shape: {"painPoints":["..."]}.',
        `Signals:\n${signals}\nReturn up to 10 distinct, concrete pain points.`, 800);
      if (out && Array.isArray(out.painPoints)) return stamp({ painPoints: out.painPoints.map(String).slice(0, 10) }, true);
      return fallbackProvider.extractPainPoints(input);
    },

    async summarizeSignals(input) {
      const signals = (input.signals || []).slice(0, 14).map((s) => s.title).join('; ');
      const out = await aiJSON(client,
        'Summarize the common theme across these signals in 2 sentences. Shape: {"summary":"..."}.',
        `Signals: ${signals}`, 400);
      if (out && typeof out.summary === 'string') return stamp({ summary: out.summary.slice(0, 600) }, true);
      return fallbackProvider.summarizeSignals(input);
    },

    async clusterProblems(input) {
      // Clustering is deterministic upstream; AI only labels/titles if asked.
      return fallbackProvider.clusterProblems(input);
    },

    async synthesizeProject(input) {
      const c = input.cluster || {};
      const out = await aiJSON(client,
        'You convert a source-backed problem cluster into ONE concrete, buildable student/startup project. Generalize from the evidence; never clone one repo feature. Be specific and student-friendly. Shape: {"title","painPoint","affectedUsers","currentWorkaround","whyExistingSolutionsFail","whyNow","proposedSolution","noveltyAngle","mvpScope":["..."],"requiredSkills":["..."],"noveltyConfidence":"low|medium"}.',
        `Cluster: ${c.title}\nSummary: ${c.summary}\nDomain: ${c.domain}\nTarget user: ${c.targetUser}\nTechnology: ${c.technology}\nKeywords: ${(c.keywords || []).join(', ')}\nEvidence signals: ${c.signalCount || 0}\nStudent skills: ${(input.skills || []).join(', ') || 'unspecified'}\nPurpose: ${input.purpose || 'portfolio'}`,
        2200);
      if (out && out.title && out.proposedSolution) {
        return stamp({
          title: String(out.title).slice(0, 140),
          painPoint: String(out.painPoint || c.summary || '').slice(0, 900),
          affectedUsers: String(out.affectedUsers || '').slice(0, 300),
          currentWorkaround: String(out.currentWorkaround || '').slice(0, 600),
          whyExistingSolutionsFail: String(out.whyExistingSolutionsFail || '').slice(0, 600),
          whyNow: String(out.whyNow || '').slice(0, 400),
          proposedSolution: String(out.proposedSolution || '').slice(0, 1200),
          noveltyAngle: String(out.noveltyAngle || '').slice(0, 500),
          mvpScope: Array.isArray(out.mvpScope) ? out.mvpScope.map(String).slice(0, 8) : [],
          requiredSkills: Array.isArray(out.requiredSkills) ? out.requiredSkills.map(String).slice(0, 10) : [],
          noveltyConfidence: out.noveltyConfidence === 'medium' ? 'medium' : 'low',
          purpose: input.purpose || 'portfolio',
        }, true);
      }
      return fallbackProvider.synthesizeProject(input);
    },

    async generateBuildBlueprint(input) {
      const p = input.project || {};
      const out = await aiJSON(client,
        'You write a practical build blueprint a student/team can start from. Shape: {"productDefinition","mvpScope":[],"outOfScope":[],"featureBreakdown":[],"frontendScreens":[],"backendApis":[],"databaseSchema":[],"systemArchitecture","dataFlow","coreAlgorithm","githubRepoStructure":[],"weeklyRoadmap":[],"testPlan":[],"demoScript","deploymentPlan","evidenceChecklist":[]}.',
        `Project: ${p.title}\nProblem: ${p.painPoint}\nSolution: ${p.proposedSolution}\nSkills: ${(p.requiredSkills || []).join(', ')}`,
        2600);
      if (out && (out.systemArchitecture || out.mvpScope)) return stamp(normalizeBlueprint(out), true);
      return fallbackProvider.generateBuildBlueprint(input);
    },

    async estimateFeasibilityAndCost(input) {
      const p = input.project || {};
      const out = await aiJSON(client,
        'Estimate MVP feasibility & cost for an Indian student/team. Use realistic BANDS, never fake exact numbers. Shape: {"difficulty":"beginner|intermediate|advanced|research-grade|startup-grade","teamSize","rolesRequired":[],"mustHaveSkills":[],"goodToHaveSkills":[],"resourcesRequired":[],"cloudApiHardwareNotes","indiaCostBands":{"studentPrototype","polishedDemo","hardwareCloudHeavy","startupGrade"},"timeline","executionRisks":[],"mvpVsAdvanced","shouldYouBuildVerdict"}.',
        `Project: ${p.title}\nSolution: ${p.proposedSolution}\nSkills required: ${(p.requiredSkills || []).join(', ')}\nPurpose: ${p.purpose || 'portfolio'}`,
        1600);
      if (out && out.difficulty && out.indiaCostBands) return stamp(out, true);
      return fallbackProvider.estimateFeasibilityAndCost(input);
    },

    async assessIPReadiness(input) {
      // Scores are computed deterministically (backend-owned). AI adds narrative.
      const p = input.project || {};
      const out = await aiJSON(client,
        'Write a short, neutral technical-contribution narrative for an invention disclosure. Do NOT assign a numeric patent score and do NOT claim a patent is likely. Shape: {"narrative":"..."}.',
        `Title: ${p.title}\nProblem: ${p.painPoint}\nNovelty angle: ${p.noveltyAngle}\nSolution: ${p.proposedSolution}`,
        700);
      if (out && typeof out.narrative === 'string') return stamp({ narrative: out.narrative.slice(0, 1200) }, true);
      return fallbackProvider.assessIPReadiness(input);
    },

    async generateDisclosure(input) {
      const p = input.project || {};
      const out = await aiJSON(client,
        'Draft an INVENTION DISCLOSURE (not a filing). Neutral, factual. Shape: {"title","technicalField","background","problem","existingLimitations","proposedInvention","systemComponents":[],"technicalWorkflow","novelTechnicalContribution","advantages":[],"alternativeEmbodiments":[],"prototypeEvidence","priorArtComparison","possibleClaimDirections":[],"drawingsChecklist":[],"publicDisclosureWarning","attorneyReviewNotes"}.',
        `Title: ${p.title}\nProblem: ${p.painPoint}\nSolution: ${p.proposedSolution}\nNovelty: ${p.noveltyAngle}\nArchitecture: ${p.buildBlueprint?.systemArchitecture || ''}`,
        2400);
      if (out && out.title && out.proposedInvention) return stamp(out, true);
      return fallbackProvider.generateDisclosure(input);
    },
  };
}

function normalizeBlueprint(o) {
  const arr = (v) => (Array.isArray(v) ? v.map(String).slice(0, 20) : []);
  return {
    productDefinition: String(o.productDefinition || '').slice(0, 800),
    mvpScope: arr(o.mvpScope), outOfScope: arr(o.outOfScope), featureBreakdown: arr(o.featureBreakdown),
    frontendScreens: arr(o.frontendScreens), backendApis: arr(o.backendApis), databaseSchema: arr(o.databaseSchema),
    systemArchitecture: String(o.systemArchitecture || '').slice(0, 800), dataFlow: String(o.dataFlow || '').slice(0, 600),
    coreAlgorithm: String(o.coreAlgorithm || '').slice(0, 900), githubRepoStructure: arr(o.githubRepoStructure),
    weeklyRoadmap: arr(o.weeklyRoadmap), testPlan: arr(o.testPlan), demoScript: String(o.demoScript || '').slice(0, 900),
    deploymentPlan: String(o.deploymentPlan || '').slice(0, 600), evidenceChecklist: arr(o.evidenceChecklist),
  };
}

export default { getAIProvider };
