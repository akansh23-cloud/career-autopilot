/* ============================================================
   Career Intelligence — evidence normalizer
   ------------------------------------------------------------
   Every connector output is converted into ONE common evidence
   shape before scoring, clustering or rendering. The frontend
   never sees raw API payloads — only this normalized form.
   ============================================================ */
import { sanitizeText, extractKeywords, sha1, clamp, lc, normalizeText } from '../problemIntelligence/util.js';

export const SOURCE_TYPES = [
  'community_pain_point', 'research_paper', 'public_dataset', 'government_data',
  'career_taxonomy', 'skill_taxonomy', 'market_signal', 'local_business_signal',
  'security_vulnerability', 'tutorial_or_learning', 'encyclopedia_context', 'code_signal',
];

/* Editorially-assigned base trust per source (0..1). Government / standards
   bodies > peer review indexes > encyclopedias > community chatter. */
const BASE_TRUST = {
  nvd: 0.95, fda: 0.92, census: 0.92, datagov: 0.9, worldbank: 0.9, nasa: 0.9,
  onet: 0.88, esco: 0.88, openmeteo: 0.85, crossref: 0.85, openalex: 0.85,
  arxiv: 0.78, wikipedia: 0.7, openstreetmap: 0.72, github: 0.65, stackexchange: 0.6,
  devto: 0.5, hashnode: 0.5, youtube: 0.45, googlemaps: 0.6, hackernews: 0.5,
  reddit: 0.45, discourse: 0.45, specialized_forum: 0.45, manual: 0.4,
};

function freshness(publishedDate, now = Date.now()) {
  if (!publishedDate) return 0.4;
  const t = new Date(publishedDate).getTime();
  if (!Number.isFinite(t)) return 0.4;
  const days = Math.max(0, (now - t) / 86400000);
  if (days <= 30) return 1;
  if (days <= 180) return 0.85;
  if (days <= 365) return 0.7;
  if (days <= 365 * 3) return 0.5;
  return 0.3;
}

/* Token-overlap relevance against query keywords (0..1). Deterministic. */
export function relevanceTo(keywords = [], text = '') {
  if (!keywords.length) return 0.5;
  const t = lc(text);
  let hits = 0;
  for (const k of keywords) if (k && t.includes(lc(k))) hits++;
  return clamp(hits / Math.min(keywords.length, 6), 0, 1);
}

/* Build a normalized evidence item. Connectors call this directly. */
export function makeEvidence({
  source, sourceType, title = '', summary = '', url = '', publishedDate = null,
  author = '', rawScore = 0, tags = [], domain = '', evidenceType = '',
  excerpt = '', metadata = {}, queryKeywords = [],
} = {}) {
  const cleanTitle = sanitizeText(title, 240);
  const cleanSummary = sanitizeText(summary, 700);
  const fullText = `${cleanTitle} ${cleanSummary}`;
  return {
    id: 'ev_' + sha1(`${source}|${url}|${cleanTitle}`).slice(0, 16),
    source: String(source || 'unknown'),
    sourceType: SOURCE_TYPES.includes(sourceType) ? sourceType : 'market_signal',
    title: cleanTitle || '(untitled)',
    summary: cleanSummary,
    url: sanitizeText(url, 500),
    publishedDate: publishedDate || null,
    author: sanitizeText(author, 120),
    rawScore: Number.isFinite(rawScore) ? rawScore : 0,
    relevanceScore: Math.round(relevanceTo(queryKeywords, fullText) * 100),
    freshnessScore: Math.round(freshness(publishedDate) * 100),
    trustScore: Math.round((BASE_TRUST[source] ?? 0.5) * 100),
    tags: (Array.isArray(tags) ? tags : []).slice(0, 8).map((t) => sanitizeText(t, 40)),
    domain: sanitizeText(domain, 60),
    evidenceType: sanitizeText(evidenceType || sourceType, 40),
    excerpt: sanitizeText(excerpt || cleanSummary, 280),
    metadata: safeMetadata(metadata),
    keywords: extractKeywords(fullText, 8),
  };
}

/* Strip anything large / nested / secret-looking from metadata. */
function safeMetadata(meta = {}) {
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(meta || {})) {
    if (n >= 12) break;
    if (/key|token|secret|password|credential/i.test(k)) continue;
    if (v == null) continue;
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; n++; }
    else if (typeof v === 'string') { out[k] = sanitizeText(v, 200); n++; }
    else if (Array.isArray(v)) { out[k] = v.slice(0, 6).map((x) => sanitizeText(String(x), 80)); n++; }
  }
  return out;
}

/* Convert an existing Innovation OS community signal (reddit / HN / GitHub /
   Stack Exchange / arXiv / dev.to / …) into the common evidence shape so the
   whole pipeline reasons over one format. */
export function fromCommunitySignal(signal = {}, queryKeywords = []) {
  const src = signal.source || 'manual';
  const isResearch = src === 'arxiv';
  const isCode = src === 'github' || src === 'github_discussions';
  return makeEvidence({
    source: src,
    sourceType: isResearch ? 'research_paper' : isCode ? 'code_signal' : 'community_pain_point',
    title: signal.title,
    summary: signal.contentSummary || signal.discussionSummary || '',
    url: signal.sourceUrl || '',
    publishedDate: signal.sourceCreatedAt || signal.lastActivityAt || null,
    author: '',
    rawScore: signal.engagement?.score || signal.engagement?.reactions || 0,
    tags: signal.tags || [],
    domain: signal.domain || '',
    evidenceType: isResearch ? 'research_paper' : isCode ? 'code_signal' : 'community_pain_point',
    excerpt: (signal.extractedPainPoints || [])[0] || '',
    metadata: { community: signal.sourceCommunity || '', comments: signal.engagement?.comments || 0, painPoints: (signal.extractedPainPoints || []).slice(0, 3) },
    queryKeywords,
  });
}

/* Deduplicate evidence by id (stable hash of source+url+title). */
export function dedupeEvidence(items = []) {
  const seen = new Set();
  const out = [];
  for (const e of items) {
    if (!e) continue;
    // Same record can arrive from multiple connectors (e.g. Crossref and
    // OpenAlex indexing the same paper) — dedupe on id, URL and title.
    const keys = [
      e.id,
      e.url ? 'u:' + lc(String(e.url)).replace(/\/+$/, '') : '',
      e.title ? 't:' + normalizeText(String(e.title)) : '',
    ].filter(Boolean);
    if (keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);
    out.push(e);
  }
  return out;
}

export default { makeEvidence, fromCommunitySignal, dedupeEvidence, relevanceTo, SOURCE_TYPES };
