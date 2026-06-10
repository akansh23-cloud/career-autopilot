/* ============================================================
   Routes — Project OS Builder Mode  (/api/project-builder/*)
   ------------------------------------------------------------
   Mounted from server.js via one import + one call. Every route
   requires the app's existing auth (requireAuth). The generator
   is DETERMINISTIC — no AI key, DB or network is required for any
   route to work. The client also holds a copy of the same pure
   generator (web/src/lib/buildGuide.js), so Builder Mode works
   fully offline; these routes exist for parity, export, and
   server-side progress persistence when a DB is configured.

   Persistence model: build PROGRESS lives ON the project object
   (project.buildProgress) inside the existing user-state
   `projects` array, so it rides the app's existing
   /api/user/state mechanism. We never mark a project "verified"
   here — build progress is execution, not proof.
   ============================================================ */
import { z } from 'zod';
import { buildGuide, progressFor, exportGuide } from '../services/projectBuilder/projectBuildGuideService.js';

const projectLike = z.object({}).passthrough();
const progressLike = z.object({
  prerequisites: z.record(z.boolean()).optional(),
  tasks: z.record(z.boolean()).optional(),
  stages: z.record(z.boolean()).optional(),
  currentStageId: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
}).passthrough();

const generateSchema = z.object({
  project: projectLike.optional().default({}),
  blueprint: z.any().optional(),
  architecture: z.any().optional(),
  proofChecklist: z.any().optional(),
  techStack: z.array(z.string()).optional(),
  targetRole: z.string().optional(),
  difficulty: z.string().optional(),
  skillLevel: z.string().optional(),
  progress: progressLike.optional().nullable(),
  aiGuide: z.any().optional().nullable(),
}).passthrough();

const progressSchema = z.object({
  project: projectLike.optional().default({}),
  progress: progressLike.optional().default({}),
}).passthrough();

const exportSchema = z.object({
  project: projectLike.optional().default({}),
  guide: z.any().optional().nullable(),
  progress: progressLike.optional().nullable(),
  format: z.enum(['markdown', 'json']).optional().default('markdown'),
}).passthrough();

export function registerProjectBuilderRoutes(app, deps = {}) {
  const { requireAuth, currentUser, generationLimiter = (req, res, next) => next(), db = null } = deps;
  if (!requireAuth || !currentUser) throw new Error('projectBuilderRoutes: requireAuth + currentUser required');

  const validate = (schema) => (req, res, next) => {
    const r = schema.safeParse(req.body || {});
    if (!r.success) return res.status(400).json({ ok: false, error: 'invalid_request', issues: r.error.issues.slice(0, 8).map((i) => ({ path: i.path.join('.'), message: i.message })) });
    req.body = r.data; next();
  };

  // Never throw to the client — degrade to a clear JSON error like the rest of the app.
  const guard = (handler) => async (req, res) => {
    try { return await handler(req, res); }
    catch (err) { console.error('[project-builder]', req.path, err && err.message); return res.status(200).json({ ok: false, error: 'internal', message: 'Something went wrong; Builder Mode is running in limited mode.' }); }
  };

  // Pull the saved project (and its buildProgress) out of the user's state, if a DB is configured.
  async function loadProject(req, projectId) {
    if (!db || !db.dbEnabled || !db.dbEnabled()) return null;
    try {
      const u = currentUser(req);
      const state = await db.getUserState({ userId: u?.id, email: u?.email });
      const projects = Array.isArray(state?.projects) ? state.projects : [];
      return projects.find((p) => String(p?.id) === String(projectId)) || null;
    } catch { return null; }
  }

  async function saveProgress(req, projectId, progress) {
    if (!db || !db.dbEnabled || !db.dbEnabled()) return { ok: false, persisted: false };
    try {
      const u = currentUser(req);
      const state = await db.getUserState({ userId: u?.id, email: u?.email });
      const projects = Array.isArray(state?.projects) ? state.projects.slice() : [];
      const idx = projects.findIndex((p) => String(p?.id) === String(projectId));
      if (idx < 0) return { ok: false, persisted: false };
      projects[idx] = { ...projects[idx], buildProgress: progress };
      const result = await db.patchUserState({ userId: u?.id, email: u?.email, patch: { projects } });
      return { ok: !!result?.ok, persisted: !!result?.ok };
    } catch { return { ok: false, persisted: false }; }
  }

  /* ---- POST /generate — build the structured guide from a project ---- */
  app.post('/api/project-builder/generate', requireAuth, generationLimiter, validate(generateSchema), guard(async (req, res) => {
    const { project = {}, progress = null, aiGuide = null } = req.body;
    // Allow loose top-level context (targetRole/difficulty/techStack) to override.
    const merged = {
      ...project,
      targetRole: project.targetRole || req.body.targetRole,
      difficulty: project.difficulty || req.body.difficulty,
      techStack: (Array.isArray(project.techStack) && project.techStack.length) ? project.techStack : (req.body.techStack || project.techStack),
    };
    const guide = buildGuide({ project: merged, progress, aiGuide });
    res.json({ ok: true, mode: 'deterministic', guide });
  }));

  /* ---- GET /:projectId — fetch the guide for a saved project ----
     Reads the project (and any saved buildProgress) from user state when a DB
     is configured; otherwise returns a clear note that the client holds state. */
  app.get('/api/project-builder/:projectId', requireAuth, guard(async (req, res) => {
    const project = await loadProject(req, req.params.projectId);
    if (!project) {
      return res.json({ ok: false, error: 'not_found', message: 'No saved project found server-side — the client holds project state. POST /api/project-builder/generate with the project to get its guide.' });
    }
    const guide = buildGuide({ project, progress: project.buildProgress || null });
    res.json({ ok: true, mode: 'deterministic', guide });
  }));

  /* ---- PATCH /:projectId/progress — update + (optionally) persist progress ----
     Build progress is execution tracking only. It NEVER sets verification/proof. */
  app.patch('/api/project-builder/:projectId/progress', requireAuth, validate(progressSchema), guard(async (req, res) => {
    let project = req.body.project;
    if (!project || !project.id) {
      const loaded = await loadProject(req, req.params.projectId);
      if (loaded) project = loaded;
    }
    const progress = req.body.progress || {};
    const { guide, progress: computed } = progressFor({ project: project || {}, progress });
    const saved = await saveProgress(req, req.params.projectId, progress);
    res.json({ ok: true, mode: 'deterministic', progress: computed, persisted: saved.persisted, verified: false, guide });
  }));

  /* ---- POST /:projectId/export — markdown or json ---- */
  app.post('/api/project-builder/:projectId/export', requireAuth, generationLimiter, validate(exportSchema), guard(async (req, res) => {
    let { project = {}, guide = null, progress = null } = req.body;
    if ((!project || !project.id) && (!guide)) {
      const loaded = await loadProject(req, req.params.projectId);
      if (loaded) { project = loaded; progress = progress || loaded.buildProgress || null; }
    }
    const out = exportGuide({ project, guide, progress, format: req.body.format });
    res.json({ ok: true, format: out.format, contentType: out.contentType, content: out.content });
  }));
}

export default { registerProjectBuilderRoutes };
