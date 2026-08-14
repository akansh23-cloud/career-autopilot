/* ============================================================
   JOB DISCOVERY OS — DISCOVERY_GATE + INGEST_GATE (queues)
   ------------------------------------------------------------
   The two durable queues are what turn discovery and crawling from
   a single-process sweep into work that compounds and survives a
   crash. These tests assert the properties that make that true —
   and, just as importantly, the ones that stop the system from
   destroying data when a provider misbehaves.

   DISCOVERY_GATE
     - a lead is deduped by canonical key; the same company is
       never rediscovered
     - failures back off exponentially and are eventually EXHAUSTED,
       never silently dropped
     - a robots DENY is permanent and goes straight to DEAD
     - the company registry short-circuits work we already did
     - the full chain company -> careers page -> ATS -> tenant ->
       registered source -> crawl actually runs end to end

   INGEST_GATE
     - enqueueing the same due-window twice yields ONE crawl
     - a leased task is invisible to a second worker
     - an expired lease is reclaimable, so a dead worker strands
       nothing
     - progress is checkpointed and a resumed crawl continues
     - transient failures retry with backoff; exhausted ones are
       dead-lettered WITH their error and without touching jobs
     - a broken parser can never close a board's jobs
   ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryJobStore } from '../server/services/jobDiscovery/store.js';
import {
  DiscoveryQueue, DISCOVERY_KIND, DISCOVERY_STATE, discoveryKey, backoffHours, leadsFromJob,
} from '../server/services/jobDiscovery/discoveryQueue.js';
import {
  CrawlQueue, CRAWL_STATE, idempotencyKeyFor, interleaveByHost,
} from '../server/services/jobDiscovery/crawlQueue.js';
import { CompanyRegistry } from '../server/services/jobDiscovery/companyRegistry.js';
import { assessRun, mayReconcileMissing, ANOMALY } from '../server/services/jobDiscovery/sourceHealth.js';
import { detectAts } from '../server/services/jobDiscovery/atsDetect.js';
import { ERROR_CLASS, PROVIDER, SOURCE_CLASS, JOB_STATUS } from '../server/services/jobDiscovery/schema.js';
import { makeService, makeSource } from './fixtures/jobDiscovery/harness.js';
import { greenhouseBoard as GREENHOUSE_BOARD } from './fixtures/jobDiscovery/providers.js';

const NOW = () => new Date('2026-08-14T12:00:00.000Z');

async function freshQueue({ now = NOW } = {}) {
  const store = await new MemoryJobStore().init();
  return { store, queue: new DiscoveryQueue({ store, now, logger: { warn() {}, info() {} } }) };
}

/* ==================== DISCOVERY_GATE ==================== */

test('DISCOVERY_GATE — the same company is never queued twice', async () => {
  const { queue, store } = await freshQueue();

  const a = await queue.enqueue({ kind: DISCOVERY_KIND.COMPANY_DOMAIN, value: 'acme.com', confidence: 0.4 });
  const b = await queue.enqueue({ kind: DISCOVERY_KIND.COMPANY_DOMAIN, value: 'https://www.acme.com/careers', confidence: 0.8 });
  const c = await queue.enqueue({ kind: DISCOVERY_KIND.COMPANY_DOMAIN, value: 'ACME.com' });

  assert.equal(a.created, true);
  assert.equal(b.created, false, 'a URL on the same registrable domain is the same lead');
  assert.equal(c.created, false, 'case must not create a second lead');

  const all = await store.listDiscoveryTasks({});
  assert.equal(all.length, 1, 'one company, one task');
  /* Stronger evidence enriches the existing lead rather than duplicating it. */
  assert.equal(all[0].confidence, 0.8);
});

test('DISCOVERY_GATE — the dedupe key is canonical across equivalent inputs', () => {
  assert.equal(
    discoveryKey(DISCOVERY_KIND.COMPANY_DOMAIN, 'https://careers.acme.com/jobs'),
    discoveryKey(DISCOVERY_KIND.COMPANY_DOMAIN, 'acme.com'),
  );
  assert.notEqual(
    discoveryKey(DISCOVERY_KIND.COMPANY_DOMAIN, 'acme.com'),
    discoveryKey(DISCOVERY_KIND.CAREERS_URL, 'acme.com'),
    'different kinds are different leads even for the same string',
  );
});

