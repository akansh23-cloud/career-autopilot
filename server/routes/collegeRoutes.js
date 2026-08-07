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
import placement from '../utils/placementOutcomes.js';
import trends from '../utils/collegeTrends.js';
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

  /* Risk severity is a weighted sum, so it has no natural ceiling. These
     thresholds match the weights in collegeObservability's RISK_RULES: any
     single flag lands at low, a stacked pair at medium, three or more at high. */
  const riskBandOf = (severity) => {
    const v = Number(severity) || 0;
    if (v >= 6) return 'high';
    if (v >= 3) return 'medium';
    if (v > 0) return 'low';
    return 'none';
  };

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

  /* Sortable + paginated. The full cohort used to be serialized on every
     keystroke; at 2,000 students that is a multi-megabyte response for a
     40-row table. Sorting stays server-side so page 2 is the real page 2. */
  const SORTABLE = new Set(['name', 'branch', 'batch', 'readinessScore', 'resumeScore', 'verifiedProjects', 'lastActiveAt']);

  app.get('/api/college/students', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const filters = {
      branch: req.query.branch || '', batch: req.query.batch || '', year: req.query.year || '',
      skill: req.query.skill || '', minReadiness: req.query.minReadiness || '', minResume: req.query.minResume || '',
      verifiedOnly: req.query.verifiedOnly === 'true' || req.query.verifiedOnly === '1',
    };
    const q = String(req.query.q || '').trim().toLowerCase();
    const sort = SORTABLE.has(String(req.query.sort)) ? String(req.query.sort) : 'readinessScore';
    const order = String(req.query.order) === 'asc' ? 'asc' : 'desc';
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    // Opt-in enrichment. The default shape is unchanged for every existing
    // caller; the directory asks for deep=1 to get engagement, funnel stage
    // and risk severity that the observability engine already computes.
    const deep = req.query.deep === '1' || req.query.deep === 'true';

    let students;
    if (deep) {
      const now = Date.now();
      const { rows } = await db.collegeStudentsDeep({ collegeId });
      students = attachReadiness(rows)
        .filter((r) => {
          if (filters.branch && String(r.branch).toLowerCase() !== filters.branch.toLowerCase()) return false;
          if (filters.batch && String(r.batch) !== filters.batch) return false;
          if (filters.year && !String(r.year).toLowerCase().includes(filters.year.toLowerCase())) return false;
          if (filters.skill && !(r.skills || []).some((s) => String(s).toLowerCase().includes(filters.skill.toLowerCase()))) return false;
          if (filters.minReadiness !== '' && Number(r.readinessScore || 0) < Number(filters.minReadiness)) return false;
          if (filters.minResume !== '' && Number(r.resumeScore || 0) < Number(filters.minResume)) return false;
          if (filters.verifiedOnly && !(Number(r.projectsVerified) > 0)) return false;
          return true;
        })
        .map((r) => ({
          id: r.id, name: r.name, email: r.email, branch: r.branch, batch: r.batch, year: r.year,
          skills: r.skills || [],
          readinessScore: r.readinessScore, readinessCategory: r.readinessCategory,
          resumeScore: r.resumeScore,
          verifiedProjects: r.projectsVerified,
          projectsPending: r.projectsPending + r.projectsNeedsReview,
          recruiterReadyProjects: r.recruiterReadyProjects,
          lastActiveAt: r.lastActiveAt,
          funnelStage: collegeObservability.funnelStage(r),
          engagement: collegeObservability.engagementBucket(r.lastActiveAt, now),
          riskSeverity: collegeObservability.riskFlags(r, now).severity,
          // severity is a count-weighted number used for ordering; the band is
          // what a human can read in a table cell.
          riskBand: riskBandOf(collegeObservability.riskFlags(r, now).severity),
          membership: r.membership || { status: 'active', via: 'admin' },
        }));
    } else {
      students = await db.listCollegeStudents({ collegeId, filters });
    }

    // Free-text search across name and email — the single most-used lookup in
    // a placement office ("pull up Ananya's profile") and the one that was
    // missing entirely.
    if (q) students = students.filter((s) => `${s.name || ''} ${s.email || ''}`.toLowerCase().includes(q));

    const dir = order === 'asc' ? 1 : -1;
    students.sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      // Nulls always sort last regardless of direction: a student with no
      // resume score is missing data, not the worst-performing student.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });

    const total = students.length;
    const page = students.slice(offset, offset + limit);
    res.json({
      ok: true, collegeId, students: page, count: page.length,
      total, offset, limit, sort, order, deep,
      hasMore: offset + page.length < total,
      db: db.dbEnabled(),
    });
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

  /* =====================================================================
     Placement drives — full lifecycle, eligibility matching and outcomes
     ---------------------------------------------------------------------
     Drives are the placement cell's actual unit of work. Every number
     below is rule-based and reproducible: eligibility comes from the
     drive's own criteria, the funnel from recorded stages, and packages
     from CTC figures a human entered. No AI touches any of it.
     ===================================================================== */

  const eligibilitySchema = z.object({
    branches: z.array(z.string().max(60)).max(40).optional().default([]),
    batches: z.array(z.string().max(20)).max(20).optional().default([]),
    years: z.array(z.string().max(20)).max(12).optional().default([]),
    skills: z.array(z.string().max(60)).max(40).optional().default([]),
    requireVerifiedSkills: z.boolean().optional().default(false),
    minReadiness: z.coerce.number().min(0).max(100).nullable().optional(),
    minResume: z.coerce.number().min(0).max(100).nullable().optional(),
    minVerifiedProjects: z.coerce.number().min(0).max(50).nullable().optional(),
  }).partial();

  const driveSchema = z.object({
    title: z.string().trim().min(1, 'A drive title is required.').max(160),
    company: z.string().trim().max(160).optional().default(''),
    role: z.string().trim().max(160).optional().default(''),
    location: z.string().trim().max(160).optional().default(''),
    // CTC in LPA — the unit every Indian placement report is written in.
    ctcLpa: z.coerce.number().min(0).max(500).nullable().optional(),
    driveDate: z.string().max(40).optional().default(''),
    status: z.enum(['open', 'in_progress', 'closed', 'cancelled']).optional().default('open'),
    notes: z.string().max(2000).optional().default(''),
    eligibility: eligibilitySchema.optional().default({}),
  });

  const outcomeSchema = z.object({
    entries: z.array(z.object({
      studentId: z.string().min(1).max(80),
      stage: z.enum(placement.STAGE_IDS).optional().default('applied'),
      ctcLpa: z.coerce.number().min(0).max(500).nullable().optional(),
      company: z.string().max(160).optional().default(''),
      role: z.string().max(160).optional().default(''),
      note: z.string().max(500).optional().default(''),
    })).min(1).max(2000),
  });

  /** Shared loader: cohort rows with readiness attached, scoped to the caller. */
  async function scopedCohort(collegeId) {
    const { rows, events } = await db.collegeStudentsDeep({ collegeId });
    return { rows: attachReadiness(rows), events };
  }

  const findDrive = (drives, id) => drives.find((d) => String(d.id) === String(id));

  app.get('/api/college/drives', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const [drives, outcomes, { rows }] = await Promise.all([
      db.listPlacementDrives({ collegeId }),
      db.listPlacementOutcomes({ collegeId }),
      scopedCohort(collegeId),
    ]);
    // Every drive carries its own roll-up so the list is decision-ready
    // without N follow-up requests.
    const summarized = placement.summarizeDrives({ drives, outcomes, rows });
    res.json({
      ok: true, drives: summarized, count: summarized.length,
      stages: placement.PLACEMENT_STAGES, db: db.dbEnabled(),
    });
  });

  app.post('/api/college/drives', ...guard, validate(driveSchema), async (req, res) => {
    const result = await db.createPlacementDrive({
      collegeId: callerCollegeId(req),
      drive: { ...req.body, createdByEmail: me(req).email },
    });
    res.status(result.ok ? 200 : 400).json({ ...result, db: db.dbEnabled() });
  });

  app.patch('/api/college/drives/:id', ...guard, validate(driveSchema.partial()), async (req, res) => {
    const result = await db.updatePlacementDrive({
      collegeId: callerCollegeId(req), driveId: req.params.id, patch: req.body,
    });
    if (!result.ok && result.reason === 'not_found') {
      return res.status(404).json({ ok: false, error: 'not_found_or_out_of_scope' });
    }
    res.status(result.ok ? 200 : 400).json({ ...result, db: db.dbEnabled() });
  });

  app.delete('/api/college/drives/:id', ...guard, async (req, res) => {
    const result = await db.deletePlacementDrive({ collegeId: callerCollegeId(req), driveId: req.params.id });
    res.status(result.ok ? 200 : 400).json({ ...result, db: db.dbEnabled() });
  });

  /* Who qualifies for this drive, and — just as important — who does not and
     exactly why. A TPO can answer a student's "why wasn't I allowed to sit?"
     from this response without interpreting anything. */
  app.get('/api/college/drives/:id/cohort', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const [drives, { rows }, outcomes] = await Promise.all([
      db.listPlacementDrives({ collegeId }),
      scopedCohort(collegeId),
      db.listPlacementOutcomes({ collegeId, driveId: req.params.id }),
    ]);
    const drive = findDrive(drives, req.params.id);
    if (!drive) return res.status(404).json({ ok: false, error: 'not_found_or_out_of_scope' });

    const outcomeByStudent = new Map(outcomes.map((o) => [String(o.studentId), o]));
    const { eligible, ineligible } = placement.matchDriveCohort(rows, drive);
    const shape = (r) => ({
      id: r.id, name: r.name, email: r.email, branch: r.branch, batch: r.batch,
      readinessScore: r.readinessScore, resumeScore: r.resumeScore,
      projectsVerified: r.projectsVerified, eligible: r.eligible, reasons: r.reasons,
      outcome: outcomeByStudent.get(String(r.id)) || null,
    });

    res.json({
      ok: true, drive,
      eligible: eligible.map(shape),
      ineligible: ineligible.map(shape).slice(0, 500),
      counts: { eligible: eligible.length, ineligible: ineligible.length, total: rows.length },
      funnel: placement.buildDriveFunnel(outcomes),
      stages: placement.PLACEMENT_STAGES,
      db: db.dbEnabled(),
    });
  });

  app.get('/api/college/drives/:id/outcomes', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const outcomes = await db.listPlacementOutcomes({ collegeId, driveId: req.params.id });
    res.json({ ok: true, outcomes, funnel: placement.buildDriveFunnel(outcomes), db: db.dbEnabled() });
  });

  app.post('/api/college/drives/:id/outcomes', ...guard, validate(outcomeSchema), async (req, res) => {
    const collegeId = callerCollegeId(req);
    const [drives, cohort] = await Promise.all([
      db.listPlacementDrives({ collegeId }),
      db.listCollegeStudents({ collegeId }),
    ]);
    const drive = findDrive(drives, req.params.id);
    if (!drive) return res.status(404).json({ ok: false, error: 'not_found_or_out_of_scope' });

    // Tenancy is enforced on the write path too: a student id from another
    // college is silently dropped, never recorded against this drive.
    const inScope = new Set(cohort.map((s) => String(s.id)));
    const entries = req.body.entries
      .filter((e) => inScope.has(String(e.studentId)))
      .map((e) => ({
        ...e,
        company: e.company || drive.company || '',
        role: e.role || drive.role || drive.title || '',
        // Fall back to the drive's advertised package so a TPO marking ten
        // offers doesn't have to retype the same CTC ten times.
        ctcLpa: e.ctcLpa == null && (e.stage === 'offered' || e.stage === 'accepted')
          ? (drive.ctcLpa ?? null) : e.ctcLpa,
      }));
    if (!entries.length) return res.status(404).json({ ok: false, error: 'no_targets_in_scope' });

    const result = await db.upsertPlacementOutcomes({
      collegeId, driveId: req.params.id, entries, actorEmail: me(req).email,
    });
    const outcomes = await db.listPlacementOutcomes({ collegeId, driveId: req.params.id });
    res.status(result.ok ? 200 : 400).json({
      ...result, skipped: req.body.entries.length - entries.length,
      funnel: placement.buildDriveFunnel(outcomes), db: db.dbEnabled(),
    });
  });

  app.delete('/api/college/drives/:driveId/outcomes/:studentId', ...guard, async (req, res) => {
    const result = await db.removePlacementOutcome({
      collegeId: callerCollegeId(req), driveId: req.params.driveId, studentId: req.params.studentId,
    });
    res.status(result.ok ? 200 : 400).json({ ...result, db: db.dbEnabled() });
  });

  /* The placement report itself — the numbers a TPO forwards to their
     director and pastes into NAAC/NBA returns. */
  app.get('/api/college/placement', ...guard, async (req, res) => {
    const collegeId = callerCollegeId(req);
    const [{ rows }, drives, outcomes] = await Promise.all([
      scopedCohort(collegeId),
      db.listPlacementDrives({ collegeId }),
      db.listPlacementOutcomes({ collegeId }),
    ]);
    const stats = placement.buildPlacementStats({ rows, drives, outcomes, now: Date.now() });
    const placedIds = new Set(outcomes.filter(placement.isPlaced).map((o) => String(o.studentId)));
    res.json({
      ok: true, collegeId, ...stats,
      batchComparison: trends.batchComparison({ rows, placedIds, now: Date.now() }),
      drives: placement.summarizeDrives({ drives, outcomes, rows }),
      db: db.dbEnabled(),
    });
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
    const now = Date.now();
    const [{ rows, events }, drives, outcomes] = await Promise.all([
      db.collegeStudentsDeep({ collegeId }),
      db.listPlacementDrives({ collegeId }),
      db.listPlacementOutcomes({ collegeId }),
    ]);
    const scored = attachReadiness(rows);
    const payload = collegeObservability.buildObservability({ rows: scored, drives, events, now });

    /* ---- Trends -------------------------------------------------------
       Stock metrics (avg readiness, recruiter-ready) cannot be recovered
       retroactively, so we store one small snapshot per college per day and
       compare against it. Until a baseline exists the deltas come back null
       and the UI says "no baseline yet" — it never renders a fabricated
       trendline. Flow metrics come straight from the event log and are
       therefore available immediately. */
    const current = trends.snapshotMetrics({ rows: scored, now });
    // Fire-and-forget: measuring the dashboard must never be able to break it.
    db.recordCollegeSnapshot({ collegeId, metrics: current }).catch(() => {});
    const history = await db.listCollegeSnapshots({ collegeId, days: 120 }).catch(() => []);
    const placedIds = new Set(outcomes.filter(placement.isPlaced).map((o) => String(o.studentId)));
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
    // The PDF report needs a human name, not a slug, in its title block.
    const college = await db.getCollege({ key: collegeId }).catch(() => null);
    const out = {
      ok: true, collegeId, collegeName: college?.name || '', ...payload, roster,
      trends: {
        stock: trends.computeStockDeltas({ current, history, windowDays: 30, now }),
        flow: trends.computeFlowDeltas({ events, windowDays: 30, now }),
        snapshots: history.slice(-60),
      },
      batchComparison: trends.batchComparison({ rows: scored, placedIds, now }),
      placement: placement.buildPlacementStats({ rows: scored, drives, outcomes, now }).summary,
      db: db.dbEnabled(),
    };
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

  /* Assigned tasks were previously write-only: a TPO could send work out and
     had no way to see whether any of it came back. This closes the loop —
     completion rate per task, overdue detection, and cohort-level roll-up.

     Note the shape normalization: the DB path returns assigned/done while the
     demo path returns assignedCount/completedCount. Both are accepted here so
     the panel renders identically with or without a database. */
  app.get('/api/college/tasks', ...guard, async (req, res) => {
    const now = Date.now();
    const raw = await db.listCollegeTasks({ collegeId: callerCollegeId(req) });
    const tasks = raw.map((t) => {
      const assigned = Number(t.assigned ?? t.assignedCount ?? 0);
      const done = Number(t.done ?? t.completedCount ?? 0);
      const dueMs = t.dueAt ? Date.parse(t.dueAt) : NaN;
      const pending = Math.max(0, assigned - done);
      const isOverdue = Number.isFinite(dueMs) && dueMs < now && pending > 0;
      return {
        id: t.id, title: t.title, description: t.description || '',
        dueAt: t.dueAt || null, createdAt: t.createdAt || null,
        assigned, done, pending,
        completionRate: assigned > 0 ? Math.round((done / assigned) * 100) : 0,
        overdue: isOverdue,
        daysOverdue: isOverdue ? Math.floor((now - dueMs) / 86400000) : 0,
        status: pending === 0 && assigned > 0 ? 'complete' : isOverdue ? 'overdue' : 'active',
      };
    });

    const totalAssigned = tasks.reduce((s, t) => s + t.assigned, 0);
    const totalDone = tasks.reduce((s, t) => s + t.done, 0);
    res.json({
      ok: true, tasks, count: tasks.length,
      summary: {
        tasks: tasks.length,
        active: tasks.filter((t) => t.status === 'active').length,
        overdue: tasks.filter((t) => t.overdue).length,
        complete: tasks.filter((t) => t.status === 'complete').length,
        assigned: totalAssigned,
        done: totalDone,
        pending: Math.max(0, totalAssigned - totalDone),
        completionRate: totalAssigned > 0 ? Math.round((totalDone / totalAssigned) * 100) : 0,
      },
      db: db.dbEnabled(),
    });
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
      // `count` is students PER SPECIALISATION (four of them). Omit it to get
      // the full 200-student world; db.js clamps and defaults.
      const result = await db.seedDemoCollege({ reset: req.body?.reset === true, count: Number(req.body?.count) || 0 });
      res.status(result.ok ? 200 : 400).json(result);
    });
  }

  logger?.info?.('College multi-tenant routes registered', { emailConfigured: emailEnabled() });
}

export default { registerCollegeRoutes };
