/* ============================================================
   Service — prior-art workspace
   ------------------------------------------------------------
   Normalizes a prior-art record (sanitized, bounded) and
   recalculates IP readiness whenever records change. Until at
   least one record exists, readiness reports "External prior-art
   risk unknown." and never "low prior-art risk".
   ============================================================ */
import { sanitizeText } from './util.js';
import { computeIPReadiness } from './ipReadinessService.js';

const SOURCE_TYPES = ['patent', 'paper', 'product', 'github', 'article', 'manual'];
const RISK_LEVELS = ['Low', 'Medium', 'High', 'Unknown'];

export function normalizePriorArtRecord(input = {}, reviewer = '') {
  const sourceType = SOURCE_TYPES.includes(input.sourceType) ? input.sourceType : 'manual';
  const url = typeof input.sourceUrl === 'string' && /^https?:\/\//i.test(input.sourceUrl) ? input.sourceUrl.slice(0, 500) : '';
  const norm = (v) => (RISK_LEVELS.includes(v) ? v : 'Unknown');
  return {
    sourceType,
    title: sanitizeText(input.title, 240) || 'Untitled prior-art reference',
    sourceUrl: url,            // stored, NEVER auto-fetched
    summary: sanitizeText(input.summary, 1500),
    similarityRisk: norm(input.similarityRisk),
    technicalOverlap: sanitizeText(input.technicalOverlap, 800),
    differentiator: sanitizeText(input.differentiator, 800),
    blockingRisk: norm(input.blockingRisk),
    reviewedBy: sanitizeText(reviewer || input.reviewedBy, 120),
    createdAt: new Date(),
  };
}

/* Recompute readiness given the (possibly updated) prior-art set. */
export function recomputeReadiness({ project, priorArtRecords = [], hasPrototypeEvidence = false }) {
  return computeIPReadiness({ project, priorArtRecords, hasPrototypeEvidence });
}

export const PRIOR_ART_SOURCE_TYPES = SOURCE_TYPES;
export default { normalizePriorArtRecord, recomputeReadiness, PRIOR_ART_SOURCE_TYPES };