test('DISCOVERY_GATE — failures back off exponentially and end EXHAUSTED, never deleted', async () => {
  const { queue, store } = await freshQueue();
  await queue.enqueue({ kind: DISCOVERY_KIND.COMPANY_DOMAIN, value: 'nowhere.example' });

  let task = (await queue.lease({ limit: 1 }))[0];
  const delays = [];
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    task = await queue.fail(task, { errorClass: ERROR_CLASS.NETWORK, reason: 'unreachable' });
    if (task.nextAttemptAt) {
      delays.push(Date.parse(task.nextAttemptAt) - NOW().getTime());
    }
  }

  for (let i = 1; i < delays.length; i += 1) {
    assert.ok(delays[i] > delays[i - 1], `backoff must grow: ${delays.join(', ')}`);
  }
  assert.equal(task.state, DISCOVERY_STATE.EXHAUSTED);
  assert.equal(task.failureReason, ERROR_CLASS.NETWORK, 'the reason is retained');
  assert.equal((await store.listDiscoveryTasks({})).length, 1, 'an exhausted lead is kept as a record, not deleted');
  assert.ok(backoffHours(5) > backoffHours(1));
});

test('DISCOVERY_GATE — a robots denial is permanent and is never retried', async () => {
  const { queue } = await freshQueue();
  await queue.enqueue({ kind: DISCOVERY_KIND.CAREERS_URL, value: 'https://noindex.example/careers' });
  const task = (await queue.lease({ limit: 1 }))[0];
  const failed = await queue.fail(task, { errorClass: ERROR_CLASS.ROBOTS_DENIED, reason: 'robots denies crawling' });

  assert.equal(failed.state, DISCOVERY_STATE.DEAD);
  assert.equal(failed.nextAttemptAt, null, 'a dead lead has no next attempt');
  assert.equal((await queue.lease({ limit: 5 })).length, 0, 'a dead lead is never leased again');
});

test('DISCOVERY_GATE — a resolved lead is rechecked much later, not closed forever', async () => {
  const { queue } = await freshQueue();
  await queue.enqueue({ kind: DISCOVERY_KIND.COMPANY_DOMAIN, value: 'acme.com' });
  const task = (await queue.lease({ limit: 1 }))[0];
  const resolved = await queue.resolve(task, { sourceId: 'src_1', reason: 'registered' });

  assert.equal(resolved.state, DISCOVERY_STATE.RESOLVED);
  assert.equal(resolved.resolvedSourceId, 'src_1');
  const days = (Date.parse(resolved.nextAttemptAt) - NOW().getTime()) / 86400000;
  assert.ok(days > 14, `companies change ATS vendors; recheck should be weeks out, got ${days} days`);
  assert.equal((await queue.lease({ limit: 5 })).length, 0, 'a resolved lead is not due yet');
});

test('DISCOVERY_GATE — an aggregator apply URL becomes the highest-confidence lead', () => {
  const job = {
    id: 'job_1',
    company: { name: 'Northwind', domain: 'northwind.example', normalizedName: 'northwind' },
    sourceInstances: [{
      sourceId: 'agg', sourceClass: SOURCE_CLASS.AGGREGATOR, provider: PROVIDER.API,
      applyUrl: 'https://boards.greenhouse.io/northwind/jobs/55',
      jobUrl: 'https://aggregator.example/jobs/55',
    }],
  };
  const leads = leadsFromJob(job, { detectAts });
  const ats = leads.find((l) => l.kind === DISCOVERY_KIND.ATS_LINK);
  assert.ok(ats, 'the ATS board hidden in the apply URL must be extracted');
  assert.equal(ats.value, 'GREENHOUSE:northwind');
  assert.ok(ats.priority > leads.find((l) => l.kind === DISCOVERY_KIND.COMPANY_DOMAIN).priority,
    'a known board outranks a domain we would have to probe');
});

