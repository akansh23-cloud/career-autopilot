/* ============================================================
   EXTERNAL ROLE + COMPANY INTELLIGENCE — Narrative stage 4
   ------------------------------------------------------------
   OPTIONAL. The pipeline is fully functional without it.

   HARD BOUNDARY — the single most important rule in this file:

     CANDIDATE FACT   may become a resume claim.
     EXTERNAL CONTEXT may only change VOCABULARY and FRAMING.

   Everything this module returns is stamped `claimable: false`
   and is carried in a separate object that the composer is
   physically unable to read as evidence (the composer only ever
   receives EvidenceRecords). External context reaches generation
   through exactly two narrow channels:
     • `terminology[]`  — preferred words for things the candidate
                          already did
     • `contextNotes[]` — used for relevance ranking only

   SECURITY: all network access goes through the repository's
   existing SSRF guard (`workspace/ssrfGuard.js`) — DNS validation,
   private-IP blocking, per-hop redirect validation, timeouts. This
   module adds response-size caps and content-type restrictions.
   No new URL-fetching primitive is introduced.
   ============================================================ */
import crypto from 'node:crypto';
import { safeFetch, assertSafeUrl } from '../../workspace/ssrfGuard.js';

export const EXTERNAL_CONTEXT_VERSION = 'external-context-v1';

const MAX_BYTES = 512 * 1024;          // 512 KB response cap
const ALLOWED_CONTENT = /^(text\/html|text\/plain|application\/(json|xhtml\+xml))/i;
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12h — company facts move slowly

/* ------------------------------------------------------------------ */
/* Cache (in-process, TTL, size-bounded). Deliberately NOT persisted:  */
/* research is context, not a record we owe anyone.                    */
/* ------------------------------------------------------------------ */
class ResearchCache {
  constructor({ max = 200, ttlMs = DEFAULT_TTL_MS } = {}) {
    this.map = new Map();
    this.max = max;
    this.ttlMs = ttlMs;
    this.hits = 0;
    this.misses = 0;
  }

  key(parts) {
    return crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
  }

  get(k) {
    const hit = this.map.get(k);
    if (!hit) { this.misses += 1; return null; }
    if (Date.now() - hit.at > this.ttlMs) { this.map.delete(k); this.misses += 1; return null; }
    this.hits += 1;
    return hit.value;
  }

  set(k, value) {
    if (this.map.size >= this.max) {
      const oldest = [...this.map.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.map.delete(oldest[0]);
    }
    this.map.set(k, { at: Date.now(), value });
    return value;
  }

  stats() { return { size: this.map.size, hits: this.hits, misses: this.misses }; }
  clear() { this.map.clear(); this.hits = 0; this.misses = 0; }
}

export const researchCache = new ResearchCache();

/* ------------------------------------------------------------------ */
/* Provider interface                                                  */
/*   search(query, opts)  -> { ok, results:[{title,url,snippet}] }      */
/*   fetch(url)           -> { ok, status, contentType, body }         */
/*   extract(html, url)   -> { ok, title, text, links }                */
/* ------------------------------------------------------------------ */

/** The null provider: what runs when nothing is configured. Always safe. */
export const NullSearchProvider = {
  id: 'none',
  label: 'External research disabled',
  available: () => false,
  async search() { return { ok: false, reason: 'provider_unavailable', results: [] }; },
  async fetch() { return { ok: false, reason: 'provider_unavailable' }; },
  extract() { return { ok: false, reason: 'provider_unavailable' }; },
};

/* Shared, SSRF-guarded fetch + extraction used by every real provider. */
export async function guardedFetch(url, { timeoutBudgetMs = 8000 } = {}) {
  const started = Date.now();
  const pre = await assertSafeUrl(url);
  if (!pre.ok) return { ok: false, reason: `ssrf_${pre.reason}` };
  /* DNS resolution can itself consume the budget; a caller that gave us 8s
     should not wait 8s more for the body. */
  if (Date.now() - started > timeoutBudgetMs) return { ok: false, reason: 'timeout' };
  const out = await safeFetch(pre.url, { method: 'GET' });
  if (!out.ok) return { ok: false, reason: out.reason, finalUrl: out.finalUrl };
  const res = out.response;
  const contentType = res.headers.get('content-type') || '';
  if (!ALLOWED_CONTENT.test(contentType)) {
    return { ok: false, reason: 'content_type_rejected', contentType };
  }
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > MAX_BYTES) return { ok: false, reason: 'response_too_large' };
  let body = '';
  try {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return { ok: false, reason: 'response_too_large' };
    body = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  } catch {
    return { ok: false, reason: 'body_read_failed' };
  }
  return {
    ok: true, status: res.status, contentType, body,
    finalUrl: out.finalUrl, hops: out.hops, elapsedMs: Date.now() - started,
  };
}

