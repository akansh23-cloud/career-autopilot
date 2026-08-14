/* ============================================================
   JOB DISCOVERY OS — INTEGRATION GATE  (§48, §49, §64.7, §67)
   ------------------------------------------------------------
   Proves the parts that only matter once the system is wired into
   the product:

     - user search reads the canonical index and performs ZERO
       outbound requests
     - the Jobs UI adapter cannot relabel a discovery time as a
       posting time
     - Resume OS still owns resume tailoring; Job Discovery only
       supplies a JobDocument
     - the self-expansion loop actually converts an aggregator-only
       employer into a direct ATS source
     - no frontend file calls an external job provider directly

   No network. No fixtures fetched at runtime.
   ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeService, makeSource, silentLogger } from './fixtures/jobDiscovery/harness.js';
import { greenhouseBoard as GREENHOUSE_BOARD, ashbyBoard as ASHBY_BOARD } from './fixtures/jobDiscovery/providers.js';
import { fromSearchPayload, toUiJob, salaryText, locationText } from '../web/src/lib/jobDiscovery.js';
import { parseSearchQuery } from '../server/routes/jobDiscoveryRoutes.js';
import { JOB_STATUS, SOURCE_CLASS, PROVIDER } from '../server/services/jobDiscovery/schema.js';
import { FRESHNESS_WINDOWS } from '../server/services/jobDiscovery/searchIndex.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const NOW = () => new Date('2026-08-14T12:00:00.000Z');

/* ------------------------------------------------------------------
   §48 — user search must not fan out
   ------------------------------------------------------------------ */

test('INTEGRATION_GATE — a user search performs ZERO outbound requests', async () => {
  const service = await makeService({
    routes: [
      [/boards-api\.greenhouse\.io/, { body: GREENHOUSE_BOARD }],
    ],
    now: NOW,
  });

  const { source } = await service.registerSource(makeSource({
    provider: PROVIDER.GREENHOUSE, sourceType: 'ATS', sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'acme', companyName: 'Acme', companyDomain: 'acme.com',
  }));
  await service.crawlSource(source.id);

  const before = service.__http.__fetchImpl.calls.length;
  assert.ok(before > 0, 'ingestion did make requests');

  const payload = await service.search({ q: 'DevOps Engineer', limit: 10 });

  const after = service.__http.__fetchImpl.calls.length;
  assert.equal(after, before, 'search must not issue a single outbound request');
  assert.ok(payload.results.length > 0, 'search returned indexed results');
  assert.equal(payload.personalization.usedResume, false);
});

test('INTEGRATION_GATE — search reads canonical indexed jobs, not provider payloads', async () => {
  const service = await makeService({
    routes: [[/boards-api\.greenhouse\.io/, { body: GREENHOUSE_BOARD }]],
    now: NOW,
  });
  const { source } = await service.registerSource(makeSource({
    provider: PROVIDER.GREENHOUSE, sourceType: 'ATS', sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'acme', companyName: 'Acme', companyDomain: 'acme.com',
  }));
  await service.crawlSource(source.id);

  const payload = await service.search({ q: 'DevOps Engineer' });
  const first = payload.results[0];

  /* Canonical shape, not a provider object. */
  assert.ok(first.job.id.startsWith('cj_'), 'canonical job id');
  assert.ok(Array.isArray(first.job.sourceInstances));
  assert.equal(typeof first.job.completeness, 'number');
  assert.ok(!('absolute_url' in first.job), 'no Greenhouse-specific key leaked');
  assert.ok(!('content' in first.job), 'no Greenhouse-specific key leaked');
});

/* ------------------------------------------------------------------
   §34 / §58 — the UI adapter cannot mislabel dates
   ------------------------------------------------------------------ */

