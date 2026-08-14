/* ============================================================
   JOB DISCOVERY OS — CRAWL QUEUE
   ------------------------------------------------------------
   Phase 1 scheduled crawls by asking the registry "which sources
   are due?" and running them inline. That is fine for one process
   and wrong for a fleet: two workers pick the same source, a crash
   mid-source loses the page cursor, and a permanently broken source
   is retried forever at full rate.

   This is the durable work queue between the registry and the
   workers:

       Source Registry -> Crawl Queue -> Workers -> Raw Snapshots

   Guarantees:

     idempotency     a task id is derived from (sourceId, window),
                     so enqueueing the same due-window twice is one
                     task, not two crawls of the same board
     worker leases   a leased task is invisible to other workers
                     until its lease expires; an expired lease is
                     reclaimed automatically, so a worker that dies
                     mid-crawl does not strand its source
     checkpointing   the page cursor is persisted on the TASK, so a
                     resumed crawl continues from the last completed
                     page instead of refetching the board
     retry queue     transient failures return with exponential
                     backoff and jitter
     dead-letter     a task that exhausts its attempts is moved to
                     DEAD with its last error retained. It is NEVER
                     silently dropped, and it never deletes jobs
     host fairness   ordering considers the host so one enormous
                     employer cannot monopolise every tick

   Distributed-safe: the atomicity lives in the store
   (findOneAndUpdate on Mongo), not in a process-local flag.
   ============================================================ */

import { sha256, hostOf } from './normalize/text.js';
import { ERROR_CLASS } from './schema.js';

export const CRAWL_STATE = Object.freeze({
  PENDING: 'PENDING',
  LEASED: 'LEASED',
  RETRY: 'RETRY',
  DONE: 'DONE',
  DEAD: 'DEAD',
});

export const DEFAULT_MAX_ATTEMPTS = 5;
export const BASE_RETRY_MS = 60_000;
export const MAX_RETRY_MS = 6 * 3600_000;

/** Failures that must not be retried at all — retrying is not permitted. */
export const NON_RETRYABLE = new Set([
  ERROR_CLASS.ROBOTS_DENIED,
  ERROR_CLASS.SSRF_BLOCKED,
  ERROR_CLASS.AUTH_REQUIRED,
  ERROR_CLASS.NOT_CONFIGURED,
]);

/**
 * Idempotency key. Two enqueues for the same source inside the same due-window
 * are the SAME task. The window is derived from the source's own cadence, so a
 * fast board can legitimately be enqueued more often than a slow one without
 * ever double-crawling a single window.
 */
export function idempotencyKeyFor(source, { at = new Date(), windowMinutes = null } = {}) {
  const w = Math.max(5, Number(windowMinutes ?? source.crawlIntervalMinutes ?? 360));
  const bucket = Math.floor(at.getTime() / (w * 60000));
  return `${source.id}:${w}:${bucket}`;
}

export function crawlTaskId(idempotencyKey) {
  return `cq_${sha256(idempotencyKey).slice(0, 24)}`;
}

export function retryDelayMs(attempts, { jitter = Math.random } = {}) {
  const base = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (2 ** Math.max(0, attempts - 1)));
  /* Jitter keeps a fleet from synchronising its retries onto one host. */
  return Math.round(base * (0.7 + 0.6 * jitter()));
}

