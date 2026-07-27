/* ============================================================
   INVENTION DISCLOSURE GENERATOR + PATENT-TO-PROJECT CONVERTER
   ------------------------------------------------------------
   Disclosure builds a structured invention-disclosure draft from a
   saved idea (deterministic).

   The converter turns an idea into a buildable POC plan. It used to
   emit ONE hard-coded template for every idea: the same four core
   features, the same "modular monolith", the same POST /ingest APIs
   and the same MongoDB-shaped schema, whether the invention was a
   web tool, a sensor rig or a lab process. It also shipped no
   explanation at all, so the workspace showed artifacts with no
   answer to "what am I building?".

   It now derives the plan from the idea's own DISCIPLINE and attaches
   a project brief written by the configured AI provider (Gemini /
   Anthropic / OpenAI), falling back to a complete deterministic brief
   when no key is set. Software scaffolding (screens/APIs/schema) is
   emitted only when the project actually has a software component.
   ============================================================ */
import { buildProjectBrief } from '../services/projectBrief/projectBriefService.js';
import { detectDiscipline, hasSoftwareComponent } from '../services/projectBrief/disciplineProfiles.js';
const DISCLAIMER = 'Patent OS provides invention research and drafting assistance only. It is not legal advice. Patentability and filing decisions should be reviewed by a qualified patent attorney.';
const lc = (s) => String(s || '').toLowerCase();
const fallback = (...vals) => vals.find((v) => String(v || '').trim()) || '';

export function generateDisclosure(idea = {}) {
  const title = idea.title || 'Untitled invention';
  const domain = idea.domain || 'the relevant technical field';
  return {
    title,
    field: `Systems and methods in ${domain}, particularly ${fallback(idea.tags?.join(', '), 'data processing and automation')}.`,
    background: fallback(idea.existingSolutions, `Existing approaches in ${domain} address parts of the problem but lack an integrated technical mechanism.`),
    problemStatement: fallback(idea.problem, 'A specific technical problem that current systems do not adequately solve.'),
    existingLimitations: [
      'Existing tools handle relevant signals in isolation.',
      'No adaptive feedback to improve results from outcomes.',
      'Limited measurable technical advantage over manual processes.',
    ],
    summary: fallback(idea.proposedSolution, `A system that solves the problem in ${domain} via a concrete technical mechanism.`),
    systemComponents: [
      'Ingestion layer (multi-source signal collection)',
      'Normalization & reliability-weighting module',
      'Core processing engine (fusion / scoring / detection)',
      'Calibration & confidence module',
      'Output/decision service',
      'Feedback & recalibration store',
    ],
    workflow: fallback(idea.processingLogic, 'Ingest → normalize → reliability-weight → fuse/score → calibrate → emit → capture outcomes → recalibrate.'),
    inputData: fallback(idea.inputData, 'Multiple domain-relevant signals/records.'),
    processingLogic: fallback(idea.processingLogic, 'Weighted fusion through an adaptive pipeline with anomaly detection.'),
    outputResult: fallback(idea.outputResult, 'A calibrated decision/score with a confidence value.'),
    feedbackLoop: fallback(idea.feedbackLoop, 'Downstream outcomes recalibrate source weights and thresholds over time.'),
    embodiments: [
      'A cloud-hosted embodiment exposing a scoring API.',
      'An edge/on-device embodiment for privacy and low latency.',
    ],
    alternatives: [
      'Alternative weighting schemes (Bayesian, learned, rule-based).',
      'Alternative deployment (batch vs real-time streaming).',
    ],
    advantages: [
      'Integrates signals existing systems treat separately.',
      'Improves accuracy over time via outcome feedback.',
      'Provides a measurable, calibrated confidence output.',
    ],
    priorArtDistinction: fallback(idea.noveltyAngle, 'Distinguished by the specific combination of multi-source fusion and outcome-driven adaptive weighting.'),
    claimDirections: [
      `A method comprising ingesting multiple ${lc(domain)} signals, reliability-weighting and fusing them via an adaptive pipeline, emitting a calibrated output, and recalibrating weights from downstream outcomes.`,
      'A system comprising the components above configured to perform the method.',
      'A non-transitory computer-readable medium storing instructions to perform the method.',
    ],
    drawingSuggestions: [
      'FIG. 1 — system architecture / component diagram',
      'FIG. 2 — data flow diagram',
      'FIG. 3 — feedback/recalibration loop',
      'FIG. 4 — example output with confidence',
    ],
    pocNotes: fallback(idea.implementationPlan, 'Build a minimal pipeline + scoring API + feedback store to demonstrate reduction-to-practice.'),
    attorneyNotes: 'Attorney review recommended: confirm novelty against prior art, refine independent claims, and assess subject-matter eligibility.',
    disclaimer: DISCLAIMER,
  };
}

