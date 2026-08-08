/* ============================================================
   Routes — Team Project INDIVIDUAL PROGRESS
   ------------------------------------------------------------
   Closes the review: "Assigned projects progress can't be seen
   for individually."

   Mounts alongside the existing teamProjectRoutes.js rather than
   editing it, so this ships without touching 586 lines of working
   tenancy logic. Same guards, same scoping rules.

   Coordinator (college_admin | admin, own college only):
     GET  /api/college/team-projects/:id/progress
     POST /api/college/team-projects/:id/sync-commits
     POST /api/college/team-projects/:id/link-github   (map a login to a student)

   Student (self only, must be a member):
     GET   /api/my/team-projects/:id/progress
     PATCH /api/my/team-projects/:id/modules/:moduleName

   Wire in server.js, immediately after registerTeamProjectRoutes:

     import { registerTeamProgressRoutes } from './server/routes/teamProgressRoutes.js';
     registerTeamProgressRoutes(app, {
       requireAuth, requireRole, requireCollegeScope, currentUser, db, logger,
     });

   NOTE: every handler here is written with an explicit try/catch,
   unlike the 13 handlers in teamProjectRoutes.js. If you have
   already applied patchAppAsync() from asyncRoute.js the try blocks
   are belt-and-braces — keep them anyway; the error messages are
   more useful than a generic 500.
   ============================================================ */

import { z } from 'zod';
import progressEngine from '../utils/teamProgressEngine.js';
import { readTeamContributions, buildMemberMatcher } from '../utils/teamContributionVerifier.js';

