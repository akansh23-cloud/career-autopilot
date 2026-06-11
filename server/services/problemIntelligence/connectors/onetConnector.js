/* ============================================================
   Connector — O*NET Web Services (career taxonomy; requires
   free registered credentials; OFF by default)
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const ENDPOINT = 'https://services.onetcenter.org/ws/online/search';

export async function fetchONET(ctx = {}, opts = {}) {
  if (!opts.username || !opts.password) {
    return { ok: false, source: 'onet', items: [], error: 'O*NET credentials not configured', disabled: true };
  }
  const query = String(ctx.roleQuery || ctx.query || '').trim();
  if (!query) return { ok: false, source: 'onet', items: [], error: 'no query' };

  const auth = Buffer.from(`${opts.username}:${opts.password}`).toString('base64');
  const url = `${ENDPOINT}?keyword=${encodeURIComponent(query.slice(0, 80))}&end=${Math.min(opts.limit || 5, 10)}`;
  const res = await fetchJSON(url, {
    headers: { Authorization: `Basic ${auth}` },
    timeoutMs: opts.timeoutMs || 8000,
    maxBytes: opts.maxBytes,
  });
  if (!res.ok) return { ok: false, source: 'onet', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'onet', items: [], error: 'malformed response' }; }

  const items = (data?.occupation || []).map((o) => makeEvidence({
    source: 'onet',
    sourceType: 'career_taxonomy',
    title: o.title,
    summary: sanitizeText(`O*NET occupation ${o.code || ''}: standardized skills, tasks and outlook data for this role.`, 300),
    url: o.code ? `https://www.onetonline.org/link/summary/${encodeURIComponent(o.code)}` : 'https://www.onetonline.org/',
    author: 'O*NET / US DoL',
    rawScore: o.relevance_score || 0,
    evidenceType: 'career_taxonomy',
    metadata: { code: o.code || '' },
    queryKeywords: ctx.queryKeywords || [],
  }));
  return { ok: true, source: 'onet', items };
}

export default { fetchONET };
