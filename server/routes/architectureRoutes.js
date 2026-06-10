/* ============================================================
   Routes — Architecture Diagram OS  (/api/architecture/*)
   ------------------------------------------------------------
   Mounted from server.js via one import + one call, mirroring
   projectBuilderRoutes. Every route requires the app's existing
   auth (requireAuth) + the shared generation rate limiter.

   The engine is DETERMINISTIC — no AI key, DB or network is
   required for any route to work. Persistence (spec versions per
   project) is best-effort: when the DB is disabled every endpoint
   still returns full results, just without saved history.

   NOTE: the legacy POST /api/architecture/generate route in
   server.js is untouched — these endpoints are additive and do
   not conflict (different paths under the same prefix).
   ============================================================ */
import { z } from 'zod';
import {
  generateArchitectureSpec, refineSpec, validateSpec, viewToMermaid, viewToSvg,
  VIEW_TYPES, TARGET_LEVELS,
} from '../utils/architecture/index.js';

const shortText = (max) => z.string().max(max);

const specRequestSchema = z.object({
  projectId: shortText(120).optional().default(''),
  title: shortText(200).optional().default(''),
  description: shortText(8000).optional().default(''),
  techStack: z.array(z.string().max(80)).max(60).optional().default([]),
  targetRole: shortText(120).optional().default(''),
  projectType: shortText(80).optional().default(''),
  cloudProvider: shortText(20).optional().default('generic'),
  targetLevel: z.enum(['mvp', 'production', 'enterprise', 'college_saas']).optional().default('production'),
  diagramTypes: z.array(z.enum(VIEW_TYPES)).max(VIEW_TYPES.length).optional().default([]),
  constraints: shortText(2000).optional().default(''),
  persist: z.boolean().optional().default(true),
}).passthrough();

const specLike = z.object({
  title: z.string().optional(),
  views: z.array(z.any()).optional(),
  capabilities: z.array(z.string()).optional(),
}).passthrough();

const validateSchema = z.object({ architectureSpec: specLike });
const refineSchema = z.object({
  architectureSpec: specLike,
  instruction: shortText(2000),
  persist: z.boolean().optional().default(true),
});
const exportSchema = z.object({
  architectureSpec: specLike,
  viewId: shortText(80),
  format: z.enum(['json', 'mermaid', 'svg', 'png', 'pdf']),
});