test('DISCOVERY_GATE — a job with no identity produces a recorded gap, not silence', () => {
  const job = { id: 'job_x', company: { name: 'Unknown Co', normalizedName: 'unknown co' }, sourceInstances: [] };
  const leads = leadsFromJob(job, { detectAts });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].kind, DISCOVERY_KIND.JOB_BACKFILL, 'the gap is recorded so the job is not lost');
});

test('DISCOVERY_GATE — the company registry short-circuits work already done', async () => {
  const store = await new MemoryJobStore().init();
  const companies = new CompanyRegistry({ store, now: NOW });

  assert.equal((await companies.discoveryHint({ domain: 'acme.com' })).skipProbe, false);

  await companies.upsert({ name: 'Acme', domain: 'acme.com', atsProvider: PROVIDER.GREENHOUSE, atsTenant: 'acme' },
    { source: 'discovery', confidence: 0.9 });

  const hint = await companies.discoveryHint({ domain: 'acme.com' });
  assert.equal(hint.skipProbe, true);
  assert.match(hint.reason, /GREENHOUSE:acme/);

  /* Repeated failures also stop the probing, so a dead domain is not hammered. */
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await companies.recordDiscovery({ domain: 'dead.example', outcome: 'no careers surface' });
  }
  const dead = await companies.discoveryHint({ domain: 'dead.example' });
  assert.equal(dead.skipProbe, true);
  assert.match(dead.reason, /already failed/);
});

test('DISCOVERY_GATE — weaker evidence never overwrites a stronger stored fact', async () => {
  const store = await new MemoryJobStore().init();
  const companies = new CompanyRegistry({ store, now: NOW });
  await companies.upsert({ name: 'Acme Inc', domain: 'acme.com', careersUrl: 'https://acme.com/careers' },
    { source: 'careers-page', confidence: 0.9 });
  await companies.upsert({ name: 'ACME', domain: 'acme.com', careersUrl: 'https://aggregator.example/acme' },
    { source: 'aggregator', confidence: 0.2 });

  const company = await companies.find({ domain: 'acme.com' });
  assert.equal(company.careersUrl, 'https://acme.com/careers', 'a low-confidence source must not overwrite a high-confidence one');
});

test('DISCOVERY_GATE — company -> careers page -> ATS -> tenant -> source -> crawl runs end to end', async () => {
  const careersPage = `<html><body>
    <a href="https://boards.greenhouse.io/northwind">See our openings</a>
  </body></html>`;

  const service = await makeService({
    queues: true,
    now: NOW,
    routes: [
      [/^https:\/\/careers\.northwind\.example\/$/, { body: careersPage, contentType: 'text/html' }],
      [/robots\.txt/, { body: 'User-agent: *\nAllow: /', contentType: 'text/plain' }],
      [/boards-api\.greenhouse\.io/, { body: GREENHOUSE_BOARD }],
    ],
  });

  /* Start from nothing but a domain. */
  await service.discovery.seedFromDomain('northwind.example', { companyName: 'Northwind' });
  const queued = await service.discoveryQueue.lease({ limit: 5 });
  assert.equal(queued.length, 1);

  const result = await service.discovery.processTask(queued[0]);
  assert.equal(result.ok, true, `discovery failed: ${result.reason}`);
  assert.equal(result.source.provider, PROVIDER.GREENHOUSE);
  assert.equal(result.source.tenant, 'northwind', 'the tenant was identified from the linked board');

  /* The registered source must now be crawlable, producing real canonical jobs. */
  const crawl = await service.crawlSource(result.source.id);
  assert.equal(crawl.ok, true);
  assert.ok(crawl.created > 0, 'the newly discovered source produced jobs');

  /* And the company knowledge is retained so this is never redone. */
  const hint = await service.companies.discoveryHint({ domain: 'northwind.example' });
  assert.equal(hint.skipProbe, true);
});

/* ==================== INGEST_GATE (queue) ==================== */

