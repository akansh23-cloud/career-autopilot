/* ============================================================
   Service — source quality & privacy scoring
   ------------------------------------------------------------
   Deterministic scoring of how much a signal can be trusted and
   how privacy-sensitive it is. Community signals are early pain
   signals, NOT verified facts — this is enforced numerically so
   downstream scoring/IP caps can rely on it.
   ============================================================ */
import { lc } from './util.js';

// Base trust by source type. Community sources are deliberately lower.
const SOURCE_BASE = {
  github: 78, github_discussions: 72, stackexchange: 76, arxiv: 70, manual: 65,
  reddit: 42, hackernews: 50, discourse: 52, devto: 48, hashnode: 46, specialized_forum: 45,
};

const SENSITIVE = /(suicide|self-harm|depression|anxiety|abuse|trauma|medical|diagnosis|prescription|lawsuit|divorce|salary|visa|immigration|mental health|addiction)/;

export function scoreSourceQuality(signal = {}) {
  const src = signal.source || 'manual';
  let score = SOURCE_BASE[src] ?? 45;

  const eng = signal.engagement || {};
  const engagement = (eng.comments || 0) + (eng.reactions || 0) + (eng.score || 0) + Math.min((eng.views || 0) / 50, 30);
  score += Math.min(engagement, 20);

  // Recency: more recent activity → slightly higher.
  const last = signal.lastActivityAt ? new Date(signal.lastActivityAt).getTime() : 0;
  if (last) {
    const days = (Date.now() - last) / 86400000;
    if (days <= 90) score += 6; else if (days <= 365) score += 2; else score -= 4;
  }

  // Technical specificity: longer, keyword-rich summaries score higher.
  const text = `${signal.title || ''} ${signal.contentSummary || ''} ${(signal.extractedPainPoints || []).join(' ')}`;
  if (text.length > 200) score += 4;
  if ((signal.extractedPainPoints || []).length >= 2) score += 4;
  if (signal.signalType === 'feature_request' || signal.signalType === 'complaint') score += 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function assessPrivacyRisk(signal = {}) {
  const text = lc(`${signal.title || ''} ${signal.contentSummary || ''} ${signal.discussionSummary || ''} ${(signal.tags || []).join(' ')} ${signal.sourceCommunity || ''}`);
  if (SENSITIVE.test(text)) return 'high';
  // Community sources carry inherently higher privacy risk than code repos.
  if (['reddit', 'discourse', 'specialized_forum'].includes(signal.source)) return 'medium';
  return 'low';
}

/* Compute a source mix + corroboration verdict for a set of signals. */
export function computeSourceMix(signals = []) {
  const mix = { github: 0, github_discussions: 0, stackexchange: 0, arxiv: 0, reddit: 0, hackernews: 0, discourse: 0, devto: 0, hashnode: 0, specialized_forum: 0, manual: 0 };
  for (const s of signals) if (s.source in mix) mix[s.source]++;
  const COMMUNITY = ['reddit', 'hackernews', 'discourse', 'devto', 'hashnode', 'specialized_forum'];
  const TECHNICAL = ['github', 'github_discussions', 'stackexchange', 'arxiv', 'manual'];
  const communityCount = COMMUNITY.reduce((a, k) => a + mix[k], 0);
  const technicalCount = TECHNICAL.reduce((a, k) => a + mix[k], 0);
  const distinctTypes = Object.values(mix).filter((n) => n > 0).length;
  const communityOnly = communityCount > 0 && technicalCount === 0;
  return {
    mix, communityCount, technicalCount, distinctTypes, communityOnly,
    corroborated: distinctTypes >= 2 && technicalCount >= 1,
    validationLabel: communityOnly
      ? 'Early community signal — needs validation'
      : (distinctTypes >= 2 ? 'Corroborated across multiple sources' : 'Single-source signal — validate before relying on it'),
  };
}

export default { scoreSourceQuality, assessPrivacyRisk, computeSourceMix };
