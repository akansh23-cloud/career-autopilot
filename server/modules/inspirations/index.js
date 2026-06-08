/* ============================================================
   LIVE INSPIRATION ENGINE — orchestrator
   ------------------------------------------------------------
   Fetches from external sources (only those with available creds / public
   APIs), normalizes -> dedups -> ranks. If everything fails or returns
   nothing, falls back to the seed ideas so the feature never breaks.
   External APIs are only ever called here (backend), never the frontend.
   ============================================================ */
import { fetchHackerNews } from './fetchHackerNews.js';
import { fetchGithubTrends } from './fetchGithubTrends.js';
import { fetchProductHunt } from './fetchProductHunt.js';
import { normalizeInspiration } from './normalizeInspiration.js';
import { deduplicateInspirations } from './deduplicateInspirations.js';
import { rankInspirations } from './rankInspirations.js';
import { generateProjectBlueprint } from './generateProjectBlueprint.js';
import { SEED_INSPIRATIONS } from './seedInspirations.js';

export { generateProjectBlueprint };

export async function buildInspirations({ limit = 30 } = {}) {
  const sources = { github: false, producthunt: false, hackernews: false, seed: false };
  let raw = [];

  const results = await Promise.allSettled([
    fetchGithubTrends(), fetchHackerNews(), fetchProductHunt(),
  ]);
  const [gh, hn, ph] = results.map((r) => (r.status === 'fulfilled' ? r.value : []));
  if (gh.length) { sources.github = true; raw.push(...gh); }
  if (hn.length) { sources.hackernews = true; raw.push(...hn); }
  if (ph.length) { sources.producthunt = true; raw.push(...ph); }

  // Fallback to seed ideas if no external source produced anything.
  if (!raw.length) { sources.seed = true; raw = [...SEED_INSPIRATIONS]; }

  const normalized = raw.map(normalizeInspiration);
  const deduped = deduplicateInspirations(normalized);
  const ranked = rankInspirations(deduped).slice(0, limit);

  return { inspirations: ranked, sources, fetchedAt: new Date().toISOString(), usedFallback: sources.seed };
}

export default { buildInspirations, generateProjectBlueprint };
