/* ============================================================
   IDEA GENERATION ENGINE  (deterministic fallback + AI-ready)
   ------------------------------------------------------------
   Generates patent-style invention ideas from a domain/problem/tech/goal.
   The deterministic path composes a CONCRETE TECHNICAL MECHANISM (never a
   bare "AI app for X"). The route may instead use an AI path; both produce
   the same idea shape, which then flows through patentScoringEngine.
   ============================================================ */
import { scorePatentIdea } from './patentScoringEngine.js';

export const IDEA_GEN_VERSION = 'idea-gen-v1';

const TECH_MECH = {
  'AI/ML': ['a multi-source feature-fusion model with confidence calibration', 'an adaptive scoring model retrained on outcome feedback'],
  LLM: ['a retrieval-augmented reasoning pipeline with source-grounded citations', 'a structured-extraction pipeline with schema validation and self-check'],
  'Computer Vision': ['an on-device detection pipeline with temporal smoothing', 'a multi-camera fusion model with geometric verification'],
  IoT: ['an edge-aggregation protocol with anomaly detection and store-and-forward sync', 'a sensor-fusion state machine with drift correction'],
  Blockchain: ['a verifiable audit-log with tamper-evident hashing and selective disclosure', 'a proof-of-contribution ledger with dispute resolution'],
  Cloud: ['an event-driven processing pipeline with backpressure and idempotent replay', 'a policy-driven orchestration engine with cost-aware scheduling'],
  'Edge Computing': ['a privacy-preserving on-device inference pipeline with federated updates', 'an offline-first sync engine with conflict resolution'],
  Automation: ['a workflow state machine with detect-decide-act loops and rollback', 'a rule+ML hybrid decision engine with human-in-the-loop escalation'],
  Cybersecurity: ['a behavioral-anomaly detection engine with adaptive baselining', 'a multi-signal risk-scoring pipeline with explainable alerts'],
  default: ['a multi-source data-fusion pipeline with an adaptive feedback loop', 'a workflow engine with measurable, outcome-driven optimization'],
};

const NOVELTY_ANGLES = [
  'combines signals that existing systems treat in isolation',
  'uses outcome feedback to adaptively re-weight its inputs',
  'shifts processing to the edge for privacy and latency',
  'adds tamper-evident verification of the underlying evidence',
  'introduces a measurable confidence/credibility signal where none existed',
];

const GOAL_VERB = {
  'reduce cost': 'cut operational cost', 'increase safety': 'improve safety', 'automate process': 'automate a manual process',
  'detect fraud': 'detect fraud earlier', 'improve accuracy': 'improve decision accuracy', 'reduce manual work': 'eliminate repetitive manual work',
};

const lc = (s) => String(s || '').toLowerCase();
function pick(arr, i) { return arr[i % arr.length]; }
function titleCase(s) { return String(s || '').replace(/\b\w/g, (c) => c.toUpperCase()); }

/* Deterministic idea synthesis. Seeded by index so a request yields a stable,
   varied set. Each idea always carries a technical mechanism; if the inputs
   are too thin to justify one, the idea is flagged weak via scoring. */
