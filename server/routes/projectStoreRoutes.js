/* ============================================================
   Routes — Server-owned Project Store  (/api/projects/store/*)
   ------------------------------------------------------------
   Phase 1 of the Market-Readiness Gap Sprint. The client's localStorage
   stays the cache; this store is the source of truth when MongoDB is on.

   Graceful degradation: with the DB off every endpoint returns
   { ok:false, reason:'db_off' } with HTTP 200 — the client detects this
   and keeps using localStorage exactly as before. Nothing here ever
   blocks the existing local-first flow.

   Ownership: every db.js helper resolves the user from the SESSION
   (userId/email) — a user can never read or write another user's rows.
   ============================================================ */
import { z } from 'zod';

const projectLike = z.object({ id: z.string().min(1).max(160) }).passthrough();

const saveSchema = z.object({
  projectId: z.string().max(160).optional(),
  project: projectLike.optional(),
  workspacePlan: z.object({}).passthrough().optional().nullable(),
  taskProgress: z.object({}).passthrough().optional(),
  clientUpdatedAt: z.string().max(40).optional(),
}).passthrough();

const progressSchema = z.object({
  taskProgress: z.object({}).passthrough().optional(),
  taskPatch: z.object({}).passthrough().optional(),
}).passthrough();

const syncSchema = z.object({
  projects: z.array(projectLike).max(300).default([]),
}).passthrough();

export function registerProjectStoreRoutes(app, deps = {}) {
  const { requireAuth, currentUser, db = null } = deps;
  if (!requireAuth || !currentUser) throw new Error('projectStoreRoutes: requireAuth + currentUser required');

  const validate = (schema) => (req, res, next) => {
    const r = schema.safeParse(req.body || {});
    if (!r.success) {
      return res.status(400).json({ ok: false, error: 'invalid_input', details: r.error.issues.slice(0, 5).map((i) => i.message) });
    }
    req.body = r.data;
    next();
  };

  const userOf = (req) => {
    const u = currentUser(req) || {};
    return { userId: u.id || u._id || '', email: u.email || '' };
  };

  /* Single db-off gate: HTTP 200 + ok:false so the client treats it as a
     soft signal (keep localStorage), never as an error toast. */
  const dbOff = (res) => res.json({ ok: false, reason: 'db_off' });

  /* ============ GET /api/projects/store — list my projects ============ */
  app.get('/api/projects/store', requireAuth, async (req, res) => {
    try {
      if (!db?.dbEnabled?.()) return dbOff(res);
      const records = await db.listUserProjects(userOf(req));
      res.json({ ok: true, projects: records.map((r) => r.project).filter(Boolean), records });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'list_failed', message: err.message });
    }
  });

  /* ============ GET /api/projects/store/:projectId ============ */
  app.get('/api/projects/store/:projectId', requireAuth, async (req, res) => {
    try {
      if (!db?.dbEnabled?.()) return dbOff(res);
      const record = await db.getUserProject({ ...userOf(req), projectId: req.params.projectId });
      if (!record) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, record });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'get_failed', message: err.message });
    }
  });

  /* ============ POST /api/projects/store — create/update one ============ */
  app.post('/api/projects/store', requireAuth, validate(saveSchema), async (req, res) => {
    try {
      if (!db?.dbEnabled?.()) return dbOff(res);
      const { projectId, project, workspacePlan, taskProgress, clientUpdatedAt } = req.body;
      const result = await db.saveUserProject({ ...userOf(req), projectId, project, workspacePlan, taskProgress, clientUpdatedAt });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: 'save_failed', message: err.message });
    }
  });

  /* ============ PATCH /api/projects/store/:projectId/progress ============ */
  app.patch('/api/projects/store/:projectId/progress', requireAuth, validate(progressSchema), async (req, res) => {
    try {
      if (!db?.dbEnabled?.()) return dbOff(res);
      const { taskProgress, taskPatch } = req.body;
      const result = await db.updateUserProjectProgress({ ...userOf(req), projectId: req.params.projectId, taskProgress, taskPatch });
      res.status(result.ok ? 200 : 404).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: 'progress_failed', message: err.message });
    }
  });

  /* ============ DELETE /api/projects/store/:projectId ============ */
  app.delete('/api/projects/store/:projectId', requireAuth, async (req, res) => {
    try {
      if (!db?.dbEnabled?.()) return dbOff(res);
      const result = await db.deleteUserProject({ ...userOf(req), projectId: req.params.projectId });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: 'delete_failed', message: err.message });
    }
  });

  /* ============ POST /api/projects/store/sync ============
     Client sends its local array; server merges last-write-wins per
     project by the client updatedAt; returns the merged set. This is
     also the first-login migration path: a fresh server set means every
     local project simply uploads. */
  app.post('/api/projects/store/sync', requireAuth, validate(syncSchema), async (req, res) => {
    try {
      if (!db?.dbEnabled?.()) return dbOff(res);
      const result = await db.syncUserProjects({ ...userOf(req), projects: req.body.projects });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: 'sync_failed', message: err.message });
    }
  });
}

export default { registerProjectStoreRoutes };
