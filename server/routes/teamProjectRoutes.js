/* ============================================================
   Routes — Team Projects  (placement-cell group assignments)
   ------------------------------------------------------------
   The workflow this implements, end to end:

     1. A coordinator picks students (or asks the engine to form
        balanced teams from a filtered cohort).
     2. The engine reads the team's combined declared + verified
        skills and generates a CUSTOMISED project brief: archetype
        chosen by skill fit, stack drawn from skills the team
        actually has, a named role and owned modules per member,
        milestones sized to the deadline.
     3. Assigning it notifies every member in-app (and by email when
        SMTP is configured) and creates a matching college task, so
        it lands in the surfaces students already check.
     4. Students see the brief in their own workspace and submit one
        live hosted URL + repo URL for the team.
     5. The coordinator verifies that link. Verification is a REAL
        network check through the existing proof-verification engine
        (SSRF-guarded fetch, hosting-platform failure signatures,
        GitHub repo/README/CI reads) — never a self-reported tick.

   Routes:
     /api/college/team-projects/*   coordinator (college_admin|admin,
                                    scope-guarded to their own college)
     /api/my/team-projects/*        student self-service, restricted to
                                    assignments they are a member of

   Guarantees: tenancy is enforced on every read and write; a student
   id from another college is dropped rather than assigned; the
   verification verdict distinguishes "failed" from "could not check",
   so a rate-limited GitHub call never marks a team as failing.
   ============================================================ */
import { z } from 'zod';
import engine from '../utils/teamProjectEngine.js';
import progressEngine from '../utils/teamProgressEngine.js';
import { verifyDeployment, verifyGithubRepo, verifyReadme, verifyCiRun } from '../utils/workspace/proofVerification.js';
import { emailEnabled, sendMail, nudgeEmail } from '../utils/mailer.js';
import { DEMO_COLLEGE_ID, demoModeEnabled } from '../utils/demoCollegeData.js';