async function crawlSetup() {
  const store = await new MemoryJobStore().init();
  const queue = new CrawlQueue({ store, now: NOW, jitter: () => 0.5 });
  const source = { id: 'src_1', crawlIntervalMinutes: 60, crawlPriority: 10, careersUrl: 'https://boards.greenhouse.io/acme', provider: PROVIDER.GREENHOUSE, sourceClass: SOURCE_CLASS.ORIGINAL_ATS };
  return { store, queue, source };
}

test('INGEST_GATE — the same due-window enqueues exactly one crawl', async () => {
  const { queue, source, store } = await crawlSetup();
  const a = await queue.enqueue(source);
  const b = await queue.enqueue(source);
  const c = await queue.enqueue(source);

  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(c.created, false);
  assert.equal((await store.listCrawlTasks({})).length, 1, 'a duplicate trigger must not double-crawl a board');
  assert.equal(idempotencyKeyFor(source, { at: NOW() }), idempotencyKeyFor(source, { at: NOW() }));
});

test('INGEST_GATE — a leased task is invisible to a second worker', async () => {
  const { queue, source } = await crawlSetup();
  await queue.enqueue(source);

  const workerA = await queue.lease({ limit: 5, owner: 'worker-a' });
  const workerB = await queue.lease({ limit: 5, owner: 'worker-b' });

  assert.equal(workerA.length, 1);
  assert.equal(workerB.length, 0, 'two workers must never hold the same task');
  assert.equal(workerA[0].leaseOwner, 'worker-a');
  assert.equal(workerA[0].state, CRAWL_STATE.LEASED);
});

test('INGEST_GATE — an expired lease is reclaimed, so a dead worker strands nothing', async () => {
  const { store } = await crawlSetup();
  let clock = new Date('2026-08-14T12:00:00.000Z');
  const queue = new CrawlQueue({ store, now: () => clock, leaseMs: 60_000, jitter: () => 0.5 });
  const source = { id: 'src_1', crawlIntervalMinutes: 60, careersUrl: 'https://x.example' };

  await queue.enqueue(source);
  const first = await queue.lease({ limit: 1, owner: 'worker-a' });
  assert.equal(first.length, 1);

  /* worker-a dies without ever completing or failing the task. */
  clock = new Date('2026-08-14T12:05:00.000Z');
  const reclaimed = await queue.lease({ limit: 1, owner: 'worker-b' });
  assert.equal(reclaimed.length, 1, 'an expired lease must be reclaimable');
  assert.equal(reclaimed[0].leaseOwner, 'worker-b');
  assert.ok(reclaimed[0].attempts >= 2, 'the reclaimed attempt is counted');
});

test('INGEST_GATE — progress is checkpointed so a resumed crawl does not restart the board', async () => {
  const store = await new MemoryJobStore().init();
  /* A moving clock: the whole point of a checkpoint is what happens as TIME
     passes during a long crawl, so a frozen clock cannot express it. */
  let clock = new Date('2026-08-14T12:00:00.000Z');
  const queue = new CrawlQueue({ store, now: () => clock, leaseMs: 300_000, jitter: () => 0.5 });
  const source = { id: 'src_1', crawlIntervalMinutes: 60, careersUrl: 'https://boards.greenhouse.io/acme' };

  await queue.enqueue(source);
  const [task] = await queue.lease({ limit: 1, owner: 'worker-a' });

  clock = new Date('2026-08-14T12:02:00.000Z');
  await queue.checkpoint(task, { cursor: { offset: 200 }, pagesFetched: 10 });

  const stored = await store.getCrawlTask(task.id);
  assert.deepEqual(stored.checkpoint.cursor, { offset: 200 }, 'the page cursor survives for a resumed crawl');
  assert.equal(stored.checkpoint.pagesFetched, 10);
  assert.ok(Date.parse(stored.leaseExpiresAt) > Date.parse(task.leaseExpiresAt),
    'genuine progress extends the lease rather than losing it to another worker');

  /* And the resumed worker gets the cursor back rather than page one. */
  clock = new Date('2026-08-14T12:20:00.000Z');
  const [resumed] = await queue.lease({ limit: 1, owner: 'worker-b' });
  assert.deepEqual(resumed.checkpoint.cursor, { offset: 200 });
});

