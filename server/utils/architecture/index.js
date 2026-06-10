/* ============================================================
   ARCHITECTURE ENGINE v2 — ORCHESTRATOR
   ------------------------------------------------------------
   Project input
     -> requirement analyzer (patternMatcher.projectSignals)
     -> pattern matcher      (patternMatcher.matchPattern)
     -> cloud service mapper (serviceMapper)
     -> architecture spec builder (specBuilder.buildSpec)
     -> validator            (validator.validateSpec)
     -> renderer/export adapters (mermaidAdapter)

   Fully deterministic; no AI, DB or network required. The legacy
   engine (server/utils/architectureEngine.js) is untouched —
   this module is additive and the route layer returns both.
   ============================================================ */
import { matchPattern } from './patternMatcher.js';
import { buildSpec, TARGET_LEVELS } from './specBuilder.js';
import { validateSpec } from './validator.js';
import { specToMermaidViews, specToLegacyMermaid, viewToMermaid, viewToSvg } from './mermaidAdapter.js';
import { refineSpec, parseInstruction } from './refineEngine.js';
import { mappingRow, normalizeProvider } from './serviceMapper.js';
import { VIEW_TYPES, ARCHITECTURE_PATTERNS, CLOUD_SERVICES, CAPABILITY_CATALOG } from './knowledgeBase.js';

/* Generate the full architecture spec package for a project input. */
export function generateArchitectureSpec(input = {}, opts = {}) {
  const match = matchPattern(input);
  const spec = buildSpec(input, match, {
    cloudProvider: opts.cloudProvider || input.cloudProvider,
    targetLevel: TARGET_LEVELS.includes(opts.targetLevel || input.targetLevel) ? (opts.targetLevel || input.targetLevel) : 'production',
    diagramTypes: opts.diagramTypes || input.diagramTypes,
  });
  const validation = validateSpec(spec);
  spec.bestPracticeChecks = validation.checks;

  const implementationNotes = [
    `Pattern: ${spec.pattern.name} (confidence: ${spec.pattern.confidence}).`,
    ...((match.pattern.commonFlows || []).slice(0, 3).map((f) => `Core flow: ${f}`)),
    ...((match.pattern.commonAntiPatterns || []).slice(0, 2).map((a) => `Avoid: ${a}`)),
  ];

  return {
    architectureSpec: spec,
    mermaidViews: specToMermaidViews(spec),         // every view + legacy keys
    backwardCompatibleMermaid: specToLegacyMermaid(spec), // {component,dataFlow,deployment,security}
    validation,
    warnings: validation.warnings,
    recommendations: validation.recommendations,
    implementationNotes,
    serviceMappings: (spec.capabilities || []).filter((c) => CLOUD_SERVICES[c]).map(mappingRow),
  };
}

export {
  matchPattern, buildSpec, validateSpec, refineSpec, parseInstruction,
  specToMermaidViews, specToLegacyMermaid, viewToMermaid, viewToSvg,
  normalizeProvider, VIEW_TYPES, TARGET_LEVELS, ARCHITECTURE_PATTERNS, CAPABILITY_CATALOG,
};

export default { generateArchitectureSpec, refineSpec, validateSpec, viewToMermaid, viewToSvg };
