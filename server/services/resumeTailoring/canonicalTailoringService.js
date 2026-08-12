/* ============================================================
   CANONICAL RESUME TAILORING SERVICE  (P1.2)
   ------------------------------------------------------------
   ONE business entry point. Every surface that produces resume
   content — Resume Studio, Job Search → Tailor & Apply, bullet
   assist, summary assist, ATS optimise, preview, application
   package — arrives here.

   Legacy HTTP routes are preserved for compatibility. Legacy
   tailoring INTELLIGENCE is not: the old paths delegate into
   this service rather than running their own ranking or
   rewriting. Two engines means two truth models, and the second
   one is always the one that ships a lie.

       Legacy / current routes
                 │
       Canonical Tailoring Service      ← you are here
                 │
        AI-Deny Execution Boundary
                 │
        Narrative Intelligence
   ============================================================ */
import {
  buildBoundaryMetadata, runInsideTailoringBoundary, insideTailoringBoundary,
} from './aiBoundary.js';
import {
  resolveMode, resolveDepth, depthForPlan, OPERATION_SHAPE, OPERATIONS,
  TAILORING_MODES_VERSION,
} from './modes.js';
import {
  enhanceResumeNarrative, tailorResumeNarrative, NARRATIVE_ENGINE_VERSIONS,
} from '../../utils/resume/narrative/narrativeEngine.js';
import { TAILORING_STATUS } from '../../utils/resume/narrative/requirementLeakage.js';

export const CANONICAL_TAILORING_VERSION = 'canonical-resume-tailoring-v1';

/* The quota bucket resume tailoring consumes. NOT aiCalls — the engine
   makes zero generative calls, so billing it as an AI call is a false
   statement to the user about what their money bought. (P1.7) */
export const TAILORING_QUOTA_BUCKET = 'tailoring';

export class TailoringRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TailoringRequestError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Request normalisation                                               */
/* ------------------------------------------------------------------ */
function normalizeRequest(raw = {}) {
  const operation = String(raw.operation || 'enhance');
  if (!OPERATIONS.includes(operation)) {
    throw new TailoringRequestError('unknown_operation', `Unknown tailoring operation "${operation}".`);
  }
  const shape = OPERATION_SHAPE[operation];
  const jobDescription = String(raw.jobDescription || '').trim();

  if (shape.requiresJd && jobDescription.length < 40) {
    throw new TailoringRequestError(
      'job_description_required',
      `Operation "${operation}" needs a job description of at least 40 characters.`,
    );
  }

  const mode = resolveMode(raw.mode);
  const depth = raw.plan ? depthForPlan(raw.plan, raw.depth) : resolveDepth(raw.depth);

  return {
    operation,
    engineMode: shape.engineMode,
    doc: raw.doc,
    jobDescription,
    job: raw.job || {},
    targetRole: String(raw.targetRole || raw.doc?.targetRole || ''),
    mode,
    depth,
    plan: String(raw.plan || 'free'),
    surface: String(raw.surface || 'unknown'),
    userKey: raw.userKey || '',
    master: raw.master || null,
    verifiedSkills: raw.verifiedSkills || [],
    profileSkills: raw.profileSkills || [],
    githubEvidence: raw.githubEvidence || null,
    maxBulletsCurrent: raw.maxBulletsCurrent,
    maxBulletsPrevious: raw.maxBulletsPrevious,
    maxProjects: raw.maxProjects,
    /* Scope restrictions for the narrow operations. The engine still runs
       the full pipeline (consistency needs whole-document context); these
       only filter what is RETURNED as a proposed change. */
    scope: raw.scope || null,
  };
}

/* ------------------------------------------------------------------ */
/* Core — runs entirely inside the boundary                            */
/* ------------------------------------------------------------------ */
async function runTailoringCore(req) {
  /* Defensive: this function must never be reachable outside the boundary.
     If someone calls it directly in a future refactor, fail loudly rather
     than silently losing the guarantee. */
  if (!insideTailoringBoundary()) {
    throw new Error('runTailoringCore() executed outside the AI deny boundary — refusing to produce resume content.');
  }

  const engineOpts = {
    master: req.master,
    verifiedSkills: req.verifiedSkills,
    profileSkills: req.profileSkills,
    githubEvidence: req.githubEvidence,
    targetRole: req.targetRole,
    userKey: req.userKey,
    /* Structurally impossible to enable. The boundary would throw anyway;
       this makes the intent explicit at the call site. */
    useAi: false,
    useExternalResearch: false,
    maxBulletsCurrent: req.maxBulletsCurrent,
    maxBulletsPrevious: req.maxBulletsPrevious,
    maxProjects: req.maxProjects,
    /* Mode + depth are passed as real, consumed configuration. */
    strategy: req.mode,
    depth: req.depth,
    operation: req.operation,
  };

  const result = req.engineMode === 'tailor'
    ? await tailorResumeNarrative(req.doc, {
      ...engineOpts, jobDescription: req.jobDescription, job: req.job,
    })
    : await enhanceResumeNarrative(req.doc, engineOpts);

  return result;
}

