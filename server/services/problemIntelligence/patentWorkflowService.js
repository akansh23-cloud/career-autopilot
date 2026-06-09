/* ============================================================
   Service — patent workflow planners (deterministic, safe)
   ------------------------------------------------------------
   Prior-art search plans, safe claim DIRECTIONS (never final legal
   claims), prototype evidence checklists, confidentiality/disclosure
   risk checks, diagram plans (Mermaid text, no image gen), and
   benchmark/experiment plans. AI augments prose where available;
   deterministic output is always produced.
   ============================================================ */
import { getAIProvider } from './ai/aiProvider.js';
import { validateIndiaCRI } from './indiaCriValidatorService.js';
import { extractKeywords, sanitizeText, lc } from './util.js';
import { INNOVATION_DISCLAIMER } from './config.js';

const arr = (v, n = 12) => (Array.isArray(v) ? v.filter(Boolean).map((x) => sanitizeText(String(x), 240)).slice(0, n) : []);

/* ---------------- Prior-art search plan ---------------- */
export function priorArtSearchPlan(project = {}) {
  const kw = topTerms(project);
  const phrase = kw.slice(0, 3).join(' ');
  const domain = project.domain || '';
  const combos = (a) => [
    `${a} method`, `${a} system`, `${a} apparatus`, `automatic ${a}`, `${a} ${domain}`.trim(),
  ];
  return {
    searchQueries: dedup(kw.slice(0, 4).flatMap(combos)).slice(0, 12),
    patentSearchQueries: dedup([
      `${phrase} method and system`, `${phrase} apparatus`, `${kw[0] || phrase} automatic detection`,
      `(${kw.slice(0, 2).join(' OR ')}) AND ${domain || 'system'}`,
    ]),
    paperSearchQueries: dedup([`${phrase} approach`, `${phrase} survey`, `${kw[0] || phrase} benchmark dataset`]),
    productSearchQueries: dedup([`${phrase} tool`, `${phrase} open source`, `best ${phrase} software`]),
    githubSearchQueries: dedup([`${phrase}`, `${kw[0] || ''} ${kw[1] || ''}`.trim(), `awesome ${kw[0] || phrase}`]),
    classificationHints: classificationHints(project),
    noveltyQuestions: [
      'Does any existing patent/product already combine these exact signals/steps the same way?',
      'What is the ONE step competitors do not do that yours does?',
      'Is the improvement technical (how) or just a new use (what)?',
      'Could a skilled engineer obviously arrive at this from known work?',
    ],
    redFlags: [
      'A popular open-source tool already does most of this.',
      'The "novelty" is only a different UI or a different market.',
      'The method is a well-known algorithm applied in the obvious way.',
    ],
    differentiationChecklist: [
      'Name the closest existing solution explicitly.',
      'State the specific technical difference (mechanism, not marketing).',
      'Quantify the improvement (speed/accuracy/cost) with a benchmark.',
      'Record search date, database, and query for each prior-art check.',
    ],
    disclaimer: 'External prior-art risk is UNKNOWN until you actually run these searches and record results.',
  };
}

function classificationHints(p) {
  const t = lc(`${p.title} ${p.proposedSolution} ${p.domain} ${p.technology}`);
  const hints = [];
  if (/data|database|index|search/.test(t)) hints.push('G06F 16 (information retrieval / databases)');
  if (/machine learning|ml|neural|model|classif/.test(t)) hints.push('G06N 20 / G06N 3 (machine learning / neural networks)');
  if (/network|protocol|deploy|server|cloud|devops/.test(t)) hints.push('H04L (network/communications)');
  if (/image|vision|camera/.test(t)) hints.push('G06T / G06V (image data / vision)');
  if (/sensor|iot|device|hardware/.test(t)) hints.push('G01 / H04Q (measuring / IoT)');
  if (/security|encrypt|auth/.test(t)) hints.push('H04L 9 / G06F 21 (security)');
  if (!hints.length) hints.push('G06F (general computing) — confirm with an examiner/agent.');
  hints.push('Treat CPC/IPC codes as GUESSES — verify on Espacenet/Google Patents.');
  return hints;
}

