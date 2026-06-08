/* ============================================================
   Service — deduplication
   ------------------------------------------------------------
   Three layers of dedupe:
     1. signals  — by rawTextHash + source:sourceId
     2. clusters — by normalized-title + top-keyword fingerprint
     3. projects — by userId + project fingerprint
   ============================================================ */
import { fingerprint, normalizeText, extractKeywords } from './util.js';

/* In-memory signal dedupe within a single discovery run. */
export function dedupeSignals(signals = []) {
  const seen = new Set();
  const out = [];
  let skipped = 0;
  for (const s of signals) {
    const key = s.rawTextHash || `${s.source}:${s.sourceId}`;
    const titleKey = `t:${normalizeText(s.title)}`;
    if (seen.has(key) || seen.has(titleKey)) { skipped++; continue; }
    seen.add(key); seen.add(titleKey);
    out.push(s);
  }
  return { signals: out, skipped };
}

export function clusterFingerprint(cluster) {
  const kws = (cluster.keywords && cluster.keywords.length ? cluster.keywords : extractKeywords(`${cluster.title} ${cluster.summary}`, 6))
    .slice(0, 6).sort();
  return fingerprint(normalizeText(cluster.title), cluster.domain || '', kws.join(' '));
}

export function projectFingerprint(project) {
  return fingerprint(
    normalizeText(project.title),
    project.domain || '',
    normalizeText((project.painPoint || '').slice(0, 200)),
  );
}

export default { dedupeSignals, clusterFingerprint, projectFingerprint };
