/* ============================================================
   Connector — Stack Exchange / Stack Overflow
   ------------------------------------------------------------
   Uses the official /2.3/search/advanced endpoint. Works
   WITHOUT a key (lower quota); STACKEXCHANGE_KEY raises the
   quota when present. Returns normalized signals; [] on error.
   The SE API gzip-encodes responses; Node's fetch transparently
   decompresses, so we parse JSON directly.
   ============================================================ */
import { fetchJSON, sanitizeText, sha1, extractKeywords, parseLooseJSON } from '../util.js';

const API = 'https://api.stackexchange.com/2.3/search/advanced';

function buildQ({ domain, technology, goal, keywords }) {
  return [keywords, technology, domain, goal].filter(Boolean).join(' ').trim().slice(0, 200) || 'common workflow pain';
}

export async function fetchStackExchange(input = {}, { key = '', timeoutMs = 12000, limit = 12, maxBytes = 2_000_000, site = 'stackoverflow' } = {}) {
  const params = new URLSearchParams({
    order: 'desc',
    sort: 'votes',
    q: buildQ(input),
    site,
    pagesize: String(Math.min(Number(limit) || 12, 30)),
    filter: 'withbody', // include question body
  });
  if (key) params.set('key', key);

  const res = await fetchJSON(`${API}?${params.toString()}`, { timeoutMs, maxBytes });
  if (!res.ok) {
    return { ok: false, source: 'stackexchange', mode: key ? 'keyed' : 'keyless', signals: [], warning: seWarning(res, key) };
  }
  const data = parseLooseJSON(res.text);
  if (data?.error_id) {
    return { ok: false, source: 'stackexchange', mode: key ? 'keyed' : 'keyless', signals: [], warning: `Stack Exchange error: ${sanitizeText(data.error_message, 120)}` };
  }
  const items = Array.isArray(data?.items) ? data.items : [];
  const signals = items.map((it) => normalize(it, site)).filter(Boolean);
  const warning = data?.quota_remaining != null && data.quota_remaining < 10 && !key
    ? 'Stack Exchange keyless quota is nearly exhausted. Add STACKEXCHANGE_KEY for higher limits.'
    : '';
  return { ok: true, source: 'stackexchange', mode: key ? 'keyed' : 'keyless', signals, warning };
}

function normalize(it, site) {
  const title = sanitizeText(it.title, 280);
  if (!title) return null;
  const body = sanitizeText(it.body, 1200);
  const tags = [...(Array.isArray(it.tags) ? it.tags.map((t) => sanitizeText(t, 40)) : []), ...extractKeywords(title, 4)]
    .filter(Boolean).slice(0, 12);
  return {
    source: 'stackexchange',
    sourceId: String(it.question_id || sha1(it.link || title)),
    sourceUrl: typeof it.link === 'string' ? it.link.slice(0, 500) : '',
    title,
    contentSummary: body || title,
    rawTextHash: sha1(`${title}\n${body}`),
    tags,
    engagement: {
      score: Number(it.score) || 0,
      answers: Number(it.answer_count) || 0,
      views: Number(it.view_count) || 0,
      isAnswered: !!it.is_answered,
      site,
    },
    sourceCreatedAt: it.creation_date ? new Date(it.creation_date * 1000) : null,
    lastActivityAt: it.last_activity_date ? new Date(it.last_activity_date * 1000) : null,
  };
}

function seWarning(res, key) {
  if (res.status === 400) return 'Stack Exchange rejected the query (throttled or bad request).';
  if (res.error === 'timeout') return 'Stack Exchange request timed out.';
  return key ? `Stack Exchange unavailable (status ${res.status}).` : `Stack Exchange unavailable (status ${res.status}). A STACKEXCHANGE_KEY raises the quota.`;
}

export default { fetchStackExchange };

// Back-compat alias used by the legacy problem-intelligence index.
export const fetchStackExchangeSignals = fetchStackExchange;
