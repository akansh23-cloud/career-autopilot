/* ============================================================
   JOB DISCOVERY OS — MANUAL_INGEST_GATE
   ------------------------------------------------------------
   An operator-triggered fetch is the one path where a human is in
   the loop, which makes it the one path most likely to be given
   powers it should not have. These tests pin down that it has none.

   What is asserted:
     - targets are classified from whatever form an operator pastes
     - fetched jobs land in the CANONICAL store and are immediately
       searchable through the ordinary index — no separate
       collection, no second read path
     - re-running the same fetch UPDATES and never duplicates
     - an admin trigger does NOT bypass access policy, robots,
       adapter configuration, or the source-health credibility guard
     - there is NO artificial target/page-count ceiling for stress testing;
       serverless wall-clock deadlines defer/queue continuation instead of
       truncating the requested batch
     - a dry run touches nothing and leaves no receipt
     - receipts persist, so "what did last night's fetch do?" is
       answerable after the tab is closed
   ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryJobStore } from '../server/services/jobDiscovery/store.js';
import {
  ManualIngestService, classifyTarget, TARGET_KIND, RUN_MODE, LIMITS,
} from '../server/services/jobDiscovery/manualIngest.js';
import { PROVIDER, SOURCE_CLASS, JOB_STATUS } from '../server/services/jobDiscovery/schema.js';
import { makeService, makeSource } from './fixtures/jobDiscovery/harness.js';
import { greenhouseBoard as GREENHOUSE_BOARD, leverPostings as LEVER_POSTINGS } from './fixtures/jobDiscovery/providers.js';

const NOW = () => new Date('2026-08-14T12:00:00.000Z');

const ROUTES = [
  [/boards-api\.greenhouse\.io/, { body: GREENHOUSE_BOARD }],
  [/api\.lever\.co/, { body: LEVER_POSTINGS }],
  [/robots\.txt/, { body: 'User-agent: *\nAllow: /', contentType: 'text/plain' }],
];

async function manualService(overrides = {}) {
  const service = await makeService({ now: NOW, routes: ROUTES, queues: true, ...overrides });
  /* The harness builds the service directly rather than through the factory,
     so the manual layer is attached the same way the factory does. */
  service.manualIngest = new ManualIngestService({ service, now: NOW, logger: { warn() {} } });
  return service;
}

/* ==================== classification ==================== */

test('MANUAL_INGEST_GATE — an operator can paste any form of target', () => {
  const board = classifyTarget('https://boards.greenhouse.io/northwind');
  assert.equal(board.kind, TARGET_KIND.ATS_BOARD);
  assert.equal(board.provider, PROVIDER.GREENHOUSE);
  assert.equal(board.tenant, 'northwind');

  const workday = classifyTarget('https://acme.wd3.myworkdayjobs.com/en-US/External');
  assert.equal(workday.kind, TARGET_KIND.ATS_BOARD);
  assert.equal(workday.tenant, 'acme/wd3/External', 'the composite tenant survives classification');

  assert.equal(classifyTarget('https://acme.example/careers').kind, TARGET_KIND.CAREERS_URL);
  assert.equal(classifyTarget('acme.example').kind, TARGET_KIND.COMPANY_DOMAIN);
  assert.equal(classifyTarget('src_abc123').kind, TARGET_KIND.SOURCE_ID);

  assert.equal(classifyTarget('   ').ok, false);
  assert.equal(classifyTarget('not a target').ok, false);
});

/* ==================== the core promise ==================== */

test('MANUAL_INGEST_GATE — a manual fetch lands jobs in the canonical store and they are searchable', async () => {
  const service = await manualService();

  const before = await service.search({ q: 'Platform Engineer', limit: 10 });
  assert.equal(before.results.length, 0, 'nothing indexed yet');

  const result = await service.fetchNow(['https://boards.greenhouse.io/northwindlabs'], {
    triggeredBy: 'admin@example.com',
    reason: 'seeding the index',
  });

  assert.equal(result.ok, true);
  const [target] = result.results;
  assert.equal(target.stage, 'CRAWLED', target.reason);
  assert.ok(target.created > 0, 'the fetch created canonical jobs');
  assert.equal(target.provider, PROVIDER.GREENHOUSE);

  /* The whole point: no separate collection, no second read path. The jobs are
     reachable through the ordinary user-facing search immediately. */
  const after = await service.search({ q: 'Platform Engineer', limit: 10 });
  assert.ok(after.results.length > 0, 'manually fetched jobs are searchable through the normal index');
  assert.ok(after.results[0].job.sourceInstances.length > 0);

  /* And through the operator browse view, which reads the store rather than
     the receipt — so it can contradict the receipt if something went wrong. */
  const browsed = await service.browseJobs({ limit: 50 });
  assert.equal(browsed.total, target.created);
  assert.ok(browsed.jobs[0].applyUrl, 'stored jobs carry an apply url');
});

