/* ============================================================
   JOB DISCOVERY OS — SECURITY TESTS
   ------------------------------------------------------------
   Covers SECURITY_GATE (§64.6): §14 SSRF, §13 access policy,
   §28 rate control, §12 bounded browser, §47 discovery-input
   validation, §61 no unauthenticated crawl trigger.
   ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertUrlAllowed, assertRedirectAllowed, classifyAddress, classifyIPv4, classifyIPv6,
  hostnameBlocked, SsrfError,
} from '../server/services/jobDiscovery/crawler/ssrf.js';
import { SafeHttpClient, HttpError, classifyStatus } from '../server/services/jobDiscovery/crawler/httpClient.js';
import {
  RateController, HostBreaker, Semaphore, backoffDelay, parseRetryAfter, CIRCUIT,
} from '../server/services/jobDiscovery/crawler/rateControl.js';
import { parseRobots, isAllowed, RobotsPolicy } from '../server/services/jobDiscovery/crawler/robots.js';
import { BrowserPool, BLOCKED_RESOURCE_TYPES, BLOCKED_URL_PATTERNS } from '../server/services/jobDiscovery/crawler/browserPool.js';
import { ERROR_CLASS, ACCESS_POLICY } from '../server/services/jobDiscovery/schema.js';
import { makeFetch, makeResolver, makeHttp, makeService } from './fixtures/jobDiscovery/harness.js';
import fx from './fixtures/jobDiscovery/providers.js';

/* ============================ §14 SSRF ============================ */

const PRIVATE_TARGETS = [
  ['http://localhost/jobs', 'localhost'],
  ['http://127.0.0.1/jobs', 'loopback'],
  ['http://127.255.255.254/x', 'loopback range'],
  ['http://10.0.0.5/x', 'private 10/8'],
  ['http://172.16.4.4/x', 'private 172.16/12'],
  ['http://172.31.255.255/x', 'private 172.16/12 upper'],
  ['http://192.168.1.1/x', 'private 192.168/16'],
  ['http://169.254.169.254/latest/meta-data/', 'AWS metadata'],
  ['http://169.254.170.2/v2/credentials', 'ECS metadata'],
  ['http://0.0.0.0/x', 'this-network'],
  ['http://100.64.0.1/x', 'CGNAT'],
  ['http://198.18.0.1/x', 'benchmark'],
  ['http://224.0.0.1/x', 'multicast'],
  ['http://[::1]/x', 'IPv6 loopback'],
  ['http://[fd00::1]/x', 'IPv6 ULA'],
  ['http://[fe80::1]/x', 'IPv6 link-local'],
  ['http://[::ffff:127.0.0.1]/x', 'IPv4-mapped loopback'],
  ['http://metadata.google.internal/computeMetadata/v1/', 'GCP metadata host'],
  ['http://instance-data/latest/', 'EC2 instance-data host'],
];

for (const [url, label] of PRIVATE_TARGETS) {
  test(`SECURITY_GATE — SSRF blocks ${label}`, async () => {
    await assert.rejects(
      () => assertUrlAllowed(url, { resolver: makeResolver() }),
      (e) => e instanceof SsrfError,
      `${url} must be rejected`,
    );
  });
}

const BAD_PROTOCOLS = [
  'file:///etc/passwd',
  'ftp://example.com/x',
  'data:text/html,<h1>x</h1>',
  'gopher://example.com/x',
  'jar:http://example.com/a!/b',
  'ldap://example.com/x',
];

for (const url of BAD_PROTOCOLS) {
  test(`SECURITY_GATE — SSRF blocks protocol ${url.split(':')[0]}:`, async () => {
    await assert.rejects(() => assertUrlAllowed(url, { resolver: makeResolver() }), (e) => e instanceof SsrfError);
  });
}

test('SECURITY_GATE — a PUBLIC hostname resolving into private space is blocked', async () => {
  const resolver = makeResolver({ 'evil.example': '10.1.2.3' });
  await assert.rejects(
    () => assertUrlAllowed('https://evil.example/jobs', { resolver }),
    (e) => e instanceof SsrfError && e.code === 'BLOCKED_ADDRESS',
  );
});

