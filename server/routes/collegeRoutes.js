/* ============================================================
   Routes — College & Placement Cell  (multi-tenant)
   ------------------------------------------------------------
   Extracted from server.js and extended for real multi-college
   operation. Three route families:

   /api/college/*      TPO/placement-cell (college_admin|admin; every
                       route scope-guarded to the caller's own college)
       overview · students · students/:id · students/:id/detail ·
       analytics · observability (60s cached) · export · drives ·
       members (list/approve/remove) · roster (list/import CSV) ·
       settings (domains/auto-approve/rotate code) · notify (REAL:
       in-app always + email when configured) · tasks (REAL)

   /api/my/college/*   student self-service (any authed user)
       me · register (propose a college + TPO verification request) ·
       join (by code) · leave
   /api/my/*           notifications (list/read) · tasks (list/done) ·
                       consent (DPDP acceptance)

   /api/admin/colleges admin registry (list · approve · demo seed)

   Guarantees: college data never crosses tenants (scope checks on
   every read/write), the notify path never fakes delivery (email
   status is reported honestly), and every list degrades to an empty
   state — never a 500 — when the DB is off.
   ============================================================ */
import { z } from 'zod';
import collegeObservability from '../utils/collegeObservability.js';
import { parseRosterCsv, isValidJoinCodeFormat, ROSTER_MAX_ROWS } from '../utils/collegeOnboarding.js';
import { buildCsv } from '../utils/csvSafe.js';
import { emailEnabled, sendMail, nudgeEmail } from '../utils/mailer.js';
import { DEMO_COLLEGE_ID, demoModeEnabled } from '../utils/demoCollegeData.js';

const OBSERVABILITY_CACHE_TTL_MS = 60 * 1000;