test('MANUAL_INGEST_GATE — re-running the same fetch updates and never duplicates', async () => {
  const service = await manualService();

  const first = await service.fetchNow(['https://boards.greenhouse.io/northwindlabs']);
  const created = first.results[0].created;
  assert.ok(created > 0);

  const second = await service.fetchNow(['https://boards.greenhouse.io/northwindlabs']);
  assert.equal(second.results[0].created, 0, 'a repeat fetch must create nothing new');
  assert.ok(second.results[0].merged > 0, 'it folds onto the existing canonical jobs');
  assert.equal(second.results[0].registered, false, 'the source is not registered twice');

  const browsed = await service.browseJobs({ limit: 100 });
  assert.equal(browsed.total, created, 'the job count is unchanged after a second identical fetch');
});

test('MANUAL_INGEST_GATE — a batch of mixed targets is fetched in one run', async () => {
  const service = await manualService();

  const result = await service.fetchNow([
    'https://boards.greenhouse.io/northwindlabs',
    'https://jobs.lever.co/harborstack',
    'not a real target',
  ]);

  assert.equal(result.results.length, 3);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[1].ok, true);
  assert.equal(result.results[2].ok, false, 'an unusable target fails on its own without failing the batch');

  const t = result.run.totals;
  assert.equal(t.targets, 3);
  assert.equal(t.succeeded, 2);
  assert.equal(t.failed, 1);
  assert.ok(t.jobsCreated > 0);
});

/* ==================== the guards a human does not bypass ==================== */

test('MANUAL_INGEST_GATE — an admin trigger does not bypass access policy', async () => {
  const service = await manualService();
  const { source } = await service.registerSource(makeSource({
    provider: PROVIDER.GREENHOUSE, sourceType: 'ATS', sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'northwindlabs', accessPolicy: 'REVIEW',
  }));

  const result = await service.fetchNow([source.id]);
  const [r] = result.results;

  assert.equal(r.ok, false);
  assert.equal(r.stage, 'ACCESS');
  assert.match(r.reason, /REVIEW/, 'the reason names the policy that blocked it');
  assert.match(r.reason, /Approve the source first/, 'and tells the operator what to do about it');

  const browsed = await service.browseJobs({});
  assert.equal(browsed.total, 0, 'nothing was fetched from an unapproved source');
});

test('MANUAL_INGEST_GATE — a provider needing credentials is reported, not silently empty', async () => {
  const service = await manualService();
  const { source } = await service.registerSource(makeSource({
    provider: PROVIDER.COMEET, sourceType: 'ATS', sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'acme', accessPolicy: 'ALLOW',
  }));

  const result = await service.fetchNow([source.id]);
  const [r] = result.results;

  assert.equal(r.ok, false);
  assert.equal(r.stage, 'NOT_CONFIGURED');
  assert.equal(r.errorClass, 'NOT_CONFIGURED');
  assert.match(r.reason, /token|credential/i, 'the operator is told what is missing');
});

