/* ============================================================
   AI DENY BOUNDARY  (P1.1)
   ------------------------------------------------------------
   Career Autopilot resume tailoring is a DETERMINISTIC engine
   capability. Zero generative-LLM calls. Not "usually zero",
   not "zero unless a key is set" — structurally zero.

   The guarantee is enforced with AsyncLocalStorage rather than
   by convention, because convention does not survive the next
   contributor. Any code path that reaches a generative provider
   while a tailoring transaction is on the stack throws
   AiCallInsideTailoringBoundaryError, and it throws whether the
   call is direct, nested, awaited, or three modules deep.

   Usage:

     runInsideTailoringBoundary(meta, () => runTailoringCore(req))

   Provider entry points call assertNoAiInsideBoundary() before
   they do anything expensive. Providers are the choke point, so
   guarding them guards everything downstream of them.
   ============================================================ */
import { AsyncLocalStorage } from 'node:async_hooks';

export const AI_BOUNDARY_VERSION = 'resume-tailoring-ai-boundary-v1';

/* The store holds boundary metadata for the duration of one tailoring
   transaction. Presence of a store === "we are inside the boundary". */
const boundaryStore = new AsyncLocalStorage();

/* Process-lifetime counters. Deliberately not per-request: a violation
   anywhere is a product defect and we want it visible in aggregate. */
const counters = {
  transactions: 0,
  violations: 0,
  lastViolation: null,
};

export class AiCallInsideTailoringBoundaryError extends Error {
  constructor(provider, operation, meta) {
    super(
      `Generative AI provider "${provider}" was invoked inside the Career Autopilot `
      + `resume tailoring boundary (operation="${operation}"). Resume content must be `
      + 'produced deterministically. This is a hard product invariant, not a warning.',
    );
    this.name = 'AiCallInsideTailoringBoundaryError';
    this.code = 'AI_CALL_INSIDE_TAILORING_BOUNDARY';
    this.provider = provider;
    this.operation = operation;
    this.boundary = meta || null;
  }
}

/**
 * Build the metadata carried through a tailoring transaction. Nothing
 * here is private resume content — it is routing/telemetry context only.
 */
export function buildBoundaryMetadata(request = {}) {
  return Object.freeze({
    boundaryId: `tb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    operation: String(request.operation || 'unknown'),
    mode: String(request.mode || 'balanced'),
    depth: String(request.depth || 'standard'),
    surface: String(request.surface || 'unknown'),
    startedAt: Date.now(),
  });
}

/**
 * Execute `fn` inside the deny boundary. Everything awaited transitively
 * inside `fn` — parsing, evidence extraction, composition, validation,
 * reranking, assembly, telemetry — inherits the boundary.
 */
export function runInsideTailoringBoundary(meta, fn) {
  counters.transactions += 1;
  return boundaryStore.run(meta, fn);
}

/** True when the current async context is inside a tailoring transaction. */
export function insideTailoringBoundary() {
  return boundaryStore.getStore() !== undefined;
}

/** The active boundary metadata, or null outside a transaction. */
export function currentBoundary() {
  return boundaryStore.getStore() || null;
}

/**
 * Called by every generative provider entry point. Outside the boundary
 * this is a no-op costing one AsyncLocalStorage read; inside it throws.
 */
export function assertNoAiInsideBoundary(provider = 'unknown', operation = 'generate') {
  const meta = boundaryStore.getStore();
  if (meta === undefined) return;
  counters.violations += 1;
  counters.lastViolation = {
    provider, operation, boundaryId: meta.boundaryId, at: Date.now(),
  };
  throw new AiCallInsideTailoringBoundaryError(provider, operation, meta);
}

/**
 * Escape hatch for genuinely non-resume AI work that may legitimately run
 * while a tailoring response is being assembled (for example an optional
 * cover-letter draft requested in the same HTTP request). It exits the
 * boundary for the duration of `fn` only, and it is deliberately noisy in
 * the name so it shows up in review.
 */
export function runOutsideTailoringBoundary(fn) {
  return boundaryStore.exit(fn);
}

export function boundaryCounters() {
  return { ...counters };
}

export function resetBoundaryCounters() {
  counters.transactions = 0;
  counters.violations = 0;
  counters.lastViolation = null;
}

export default {
  AI_BOUNDARY_VERSION,
  AiCallInsideTailoringBoundaryError,
  buildBoundaryMetadata,
  runInsideTailoringBoundary,
  runOutsideTailoringBoundary,
  insideTailoringBoundary,
  currentBoundary,
  assertNoAiInsideBoundary,
  boundaryCounters,
  resetBoundaryCounters,
};