/** Deterministic, dependency-free HTML → text. Scripts/styles removed. */
export function extractText(html, url = '') {
  const src = String(html || '');
  const title = (src.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i) || [])[1] || '';
  const text = src
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    ok: !!text,
    url,
    title: title.replace(/\s+/g, ' ').trim().slice(0, 200),
    text: text.slice(0, 20000),
    words: text.split(/\s+/).length,
  };
}

/**
 * A generic HTTP search provider. Configured through env so no vendor is
 * hard-wired. Works with any endpoint returning JSON containing an array of
 * results — the shape is mapped by `resultPath`/`fields` config.
 */
export function makeHttpSearchProvider({
  id = 'http', label = 'Web search', endpoint = '', apiKey = '', queryParam = 'q',
  extraParams = {}, resultsPath = 'results',
  fields = { title: 'title', url: 'url', snippet: 'snippet' },
  headerName = '', timeoutMs = 8000,
} = {}) {
  return {
    id,
    label,
    available: () => !!(endpoint && apiKey),
    async search(query, { limit = 5 } = {}) {
      if (!endpoint || !apiKey) return { ok: false, reason: 'provider_unavailable', results: [] };
      const cacheKey = researchCache.key(['search', id, String(query), String(limit)]);
      const cached = researchCache.get(cacheKey);
      if (cached) return { ...cached, cached: true };

      let url;
      try {
        url = new URL(endpoint);
        url.searchParams.set(queryParam, String(query).slice(0, 300));
        for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, String(v));
        /* Key travels in a header when the provider supports it — never in the
           query string where it would end up in logs. */
        if (!headerName) url.searchParams.set('api_key', apiKey);
      } catch {
        return { ok: false, reason: 'bad_endpoint', results: [] };
      }

      const pre = await assertSafeUrl(url.toString());
      if (!pre.ok) return { ok: false, reason: `ssrf_${pre.reason}`, results: [] };

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(pre.url, {
          signal: ctrl.signal,
          headers: { Accept: 'application/json', ...(headerName ? { [headerName]: apiKey } : {}) },
        });
        if (!res.ok) return { ok: false, reason: `http_${res.status}`, results: [] };
        const data = await res.json().catch(() => null);
        if (!data) return { ok: false, reason: 'bad_json', results: [] };
        const list = resultsPath.split('.').reduce((acc, k) => (acc ? acc[k] : null), data);
        const results = (Array.isArray(list) ? list : []).slice(0, limit).map((r) => ({
          title: String(r?.[fields.title] || '').slice(0, 200),
          url: String(r?.[fields.url] || '').slice(0, 400),
          snippet: String(r?.[fields.snippet] || '').slice(0, 600),
        })).filter((r) => r.url);
        return researchCache.set(cacheKey, { ok: true, results, provider: id, fetchedAt: new Date().toISOString() });
      } catch {
        return { ok: false, reason: 'provider_unreachable', results: [] };
      } finally { clearTimeout(timer); }
    },
    async fetch(url) { return guardedFetch(url); },
    extract: extractText,
  };
}

/** Build the configured provider from env, or the null provider. */
export function resolveSearchProvider(env = process.env) {
  if (env.RESUME_RESEARCH_ENABLED !== '1') return NullSearchProvider;
  const endpoint = env.RESUME_RESEARCH_ENDPOINT || '';
  const apiKey = env.RESUME_RESEARCH_API_KEY || env.SERPAPI_KEY || '';
  if (!endpoint || !apiKey) return NullSearchProvider;
  return makeHttpSearchProvider({
    id: env.RESUME_RESEARCH_PROVIDER || 'http',
    endpoint,
    apiKey,
    queryParam: env.RESUME_RESEARCH_QUERY_PARAM || 'q',
    resultsPath: env.RESUME_RESEARCH_RESULTS_PATH || 'organic_results',
    headerName: env.RESUME_RESEARCH_HEADER || '',
    fields: { title: 'title', url: 'link', snippet: 'snippet' },
    timeoutMs: Number(env.RESUME_RESEARCH_TIMEOUT_MS || 8000),
  });
}

