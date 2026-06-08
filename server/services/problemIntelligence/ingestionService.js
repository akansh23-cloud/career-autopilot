/* ============================================================
   Service — ingestion
   ------------------------------------------------------------
   Fans out to the allow-listed connectors, merges + dedupes the
   normalized signals, enriches each with domain/technology/
   targetUser context, and caps the total. Per-source failures
   are collected as warnings (never thrown). Results are cached
   per-input for cacheTtlMs to respect upstream rate limits.
   ============================================================ */
import { piConfig, ALLOWED_SOURCES } from './config.js';
import { makeTTLCache, extractKeywords } from './util.js';
import { dedupeSignals } from './dedupeService.js';
import { fetchGithubIssues } from './connectors/githubIssuesConnector.js';
import { fetchStackExchange } from './connectors/stackExchangeConnector.js';
import { fetchArxiv } from './connectors/arxivConnector.js';
import { fetchManual } from './connectors/manualProblemConnector.js';

const cache = makeTTLCache(piConfig().cacheTtlMs);

function cacheKey(input, sources) {
  return JSON.stringify({
    d: input.domain || '', t: input.technology || '', g: input.goal || '',
    u: input.targetUser || '', k: input.keywords || '', s: [...sources].sort(),
    n: input.limit || 0,
  });
}

export async function ingestSignals(input = {}) {
  const cfg = piConfig();
  const requested = Array.isArray(input.sources) && input.sources.length
    ? input.sources.filter((s) => ALLOWED_SOURCES.includes(s))
    : ['github', 'stackexchange', 'arxiv'];
  const sources = new Set(requested);
  if (Array.isArray(input.manualProblems) && input.manualProblems.length) sources.add('manual');

  const key = cacheKey(input, sources);
  const cached = cache.get(key);
  if (cached) return { ...cached, cached: true };

  const keywords = input.keywords || [input.goal, input.technology].filter(Boolean).join(' ');
  const perSource = Math.max(4, Math.ceil(cfg.maxSignals / Math.max(sources.size, 1)));
  const ctx = { ...input, keywords };

  const tasks = [];
  if (sources.has('github')) tasks.push(fetchGithubIssues(ctx, { token: cfg.githubToken, timeoutMs: cfg.timeoutMs, limit: perSource, maxBytes: cfg.maxResponseBytes }));
  if (sources.has('stackexchange')) tasks.push(fetchStackExchange(ctx, { key: cfg.stackExchangeKey, timeoutMs: cfg.timeoutMs, limit: perSource, maxBytes: cfg.maxResponseBytes }));
  if (sources.has('arxiv')) tasks.push(fetchArxiv(ctx, { timeoutMs: cfg.timeoutMs, limit: Math.min(perSource, 10), maxBytes: cfg.maxResponseBytes }));
  if (sources.has('manual')) tasks.push(Promise.resolve(fetchManual(ctx)));

  const settled = await Promise.allSettled(tasks);
  const warnings = [];
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

  // Enrich with the query context so downstream services can group/score.
  const domainTag = input.domain || '';
  for (const s of all) {
    s.domain = s.domain || domainTag;
    s.technology = s.technology || input.technology || '';
    s.targetUser = s.targetUser || input.targetUser || '';
  }

  const { signals, skipped } = dedupeSignals(all);
  const capped = signals.slice(0, cfg.maxSignals);
  if (skipped) warnings.push(`${skipped} duplicate signal(s) skipped.`);

  const result = {
    signals: capped,
    signalsCount: capped.length,
    bySource,
    duplicatesSkipped: skipped,
    warnings,
    keywords: extractKeywords(capped.map((s) => `${s.title} ${s.contentSummary}`).join(' '), 14),
  };
  cache.set(key, result);
  return { ...result, cached: false };
}

export const _cache = cache; // exposed for tests
export default { ingestSignals };
