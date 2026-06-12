/* ============================================================
   LIVE PRIOR-ART SEARCH  (optional, fully degradable — Phase 3)
   ------------------------------------------------------------
   Queries the public Google Patents endpoint and Crossref for the
   idea's key terms and returns up to 5 CANDIDATE prior-art items —
   titles/links only, explicitly labeled unverified. The deterministic
   prior-art PLAN never depends on this: when offline, rate-limited or
   under NODE_ENV=test, callers get { ok:false, candidates: [] } and the
   plan remains fully useful.
   Guarantees:
   - NODE_ENV=test NEVER makes a network call (hard gate, tested).
   - Per-query TTL cache (30 min) bounds repeat traffic.
   - Both connectors run under their own timeouts; one failing never
     hides the other's results.
   ============================================================ */
import { fetchGooglePatents } from './connectors/googlePatentsConnector.js';
import { fetchCrossref } from './connectors/crossrefConnector.js';

const TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 100;
const cache = new Map(); // query -> { at, result }

function cacheGet(q) {
  const hit = cache.get(q);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) { cache.delete(q); return null; }
  return hit.result;
}
function cacheSet(q, result) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // drop oldest
  cache.set(q, { at: Date.now(), result });
}
export function _clearLivePriorArtCache() { cache.clear(); } // test hook

/* Key terms from the idea: title + mechanism nouns, deterministic. */
export function priorArtQueryTerms(idea = {}) {
  const text = [idea.title, idea.technicalMechanism, idea.noveltyAngle].filter(Boolean).join(' ');
  const words = String(text).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !['with', 'that', 'this', 'from', 'into', 'using', 'based'].includes(w));
  return Array.from(new Set(words)).slice(0, 8).join(' ');
}

/**
 * searchLivePriorArt(idea, opts) → { ok, query, candidates[], sources, skipped? }
 * candidates: [{ source, title, url, publishedDate, verified:false, label }]
 */
export async function searchLivePriorArt(idea = {}, opts = {}) {
  // Hard test-mode gate: the test suite must never touch the network.
  if (process.env.NODE_ENV === 'test' && process.env.LIVE_PRIOR_ART_TEST_OVERRIDE !== '1') {
    return { ok: false, skipped: 'test_mode', query: priorArtQueryTerms(idea), candidates: [], sources: [] };
  }
  if (process.env.LIVE_PRIOR_ART_DISABLED === '1') {
    return { ok: false, skipped: 'disabled', query: priorArtQueryTerms(idea), candidates: [], sources: [] };
  }
  const query = priorArtQueryTerms(idea);
  if (!query) return { ok: false, skipped: 'no_terms', query: '', candidates: [], sources: [] };

  const cached = cacheGet(query);
  if (cached) return { ...cached, cached: true };

  const timeoutMs = opts.timeoutMs || 6000;
  const [patents, papers] = await Promise.allSettled([
    fetchGooglePatents({ query }, { timeoutMs, limit: 5 }),
    fetchCrossref({ query }, { timeoutMs, limit: 4 }),
  ]);

  const candidates = [];
  const sources = [];
  if (patents.status === 'fulfilled' && patents.value.ok) {
    sources.push('google_patents');
    for (const it of patents.value.items) {
      candidates.push({ source: 'google_patents', title: it.title, url: it.url, publishedDate: it.publishedDate || null, verified: false });
    }
  }
  if (papers.status === 'fulfilled' && papers.value.ok) {
    sources.push('crossref');
    for (const it of papers.value.items) {
      candidates.push({ source: 'crossref', title: it.title || '', url: it.url || '', publishedDate: it.publishedDate || null, verified: false });
    }
  }

  const top = candidates.filter((c) => c.title && c.url).slice(0, 5)
    .map((c) => ({ ...c, label: 'Candidate prior art to review (unverified — read the document before drawing conclusions)' }));

  const result = { ok: top.length > 0, query, candidates: top, sources };
  // Cache even empty/offline results briefly so a flaky network can't
  // turn one user action into a burst of outbound calls.
  cacheSet(query, result);
  return result;
}

export default { searchLivePriorArt, priorArtQueryTerms, _clearLivePriorArtCache };