/* ---------------- Safe claim directions ---------------- */
export async function claimDirections({ project = {} }, cfg) {
  const cri = validateIndiaCRI(project);
  const det = {
    plainLanguageClaimIdea: sanitizeText(`A method/system that ${verb(project)} by ${mechanism(project)} — described in plain language, NOT as a legal claim.`, 400),
    possibleClaimElements: [
      'The specific input signals/data the system uses.',
      'The processing/correlation step that produces the result.',
      'The concrete technical effect achieved (the part that matters under Section 3(k)).',
      'The output/action presented to the user or system.',
    ],
    dependentDirections: [
      'Narrower variant tied to a specific domain/data source.',
      'Variant adding a feedback/learning loop.',
      'Variant specifying where computation runs (edge/device/server).',
    ],
    likelyNotClaimable: claimNots(cri),
    claimBreadthRisk: cri.section3kRisk === 'high' ? 'High — broad software/business-method claims are likely excluded in India.' : 'Medium — keep claims tied to the technical mechanism, not the business outcome.',
    designAroundRisk: 'Medium-to-high — if the novelty is one configurable step, competitors may design around it. Anchor on a genuinely hard technical step.',
    enforceabilityRisk: cri.flags.technicalEffect ? 'Moderate — easier to enforce when the technical effect is observable.' : 'High — hard to enforce without a concrete, detectable technical effect.',
    attorneyReviewNotes: [
      'Confirm subject-matter eligibility under Section 3(k) before drafting.',
      'Map each claim element to prototype evidence.',
      ...cri.improvementSuggestions.slice(0, 2),
    ],
  };
  const ai = getAIProvider(cfg);
  const { data } = await ai.freeformJSON(
    'You suggest PLAIN-LANGUAGE claim DIRECTIONS for an invention disclosure (NOT legal claims, NOT a filing). Be conservative and note what is likely not claimable. Shape: {"plainLanguageClaimIdea","possibleClaimElements":[],"dependentDirections":[],"likelyNotClaimable":[],"claimBreadthRisk","designAroundRisk","enforceabilityRisk","attorneyReviewNotes":[]}.',
    `Title: ${project.title}\nProblem: ${project.painPoint}\nMechanism/novelty: ${project.noveltyAngle}\nSolution: ${project.proposedSolution}\nSection 3(k) risk: ${cri.section3kRisk}`,
    1400,
  );
  const merged = data ? mergeClaim(det, data) : det;
  merged.section3kRisk = cri.section3kRisk;
  merged.disclaimer = 'This is not a legal patent claim. It is a claim-direction aid for IP-cell/patent-agent review.';
  return merged;
}

function claimNots(cri) {
  const out = ['The business model / pricing / market itself.', 'The idea in the abstract (an idea alone is not patentable).'];
  if (cri.flags.algorithmOnly) out.push('The mathematical algorithm in isolation, with no technical effect.');
  if (cri.flags.presentationOnly) out.push('The mere display/visual presentation of information.');
  return out;
}

/* ---------------- Prototype evidence checklist ---------------- */
export function evidenceChecklist(project = {}) {
  const cri = validateIndiaCRI(project);
  return {
    requiredEvidence: [
      'Public GitHub repo with a clear README and real commit history.',
      'A working demo (hosted link or a recorded video).',
      'At least 3 concrete example runs with inputs and outputs.',
    ],
    recommendedEvidence: [
      'Architecture diagram (see Diagram Plan).',
      'Automated tests for the core logic.',
      'Screenshots of the "demo moment".',
    ],
    benchmarkEvidence: [
      'Before/after metric (e.g., time-to-result manual vs. tool).',
      'A small results table across 3–5 scenarios.',
      cri.flags.technicalEffect ? 'Measurement of the claimed technical effect (latency/accuracy/etc.).' : 'Define a measurable technical effect to benchmark.',
    ],
    demoEvidence: ['90-second demo script.', 'A reproducible sample dataset/log.'],
    ipEvidence: [
      'Dated invention notes / lab notebook entries.',
      'Prior-art search records (queries + dates + findings).',
      'Documentation of the specific technical contribution.',
    ],
    recruiterEvidence: [
      'Public, polished README and live demo.',
      'Clear "skills proven" list and your specific contribution.',
      'A public-safe summary that omits confidential novelty detail.',
    ],
    missingCriticalEvidence: missingEvidence(project),
  };
}

function missingEvidence(p) {
  const out = [];
  if (!p.convertedProjectId && !p.linkedGithubRepoId) out.push('No linked repo/prototype yet — this caps IP-readiness at 75.');
  if (!(p.evidence || []).some?.((e) => e.type === 'benchmark')) out.push('No benchmark evidence yet — add a before/after metric.');
  return out;
}

