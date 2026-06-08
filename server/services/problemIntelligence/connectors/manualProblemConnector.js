/* ============================================================
   Connector — manual problem bank (fallback, no network)
   ------------------------------------------------------------
   Lets a user paste their own problem statements when external
   sources are unavailable / rate-limited, or when they already
   know a concrete pain point. Pure normalization; sanitizes all
   text before it ever touches the DB or the UI.
   ============================================================ */
import { sanitizeText, sha1, extractKeywords } from '../util.js';

export function fetchManual(input = {}) {
  const raw = Array.isArray(input.manualProblems) ? input.manualProblems : [];
  const signals = raw.map((p) => normalize(p)).filter(Boolean).slice(0, 30);
  return { ok: true, source: 'manual', mode: 'manual', signals };
}

function normalize(p) {
  const title = sanitizeText(typeof p === 'string' ? p : p?.title, 280);
  if (!title) return null;
  const body = sanitizeText(typeof p === 'string' ? '' : (p?.description || p?.body), 1200);
  const url = typeof p === 'object' && typeof p?.sourceUrl === 'string' ? p.sourceUrl.slice(0, 500) : '';
  return {
    source: 'manual',
    sourceId: sha1(`${title}\n${body}`),
    sourceUrl: /^https?:\/\//i.test(url) ? url : '', // store but never auto-fetch
    title,
    contentSummary: body || title,
    rawTextHash: sha1(`${title}\n${body}`),
    tags: [...(Array.isArray(p?.tags) ? p.tags.map((t) => sanitizeText(t, 40)) : []), ...extractKeywords(`${title} ${body}`, 6)].filter(Boolean).slice(0, 12),
    engagement: { manual: true },
    sourceCreatedAt: new Date(),
    lastActivityAt: new Date(),
  };
}

export default { fetchManual };