export function registerArchitectureRoutes(app, deps = {}) {
  const { requireAuth, currentUser, generationLimiter = (req, res, next) => next(), db = null } = deps;
  if (!requireAuth || !currentUser) throw new Error('architectureRoutes: requireAuth + currentUser required');

  const validate = (schema) => (req, res, next) => {
    const r = schema.safeParse(req.body || {});
    if (!r.success) {
      return res.status(400).json({ success: false, error: 'invalid_input', details: r.error.issues.slice(0, 5).map((i) => i.message) });
    }
    req.body = r.data;
    next();
  };

  /* Best-effort persistence — never blocks or fails the response. */
  async function persistSpec(req, pkg) {
    if (!db?.dbEnabled?.() || !pkg?.architectureSpec?.projectId) return { saved: false };
    try {
      const u = currentUser(req);
      const result = await db.saveArchitectureSpec({
        userId: u?.id, email: u?.email,
        spec: pkg.architectureSpec,
        mermaidViews: pkg.mermaidViews || {},
        validationScore: pkg.validation?.score?.overallScore ?? null,
        checks: pkg.validation?.checks || [],
      });
      return { saved: !!result?.ok, version: result?.version || null };
    } catch { return { saved: false }; }
  }

  /* ---- POST /api/architecture/spec — generate / regenerate ---- */
  app.post('/api/architecture/spec', requireAuth, generationLimiter, validate(specRequestSchema), async (req, res) => {
    try {
      const b = req.body;
      if (!b.title.trim() && !b.description.trim() && !b.techStack.length) {
        return res.status(400).json({ success: false, error: 'empty_input', message: 'Provide a title, description or tech stack.' });
      }
      const pkg = generateArchitectureSpec(
        { projectId: b.projectId, title: b.title || 'Application', description: `${b.description} ${b.constraints}`.trim(), techStack: b.techStack, targetRole: b.targetRole, projectType: b.projectType },
        { cloudProvider: b.cloudProvider, targetLevel: b.targetLevel, diagramTypes: b.diagramTypes }
      );
      const persisted = b.persist ? await persistSpec(req, pkg) : { saved: false };
      res.json({
        success: true,
        architectureSpec: pkg.architectureSpec,
        mermaidViews: pkg.mermaidViews,
        backwardCompatibleMermaid: pkg.backwardCompatibleMermaid,
        validation: pkg.validation,
        warnings: pkg.warnings,
        recommendations: pkg.recommendations,
        implementationNotes: pkg.implementationNotes,
        serviceMappings: pkg.serviceMappings,
        persisted,
        db: db?.dbEnabled?.() || false,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'architecture_spec_failed', message: 'Could not generate the architecture spec.' });
    }
  });

  /* ---- POST /api/architecture/validate ---- */
  app.post('/api/architecture/validate', requireAuth, generationLimiter, validate(validateSchema), (req, res) => {
    try {
      const v = validateSpec(req.body.architectureSpec || {});
      res.json({ success: true, checks: v.checks, score: v.score, missingCriticalItems: v.missingCriticalItems, recommendations: v.recommendations, warnings: v.warnings });
    } catch (err) {
      res.status(500).json({ success: false, error: 'architecture_validate_failed', message: 'Could not validate the spec.' });
    }
  });

  /* ---- POST /api/architecture/refine ---- */
  app.post('/api/architecture/refine', requireAuth, generationLimiter, validate(refineSchema), async (req, res) => {
    try {
      const { architectureSpec: refined, diffSummary } = refineSpec(req.body.architectureSpec || {}, req.body.instruction || '');
      const v = validateSpec(refined);
      refined.bestPracticeChecks = v.checks;
      const pkg = { architectureSpec: refined, mermaidViews: null, validation: v };
      const persisted = req.body.persist ? await persistSpec(req, pkg) : { saved: false };
      res.json({ success: true, architectureSpec: refined, diffSummary, validation: v, warnings: v.warnings, recommendations: v.recommendations, persisted });
    } catch (err) {
      res.status(500).json({ success: false, error: 'architecture_refine_failed', message: 'Could not refine the spec.' });
    }
  });

  /* ---- POST /api/architecture/export — one view, one format ---- */
  app.post('/api/architecture/export', requireAuth, generationLimiter, validate(exportSchema), (req, res) => {
    try {
      const spec = req.body.architectureSpec || {};
      const views = Array.isArray(spec.views) ? spec.views : [];
      const view = views.find((v) => v.id === req.body.viewId || v.type === req.body.viewId);
      if (!view) return res.status(404).json({ success: false, error: 'view_not_found', message: 'No view with that id/type in the spec.' });
      const format = req.body.format;
      if (format === 'json') return res.json({ success: true, format, filename: `${view.type}.json`, content: JSON.stringify(view, null, 2), contentType: 'application/json' });
      if (format === 'mermaid') return res.json({ success: true, format, filename: `${view.type}.mmd`, content: viewToMermaid(view), contentType: 'text/plain' });
      if (format === 'svg') return res.json({ success: true, format, filename: `${view.type}.svg`, content: viewToSvg(view, { title: `${spec.title || ''} — ${view.title || view.type}` }), contentType: 'image/svg+xml' });
      // PNG/PDF intentionally not implemented (no headless browser / raster lib in this stack).
      return res.status(400).json({ success: false, error: 'unsupported_format', message: `${format.toUpperCase()} export is not available yet. Use JSON, Mermaid or SVG.` });
    } catch (err) {
      res.status(500).json({ success: false, error: 'architecture_export_failed', message: 'Could not export the view.' });
    }
  });

  /* ---- GET /api/architecture/specs?projectId= — saved versions (DB-backed) ---- */
  app.get('/api/architecture/specs', requireAuth, async (req, res) => {
    const u = currentUser(req);
    const projectId = String(req.query.projectId || '').slice(0, 120);
    if (!db?.dbEnabled?.()) return res.json({ success: true, specs: [], latest: null, db: false });
    try {
      const specs = await db.listArchitectureSpecVersions({ userId: u?.id, email: u?.email, projectId });
      const latest = projectId ? await db.getLatestArchitectureSpec({ userId: u?.id, email: u?.email, projectId }) : null;
      res.json({ success: true, specs, latest, db: true });
    } catch {
      res.json({ success: true, specs: [], latest: null, db: true });
    }
  });

  /* ---- GET /api/architecture/meta — view types + levels for the UI ---- */
  app.get('/api/architecture/meta', requireAuth, (req, res) => {
    res.json({ success: true, viewTypes: VIEW_TYPES, targetLevels: TARGET_LEVELS });
  });
}

export default { registerArchitectureRoutes };
