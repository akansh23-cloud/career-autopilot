/* ============================================================
   JOB DISCOVERY OS — INGEST PIPELINE  (§15, §16, §20, §21, §22)
   ------------------------------------------------------------
       Source fetch
            ↓
       RawJobSnapshot        (retained, hashed, versioned)
            ↓
       Normalize             (adapter -> NormalizedJobInput)
            ↓
       Canonical candidate   (toCanonicalJob)
            ↓
       Dedupe                (4 deterministic stages)
            ↓
       Merge / insert        (provenance preserved)
            ↓
       Freshness             (seen / missing / changed)
            ↓
       Store

   Canonical jobs are never mutated directly from a network
   payload. Each source run is isolated: one broken schema fails
   one source, never the pipeline (§43).
   ============================================================ */

import { toCanonicalJob, makeRawSnapshot } from './normalize/index.js';
import { findDuplicate, mergeJobs } from './dedupe.js';
import {
  observeSeen, observeMissing, observeSourceFailure, applyContentChange,
} from './freshness.js';
import { ERROR_CLASS, SOURCE_STATUS, JOB_STATUS } from './schema.js';
import { assessRun, mayReconcileMissing, healthStatusFor, anomalyRecord } from './sourceHealth.js';
import { applyChangeIntelligence } from './changeIntelligence.js';
import { applyVerificationSchedule } from './verificationPolicy.js';

export class IngestPipeline {
  constructor({
    store, registry, adapters, logger = console, metrics = null,
    now = () => new Date(), retainRaw = true, maxItemsPerRun = 2000,
  }) {
    this.store = store;
    this.registry = registry;
    this.adapters = adapters;
    this.logger = logger;
    this.metrics = metrics;
    this.now = now;
    this.retainRaw = retainRaw;
    this.maxItemsPerRun = maxItemsPerRun;
  }

  nowIso() { return this.now().toISOString(); }