/* ---------------- discipline-shaped POC plan ---------------- */

const SOFTWARE_SCAFFOLD = (E) => ({
  frontendScreens: [`${E} input / capture screen`, 'Results view with confidence', 'Feedback capture', 'History / version view'],
  backendApis: ['POST /ingest', 'POST /process', 'GET /result/:id', 'POST /feedback', 'GET /history'],
  databaseSchema: ['sources(id, type, reliability)', 'events(id, source_id, payload, ts)', 'results(id, subject, value, confidence, ts)', 'feedback(id, result_id, outcome, ts)'],
  devopsPlan: 'Dockerized app, CI (lint + test + build), CD to a managed host, health checks, basic monitoring.',
});

/* Deliverables that are NOT screens/APIs — one shape per discipline, so a
   hardware or lab invention stops being described as a web app. */
const DISCIPLINE_DELIVERABLES = {
  hardware: {
    workProducts: ['Bill of materials with supplier links and prices', 'Wiring / schematic diagram', 'Firmware repo with the read loop', 'Logged readings vs a reference instrument', 'Bench photos and a run video'],
    buildSteps: ['Write the BOM and confirm every part is actually available', 'Breadboard the sensing path and get one reading on serial', 'Add logging and capture ten minutes of data', 'Calibrate against a reference and record the error', 'Mount it so it survives being carried to a demo'],
    testPlan: ['Repeat the same measurement 10 times and report mean + spread', 'Power-cycle test: does it recover cleanly?', 'Run at the edges of the intended operating range'],
  },
  data_ml: {
    workProducts: ['Dataset card with licence and provenance', 'Reproducible training script or notebook', 'Metric table vs a stated baseline', 'Error analysis of the 20 worst predictions', 'Model card listing known failure modes'],
    buildSteps: ['Acquire and licence-check a real dataset', 'Freeze the test split before doing anything else', 'Establish and record a dumb baseline', 'Build the feature pipeline and train the real model', 'Run error analysis and write down where it fails'],
    testPlan: ['Held-out test set touched exactly once', 'Comparison against the recorded baseline', 'Sensitivity check on the two most important features'],
  },
  mechanical: {
    workProducts: ['Requirement sheet with loads, tolerances and materials', 'CAD model and dimensioned drawings', 'Hand calculations plus FEA output', 'Fabricated prototype photos', 'Test-rig results against the requirement sheet'],
    buildSteps: ['Write the requirement sheet in numbers', 'Sketch three concepts and justify the chosen one', 'CAD the critical part only', 'Hand-calculate the governing stress before simulating', 'Fabricate and test to failure or to the rated load'],
    testPlan: ['Physical load / motion test against the requirement numbers', 'Dimensional check of the fabricated part against the drawing', 'Failure analysis if it broke early'],
  },
  bio_chem: {
    workProducts: ['Testable hypothesis statement', 'Versioned written protocol', 'Positive and negative control results', 'Raw data plus the analysis script', 'Safety / ethics approval reference'],
    buildSteps: ['State the hypothesis with a measurable outcome', 'Get supervisor and safety sign-off in writing', 'Write the protocol including controls', 'Dry-run with a blank to catch procedural mistakes', 'Run in triplicate and analyse variance'],
    testPlan: ['Three independent replicates', 'Controls reported alongside every result', 'Variance and confidence interval stated, not just the mean'],
  },
  civil_infra: {
    workProducts: ['Real site or survey data', 'Dimensioned drawings with a title block', 'Code-compliance sheet citing clauses', 'Analysis output with load cases', 'Quantity and cost estimate'],
    buildSteps: ['Collect real site data', 'List the governing codes and clauses', 'Produce the preliminary layout and load assumptions', 'Run the governing check by hand, then model it', 'Detail the drawings and estimate quantities'],
    testPlan: ['Every governing check cites its clause and shows the margin', 'Load-case coverage review', 'Quantity take-off cross-checked against the drawing'],
  },
  business_ops: {
    workProducts: ['Interview notes with verbatim quotes', 'Current-process map with real timings', 'Redesigned process map', 'Pilot results with sample size', 'Cost model showing the saving'],
    buildSteps: ['Interview five people who have the problem', 'Map the current process with measured timings', 'Identify the single costliest step', 'Design the smallest intervention that moves that number', 'Run a real pilot and measure before/after'],
    testPlan: ['Before/after measurement on a real pilot', 'Stated sample size and time window', 'A control group or period where practical'],
  },
};

/**
 * convertToProject(idea, opts) → Promise<plan>
 *
 * ASYNC as of the brief upgrade: it awaits the AI-written project brief.
 * Never throws and never blocks indefinitely — the brief service falls
 * back to a complete deterministic brief when no provider is configured.
 */