test('SECURITY_GATE — a mixed DNS answer with ANY private record is blocked', async () => {
  const resolver = makeResolver({ 'mixed.example': ['93.184.216.34', '169.254.169.254'] });
  await assert.rejects(
    () => assertUrlAllowed('https://mixed.example/jobs', { resolver }),
    (e) => e instanceof SsrfError,
    'one private record poisons the whole answer',
  );
});

test('SECURITY_GATE — URL credentials are rejected', async () => {
  await assert.rejects(
    () => assertUrlAllowed('https://user:pass@example.com/x', { resolver: makeResolver() }),
    (e) => e instanceof SsrfError && e.code === 'URL_CREDENTIALS',
  );
});

test('a legitimate public URL is allowed', async () => {
  const r = await assertUrlAllowed('https://boards.greenhouse.io/acme', { resolver: makeResolver() });
  assert.equal(r.hostname, 'boards.greenhouse.io');
  assert.deepEqual(r.addresses, ['93.184.216.34']);
});

test('address classification covers the reserved ranges', () => {
  assert.equal(classifyIPv4('8.8.8.8').blocked, false);
  assert.equal(classifyIPv4('10.255.255.255').blocked, true);
  assert.equal(classifyIPv4('172.15.0.1').blocked, false, '172.15 is public');
  assert.equal(classifyIPv4('172.32.0.1').blocked, false, '172.32 is public');
  assert.equal(classifyIPv6('2606:4700::1111').blocked, false);
  assert.equal(classifyAddress('not-an-ip').blocked, true);
  assert.ok(hostnameBlocked('service.internal'));
  assert.equal(hostnameBlocked('example.com'), null);
});

/* ==================== redirects: public -> private ==================== */



test('SECURITY_GATE — DNS resolver failure is NETWORK, not a false SSRF classification', async () => {
  const resolver = { lookup: async () => { const e = new Error('temporary resolver failure'); e.code = 'EAI_AGAIN'; throw e; } };
  const client = new SafeHttpClient({ fetchImpl: makeFetch([]), resolver, maxRetries: 0 });
  await assert.rejects(
    () => client.fetch('https://public.example/jobs'),
    (e) => e instanceof HttpError && e.errorClass === ERROR_CLASS.NETWORK,
  );
  assert.equal(client.metrics.ssrfBlocked, 0);
  assert.equal(client.metrics.failures, 1);
});
test('SECURITY_GATE — a redirect from public to private is blocked', async () => {
  await assert.rejects(
    () => assertRedirectAllowed('https://good.example/a', 'http://169.254.169.254/latest/', { resolver: makeResolver() }),
    (e) => e instanceof SsrfError,
  );
});

