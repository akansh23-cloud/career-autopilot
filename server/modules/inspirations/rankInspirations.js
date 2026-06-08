/* ============================================================
   RANK INSPIRATIONS  (deterministic)
   ------------------------------------------------------------
   Scores each normalized inspiration on four axes, then a blended
   marketplaceScore. Same inputs -> same scores.
     freshnessScore .... recency of the source signal
     trendScore ........ popularity (stars / votes / points)
     buildabilityScore . how realistically a learner can ship it
     resumeImpactScore . how strong the proof would look on a resume
   ============================================================ */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n);

function freshness(it, now = Date.now()) {
  const ts = it.rawPayload?.createdAt ? new Date(it.rawPayload.createdAt).getTime() : now;
  const days = Math.max(0, (now - ts) / 864e5);
  return clamp(round(100 * Math.max(0, 1 - days / 45)), 0, 100);
}

function trend(it) {
  const raw = it.rawPayload || {};
  if (it.source === 'github') return clamp(round(Math.log10((raw.stars || 0) + 1) * 33), 0, 100);
  if (it.source === 'producthunt') return clamp(round(Math.log10((raw.votes || 0) + 1) * 33), 0, 100);
  if (it.source === 'hackernews') return clamp(round(Math.log10((raw.points || 0) + 1) * 33), 0, 100);
  return 50;
}

function buildability(it) {
  let s = 60;
  if (it.difficulty === 'Beginner') s += 20;
  else if (it.difficulty === 'Advanced') s -= 15;
  if ((it.suggestedSkills || []).length >= 3) s += 10;
  if ((it.suggestedSkills || []).some((k) => /kubernetes|distributed|kafka|spark/.test(k))) s -= 10;
  return clamp(round(s), 0, 100);
}

function resumeImpact(it) {
  let s = 55;
  if (it.difficulty === 'Advanced') s += 20;
  else if (it.difficulty === 'Intermediate') s += 10;
  if (/ai|llm|data|infra|cloud|devops/i.test(it.category)) s += 12;
  if ((it.suggestedSkills || []).length >= 5) s += 8;
  return clamp(round(s), 0, 100);
}

export function rankInspirations(items = [], now = Date.now()) {
  return items.map((it) => {
    const freshnessScore = freshness(it, now);
    const trendScore = trend(it);
    const buildabilityScore = buildability(it);
    const resumeImpactScore = resumeImpact(it);
    const marketplaceScore = clamp(round(
      trendScore * 0.30 + buildabilityScore * 0.25 + resumeImpactScore * 0.30 + freshnessScore * 0.15
    ), 0, 100);
    return { ...it, freshnessScore, trendScore, buildabilityScore, resumeImpactScore, marketplaceScore };
  }).sort((a, b) => b.marketplaceScore - a.marketplaceScore);
}

export default { rankInspirations };
