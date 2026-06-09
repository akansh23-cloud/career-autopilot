/* ============================================================
   Innovation memory — retrieval (RAG)
   ------------------------------------------------------------
   Retrieves similar past memory chunks to INFORM generation
   (duplicate prevention, better framing, novelty warnings). It
   never overrides deterministic scoring — it only annotates.
   Uses embeddings when available, else keyword similarity.
   ============================================================ */
import { piConfig } from '../problemIntelligence/config.js';
import { extractKeywords } from '../problemIntelligence/util.js';
import { candidateChunks } from './memoryStore.js';
import { getEmbedder, cosine } from './embeddingProvider.js';
import { chunkKeywords, similarityScore } from './similarity.js';

export async function retrieveSimilar({ userId, email, collegeId = '', query = {}, sourceTypes = [], limit = 8, cfg = piConfig() }) {
  if (!cfg.memory || !cfg.memory.enabled) {
    return { retrievalUsed: false, retrievedMemoryCount: 0, results: [], similarityWarnings: [], mode: 'disabled' };
  }
  const candidates = await candidateChunks({ userId, email, collegeId, sourceTypes, limit: 400 });
  if (!candidates.length) {
    return { retrievalUsed: true, retrievedMemoryCount: 0, results: [], similarityWarnings: [], mode: 'empty' };
  }

  const qText = `${query.title || ''} ${query.painPoint || query.summary || ''} ${(query.keywords || []).join(' ')} ${query.proposedSolution || ''}`.trim();
  const qKw = query.keywords?.length ? query.keywords : extractKeywords(qText, 14);

  const embedder = getEmbedder(cfg);
  let mode = 'keyword';
  let scored;

  if (embedder.enabled) {
    const [qVec] = await embedder.embed([qText]);
    if (qVec) {
      mode = `vector:${embedder.mode}`;
      scored = candidates
        .filter((c) => Array.isArray(c.embedding) && c.embedding.length === qVec.length)
        .map((c) => ({ chunk: c, score: Math.round(cosine(qVec, c.embedding) * 100) }));
      // include keyword-only candidates too (those without vectors)
      const vectorIds = new Set(scored.map((s) => s.chunk.id));
      for (const c of candidates) if (!vectorIds.has(c.id)) scored.push({ chunk: c, score: similarityScore(qKw, chunkKeywords(c), query.title, c.title) });
    }
  }
  if (!scored) {
    scored = candidates.map((c) => ({ chunk: c, score: similarityScore(qKw, chunkKeywords(c), query.title, c.title) }));
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score >= 20).slice(0, limit);
  const warnings = [];
  const strong = top.filter((s) => s.score >= 70);
  if (strong.length) warnings.push(`${strong.length} highly similar past item(s) found — check for duplication before treating this as novel.`);

  return {
    retrievalUsed: true,
    mode,
    retrievedMemoryCount: top.length,
    results: top.map((s) => ({ id: s.chunk.id, title: s.chunk.title, sourceType: s.chunk.sourceType, sourcePlatform: s.chunk.sourcePlatform, visibility: s.chunk.visibility, safeSummary: s.chunk.safeSummary, similarity: s.score })),
    similarityWarnings: warnings,
  };
}

export { similarityScore, chunkKeywords } from './similarity.js';
export default { retrieveSimilar };