export function registerTeamProjectRoutes(app, deps = {}) {
  const {
    requireAuth, requireRole, requireCollegeScope,
    currentUser, db, logger, computeReadiness,
  } = deps;
  if (!requireAuth || !requireRole || !requireCollegeScope || !currentUser || !db || !computeReadiness) {
    throw new Error('teamProjectRoutes: requireAuth, requireRole, requireCollegeScope, currentUser, db, computeReadiness required');
  }

  const collegeScopeFromQuery = (req) => req.query.collegeId || req.body?.collegeId || null;
  const demoScopeActive = () => demoModeEnabled() && !db.dbEnabled();

  function callerCollegeId(req) {
    const ctx = req.userRole || {};
    const resolved = ctx.isAdmin
      ? String(req.query.collegeId || req.body?.collegeId || '').trim() || ctx.collegeId || ''
      : ctx.collegeId || '';
    if (resolved) return resolved;
    return demoScopeActive() ? DEMO_COLLEGE_ID : '';
  }

  const guard = [requireAuth, requireRole('college_admin', 'admin'), requireCollegeScope(collegeScopeFromQuery)];
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
  const me = (req) => { const u = currentUser(req) || {}; return { userId: u.id, email: u.email || '' }; };

  /* Readiness is attached the same way the college routes do it, so a member
     card in a team brief shows the same number as the student directory. */
  const attachReadiness = (rows) => rows.map((r) => {
    const readiness = computeReadiness({
      verifiedSkills: r.verifiedSkills || [], totalVerifiedXp: r.totalVerifiedXp || 0,
      verifiedProjectCount: r.projectsVerified ?? r.verifiedProjects ?? 0,
      recruiterReadyProjectCount: r.recruiterReadyProjects || 0,
      resumeScore: r.resumeScore ?? null,
    });
    return { ...r, readinessScore: readiness.score, readinessCategory: readiness.category };
  });

  async function scopedCohort(collegeId) {
    const { rows } = await db.collegeStudentsDeep({ collegeId });
    return attachReadiness(rows);
  }

  /** Resolve requested student ids against the caller's own cohort. Anything
      out of scope is silently dropped — never assigned, never echoed back. */
  function resolveMembers(cohort, studentIds = []) {
    const byId = new Map(cohort.map((s) => [String(s.id), s]));
    const found = [];
    const missing = [];
    for (const id of studentIds) {
      const hit = byId.get(String(id));
      if (hit) found.push(hit); else missing.push(String(id));
    }
    return { found, missing };
  }

  const decorate = (p) => ({ ...p, summary: engine.summarizeAssignment(p) });

  /* =====================================================================
     Coordinator — /api/college/team-projects
     ===================================================================== */

  /** The archetype catalogue + capability areas, so the UI never hardcodes them. */
  app.get('/api/college/team-projects/catalog', ...guard, (req, res) => {
    res.json({
      ok: true,
      archetypes: engine.ARCHETYPE_LIST,
      areas: engine.AREA_IDS.map((id) => ({ id, label: engine.AREA_LABELS[id] })),
    });
  });

  /* Team formation. Returns proposed teams WITH their skill analysis and does
     not persist anything — a coordinator can regenerate until the split looks
     right, then assign. */
  const suggestSchema = z.object({
    studentIds: z.array(z.string().max(80)).max(400).optional().default([]),
    teamSize: z.coerce.number().min(2).max(8).optional().default(4),
    strategy: z.enum(['balanced', 'similar']).optional().default('balanced'),
    filters: z.object({
      branch: z.string().max(60).optional().default(''),
      batch: z.string().max(20).optional().default(''),
      year: z.string().max(20).optional().default(''),
      minReadiness: z.coerce.number().min(0).max(100).optional().nullable(),
    }).partial().optional().default({}),
    limit: z.coerce.number().min(2).max(120).optional().default(40),
  });

  app.post('/api/college/team-projects/suggest', ...guard, validate(suggestSchema), async (req, res) => {
    const collegeId = callerCollegeId(req);
    const cohort = await scopedCohort(collegeId);
    const { studentIds, teamSize, strategy, filters, limit } = req.body;

    let pool;
    if (studentIds.length) {
      pool = resolveMembers(cohort, studentIds).found;
    } else {
      /* Auto-selection. Two things matter here and neither used to:

         1. ORDER. `slice(limit)` over the raw cohort took whatever the database
            returned first, which is registration order — for a multi-year
            college that is the entire first-year intake of one branch. The
            resulting teams averaged under three declared skills between four
            students, so the brief could not be matched to anything and came
            back generic. Ranking by readiness first means the coordinator sees
            teams built from students who actually have something to build with.
         2. EMPTY MEMBERS. A student with no declared skills contributes
            nothing to coverage and occupies a seat. They are excluded from
            AUTO-selection only — a coordinator can still hand-pick them via
            studentIds, which is how you deliberately pair a junior with a
            strong team. */
      pool = cohort.filter((s) => {
        if (filters.branch && String(s.branch).toLowerCase() !== filters.branch.toLowerCase()) return false;
        if (filters.batch && String(s.batch) !== filters.batch) return false;
        if (filters.year && !String(s.year).toLowerCase().includes(filters.year.toLowerCase())) return false;
        if (filters.minReadiness != null && Number(s.readinessScore || 0) < Number(filters.minReadiness)) return false;
        return (s.skills || []).length > 0;
      })
        .sort((a, b) => Number(b.readinessScore || 0) - Number(a.readinessScore || 0))
        .slice(0, limit);
    }

    if (pool.length < 2) {
      return res.status(400).json({
        ok: false,
        error: 'not_enough_students',
        message: studentIds.length
          ? 'Select at least two students in your college to form a team.'
          : 'No students matched those filters with any declared skills. Widen the filters, or pick students by hand.',
      });
    }

    const result = engine.suggestTeams({ students: pool, teamSize, strategy });
    // Each proposed team gets its matched project up front, so the coordinator
    // is choosing between complete assignments rather than bare name lists.
    const teams = result.teams.map((t) => ({
      ...t,
      preview: engine.generateTeamProject({ members: t.members, options: {} }),
    }));
    res.json({ ok: true, collegeId, teams, count: teams.length, strategy, teamSize, poolSize: pool.length, db: db.dbEnabled() });
  });

  /* Preview one specific team's brief without persisting — used when a
     coordinator hand-picks members or changes archetype/deadline. */
  const previewSchema = z.object({
    studentIds: z.array(z.string().max(80)).min(2).max(8),
    title: z.string().max(160).optional().default(''),
    domain: z.string().max(80).optional().default(''),
    archetypeId: z.string().max(40).optional().default(''),
    difficulty: z.enum(['starter', 'standard', 'stretch']).optional().default('standard'),
    dueAt: z.string().max(40).optional().default(''),
    notes: z.string().max(2000).optional().default(''),
  });

  app.post('/api/college/team-projects/preview', ...guard, validate(previewSchema), async (req, res) => {
    const collegeId = callerCollegeId(req);
    const cohort = await scopedCohort(collegeId);
    const { found, missing } = resolveMembers(cohort, req.body.studentIds);
    if (found.length < 2) {
      return res.status(404).json({ ok: false, error: 'no_targets_in_scope', message: 'At least two of the selected students must belong to your college.' });
    }
    const members = found.map(engine.shapeMember);
    const brief = engine.generateTeamProject({ members, options: req.body });
    res.json({
      ok: true, collegeId, members, brief,
      analysis: engine.analyzeTeamSkills(found),
      skipped: missing.length, db: db.dbEnabled(),
    });
  });

  app.get('/api/college/team-projects', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const projects = (await db.listTeamProjects({ collegeId })).map(decorate);
    const summary = {
      total: projects.length,
      assigned: projects.filter((p) => p.summary.status === 'assigned').length,
      submitted: projects.filter((p) => p.summary.status === 'submitted').length,
      verified: projects.filter((p) => p.summary.status === 'verified').length,
      needsWork: projects.filter((p) => p.summary.status === 'needs_work').length,
      overdue: projects.filter((p) => p.summary.overdue).length,
      studentsEngaged: new Set(projects.flatMap((p) => (p.members || []).map((m) => m.studentId))).size,
    };
    res.json({ ok: true, collegeId, projects, count: projects.length, summary, db: db.dbEnabled() });
  });

  app.get('/api/college/team-projects/:id', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const project = await db.getTeamProject({ collegeId, projectId: req.params.id });
    if (!project) return res.status(404).json({ ok: false, error: 'not_found_or_out_of_scope' });

    /* The coordinator asked to see the assigned student profiles alongside the
       project, so member rows are re-read live rather than served from the
       denormalised copy — readiness and verified-project counts move after the
       assignment was made, and a stale card would be misleading. */
    const cohort = await scopedCohort(collegeId);
    const byId = new Map(cohort.map((s) => [String(s.id), s]));
    const profiles = (project.members || []).map((m) => {
      const live = byId.get(String(m.studentId));
      return {
        ...m,
        live: live ? {
          readinessScore: live.readinessScore,
          readinessCategory: live.readinessCategory,
          resumeScore: live.resumeScore ?? null,
          verifiedProjects: live.projectsVerified ?? live.verifiedProjects ?? 0,
          skills: live.skills || [],
          verifiedSkills: live.verifiedSkills || [],
          lastActiveAt: live.lastActiveAt || null,
        } : null,
        stillInCohort: !!live,
      };
    });

    res.json({ ok: true, project: decorate(project), profiles, db: db.dbEnabled() });
  });

  /* Assign. This is the write that creates the record AND reaches the students:
     in-app notification always, email when configured, plus a college task so
     it appears in the task roll-up the coordinator already watches. */
  const assignSchema = previewSchema.extend({
    teamName: z.string().max(80).optional().default(''),
    notifyStudents: z.boolean().optional().default(true),
    requireLiveUrl: z.boolean().optional().default(true),
  });

  app.post('/api/college/team-projects', ...guard, validate(assignSchema), async (req, res) => {
    const collegeId = callerCollegeId(req);
    if (!collegeId) return res.status(400).json({ ok: false, error: 'no_scope' });

    const cohort = await scopedCohort(collegeId);
    const { found, missing } = resolveMembers(cohort, req.body.studentIds);
    if (found.length < 2) {
      return res.status(404).json({ ok: false, error: 'no_targets_in_scope', message: 'At least two of the selected students must belong to your college.' });
    }

    const members = found.map(engine.shapeMember);
    const brief = engine.generateTeamProject({ members, options: req.body });
    const college = await db.getCollege({ key: collegeId }).catch(() => null);

    const created = await db.createTeamProject({
      collegeId,
      project: {
        title: brief.title,
        teamName: String(req.body.teamName || '').trim().slice(0, 80) || `Team · ${brief.title}`.slice(0, 80),
        status: 'assigned',
        dueAt: req.body.dueAt || null,
        requireLiveUrl: req.body.requireLiveUrl !== false,
        members,
        brief,
        /* Seed a progress row per member at assign time. An ABSENT row and a
           ZERO row mean different things to a coordinator, so every member has
           one from day one. Projects assigned before this shipped self-heal:
           reconcileProgress() rebuilds missing rows from the brief on read. */
        memberProgress: progressEngine.initMemberProgress(brief),
        analysis: engine.analyzeTeamSkills(found),
        assignedByEmail: me(req).email,
        collegeName: college?.name || '',
      },
    });
    if (!created.ok) return res.status(400).json({ ...created, db: db.dbEnabled() });

    const delivery = await notifyTeam({
      collegeId, college, members,
      title: `New team project: ${brief.title}`,
      body: `Your placement cell assigned you to a ${members.length}-person team project. Open Team Project to see your role, your modules and the deadline. You will need to submit a live hosted URL.`,
      enabled: req.body.notifyStudents !== false,
      actorEmail: me(req).email,
    });

    // A matching college task keeps the assignment visible in the task
    // roll-up alongside individual work, rather than living in a silo.
    let taskId = '';
    if (db.dbEnabled()) {
      const task = await db.createCollegeTask({
        collegeId,
        title: `Team project: ${brief.title}`.slice(0, 200),
        description: `Build and deploy with your team, then submit the live hosted URL and repository link.`,
        dueAt: req.body.dueAt || null,
        studentIds: members.map((m) => m.studentId),
        createdByEmail: me(req).email,
      }).catch(() => ({ ok: false }));
      if (task?.ok) taskId = task.taskId || '';
    }

    res.json({
      ok: true, collegeId,
      project: decorate(created.project),
      skipped: missing.length,
      delivery, taskId,
      db: db.dbEnabled(),
    });
  });

  const patchSchema = z.object({
    teamName: z.string().max(80).optional(),
    title: z.string().max(160).optional(),
    dueAt: z.string().max(40).nullable().optional(),
    status: z.enum(['assigned', 'in_progress', 'submitted', 'verified', 'needs_work', 'closed']).optional(),
    coordinatorNotes: z.string().max(2000).optional(),
    requireLiveUrl: z.boolean().optional(),
  });

  app.patch('/api/college/team-projects/:id', ...guard, validate(patchSchema), async (req, res) => {
    const result = await db.updateTeamProject({
      collegeId: callerCollegeId(req), projectId: req.params.id, patch: req.body,
    });
    if (!result.ok && result.reason === 'not_found') {
      return res.status(404).json({ ok: false, error: 'not_found_or_out_of_scope' });
    }
    res.status(result.ok ? 200 : 400).json({
      ...result, ...(result.project ? { project: decorate(result.project) } : {}), db: db.dbEnabled(),
    });
  });

  app.delete('/api/college/team-projects/:id', ...guard, async (req, res) => {
    const result = await db.deleteTeamProject({ collegeId: callerCollegeId(req), projectId: req.params.id });
    res.status(result.ok ? 200 : 400).json({ ...result, db: db.dbEnabled() });
  });

  /* "Ask for the live hosted project link" — an explicit, recorded request
     rather than a coordinator chasing students over WhatsApp. */
  const requestSchema = z.object({ message: z.string().max(1000).optional().default('') });

  app.post('/api/college/team-projects/:id/request-link', ...guard, validate(requestSchema), async (req, res) => {
    const collegeId = callerCollegeId(req);
    const project = await db.getTeamProject({ collegeId, projectId: req.params.id });
    if (!project) return res.status(404).json({ ok: false, error: 'not_found_or_out_of_scope' });

    const college = await db.getCollege({ key: collegeId }).catch(() => null);
    const delivery = await notifyTeam({
      collegeId, college, members: project.members || [],
      title: `Live link requested: ${project.title}`,
      body: req.body.message
        || 'Your placement cell has asked for the live hosted URL for your team project. Deploy what you have and submit the link — it is checked automatically, so it must be publicly reachable.',
      enabled: true,
      actorEmail: me(req).email,
    });

    const requests = Array.isArray(project.linkRequests) ? project.linkRequests.slice(-9) : [];
    requests.push({ at: new Date().toISOString(), by: me(req).email, message: req.body.message || '' });
    await db.updateTeamProject({ collegeId, projectId: project.id, patch: { linkRequests: requests } });

    res.json({ ok: true, delivery, requested: requests.length, db: db.dbEnabled() });
  });

  /* Verification — the real check. */
  app.post('/api/college/team-projects/:id/verify', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const project = await db.getTeamProject({ collegeId, projectId: req.params.id });
    if (!project) return res.status(404).json({ ok: false, error: 'not_found_or_out_of_scope' });
    const verification = await runVerification(project);
    const saved = await db.recordTeamProjectVerification({ collegeId, projectId: project.id, verification });
    res.json({
      ok: true, verification,
      project: saved.ok ? decorate(saved.project) : decorate({ ...project, verification }),
      db: db.dbEnabled(),
    });
  });

  /* =====================================================================
     Student self-service — /api/my/team-projects
     ===================================================================== */

  app.get('/api/my/team-projects', requireAuth, async (req, res) => {
    const projects = (await db.listMyTeamProjects(me(req))).map((p) => {
      const identity = me(req);
      const mine = (p.brief?.assignments || []).find((a) => (
        String(a.studentId) === String(identity.userId)
        || String(a.email || '').toLowerCase() === String(identity.email || '').toLowerCase()
      )) || null;
      return { ...decorate(p), myAssignment: mine };
    });
    res.json({ ok: true, projects, count: projects.length, db: db.dbEnabled() });
  });

  app.get('/api/my/team-projects/:id', requireAuth, async (req, res) => {
    const project = await db.getMyTeamProject({ ...me(req), projectId: req.params.id });
    if (!project) return res.status(404).json({ ok: false, error: 'not_found_or_out_of_scope' });
    res.json({ ok: true, project: decorate(project), db: db.dbEnabled() });
  });

  /* One submission per team — any member may set or update it. */
  const submitSchema = z.object({
    liveUrl: z.string().max(500).optional().default(''),
    repoUrl: z.string().max(500).optional().default(''),
    notes: z.string().max(2000).optional().default(''),
  });

  app.post('/api/my/team-projects/:id/submit', requireAuth, validate(submitSchema), async (req, res) => {
    const { liveUrl, repoUrl, notes } = req.body;
    if (!liveUrl && !repoUrl) {
      return res.status(400).json({ ok: false, error: 'nothing_submitted', message: 'Add at least a live hosted URL or a repository URL.' });
    }
    const result = await db.submitTeamProjectLink({ ...me(req), projectId: req.params.id, liveUrl, repoUrl, notes });
    if (!result.ok) {
      return res.status(result.reason === 'not_found_or_out_of_scope' ? 404 : 400).json({ ...result, db: db.dbEnabled() });
    }
    res.json({ ok: true, project: decorate(result.project), db: db.dbEnabled() });
  });

  /* Students can run the same check themselves before the coordinator does —
     the point is to fix a dead deployment before it is graded, not to be
     caught out by it. */
  app.post('/api/my/team-projects/:id/verify', requireAuth, async (req, res) => {
    const project = await db.getMyTeamProject({ ...me(req), projectId: req.params.id });
    if (!project) return res.status(404).json({ ok: false, error: 'not_found_or_out_of_scope' });
    const verification = await runVerification(project);
    const saved = await db.recordTeamProjectVerification({
      collegeId: project.collegeId, projectId: project.id, verification,
    });
    res.json({
      ok: true, verification,
      project: saved.ok ? decorate(saved.project) : decorate({ ...project, verification }),
      db: db.dbEnabled(),
    });
  });

  /* =====================================================================
     Shared internals
     ===================================================================== */

  async function notifyTeam({ collegeId, college, members = [], title, body, enabled = true, actorEmail = '' }) {
    if (!enabled) return { attempted: false, inApp: 0, emailed: 0, emailConfigured: emailEnabled() };
    const ids = members.map((m) => m.studentId).filter(Boolean);

    let inApp = 0;
    if (db.dbEnabled() && ids.length) {
      const created = await db.createNotifications({
        collegeId, userIds: ids, type: 'task',
        title: String(title).slice(0, 200), body: String(body).slice(0, 2000),
        actionView: 'teamproject', createdByEmail: actorEmail,
      }).catch(() => ({ ok: false, created: 0 }));
      inApp = created?.created || 0;
    }

    let emailed = 0; let emailFailed = 0;
    if (emailEnabled()) {
      for (const m of members) {
        if (!m.email) continue;
        const mail = nudgeEmail({
          studentName: m.name, collegeName: college?.name, title, message: body,
          appUrl: process.env.FRONTEND_ORIGIN || '',
        });
        const r = await sendMail({ to: m.email, ...mail });
        if (r.ok) emailed += 1; else emailFailed += 1;
      }
    }

    return {
      attempted: true, inApp, emailed, emailFailed,
      emailConfigured: emailEnabled(),
      // Reported honestly — with no database there is nowhere to store an
      // in-app notification, and saying otherwise would be a lie the
      // coordinator acts on.
      message: db.dbEnabled()
        ? `Notified ${inApp} student${inApp === 1 ? '' : 's'} in-app${emailEnabled() ? `; ${emailed} email${emailed === 1 ? '' : 's'} sent.` : '. Email delivery is not configured.'}`
        : 'The assignment was created, but in-app notifications need the database, so none were stored.',
    };
  }

  /* One verification pass over the team's submitted evidence.
     THREE outcomes are preserved from the proof engine: present, absent, and
     could-not-check. A check that could not run leaves the project pending —
     it never becomes a failure the team is judged on. */
  async function runVerification(project) {
    const liveUrl = String(project.submission?.liveUrl || '').trim();
    const repoUrl = String(project.submission?.repoUrl || '').trim();
    const checkedAt = new Date().toISOString();

    if (!liveUrl && !repoUrl) {
      return {
        checkedAt, passed: false, pending: false,
        checks: [], summary: 'Nothing has been submitted yet — there is no live URL or repository to check.',
      };
    }

    const [deployment, repo] = await Promise.all([
      liveUrl ? verifyDeployment(liveUrl).catch(() => null) : Promise.resolve(null),
      repoUrl ? verifyGithubRepo(repoUrl).catch(() => null) : Promise.resolve(null),
    ]);

    // README and CI are only worth fetching once the repo itself resolved.
    const repoLive = repo && repo.present;
    const [readme, ci] = repoLive
      ? await Promise.all([
        verifyReadme(repoUrl).catch(() => null),
        verifyCiRun(repoUrl).catch(() => null),
      ])
      : [null, null];

    const checks = [];
    const push = (key, label, required, result, passWhen, note) => {
      if (!result) {
        checks.push({ key, label, required, state: 'not_submitted', note });
        return;
      }
      if (result.unavailable || result.checked === false) {
        checks.push({ key, label, required, state: 'unavailable', note: result.note || 'This check could not run just now.' });
        return;
      }
      checks.push({
        key, label, required,
        state: passWhen(result) ? 'pass' : 'fail',
        note: result.note || '',
        ...(result.finalUrl ? { finalUrl: result.finalUrl } : {}),
        ...(result.statusCode ? { statusCode: result.statusCode } : {}),
        ...(result.fullName ? { fullName: result.fullName } : {}),
        ...(result.runUrl ? { runUrl: result.runUrl } : {}),
      });
    };

    push('live_url', 'Live hosted URL reachable', !!project.requireLiveUrl, deployment,
      (r) => !!r.reachable && !r.failureNote, 'No live URL submitted.');
    push('repo', 'Public repository with source', true, repo,
      (r) => !!r.present && !r.isPrivate && r.hasSource !== false, 'No repository URL submitted.');
    push('readme', 'README documents setup', false, readme,
      (r) => !!r.meaningful, 'Not checked — the repository did not resolve.');
    push('ci', 'CI run passing', false, ci,
      (r) => !!r.present, 'Not checked — the repository did not resolve.');

    const requiredChecks = checks.filter((c) => c.required);
    const passed = requiredChecks.length > 0
      && requiredChecks.every((c) => c.state === 'pass');
    const pending = requiredChecks.some((c) => c.state === 'unavailable');

    const failing = requiredChecks.filter((c) => c.state === 'fail' || c.state === 'not_submitted');
    const summary = passed
      ? `Verified: ${requiredChecks.length} required check${requiredChecks.length === 1 ? '' : 's'} passed${liveUrl ? ` and the live deployment responded` : ''}.`
      : pending
        ? 'Some checks could not run just now (rate limit or network). This stays pending — nothing was marked failed.'
        : `Not verified yet: ${failing.map((c) => c.label.toLowerCase()).join(', ')}.`;

    return {
      checkedAt, passed, pending, checks, summary,
      liveUrl, repoUrl,
      // Kept so the coordinator can see the exact evidence that was judged,
      // not just the verdict.
      raw: { deployment, repo, readme, ci },
    };
  }

  logger?.info?.('Team project routes registered', { emailConfigured: emailEnabled() });
}

export default { registerTeamProjectRoutes };