/* ------------------------------------------------------------------ */
/* Context extraction from research results                            */
/* ------------------------------------------------------------------ */
const TECH_HINT_RE = /\b(kubernetes|openshift|docker|terraform|aws|azure|gcp|kafka|spark|snowflake|databricks|airflow|java|python|go|golang|react|node\.js|typescript|postgres(?:ql)?|mongodb|graphql|grpc|microservices|monorepo|serverless|jenkins|gitlab|github actions|argocd|prometheus|grafana|datadog|splunk)\b/gi;

const CULTURE_HINT_RE = /\b(platform team|internal tooling|developer experience|design system|trunk[- ]based|code review|pair programming|on[- ]call|incident review|blameless|open source|research[- ]driven|data[- ]driven|regulated environment|compliance)\b/gi;

/**
 * Turn raw research into strictly non-claimable context.
 * Everything is tagged with source + timestamp for auditability.
 */
export function distillContext(documents = [], { company = '', role = '' } = {}) {
  const terminology = new Map();
  const cultureSignals = new Map();
  const sources = [];

  for (const d of documents) {
    if (!d || !d.text) continue;
    sources.push({
      url: String(d.url || '').slice(0, 400),
      title: String(d.title || '').slice(0, 200),
      retrievedAt: d.retrievedAt || new Date().toISOString(),
      words: d.words || 0,
    });
    for (const m of d.text.matchAll(TECH_HINT_RE)) {
      const k = m[1].toLowerCase();
      terminology.set(k, (terminology.get(k) || 0) + 1);
    }
    for (const m of d.text.matchAll(CULTURE_HINT_RE)) {
      const k = m[1].toLowerCase();
      cultureSignals.set(k, (cultureSignals.get(k) || 0) + 1);
    }
  }

  const top = (map, n) => [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([term, count]) => ({ term, count }));

  return {
    version: EXTERNAL_CONTEXT_VERSION,
    company: String(company || '').slice(0, 200),
    role: String(role || '').slice(0, 200),
    available: sources.length > 0,
    /* THE ONLY TWO CHANNELS INTO GENERATION */
    terminology: top(terminology, 20).map((t) => ({ ...t, claimable: false })),
    contextNotes: top(cultureSignals, 12).map((t) => ({ ...t, claimable: false })),
    sources,
    retrievedAt: new Date().toISOString(),
    disclaimer: 'External context influences wording and emphasis only. It can never become a candidate claim.',
  };
}

/**
 * Research a company + role. Returns an always-valid context object; when the
 * provider is unavailable or every fetch fails, `available:false` and the
 * pipeline simply proceeds without it.
 */
export async function researchRoleContext({
  company = '', role = '', provider = null, maxPages = 3, budgetMs = 9000,
} = {}) {
  const p = provider || NullSearchProvider;
  if (!p.available() || (!company && !role)) {
    return { ...distillContext([], { company, role }), skipped: true, reason: p.available() ? 'no_target' : 'provider_unavailable' };
  }

  const cacheKey = researchCache.key(['context', p.id, company.toLowerCase(), role.toLowerCase()]);
  const cached = researchCache.get(cacheKey);
  if (cached) return { ...cached, cached: true };

  const deadline = Date.now() + budgetMs;
  const query = [company, role, 'engineering technology stack'].filter(Boolean).join(' ');
  const search = await p.search(query, { limit: maxPages + 2 });
  if (!search.ok || !search.results.length) {
    return { ...distillContext([], { company, role }), skipped: true, reason: search.reason || 'no_results' };
  }

  const docs = [];
  for (const r of search.results.slice(0, maxPages)) {
    if (Date.now() > deadline) break;
    const fetched = await p.fetch(r.url);
    if (!fetched.ok) continue;
    const ext = p.extract(fetched.body, fetched.finalUrl || r.url);
    if (ext.ok) docs.push({ ...ext, retrievedAt: new Date().toISOString() });
  }

  const ctx = distillContext(docs, { company, role });
  return researchCache.set(cacheKey, ctx);
}

export default {
  EXTERNAL_CONTEXT_VERSION, NullSearchProvider, makeHttpSearchProvider,
  resolveSearchProvider, researchRoleContext, distillContext, guardedFetch,
  extractText, researchCache,
};