export function registerTeamProgressRoutes(app, deps = {}) {
  const { requireAuth, requireRole, requireCollegeScope, currentUser, db, logger = console } = deps;
  if (!requireAuth || !requireRole || !requireCollegeScope || !currentUser || !db) {
    throw new Error('teamProgressRoutes: requireAuth, requireRole, requireCollegeScope, currentUser, db required');
  }

  const collegeScopeFromQuery = (req) => req.query.collegeId || req.body?.collegeId || null;
  const guard = [requireAuth, requireRole('college_admin', 'admin'), requireCollegeScope(collegeScopeFromQuery)];
  const me = (req) => { const u = currentUser(req) || {}; return { userId: u.id, email: u.email || '' }; };

  function callerCollegeId(req) {
    const ctx = req.userRole || {};
    return ctx.isAdmin
      ? String(req.query.collegeId || req.body?.collegeId || '').trim() || ctx.collegeId || ''
      : ctx.collegeId || '';
  }

  const fail = (res, status, error, message) => res.status(status).json({ ok: false, error, message });

  /* Raw per-member module rows, reconciled against the current brief. */
  const reconciled = (project) => progressEngine.reconcileProgress(project.memberProgress || {}, project.brief || {});

  const validate = (schema) => (req, res, next) => {
    const r = schema.safeParse(req.body || {});
    if (!r.success) {
      return res.status(400).json({
        ok: false, error: 'invalid_input',
        details: r.error.issues.slice(0, 5).map((i) => i.message),
      });
    }
    req.body = r.data; next();
  };

  /* ==================================================================
     COORDINATOR — read the per-member breakdown
     ================================================================== */

  app.get('/api/college/team-projects/:id/progress', ...guard, async (req, res) => {
    try {
      const collegeId = callerCollegeId(req);
      const project = await db.getTeamProject({ collegeId, projectId: req.params.id });
      if (!project) return fail(res, 404, 'not_found_or_out_of_scope', 'That team project is not in your college.');

      const progress = progressEngine.summarizeTeamProgress(project);
      res.json({
        ok: true,
        projectId: project.id,
        title: project.title,
        teamName: project.teamName || '',
        dueAt: project.dueAt || null,
        repoUrl: project.submission?.repoUrl || '',
        liveUrl: project.submission?.liveUrl || '',
        progress,
        db: db.dbEnabled(),
      });
    } catch (e) {
      logger.error?.('team progress read failed', { message: e.message });
      fail(res, 500, 'progress_failed', 'Could not build the progress breakdown. Please retry.');
    }
  });

  /* ==================================================================
     COORDINATOR — pull real commit attribution from the team repo
     ================================================================== */

  app.post('/api/college/team-projects/:id/sync-commits', ...guard, async (req, res) => {
    try {
      const collegeId = callerCollegeId(req);
      const project = await db.getTeamProject({ collegeId, projectId: req.params.id });
      if (!project) return fail(res, 404, 'not_found_or_out_of_scope', 'That team project is not in your college.');

      const read = await readTeamContributions(project);
      const matcher = buildMemberMatcher(project);
      const applied = progressEngine.applyCommitStats(
        project, read.contributors || [], matcher, { unavailable: !!read.unavailable },
      );

      const saved = await db.updateTeamProject({
        collegeId, projectId: project.id,
        patch: { memberProgress: applied.memberProgress, commitsSyncedAt: new Date().toISOString() },
      });

      const next = saved.ok ? saved.project : { ...project, memberProgress: applied.memberProgress };

      res.json({
        ok: true,
        /* The honest three-outcome report. `unavailable` is surfaced as its own
           state so the UI can say "could not check" instead of showing zeros. */
        unavailable: !!read.unavailable,
        reason: read.reason || '',
        note: read.note || '',
        matched: applied.matched,
        /* Unmatched logins are the actionable output: a coordinator can link
           them to a student rather than assume that student did nothing. */
        unmatchedLogins: applied.unmatched || [],
        progress: progressEngine.summarizeTeamProgress(next),
        db: db.dbEnabled(),
      });
    } catch (e) {
      logger.error?.('commit sync failed', { message: e.message });
      fail(res, 500, 'sync_failed', 'Could not read commit history. The project was not changed.');
    }
  });

  /* ==================================================================
     COORDINATOR — link an unmatched GitHub login to a student
     ================================================================== */

  const linkSchema = z.object({
    studentId: z.string().min(1).max(80),
    login: z.string().min(1).max(60),
  });

  app.post('/api/college/team-projects/:id/link-github', ...guard, validate(linkSchema), async (req, res) => {
    try {
      const collegeId = callerCollegeId(req);
      const project = await db.getTeamProject({ collegeId, projectId: req.params.id });
      if (!project) return fail(res, 404, 'not_found_or_out_of_scope', 'That team project is not in your college.');

      const progress = progressEngine.reconcileProgress(project.memberProgress || {}, project.brief || {});
      const row = progress[String(req.body.studentId)];
      if (!row) return fail(res, 400, 'not_a_member', 'That student is not on this team.');

      row.commits = { ...row.commits, login: String(req.body.login).trim() };
      const saved = await db.updateTeamProject({
        collegeId, projectId: project.id, patch: { memberProgress: progress },
      });

      res.json({
        ok: true,
        message: 'Linked. Run Sync commits again to attribute their history.',
        progress: progressEngine.summarizeTeamProgress(saved.ok ? saved.project : { ...project, memberProgress: progress }),
        db: db.dbEnabled(),
      });
    } catch (e) {
      logger.error?.('github link failed', { message: e.message });
      fail(res, 500, 'link_failed', 'Could not save that link. Please retry.');
    }
  });

  /* ==================================================================
     STUDENT — own progress
     ================================================================== */

  app.get('/api/my/team-projects/:id/progress', requireAuth, async (req, res) => {
    try {
      const project = await db.getMyTeamProject({ ...me(req), projectId: req.params.id });
      if (!project) return fail(res, 404, 'not_found_or_out_of_scope', 'You are not a member of that team project.');

      const progress = progressEngine.summarizeTeamProgress(project);
      const identity = String(me(req).userId || '');
      const mine = progress.members.find((m) => String(m.studentId) === identity) || null;
      /* The student UI needs the raw module rows (name -> status/evidence/note),
         not just the aggregate counts, so it can render a checklist. */
      const myModules = reconciled(project)[identity]?.modules || {};

      res.json({
        ok: true,
        projectId: project.id,
        title: project.title,
        dueAt: project.dueAt || null,
        /* Students see their OWN detail plus the team roll-up. Peer percentages
           are included deliberately — visible team progress drives completion —
           but the imbalance flags are coordinator-only and stripped here. */
        me: mine ? { ...mine, moduleRows: myModules } : null,
        team: { ...progress, flags: [] },
        db: db.dbEnabled(),
      });
    } catch (e) {
      logger.error?.('my team progress failed', { message: e.message });
      fail(res, 500, 'progress_failed', 'Could not load your progress. Please retry.');
    }
  });

  /* ==================================================================
     STUDENT — update one of their OWN modules
     ================================================================== */

  const moduleSchema = z.object({
    status: z.enum(['todo', 'in_progress', 'done']).optional(),
    evidenceUrl: z.string().max(500).optional(),
    note: z.string().max(500).optional(),
  }).refine((v) => v.status || v.evidenceUrl !== undefined || v.note !== undefined, {
    message: 'Provide a status, an evidence URL, or a note.',
  });

  app.patch('/api/my/team-projects/:id/modules/:moduleName', requireAuth, validate(moduleSchema), async (req, res) => {
    try {
      const project = await db.getMyTeamProject({ ...me(req), projectId: req.params.id });
      if (!project) return fail(res, 404, 'not_found_or_out_of_scope', 'You are not a member of that team project.');

      const moduleName = decodeURIComponent(req.params.moduleName);
      const applied = progressEngine.applyModuleUpdate(project, {
        studentId: me(req).userId,
        moduleName,
        status: req.body.status,
        evidenceUrl: req.body.evidenceUrl,
        note: req.body.note,
      });

      if (!applied.ok) {
        const messages = {
          not_a_member: 'You are not listed on this team.',
          /* This is the guard that stops a student ticking a teammate's work. */
          module_not_owned: 'That module is assigned to another team member, so you cannot update it.',
          bad_status: 'Status must be todo, in_progress or done.',
          bad_evidence_url: 'The evidence link must be a full http(s) URL — a commit, a PR, a deployed page or a screenshot.',
        };
        return fail(res, 400, applied.reason, messages[applied.reason] || 'That update could not be applied.');
      }

      const saved = await db.updateTeamProject({
        collegeId: project.collegeId, projectId: project.id,
        patch: { memberProgress: applied.memberProgress },
      });
      const next = saved.ok ? saved.project : { ...project, memberProgress: applied.memberProgress };
      const progress = progressEngine.summarizeTeamProgress(next);
      const identity = String(me(req).userId || '');
      const mine = progress.members.find((m) => String(m.studentId) === identity) || null;
      const myModules = applied.memberProgress[identity]?.modules || {};

      res.json({
        ok: true,
        me: mine ? { ...mine, moduleRows: myModules } : null,
        team: { ...progress, flags: [] },
        db: db.dbEnabled(),
      });
    } catch (e) {
      logger.error?.('module update failed', { message: e.message });
      fail(res, 500, 'update_failed', 'Could not save that update. Please retry.');
    }
  });

  return app;
}

export default { registerTeamProgressRoutes };
