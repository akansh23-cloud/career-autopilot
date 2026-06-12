/* ============================================================
   INVENTION DISCLOSURE GENERATOR + PATENT-TO-PROJECT CONVERTER
   ------------------------------------------------------------
   Both deterministic. Disclosure builds a structured invention-disclosure
   draft from a saved idea. The converter turns an idea into a buildable
   POC project plan (architecture, APIs, schema, demo, resume bullets).
   ============================================================ */
const DISCLAIMER = 'Patent OS produces a patent-readiness estimate for faculty/IP-cell triage — invention research and drafting assistance only. It is not legal advice and never an evaluation verdict. Patentability and filing decisions require a faculty mentor / institution IP cell and a qualified patent attorney.';
const lc = (s) => String(s || '').toLowerCase();
const fallback = (v, d) => (String(v || '').trim() ? v : d);

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

export function convertToProject(idea = {}) {
  const title = (idea.title || 'Invention POC').replace(/\b(engine|system|method)\b/i, '').trim();
  const domain = idea.domain || 'General';
  const tags = idea.tags || [];
  const aiInvolved = /ml|ai|llm|model|vision|nlp/.test(lc(`${idea.technicalMechanism} ${tags.join(' ')}`));
  return {
    projectTitle: `${title} — Proof of Concept`,
    mvpDescription: `A working MVP demonstrating the core mechanism of "${idea.title}": ${fallback(idea.proposedSolution, 'the invention')} — built to show reduction-to-practice and produce recruiter-visible proof.`,
    userPersonas: [idea.targetUser || 'primary user', 'evaluator/reviewer'],
    coreFeatures: [
      'Ingest sample multi-source data',
      'Run the core processing/scoring pipeline',
      'Display calibrated output with confidence',
      'Capture an outcome and show recalibration',
    ],
    technicalArchitecture: 'Modular monolith: API layer + processing service + datastore + feedback store. Stateless app behind a load balancer; add a queue only if processing is heavy.',
    frontendScreens: ['Input/upload screen', 'Results dashboard with confidence', 'Feedback capture', 'History/version view'],
    backendApis: ['POST /ingest', 'POST /score', 'GET /result/:id', 'POST /feedback', 'GET /history'],
    databaseSchema: ['sources(id, type, reliability)', 'events(id, source_id, payload, ts)', 'scores(id, subject, value, confidence, ts)', 'feedback(id, score_id, outcome, ts)'],
    aiComponents: aiInvolved ? ['Feature extraction', 'Scoring/fusion model', 'Calibration', 'Drift/anomaly detection'] : [],
    devopsPlan: 'Dockerized app, CI (lint+test+build), CD to a managed host, health checks, basic monitoring.',
    testPlan: ['Unit tests for scoring/fusion', 'Integration test for the ingest→score→feedback flow', 'A seeded demo dataset'],
    demoScript: `1) Load sample data → 2) Run scoring → 3) Show calibrated output + confidence → 4) Submit an outcome → 5) Show the weights/threshold recalibrate.`,
    evidenceChecklist: ['Public GitHub repo', 'Live demo or recorded walkthrough', 'README with architecture + results', 'A measured outcome'],
    resumeBullets: [
      `Built ${title} POC implementing a multi-source fusion + adaptive-feedback pipeline (${tags.slice(0, 3).join(', ') || 'modern stack'}).`,
      'Documented architecture and measurable results to provide recruiter-visible proof of work.',
    ],
    readmeOutline: ['Problem', 'Solution & mechanism', 'Architecture (diagram)', 'Setup', 'Demo', 'Results', 'Roadmap'],
    disclaimer: DISCLAIMER,
  };
}

export { DISCLAIMER as PATENT_OS_DISCLAIMER };
export default { generateDisclosure, convertToProject, PATENT_OS_DISCLAIMER: DISCLAIMER };
