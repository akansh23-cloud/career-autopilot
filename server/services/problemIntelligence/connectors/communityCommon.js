/* ============================================================
   Community connector — shared helpers
   ------------------------------------------------------------
   Every community connector emits the SAME normalized signal
   shape and runs the same lightweight, deterministic pain-point
   extraction. No raw comment dumps; summaries only.
   ============================================================ */
import { sha1, sanitizeText, extractKeywords, lc } from '../util.js';

const COMPLAINT = /(annoying|frustrat|hate|broken|doesn'?t work|can'?t|cannot|impossible|painful|waste|slow|confusing|missing|lack|no way to|wish there was|why is there no|struggle|tedious|manual)/;
const FEATURE = /(feature request|it would be (great|nice)|please add|i wish|need a (tool|way)|should support|would love)/;
const QUESTION = /\?$|how (do|to|can)|what'?s the best|is there a way/;

export function classifySignal(text = '') {
  const t = lc(text);
  if (FEATURE.test(t)) return 'feature_request';
  if (COMPLAINT.test(t)) return 'complaint';
  if (QUESTION.test(t)) return 'question';
  return 'discussion';
}

export function sentimentOf(text = '') {
  const t = lc(text);
  const neg = (t.match(COMPLAINT) || []).length;
  if (neg >= 1) return 'negative';
  return 'neutral';
}

/* Heuristic pain-point extraction from a title + short summary. Deterministic,
   no AI — the AI layer refines later over the whole cluster. */
export function extractPainHints(title = '', summary = '') {
  const out = [];
  const text = `${title}. ${summary}`;
  for (const sentence of text.split(/[.!?\n]/)) {
    const s = sentence.trim();
    if (s.length < 12) continue;
    if (COMPLAINT.test(lc(s)) || FEATURE.test(lc(s))) out.push(sanitizeText(s, 180));
    if (out.length >= 4) break;
  }
  if (!out.length) {
    const kw = extractKeywords(text, 3);
    if (kw.length) out.push(sanitizeText(`Recurring friction around ${kw.join(', ')}.`, 180));
  }
  return out.slice(0, 4);
}

export function normalizeCommunitySignal({
  source, sourceUrl = '', sourceId = '', sourceCommunity = '', title = '',
  body = '', tags = [], engagement = {}, createdAt = null, lastActivityAt = null,
}) {
  const summary = sanitizeText(body || title, 600);
  const painPoints = extractPainHints(title, summary);
  return {
    source,
    sourceUrl,
    sourceId: String(sourceId || ''),
    sourceCommunity: sanitizeText(sourceCommunity, 80),
    title: sanitizeText(title, 240),
    contentSummary: summary,
    discussionSummary: sanitizeText(summary, 400),
    tags: (tags || []).map((t) => sanitizeText(t, 40)).filter(Boolean).slice(0, 12),
    engagement: {
      score: engagement.score || 0, comments: engagement.comments || 0,
      reactions: engagement.reactions || 0, views: engagement.views || 0,
    },
    sourceCreatedAt: createdAt,
    lastActivityAt: lastActivityAt || createdAt,
    extractedPainPoints: painPoints,
    extractedConstraints: [],
    currentWorkarounds: [],
    requestedFeatures: classifySignal(title) === 'feature_request' ? painPoints.slice(0, 2) : [],
    sentiment: sentimentOf(`${title} ${summary}`),
    signalType: classifySignal(`${title} ${summary}`),
    rawTextHash: sha1(`${source}:${sourceId}:${title}`),
  };
}

export function ok(source, signals, warning) {
  return { ok: !warning || signals.length > 0, source, signals, warning: warning || '' };
}
export function disabled(source, reason) {
  return { ok: false, source, signals: [], warning: reason };
}

export default { normalizeCommunitySignal, classifySignal, sentimentOf, extractPainHints, ok, disabled };