/* Score contribution from attached evidence (used to lift the prototype cap). */
export function scoreEvidence(evidence = []) {
  let score = 0; const has = (t) => evidence.some((e) => e.type === t || e.source === t);
  if (has('github') || has('live_demo')) score += 35;
  if (evidence.some((e) => e.verified)) score += 20;
  if (has('benchmark')) score += 20;
  if (has('upload') || has('screenshot') || has('video')) score += 10;
  if (evidence.length >= 3) score += 15;
  const hasPrototype = has('github') || has('live_demo') || evidence.some((e) => e.verified);
  return { prototypeEvidenceScore: Math.min(100, score), hasPrototypeEvidence: hasPrototype };
}

/* ---------------- Confidentiality / disclosure risk ---------------- */
export function disclosureRiskCheck({ project = {}, action = 'make_public' } = {}) {
  const cri = validateIndiaCRI(project);
  const status = project.publicDisclosureStatus || 'unknown';
  const hasIPAngle = cri.flags.technicalEffect || (project.ipReadiness?.overall || 0) >= 45;
  let riskLevel = 'low';
  const warnings = [];

  if (hasIPAngle && ['make_public', 'publish_github', 'post_linkedin', 'share_disclosure'].includes(action)) {
    riskLevel = status === 'already_disclosed' ? 'high' : 'medium';
    warnings.push('This project may have a technical IP angle. Public disclosure BEFORE filing can jeopardise patentability in many jurisdictions.');
  }
  if (status === 'already_disclosed') { riskLevel = 'high'; warnings.push('Already publicly disclosed — the novelty grace period may be limited or gone. Consult the IP cell urgently.'); }
  if (action === 'export_recruiter') warnings.push('Recruiter-safe export must exclude confidential novelty/claim details.');

  return {
    riskLevel,
    warnings,
    safeToShareSummary: sanitizeText(`Problem solved: ${project.painPoint || project.title}. Approach and tech stack can be shared. Keep the specific technical novelty (${project.noveltyAngle ? 'the inventive mechanism' : 'any inventive mechanism'}) confidential until IP-cell review.`, 500),
    doNotShare: [
      'The specific inventive mechanism / claim directions.',
      'Unpublished benchmark numbers tied to the novelty.',
      'Any "this is patentable/novel" assertions.',
    ],
    recommendedNextSteps: [
      hasIPAngle ? 'Talk to the IP cell BEFORE any public disclosure.' : 'Low IP risk — a public portfolio version is fine.',
      'Set confidentialityStatus and publicDisclosureStatus explicitly on the project.',
      'Use the recruiter-safe summary for any public posting.',
    ],
    disclaimer: INNOVATION_DISCLAIMER,
  };
}

/* ---------------- Diagram plan (Mermaid text, no image gen) ---------------- */
export function diagramPlan(project = {}) {
  const title = sanitizeText(project.title || 'System', 60);
  const figures = [
    { figureNumber: 'Figure 1', title: 'Overall system architecture', purpose: 'Show the major components and how they connect.', components: ['Client/UI', 'API/Backend', 'Core engine', 'Data store', 'External sources'], flow: ['User → UI', 'UI → API', 'API → Core engine', 'Core engine → Data store', 'Core engine → Output'], notesForDrawing: 'Boxes for components, arrows for data flow; label each arrow.' },
    { figureNumber: 'Figure 2', title: 'Data / process flow', purpose: 'Show how an input becomes an output step-by-step.', components: ['Input', 'Preprocess', 'Process/Correlate', 'Decide', 'Output'], flow: ['Input', 'Preprocess', 'Process', 'Decide', 'Output'], notesForDrawing: 'Left-to-right flowchart; one box per step.' },
    { figureNumber: 'Figure 3', title: 'Core technical mechanism', purpose: 'Zoom into the novel step (the IP-relevant part).', components: ['Inputs', 'Mechanism', 'Result'], flow: ['Inputs → Mechanism → Result'], notesForDrawing: 'This is the figure an examiner cares about — make the novel step explicit.' },
    { figureNumber: 'Figure 4', title: 'User / device / server interaction', purpose: 'Sequence of interactions over time.', components: ['User', 'Device/Client', 'Server'], flow: ['User → Client → Server → Client → User'], notesForDrawing: 'Sequence diagram with lifelines.' },
    { figureNumber: 'Figure 5', title: 'Feedback / improvement loop', purpose: 'Show how results feed back to improve the system.', components: ['Result', 'Feedback', 'Update'], flow: ['Result → Feedback → Update → (back to) Process'], notesForDrawing: 'Cyclic arrows; show what is updated.' },
  ];
  return {
    figures,
    mermaidDiagrams: [
      `flowchart LR\n  U[User] --> UI[UI]\n  UI --> API[API]\n  API --> ENG[${title} Engine]\n  ENG --> DB[(Data Store)]\n  ENG --> OUT[Result + Next Step]`,
      'flowchart LR\n  IN[Input] --> PRE[Preprocess] --> PROC[Process/Correlate] --> DEC[Decide] --> OUT[Output]',
      'sequenceDiagram\n  participant U as User\n  participant C as Client\n  participant S as Server\n  U->>C: request\n  C->>S: signals\n  S-->>C: result + explanation\n  C-->>U: shows answer',
    ],
    diagramChecklist: [
      'Number every figure and reference it in the disclosure text.',
      'Make the novel step its own figure (Figure 3).',
      'Keep diagrams black-and-white and label every box/arrow.',
      'Export as SVG/PNG and attach as prototype evidence.',
    ],
  };
}