test('INGEST_GATE — transient failures retry with growing backoff, then dead-letter', async () => {
  const store = await new MemoryJobStore().init();
  /* Time has to move, or the retry never becomes available and the attempt
     counter never advances — which would make a "growing backoff" assertion
     pass for the wrong reason. */
  let clock = new Date('2026-08-14T12:00:00.000Z');
  const queue = new CrawlQueue({ store, now: () => clock, jitter: () => 0.5 });
  const source = { id: 'src_1', crawlIntervalMinutes: 60, careersUrl: 'https://boards.greenhouse.io/acme' };
  await queue.enqueue(source);

  const delays = [];
  let task = (await queue.lease({ limit: 1 }))[0];
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    task = await queue.fail(task, { errorClass: ERROR_CLASS.NETWORK, message: 'connection reset' });
    if (task.state === CRAWL_STATE.RETRY) {
      delays.push(Date.parse(task.availableAt) - clock.getTime());
      /* Jump past the backoff so the retry is genuinely picked up again. */
      clock = new Date(Date.parse(task.availableAt) + 1000);
      // eslint-disable-next-line no-await-in-loop
      task = (await queue.lease({ limit: 1 }))[0] || task;
    }
  }

  for (let i = 1; i < delays.length; i += 1) {
    assert.ok(delays[i] > delays[i - 1], `retry backoff must grow: ${delays.join(', ')}`);
  }
  assert.equal(task.state, CRAWL_STATE.DEAD);
  assert.equal(task.lastError.errorClass, ERROR_CLASS.NETWORK, 'the dead letter retains why it died');
  assert.equal(task.deadLetterReason, 'attempts exhausted');

  const letters = await queue.deadLetters();
  assert.equal(letters.length, 1, 'a dead-lettered task is retained, never silently dropped');

  const requeued = await queue.requeueDeadLetter(task.id);
  assert.equal(requeued.ok, true);
  assert.equal(requeued.task.state, CRAWL_STATE.PENDING, 'an operator can put it back');
});

test('INGEST_GATE — a non-retryable failure dead-letters immediately', async () => {
  const { queue, source } = await crawlSetup();
  await queue.enqueue(source);
  const [task] = await queue.lease({ limit: 1 });
  const failed = await queue.fail(task, { errorClass: ERROR_CLASS.ROBOTS_DENIED, message: 'robots denies' });

  assert.equal(failed.state, CRAWL_STATE.DEAD);
  assert.equal(failed.deadLetterReason, 'non-retryable failure');
  assert.equal(failed.attempts, 1, 'we do not spend five attempts on something we are not permitted to fetch');
});

test('INGEST_GATE — host fairness stops one employer monopolising a tick', () => {
  const tasks = [];
  for (let i = 0; i < 50; i += 1) tasks.push({ id: `a${i}`, host: 'big.example', priority: 100 });
  for (let i = 0; i < 3; i += 1) tasks.push({ id: `b${i}`, host: 'small.example', priority: 1 });

  const ordered = interleaveByHost(tasks);
  const firstTwo = new Set(ordered.slice(0, 2).map((t) => t.host));
  assert.equal(firstTwo.size, 2, 'a lower-priority host must still get a slot in the first round');
});

/* ---- the destructive-failure guard ---- */

test('INGEST_GATE — a collapsed job count blocks reconciliation instead of closing jobs', () => {
  const source = {
    id: 'src_1',
    health: { window: [
      { ok: true, jobs: 400 }, { ok: true, jobs: 398 }, { ok: true, jobs: 402 },
      { ok: true, jobs: 401 }, { ok: true, jobs: 399 },
    ] },
  };

  const healthy = assessRun(source, { fetched: 395, rejected: 0, errors: [] });
  assert.equal(healthy.credible, true);
  assert.equal(mayReconcileMissing({ authoritative: true, assessment: healthy }).allowed, true);

  const broken = assessRun(source, { fetched: 3, rejected: 0, errors: [] });
  assert.equal(broken.credible, false);
  assert.ok(broken.anomalies.some((a) => a.kind === ANOMALY.VOLUME_COLLAPSE));
  const gate = mayReconcileMissing({ authoritative: true, assessment: broken });
  assert.equal(gate.allowed, false, 'a parser that broke must never be allowed to close 397 live jobs');
  assert.match(gate.reason, /retained/);
});

