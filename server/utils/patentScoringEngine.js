/* ============================================================
   PATENTABILITY SCORING ENGINE  (deterministic)
   ------------------------------------------------------------
   Patent-readiness ESTIMATE only — positioned explicitly as an input
   for faculty/IP-cell triage, never a legal opinion. Weighted 7-factor
   score. Penalizes generic "AI app for X" / business-method-only ideas
   AND keyword stuffing (dense mechanism-word soup without processing
   logic or I/O); rewards a concrete technical mechanism, data flow,
   feedback loop, measurable improvement, and POC feasibility.

   Synthesis-aware: pass { projectPackage } to let a package's build
   brief mechanism raise technical depth, weak/community-only evidence
   lower prior-art confidence, and an IP-weak domain classification cap
   the ceiling. Without a package the output is byte-identical to the
   legacy path. Same input -> same score, always.
   ============================================================ */
export const PATENT_SCORE_VERSION = 'patent-score-v2';

/* Single source of truth for the anti-gaming explanation (asserted in tests
   and shown verbatim in the UI so students learn WHY the cap fired). */
export const STUFFING_REASON =
  'Keyword stuffing detected — mechanism terms are repeated without processing logic or defined inputs/outputs, so technical depth and specificity are capped.';

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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Total occurrences (not just presence) of every mechanism term. The
   stuffing signal is repetition: many occurrences over few unique terms. */
function mechanismOccurrences(t) {
  let occurrences = 0;
  let unique = 0;
  for (const term of MECHANISM) {
    const m = t.match(new RegExp(escapeRe(term), 'g'));
    if (m && m.length) { occurrences += m.length; unique += 1; }
  }
  return { occurrences, unique, ratio: unique ? occurrences / unique : 0 };
}

/* ---- Synthesis-package readers (dependency-free mirrors of the
        integration bridge so this engine stays a pure utility). ---- */
function packageMechanism(pkg) {
  const candidates = [
    pkg?.buildBrief?.technicalMechanism,
    pkg?.projectOsPayload?.technicalMechanism,
    pkg?.buildBrief?._meta?.mechanismName,
  ];
  for (const c of candidates) {
    const v = String(c || '').slice(0, 600);
    if (v.trim().length >= 25) return v;
  }
  return '';
}

function packageEvidence(pkg) {
  const es = pkg?.evidenceSummary || null;
  if (es) {
    const meta = es._meta || {};
    const level = meta.confidenceLevel
      || (/high/i.test(String(es.confidenceImpact || '')) ? 'high'
        : /medium/i.test(String(es.confidenceImpact || '')) ? 'medium' : 'low');
    return { level, communityOnly: !!meta.communityOnly, present: true };
  }
  const communityOnly = !!pkg?.sourceMix?.communityOnly;
  const strength = Number(pkg?.evidenceStrength) || 0;
  if (!communityOnly && !strength && !pkg?.quality) return { level: '', communityOnly: false, present: false };
  const level = communityOnly || strength < 25 ? 'low' : strength >= 50 ? 'high' : 'medium';
  return { level, communityOnly, present: true };
}