  /**
   * Run one source end to end. NEVER throws: every failure is classified and
   * returned so one bad ATS cannot stop ingestion.
   */
  async runSource(source, { ctx = {}, followCursor = true, maxPages = 20, checkpoint = null, resumeCursor = null } = {}) {
    const started = Date.now();
    const adapter = this.adapters.forSource(source);
    const result = {
      sourceId: source.id, provider: source.provider, ok: false,
      fetched: 0, created: 0, updated: 0, merged: 0, unchanged: 0, changed: 0,
      duplicates: 0, rejected: 0, errors: [], stages: {}, notModified: false,
      notConfigured: false, nextCursor: null, http: null, seenJobIds: [],
      titlelessRows: 0, changeEvents: {}, pagesFetched: 0,
      reconciliation: null, health: null,
    };

    /* A resumed crawl continues from the queue's checkpoint, not from page one:
       refetching 40 pages of a board after a worker restart is both slow and an
       unnecessary load on someone else's server. */
    let cursor = resumeCursor || source.cursor || null;
    let pages = 0;
    let anyAuthoritative = false;

    try {
      for (;;) {
        pages += 1;
        // eslint-disable-next-line no-await-in-loop
        const batch = await adapter.fetchJobs(source, cursor, ctx);

        if (batch.notConfigured) {
          result.notConfigured = true;
          result.errors.push({ errorClass: ERROR_CLASS.NOT_CONFIGURED, message: batch.error?.message || 'adapter not configured' });
          break;
        }
        if (batch.notModified) {
          result.notModified = true;
          result.http = batch.http || null;
          result.ok = true;
          break;
        }
        if (batch.error) {
          result.errors.push(batch.error);
          break;
        }

        result.http = batch.http || result.http;
        if (batch.stage) result.stages[batch.stage] = (result.stages[batch.stage] || 0) + 1;
        if (batch.authoritative) anyAuthoritative = true;

        const items = (batch.items || []).slice(0, this.maxItemsPerRun);
        result.fetched += items.length;

        for (const raw of items) {
          // eslint-disable-next-line no-await-in-loop
          await this.ingestOne(raw, source, adapter, result, ctx);
        }

        cursor = batch.nextCursor || null;
        result.nextCursor = cursor;
        result.pagesFetched = pages;
        /* Persist progress between pages so a crash costs one page, not a board. */
        if (checkpoint && cursor) {
          // eslint-disable-next-line no-await-in-loop
          await checkpoint({ cursor, pagesFetched: pages, created: result.created, merged: result.merged });
        }
        if (!followCursor || !cursor || pages >= maxPages) break;
      }

      /* Absence is evidence ONLY when the source returned a complete listing AND
         the run looks credible against this source's own history. A parser that
         breaks and returns 3 jobs instead of 400 must never be allowed to close
         397 live postings. */
      const assessment = assessRun(source, result);
      result.health = assessment;
      const gate = mayReconcileMissing({ authoritative: anyAuthoritative && !result.notModified, assessment });
      result.reconciliation = { ...gate, flagged: 0 };
      if (gate.allowed) {
        // eslint-disable-next-line no-await-in-loop
        result.reconciliation.flagged = await this.reconcileMissing(source, new Set(result.seenJobIds));
      }

      result.ok = result.errors.length === 0;
    } catch (e) {
      result.errors.push({ errorClass: e?.errorClass || ERROR_CLASS.UNKNOWN, message: e?.message || String(e) });
      result.ok = false;
      await this.markSourceFailureOnJobs(source, e?.errorClass || ERROR_CLASS.UNKNOWN);
    }

    result.latencyMs = Date.now() - started;

    if (this.registry) {
      /* Health verdict travels with the run so the registry can DEGRADE a
         source whose output stopped being believable, even though its HTTP
         calls all returned 200. */
      const assessment = result.health || { credible: true, anomalies: [], baseline: null, observed: result.fetched };
      await this.registry.recordRun(source.id, {
        credible: assessment.credible,
        anomaly: anomalyRecord(assessment, { at: this.nowIso() }),
        healthStatus: healthStatusFor(source, assessment, { ok: result.ok }),
        ok: result.ok,
        latencyMs: result.latencyMs,
        jobCount: result.fetched,
        newJobs: result.created,
        duplicates: result.merged,
        errorClass: result.errors[0]?.errorClass ?? null,
        message: result.errors[0]?.message ?? null,
        notModified: result.notModified,
        nextCursor: result.nextCursor,
        http: result.http,
      });
      if (result.notConfigured) {
        await this.registry.update(source.id, { status: SOURCE_STATUS.NOT_CONFIGURED });
      }
    }

    this.metrics?.recordSourceRun?.(result);
    return result;
  }

