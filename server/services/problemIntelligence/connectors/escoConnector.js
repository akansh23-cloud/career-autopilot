/* ============================================================
   Connector — ESCO (EU skills/occupations taxonomy; keyless)
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const ENDPOINT = 'https://ec.europa.eu/esco/api/search';

export async function fetchESCO(ctx = {}, opts = {}) {
  const query = String(ctx.roleQuery || ctx.query || '').trim();
  if (!query) return { ok: false, source: 'esco', items: [], error: 'no query' };

  const limit = Math.min(opts.limit || 5, 10);
  const url = `${ENDPOINT}?text=${encodeURIComponent(query.slice(0, 80))}&language=en&type=occupation&type=skill&limit=${limit}&full=false`;
  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 8000, maxBytes: opts.maxBytes });
  if (!res.ok) return { ok: false, source: 'esco', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'esco', items: [], error: 'malformed response' }; }

  const results = data?._embedded?.results || data?.results || [];
  const items = results.slice(0, limit).map((r) => {
    const isSkill = String(r.className || '').toLowerCase().includes('skill');
    return makeEvidence({
      source: 'esco',
      sourceType: isSkill ? 'skill_taxonomy' : 'career_taxonomy',
      title: r.title || r.preferredLabel?.en || 'ESCO concept',
      summary: sanitizeText(`ESCO ${isSkill ? 'skill' : 'occupation'} concept — standardized European labour-market taxonomy entry useful for role/skill mapping.`, 280),
      url: r.uri || 'https://esco.ec.europa.eu/',
      author: 'European Commission (ESCO)',
      evidenceType: isSkill ? 'skill_taxonomy' : 'career_taxonomy',
      metadata: { className: r.className || '' },
      queryKeywords: ctx.queryKeywords || [],
    });
  });
  return { ok: true, source: 'esco', items };
}

export default { fetchESCO };