test('INGEST_GATE — a parse-failure spike is treated as a schema change, not a shrinking board', () => {
  const source = { id: 's', health: { window: [{ ok: true, jobs: 50 }, { ok: true, jobs: 51 }, { ok: true, jobs: 49 }] } };
  const assessment = assessRun(source, { fetched: 20, rejected: 30, errors: [] });
  assert.equal(assessment.credible, false);
  assert.ok(assessment.anomalies.some((a) => a.kind === ANOMALY.PARSE_FAILURE_SPIKE));
});

test('INGEST_GATE — a broken source is DEGRADED and its jobs survive untouched', async () => {
  /* A board with enough postings to establish a believable baseline. Volume
     collapse is only meaningful against a source that had real volume — three
     jobs becoming zero is not distinguishable from a small employer closing
     its last role, and the detector correctly refuses to guess. */
  const bigBoard = {
    jobs: Array.from({ length: 24 }, (_, i) => ({
      id: 90000 + i,
      title: `Platform Engineer ${i}`,
      requisition_id: `REQ-${i}`,
      absolute_url: `https://boards.greenhouse.io/acme/jobs/${90000 + i}`,
      updated_at: '2026-08-12T09:00:00-04:00',
      first_published: '2026-08-10T09:00:00-04:00',
      location: { name: 'Pune, India' },
      content: '<p>Own the platform.</p>',
    })),
  };
  let board = bigBoard;
  const service = await makeService({
    now: NOW,
    routes: [[/boards-api\.greenhouse\.io/, () => ({ body: board })]],
  });
  const { source } = await service.registerSource(makeSource({
    provider: PROVIDER.GREENHOUSE, sourceType: 'ATS', sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'acme', companyName: 'Acme', companyDomain: 'acme.com',
  }));

  /* Build a history of healthy runs so there is a baseline to compare against. */
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await service.crawlSource(source.id);
  }
  const before = await service.store.listJobs({ excludeStatus: JOB_STATUS.REMOVED });
  assert.ok(before.length >= 20, 'the healthy board produced a real body of jobs');

  /* The provider ships a markup change: still HTTP 200, now almost empty. */
  board = { jobs: [] };
  const run = await service.crawlSource(source.id);

  assert.equal(run.reconciliation.allowed, false, 'reconciliation must be blocked');
  const after = await service.store.listJobs({ excludeStatus: JOB_STATUS.REMOVED });
  assert.equal(after.length, before.length, 'not one job may be closed by an incredible run');

  const updated = await service.registry.get(source.id);
  assert.equal(updated.status, 'DEGRADED', 'the source is flagged for a human');
  assert.ok(updated.anomaly, 'the anomaly is recorded');
  assert.equal(updated.anomaly.destructiveActionsBlocked, true);
});

test('INGEST_GATE — the queue-driven scheduler crawls, and re-ticking does not re-crawl the window', async () => {
  const service = await makeService({
    queues: true,
    now: NOW,
    routes: [[/boards-api\.greenhouse\.io/, { body: GREENHOUSE_BOARD }]],
  });
  await service.registerSource(makeSource({
    provider: PROVIDER.GREENHOUSE, sourceType: 'ATS', sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'acme', companyName: 'Acme', companyDomain: 'acme.com',
    /* Scheduled crawling only ever touches sources whose access has been
       cleared; a source still under REVIEW is deliberately not picked up. */
    accessPolicy: 'ALLOW',
  }));

  const first = await service.tick({ verify: false, discover: false });
  assert.equal(first.crawled.length, 1);
  assert.ok(first.crawled[0].ok);
  assert.equal(first.queue.enqueued, 1);

  const second = await service.tick({ verify: false, discover: false });
  assert.equal(second.crawled.length, 0, 'the window is already done; no second crawl of the same board');

  const stats = await service.crawlQueue.stats();
  assert.equal(stats.byState[CRAWL_STATE.DONE], 1);
  assert.equal(stats.deadLetterCount, 0);
});
