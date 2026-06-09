/* ============================================================
   Service — ingestion
   ------------------------------------------------------------
   Fans out to the allow-listed connectors (core + community),
   privacy-filters community signals, scores source quality,
   merges + dedupes, enriches with query context, caps the total,
   and reports a source mix + community count. Community discovery
   is OFF unless explicitly enabled; per-source failures become
   warnings (never thrown). Cached per-input to respect upstream
   rate limits.
   ============================================================ */
import { piConfig, ALL_SOURCES, COMMUNITY_SOURCES } from './config.js';
import { makeTTLCache, extractKeywords } from './util.js';
import { dedupeSignals } from './dedupeService.js';
import { fetchGithubIssues } from './connectors/githubIssuesConnector.js';
import { fetchStackExchange } from './connectors/stackExchangeConnector.js';
import { fetchArxiv } from './connectors/arxivConnector.js';
import { fetchManual } from './connectors/manualProblemConnector.js';
import { fetchHackerNews } from './connectors/hackerNewsConnector.js';
import { fetchReddit } from './connectors/redditConnector.js';
import { fetchDiscourse } from './connectors/discourseConnector.js';
import { fetchDevto } from './connectors/devtoConnector.js';
import { fetchHashnode } from './connectors/hashnodeConnector.js';
import { fetchSpecializedForum } from './connectors/specializedForumConnector.js';
import { scoreSourceQuality, assessPrivacyRisk, computeSourceMix } from './sourceQualityService.js';
import { filterCommunitySignal } from '../innovationMemory/privacyFilterService.js';

const cache = makeTTLCache(piConfig().cacheTtlMs);
const COMMUNITY_SET = new Set(COMMUNITY_SOURCES);

function cacheKey(input, sources) {
  return JSON.stringify({
    d: input.domain || '', t: input.technology || '', g: input.goal || '',
    u: input.targetUser || '', k: input.keywords || '', s: [...sources].sort(),
    c: input.communities || {}, tr: input.timeRange || '', n: input.limit || 0,
  });
}

export async function ingestSignals(input = {}) {
  const cfg = piConfig();

  // Validate requested sources against the full allow-list.
  const requested = Array.isArray(input.sources) && input.sources.length
    ? input.sources.filter((s) => ALL_SOURCES.includes(s))
    : ['github', 'stackexchange', 'arxiv'];
  const sources = new Set(requested);
  if (Array.isArray(input.manualProblems) && input.manualProblems.length) sources.add('manual');

  const key = cacheKey(input, sources);
  const cached = cache.get(key);
  if (cached) return { ...cached, cached: true };

  const keywords = input.keywords || [input.goal, input.technology].filter(Boolean).join(' ');
  const communityRequested = [...sources].filter((s) => COMMUNITY_SET.has(s));
  const coreCount = Math.max(1, sources.size - communityRequested.length);
  const perSource = Math.max(4, Math.ceil(cfg.maxSignals / Math.max(coreCount, 1)));
  const perCommunity = Math.max(4, Math.ceil(cfg.community.maxSignals / Math.max(communityRequested.length, 1)));
  const ctx = { ...input, keywords, communities: input.communities || {} };

  const tasks = [];
  // ---- core sources ----
  if (sources.has('github') || sources.has('github_discussions')) tasks.push(fetchGithubIssues(ctx, { token: cfg.githubToken, timeoutMs: cfg.timeoutMs, limit: perSource, maxBytes: cfg.maxResponseBytes }));
  if (sources.has('stackexchange')) tasks.push(fetchStackExchange(ctx, { key: cfg.stackExchangeKey, timeoutMs: cfg.timeoutMs, limit: perSource, maxBytes: cfg.maxResponseBytes }));
  if (sources.has('arxiv')) tasks.push(fetchArxiv(ctx, { timeoutMs: cfg.timeoutMs, limit: Math.min(perSource, 10), maxBytes: cfg.maxResponseBytes }));
  if (sources.has('manual')) tasks.push(Promise.resolve(fetchManual(ctx)));

  // ---- community sources (gated by master switch + per-source enable) ----
  const communityWarnings = [];
  if (communityRequested.length && !cfg.community.enabled) {
    communityWarnings.push('Community discovery is disabled (set COMMUNITY_DISCOVERY_ENABLED=1). Showing technical sources only.');
  } else if (communityRequested.length) {
    const copts = { cfg: cfg.community, timeoutMs: cfg.community.timeoutMs, limit: perCommunity, maxBytes: cfg.maxResponseBytes };
    if (sources.has('hackernews')) tasks.push(fetchHackerNews(ctx, copts));
    if (sources.has('reddit')) tasks.push(fetchReddit(ctx, copts));
    if (sources.has('discourse')) tasks.push(fetchDiscourse(ctx, copts));
    if (sources.has('devto')) tasks.push(fetchDevto(ctx, copts));
    if (sources.has('hashnode')) tasks.push(fetchHashnode(ctx, copts));
    if (sources.has('specialized_forum')) tasks.push(fetchSpecializedForum(ctx, copts));
  }

  const settled = await Promise.allSettled(tasks);
  const warnings = [...communityWarnings];
  const bySource = {};
  let all = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled' || !r.value) { warnings.push('A source failed to respond.'); continue; }
    const v = r.value;
    bySource[v.source] = (v.signals || []).length;
    if (v.warning) warnings.push(v.warning);
    if (!v.ok && !(v.signals || []).length) continue;
    all = all.concat(v.signals || []);
  }

  // Privacy-filter community signals BEFORE they go any further; score all signals.
  all = all.map((s) => {
    let sig = s;
    if (COMMUNITY_SET.has(s.source)) sig = { ...s, ...filterCommunitySignal(s, { storeRaw: cfg.community.storeRawComments }) };
    sig.sourceQualityScore = scoreSourceQuality(sig);
    sig.privacyRisk = assessPrivacyRisk(sig);
    return sig;
  });

  // Enrich with the query context so downstream services can group/score.
  const domainTag = input.domain || '';
  for (const s of all) {
    s.domain = s.domain || domainTag;
    s.technology = s.technology || input.technology || '';
    s.targetUser = s.targetUser || input.targetUser || '';
  }

  const { signals, skipped } = dedupeSignals(all);
  const capped = signals.slice(0, cfg.maxSignals + cfg.community.maxSignals);
  if (skipped) warnings.push(`${skipped} duplicate signal(s) skipped.`);

  const sourceMix = computeSourceMix(capped);
  const communitySignalsCount = sourceMix.communityCount;

  const result = {
    signals: capped,
    signalsCount: capped.length,
    communitySignalsCount,
    bySource,
    sourceMix,
    duplicatesSkipped: skipped,
    warnings,
    keywords: extractKeywords(capped.map((s) => `${s.title} ${s.contentSummary}`).join(' '), 14),
  };
  cache.set(key, result);
  return { ...result, cached: false };
}

export const _cache = cache; // exposed for tests
export default { ingestSignals };
