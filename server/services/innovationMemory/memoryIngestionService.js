/* ============================================================
   Innovation memory — ingestion
   ------------------------------------------------------------
   Converts signals / clusters / generated projects into SAFE
   memory chunks: privacy-filtered, source-quality-scored,
   summarized (never raw dumps), then embedded (if enabled) and
   stored. This is the only path that writes memory.
   ============================================================ */
import { piConfig } from '../problemIntelligence/config.js';
import { sha1, extractKeywords, sanitizeText } from '../problemIntelligence/util.js';
import { scoreSourceQuality, assessPrivacyRisk } from '../problemIntelligence/sourceQualityService.js';
import { neutralize, stripIdentifiers } from './privacyFilterService.js';
import { getEmbedder } from './embeddingProvider.js';
import { saveChunks } from './memoryStore.js';

const COMMUNITY = new Set(['reddit', 'hackernews', 'discourse', 'devto', 'hashnode', 'specialized_forum']);

function chunkFromSignal(s) {
  const isCommunity = COMMUNITY.has(s.source);
  const safe = isCommunity ? neutralize(s.contentSummary || s.title || '') : sanitizeText(s.contentSummary || s.title || '', 600);
  return {
    sourceType: isCommunity ? 'discussion_signal' : 'problem_signal',
    sourcePlatform: s.source,
    sourceId: s.sourceId || '',
    sourceUrl: s.sourceUrl || '',
    visibility: 'private',
    title: stripIdentifiers(s.title || '').slice(0, 200),
    text: safe.slice(0, 1200),
    safeSummary: safe.slice(0, 400),
    domain: s.domain || '', technology: s.technology || '',
    tags: s.tags || [],
    painPoints: (s.extractedPainPoints || []).map((p) => neutralize(p).slice(0, 180)),
    constraints: s.extractedConstraints || [],
    currentWorkarounds: s.currentWorkarounds || [],
    requestedFeatures: s.requestedFeatures || [],
    sourceQualityScore: scoreSourceQuality(s),
    privacyRisk: assessPrivacyRisk(s),
    confidence: 'low',
    keywords: extractKeywords(`${s.title} ${safe}`, 12),
    fingerprint: s.rawTextHash || sha1(`${s.source}:${s.title}`),
  };
}

function chunkFromCluster(c) {
  const safe = sanitizeText(c.summary || c.title || '', 600);
  return {
    sourceType: 'problem_cluster', sourcePlatform: (c.sources || [])[0] || 'mixed',
    sourceId: c.id || c.dedupeFingerprint || '', visibility: 'private',
    title: sanitizeText(c.title, 200), text: safe, safeSummary: safe.slice(0, 400),
    domain: c.domain || '', technology: c.technology || '',
    tags: c.keywords || [], painPoints: [], confidence: 'low',
    sourceQualityScore: Math.round(c.evidenceStrengthScore || 0), privacyRisk: 'low',
    keywords: c.keywords?.length ? c.keywords : extractKeywords(`${c.title} ${safe}`, 12),
    fingerprint: c.dedupeFingerprint || sha1(`cluster:${c.title}`),
  };
}

function chunkFromProject(p, visibility = 'private') {
  const safe = sanitizeText(p.proposedSolution || p.painPoint || p.title || '', 700);
  return {
    sourceType: 'generated_project', sourcePlatform: 'innovation-os',
    sourceId: p.id || p.fingerprint || '', visibility,
    title: sanitizeText(p.title, 200), text: safe, safeSummary: sanitizeText(p.painPoint || safe, 400),
    domain: p.domain || '', technology: p.technology || '', skills: p.requiredSkills || [],
    tags: p.requiredSkills || [], painPoints: [sanitizeText(p.painPoint, 180)].filter(Boolean),
    sourceQualityScore: Math.round(p.evidenceStrength || 0), privacyRisk: 'low', confidence: p.confidence || 'low',
    keywords: extractKeywords(`${p.title} ${p.painPoint} ${p.proposedSolution} ${p.noveltyAngle}`, 16),
    fingerprint: p.fingerprint || sha1(`project:${p.title}`),
  };
}

export async function ingestDiscovery({ userId, email, collegeId = '', signals = [], clusters = [], cfg = piConfig() }) {
  if (!cfg.memory?.enabled) return { ok: false, reason: 'memory_disabled', saved: 0 };
  const chunks = [
    ...signals.slice(0, 60).map(chunkFromSignal),
    ...clusters.slice(0, 30).map(chunkFromCluster),
  ];
  await maybeEmbed(chunks, cfg);
  return saveChunks({ userId, email, collegeId, chunks });
}

export async function ingestProject({ userId, email, collegeId = '', project, visibility = 'private', cfg = piConfig() }) {
  if (!cfg.memory?.enabled || !project) return { ok: false, reason: 'memory_disabled_or_empty', saved: 0 };
  const chunks = [chunkFromProject(project, visibility)];
  await maybeEmbed(chunks, cfg);
  return saveChunks({ userId, email, collegeId, chunks });
}

async function maybeEmbed(chunks, cfg) {
  const embedder = getEmbedder(cfg);
  if (!embedder.enabled || !chunks.length) return;
  try {
    const vectors = await embedder.embed(chunks.map((c) => `${c.title}. ${c.safeSummary}`));
    chunks.forEach((c, i) => { if (Array.isArray(vectors[i])) c.embedding = vectors[i]; });
  } catch { /* keyword fallback */ }
}

export { chunkFromSignal, chunkFromCluster, chunkFromProject };
export default { ingestDiscovery, ingestProject };
