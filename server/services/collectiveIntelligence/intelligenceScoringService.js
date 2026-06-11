/* ============================================================
   Career Intelligence — scoring service
   ------------------------------------------------------------
   Deterministic, explainable scores (0–100) computed from the
   normalized evidence mix + query understanding. AI never sets
   or alters these numbers — it may only describe them later.
   ============================================================ */
import { clamp } from '../problemIntelligence/util.js';

const pct = (n) => Math.round(clamp(n, 0, 100));

function byType(evidence = []) {
  const m = {};
  for (const e of evidence) m[e.sourceType] = (m[e.sourceType] || 0) + 1;
  return m;
}

function avg(evidence, field) {
  if (!evidence.length) return 0;
  return evidence.reduce((s, e) => s + (e[field] || 0), 0) / evidence.length;
}

/* Score a candidate idea against the evidence that supports it. Every score
   ships a one-line reason so the UI can explain itself. */
export function scoreIdea({ idea = {}, evidence = [], understanding = {} } = {}) {
  const t = byType(evidence);
  const pains = t.community_pain_point || 0;
  const research = (t.research_paper || 0);
  const datasets = (t.public_dataset || 0) + (t.government_data || 0);
  const market = (t.market_signal || 0) + (t.local_business_signal || 0);
  const security = t.security_vulnerability || 0;
  const taxonomy = (t.career_taxonomy || 0) + (t.skill_taxonomy || 0);
  const code = t.code_signal || 0;
  const total = evidence.length;

  const avgRelevance = avg(evidence, 'relevanceScore');
  const avgTrust = avg(evidence, 'trustScore');
  const avgFresh = avg(evidence, 'freshnessScore');

  const marketNeedScore = pct(20 + pains * 9 + market * 8 + (avgRelevance * 0.25));
  const noveltyScore = pct(idea.noveltyAngle ? 45 + Math.min(research, 4) * 8 + (pains ? 8 : 0) : 30 + Math.min(research, 4) * 6);
  const buildFeasibilityScore = pct(55 + datasets * 6 + code * 4 - (understanding.difficulty === 'advanced' ? 12 : 0) + (understanding.difficulty === 'beginner' ? 8 : 0));
  const datasetAvailabilityScore = pct(datasets ? 50 + datasets * 12 : 25);
  const resumeValueScore = pct(35 + datasets * 5 + research * 4 + (understanding.targetRole ? 12 : 0) + taxonomy * 6 + (idea.skills?.length ? 8 : 0));
  const recruiterImpactScore = pct(30 + pains * 5 + datasets * 5 + (idea.mvpScope?.length ? 10 : 0) + (understanding.targetRole ? 10 : 0) + Math.min(avgTrust * 0.2, 15));
  const patentPotentialScore = pct((understanding.needs?.patent ? 25 : 10) + (idea.noveltyAngle ? 20 : 0) + Math.min(research, 5) * 7 + (pains ? 8 : 0) - (research > 8 ? 10 : 0));
  const sourceConfidenceScore = pct(total ? Math.min(total, 10) * 5 + avgTrust * 0.35 + avgFresh * 0.15 : 10);
  const difficultyScore = pct(understanding.difficulty === 'beginner' ? 30 : understanding.difficulty === 'advanced' ? 80 : 55);

  const reasons = {
    marketNeedScore: pains || market
      ? `${pains} community pain signal(s) + ${market} market signal(s) indicate real demand.`
      : 'Little direct demand evidence found — validate with users before investing heavily.',
    noveltyScore: idea.noveltyAngle
      ? `A concrete novelty angle exists; ${research} research signal(s) map the prior-art landscape.`
      : 'No sharp novelty angle yet — differentiate on workflow, data or audience.',
    resumeValueScore: `${understanding.targetRole ? `Aligned to ${understanding.targetRole}; ` : ''}${datasets} real dataset(s) and ${research} research reference(s) make claims verifiable.`,
    buildFeasibilityScore: datasets
      ? `${datasets} free dataset/API option(s) reduce build risk; difficulty: ${understanding.difficulty}.`
      : `No turnkey dataset found — feasible but plan data collection; difficulty: ${understanding.difficulty}.`,
    datasetAvailabilityScore: datasets ? `${datasets} public dataset/government source(s) directly usable.` : 'No matching public dataset surfaced in this run.',
    recruiterImpactScore: 'Driven by evidence-backed problem framing, scoped MVP, and real data sources recruiters can verify.',
    patentPotentialScore: research > 8
      ? 'Crowded research area — strong prior-art pressure; novelty must be very specific.'
      : `${research} prior-art adjacent signal(s); early-stage indicator only, not legal advice.`,
    sourceConfidenceScore: `${total} normalized evidence item(s), avg trust ${Math.round(avgTrust)}/100, avg freshness ${Math.round(avgFresh)}/100.`,
    difficultyScore: `Estimated from query (${understanding.difficulty}).`,
  };

  if (security) {
    reasons.marketNeedScore += ` ${security} live CVE signal(s) ground the security problem in real vulnerabilities.`;
  }

  return {
    scores: {
      marketNeedScore, noveltyScore, resumeValueScore, buildFeasibilityScore,
      datasetAvailabilityScore, recruiterImpactScore, patentPotentialScore,
      sourceConfidenceScore, difficultyScore,
    },
    reasons,
    overall: pct((marketNeedScore + resumeValueScore + buildFeasibilityScore + recruiterImpactScore + sourceConfidenceScore) / 5),
  };
}

export default { scoreIdea };