export async function convertToProject(idea = {}, opts = {}) {
  const plan = convertToProjectDeterministic(idea);
  try {
    plan.brief = await buildProjectBrief({ project: idea, audience: opts.audience || 'student' }, opts.cfg);
  } catch {
    plan.brief = null;
  }
  return plan;
}

/** Synchronous, AI-free version — used by tests and as the base of the async one. */
export function convertToProjectDeterministic(idea = {}) {
  const title = (idea.title || 'Invention POC').replace(/\b(engine|system|method)\b/i, '').trim();
  const tags = idea.tags || [];
  const aiInvolved = /ml|ai|llm|model|vision|nlp/.test(lc(`${idea.technicalMechanism} ${tags.join(' ')}`));
  const discipline = detectDiscipline(idea);
  const software = hasSoftwareComponent(discipline, idea);
  const E = idea.targetUser ? 'Record' : 'Item';
  const shaped = DISCIPLINE_DELIVERABLES[discipline.id] || null;
  const scaffold = software ? SOFTWARE_SCAFFOLD(E) : {};

  const coreFeatures = shaped
    ? shaped.buildSteps.slice(0, 5)
    : [
      `Capture the real input this invention needs (${fallback(idea.inputData, 'the source data or signal')})`,
      `Run the core mechanism: ${fallback(idea.technicalMechanism, idea.processingLogic, 'the processing step that makes this novel')}`,
      `Produce the output a user acts on (${fallback(idea.outputResult, 'the result, with a confidence indication')})`,
      'Capture one real outcome and show what changes as a result',
    ];

  return {
    projectTitle: `${title} — Proof of Concept`,
    discipline: discipline.id,
    disciplineLabel: discipline.label,
    disciplineConfidence: discipline.confidence,
    hasSoftwareComponent: software,

    mvpDescription: `A working proof of concept for "${idea.title}": ${fallback(idea.proposedSolution, 'the invention')} — built to demonstrate reduction-to-practice and produce evidence someone else can check.`,
    whatYouAreBuilding: `This is a ${discipline.label.toLowerCase()} project. ${software ? 'It has a software component, so some of it is code.' : 'It is NOT a web app — ignore any generic "run npm" style instructions.'} The thing that has to exist at the end is: ${discipline.runMeans}.`,
    userPersonas: [idea.targetUser || 'primary user', 'evaluator / reviewer'],
    coreFeatures,

    technicalArchitecture: software
      ? 'Modular monolith: API layer + processing service + datastore + feedback store. Stateless app behind a load balancer; add a queue only if processing is heavy.'
      : `${discipline.label} build: ${(shaped?.buildSteps || []).slice(0, 3).join(' → ') || 'input → core mechanism → measured output'}. Keep the chain short enough that one person can run it end to end.`,

    workProducts: shaped ? shaped.workProducts : ['Repo with real commit history', 'Live demo or recorded walkthrough', 'README with architecture and results'],
    buildSteps: shaped ? shaped.buildSteps : coreFeatures,
    toolchain: discipline.toolchain,

    ...scaffold,
    aiComponents: aiInvolved ? ['Feature extraction', 'Scoring / fusion model', 'Calibration', 'Drift / anomaly detection'] : [],

    testPlan: shaped ? shaped.testPlan : ['Unit tests for the core logic', 'Integration test for the full input→output flow', 'A seeded demo dataset'],
    howYouKnowItWorks: discipline.validation,
    costReality: discipline.costNote,

    demoScript: software
      ? '1) Load sample data → 2) Run the core mechanism → 3) Show the output + confidence → 4) Submit a real outcome → 5) Show what recalibrates.'
      : `1) Show the starting condition → 2) Run ${title} → 3) Show the measured result → 4) Compare it against ${discipline.id === 'data_ml' ? 'the baseline' : 'a reference or the requirement'} → 5) State the margin honestly.`,

    evidenceChecklist: discipline.proofArtifacts,
    resumeBullets: [
      `Built a ${discipline.label.toLowerCase()} proof of concept for ${title}, demonstrating ${fallback(idea.technicalMechanism, 'the core mechanism')} end to end.`,
      `Validated it by ${lc(discipline.validation).replace(/\.$/, '')}, and documented the result for review.`,
    ],
    readmeOutline: ['Problem', 'Solution & mechanism', software ? 'Architecture (diagram)' : 'Method & setup', 'How to reproduce', 'Results & margin', 'Limitations', 'Roadmap'],
    disclaimer: DISCLAIMER,
  };
}

export { DISCLAIMER as PATENT_OS_DISCLAIMER };
export default { generateDisclosure, convertToProject, convertToProjectDeterministic, PATENT_OS_DISCLAIMER: DISCLAIMER };