/* Filter the returned change set for the narrow operations. The pipeline
   always runs whole-document because consistency and diversity are
   document-level properties; only the PROPOSAL is scoped. */
function applyScope(result, req) {
  if (!req.scope) return result;
  const { section, bulletId, itemId } = req.scope;
  const keep = (c) => (
    (!section || c.section === section)
    && (!bulletId || c.bulletId === bulletId)
    && (!itemId || c.itemId === itemId)
  );
  /* The ledger is { version, entries, summary } — filter the entries and
     keep the envelope, so downstream consumers see the same shape either way. */
  const ledger = result.changes;
  const entries = Array.isArray(ledger) ? ledger : (ledger?.entries || []);
  const filtered = entries.filter(keep);
  return {
    ...result,
    changes: Array.isArray(ledger)
      ? filtered
      : { ...ledger, entries: filtered, scoped: true },
    bullets: (result.bullets || []).filter(keep),
  };
}

/**
 * THE single business entry point for resume content generation.
 *
 * @param {object} request
 * @param {string} request.operation  one of OPERATIONS
 * @returns {Promise<object>} canonical tailoring result
 */
export async function runTailoring(request) {
  let req;
  try {
    req = normalizeRequest(request);
  } catch (err) {
    if (err instanceof TailoringRequestError) {
      return {
        ok: false, error: err.code, message: err.message,
        status: TAILORING_STATUS.PARTIAL, version: CANONICAL_TAILORING_VERSION,
      };
    }
    throw err;
  }

  const meta = buildBoundaryMetadata({
    operation: req.operation, mode: req.mode.id, depth: req.depth.id, surface: req.surface,
  });

  const started = Date.now();
  const result = await runInsideTailoringBoundary(meta, () => runTailoringCore(req));
  const durationMs = Date.now() - started;

  const scoped = applyScope(result, req);

  return {
    ...scoped,
    version: CANONICAL_TAILORING_VERSION,
    modesVersion: TAILORING_MODES_VERSION,
    engineVersions: NARRATIVE_ENGINE_VERSIONS,
    operation: req.operation,
    mode: req.mode.id,
    depth: req.depth.id,
    plan: req.plan,
    quotaBucket: TAILORING_QUOTA_BUCKET,
    boundary: { id: meta.boundaryId, enforced: true, aiCalls: 0 },
    durationMs,
    status: scoped.status || (scoped.ok === false ? TAILORING_STATUS.PARTIAL : TAILORING_STATUS.COMPLETE),
  };
}

/* ------------------------------------------------------------------ */
/* Operation-shaped convenience wrappers                               */
/* ------------------------------------------------------------------ */
/* These exist so callers read as intent rather than as configuration.
   All of them funnel through runTailoring(); none of them contains
   independent rewriting logic. */

export const tailorForJob = (r) => runTailoring({ ...r, operation: 'job-tailor' });
export const enhanceResume = (r) => runTailoring({ ...r, operation: 'enhance' });
export const optimizeForAts = (r) => runTailoring({ ...r, operation: 'ats-optimize' });
export const previewTailoring = (r) => runTailoring({ ...r, operation: 'preview' });

/**
 * Bullet assist — replaces the old assistRewrite() intelligence. It is a
 * SCOPE of the canonical pipeline, not a parallel writer.
 */
export const assistBullet = (r) => runTailoring({
  ...r,
  operation: 'bullet-assist',
  scope: { section: r.section || 'experience', bulletId: r.bulletId, itemId: r.itemId },
});

export const assistSummary = (r) => runTailoring({
  ...r, operation: 'summary-assist', scope: { section: 'summary' },
});

/**
 * Selection rerank — replaces the old proposeSelection() intelligence.
 */
export const rerankSelection = (r) => runTailoring({ ...r, operation: 'selection-rerank' });

export default {
  CANONICAL_TAILORING_VERSION, TAILORING_QUOTA_BUCKET, TailoringRequestError,
  runTailoring, tailorForJob, enhanceResume, optimizeForAts, previewTailoring,
  assistBullet, assistSummary, rerankSelection,
};