test('MANUAL_INGEST_GATE — a manual fetch cannot close jobs it failed to see', async () => {
  let board = {
    jobs: Array.from({ length: 24 }, (_, i) => ({
      id: 70000 + i,
      title: `Platform Engineer ${i}`,
      requisition_id: `REQ-${i}`,
      absolute_url: `https://boards.greenhouse.io/acme/jobs/${70000 + i}`,
      updated_at: '2026-08-12T09:00:00-04:00',
      first_published: '2026-08-10T09:00:00-04:00',
      location: { name: 'Pune, India' },
      content: '<p>Own the platform.</p>',
    })),
  };
  const service = await makeService({
    now: NOW,
    routes: [[/boards-api\.greenhouse\.io/, () => ({ body: board })]],
  });
  service.manualIngest = new ManualIngestService({ service, now: NOW, logger: { warn() {} } });

  const { source } = await service.registerSource(makeSource({
    provider: PROVIDER.GREENHOUSE, sourceType: 'ATS', sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'acme', accessPolicy: 'ALLOW',
  }));

  /* Establish a healthy baseline through repeated manual fetches. */
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await service.fetchNow([source.id]);
  }
  const before = await service.browseJobs({ limit: 100 });
  assert.ok(before.total >= 20);

  /* The provider breaks. An impatient operator clicks fetch again. */
  board = { jobs: [] };
  const result = await service.fetchNow([source.id]);
  const [r] = result.results;

  assert.equal(r.credible, false, 'the run is reported as not credible');
  assert.equal(r.reconciliationAllowed, false, 'reconciliation stays blocked');
  assert.ok(r.anomalies.length > 0, 'the anomaly is named for the operator');
  assert.equal(result.run.totals.incredibleRuns, 1, 'the receipt records it too');

  const after = await service.browseJobs({ limit: 100 });
  assert.equal(after.total, before.total, 'not one job may be closed by a manual fetch of a broken board');
});

/* ==================== bounds, dry runs, receipts ==================== */

test('MANUAL_INGEST_GATE — no artificial target cap; execution remains bounded by durable continuation', async () => {
  const service = await manualService();
  const many = Array.from({ length: 75 }, (_, i) => `https://boards.greenhouse.io/tenant${i}`);

  const result = await service.fetchNow(many, { dryRun: true });
  assert.equal(LIMITS.maxTargetsPerRun, null);
  assert.equal(LIMITS.maxPagesPerSource, null);
  assert.equal(result.truncated, false);
  assert.equal(result.results.length, many.length, 'the operator batch is not silently cut to an arbitrary target count');

  /* A request that has consumed its serverless wall-clock budget does not lose
     the remainder. It converts every unstarted target into durable queue work. */
  const queued = await service.fetchNow(many.slice(0, 12), {
    deadlineAt: Date.now() - 1,
    triggeredBy: 'stress-test@example.com',
  });
  assert.equal(queued.deadlineReached, true);
  assert.equal(queued.truncated, false);
  assert.equal(queued.results.length, 12);
  assert.ok(queued.results.every((r) => r.stage === 'QUEUED'), 'all unstarted work is persisted for continuation');
});

test('MANUAL_INGEST_GATE — a dry run touches nothing and leaves no receipt', async () => {
  const service = await manualService();

  const result = await service.fetchNow(['https://boards.greenhouse.io/northwindlabs'], { dryRun: true });
  assert.equal(result.results[0].stage, 'DRY_RUN');
  assert.equal(result.results[0].ok, true);

  const browsed = await service.browseJobs({});
  assert.equal(browsed.total, 0, 'a dry run fetches nothing');

  const sources = await service.listSources({});
  assert.equal(sources.length, 0, 'a dry run registers nothing');

  const runs = await service.ingestRuns({});
  assert.equal(runs.length, 0, 'a dry run is a question, not an event — no receipt');
});

test('MANUAL_INGEST_GATE — receipts persist and attribute the fetch', async () => {
  const service = await manualService();

  await service.fetchNow(['https://boards.greenhouse.io/northwindlabs'], {
    triggeredBy: 'akansh@example.com',
    reason: 'college demo prep',
  });

  const runs = await service.ingestRuns({ limit: 10 });
  assert.equal(runs.length, 1);
  const [run] = runs;

  assert.equal(run.triggeredBy, 'akansh@example.com');
  assert.equal(run.reason, 'college demo prep');
  assert.equal(run.mode, RUN_MODE.INLINE);
  assert.equal(run.dryRun, false);
  assert.ok(run.totals.jobsCreated > 0);
  assert.equal(run.targets.length, 1);
  assert.ok(run.finishedAt >= run.startedAt);

  const fetched = await service.ingestRun(run.id);
  assert.equal(fetched.id, run.id, 'a receipt is retrievable by id after the fact');
});