  /** One raw item -> snapshot -> normalize -> canonical -> dedupe -> store. */
  async ingestOne(raw, source, adapter, result, ctx = {}) {
    const at = this.nowIso();
    let input;
    try {
      input = adapter.normalize(raw, source);
    } catch (e) {
      result.rejected += 1;
      result.errors.push({ errorClass: ERROR_CLASS.SCHEMA_CHANGED, message: `normalize failed: ${e?.message}` });
      return null;
    }
    if (!input || !input.title) {
      /* A posting with no title is not a job we can honestly index. Counted
         separately because a SPIKE in titleless rows is the signature of a
         provider markup change, not of a board full of nameless jobs. */
      result.rejected += 1;
      result.titlelessRows += 1;
      return null;
    }

    if (this.retainRaw && source.storagePolicy?.retainRawDays !== 0) {
      const snapshot = makeRawSnapshot({
        sourceId: source.id,
        sourceJobId: input.sourceJobId,
        payload: raw,
        httpMeta: { ...(result.http || {}), url: input.jobUrl },
        fetchedAt: at,
      });
      try { await this.store.putRaw(snapshot); } catch { /* raw retention is best-effort */ }
    }

    let candidate;
    try {
      candidate = toCanonicalJob(input, source, { now: at });
    } catch (e) {
      result.rejected += 1;
      result.errors.push({ errorClass: ERROR_CLASS.PARSE_FAILED, message: `canonicalize failed: ${e?.message}` });
      return null;
    }

    const existingById = await this.store.getJob(candidate.id);
    const candidates = await this.store.findCandidates(candidate);
    if (existingById && !candidates.some((c) => c.id === existingById.id)) candidates.push(existingById);

    const dup = findDuplicate(candidate, candidates);

    if (!dup) {
      candidate.status = JOB_STATUS.NEW;
      const created = applyChangeIntelligence(null, candidate, { at });
      recordEvents(result, created.events);
      const scheduled = applyVerificationSchedule(created.job, { now: Date.parse(at), from: at });
      await this.store.putJob(scheduled);
      result.created += 1;
      result.seenJobIds.push(scheduled.id);
      return scheduled;
    }

    result.duplicates += 1;
    let merged = mergeJobs(dup.job, candidate, { now: at });

    const change = applyContentChange(dup.job, merged, { at });
    merged = change.job;
    if (change.changed) result.changed += 1; else result.unchanged += 1;

    merged = observeSeen(merged, { sourceId: source.id, at });
    merged.dedupeStage = dup.stage;
    merged.dedupeConfidence = dup.confidence;

    /* An ordinary edit updates ONE canonical record and emits an event. It never
       produces a second job — that is the whole point of doing this here rather
       than letting a changed content hash look like a new posting. */
    const intelligence = applyChangeIntelligence(dup.job, merged, { at });
    merged = intelligence.job;
    recordEvents(result, intelligence.events);
    merged = applyVerificationSchedule(merged, { now: Date.parse(at) });

    await this.store.putJob(merged);
    if (merged.id !== dup.job.id && this.store.deleteJob) {
      /* Canonical id is stable; this only fires when a merge changed identity. */
      await this.store.deleteJob(dup.job.id).catch(() => {});
    }
    result.merged += 1;
    result.updated += 1;
    result.seenJobIds.push(merged.id);
    return merged;
  }

  /**
   * A complete listing came back and did not contain jobs we hold from this
   * source. Increment the miss counter — never delete on one absence (§22.1).
   */
  async reconcileMissing(source, seenIds) {
    const held = await this.store.listJobs({ sourceId: source.id, excludeStatus: JOB_STATUS.REMOVED });
    let flagged = 0;
    for (const job of held) {
      if (seenIds.has(job.id)) continue;
      const next = observeMissing(job, { sourceId: source.id, at: this.nowIso(), authoritative: true });
      if (next !== job) { await this.store.putJob(next); flagged += 1; }
    }
    return flagged;
  }

  /** Source-level outage: mark jobs as unverified, keep them alive. */
  async markSourceFailureOnJobs(source, errorClass) {
    const held = await this.store.listJobs({ sourceId: source.id, excludeStatus: JOB_STATUS.REMOVED, limit: 500 });
    for (const job of held) {
      const next = observeSourceFailure(job, { sourceId: source.id, errorClass, at: this.nowIso() });
      if (next !== job) await this.store.putJob(next);
    }
    return held.length;
  }

  /**
   * §45 — reprocess retained raw payloads through a newer normalizer without
   * refetching the internet.
   */
  async reprocessSource(source, { limit = 500 } = {}) {
    if (typeof this.store.listRaw !== 'function') {
      return { ok: false, reason: 'store does not retain raw snapshots' };
    }
    const adapter = this.adapters.forSource(source);
    const snapshots = await this.store.listRaw({ sourceId: source.id, limit });
    const result = {
      sourceId: source.id, ok: true, fetched: snapshots.length,
      created: 0, updated: 0, merged: 0, unchanged: 0, changed: 0,
      duplicates: 0, rejected: 0, errors: [], stages: {}, seenJobIds: [],
    };
    for (const snap of snapshots) {
      if (!snap?.payload) { result.rejected += 1; continue; }
      // eslint-disable-next-line no-await-in-loop
      await this.ingestOne(snap.payload, source, adapter, result, {});
    }
    return result;
  }
}

function recordEvents(result, events = []) {
  for (const e of events) {
    result.changeEvents[e.kind] = (result.changeEvents[e.kind] || 0) + 1;
  }
}

export default IngestPipeline;
