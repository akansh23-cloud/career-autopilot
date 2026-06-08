/* ============================================================
   PATENTABILITY SCORING ENGINE  (deterministic)
   ------------------------------------------------------------
   Patent-readiness ESTIMATE only — not legal advice. Weighted 7-factor
   score. Penalizes generic "AI app for X" / business-method-only ideas;
   rewards a concrete technical mechanism, data flow, feedback loop,
   measurable improvement, and POC feasibility. Same input -> same score.
   ============================================================ */
export const PATENT_SCORE_VERSION = 'patent-score-v1';

const WEIGHTS = {
  novelty: 0.25, technicalDepth: 0.20, specificity: 0.15, priorArtDistance: 0.15,
  marketUtility: 0.10, feasibility: 0.10, enforceability: 0.05,
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n);
const lc = (s) => String(s || '').toLowerCase();

const GENERIC = ['ai app', 'ai-powered app', 'app for', 'platform for', 'website for', 'tool for', 'crud', 'todo', 'clone', 'simple', 'basic', 'uber for', 'airbnb for', 'chatbot for', 'dashboard for'];
const BUSINESS_ONLY = ['marketplace', 'subscription', 'booking', 'listing', 'matchmaking', 'aggregator', 'directory'];
const MECHANISM = ['algorithm', 'pipeline', 'workflow', 'feedback loop', 'data fusion', 'multi-source', 'real-time', 'detection', 'classification', 'prediction', 'optimization', 'graph', 'embedding', 'inference', 'scoring', 'weighting', 'anomaly', 'adaptive', 'privacy-preserving', 'edge', 'protocol', 'encryption', 'orchestration', 'verification', 'state machine'];
const MEASURABLE = ['reduce', 'increase', 'improve', 'accuracy', 'latency', 'throughput', 'cost', 'precision', 'recall', 'faster', 'fewer', 'percent', '%'];
const TECH = ['ml', 'machine learning', 'computer vision', 'nlp', 'llm', 'iot', 'blockchain', 'cloud', 'edge', 'sensor', 'cryptograph', 'distributed', 'streaming'];

function corpus(idea) {
  return lc([
    idea.title, idea.problem, idea.proposedSolution, idea.technicalMechanism,
    idea.inputData, idea.processingLogic, idea.outputResult, idea.feedbackLoop,
    idea.noveltyAngle, idea.marketUseCase, idea.implementationPlan,
    (idea.tags || []).join(' '),
  ].filter(Boolean).join('  '));
}
const has = (t, list) => list.filter((w) => t.includes(w));
const len = (s) => lc(s).trim().length;