export function scorePatentIdea(idea = {}, opts = {}) {
  const { priorArtRecords = [], projectPackage = null } = opts || {};
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

  /* ---- Anti-gaming: repeated mechanism keywords without substance. ---- */
  const rep = mechanismOccurrences(t);
  const stuffingDetected = rep.occurrences >= 22 && rep.ratio >= 1.9;

  // Factor 0-100 each.
  let technicalDepth = clamp(round(
    (hasMechanismField ? 30 : 0) + (hasProcessing ? 18 : 0) + (hasFeedback ? 14 : 0) + (hasIO ? 12 : 0) + clamp(mechHits.length * 6, 0, 26)
  ), 0, 100);

  let specificity = clamp(round(
    clamp(detailLen / 12, 0, 45) + clamp(mechHits.length * 5, 0, 25) + (hasIO ? 15 : 0) + (techHits.length ? 15 : 0) - genericHits.length * 12
  ), 0, 100);

  const novelty = clamp(round(
    35 + clamp(mechHits.length * 7, 0, 30) + (len(idea.noveltyAngle) > 30 ? 18 : 0) + (hasFeedback ? 7 : 0)
    - genericHits.length * 18 - businessHits.length * 8
  ), 0, 100);

  // Prior-art distance: lower when generic/crowded or many high-risk records.
  const highRiskArt = (priorArtRecords || []).filter((r) => lc(r.riskLevel) === 'high').length;
  let priorArtDistance = clamp(round(
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

  const reasons = [];
  if (hasMechanismField) reasons.push('Describes a concrete technical mechanism.');
  if (hasFeedback) reasons.push('Includes a feedback/adaptive loop.');
  if (measurableHits.length) reasons.push('States a measurable technical improvement.');
  if (techHits.length) reasons.push(`Grounded in implementable technology (${techHits.slice(0, 3).join(', ')}).`);
  if (genericHits.length) reasons.push(`Reads as generic ("${genericHits[0]}") — weakens novelty.`);
  if (businessHits.length) reasons.push('Leans toward a business method — harder to patent without a technical core.');

  /* ---- Synthesis package signals (only when a package is provided). ---- */
  let ipWeakDomain = false;
  if (projectPackage) {
    const pkgMech = packageMechanism(projectPackage);
    if (pkgMech && !hasMechanismField) {
      technicalDepth = clamp(technicalDepth + clamp(10 + Math.floor(pkgMech.length / 40), 0, 24), 0, 100);
      reasons.push('Project package supplies a concrete technical mechanism — technical depth raised from the build brief.');
    }
    const ev = packageEvidence(projectPackage);
    if (ev.present && (ev.communityOnly || ev.level === 'low')) {
      priorArtDistance = clamp(priorArtDistance - 15, 0, 100);
      reasons.push('Evidence is community-only / low-confidence — prior-art confidence reduced until a real search is run.');
    } else if (ev.present && ev.level === 'high') {
      priorArtDistance = clamp(priorArtDistance + 5, 0, 100);
    }
    ipWeakDomain = projectPackage?.classification?.ipAnalysisAppropriate === false;
  }

  /* ---- Anti-gaming cap applied AFTER any lifts so it always wins. ---- */
  if (stuffingDetected) {
    technicalDepth = Math.min(technicalDepth, 35);
    specificity = Math.min(specificity, 35);
    reasons.push(STUFFING_REASON);
  }

  const factors = { novelty, technicalDepth, specificity, priorArtDistance, marketUtility, feasibility, enforceability };
  let overall = clamp(round(Object.entries(WEIGHTS).reduce((a, [k, w]) => a + factors[k] * w, 0)), 0, 100);

  let riskLevel = priorArtDistance >= 65 && novelty >= 60 ? 'Low' : priorArtDistance >= 45 ? 'Medium' : 'High';

  if (ipWeakDomain) {
    overall = Math.min(overall, 50);
    riskLevel = 'High';
    reasons.push('Domain classified as weak ground for IP (generic marketplace/workflow pattern) — treat as a project, and route to faculty/IP-cell review only if a deeper technical core emerges.');
  }

  const grade = overall >= 85 ? 'Strong candidate' : overall >= 70 ? 'Promising' : overall >= 55 ? 'Needs refinement' : overall >= 35 ? 'Weak' : 'Not recommended';

  const missingPieces = [];
  if (!hasMechanismField) missingPieces.push('A specific technical mechanism (how it works internally).');
  if (!hasProcessing) missingPieces.push('Processing logic / algorithm steps.');
  if (!hasIO) missingPieces.push('Defined inputs and outputs.');
  if (!hasFeedback) missingPieces.push('A feedback or adaptive loop.');
  if (!measurableHits.length) missingPieces.push('A measurable technical advantage.');

  const improvementSuggestions = buildSuggestions(factors, { hasFeedback, hasMechanismField, measurableHits, techHits });

  /* ---- Triage block: every score is explicitly an ESTIMATE for human
          (faculty / college IP-cell) review, never a filing verdict. ---- */
  const strong = reasons.filter((r) => !/generic|business method|stuffing|weak ground|community-only/i.test(r));
  const nextHumanStep = overall >= 70 && !stuffingDetected && !ipWeakDomain
    ? 'Share the invention disclosure draft with your college IP cell or a faculty mentor for a novelty review before any filing decision.'
    : 'Work through the missing pieces with a faculty mentor, then request an IP-cell triage review once the technical mechanism is concrete.';
  const triage = {
    headline: 'Patent-readiness estimate for faculty/IP-cell triage — not a legal opinion or a filing recommendation.',
    strong,
    missing: missingPieces,
    nextHumanStep,
  };

  return {
    factors,
    overall,
    grade,
    riskLevel,
    reasons,
    missingPieces,
    improvementSuggestions,
    stuffingDetected,
    positioning: 'patent-readiness estimate for faculty/IP-cell triage',
    triage,
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

export default { scorePatentIdea, PATENT_SCORE_VERSION, STUFFING_REASON };