export function registerCollegeRoutes(app, deps = {}) {
  const {
    requireAuth, requireRole, requireCollegeScope, requireAdmin,
    currentUser, db, logger, computeReadiness,
  } = deps;
  if (!requireAuth || !requireRole || !requireCollegeScope || !currentUser || !db || !computeReadiness) {
    throw new Error('collegeRoutes: requireAuth, requireRole, requireCollegeScope, currentUser, db, computeReadiness required');
  }

  const collegeScopeFromQuery = (req) => req.query.collegeId || req.body?.collegeId || null;

  // With DEMO_MODE on and no database, no user carries a real collegeId, so
  // every scoped read would resolve to '' and return empty. Fall back to the
  // demo college so the command center has a cohort to render. Guarded on
  // both flags — with a real DB this is never reached.
  const demoScopeActive = () => demoModeEnabled() && !db.dbEnabled();

  function callerCollegeId(req) {
    const ctx = req.userRole || {};
    // Admin may target any college via ?collegeId=; college_admin is pinned to own.
    const resolved = ctx.isAdmin
      ? String(req.query.collegeId || req.body?.collegeId || '').trim() || ctx.collegeId || ''
      : ctx.collegeId || '';
    if (resolved) return resolved;
    return demoScopeActive() ? DEMO_COLLEGE_ID : '';
  }
  const guard = [requireAuth, requireRole('college_admin', 'admin'), requireCollegeScope(collegeScopeFromQuery)];
  const validate = (schema) => (req, res, next) => {
    const r = schema.safeParse(req.body || {});
    if (!r.success) return res.status(400).json({ ok: false, error: 'invalid_input', details: r.error.issues.slice(0, 5).map((i) => i.message) });
    req.body = r.data; next();
  };
  const me = (req) => { const u = currentUser(req) || {}; return { userId: u.id, email: u.email || '' }; };

  const attachReadiness = (rows) => rows.map((r) => {
    const readiness = computeReadiness({
      verifiedSkills: r.verifiedSkills || [], totalVerifiedXp: r.totalVerifiedXp || 0,
      verifiedProjectCount: r.projectsVerified || 0, recruiterReadyProjectCount: r.recruiterReadyProjects || 0,
      resumeScore: r.resumeScore ?? null,
    });
    return { ...r, readinessScore: readiness.score, readinessCategory: readiness.category, readinessComponents: readiness.components, readinessGaps: readiness.gaps };
  });

  /* =====================================================================
     TPO / placement-cell routes  (/api/college/*)
     ===================================================================== */

  app.get('/api/college/overview', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const students = await db.listCollegeStudents({ collegeId });
    const n = students.length;
    const avg = (key) => (n ? Math.round(students.reduce((s, x) => s + (Number(x[key]) || 0), 0) / n) : 0);
    const placementReady = students.filter((s) => Number(s.readinessScore || 0) >= 70).length;
    res.json({
      ok: true, collegeId,
      summary: { students: n, avgReadiness: avg('readinessScore'), avgResume: avg('resumeScore'), placementReady, withVerifiedProjects: students.filter((s) => s.verifiedProjects > 0).length },
      db: db.dbEnabled(),
    });
  });

  app.get('/api/college/students', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const filters = {
      branch: req.query.branch || '', batch: req.query.batch || '', year: req.query.year || '',
      skill: req.query.skill || '', minReadiness: req.query.minReadiness || '', minResume: req.query.minResume || '',
      verifiedOnly: req.query.verifiedOnly === 'true' || req.query.verifiedOnly === '1',
    };
    const students = await db.listCollegeStudents({ collegeId, filters });
    res.json({ ok: true, collegeId, students, count: students.length, db: db.dbEnabled() });
  });

  app.get('/api/college/students/:id', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const students = await db.listCollegeStudents({ collegeId });
    const student = students.find((s) => s.id === req.params.id);
    if (!student) return res.status(404).json({ ok: false, error: 'not_found_or_out_of_scope' });
    res.json({ ok: true, student, db: db.dbEnabled() });
  });

  app.get('/api/college/analytics', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const students = await db.listCollegeStudents({ collegeId });
    const byKey = (key) => {
      const m = {};
      for (const s of students) { const k = String(s[key] || 'Unknown'); (m[k] ||= { count: 0, readiness: 0 }); m[k].count++; m[k].readiness += Number(s.readinessScore || 0); }
      return Object.entries(m).map(([k, v]) => ({ key: k, count: v.count, avgReadiness: Math.round(v.readiness / v.count) }));
    };
    const skillHeat = {};
    for (const s of students) for (const sk of (s.skills || [])) skillHeat[sk] = (skillHeat[sk] || 0) + 1;
    res.json({
      ok: true, collegeId,
      batch: byKey('batch'), branch: byKey('branch'),
      skillHeatmap: Object.entries(skillHeat).map(([skill, count]) => ({ skill, count })).sort((a, b) => b.count - a.count).slice(0, 40),
      resumeReadiness: { withResume: students.filter((s) => s.resumeScore != null).length, total: students.length, avgResume: students.length ? Math.round(students.reduce((a, s) => a + (Number(s.resumeScore) || 0), 0) / students.length) : 0 },
      db: db.dbEnabled(),
    });
  });

  app.get('/api/college/drives', ...guard, async (req, res) => {
    const drives = await db.listPlacementDrives({ collegeId: callerCollegeId(req) });
    res.json({ ok: true, drives, db: db.dbEnabled() });
  });
  app.post('/api/college/drives', ...guard, async (req, res) => {
    const b = req.body || {};
    const drive = { title: String(b.title || 'Untitled drive').slice(0, 160), company: String(b.company || '').slice(0, 160), eligibility: b.eligibility || {}, status: 'open' };
    const result = await db.createPlacementDrive({ collegeId: callerCollegeId(req), drive });
    res.status(result.ok ? 200 : 400).json({ ...result, db: db.dbEnabled() });
  });

  /* ---- Advanced observability (command center) ------------------------
     One aggregate for the placement-cell command center. Readiness comes
     from the shared deterministic engine; risk flags from explicit rules
     (collegeObservability.js) — no AI in any score, stage or flag.
     Cached 60s per college (?fresh=1 bypasses) because it batch-computes
     readiness for the whole cohort. */
  const observabilityCache = new Map(); // collegeId -> { at, payload }

  app.get('/api/college/observability', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
    const hit = observabilityCache.get(collegeId);
    if (!fresh && hit && Date.now() - hit.at < OBSERVABILITY_CACHE_TTL_MS) {
      return res.json({ ...hit.payload, cached: true, cacheAgeMs: Date.now() - hit.at });
    }
    const [{ rows, events }, drives] = await Promise.all([
      db.collegeStudentsDeep({ collegeId }),
      db.listPlacementDrives({ collegeId }),
    ]);
    const scored = attachReadiness(rows);
    const payload = collegeObservability.buildObservability({ rows: scored, drives, events, now: Date.now() });
    const roster = scored
      .map((r) => ({
        id: r.id, name: r.name, email: r.email, branch: r.branch, batch: r.batch,
        readinessScore: r.readinessScore, readinessCategory: r.readinessCategory,
        resumeScore: r.resumeScore, projectsVerified: r.projectsVerified,
        projectsPending: r.projectsPending + r.projectsNeedsReview,
        recruiterReadyProjects: r.recruiterReadyProjects,
        verifiedSkills: (r.verifiedSkills || []).length, declaredSkills: (r.skills || []).length,
        totalVerifiedXp: r.totalVerifiedXp,
        funnelStage: collegeObservability.funnelStage(r),
        engagement: collegeObservability.engagementBucket(r.lastActiveAt, Date.now()),
        lastActiveAt: r.lastActiveAt,
        membership: r.membership || { status: 'active', via: 'admin' },
        riskSeverity: collegeObservability.riskFlags(r, Date.now()).severity,
      }))
      .sort((a, b) => (b.readinessScore || 0) - (a.readinessScore || 0));
    const out = { ok: true, collegeId, ...payload, roster, db: db.dbEnabled() };
    observabilityCache.set(collegeId, { at: Date.now(), payload: out });
    res.json(out);
  });

  app.get('/api/college/students/:id/detail', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const detail = await db.collegeStudentDetail({ collegeId, studentId: req.params.id });
    if (!detail) return res.status(404).json({ ok: false, error: 'not_found_or_out_of_scope' });
    const readiness = computeReadiness({
      verifiedSkills: detail.skillLedger.filter((s) => s.verifiedXp > 0).map((s) => s.skill),
      totalVerifiedXp: detail.skillLedger.reduce((a, s) => a + s.verifiedXp, 0),
      verifiedProjectCount: detail.projects.filter((p) => p.status === 'verified').length,
      recruiterReadyProjectCount: detail.projects.filter((p) => p.status === 'verified' && (p.githubUrl || p.liveDemoUrl)).length,
      resumeScore: detail.resumeHistory[0]?.score ?? null,
    });
    res.json({ ok: true, student: { ...detail, readiness }, db: db.dbEnabled() });
  });

  app.get('/api/college/export', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    if (req.query.full === '1' || req.query.full === 'true') {
      const { rows } = await db.collegeStudentsDeep({ collegeId });
      const scored = attachReadiness(rows);
      const csv = collegeObservability.deepStudentCsv(scored, Date.now());
      return res.json({ ok: true, format: 'csv', full: true, rows: scored.length, csv, db: db.dbEnabled() });
    }
    const students = await db.listCollegeStudents({ collegeId });
    const cols = ['id', 'name', 'email', 'branch', 'batch', 'readinessScore', 'resumeScore', 'verifiedProjects'];
    // csvSafe neutralizes formula injection (=,+,-,@ first chars) — TPO CSVs
    // open straight in Excel, and student names are attacker-controlled input.
    const csv = buildCsv(cols, students.map((s) => cols.map((c) => s[c] ?? '')));
    res.json({ ok: true, format: 'csv', rows: students.length, csv, db: db.dbEnabled() });
  });

  /* ---- Members: who is bound to this college, approvals, removal ---- */
  app.get('/api/college/members', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const status = ['pending', 'active'].includes(String(req.query.status)) ? String(req.query.status) : '';
    const members = await db.listCollegeMembers({ collegeId, status });
    res.json({
      ok: true, collegeId, members, count: members.length,
      pending: members.filter((m) => m.membership?.status === 'pending').length,
      db: db.dbEnabled(),
    });
  });

  app.post('/api/college/members/:id/approve', ...guard, async (req, res) => {
    if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off' });
    const result = await db.setMemberStatus({ collegeId: callerCollegeId(req), memberId: req.params.id, action: 'approve' });
    if (result.ok) {
      await db.createNotifications({
        collegeId: callerCollegeId(req), userIds: [req.params.id], type: 'membership',
        title: 'College membership approved',
        body: 'Your placement cell approved your membership. Your readiness progress is now visible to them.',
        createdByEmail: me(req).email,
      }).catch(() => {});
    }
    res.status(result.ok ? 200 : 404).json({ ...result, db: db.dbEnabled() });
  });

  app.delete('/api/college/members/:id', ...guard, async (req, res) => {
    if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off' });
    const result = await db.setMemberStatus({ collegeId: callerCollegeId(req), memberId: req.params.id, action: 'remove' });
    res.status(result.ok ? 200 : 404).json({ ...result, db: db.dbEnabled() });
  });

  /* ---- Roster: the bulk onboarding path ---- */
  app.get('/api/college/roster', ...guard, async (req, res) => {
    const roster = await db.listRoster({ collegeId: callerCollegeId(req) });
    res.json({ ok: true, ...roster, db: db.dbEnabled() });
  });

  const rosterImportSchema = z.object({
    csv: z.string().min(3).max(2 * 1024 * 1024),
  });
  app.post('/api/college/roster/import', ...guard, validate(rosterImportSchema), async (req, res) => {
    if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off', message: 'Roster import needs the database.' });
    const parsed = parseRosterCsv(req.body.csv);
    if (!parsed.rows.length) {
      return res.status(400).json({ ok: false, error: 'no_valid_rows', parseErrors: parsed.errors.slice(0, 20), headerDetected: parsed.headerDetected, maxRows: ROSTER_MAX_ROWS });
    }
    const result = await db.importRoster({ collegeId: callerCollegeId(req), rows: parsed.rows, importedBy: me(req).email });
    res.status(result.ok ? 200 : 400).json({
      ...result,
      parsedRows: parsed.rows.length,
      parseErrors: parsed.errors.slice(0, 20),
      headerDetected: parsed.headerDetected,
      db: db.dbEnabled(),
    });
  });

  /* ---- Settings: domains, auto-approve, join-code rotation ---- */
  app.get('/api/college/settings', ...guard, async (req, res) => {
    const college = await db.getCollege({ key: callerCollegeId(req) });
    if (!college) return res.json({ ok: true, college: null, db: db.dbEnabled() });
    res.json({
      ok: true,
      college: {
        key: college.key, name: college.name, status: college.status, city: college.city || '',
        domains: college.domains || [], joinCode: college.joinCode || '',
        settings: college.settings || {}, demo: !!college.demo,
      },
      emailConfigured: emailEnabled(),
      db: db.dbEnabled(),
    });
  });

  const settingsSchema = z.object({
    domains: z.array(z.string().max(120)).max(20).optional(),
    autoApproveDomainJoins: z.boolean().optional(),
    autoApproveCodeJoins: z.boolean().optional(),
    city: z.string().max(80).optional(),
  });
  app.post('/api/college/settings', ...guard, validate(settingsSchema), async (req, res) => {
    if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off' });
    const result = await db.updateCollegeSettings({ collegeId: callerCollegeId(req), ...req.body });
    res.status(result.ok ? 200 : 404).json({ ...result, db: db.dbEnabled() });
  });

  app.post('/api/college/settings/rotate-code', ...guard, async (req, res) => {
    if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off' });
    const result = await db.rotateCollegeJoinCode({ collegeId: callerCollegeId(req) });
    res.status(result.ok ? 200 : 404).json({ ...result, db: db.dbEnabled() });
  });

  /* ---- Notify: REAL delivery. In-app is guaranteed; email is attempted
          when SMTP is configured and the outcome is reported honestly —
          this endpoint never claims a delivery that did not happen. ---- */
  const notifySchema = z.object({
    studentIds: z.array(z.string().max(40)).min(1).max(500),
    title: z.string().max(200).optional().default(''),
    message: z.string().max(2000).optional().default(''),
  });
  app.post('/api/college/notify', ...guard, validate(notifySchema), async (req, res) => {
    if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off', message: 'Notifications need the database.' });
    const collegeId = callerCollegeId(req);
    const { studentIds, title, message } = req.body;
    // Scope check: only students of THIS college can be nudged.
    const cohort = await db.listCollegeStudents({ collegeId });
    const cohortById = new Map(cohort.map((s) => [s.id, s]));
    const targets = studentIds.filter((id) => cohortById.has(id));
    if (!targets.length) return res.status(404).json({ ok: false, error: 'no_targets_in_scope' });

    const college = await db.getCollege({ key: collegeId });
    const finalTitle = title || `${college?.name || 'Your placement cell'}: action needed`;
    const finalBody = message || 'Your placement cell asked you to update your readiness progress — open your workspace to see what to do next.';

    const created = await db.createNotifications({
      collegeId, userIds: targets, type: 'nudge',
      title: finalTitle, body: finalBody, actionView: 'readiness',
      createdByEmail: me(req).email,
    });
    if (!created.ok) return res.status(500).json({ ok: false, error: 'notify_failed' });

    let emailed = 0; let emailFailed = 0;
    if (emailEnabled()) {
      for (const id of targets) {
        const s = cohortById.get(id);
        if (!s?.email) continue;
        const mail = nudgeEmail({ studentName: s.name, collegeName: college?.name, title: finalTitle, message: finalBody, appUrl: process.env.FRONTEND_ORIGIN || '' });
        const r = await sendMail({ to: s.email, ...mail });
        if (r.ok) emailed += 1; else emailFailed += 1;
      }
      await db.setNotificationEmailStatus({ ids: created.ids, status: emailed ? 'sent' : 'failed' }).catch(() => {});
    }

    res.json({
      ok: true, collegeId,
      inApp: created.created,
      emailed, emailFailed,
      emailConfigured: emailEnabled(),
      message: emailEnabled()
        ? `Delivered in-app to ${created.created} student${created.created === 1 ? '' : 's'}; ${emailed} email${emailed === 1 ? '' : 's'} sent.`
        : `Delivered in-app to ${created.created} student${created.created === 1 ? '' : 's'}. Email delivery is not configured (set SMTP_URL to enable).`,
      db: db.dbEnabled(),
    });
  });

  /* ---- Tasks: REAL assignments with per-student completion ---- */
  const taskSchema = z.object({
    studentIds: z.array(z.string().max(40)).min(1).max(500),
    title: z.string().min(3).max(200),
    description: z.string().max(2000).optional().default(''),
    dueAt: z.string().max(40).optional().nullable().default(null),
  });
  app.post('/api/college/tasks', ...guard, validate(taskSchema), async (req, res) => {
    if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off', message: 'Task assignment needs the database.' });
    const collegeId = callerCollegeId(req);
    const cohort = await db.listCollegeStudents({ collegeId });
    const inScope = new Set(cohort.map((s) => s.id));
    const targets = req.body.studentIds.filter((id) => inScope.has(id));
    if (!targets.length) return res.status(404).json({ ok: false, error: 'no_targets_in_scope' });
    const result = await db.createCollegeTask({
      collegeId, title: req.body.title, description: req.body.description,
      dueAt: req.body.dueAt, studentIds: targets, createdByEmail: me(req).email,
    });
    if (result.ok) {
      await db.createNotifications({
        collegeId, userIds: targets, type: 'task',
        title: `New task from your placement cell: ${req.body.title}`.slice(0, 200),
        body: req.body.description || 'Open your tasks to see the details.',
        actionView: 'readiness', createdByEmail: me(req).email,
      }).catch(() => {});
    }
    res.status(result.ok ? 200 : 400).json({ ...result, db: db.dbEnabled() });
  });

  app.get('/api/college/tasks', ...guard, async (req, res) => {
    const tasks = await db.listCollegeTasks({ collegeId: callerCollegeId(req) });
    res.json({ ok: true, tasks, db: db.dbEnabled() });
  });

  /* =====================================================================
     Student self-service  (/api/my/*) — any authenticated user
     ===================================================================== */

  app.get('/api/my/college', requireAuth, async (req, res) => {
    const result = await db.getMyCollege(me(req));
    res.json({ ...result, db: db.dbEnabled() });
  });

  const registerSchema = z.object({
    name: z.string().min(3).max(160),
    city: z.string().max(80).optional().default(''),
    domains: z.array(z.string().max(120)).max(10).optional().default([]),
  });
  app.post('/api/my/college/register', requireAuth, validate(registerSchema), async (req, res) => {
    if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off', message: 'College registration needs the database.' });
    const u = currentUser(req) || {};
    const result = await db.registerCollege({
      name: req.body.name, city: req.body.city, domains: req.body.domains,
      requestedByUserId: u.id, requestedByEmail: u.email,
    });
    if (result.ok) {
      // The registrant becomes the pending TPO through the existing
      // role-verification flow — a platform admin approves both together.
      await db.requestRoleVerification({
        id: u.id, email: u.email, name: u.name,
        requestedType: 'college_admin', collegeId: result.college.key,
      }).catch(() => {});
    }
    res.status(result.ok ? 200 : 400).json({ ...result, db: db.dbEnabled() });
  });

  const joinSchema = z.object({ code: z.string().min(4).max(20) });
  app.post('/api/my/college/join', requireAuth, validate(joinSchema), async (req, res) => {
    if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off', message: 'Joining a college needs the database.' });
    if (!isValidJoinCodeFormat(req.body.code)) return res.status(400).json({ ok: false, error: 'invalid_code_format' });
    const result = await db.joinCollegeByCode({ ...me(req), code: req.body.code });
    res.status(result.ok ? 200 : 400).json({ ...result, db: db.dbEnabled() });
  });

  app.post('/api/my/college/leave', requireAuth, async (req, res) => {
    if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off' });
    const result = await db.leaveCollege(me(req));
    res.json({ ...result, db: db.dbEnabled() });
  });

  app.get('/api/my/notifications', requireAuth, async (req, res) => {
    const result = await db.listMyNotifications({
      ...me(req),
      unreadOnly: req.query.unread === '1',
      limit: Number(req.query.limit) || 30,
    });
    res.json({ ok: true, ...result, db: db.dbEnabled() });
  });

  app.post('/api/my/notifications/read', requireAuth, async (req, res) => {
    if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 100) : null;
    const result = await db.markNotificationsRead({ ...me(req), ids });
    res.json({ ...result, db: db.dbEnabled() });
  });

  app.get('/api/my/tasks', requireAuth, async (req, res) => {
    const tasks = await db.listMyTasks(me(req));
    res.json({ ok: true, tasks, db: db.dbEnabled() });
  });

  app.post('/api/my/tasks/:taskId/done', requireAuth, async (req, res) => {
    if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off' });
    const result = await db.completeMyTask({ ...me(req), taskId: req.params.taskId });
    res.status(result.ok ? 200 : 404).json({ ...result, db: db.dbEnabled() });
  });

  /* ---- DPDP consent (version-tracked; recorded before feature use) ---- */
  app.post('/api/my/consent', requireAuth, async (req, res) => {
    const accept = req.body?.accept === true;
    if (!accept) return res.status(400).json({ ok: false, error: 'accept_required', message: 'Send { "accept": true } to record consent.' });
    const collegeVisibility = req.body?.collegeVisibility !== false;
    if (!db.dbEnabled()) {
      // DB off (local/dev): record in the session so the UI doesn't loop.
      if (req.session?.user) req.session.user.consent = { version: db.CONSENT_VERSION, acceptedAt: new Date().toISOString(), collegeVisibility };
      return res.json({ ok: true, stored: 'session', version: db.CONSENT_VERSION });
    }
    const result = await db.setUserConsent({ ...me(req), version: db.CONSENT_VERSION, collegeVisibility });
    if (result.ok && req.session?.user) req.session.user.consent = result.consent;
    res.status(result.ok ? 200 : 400).json({ ...result, stored: 'db', version: db.CONSENT_VERSION });
  });

  /* =====================================================================
     Platform-admin registry  (/api/admin/colleges)
     ===================================================================== */
  if (requireAdmin) {
    app.get('/api/admin/colleges', requireAuth, requireAdmin, async (req, res) => {
      const colleges = await db.listColleges({ status: req.query.status || undefined });
      res.json({ ok: true, colleges, db: db.dbEnabled() });
    });

    app.post('/api/admin/colleges/:key/approve', requireAuth, requireAdmin, async (req, res) => {
      if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off' });
      const u = currentUser(req) || {};
      const result = await db.approveCollege({
        key: req.params.key,
        aliases: Array.isArray(req.body?.aliases) ? req.body.aliases : [],
        approverEmail: u.email,
      });
      res.status(result.ok ? 200 : 404).json({ ...result, db: db.dbEnabled() });
    });

    app.post('/api/admin/demo/seed', requireAuth, requireAdmin, async (req, res) => {
      const result = await db.seedDemoCollege({ reset: req.body?.reset === true, count: Number(req.body?.count) || 50 });
      res.status(result.ok ? 200 : 400).json(result);
    });
  }

  logger?.info?.('College multi-tenant routes registered', { emailConfigured: emailEnabled() });
}

export default { registerCollegeRoutes };
