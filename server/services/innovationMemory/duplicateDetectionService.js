/* ============================================================
   Innovation memory — duplicate detection
   ------------------------------------------------------------
   Before saving a generated project, check for exact fingerprint
   AND near-duplicate similarity against existing memory/projects.
   Returns skip decisions + human-readable reasons so the UI can
   say "2 similar ideas were skipped".
   ============================================================ */
import { piConfig } from '../problemIntelligence/config.js';
import { extractKeywords } from '../problemIntelligence/util.js';
import { retrieveSimilar } from './retrievalService.js';
import { isNearDuplicate, NEAR_DUPLICATE_THRESHOLD } from './similarity.js';

const NEAR_DUPLICATE = NEAR_DUPLICATE_THRESHOLD; // similarity >= this ⇒ treat as duplicate

export async function detectDuplicates({ userId, email, collegeId = '', project = {}, cfg = piConfig() }) {
  const query = {
    title: project.title,
    painPoint: project.painPoint,
    proposedSolution: project.proposedSolution,
    keywords: extractKeywords(`${project.title} ${project.painPoint} ${project.proposedSolution} ${project.noveltyAngle} ${project.domain} ${project.targetUser}`, 16),
  };
  const r = await retrieveSimilar({ userId, email, collegeId, query, sourceTypes: ['generated_project', 'patent_idea'], limit: 10, cfg });
  const similar = r.results || [];
  const duplicates = similar.filter((s) => s.similarity >= NEAR_DUPLICATE);
  return {
    checked: r.retrievalUsed,
    isDuplicate: duplicates.length > 0,
    duplicateCount: duplicates.length,
    duplicates: duplicates.map((d) => ({ id: d.id, title: d.title, similarity: d.similarity })),
    similar: similar.slice(0, 6),
    reason: duplicates.length ? `${duplicates.length} similar idea(s) already exist in your workspace (≥${NEAR_DUPLICATE}% similar).` : '',
  };
}

/* Pure helper for in-memory candidate lists (used when DB is off / in tests). */
export { isNearDuplicate } from './similarity.js';

export { NEAR_DUPLICATE_THRESHOLD };
export default { detectDuplicates, NEAR_DUPLICATE_THRESHOLD };
