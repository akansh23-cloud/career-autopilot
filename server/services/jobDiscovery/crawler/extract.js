/* ============================================================
   JOB DISCOVERY OS — EXTRACTION LADDER  (§9, §10, §11)
   ------------------------------------------------------------
   Cheap -> expensive. Each stage returns what it actually found;
   nothing here invents a field that was not in the document.

     1  canonical / meta inspection
     2  JSON-LD  @type=JobPosting
     3  embedded framework JSON (__NEXT_DATA__, Nuxt, page state)
     4  HTML job links
     5  sitemap / XML
   ============================================================ */

import { stripHtml, normalizeWhitespace, normalizeUrl } from '../normalize/text.js';

/* ------------------------- 1. meta / canonical ------------------------- */

export function extractMeta(html, baseUrl = '') {
  const out = { canonical: null, title: null, description: null, ogTitle: null, ogUrl: null, siteName: null };
  const text = String(html || '');

  const canon = text.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
  if (canon) {
    const href = canon[0].match(/href=["']([^"']+)["']/i);
    if (href) { try { out.canonical = normalizeUrl(new URL(href[1], baseUrl || undefined).toString()); } catch { out.canonical = normalizeUrl(href[1]); } }
  }
  const t = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) out.title = normalizeWhitespace(stripHtml(t[1]));

  for (const m of text.matchAll(/<meta[^>]+>/gi)) {
    const tag = m[0];
    const name = (tag.match(/(?:name|property)=["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/content=["']([^"']*)["']/i) || [])[1];
    if (!name || content == null) continue;
    const key = name.toLowerCase();
    if (key === 'description') out.description = normalizeWhitespace(content);
    if (key === 'og:title') out.ogTitle = normalizeWhitespace(content);
    if (key === 'og:url') out.ogUrl = normalizeUrl(content);
    if (key === 'og:site_name') out.siteName = normalizeWhitespace(content);
  }
  return out;
}

/* ------------------------------ 2. JSON-LD ------------------------------ */

function safeJsonParse(raw) {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/^\s*<!--/, '').replace(/-->\s*$/, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  /* Some pages concatenate multiple objects in one block. */
  try { return JSON.parse(`[${cleaned.replace(/}\s*{/g, '},{')}]`); } catch { return null; }
}

function flattenGraph(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((n) => flattenGraph(n, out)); return out; }
  if (typeof node !== 'object') return out;
  if (node['@graph']) flattenGraph(node['@graph'], out);
  out.push(node);
  return out;
}

export function extractJsonLd(html) {
  const blocks = [];
  for (const m of String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const parsed = safeJsonParse(m[1]);
    if (parsed) blocks.push(parsed);
  }
  const nodes = [];
  blocks.forEach((b) => flattenGraph(b, nodes));
  return nodes;
}

function typeOf(node) {
  const t = node?.['@type'];
  if (!t) return [];
  return (Array.isArray(t) ? t : [t]).map((x) => String(x));
}

/** Only real JobPosting nodes. No inference from page shape. */
export function findJobPostings(html) {
  return extractJsonLd(html).filter((n) => typeOf(n).some((t) => /^JobPosting$/i.test(t)));
}

function jsonLdLocations(node) {
  const out = [];
  const push = (loc) => {
    if (!loc) return;
    if (typeof loc === 'string') { out.push(loc); return; }
    const addr = loc.address || loc;
    const parts = [
      addr.addressLocality, addr.addressRegion, addr.addressCountry?.name || addr.addressCountry,
    ].filter(Boolean).map(String);
    if (parts.length) out.push(parts.join(', '));
    else if (loc.name) out.push(String(loc.name));
  };
  const jl = node.jobLocation;
  if (Array.isArray(jl)) jl.forEach(push); else push(jl);
  return out;
}

function applicantRegions(node) {
  const req = node.applicantLocationRequirements;
  if (!req) return [];
  const list = Array.isArray(req) ? req : [req];
  return list.map((r) => (typeof r === 'string' ? r : (r?.name || r?.address?.addressCountry || ''))).filter(Boolean).map(String);
}

/**
 * Map a schema.org JobPosting to a NormalizedJobInput.
 * Absent values stay ABSENT (§10: "Do not infer absent values").
 */
