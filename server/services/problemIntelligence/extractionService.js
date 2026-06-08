/* ============================================================
   Service — pain-point extraction
   ------------------------------------------------------------
   Attaches extractedPainPoints to each signal (deterministic,
   per-signal) and produces a corpus-level pain-point list via
   the AI provider (with deterministic fallback). Generalizes —
   never copies a single signal's text verbatim.
   ============================================================ */
import { getAIProvider } from './ai/aiProvider.js';
import { extractKeywords, sanitizeText } from './util.js';

function perSignalPainPoints(signal) {
  const kw = extractKeywords(`${signal.title} ${signal.contentSummary}`, 4);
  if (!kw.length) return [];
  return [sanitizeText(`Friction around ${kw.slice(0, 3).join(', ')}`, 160)];
}

export async function extractPainPoints({ signals = [] }, cfg) {
  for (const s of signals) s.extractedPainPoints = perSignalPainPoints(s);
  const ai = getAIProvider(cfg);
  const corpus = await ai.extractPainPoints({ signals });
  return {
    signals,
    painPoints: corpus.painPoints || [],
    provider: corpus._ai?.provider || 'fallback',
    confidence: corpus._ai?.confidence || 'low',
  };
}

export default { extractPainPoints };
