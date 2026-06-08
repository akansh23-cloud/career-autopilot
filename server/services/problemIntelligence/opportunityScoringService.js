/* ============================================================
   Service — opportunity scoring  (deterministic, backend-owned)
   ------------------------------------------------------------
   Scores each cluster on independent 0–100 axes from EVIDENCE
   (engagement, recency, source diversity, signal count) plus a
   light wording heuristic for build feasibility. No AI; no
   inflated numbers. Derives a conservative recommended route.
   ============================================================ */
import { clamp, lc } from './util.js';

const DAY = 86400000;

function recencyBoost(signals) {
  const now = Date.now();
  const ages = signals.map((s) => {
    const d = s.lastActivityAt ? new Date(s.lastActivityAt).getTime() : (s.sourceCreatedAt ? new Date(s.sourceCreatedAt).getTime() : 0);
    return d ? (now - d) / DAY : 9999;
  });
  if (!ages.length) return 0;
  const median = ages.sort((a, b) => a - b)[Math.floor(ages.length / 2)];
  if (median <= 30) return 100;
  if (median <= 90) return 80;
  if (median <= 180) return 60;
  if (median <= 365) return 40;
  if (median <= 730) return 25;
  return 10;
}

function engagementStrength(signals) {
  let total = 0;
  for (const s of signals) {
    const e = s.engagement || {};
    total += (Number(e.reactions) || 0) * 3 + (Number(e.score) || 0) * 3 + (Number(e.comments) || 0) + (Number(e.answers) || 0) + (Number(e.views) || 0) / 200;
  }
  // Log-ish compression so a few viral items don't max it out.
  return clamp(Math.round(20 * Math.log2(1 + total)), 0, 100);
}

export function scoreCluster(cluster) {
  const signals = cluster.signals || [];
  const n = signals.length;
  const sourceCount = new Set(signals.map((s) => s.source)).size;

  const evidenceStrengthScore = clamp(Math.round(
    n * 10 +                              // more signals = stronger
    (sourceCount - 1) * 12 +              // cross-source corroboration
    engagementStrength(signals) * 0.4,
  ), 0, 100);

  const severityScore = clamp(Math.round(engagementStrength(signals) * 0.7 + n * 4), 0, 100);
  const trendScore = recencyBoost(signals);

  // Build feasibility: penalize hardware / heavy-ML wording, reward CRUD/tooling.
  const text = lc(`${cluster.title} ${cluster.summary} ${(cluster.keywords || []).join(' ')}`);
  let feas = 70;
  if (/(hardware|robot|fpga|embedded|satellite|gpu|distributed|realtime|real-time|kernel)/.test(text)) feas -= 30;
  if (/(train|model|vision|nlp|llm)/.test(text)) feas -= 10;
  if (/(api|dashboard|tool|automation|workflow|tracker|assistant|cli|plugin|extension)/.test(text)) feas += 15;
  const buildFeasibilityScore = clamp(feas, 10, 95);

  const portfolioValueScore = clamp(Math.round((evidenceStrengthScore * 0.4) + (buildFeasibilityScore * 0.4) + (trendScore * 0.2)), 0, 100);
  const researchPotentialScore = clamp(Math.round((cluster.isResearchHeavy ? 60 : 20) + (signals.filter((s) => s.source === 'arxiv').length * 12)), 0, 100);

  // Patent potential is deliberately conservative here; the IP engine applies
  // the real hard caps later. This is only a triage hint.
  const technicalEffect = /(algorithm|pipeline|correlat|fusion|signal|optimi|detect|sensor|protocol|compression|scheduling)/.test(text);
  const patentPotentialScore = clamp(Math.round(
    (technicalEffect ? 45 : 25) + (evidenceStrengthScore * 0.15) + (cluster.isResearchHeavy ? 10 : 0),
  ), 0, 70); // capped at 70 — never high without prior-art/prototype

  const recommendedRoute = deriveRoute({
    evidenceStrengthScore, buildFeasibilityScore, researchPotentialScore,
    patentPotentialScore, portfolioValueScore, technicalEffect,
  });

  return {
    evidenceStrengthScore, severityScore, trendScore, buildFeasibilityScore,
    portfolioValueScore, researchPotentialScore, patentPotentialScore, recommendedRoute,
  };
}

function deriveRoute(s) {
  if (s.evidenceStrengthScore < 25) return 'not-recommended';
  if (s.patentPotentialScore >= 55 && s.technicalEffect) return 'patent-review';
  if (s.researchPotentialScore >= 60) return 'research';
  if (s.buildFeasibilityScore >= 70 && s.evidenceStrengthScore >= 50) return 'startup';
  return 'portfolio';
}

export function scoreClusters(clusters = []) {
  return clusters.map((c) => ({ ...c, ...scoreCluster(c) }));
}

export default { scoreCluster, scoreClusters };