export function generateIdeasDeterministic(input = {}, count = 6) {
  const domain = input.domain || 'General';
  const targetUser = input.targetUser || 'teams';
  const problem = input.problem || `inefficiency in ${domain}`;
  const tech = input.technology || 'AI/ML';
  const goal = lc(input.goal || 'reduce manual work');
  const mechs = TECH_MECH[tech] || TECH_MECH.default;
  const goalPhrase = GOAL_VERB[goal] || goal;

  const ideas = [];
  for (let i = 0; i < count; i++) {
    const mech = pick(mechs, i);
    const angle = pick(NOVELTY_ANGLES, i + (input.creativity === 'Bold' ? 2 : 0));
    const subjectNoun = `${titleCase(domain)} ${titleCase(targetUser)}`.trim();
    const focus = ['evidence', 'signal', 'workflow', 'risk', 'resource'][i % 5];

    const title = `${titleCase(domain)} ${titleCase(focus)}-fusion ${tech === 'IoT' ? 'edge ' : ''}engine for ${targetUser}`;
    const idea = {
      title,
      domain,
      targetUser,
      problem: `${titleCase(subjectNoun)} face ${problem}; current tools handle each ${focus} source separately and cannot ${goalPhrase} reliably.`,
      existingSolutions: input.existingSolutions || `Point tools and dashboards that ${goalPhrase ? 'partially address it' : 'exist'} but lack an integrated technical mechanism.`,
      proposedSolution: `A system that ${goalPhrase} by ${mech}, applied to ${domain} ${focus} data for ${targetUser}.`,
      technicalMechanism: `${titleCase(mech)}: it ingests ${focus} events from multiple sources, normalizes and weights them by reliability, processes them through ${mech}, and produces a calibrated output. It ${angle}.`,
      inputData: `Multiple ${domain} ${focus} sources (logs, records, sensor or user signals).`,
      processingLogic: `Ingest → normalize → reliability-weight → fuse/score via ${mech} → calibrate → emit result.`,
      outputResult: `A calibrated, real-time ${focus} score/decision with a confidence value.`,
      feedbackLoop: `Downstream outcomes feed back to recalibrate source weights and thresholds over time.`,
      noveltyAngle: `It ${angle}, producing a measurable improvement existing isolated tools cannot.`,
      marketUseCase: `${titleCase(targetUser)} in ${domain} use it to ${goalPhrase}, improving outcomes measurably.`,
      implementationPlan: `Event pipeline + ${tech} processing service + scoring API + feedback store; POC buildable in weeks.`,
      tags: [lc(domain), lc(tech), focus, 'feedback-loop'],
      source: 'generated:deterministic',
    };
    const sc = scorePatentIdea(idea);
    idea.scoreSummary = { overall: sc.overall, grade: sc.grade, riskLevel: sc.riskLevel };
    idea.weak = sc.overall < 55;
    ideas.push(idea);
  }
  return ideas;
}

/* Validate + normalize an AI-produced idea object into our shape. */
export function normalizeAIIdea(raw = {}, input = {}) {
  if (!raw || typeof raw !== 'object' || !raw.title) return null;
  const idea = {
    title: String(raw.title).slice(0, 200),
    domain: input.domain || raw.domain || 'General',
    targetUser: input.targetUser || raw.targetUser || 'teams',
    problem: String(raw.problem || raw.problemSolved || '').slice(0, 2000),
    existingSolutions: String(raw.existingSolutions || '').slice(0, 2000),
    proposedSolution: String(raw.proposedSolution || raw.solution || '').slice(0, 3000),
    technicalMechanism: String(raw.technicalMechanism || raw.mechanism || '').slice(0, 3000),
    inputData: String(raw.inputData || raw.inputs || '').slice(0, 1500),
    processingLogic: String(raw.processingLogic || '').slice(0, 2000),
    outputResult: String(raw.outputResult || raw.outputs || '').slice(0, 1500),
    feedbackLoop: String(raw.feedbackLoop || '').slice(0, 1500),
    noveltyAngle: String(raw.noveltyAngle || '').slice(0, 1500),
    marketUseCase: String(raw.marketUseCase || '').slice(0, 1500),
    implementationPlan: String(raw.implementationPlan || raw.poc || '').slice(0, 2000),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 10) : [],
    source: 'generated:ai',
  };
  const sc = scorePatentIdea(idea);
  idea.scoreSummary = { overall: sc.overall, grade: sc.grade, riskLevel: sc.riskLevel };
  idea.weak = sc.overall < 55;
  return idea;
}

/* The AI prompt that forces a technical mechanism + structured JSON. */
export function buildGenerationPrompt(input = {}, count = 6, context = '') {
  return [
    'You are a patent invention strategist. Generate distinct, NON-GENERIC patentable invention ideas.',
    'HARD RULES: every idea MUST have a concrete technical mechanism (data flow, algorithm, feedback loop, measurable improvement). Reject vague "AI app for X" framing. Each idea must differ in mechanism.',
    context ? `USER CONTEXT (avoid repeating rejected ideas; lean into saved strengths):\n${context}` : '',
    `INPUT: ${JSON.stringify({
      domain: input.domain, targetUser: input.targetUser, problem: input.problem,
      existingSolutions: input.existingSolutions, technology: input.technology, goal: input.goal,
      creativity: input.creativity,
    })}`,
    `Return ONLY JSON: {"ideas":[{"title","problem","existingSolutions","proposedSolution","technicalMechanism","inputData","processingLogic","outputResult","feedbackLoop","noveltyAngle","marketUseCase","implementationPlan","tags":[]}]}. Generate ${count} ideas.`,
  ].filter(Boolean).join('\n\n');
}

export default { generateIdeasDeterministic, normalizeAIIdea, buildGenerationPrompt, IDEA_GEN_VERSION };