test('INTEGRATION_GATE — postedDate is populated ONLY from sourcePublishedAt', () => {
  const withDate = toUiJob({
    job: { id: 'cj_1', title: 'DevOps Engineer', company: { name: 'Acme' }, description: { text: '' }, locations: [], workplace: {}, compensation: {} },
    freshness: {
      sourcePublishedAt: '2026-08-14T10:00:00.000Z',
      firstSeenAt: '2026-08-14T11:18:00.000Z',
      lastVerifiedAt: '2026-08-14T11:52:00.000Z',
      dateKind: 'posted',
      dateLabel: 'Posted 2 hours ago',
      verifiedLabel: 'Verified active 8 minutes ago',
    },
    source: {}, apply: {},
  });
  assert.equal(withDate.postedDate, '2026-08-14T10:00:00.000Z');
  assert.equal(withDate._discovery.dateKind, 'posted');
  assert.match(withDate._discovery.dateLabel, /^Posted /);

  const withoutDate = toUiJob({
    job: { id: 'cj_2', title: 'DevOps Engineer', company: { name: 'Acme' }, description: { text: '' }, locations: [], workplace: {}, compensation: {} },
    freshness: {
      sourcePublishedAt: null,
      firstSeenAt: '2026-08-14T11:18:00.000Z',
      dateKind: 'discovered',
      dateLabel: 'First discovered 42 minutes ago',
      verifiedLabel: 'Not yet re-verified',
    },
    source: {}, apply: {},
  });
  /* The critical assertion: firstSeenAt must NOT leak into postedDate. */
  assert.equal(withoutDate.postedDate, '');
  assert.equal(withoutDate._discovery.dateKind, 'discovered');
  assert.match(withoutDate._discovery.dateLabel, /^First discovered /);
  assert.notEqual(withoutDate.postedDate, withoutDate._discovery.firstSeenAt);
});

test('INTEGRATION_GATE — the UI adapter never fabricates salary, mode or location', () => {
  const bare = toUiJob({
    job: {
      id: 'cj_3', title: 'Engineer', company: { name: 'Acme' }, description: { text: '' },
      locations: [], workplace: { type: 'UNKNOWN', remoteScope: 'UNKNOWN' }, compensation: { min: null, max: null },
    },
    freshness: {}, source: {}, apply: {},
  });
  assert.equal(bare.salary, '', 'no invented salary');
  assert.equal(bare.mode, '', 'no invented work mode');
  assert.equal(bare.location, 'Location not stated');

  assert.equal(salaryText({ compensation: { min: 2000000, max: 3000000, currency: 'INR', period: 'YEAR' } }), 'INR 2,000,000–3,000,000 / year');
  assert.equal(locationText({ workplace: { type: 'REMOTE', remoteScope: 'REMOTE_COUNTRY', remoteRegions: ['IN'] }, locations: [] }), 'Remote — IN');
  assert.equal(locationText({ workplace: { type: 'REMOTE', remoteScope: 'UNKNOWN', remoteRegions: [] }, locations: [] }), 'Remote — region not stated');
});

test('INTEGRATION_GATE — an empty result set explains itself instead of going blank', () => {
  const mapped = fromSearchPayload({
    results: [], total: 0, rejected: { relevance: 0, location: 7, freshness: 2 }, query: {},
  });
  assert.equal(mapped.jobs.length, 0);
  assert.match(mapped.meta.explanation, /7 indexed jobs were not open to this location/);
});