/* ---------------- Benchmark / experiment plan ---------------- */
export function experimentPlan(project = {}) {
  const cri = validateIndiaCRI(project);
  const metricGuess = /detect|diagnos|root.?cause|classif/.test(lc(`${project.title} ${project.proposedSolution}`))
    ? 'accuracy / time-to-result' : 'time-to-result / manual-effort reduction';
  return {
    baseline: sanitizeText(project.currentWorkaround || 'The current manual process users follow today.', 300),
    proposedMethod: sanitizeText(project.proposedSolution || 'Your automated approach.', 400),
    metrics: [metricGuess, 'success rate across scenarios', 'user effort (steps/clicks/minutes)'],
    testSetup: [
      'Pick 5–10 realistic scenarios (include 2 hard/edge cases).',
      'Run the baseline (manual) and record the metric.',
      'Run your tool on the same scenarios and record the metric.',
    ],
    sampleScenarios: sampleScenarios(project),
    resultTableTemplate: [
      { scenario: 'Scenario 1', baseline: '', proposed: '', improvement: '' },
      { scenario: 'Scenario 2', baseline: '', proposed: '', improvement: '' },
      { scenario: 'Scenario 3', baseline: '', proposed: '', improvement: '' },
    ],
    successCriteria: ['A clear, repeatable improvement on the main metric (e.g., ≥40–50%).', 'Works on at least one hard/edge scenario.'],
    ipEvidenceValue: cri.flags.technicalEffect
      ? 'A measured technical effect directly strengthens the Section 3(k) / inventive-step case.'
      : 'Use the benchmark to DEMONSTRATE a concrete technical effect, which is currently weak.',
    recruiterDemoValue: 'A before/after table is a strong, credible portfolio artifact for recruiters.',
  };
}

function sampleScenarios(p) {
  const u = p.targetUser || 'a typical user';
  return [
    `Typical case: ${u} hits the common version of the problem.`,
    `Hard case: an ambiguous or noisy input where the manual approach usually fails.`,
    `Edge case: missing/partial data — does the tool degrade gracefully?`,
  ];
}

/* ---------- helpers ---------- */
function topTerms(p) {
  const kw = extractKeywords(`${p.title} ${p.painPoint} ${p.proposedSolution} ${p.noveltyAngle} ${p.domain} ${p.technology}`, 10);
  return kw.length ? kw : ['system', 'method'];
}
function verb(p) {
  const t = lc(`${p.title} ${p.proposedSolution}`);
  if (/detect|diagnos|root.?cause/.test(t)) return 'identifies the likely cause of a problem from multiple signals';
  if (/recommend|match/.test(t)) return 'recommends the most relevant option from evidence';
  return 'produces a useful result from multiple input signals';
}
function mechanism(p) {
  return sanitizeText(p.noveltyAngle || 'a specific processing/correlation step', 200);
}
function dedup(a) { return [...new Set(a.map((s) => sanitizeText(s, 160)).filter(Boolean))]; }
function mergeClaim(det, data) {
  const s = (k) => (typeof data[k] === 'string' && data[k].trim() ? sanitizeText(data[k], 500) : det[k]);
  const l = (k) => (Array.isArray(data[k]) && data[k].length ? arr(data[k], 8) : det[k]);
  return {
    plainLanguageClaimIdea: s('plainLanguageClaimIdea'), possibleClaimElements: l('possibleClaimElements'),
    dependentDirections: l('dependentDirections'), likelyNotClaimable: l('likelyNotClaimable'),
    claimBreadthRisk: s('claimBreadthRisk'), designAroundRisk: s('designAroundRisk'),
    enforceabilityRisk: s('enforceabilityRisk'), attorneyReviewNotes: l('attorneyReviewNotes'),
  };
}

export default {
  priorArtSearchPlan, claimDirections, evidenceChecklist, scoreEvidence,
  disclosureRiskCheck, diagramPlan, experimentPlan,
};