test('SECURITY_GATE — the HTTP client re-validates every redirect hop', async () => {
  const fetchImpl = makeFetch([
    [/^https:\/\/good\.example\/start$/, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' }, body: '' }],
  ]);
  const client = new SafeHttpClient({ fetchImpl, resolver: makeResolver(), maxRetries: 0 });
  await assert.rejects(
    () => client.fetch('https://good.example/start'),
    (e) => e instanceof HttpError && e.errorClass === ERROR_CLASS.SSRF_BLOCKED,
  );
  assert.equal(client.metrics.ssrfBlocked, 1);
});

test('SECURITY_GATE — redirect chains are capped', async () => {
  const fetchImpl = makeFetch([
    [/^https:\/\/loop\.example\//, (url) => ({ status: 302, headers: { location: `https://loop.example/${Math.random()}` }, body: '' })],
  ]);
  const client = new SafeHttpClient({ fetchImpl, resolver: makeResolver(), maxRetries: 0, maxRedirects: 3 });
  await assert.rejects(() => client.fetch('https://loop.example/a'), (e) => /Too many redirects/.test(e.message));
});

/* ==================== response limits + content policy ==================== */

test('SECURITY_GATE — oversized responses are rejected', async () => {
  const fetchImpl = makeFetch([[/big\.example/, { body: 'x'.repeat(50_000) }]]);
  const client = new SafeHttpClient({ fetchImpl, resolver: makeResolver(), maxRetries: 0, maxBytes: 1000 });
  await assert.rejects(() => client.fetch('https://big.example/x'), (e) => /exceeded/.test(e.message));
});

test('SECURITY_GATE — a declared oversized Content-Length is rejected before reading', async () => {
  const fetchImpl = makeFetch([[/huge\.example/, { body: 'ok', headers: { 'content-length': '99999999' } }]]);
  const client = new SafeHttpClient({ fetchImpl, resolver: makeResolver(), maxRetries: 0, maxBytes: 1000 });
  await assert.rejects(() => client.fetch('https://huge.example/x'), (e) => /Declared size/.test(e.message));
});

test('SECURITY_GATE — disallowed content types are rejected', async () => {
  const fetchImpl = makeFetch([[/binary\.example/, { body: 'MZ', contentType: 'application/octet-stream' }]]);
  const client = new SafeHttpClient({ fetchImpl, resolver: makeResolver(), maxRetries: 0 });
  await assert.rejects(() => client.fetch('https://binary.example/x'), (e) => /Content-Type not permitted/.test(e.message));
});

test('conditional requests avoid re-downloading unchanged payloads', async () => {
  let sentEtag = null;
  const fetchImpl = makeFetch([[/etag\.example/, (url, opts) => {
    sentEtag = opts.headers['If-None-Match'];
    return sentEtag ? { status: 304, body: '' } : { body: '<html>ok</html>', headers: { etag: 'W/"abc"' } };
  }]]);
  const client = new SafeHttpClient({ fetchImpl, resolver: makeResolver(), maxRetries: 0 });

  const first = await client.fetch('https://etag.example/board');
  assert.equal(first.etag, 'W/"abc"');
  const second = await client.fetch('https://etag.example/board', { etag: first.etag });
  assert.equal(second.notModified, true);
  assert.equal(second.bytes, 0);
  assert.equal(client.metrics.notModified, 1);
});

test('HTTP status classification maps to the normalized error classes', () => {
  assert.equal(classifyStatus(429), ERROR_CLASS.RATE_LIMIT);
  assert.equal(classifyStatus(401), ERROR_CLASS.AUTH_REQUIRED);
  assert.equal(classifyStatus(403), ERROR_CLASS.BLOCKED);
  assert.equal(classifyStatus(503), ERROR_CLASS.NETWORK);
});

/* ============================ §28 rate control ============================ */

test('per-host concurrency and minimum spacing are enforced', async () => {
  let clock = 0;
  const slept = [];
  const rate = new RateController({
    globalConcurrency: 10, hostConcurrency: 1, minHostDelayMs: 500,
    now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; },
  });

  let inFlight = 0; let maxInFlight = 0;
  const task = async () => {
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight -= 1;
    return true;
  };
  await Promise.all([
    rate.schedule('a.example', task),
    rate.schedule('a.example', task),
    rate.schedule('a.example', task),
  ]);
  assert.equal(maxInFlight, 1, 'one request at a time per host');
  assert.deepEqual(slept, [500, 500], 'subsequent requests wait the minimum host delay');
});

test('429 with Retry-After puts the host in cooldown', async () => {
  let clock = 1000;
  const rate = new RateController({ now: () => clock, sleep: async () => {}, jitter: () => 0.5 });
  rate.noteRateLimited('slow.example', parseRetryAfter('30'));
  assert.ok(rate.stats().hosts['slow.example'].cooldownMs >= 30_000);
  assert.equal(parseRetryAfter('120'), 120_000);
  assert.equal(parseRetryAfter(null), null);
});

test('the circuit breaker opens after repeated failures and half-opens later', () => {
  let clock = 0;
  const breaker = new HostBreaker({ failureThreshold: 3, openMs: 1000, now: () => clock });
  assert.equal(breaker.canRequest(), true);
  breaker.onFailure(); breaker.onFailure(); breaker.onFailure();
  assert.equal(breaker.state, CIRCUIT.OPEN);
  assert.equal(breaker.canRequest(), false);
  clock = 1500;
  assert.equal(breaker.canRequest(), true);
  assert.equal(breaker.state, CIRCUIT.HALF_OPEN);
  breaker.onSuccess();
  assert.equal(breaker.state, CIRCUIT.CLOSED);
});

test('an open circuit refuses to schedule work for that host', async () => {
  const rate = new RateController({ now: () => 0, sleep: async () => {}, breaker: { failureThreshold: 1, openMs: 60_000 } });
  rate.noteFailure('dead.example');
  await assert.rejects(() => rate.schedule('dead.example', async () => 'nope'), (e) => e.circuitOpen === true);
});

test('backoff is exponential, jittered and capped', () => {
  const d1 = backoffDelay(1, { baseMs: 100, maxMs: 10_000, jitter: () => 1 });
  const d3 = backoffDelay(3, { baseMs: 100, maxMs: 10_000, jitter: () => 1 });
  const d99 = backoffDelay(99, { baseMs: 100, maxMs: 10_000, jitter: () => 1 });
  assert.equal(d1, 100);
  assert.equal(d3, 400);
  assert.equal(d99, 10_000, 'capped');
  assert.ok(backoffDelay(3, { baseMs: 100, jitter: () => 0 }) < d3, 'jitter reduces the delay');
});

test('semaphore bounds concurrency', async () => {
  const sem = new Semaphore(2);
  let active = 0; let peak = 0;
  await Promise.all(Array.from({ length: 6 }, () => sem.run(async () => {
    active += 1; peak = Math.max(peak, active);
    await new Promise((r) => setImmediate(r));
    active -= 1;
  })));
  assert.equal(peak, 2);
});

/* ============================ §13 robots ============================ */

test('robots.txt is parsed with longest-match and wildcard semantics', () => {
  const parsed = parseRobots(fx.robotsTxt);
  assert.equal(isAllowed(parsed, '/careers/jobs/x').allowed, true);
  assert.equal(isAllowed(parsed, '/admin/secret').allowed, false);
  assert.equal(isAllowed(parsed, '/internal/api').allowed, false);
  assert.equal(isAllowed(parsed, '/anything-else').allowed, true);
  assert.equal(isAllowed(parsed, '/careers/x').crawlDelay, 2);
  assert.deepEqual(parsed.sitemaps, ['https://thornburyretail.example/sitemap.xml']);

  const wildcard = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /a/*/b');
  assert.equal(isAllowed(wildcard, '/docs/file.pdf').allowed, false);
  assert.equal(isAllowed(wildcard, '/docs/file.pdfx').allowed, true, '$ anchors the match');
  assert.equal(isAllowed(wildcard, '/a/zzz/b').allowed, false);
});

test('SECURITY_GATE — a robots DENY prevents the crawl and is recorded', async () => {
  const service = await makeService({
    routes: [
      [/robots\.txt$/, { body: fx.robotsDenyAll, contentType: 'text/plain' }],
      [/thornburyretail\.example\/careers$/, { body: fx.plainHtmlCareerPage }],
    ],
  });
  const check = await service.robots.check('https://thornburyretail.example/careers');
  assert.equal(check.policy, ACCESS_POLICY.DENY);

  const r = await service.discovery.registerGeneric({ careersUrl: 'https://thornburyretail.example/careers', companyName: 'Thornbury Retail' });
  assert.equal(r.ok, false);
  assert.equal(r.source.accessPolicy, ACCESS_POLICY.DENY);
  assert.equal(r.source.status, 'DISABLED');

  const due = await service.registry.due({ limit: 10 });
  assert.ok(!due.some((s) => s.id === r.source.id), 'a DENY source is never scheduled');
});

test('an unreachable robots.txt is REVIEW, not permission', async () => {
  const policy = new RobotsPolicy({ fetchText: async () => { throw new Error('network down'); } });
  const check = await policy.check('https://unknown.example/careers');
  assert.equal(check.policy, ACCESS_POLICY.REVIEW);
});

/* ============================ §12 browser bounds ============================ */

test('SECURITY_GATE — browser pool is bounded and blocks non-content resources', async () => {
  const pool = new BrowserPool({ maxPages: 2 });
  assert.equal(pool.sem.limit, 2);

  assert.ok(BLOCKED_RESOURCE_TYPES.has('image'));
  assert.ok(BLOCKED_RESOURCE_TYPES.has('media'));
  assert.ok(!BLOCKED_RESOURCE_TYPES.has('script'), 'scripts are REQUIRED to render a JS job board');
  assert.ok(!BLOCKED_RESOURCE_TYPES.has('xhr'), 'XHR carries the job payload');
  assert.ok(!BLOCKED_RESOURCE_TYPES.has('document'));
  assert.ok(BLOCKED_URL_PATTERNS.some((re) => re.test('https://www.googletagmanager.com/gtm.js')));
  assert.ok(!BLOCKED_URL_PATTERNS.some((re) => re.test('https://boards.greenhouse.io/embed/job_board/js?for=acme')));
});

test('a missing Playwright install is reported, never faked', async () => {
  const pool = new BrowserPool({ playwrightLoader: async () => { throw new Error('Cannot find package'); } });
  assert.equal(await pool.probe(), false);
  await assert.rejects(() => pool.ensureBrowser(), (e) => /not installed/.test(e.message));
  assert.equal(pool.stats().renders, 0);
});

test('the browser stage is skipped when the pool is unavailable', async () => {
  const pool = new BrowserPool({ playwrightLoader: async () => { throw new Error('nope'); } });
  const service = await makeService({ routes: [], browserPool: pool });
  const adapter = service.adapters.get('GENERIC');
  const result = await adapter.extractFrom('<html><body>nothing useful</body></html>', 'https://empty.example/careers', {}, {});
  assert.equal(result.stage, null);
  assert.equal(result.items.length, 0, 'no jobs are invented when every stage fails');
});

/* ==================== §47 discovery input validation ==================== */

test('SECURITY_GATE — source discovery cannot be used to reach internal hosts', async () => {
  const service = await makeService({ routes: [], resolverMap: { 'careers.attacker.example': '127.0.0.1' } });
  const r = await service.discovery.discoverFromDomain('attacker.example');
  assert.equal(r.ok, false, 'every probe was refused by the SSRF guard');
  assert.ok(service.__http.metrics.ssrfBlocked > 0);
});

test('SECURITY_GATE — a runtime-discovered private URL is refused by the crawler', async () => {
  const http = makeHttp({ routes: [[/.*/, { body: 'ok' }]], resolverMap: { 'internal.example': '192.168.10.10' } });
  await assert.rejects(
    () => http.fetch('http://internal.example/careers'),
    (e) => e.errorClass === ERROR_CLASS.SSRF_BLOCKED,
  );
});

/* ==================== §61 no unauthenticated crawl trigger ==================== */

test('§61 — every ingest command is admin-gated', async () => {
  const { registerJobDiscoveryRoutes } = await import('../server/routes/jobDiscoveryRoutes.js');
  const registered = [];
  const app = {
    locals: {},
    get(path, ...handlers) { registered.push({ method: 'GET', path, handlers }); },
    post(path, ...handlers) { registered.push({ method: 'POST', path, handlers }); },
  };
  const requireAuth = function requireAuth(req, res, next) { next(); };
  const requireAdmin = function requireAdmin(req, res, next) { next(); };
  registerJobDiscoveryRoutes(app, { requireAuth, requireAdmin, legacySources: [] });

  const commandPaths = [
    '/api/admin/job-discovery/sources',
    '/api/admin/job-discovery/crawl',
    '/api/admin/job-discovery/verify',
    '/api/admin/job-discovery/reprocess',
    '/api/admin/job-discovery/tick',
    '/api/admin/job-discovery/discover',
  ];
  for (const path of commandPaths) {
    const route = registered.find((r) => r.path === path);
    assert.ok(route, `${path} must be registered`);
    const names = route.handlers.map((h) => h.name);
    assert.ok(names.includes('requireAuth'), `${path} must require auth`);
    assert.ok(names.includes('requireAdmin'), `${path} must require admin`);
  }

  /* Vercel Cron is machine-to-machine rather than session-admin traffic. Cron
     routes are allowed only under the dedicated namespace and must reject a
     request that does not carry CRON_SECRET. This preserves the §61 property:
     there is still no unauthenticated crawl trigger. */
  const publicRoutes = registered.filter((r) => !r.path.startsWith('/api/admin/'));
  const oldSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-cron-secret';
  try {
    for (const r of publicRoutes) {
      if (/^\/api\/cron\/job-discovery\//.test(r.path)) {
        const handler = r.handlers.at(-1);
        let statusCode = 200;
        let body = null;
        const res = {
          status(code) { statusCode = code; return this; },
          json(value) { body = value; return value; },
        };
        await handler({ headers: {} }, res);
        assert.equal(statusCode, 401, `${r.path} must reject a request without the cron bearer secret`);
        assert.equal(body?.error, 'cron_unauthorized');
        continue;
      }
      assert.ok(
        !/crawl|tick|discover|reprocess|verify/.test(r.path),
        `public route ${r.path} must not expose an unprotected crawl trigger`,
      );
    }
  } finally {
    if (oldSecret == null) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = oldSecret;
  }
});
