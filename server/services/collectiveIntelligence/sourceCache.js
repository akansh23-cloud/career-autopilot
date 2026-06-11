/* ============================================================
   Career Intelligence — source cache + rate protection
   ------------------------------------------------------------
   Caches connector results by (source + normalized query +
   params) with a default 24h TTL. In-memory first; best-effort
   MongoDB persistence when the shared connection is up, so
   serverless / multi-instance deployments still benefit.
   Also coalesces duplicate in-flight calls inside one request.
   ============================================================ */
import mongoose from 'mongoose';
import { connectDB, dbEnabled } from '../../../db.js';
import { sha1, normalizeText } from '../problemIntelligence/util.js';
import { ciConfig } from './config.js';

const MEM = new Map();          // key -> { value, expiresAt }
const INFLIGHT = new Map();     // key -> Promise (request coalescing)
const MEM_MAX = 500;

const cacheSchema = new mongoose.Schema({
  key: { type: String, unique: true, index: true },
  source: { type: String, index: true },
  value: { type: mongoose.Schema.Types.Mixed },
  expiresAt: { type: Date, index: { expires: 0 } },
}, { timestamps: true });

const SourceCacheEntry = mongoose.models.IntelligenceSourceCache || mongoose.model('IntelligenceSourceCache', cacheSchema);

export function cacheKey(source, query, params = {}) {
  const p = Object.keys(params).sort().map((k) => `${k}=${String(params[k]).slice(0, 60)}`).join('&');
  return `ci:${source}:${sha1(normalizeText(query) + '|' + p).slice(0, 32)}`;
}

function ttlMs(cfg = ciConfig()) {
  return Math.max(1, cfg.cacheTtlMinutes) * 60_000;
}

function memGet(key) {
  const hit = MEM.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) { MEM.delete(key); return null; }
  return hit.value;
}

function memSet(key, value, expiresAt) {
  if (MEM.size >= MEM_MAX) {
    // Drop the oldest ~10% — simple, allocation-free pressure valve.
    const drop = Math.ceil(MEM_MAX / 10);
    let i = 0;
    for (const k of MEM.keys()) { MEM.delete(k); if (++i >= drop) break; }
  }
  MEM.set(key, { value, expiresAt });
}

export async function cacheGet(key) {
  const m = memGet(key);
  if (m) return m;
  if (!dbEnabled()) return null;
  try {
    await connectDB();
    const doc = await SourceCacheEntry.findOne({ key, expiresAt: { $gt: new Date() } }).lean();
    if (doc?.value) { memSet(key, doc.value, doc.expiresAt.getTime()); return doc.value; }
  } catch { /* cache is best-effort */ }
  return null;
}

export async function cacheSet(key, source, value, cfg = ciConfig()) {
  const expiresAt = Date.now() + ttlMs(cfg);
  memSet(key, value, expiresAt);
  if (!dbEnabled()) return;
  try {
    await connectDB();
    await SourceCacheEntry.updateOne({ key }, { $set: { key, source, value, expiresAt: new Date(expiresAt) } }, { upsert: true });
  } catch { /* cache is best-effort */ }
}

/* Run `fn` once per key: concurrent callers share the same promise, repeated
   callers within the TTL get the cached value. Connector failures are NOT
   cached so a temporary outage doesn't poison 24h of results. */
export async function withCache(source, query, params, fn, cfg = ciConfig()) {
  const key = cacheKey(source, query, params);
  const cached = await cacheGet(key);
  if (cached) return { ...cached, cached: true };
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const p = (async () => {
    try {
      const value = await fn();
      if (value && value.ok) await cacheSet(key, source, value, cfg);
      return value;
    } finally {
      INFLIGHT.delete(key);
    }
  })();
  INFLIGHT.set(key, p);
  return p;
}

/* Test helper. */
export function _clearMemoryCache() { MEM.clear(); INFLIGHT.clear(); }

export default { withCache, cacheGet, cacheSet, cacheKey, _clearMemoryCache };