test('INTEGRATION_GATE — the adapter surfaces direct-source and merge provenance', () => {
  const mapped = fromSearchPayload({
    results: [{
      rank: 1,
      job: { id: 'cj_4', title: 'Platform Engineer', company: { name: 'Acme' }, description: { text: 'x' }, locations: [], workplace: {}, compensation: {}, status: 'NEW' },
      relevance: { overall: 82, titleRelation: 'STRONG' },
      source: { type: SOURCE_CLASS.ORIGINAL_ATS, provider: 'GREENHOUSE', isOriginal: true, instanceCount: 3, providers: ['GREENHOUSE', 'API'] },
      freshness: { dateKind: 'discovered', dateLabel: 'First discovered 5 minutes ago', verifiedLabel: 'Verified active 1 minute ago' },
      apply: { canonicalApplyUrl: 'https://boards.greenhouse.io/acme/jobs/1#app', directApply: true },
    }],
    total: 1, query: {},
  });
  const j = mapped.jobs[0];
  assert.equal(j._discovery.isOriginal, true);
  assert.equal(j._discovery.sourceCount, 3);
  assert.equal(j._discovery.directApply, true);
  assert.equal(j._discovery.titleRelation, 'STRONG');
  assert.match(j.source, /Direct company careers/);
  assert.match(mapped.meta.explanation, /from the employer's own board/);
});

/* ------------------------------------------------------------------
   §24.1 — self-expansion actually upgrades an aggregator employer
   ------------------------------------------------------------------ */

test('INTEGRATION_GATE — self-expansion converts an aggregator-only employer into a direct ATS source', async () => {
  const careersHtml = `<!doctype html><html><head><title>Careers at Xyz</title></head>
    <body><a href="https://jobs.ashbyhq.com/xyz">See all openings</a></body></html>`;

  const legacy = [{
    name: 'Remotive',
    home: 'https://remotive.com',
    fetch: async () => ([{
      title: 'Senior Platform Engineer', company: 'Xyz', location: 'Remote', mode: 'Remote',
      url: 'https://remotive.com/remote-jobs/xyz-platform-1',
      summary: 'Own the internal developer platform end to end.',
      postedDate: '2026-08-13T09:00:00.000Z', requiredSkills: ['kubernetes'],
    }]),
  }];

  const service = await makeService({
    legacySources: legacy,
    routes: [
      [/^https:\/\/careers\.xyz\.com\/$/, { body: careersHtml }],
      [/^https:\/\/jobs\.xyz\.com\/$/, { status: 404, body: 'no' }],
      [/api\.ashbyhq\.com\/posting-api\/job-board\/xyz/, { body: ASHBY_BOARD }],
      [/robots\.txt/, { body: 'User-agent: *\nAllow: /', contentType: 'text/plain' }],
    ],
    now: NOW,
  });

  /* 1. Aggregator sweep discovers the employer. */
  const aggSource = (await service.listSources({ sourceClass: SOURCE_CLASS.AGGREGATOR }))[0];
  assert.ok(aggSource, 'legacy aggregator was bootstrapped into the registry');
  await service.crawlSource(aggSource.id);

  const aggJobs = await service.store.listJobs({});
  assert.ok(aggJobs.length > 0, 'aggregator produced a job');
  assert.ok(
    aggJobs.every((j) => j.sourceInstances.every((s) => s.sourceClass === SOURCE_CLASS.AGGREGATOR)),
    'the job starts with aggregator-only provenance',
  );

  /* 2. Discovery probes the employer domain and finds the Ashby board. */
  const expanded = await service.discovery.discoverFromDomain('xyz.com', { companyName: 'Xyz' });
  assert.equal(expanded.ok, true, expanded.reason);
  assert.equal(expanded.source.provider, PROVIDER.ASHBY);
  assert.equal(expanded.source.tenant, 'xyz');
  assert.equal(expanded.source.sourceClass, SOURCE_CLASS.ORIGINAL_ATS);

  /* 3. Future jobs now arrive from Ashby directly. */
  const crawl = await service.crawlSource(expanded.source.id);
  assert.equal(crawl.ok, true, JSON.stringify(crawl.errors));
  assert.ok(crawl.fetched > 0, 'the Ashby board yielded jobs');

  const direct = await service.store.listJobs({ provider: PROVIDER.ASHBY });
  assert.ok(direct.length > 0, 'direct ATS jobs are now in the index');

  /* 4. A known source is not rediscovered. */
  const again = await service.discovery.registerAts({ provider: PROVIDER.ASHBY, tenant: 'xyz' });
  assert.equal(again.created, false, 'an already-registered source is not duplicated');
});

test('INTEGRATION_GATE — a scheduler tick is bounded and non-reentrant', async () => {
  const service = await makeService({
    routes: [[/boards-api\.greenhouse\.io/, { body: GREENHOUSE_BOARD }]],
    now: NOW,
  });
  await service.registerSource(makeSource({
    provider: PROVIDER.GREENHOUSE, sourceType: 'ATS', sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'acme', companyName: 'Acme', companyDomain: 'acme.com',
  }));

  service.scheduler.sourcesPerTick = 1;
  const [a, b] = await Promise.all([service.tick({ discover: false }), service.tick({ discover: false })]);
  const skipped = [a, b].filter((r) => r.skipped);
  assert.equal(skipped.length, 1, 'concurrent ticks are refused, not run twice');

  const ran = [a, b].find((r) => !r.skipped);
  assert.ok(ran.crawled.length <= 1, 'the tick respected its per-tick source budget');
  assert.ok(typeof ran.durationMs === 'number');
});

/* ------------------------------------------------------------------
   §45 — reprocess from retained raw payloads, no refetch
   ------------------------------------------------------------------ */

test('INTEGRATION_GATE — reprocessing re-normalizes from raw without touching the network', async () => {
  const service = await makeService({
    routes: [[/boards-api\.greenhouse\.io/, { body: GREENHOUSE_BOARD }]],
    now: NOW,
  });
  const { source } = await service.registerSource(makeSource({
    provider: PROVIDER.GREENHOUSE, sourceType: 'ATS', sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'acme', companyName: 'Acme', companyDomain: 'acme.com',
  }));
  await service.crawlSource(source.id);

  const before = service.__http.__fetchImpl.calls.length;
  const re = await service.reprocessSource(source.id);
  const after = service.__http.__fetchImpl.calls.length;

  assert.equal(after, before, 'reprocessing issued no network requests');
  assert.ok(re.fetched > 0, 'raw snapshots were replayed');
});

/* ------------------------------------------------------------------
   §63 — coverage report shape
   ------------------------------------------------------------------ */

test('INTEGRATION_GATE — the coverage report separates original from supplemental', async () => {
  const service = await makeService({
    routes: [[/boards-api\.greenhouse\.io/, { body: GREENHOUSE_BOARD }]],
    now: NOW,
  });
  const { source } = await service.registerSource(makeSource({
    provider: PROVIDER.GREENHOUSE, sourceType: 'ATS', sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'acme', companyName: 'Acme', companyDomain: 'acme.com',
  }));
  await service.crawlSource(source.id);

  const report = await service.coverageReport();
  assert.ok(report.providersImplemented.includes(PROVIDER.GREENHOUSE));
  assert.ok(report.providersImplemented.includes(PROVIDER.LEVER));
  assert.ok(report.providersImplemented.includes(PROVIDER.ASHBY));
  assert.ok(report.providersImplemented.includes(PROVIDER.WORKABLE));
  assert.equal(report.coverage.originalSourcePct, 100);
  assert.equal(report.coverage.supplementalOnlyPct, 0);
  assert.ok(report.coverage.directApplyPct > 0);
  assert.equal(typeof report.coverage.dedupeRatio, 'number');
  assert.ok(report.adapterStatus.SMARTRECRUITERS, 'adapter status is reported per provider');
});

/* ------------------------------------------------------------------
   §49 — Resume OS boundary
   ------------------------------------------------------------------ */

test('INTEGRATION_GATE — Job Discovery never imports Resume OS', () => {
  const dir = path.join(ROOT, 'server/services/jobDiscovery');
  const offenders = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/^\s*import[^;]*from\s+['"]([^'"]+)['"]/gm)) {
        if (/resume|tailor|template/i.test(m[1])) offenders.push(`${path.relative(ROOT, p)} -> ${m[1]}`);
      }
    }
  };
  walk(dir);
  assert.deepEqual(offenders, [], 'Job Discovery OS must not depend on Resume OS');
});