export function scorePatentIdea(idea = {}, { priorArtRecords = [] } = {}) {
  const t = corpus(idea);
  const mechHits = has(t, MECHANISM);
  const genericHits = has(t, GENERIC);
  const businessHits = has(t, BUSINESS_ONLY);
  const measurableHits = has(t, MEASURABLE);
  const techHits = has(t, TECH);
  const hasMechanismField = len(idea.technicalMechanism) > 40;
  const hasProcessing = len(idea.processingLogic) > 30;
  const hasFeedback = len(idea.feedbackLoop) > 15 || t.includes('feedback loop');
  const hasIO = len(idea.inputData) > 10 && len(idea.outputResult) > 10;
  const detailLen = len(idea.proposedSolution) + len(idea.technicalMechanism) + len(idea.processingLogic);

  // Factor 0-100 each.
  const technicalDepth = clamp(round(
    (hasMechanismField ? 30 : 0) + (hasProcessing ? 18 : 0) + (hasFeedback ? 14 : 0) + (hasIO ? 12 : 0) + clamp(mechHits.length * 6, 0, 26)
  ), 0, 100);

  const specificity = clamp(round(
    clamp(detailLen / 12, 0, 45) + clamp(mechHits.length * 5, 0, 25) + (hasIO ? 15 : 0) + (techHits.length ? 15 : 0) - genericHits.length * 12
  ), 0, 100);

  const novelty = clamp(round(
    35 + clamp(mechHits.length * 7, 0, 30) + (len(idea.noveltyAngle) > 30 ? 18 : 0) + (hasFeedback ? 7 : 0)
    - genericHits.length * 18 - businessHits.length * 8
  ), 0, 100);

  // Prior-art distance: lower when generic/crowded or many high-risk records.
  const highRiskArt = (priorArtRecords || []).filter((r) => lc(r.riskLevel) === 'high').length;
  const priorArtDistance = clamp(round(
    70 + clamp(mechHits.length * 4, 0, 20) - genericHits.length * 18 - businessHits.length * 6 - highRiskArt * 20
  ), 0, 100);

  const marketUtility = clamp(round(
    40 + (len(idea.marketUseCase) > 20 ? 20 : 0) + (measurableHits.length ? 20 : 0) + (len(idea.targetUser) > 2 ? 10 : 0) + (len(idea.problem) > 40 ? 10 : 0)
  ), 0, 100);

  const feasibility = clamp(round(
    45 + (len(idea.implementationPlan) > 20 ? 20 : 0) + (techHits.length ? 15 : 0) + (hasIO ? 10 : 0) + (mechHits.length ? 10 : 0) - (t.includes('quantum') || t.includes('agi') ? 25 : 0)
  ), 0, 100);

  const enforceability = clamp(round(
    35 + (hasMechanismField ? 25 : 0) + (measurableHits.length ? 15 : 0) + (hasProcessing ? 15 : 0) + (techHits.length ? 10 : 0) - businessHits.length * 10
  ), 0, 100);

  const factors = { novelty, technicalDepth, specificity, priorArtDistance, marketUtility, feasibility, enforceability };
  const overall = clamp(round(Object.entries(WEIGHTS).reduce((a, [k, w]) => a + factors[k] * w, 0)), 0, 100);

  const grade = overall >= 85 ? 'Strong candidate' : overall >= 70 ? 'Promising' : overall >= 55 ? 'Needs refinement' : overall >= 35 ? 'Weak' : 'Not recommended';
  const riskLevel = priorArtDistance >= 65 && novelty >= 60 ? 'Low' : priorArtDistance >= 45 ? 'Medium' : 'High';

  const reasons = [];
  if (hasMechanismField) reasons.push('Describes a concrete technical mechanism.');
  if (hasFeedback) reasons.push('Includes a feedback/adaptive loop.');
  if (measurableHits.length) reasons.push('States a measurable technical improvement.');
  if (techHits.length) reasons.push(`Grounded in implementable technology (${techHits.slice(0, 3).join(', ')}).`);
  if (genericHits.length) reasons.push(`Reads as generic ("${genericHits[0]}") — weakens novelty.`);
  if (businessHits.length) reasons.push('Leans toward a business method — harder to patent without a technical core.');

  const missingPieces = [];
  if (!hasMechanismField) missingPieces.push('A specific technical mechanism (how it works internally).');
  if (!hasProcessing) missingPieces.push('Processing logic / algorithm steps.');
  if (!hasIO) missingPieces.push('Defined inputs and outputs.');
  if (!hasFeedback) missingPieces.push('A feedback or adaptive loop.');
  if (!measurableHits.length) missingPieces.push('A measurable technical advantage.');

  const improvementSuggestions = buildSuggestions(factors, { hasFeedback, hasMechanismField, measurableHits, techHits });

  return {
    factors,
    overall,
    grade,
    riskLevel,
    reasons,
    missingPieces,
    improvementSuggestions,
    scoreVersion: PATENT_SCORE_VERSION,
  };
}

function buildSuggestions(f, ctx) {
  const s = [];
  if (!ctx.hasMechanismField || f.technicalDepth < 60) s.push('Add a concrete technical mechanism: components, data flow, and algorithm steps.');
  if (!ctx.hasFeedback) s.push('Add a feedback/adaptive loop that improves the system using outcomes.');
  if (f.specificity < 60) s.push('Increase specificity: name exact inputs, processing stages, and outputs.');
  if (f.priorArtDistance < 60) s.push('Differentiate from crowded prior art with a unique combination or novel signal.');
  if (!ctx.measurableHits.length) s.push('Quantify the technical advantage (e.g. reduces X by N%, improves accuracy).');
  if (f.feasibility < 60) s.push('Outline a buildable POC path to demonstrate reduction-to-practice.');
  if (s.length === 0) s.push('Consider multi-source data fusion or privacy-preserving processing to deepen novelty.');
  return s;
}

export default { scorePatentIdea, PATENT_SCORE_VERSION };