export function jobPostingToInput(node, { pageUrl = null, html = null } = {}) {
  if (!node) return null;
  const org = node.hiringOrganization || {};
  const remoteType = String(node.jobLocationType || '');
  const explicitRemote = /TELECOMMUTE/i.test(remoteType) ? true : null;

  const descriptionHtml = typeof node.description === 'string' ? node.description : null;
  const identifier = node.identifier;
  const requisitionId = typeof identifier === 'object'
    ? (identifier.value ?? identifier.name ?? null)
    : (identifier ?? null);

  return {
    sourceJobId: requisitionId != null ? String(requisitionId) : (pageUrl || null),
    requisitionId: requisitionId != null ? String(requisitionId) : null,
    title: node.title || null,
    company: {
      name: typeof org === 'string' ? org : (org.name || null),
      website: typeof org === 'object' ? (org.sameAs || org.url || null) : null,
      logoUrl: typeof org === 'object' ? (org.logo?.url || (typeof org.logo === 'string' ? org.logo : null)) : null,
    },
    descriptionHtml,
    descriptionText: descriptionHtml ? stripHtml(descriptionHtml) : null,
    locationsRaw: jsonLdLocations(node),
    applicantRegions: applicantRegions(node),
    explicitRemote,
    workplaceHint: remoteType || null,
    employmentTypeRaw: node.employmentType || null,
    department: node.occupationalCategory || node.industry || null,
    jobUrl: pageUrl || node.url || null,
    applyUrl: node.applicationContact?.url || node.url || pageUrl || null,
    sourcePublishedAt: node.datePosted || null,
    validThrough: node.validThrough || null,
    compensationStructured: node.baseSalary || null,
    compensationRaw: typeof node.baseSalary === 'string' ? node.baseSalary : null,
    tags: [],
    extraction: 'JSON_LD',
  };
}

/* --------------------- 3. embedded framework JSON --------------------- */

const EMBED_PATTERNS = [
  { key: '__NEXT_DATA__', re: /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i },
  { key: '__NUXT__', re: /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i },
  { key: '__INITIAL_STATE__', re: /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i },
  { key: '__APOLLO_STATE__', re: /window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i },
  { key: 'PRELOADED_STATE', re: /window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i },
];

/**
 * Public page state only. Nothing here reaches for an endpoint the browser
 * itself could not reach unauthenticated (§11).
 */
export function extractEmbeddedJson(html) {
  const out = [];
  const text = String(html || '');
  for (const { key, re } of EMBED_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const parsed = safeJsonParse(m[1]);
    if (parsed) out.push({ key, data: parsed });
  }
  for (const m of text.matchAll(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const parsed = safeJsonParse(m[1]);
    if (parsed) out.push({ key: 'application/json', data: parsed });
  }
  return out;
}

/** Depth-limited search for arrays of job-shaped objects inside page state. */
export function findJobArrays(data, { maxDepth = 8 } = {}) {
  const hits = [];
  const seen = new Set();
  const looksLikeJob = (o) => o && typeof o === 'object' && !Array.isArray(o)
    && (o.title || o.jobTitle || o.name || o.text)
    && (o.id || o.jobId || o.shortcode || o.absolute_url || o.hostedUrl || o.applyUrl || o.url || o.jobUrl);

  const walk = (node, depth, path) => {
    if (depth > maxDepth || node == null) return;
    if (Array.isArray(node)) {
      const jobs = node.filter(looksLikeJob);
      if (jobs.length >= 1 && jobs.length === node.length) hits.push({ path, jobs });
      node.slice(0, 200).forEach((n, i) => walk(n, depth + 1, `${path}[${i}]`));
      return;
    }
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const [k, v] of Object.entries(node)) walk(v, depth + 1, path ? `${path}.${k}` : k);
  };
  walk(data, 0, '');
  return hits.sort((a, b) => b.jobs.length - a.jobs.length);
}

/* ---------------------------- 4. HTML links ---------------------------- */

const JOB_LINK_RE = /\/(jobs?|careers?|vacanc(?:y|ies)|opening|position|opportunit(?:y|ies)|role)s?\/[^"'\s?#]+/i;

export function extractJobLinks(html, baseUrl) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
    let abs;
    try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
    if (!JOB_LINK_RE.test(new URL(abs).pathname)) continue;
    const norm = normalizeUrl(abs);
    if (!norm || out.has(norm)) continue;
    out.set(norm, { url: norm, text: normalizeWhitespace(stripHtml(m[2])).slice(0, 160) });
  }
  return [...out.values()];
}

/* ------------------------------ 5. sitemap ------------------------------ */

export function extractSitemapUrls(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const u = normalizeUrl(m[1]);
    if (u) out.push(u);
  }
  return out;
}

export function isSitemapIndex(xml) {
  return /<sitemapindex[\s>]/i.test(String(xml || ''));
}

export function filterJobSitemapUrls(urls) {
  return urls.filter((u) => {
    try { return JOB_LINK_RE.test(new URL(u).pathname); } catch { return false; }
  });
}

export default {
  extractMeta, extractJsonLd, findJobPostings, jobPostingToInput,
  extractEmbeddedJson, findJobArrays, extractJobLinks,
  extractSitemapUrls, isSitemapIndex, filterJobSitemapUrls,
};