test('MANUAL_INGEST_GATE — QUEUE mode hands work to the workers instead of crawling inline', async () => {
  const service = await manualService();
  const { source } = await service.registerSource(makeSource({
    provider: PROVIDER.GREENHOUSE, sourceType: 'ATS', sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'northwindlabs', accessPolicy: 'ALLOW',
  }));

  const result = await service.fetchNow([source.id], { mode: RUN_MODE.QUEUE });
  const [r] = result.results;

  assert.equal(r.stage, 'QUEUED');
  assert.equal(r.queued, true);

  const browsed = await service.browseJobs({});
  assert.equal(browsed.total, 0, 'queue mode does not crawl inline');

  const stats = await service.crawlQueue.stats();
  assert.equal(stats.total, 1, 'the work is waiting for a worker');

  /* And a worker tick actually does it. */
  const tick = await service.tick({ verify: false, discover: false });
  assert.equal(tick.crawled.length, 1);
  const after = await service.browseJobs({});
  assert.ok(after.total > 0, 'the queued fetch lands the same jobs, just later');
});

test('MANUAL_INGEST_GATE — the browse view filters what is actually stored', async () => {
  const service = await manualService();
  await service.fetchNow([
    'https://boards.greenhouse.io/northwindlabs',
    'https://jobs.lever.co/harborstack',
  ]);

  const all = await service.browseJobs({ limit: 100 });
  assert.ok(all.total > 0);

  const greenhouseOnly = await service.browseJobs({ provider: PROVIDER.GREENHOUSE, limit: 100 });
  assert.ok(greenhouseOnly.total > 0);
  assert.ok(greenhouseOnly.total < all.total, 'a provider filter genuinely narrows the set');
  for (const j of greenhouseOnly.jobs) {
    assert.ok(j.providers.includes(PROVIDER.GREENHOUSE));
  }

  const active = await service.browseJobs({ status: JOB_STATUS.NEW, limit: 100 });
  assert.equal(active.total, all.total, 'everything just fetched is NEW');

  /* Admin browsing is deliberately page-based instead of one long vertical
     list. The API owns a fixed 20-row page size so the UI cannot accidentally
     ask Mongo to materialize the entire corpus. */
  const paged = await service.browseJobs({ page: 1 });
  assert.equal(paged.pageSize, 20);
  assert.equal(paged.jobs.length, Math.min(20, all.total));
  assert.equal(paged.total, all.total, 'total reflects the whole match, not the page');
  assert.equal(paged.totalPages, Math.max(1, Math.ceil(all.total / 20)));
});

test('MANUAL_INGEST_GATE — an unlimited inline source checkpoints page continuation instead of truncating it', async () => {
  const store = new MemoryJobStore();
  let checkpoint = null;
  const source = makeSource({
    provider: PROVIDER.GREENHOUSE,
    sourceType: 'ATS',
    sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'largeboard',
    accessPolicy: 'ALLOW',
  });
  const service = {
    store,
    registry: { async get(id) { return id === source.id ? source : null; } },
    adapters: { forSource() { return { configurationStatus() { return { configured: true }; } }; } },
    ingest: {
      async runSource() {
        return {
          ok: true, fetched: 100, created: 100, merged: 0, changed: 0, rejected: 0,
          pagesFetched: 8, notModified: false, health: { credible: true, anomalies: [] },
          reconciliation: { allowed: false }, changeEvents: [], errors: [], partial: true,
          deadlineReached: true, nextCursor: 'page-9',
        };
      },
    },
    crawlQueue: {
      async enqueue() { return { ok: true, created: true, task: { id: 'cq_largeboard' } }; },
      async checkpoint(task, cp) { checkpoint = { task, cp }; return { ...task, checkpoint: cp }; },
    },
  };
  service.manualIngest = new ManualIngestService({ service, now: NOW, logger: { warn() {} } });

  const result = await service.manualIngest.fetch([source.id]);
  assert.equal(result.truncated, false);
  assert.equal(result.results[0].partial, true);
  assert.equal(result.results[0].continuationQueued, true);
  assert.equal(checkpoint.cp.cursor, 'page-9');
});