export function makeCrawlTask({
  source, idempotencyKey, priority = 0, availableAt = null,
  maxAttempts = DEFAULT_MAX_ATTEMPTS, now = new Date().toISOString(),
}) {
  return {
    id: crawlTaskId(idempotencyKey),
    sourceId: source.id,
    idempotencyKey,
    host: hostOf(source.careersUrl || source.baseUrl || '') || null,
    provider: source.provider,
    sourceClass: source.sourceClass,
    state: CRAWL_STATE.PENDING,
    priority,
    attempts: 0,
    maxAttempts,
    availableAt,
    leaseOwner: null,
    leaseExpiresAt: null,
    leasedAt: null,
    checkpoint: null,
    lastError: null,
    deadLetteredAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export class CrawlQueue {
  constructor({
    store, logger = console, now = () => new Date(),
    maxAttempts = DEFAULT_MAX_ATTEMPTS, leaseMs = 300_000, jitter = Math.random,
  } = {}) {
    this.store = store;
    this.logger = logger;
    this.now = now;
    this.maxAttempts = maxAttempts;
    this.leaseMs = leaseMs;
    this.jitter = jitter;
    this.metrics = {
      enqueued: 0, deduped: 0, leased: 0, completed: 0,
      retried: 0, deadLettered: 0, reclaimed: 0, checkpoints: 0,
    };
  }

  nowIso() { return this.now().toISOString(); }

  /**
   * Enqueue a source for crawling. Returns created:false when the source's
   * current due-window is already queued or in flight — that is the whole point
   * of the idempotency key, and it is what stops a cron trigger firing twice
   * from crawling the same board twice.
   */
  async enqueue(source, { priority = null, availableAt = null, windowMinutes = null } = {}) {
    if (!source?.id) return { ok: false, reason: 'no source' };
    const key = idempotencyKeyFor(source, { at: this.now(), windowMinutes });
    const id = crawlTaskId(key);
    const existing = await this.store.getCrawlTask(id);

    if (existing && existing.state !== CRAWL_STATE.DEAD) {
      this.metrics.deduped += 1;
      return { ok: true, created: false, task: existing, reason: 'already queued for this window' };
    }

    const task = makeCrawlTask({
      source,
      idempotencyKey: key,
      priority: priority ?? Math.round(source.crawlPriority ?? 0),
      availableAt,
      maxAttempts: this.maxAttempts,
      now: this.nowIso(),
    });
    await this.store.putCrawlTask(task);
    this.metrics.enqueued += 1;
    return { ok: true, created: true, task };
  }

  /**
   * Take work. Leases are held in the STORE, so this is safe across processes;
   * an expired lease is reclaimable, which is how a crashed worker's source is
   * picked back up without an operator noticing.
   */
  async lease({ limit = 5, owner = 'worker', leaseMs = null } = {}) {
    const before = await this.store.listCrawlTasks({ state: CRAWL_STATE.LEASED, limit: 1000 });
    const nowIso = this.nowIso();
    const expired = before.filter((t) => (t.leaseExpiresAt || '') <= nowIso).length;
    if (expired) this.metrics.reclaimed += expired;

    const tasks = await this.store.leaseCrawlTasks({
      at: nowIso, limit, owner, leaseMs: leaseMs ?? this.leaseMs,
    });
    this.metrics.leased += tasks.length;
    return tasks;
  }

  /**
   * Persist progress mid-crawl. A long board is resumable: if the worker dies
   * on page 40, the reclaimed task restarts at page 40, not page 1.
   */
  async checkpoint(task, checkpoint) {
    this.metrics.checkpoints += 1;
    const next = {
      ...task,
      checkpoint,
      /* Extend the lease while genuine progress is being made, so a slow but
         healthy crawl is not stolen out from under the worker doing it. */
      leaseExpiresAt: new Date(this.now().getTime() + this.leaseMs).toISOString(),
      updatedAt: this.nowIso(),
    };
    await this.store.putCrawlTask(next);
    return next;
  }

  async complete(task, result = {}) {
    this.metrics.completed += 1;
    const at = this.nowIso();
    const next = {
      ...task,
      state: CRAWL_STATE.DONE,
      completedAt: at,
      leaseOwner: null,
      leaseExpiresAt: null,
      checkpoint: null,
      lastError: null,
      result: {
        fetched: result.fetched ?? 0,
        created: result.created ?? 0,
        merged: result.merged ?? 0,
        changed: result.changed ?? 0,
        notModified: !!result.notModified,
      },
      updatedAt: at,
    };
    await this.store.putCrawlTask(next);
    return next;
  }

  /**
   * A crawl failed. Non-retryable classes go straight to the dead-letter queue;
   * everything else backs off. Exhausting attempts DEAD-LETTERS the task and
   * nothing else — the jobs this source already produced stay exactly where
   * they are. A broken parser must never look like a closed board.
   */
  async fail(task, { errorClass = ERROR_CLASS.UNKNOWN, message = null } = {}) {
    const at = this.nowIso();
    const attempts = task.attempts ?? 1;
    const lastError = { errorClass, message: message ? String(message).slice(0, 400) : null, at };

    const permanent = NON_RETRYABLE.has(errorClass);
    const exhausted = attempts >= (task.maxAttempts ?? this.maxAttempts);

    if (permanent || exhausted) {
      this.metrics.deadLettered += 1;
      const dead = {
        ...task,
        state: CRAWL_STATE.DEAD,
        deadLetteredAt: at,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError,
        deadLetterReason: permanent ? 'non-retryable failure' : 'attempts exhausted',
        updatedAt: at,
      };
      await this.store.putCrawlTask(dead);
      return dead;
    }

    this.metrics.retried += 1;
    const next = {
      ...task,
      state: CRAWL_STATE.RETRY,
      availableAt: new Date(this.now().getTime() + retryDelayMs(attempts, { jitter: this.jitter })).toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError,
      updatedAt: at,
    };
    await this.store.putCrawlTask(next);
    return next;
  }

  /**
   * Source ids that already have work in flight.
   *
   * Window-based idempotency stops the SAME window being queued twice, but a
   * source can legitimately have two different windows queued at once — an
   * operator's "fetch now" and the source's ordinary schedule. Crawling the
   * same board twice in one tick is wasteful for us and rude to the host, so
   * the scheduler consults this before enqueueing routine work.
   */
  async activeSourceIds() {
    const active = new Set();
    for (const state of [CRAWL_STATE.PENDING, CRAWL_STATE.LEASED, CRAWL_STATE.RETRY]) {
      // eslint-disable-next-line no-await-in-loop
      for (const t of await this.store.listCrawlTasks({ state, limit: 100000 })) {
        if (t.sourceId) active.add(t.sourceId);
      }
    }
    return active;
  }

  /** Operator action: put a dead-lettered task back in circulation. */
  async requeueDeadLetter(taskId, { resetAttempts = true } = {}) {
    const task = await this.store.getCrawlTask(taskId);
    if (!task) return { ok: false, reason: 'unknown task' };
    if (task.state !== CRAWL_STATE.DEAD) return { ok: false, reason: `task is ${task.state}, not DEAD` };
    const next = {
      ...task,
      state: CRAWL_STATE.PENDING,
      attempts: resetAttempts ? 0 : task.attempts,
      availableAt: null,
      deadLetteredAt: null,
      deadLetterReason: null,
      updatedAt: this.nowIso(),
    };
    await this.store.putCrawlTask(next);
    return { ok: true, task: next };
  }

  async deadLetters({ limit = 100 } = {}) {
    return this.store.listCrawlTasks({ state: CRAWL_STATE.DEAD, limit });
  }

  async stats() {
    const all = await this.store.listCrawlTasks({ limit: 100000 });
    const byState = {};
    const byErrorClass = {};
    const inFlightHosts = new Set();
    for (const t of all) {
      byState[t.state] = (byState[t.state] || 0) + 1;
      if (t.lastError?.errorClass) byErrorClass[t.lastError.errorClass] = (byErrorClass[t.lastError.errorClass] || 0) + 1;
      if (t.state === CRAWL_STATE.LEASED && t.host) inFlightHosts.add(t.host);
    }
    return {
      total: all.length,
      byState,
      byErrorClass,
      inFlightHosts: inFlightHosts.size,
      deadLetterCount: byState[CRAWL_STATE.DEAD] || 0,
      counters: { ...this.metrics },
    };
  }
}

/**
 * Fair ordering across hosts. Sorting purely by priority lets one employer with
 * 300 boards fill every worker slot; this interleaves so a tick makes progress
 * on many hosts rather than exhausting one.
 */
export function interleaveByHost(tasks = []) {
  const byHost = new Map();
  for (const t of tasks) {
    const h = t.host || '_';
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(t);
  }
  for (const list of byHost.values()) list.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const out = [];
  let added = true;
  while (added) {
    added = false;
    for (const list of byHost.values()) {
      const next = list.shift();
      if (next) { out.push(next); added = true; }
    }
  }
  return out;
}

export default {
  CrawlQueue, CRAWL_STATE, makeCrawlTask, crawlTaskId, idempotencyKeyFor,
  retryDelayMs, interleaveByHost, NON_RETRYABLE, DEFAULT_MAX_ATTEMPTS,
};
