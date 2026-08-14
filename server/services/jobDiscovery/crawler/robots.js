/* ============================================================
   JOB DISCOVERY OS — ROBOTS + ACCESS POLICY  (§13)
   ------------------------------------------------------------
   This system pursues AGGRESSIVE LEGITIMATE coverage. It does not
   implement, and must never implement, CAPTCHA bypass, session or
   credential theft, authentication/access-control bypass, block-
   defeating proxy rotation, fingerprint evasion, or private-API
   credential discovery.

   What it does implement: read robots.txt, honour it, honour the
   HTTP signals a site sends back, and record a per-source policy
   state so an un-crawlable source is routed around rather than
   attacked.
   ============================================================ */

import { ACCESS_POLICY } from '../schema.js';

export const USER_AGENT = 'CareerAutopilotJobDiscovery/1.0 (+https://careerautopilot.co/bot)';
export const UA_TOKEN = 'careerautopilotjobdiscovery';

/**
 * Parse robots.txt into per-agent rule groups.
 * Handles agent grouping, Allow/Disallow, Crawl-delay and Sitemap.
 */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  const sitemaps = [];

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || current.rules.length || current.crawlDelay != null) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'disallow' || field === 'allow') {
      if (!current) { current = { agents: ['*'], rules: [], crawlDelay: null }; groups.push(current); }
      current.rules.push({ type: field, path: value });
    } else if (field === 'crawl-delay') {
      if (!current) { current = { agents: ['*'], rules: [], crawlDelay: null }; groups.push(current); }
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    } else if (field === 'sitemap') {
      sitemaps.push(value);
    }
  }
  return { groups, sitemaps };
}

function matchPath(pattern, path) {
  if (pattern === '') return false; // empty Disallow means "allow everything"
  /* Google-style wildcards: * (any run) and $ (end anchor). */
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') re += '.*';
    else if (ch === '$' && i === pattern.length - 1) re += '$';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  try { return new RegExp(`^${re}`).test(path); } catch { return false; }
}

function selectGroup(parsed, agent) {
  const a = String(agent || UA_TOKEN).toLowerCase();
  let exact = null; let star = null;
  for (const g of parsed.groups) {
    for (const name of g.agents) {
      if (name === '*') { star = star || g; }
      else if (a.includes(name) || name.includes(a)) { exact = exact || g; }
    }
  }
  return exact || star || null;
}

/**
 * @returns { allowed, rule, crawlDelay }
 * Longest matching rule wins; Allow beats Disallow at equal length (RFC 9309).
 */
export function isAllowed(parsed, urlPath, agent = UA_TOKEN) {
  const group = selectGroup(parsed, agent);
  if (!group) return { allowed: true, rule: null, crawlDelay: null };
  let best = null;
  for (const rule of group.rules) {
    if (!matchPath(rule.path, urlPath)) continue;
    const len = rule.path.length;
    if (!best || len > best.len || (len === best.len && rule.type === 'allow')) {
      best = { ...rule, len };
    }
  }
  if (!best) return { allowed: true, rule: null, crawlDelay: group.crawlDelay };
  return { allowed: best.type === 'allow', rule: best, crawlDelay: group.crawlDelay };
}

/**
 * In-memory robots cache with TTL. `fetchText(url)` is injected so this module
 * has zero network coupling and stays unit-testable offline.
 */
export class RobotsPolicy {
  constructor({ fetchText, ttlMs = 6 * 60 * 60 * 1000, agent = UA_TOKEN, now = () => Date.now() } = {}) {
    this.fetchText = fetchText;
    this.ttlMs = ttlMs;
    this.agent = agent;
    this.now = now;
    this.cache = new Map(); // origin -> { parsed, at, error }
  }

  async load(origin) {
    const hit = this.cache.get(origin);
    if (hit && this.now() - hit.at < this.ttlMs) return hit;
    let entry;
    try {
      const text = await this.fetchText(`${origin}/robots.txt`);
      entry = { parsed: parseRobots(text), at: this.now(), error: null };
    } catch (e) {
      /* Unreachable robots.txt is NOT permission. It is treated as REVIEW —
         crawl proceeds only for sources explicitly marked ALLOW by config. */
      entry = { parsed: null, at: this.now(), error: e?.message || 'robots-unreachable' };
    }
    this.cache.set(origin, entry);
    return entry;
  }

  /**
   * @returns { policy: ALLOW|DENY|REVIEW, reason, crawlDelayMs }
   */
  async check(url) {
    let u;
    try { u = new URL(url); } catch { return { policy: ACCESS_POLICY.DENY, reason: 'bad-url', crawlDelayMs: null }; }
    const origin = `${u.protocol}//${u.host}`;
    const entry = await this.load(origin);
    if (!entry.parsed) {
      return { policy: ACCESS_POLICY.REVIEW, reason: entry.error || 'robots-unavailable', crawlDelayMs: null };
    }
    const { allowed, rule, crawlDelay } = isAllowed(entry.parsed, u.pathname + (u.search || ''), this.agent);
    return {
      policy: allowed ? ACCESS_POLICY.ALLOW : ACCESS_POLICY.DENY,
      reason: rule ? `${rule.type}: ${rule.path}` : 'no-matching-rule',
      crawlDelayMs: crawlDelay != null ? crawlDelay * 1000 : null,
      sitemaps: entry.parsed.sitemaps || [],
    };
  }
}

export default { parseRobots, isAllowed, RobotsPolicy, USER_AGENT, UA_TOKEN, ACCESS_POLICY };