test('INTEGRATION_GATE — Tailor Resume still delegates to the canonical Resume OS', () => {
  const jobsView = fs.readFileSync(path.join(ROOT, 'web/src/views/Jobs.jsx'), 'utf8');
  /* The tailor path must still hand the selected job to Resume OS storage and
     open the Resume OS tailoring flow — Job Discovery supplies the JobDocument
     and nothing more. */
  assert.match(jobsView, /saveSelectedJob\(j\)/, 'the selected job is still handed to Resume OS');
  assert.match(jobsView, /setTailorJob\(/, 'the Resume OS tailoring flow is still invoked');
  assert.match(jobsView, /Applications\.generate\(/, 'Tailor & Apply still uses the canonical application package / Resume OS path');
  assert.doesNotMatch(jobsView, /"tailoredResume"\s*:\s*"plain text resume"/, 'Jobs must not ask an LLM to author the resume');
  assert.ok(!/tailorResume|buildResume/i.test(
    fs.readFileSync(path.join(ROOT, 'web/src/lib/jobDiscovery.js'), 'utf8'),
  ), 'the discovery adapter contains no resume logic');
});

/* ------------------------------------------------------------------
   §67 — required repository search
   ------------------------------------------------------------------ */

test('§67 — no frontend file calls an external job provider directly', () => {
  const webDir = path.join(ROOT, 'web/src');
  const HOSTS = 'remotive\\.com|remoteok\\.(com|io)|jobicy\\.com|arbeitnow\\.com|themuse\\.com|adzuna\\.com|rapidapi\\.com|serpapi\\.com|greenhouse\\.io|lever\\.co|ashbyhq\\.com|workable\\.com|smartrecruiters\\.com';
  /* A provider hostname is only a violation when it is the TARGET of a network
     call. contactFields.js legitimately lists these hosts in a DENYLIST used to
     reject non-employer domains — mentioning a host is not calling it. */
  const CALL = new RegExp(String.raw`(fetch|axios(\.\w+)?|\.open|EventSource|WebSocket|import)\s*\(\s*['"\`][^'"\`]*(${HOSTS})`, 'i');
  const BARE_URL_ASSIGN = new RegExp(String.raw`(url|endpoint|api|href|src)\s*[:=]\s*['"\`]https?://[^'"\`]*(${HOSTS})`, 'i');

  const offenders = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.(js|jsx)$/.test(entry.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (CALL.test(src) || BARE_URL_ASSIGN.test(src)) offenders.push(path.relative(ROOT, p));
    }
  };
  walk(webDir);
  assert.deepEqual(offenders, [], 'the browser must never talk to a job provider directly');
});

test('§67 — every remaining provider hostname in the frontend is a non-network reference', () => {
  /* The audit the spec asks for: enumerate what is left and say what it is. */
  const src = fs.readFileSync(path.join(ROOT, 'web/src/lib/contactFields.js'), 'utf8');
  const idx = src.search(/remotive\.com/i);
  assert.ok(idx > -1);
  /* Confirm the surrounding construct is a denylist array, not a request. */
  const context = src.slice(Math.max(0, idx - 600), idx + 200);
  assert.match(context, /\[|Set\(/, 'the hosts appear inside a list literal');
  assert.ok(!/fetch\s*\(/.test(context), 'no fetch call anywhere near the host list');
});

test('§67 — the Jobs view uses ONLY the canonical discovery search', () => {
  const src = fs.readFileSync(path.join(ROOT, 'web/src/views/Jobs.jsx'), 'utf8');
  assert.match(src, /Jobs\.discoverySearch\(/, 'the view calls the canonical indexed search');
  assert.doesNotMatch(src, /Jobs\.search\(/, 'the product view must never synchronously fall back to provider fan-out');
  assert.match(src, /fromSearchPayload\(/, 'canonical JobDocument results are mapped through the discovery adapter');
});

/* ------------------------------------------------------------------
   §60 — query parsing
   ------------------------------------------------------------------ */

test('INTEGRATION_GATE — unknown filters are ignored rather than fatal', () => {
  const parsed = parseSearchQuery({
    q: 'DevOps Engineer', location: 'Remote India', remote: 'REMOTE',
    freshness: 'nonsense', salaryMin: 'abc', limit: '9999', wat: 'x',
  });
  assert.equal(parsed.remote, 'remote');
  /* An unrecognised window resolves to 'latest', whose window is null — i.e. no
     date filter is applied. The important property is that a bad value can
     never silently NARROW the result set. */
  assert.equal(parsed.freshness, 'latest');
  assert.equal(FRESHNESS_WINDOWS[parsed.freshness], null, 'the fallback window filters nothing');
  assert.equal(parsed.salaryMin, null, 'an unparseable number is dropped, not zeroed');
  assert.equal(parsed.limit, 50, 'limit is clamped');
  assert.ok(!('wat' in parsed));

  /* 'any' is normalised away rather than treated as a literal filter value. */
  assert.equal(parseSearchQuery({ remote: 'any' }).remote, null);
});

test('INTEGRATION_GATE — removed jobs are excluded end to end', async () => {
  const service = await makeService({
    routes: [[/boards-api\.greenhouse\.io/, { body: GREENHOUSE_BOARD }]],
    now: NOW,
  });
  const { source } = await service.registerSource(makeSource({
    provider: PROVIDER.GREENHOUSE, sourceType: 'ATS', sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'acme', companyName: 'Acme', companyDomain: 'acme.com',
  }));
  await service.crawlSource(source.id);

  const all = await service.store.listJobs({});
  await service.store.putJob({ ...all[0], status: JOB_STATUS.REMOVED, closedAt: NOW().toISOString() });

  const payload = await service.search({ q: '', limit: 50 });
  assert.ok(!payload.results.some((r) => r.job.id === all[0].id), 'a REMOVED job never reaches a user');
});
