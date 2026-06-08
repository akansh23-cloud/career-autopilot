/* ============================================================
   Service — clustering
   ------------------------------------------------------------
   Deterministic agglomerative-ish clustering over signal keyword
   sets (Jaccard similarity). No AI required (so it works in
   fallback mode). Produces deduped clusters with evidence links.
   ============================================================ */
import { extractKeywords, jaccard, normalizeText, sanitizeText } from './util.js';
import { clusterFingerprint } from './dedupeService.js';

const SIM_THRESHOLD = 0.12;
// Generic words that make poor cluster/project titles.
const WEAK_TITLE_WORDS = new Set(['fails', 'fail', 'error', 'errors', 'issue', 'issues', 'problem', 'problems', 'using', 'need', 'want', 'hard', 'broken', 'cannot', 'unable']);

function keywordSet(signal) {
  const kws = new Set([
    ...(signal.tags || []).map((t) => normalizeText(t)).filter(Boolean),
    ...extractKeywords(`${signal.title} ${signal.contentSummary}`, 8),
  ]);
  return kws;
}

export function clusterSignals(signals = [], context = {}) {
  const enriched = signals.map((s) => ({ signal: s, kw: keywordSet(s) }));
  const groups = [];

  for (const item of enriched) {
    let best = null; let bestSim = 0;
    for (const g of groups) {
      const sim = jaccard(item.kw, g.kw);
      if (sim > bestSim) { bestSim = sim; best = g; }
    }
    if (best && bestSim >= SIM_THRESHOLD) {
      best.items.push(item);
      for (const k of item.kw) best.kw.add(k);
    } else {
      groups.push({ items: [item], kw: new Set(item.kw) });
    }
  }

  const clusters = groups
    .map((g) => buildCluster(g, context))
    .filter(Boolean);

  // Dedupe clusters by fingerprint (normalized title + keywords + domain).
  const seen = new Set();
  const deduped = [];
  let skipped = 0;
  for (const c of clusters) {
    const fp = c.dedupeFingerprint;
    if (seen.has(fp)) { skipped++; continue; }
    seen.add(fp);
    deduped.push(c);
  }
  // Largest / strongest evidence first.
  deduped.sort((a, b) => b.signalCount - a.signalCount);
  return { clusters: deduped, duplicatesSkipped: skipped };
}

function buildCluster(group, context) {
  const items = group.items;
  if (!items.length) return null;
  const signals = items.map((i) => i.signal);
  const keywords = [...group.kw].slice(0, 10);
  // Title: most representative signal title, trimmed + keyword-flavored.
  const rep = signals.slice().sort((a, b) => (engagementScore(b) - engagementScore(a)))[0];
  const title = sanitizeText(deriveTitle(rep, keywords, context), 120);
  const summary = sanitizeText(
    `${signals.length} related signal(s) point to friction around ${keywords.slice(0, 4).join(', ') || 'this area'}. Representative: "${rep.title}".`,
    600,
  );
  const cluster = {
    title,
    summary,
    domain: context.domain || rep.domain || '',
    technology: context.technology || rep.technology || '',
    targetUser: context.targetUser || rep.targetUser || '',
    keywords,
    signals,                       // hydrated (not persisted as-is)
    signalIds: [],                 // filled after persistence
    signalCount: signals.length,
    sources: [...new Set(signals.map((s) => s.source))],
    topSources: signals.filter((s) => s.sourceUrl).slice(0, 4).map((s) => ({ source: s.source, title: s.title, url: s.sourceUrl })),
    isResearchHeavy: signals.filter((s) => s.source === 'arxiv').length >= Math.ceil(signals.length / 2),
  };
  cluster.dedupeFingerprint = clusterFingerprint(cluster);
  return cluster;
}

function deriveTitle(rep, keywords, context) {
  const tu = context.targetUser || rep.targetUser;
  // Prefer the representative signal's headline (cleaned), which reads far more
  // naturally than concatenated keywords. Fall back to strong keywords.
  let base = rep.title.split(/[:\-—|]/)[0].trim();
  if (base.length > 64) base = base.slice(0, 61).trim() + '…';
  if (base.length < 8) {
    const strong = keywords.filter((k) => !WEAK_TITLE_WORDS.has(k)).slice(0, 2);
    base = strong.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(' ') || base;
  }
  return tu ? `${base} — pain for ${tu}` : base;
}

function engagementScore(s) {
  const e = s.engagement || {};
  return (Number(e.reactions) || 0) * 3 + (Number(e.score) || 0) * 3 + (Number(e.comments) || 0) + (Number(e.answers) || 0) + (Number(e.views) || 0) / 100;
}

export default { clusterSignals };
