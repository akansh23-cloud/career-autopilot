/* ============================================================
   Innovation memory — pure similarity helpers (no DB imports)
   ------------------------------------------------------------
   Kept dependency-free so they can be unit-tested and reused
   without pulling in mongoose/the store.
   ============================================================ */
import { extractKeywords, jaccard, normalizeText } from '../problemIntelligence/util.js';

export const NEAR_DUPLICATE_THRESHOLD = 78;

export function chunkKeywords(c = {}) {
  return c.keywords && c.keywords.length
    ? c.keywords
    : extractKeywords(`${c.title || ''} ${c.safeSummary || c.text || ''} ${(c.painPoints || []).join(' ')}`, 12);
}

export function similarityScore(aKw, bKw, aTitle = '', bTitle = '') {
  const kw = jaccard(new Set(aKw), new Set(bKw));
  const titleSim = jaccard(new Set(normalizeText(aTitle).split(' ').filter(Boolean)), new Set(normalizeText(bTitle).split(' ').filter(Boolean)));
  return Math.round((kw * 0.7 + titleSim * 0.3) * 100);
}

export function isNearDuplicate(project = {}, candidates = []) {
  const aKw = extractKeywords(`${project.title} ${project.painPoint} ${project.proposedSolution}`, 16);
  for (const c of candidates) {
    const score = similarityScore(aKw, chunkKeywords(c), project.title, c.title);
    if (score >= NEAR_DUPLICATE_THRESHOLD) return { duplicate: true, against: c.title, score };
  }
  return { duplicate: false };
}

export default { NEAR_DUPLICATE_THRESHOLD, chunkKeywords, similarityScore, isNearDuplicate };
