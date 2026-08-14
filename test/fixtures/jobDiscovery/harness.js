/* ============================================================
   JOB DISCOVERY OS — OFFLINE TEST HARNESS  (§52)
   ------------------------------------------------------------
   Unit tests must not require internet access. Everything the
   crawler touches is injected: fetch, DNS, clock, jitter, sleep.
   ============================================================ */

import { MemoryJobStore } from '../../../server/services/jobDiscovery/store.js';
import { SourceRegistry, makeSource } from '../../../server/services/jobDiscovery/sourceRegistry.js';
import AdapterRegistry from '../../../server/services/jobDiscovery/adapters/index.js';
import { IngestPipeline } from '../../../server/services/jobDiscovery/ingest.js';
import { SourceDiscoveryEngine } from '../../../server/services/jobDiscovery/sourceDiscovery.js';
import { StoreBackedSearchIndex } from '../../../server/services/jobDiscovery/searchIndex.js';
import { CrawlScheduler, VerificationWorker, Metrics } from '../../../server/services/jobDiscovery/scheduler.js';
import { JobDiscoveryService } from '../../../server/services/jobDiscovery/index.js';
import { SafeHttpClient } from '../../../server/services/jobDiscovery/crawler/httpClient.js';
import { RateController } from '../../../server/services/jobDiscovery/crawler/rateControl.js';
import { RobotsPolicy } from '../../../server/services/jobDiscovery/crawler/robots.js';

/** Minimal Headers stand-in with the case-insensitive get() the client uses. */
export function makeHeaders(obj = {}) {
  const map = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { get: (k) => (map.has(String(k).toLowerCase()) ? map.get(String(k).toLowerCase()) : null) };
}

/**
 * Route table -> fake fetch. Keys are exact URLs or RegExp.
 * Values are { status, body, headers } or a function (url) => that.
 */
export function makeFetch(routes = [], { onRequest = null } = {}) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    onRequest?.(String(url), opts);
    for (const [matcher, handler] of routes) {
      const hit = matcher instanceof RegExp ? matcher.test(String(url)) : String(matcher) === String(url);
      if (!hit) continue;
      const r = typeof handler === 'function' ? await handler(String(url), opts) : handler;
      const status = r.status ?? 200;
      const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? null);
      const headers = makeHeaders({
        'content-type': r.contentType || (typeof r.body === 'string' ? 'text/html; charset=utf-8' : 'application/json'),
        ...(r.headers || {}),
      });
      return {
        status,
        url: String(url),
        headers,
        text: async () => body,
        body: null,
      };
    }
    return { status: 404, url: String(url), headers: makeHeaders({ 'content-type': 'text/plain' }), text: async () => 'not found', body: null };
  };
  impl.calls = calls;
  return impl;
}

/** DNS resolver that answers with public addresses unless told otherwise. */
export function makeResolver(map = {}) {
  return {
    async lookup(hostname) {
      if (map[hostname] === 'FAIL') { const e = new Error('ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; }
      const addr = map[hostname] || '93.184.216.34';
      return Array.isArray(addr) ? addr.map((a) => ({ address: a, family: 4 })) : [{ address: addr, family: 4 }];
    },
  };
}

export function makeHttp({ routes = [], resolverMap = {}, rateOptions = {} } = {}) {
  const fetchImpl = makeFetch(routes);
  const rate = new RateController({
    globalConcurrency: 8, hostConcurrency: 4, minHostDelayMs: 0,
    sleep: async () => {}, jitter: () => 0.5, ...rateOptions,
  });
  const http = new SafeHttpClient({
    fetchImpl, resolver: makeResolver(resolverMap), rateController: rate, maxRetries: 0,
  });
  http.__fetchImpl = fetchImpl;
  return http;
}

/**
 * Build a fully wired, network-free JobDiscoveryService.
 * `now` is a fixed clock so freshness assertions are deterministic.
 */
export async function makeService({
  routes = [], resolverMap = {}, legacySources = [], now = () => new Date('2026-08-14T12:00:00.000Z'),
  robotsText = null, browserPool = null,
} = {}) {
  const store = await new MemoryJobStore().init();
  const metrics = new Metrics();
  const http = makeHttp({ routes, resolverMap });
  const robots = robotsText != null
    ? new RobotsPolicy({ fetchText: async () => robotsText, now: () => now().getTime() })
    : new RobotsPolicy({ fetchText: (url) => http.fetchText(url, { retries: 0, allowedContentTypes: ['text/plain', 'text/html'] }), now: () => now().getTime() });

  const adapters = new AdapterRegistry({ http, robots, browserPool, legacySources, logger: silentLogger() });
  const registry = new SourceRegistry({ store, logger: silentLogger(), now });
  const ingest = new IngestPipeline({ store, registry, adapters, logger: silentLogger(), metrics, now });
  const discovery = new SourceDiscoveryEngine({ http, registry, adapters, robots, logger: silentLogger() });
  const verifier = new VerificationWorker({ store, registry, adapters, metrics, logger: silentLogger(), now });
  const search = new StoreBackedSearchIndex({ store, now: () => now().getTime(), cache: null });
  const scheduler = new CrawlScheduler({ registry, ingest, verifier, discovery, metrics, logger: silentLogger(), now });

  const service = new JobDiscoveryService({
    store, registry, adapters, ingest, search, scheduler, verifier, discovery,
    http, browserPool, robots, metrics, logger: silentLogger(),
  });
  /* Mirror createJobDiscoveryService: legacy aggregators are bootstrapped into
     the registry as AGGREGATOR-class supplemental sources. */
  for (const legacy of legacySources) {
    await registry.register(makeSource({
      provider: 'API', sourceType: 'AGGREGATOR', sourceClass: 'AGGREGATOR',
      tenant: legacy.name, baseUrl: legacy.home || null, careersUrl: legacy.home || null,
      crawlStrategy: 'API', accessPolicy: 'ALLOW', status: 'ACTIVE',
      discoveredFrom: 'legacy-bootstrap',
    }));
  }

  service.__http = http;
  service.__now = now;
  return service;
}

export function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {}, log() {} };
}

export { makeSource };

export default { makeFetch, makeResolver, makeHttp, makeService, makeHeaders, makeSource, silentLogger };
