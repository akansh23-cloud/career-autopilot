/* ============================================================
   Synthesis Intelligence — evidence grounding
   ------------------------------------------------------------
   Explains how source evidence influenced the output, what is
   missing, and what must be validated before building. Weak or
   community-only evidence reduces confidence and IP-readiness.
   Deterministic and dependency-free.
   ============================================================ */
import { sanitizeText } from '../problemIntelligence/util.js';

const COMMUNITY_SOURCES = new Set(['reddit', 'hackernews', 'discourse', 'devto', 'hashnode', 'specialized_forum', 'community_pain_point']);
const TECHNICAL_SOURCES = new Set(['github', 'github_discussions', 'stackexchange', 'nvd', 'security_vulnerability']);
const RESEARCH_SOURCES = new Set(['arxiv', 'crossref', 'openalex', 'research_paper']);
const DATA_SOURCES = new Set(['datagov', 'census', 'fda', 'nasa', 'worldbank', 'openmeteo', 'openstreetmap', 'public_dataset', 'government_data']);

function categorize(source = '', sourceType = '') {
  const s = String(source || '').toLowerCase();
  const t = String(sourceType || '').toLowerCase();
  if (COMMUNITY_SOURCES.has(s) || COMMUNITY_SOURCES.has(t)) return 'community';
  if (RESEARCH_SOURCES.has(s) || RESEARCH_SOURCES.has(t)) return 'research';
  if (DATA_SOURCES.has(s) || DATA_SOURCES.has(t)) return 'public_data';
  if (TECHNICAL_SOURCES.has(s) || TECHNICAL_SOURCES.has(t)) return 'technical';
  if (s === 'manual' || t === 'manual') return 'manual';
  return s || t ? 'other' : 'none';
}

/**
 * buildEvidenceSummary — accepts normalized evidence items (from either the
 * Innovation OS cluster signals or Career Intelligence evidence list).
 * Each item: { source, sourceType?, title?, relevanceScore?, trustScore? }.
 */
export function buildEvidenceSummary({ evidence = [], evidenceStrength = 0, classification = {} } = {}) {
  const items = Array.isArray(evidence) ? evidence : [];
  const byCategory = new Map();
  for (const e of items) {
    const cat = categorize(e.source, e.sourceType);
    if (cat === 'none') continue;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(e);
  }
  const sourceCategoriesUsed = [...byCategory.keys()];
  const communityOnly = sourceCategoriesUsed.length > 0 && sourceCategoriesUsed.every((c) => c === 'community');
  const total = items.length;

  // Strongest signals: highest-ranked titles across non-community first.
  const ranked = items
    .slice()
    .sort((a, b) => ((b.relevanceScore || 0) + (b.trustScore || 0)) - ((a.relevanceScore || 0) + (a.trustScore || 0)));
  const strongestSignals = ranked
    .filter((e) => categorize(e.source, e.sourceType) !== 'community')
    .concat(ranked)
    .slice(0, 3)
    .map((e) => sanitizeText(e.title || `${e.source} signal`, 160))
    .filter((v, i, a) => a.indexOf(v) === i);

  const weakOrMissingSignals = [];
  if (!total) weakOrMissingSignals.push('No source evidence was gathered this run — the idea is derived from the query and domain knowledge alone.');
  if (communityOnly) weakOrMissingSignals.push('Evidence is community-only (forums/discussions) — early demand signal, not verified technical evidence.');
  if (!byCategory.has('research') && classification.ipAnalysisAppropriate) weakOrMissingSignals.push('No research/prior-art-adjacent signals were found — run a dedicated prior-art search before any IP claim.');
  if (!byCategory.has('public_data') && (classification.dataNeeds || []).length) weakOrMissingSignals.push(`Planned data sources (${(classification.dataNeeds || [])[0]}) were not verified live this run.`);

  let confidenceImpact;
  let confidenceLevel;
  if (!total) {
    confidenceLevel = 'low';
    confidenceImpact = 'Confidence is LOW: zero live evidence. The blueprint is domain-grounded but the problem itself is unvalidated.';
  } else if (communityOnly || evidenceStrength < 25) {
    confidenceLevel = 'low';
    confidenceImpact = `Confidence is LOW-to-MEDIUM: ${total} signal(s) but ${communityOnly ? 'community-only' : 'weak overall strength'} — validate before investing significant build time. Community-only evidence also caps IP-readiness.`;
  } else if (sourceCategoriesUsed.length >= 2 && evidenceStrength >= 50) {
    confidenceLevel = 'high';
    confidenceImpact = `Confidence is HIGH: ${total} signal(s) across ${sourceCategoriesUsed.length} categories with strong evidence strength (${evidenceStrength}). The problem framing and data-source choices follow directly from this evidence.`;
  } else {
    confidenceLevel = 'medium';
    confidenceImpact = `Confidence is MEDIUM: ${total} signal(s) (strength ${evidenceStrength}) support the problem, but coverage is narrow — the strongest signals shaped the title and pain framing.`;
  }

  const validationNeededBeforeBuild = [];
  if (!total || communityOnly) validationNeededBeforeBuild.push('Interview or survey 3–5 real target users to confirm the pain point.');
  if (!byCategory.has('public_data') && (classification.dataNeeds || []).length) validationNeededBeforeBuild.push(`Confirm access, licence and rate limits for: ${(classification.dataNeeds || []).slice(0, 2).join('; ')}.`);
  if (classification.ipAnalysisAppropriate) validationNeededBeforeBuild.push('Run a prior-art search on the technical mechanism before claiming any novelty.');
  if ((classification.sensitivityConstraints || []).length) validationNeededBeforeBuild.push('Resolve the listed data-sensitivity constraints (consent, access scoping) before handling real data.');
  if (!validationNeededBeforeBuild.length) validationNeededBeforeBuild.push('Re-verify the strongest evidence sources are still live before the first sprint.');

  return {
    sourceCategoriesUsed,
    strongestSignals,
    weakOrMissingSignals,
    confidenceImpact,
    validationNeededBeforeBuild,
    _meta: { communityOnly, total, confidenceLevel },
  };
}

export default { buildEvidenceSummary };
