/* ============================================================
   Connector — specialized public forums  (ALLOWLISTED only)
   ------------------------------------------------------------
   Disabled by default. Only configured, allowlisted sources are
   queried, and only via official API, RSS, public JSON, a
   configured Discourse instance, or manually uploaded summaries.
   NEVER scrapes arbitrary HTML. Sensitive/closed/login-only
   communities are rejected.
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { normalizeCommunitySignal, ok, disabled } from './communityCommon.js';

const SENSITIVE = /(health|medical|mental|legal|finance|relationship|dating)/i;

function parseAllowed(list) {
  // Each entry may be JSON ({name,baseUrl,sourceType,...}) or "name|baseUrl|type".
  const out = [];
  for (const raw of list || []) {
    if (!raw) continue;
    try { const o = JSON.parse(raw); if (o && o.baseUrl) { out.push(o); continue; } } catch { /* not json */ }
    const [name, baseUrl, sourceType = 'rss', category = '', domain = ''] = String(raw).split('|');
    if (baseUrl) out.push({ name: name || baseUrl, baseUrl, sourceType, category, domain });
  }
  return out.filter((s) => !SENSITIVE.test(s.name || '') && !SENSITIVE.test(s.category || ''));
}

function parseRSS(xml, source) {
  const items = [];
  const blocks = xml.split(/<item[ >]/i).slice(1);
  for (const b of blocks.slice(0, 12)) {
    const title = (b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const link = (b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
    const desc = (b.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '';
    const date = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
    const clean = (s) => sanitizeText(String(s).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' '), 600);
    if (!title) continue;
    items.push({ title: clean(title), link: clean(link), desc: clean(desc), date: clean(date), source: source.name });
  }
  return items;
}

export async function fetchSpecializedForum(ctx = {}, opts = {}) {
  const cfg = (opts.cfg && opts.cfg.specializedForum) || {};
  if (!cfg.enabled) return disabled('specialized_forum', 'Specialized forums are disabled (set SPECIALIZED_FORUM_DISCOVERY_ENABLED=1).');
  const sources = parseAllowed(cfg.allowedSources);
  if (!sources.length) return disabled('specialized_forum', 'No allowlisted specialized forum sources configured (SPECIALIZED_FORUM_ALLOWED_SOURCES).');

  const limit = Math.min(opts.limit || 8, 15);
  const all = [];
  const warnings = [];

  for (const s of sources.slice(0, 3)) {
    if (s.sourceType === 'manual') {
      for (const m of (s.items || []).slice(0, limit)) {
        all.push(normalizeCommunitySignal({ source: 'specialized_forum', sourceUrl: m.url || s.baseUrl, sourceId: m.id || m.title, sourceCommunity: s.name, title: m.title, body: m.summary || m.title, tags: m.tags || [], engagement: {} }));
      }
      continue;
    }
    const res = await fetchJSON(s.baseUrl, { timeoutMs: opts.timeoutMs || 12000, maxBytes: opts.maxBytes, accept: s.sourceType === 'rss' ? 'application/rss+xml, application/xml, text/xml' : 'application/json' });
    if (!res.ok) { warnings.push(`${s.name} failed (${res.status || res.error}).`); continue; }

    if (s.sourceType === 'rss') {
      for (const it of parseRSS(res.text, s).slice(0, limit)) {
        all.push(normalizeCommunitySignal({ source: 'specialized_forum', sourceUrl: it.link, sourceId: it.link || it.title, sourceCommunity: s.name, title: it.title, body: it.desc, tags: [s.category].filter(Boolean), engagement: {}, createdAt: it.date || null }));
      }
    } else { // api / public json (Discourse-like)
      let data; try { data = JSON.parse(res.text); } catch { warnings.push(`${s.name} malformed.`); continue; }
      const arr = Array.isArray(data) ? data : (data.topics || data.items || data.results || []);
      for (const it of arr.slice(0, limit)) {
        all.push(normalizeCommunitySignal({ source: 'specialized_forum', sourceUrl: it.url || it.link || s.baseUrl, sourceId: String(it.id || it.url || it.title || ''), sourceCommunity: s.name, title: it.title || it.name || 'Forum item', body: it.summary || it.excerpt || it.description || it.title || '', tags: it.tags || [s.category].filter(Boolean), engagement: { comments: it.replies || it.comments || 0, views: it.views || 0 }, createdAt: it.created_at || it.date || null }));
      }
    }
  }

  return ok('specialized_forum', all.slice(0, limit), warnings.join(' ') || '');
}

export default { fetchSpecializedForum };
