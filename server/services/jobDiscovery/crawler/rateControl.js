/* ============================================================
   JOB DISCOVERY OS — RATE CONTROL  (§28)
   ------------------------------------------------------------
   Global concurrency, per-host concurrency, minimum host delay,
   429 / Retry-After handling, exponential backoff with jitter,
   and a per-host circuit breaker.

   Deterministic under test: the clock and the jitter source are
   both injectable, so backoff schedules can be asserted exactly.
   ============================================================ */

import { ERROR_CLASS } from '../schema.js';

export class Semaphore {
  constructor(limit) {
    this.limit = Math.max(1, Number(limit) || 1);
    this.active = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.active < this.limit) { this.active += 1; return; }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active += 1;
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  async run(fn) {
    await this.acquire();
    try { return await fn(); } finally { this.release(); }
  }
}

export const CIRCUIT = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });

export class HostBreaker {
  constructor({ failureThreshold = 5, openMs = 60_000, now = () => Date.now() } = {}) {
    this.failureThreshold = failureThreshold;
    this.openMs = openMs;
    this.now = now;
    this.failures = 0;
    this.state = CIRCUIT.CLOSED;
    this.openedAt = 0;
  }

  canRequest() {
    if (this.state === CIRCUIT.CLOSED) return true;
    if (this.state === CIRCUIT.OPEN) {
      if (this.now() - this.openedAt >= this.openMs) { this.state = CIRCUIT.HALF_OPEN; return true; }
      return false;
    }
    return true; // HALF_OPEN allows a single probe
  }

  onSuccess() { this.failures = 0; this.state = CIRCUIT.CLOSED; }

  onFailure() {
    this.failures += 1;
    if (this.state === CIRCUIT.HALF_OPEN || this.failures >= this.failureThreshold) {
      this.state = CIRCUIT.OPEN;
      this.openedAt = this.now();
    }
  }
}

/** Exponential backoff with full jitter, capped. */
export function backoffDelay(attempt, { baseMs = 500, maxMs = 60_000, jitter = Math.random } = {}) {
  const exp = Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
  return Math.floor(exp * (0.5 + 0.5 * jitter()));
}

/** Retry-After may be seconds or an HTTP date. Returns ms, or null. */
export function parseRetryAfter(value, { now = Date.now() } = {}) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Math.max(0, Number(s) * 1000);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.max(0, t - now);
}

export class RateController {
  /**
   * @param opts.globalConcurrency  total in-flight requests across all hosts
   * @param opts.hostConcurrency    in-flight requests per host
   * @param opts.minHostDelayMs     minimum spacing between requests to one host
   */
  constructor({
    globalConcurrency = 8,
    hostConcurrency = 2,
    minHostDelayMs = 1000,
    maxRetries = 3,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    jitter = Math.random,
    breaker = {},
  } = {}) {
    this.global = new Semaphore(globalConcurrency);
    this.hostConcurrency = hostConcurrency;
    this.minHostDelayMs = minHostDelayMs;
    this.maxRetries = maxRetries;
    this.now = now;
    this.sleep = sleep;
    this.jitter = jitter;
    this.breakerOpts = breaker;
    this.hosts = new Map(); // host -> { sem, lastAt, breaker, cooldownUntil }
  }

  hostState(host) {
    let st = this.hosts.get(host);
    if (!st) {
      st = {
        sem: new Semaphore(this.hostConcurrency),
        /* Never delay FIRST contact with a host — spacing is about not hammering
           a site, and a fresh host has not been contacted yet. Starting at 0
           made every source pay one minHostDelay before its first request. */
        lastAt: Number.NEGATIVE_INFINITY,
        cooldownUntil: 0,
        breaker: new HostBreaker({ now: this.now, ...this.breakerOpts }),
      };
      this.hosts.set(host, st);
    }
    return st;
  }

  /** Called by the HTTP client when a host answers 429 / 503 + Retry-After. */
  noteRateLimited(host, retryAfterMs) {
    const st = this.hostState(host);
    const wait = retryAfterMs ?? backoffDelay(1, { jitter: this.jitter });
    st.cooldownUntil = Math.max(st.cooldownUntil, this.now() + wait);
    st.breaker.onFailure();
  }

  noteSuccess(host) { this.hostState(host).breaker.onSuccess(); }

  noteFailure(host) { this.hostState(host).breaker.onFailure(); }

  isOpen(host) { return !this.hostState(host).breaker.canRequest(); }

  /**
   * Run `fn` under global + per-host concurrency, minimum host spacing and the
   * host circuit breaker. Retries are the caller's decision; this only schedules.
   */
  async schedule(host, fn) {
    const st = this.hostState(host);
    if (!st.breaker.canRequest()) {
      const err = new Error(`Circuit open for host ${host}`);
      err.errorClass = ERROR_CLASS.BLOCKED;
      err.circuitOpen = true;
      throw err;
    }
    return this.global.run(() => st.sem.run(async () => {
      const now = this.now();
      const waitCooldown = Math.max(0, st.cooldownUntil - now);
      const waitSpacing = Math.max(0, (st.lastAt + this.minHostDelayMs) - now);
      const wait = Math.max(waitCooldown, waitSpacing);
      if (wait > 0) await this.sleep(wait);
      st.lastAt = this.now();
      return fn();
    }));
  }

  stats() {
    const out = {};
    for (const [host, st] of this.hosts.entries()) {
      out[host] = {
        circuit: st.breaker.state,
        failures: st.breaker.failures,
        cooldownMs: Math.max(0, st.cooldownUntil - this.now()),
        inFlight: st.sem.active,
      };
    }
    return { globalInFlight: this.global.active, globalLimit: this.global.limit, hosts: out };
  }
}

export default {
  RateController, Semaphore, HostBreaker, CIRCUIT, backoffDelay, parseRetryAfter,
};
