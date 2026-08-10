/* ============================================================
   Routes — Resume OS market-readiness  (/api/resume/ats-audit,
   /api/resume/jd-match)
   ------------------------------------------------------------
   Phase 4 of the Market-Readiness Gap Sprint. Both endpoints are fully
   deterministic engine calls — no AI, no required DB. jd-match enriches
   its output with the user's server-verified skills when the DB is on,
   so a missing-but-provable skill is flagged "add this — you can prove
   it" (the proof-score moat tie-in).
   ============================================================ */
import { z } from 'zod';
import { auditAtsCompatibility } from '../utils/resume/atsAuditEngine.js';
import { matchResumeToJD, resolveVerifiedSkills } from '../utils/resume/jdMatchEngine.js';
import { classifyResumeEvidenceGaps } from '../utils/resume/evidenceGapClassifier.js';
import { buildQualityChecks } from '../utils/resume/scoringEngine.js';
/* ---- Resume OS V3 (canonical deterministic engine) ---- */
import { normalizeResumeDocument, fromStructuredResume, toPlainText, RESUME_DOCUMENT_VERSION, makeId } from '../utils/resume/resumeDocument.js';
import { auditResumeTruth, TRUTH_ENGINE_VERSION } from '../utils/resume/truthEngine.js';
import { scoreResumeDocument, ATS_ENGINE_VERSION } from '../utils/resume/atsEngineV3.js';
import { parseJDv2, JD_PARSER_VERSION } from '../utils/resume/jdParserV2.js';
import { matchDocumentToJD, rankContentForTarget, proposeTailoredSelection, JOB_MATCH_VERSION } from '../utils/resume/jobMatchEngineV3.js';
import { compileBullet, quantificationPrompts, COMPILER_VERSION } from '../utils/resume/bulletCompiler.js';
import { simulateAtsParse, measureParseIntegrity } from '../utils/resume/atsParseSimulator.js';
import { certifyAllTemplates } from '../utils/resume/templateCertification.js';
import { assembleMasterProfile, seedResumeDocument, buildEvidenceIndex, detectEvidenceOpportunities } from '../utils/resume/masterProfileEngine.js';
import { buildCollegeResumeOverview } from '../utils/resume/collegeResumeOverview.js';
import { structuredFromText } from '../../web/src/lib/resumeDataModel.js';

const ENGINE_VERSIONS = Object.freeze({
  document: RESUME_DOCUMENT_VERSION, truth: TRUTH_ENGINE_VERSION, ats: ATS_ENGINE_VERSION,
  jdParser: JD_PARSER_VERSION, jobMatch: JOB_MATCH_VERSION, compiler: COMPILER_VERSION,
});

const atsAuditSchema = z.object({
  text: z.string().max(60000).default(''),
  structure: z.object({
    usesTables: z.boolean().optional(),
    usesColumns: z.boolean().optional(),
    usesImages: z.boolean().optional(),
    usesTextBoxes: z.boolean().optional(),
    templateId: z.string().max(80).optional(),
    atsSafeTemplate: z.boolean().optional(),
  }).passthrough().optional().default({}),
}).passthrough();

const evidenceGapsSchema = z.object({
  targetRole: z.string().max(160).optional().default(''),
  resumeText: z.string().max(60000).optional().default(''),
  verifiedSkills: z.array(z.string().max(80)).max(200).optional().default([]),
  resumeSkills: z.array(z.string().max(80)).max(300).optional().default([]),
  provenSkills: z.array(z.string().max(80)).max(200).optional().default([]),
  qualityChecks: z.array(z.object({}).passthrough()).max(20).optional().default([]),
  skillEvidence: z.array(z.object({}).passthrough()).max(80).optional().default([]),
  verifiedProjects: z.array(z.object({}).passthrough()).max(80).optional().default([]),
}).passthrough();

const jdMatchSchema = z.object({
  resumeText: z.string().max(60000).default(''),
  jobDescription: z.string().min(40, 'Paste the job description text (at least a few lines).').max(60000),
  targetRole: z.string().max(160).optional().default(''),
  verifiedSkills: z.array(z.string().max(80)).max(200).optional().default([]),
}).passthrough();

export function registerResumeOsRoutes(app, deps = {}) {
  const {
    requireAuth, currentUser, generationLimiter = (req, res, next) => next(), db = null,
    requireRole = null, requireCollegeScope = null, observe = null,
  } = deps;
  if (!requireAuth || !currentUser) throw new Error('resumeOsRoutes: requireAuth + currentUser required');
  const emit = (event, data = {}) => { try { observe?.(event, data); } catch { /* observability is never fatal */ } };

  const validate = (schema) => (req, res, next) => {
    const r = schema.safeParse(req.body || {});
    if (!r.success) {
      return res.status(400).json({ ok: false, error: 'invalid_input', details: r.error.issues.slice(0, 5).map((i) => i.message) });
    }
    req.body = r.data;
    next();
  };

  /* ============ POST /api/resume/ats-audit ============ */
  app.post('/api/resume/ats-audit', requireAuth, validate(atsAuditSchema), (req, res) => {
    try {
      const { text, structure } = req.body;
      const audit = auditAtsCompatibility({ text, structure });
      res.json({ ok: true, audit });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'ats_audit_failed', message: err.message });
    }
  });

  /* ============ POST /api/resume/jd-match ============ */
  app.post('/api/resume/jd-match', requireAuth, generationLimiter, validate(jdMatchSchema), async (req, res) => {
    try {
      const { resumeText, jobDescription, targetRole, verifiedSkills } = req.body;
      const u = currentUser(req) || {};
      // Server-verified skills (verified project submissions only — pending
      // never counts) merged with the client's verified list. Annotation
      // only: verification never changes matched/weak/missing membership.
      const serverVerified = await resolveVerifiedSkills({ db, userId: u.id, email: u.email });
      const allVerified = Array.from(new Set([...serverVerified, ...verifiedSkills]));
      const match = matchResumeToJD({ resumeText, jobDescription, targetRole, verifiedSkills: allVerified });
      res.json({ ok: true, match, verifiedSource: { server: serverVerified.length, client: verifiedSkills.length }, db: db?.dbEnabled?.() || false });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'jd_match_failed', message: err.message });
    }
  });

  /* ============ POST /api/resume/evidence-gaps ============
     Resume OS V2 — the three recommendation types (evidence exists /
     wording weak / evidence missing), each with provenance and a CTA.
     Deterministic; db-optional: server signals (verified skills, GitHub
     proof, target role) merge with anything the client sends, so the
     classification works — honestly reduced — without a database. */
  app.post('/api/resume/evidence-gaps', requireAuth, validate(evidenceGapsSchema), async (req, res) => {
    try {
      const u = currentUser(req) || {};
      const body = req.body;
      let server = { targetRole: '', verifiedSkills: [], resumeSkills: [], provenSkills: [] };
      if (db?.dbEnabled?.() && db.roleReadinessInputsFor) {
        try { server = await db.roleReadinessInputsFor({ userId: u.id, email: u.email }); } catch { /* degrade */ }
      }
      const uniq = (a) => Array.from(new Set(a.filter(Boolean)));
      const qualityChecks = body.resumeText
        ? buildQualityChecks({ raw: body.resumeText, norm: body.resumeText.toLowerCase() })
        : (body.qualityChecks || []);
      const gaps = classifyResumeEvidenceGaps({
        targetRole: body.targetRole || server.targetRole || '',
        verifiedSkills: uniq([...(server.verifiedSkills || []), ...body.verifiedSkills]),
        resumeSkills: uniq([...(server.resumeSkills || []), ...body.resumeSkills]),
        provenSkills: uniq([...(server.provenSkills || []), ...body.provenSkills]),
        qualityChecks,
        skillEvidence: body.skillEvidence,
        verifiedProjects: body.verifiedProjects,
      });
      res.json({ ok: true, ...gaps, db: db?.dbEnabled?.() || false });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'evidence_gaps_failed', message: err.message });
    }
  });

  /* ============================================================
     RESUME OS V3 — canonical document APIs. All scoring/matching
     is server-owned + deterministic; the client only renders.
     ============================================================ */
  const dbOn = () => !!db?.dbEnabled?.();
  const userOf = (req) => currentUser(req) || {};

  /* Shared truth context loader (db-optional; degrades honestly). */
  async function truthContext(req) {
    const u = userOf(req);
    if (!dbOn() || !db.masterProfileInputsFor) {
      return { verifiedSkills: [], profileSkills: [], master: null, evidenceIndex: null, verifiedProjectIds: [] };
    }
    const inputs = await db.masterProfileInputsFor({ userId: u.id, email: u.email });
    const master = assembleMasterProfile(inputs);
    return {
      verifiedSkills: master.skills.filter((s) => s.status === 'VERIFIED').map((s) => s.name),
      profileSkills: master.skills.map((s) => s.name),
      verifiedProjectIds: master.projects.filter((p) => p.verified).map((p) => p.sourceProjectId).filter(Boolean),
      evidenceIndex: buildEvidenceIndex(master),
      master,
    };
  }

  const docSchema = z.object({ doc: z.object({}).passthrough() }).passthrough();
  const docIdSchema = z.object({ docId: z.string().min(1).max(80) }).passthrough();

  /* ---- master profile ---- */
  app.get('/api/resume-os/master-profile', requireAuth, async (req, res) => {
    try {
      const ctx = await truthContext(req);
      res.json({ ok: true, master: ctx.master, db: dbOn() });
    } catch (err) { res.status(500).json({ ok: false, error: 'master_profile_failed', message: err.message }); }
  });

  /* ---- documents CRUD ---- */
  app.get('/api/resume-os/documents', requireAuth, async (req, res) => {
    const u = userOf(req);
    const documents = dbOn() && db.listResumeDocuments ? await db.listResumeDocuments({ userId: u.id, email: u.email }) : [];
    res.json({ ok: true, documents, db: dbOn(), engineVersions: ENGINE_VERSIONS });
  });

  app.get('/api/resume-os/documents/:docId', requireAuth, async (req, res) => {
    const u = userOf(req);
    const doc = dbOn() && db.getResumeDocument ? await db.getResumeDocument({ userId: u.id, email: u.email, docId: req.params.docId }) : null;
    if (!doc) return res.status(dbOn() ? 404 : 200).json({ ok: false, error: 'not_found', db: dbOn() });
    res.json({ ok: true, doc, db: dbOn() });
  });

  app.post('/api/resume-os/documents', requireAuth, validate(docSchema), async (req, res) => {
    try {
      const u = userOf(req);
      const doc = normalizeResumeDocument({ ...req.body.doc, userId: u.id || u.email || '' });
      doc.updatedAt = new Date().toISOString();
      if (!doc.createdAt) doc.createdAt = doc.updatedAt;
      const result = dbOn() && db.saveResumeDocument
        ? await db.saveResumeDocument({ userId: u.id, email: u.email, doc, engineVersions: ENGINE_VERSIONS })
        : { ok: false, reason: 'db_disabled' };
      emit('resume.saved', { docId: doc.id, kind: doc.kind });
      res.json({ ok: true, doc, persisted: result.ok, db: dbOn(), result });
    } catch (err) { res.status(500).json({ ok: false, error: 'save_failed', message: err.message }); }
  });

  app.delete('/api/resume-os/documents/:docId', requireAuth, async (req, res) => {
    const u = userOf(req);
    const result = dbOn() && db.deleteResumeDocument ? await db.deleteResumeDocument({ userId: u.id, email: u.email, docId: req.params.docId }) : { ok: false, reason: 'db_disabled' };
    res.json({ ok: result.ok, db: dbOn(), result });
  });

  /* ---- create: onboarding seed (profile | import | blank) ---- */
  const createSchema = z.object({
    source: z.enum(['profile', 'import', 'blank']).default('profile'),
    title: z.string().max(140).optional().default(''),
    targetRole: z.string().max(120).optional().default(''),
    templateId: z.string().max(60).optional().default('atlas'),
    importText: z.string().max(60000).optional().default(''),
  }).passthrough();
  app.post('/api/resume-os/create', requireAuth, validate(createSchema), async (req, res) => {
    try {
      const u = userOf(req);
      const { source, title, targetRole, templateId, importText } = req.body;
      let doc;
      let importReview = null;
      if (source === 'profile') {
        const ctx = await truthContext(req);
        doc = ctx.master
          ? seedResumeDocument(ctx.master, { title, targetRole, templateId })
          : normalizeResumeDocument({ title: title || 'My Resume', targetRole, templateId });
      } else if (source === 'import') {
        const structured = structuredFromText(importText || '');
        const ctx = await truthContext(req);
        const vSet = new Set(ctx.verifiedSkills.map((s) => s.toLowerCase()));
        doc = fromStructuredResume(structured, { verifiedSkillSet: vSet });
        doc.title = title || doc.title;
        doc.targetRole = targetRole || doc.targetRole;
        doc.templateId = templateId;
        /* Never silently save uncertain extraction as truth — every imported
           bullet is userConfirmed:false and surfaced for review. */
        importReview = {
          detected: {
            name: doc.contact.name, email: doc.contact.email, phone: doc.contact.phone,
            experience: doc.experience.map((e) => ({ id: e.id, company: e.company, role: e.role, dates: e.dates })),
            projects: doc.projects.map((p) => ({ id: p.id, name: p.name })),
            skills: doc.skills.length,
          },
          note: 'Imported content needs your confirmation — nothing below is treated as verified.',
        };
      } else {
        doc = normalizeResumeDocument({ title: title || 'My Resume', targetRole, templateId });
      }
      doc.id = makeId('rd');
      doc.userId = u.id || u.email || '';
      doc.createdAt = doc.updatedAt = new Date().toISOString();
      if (dbOn() && db.saveResumeDocument) await db.saveResumeDocument({ userId: u.id, email: u.email, doc, engineVersions: ENGINE_VERSIONS });
      emit('resume.created', { docId: doc.id, source });
      res.json({ ok: true, doc, importReview, db: dbOn() });
    } catch (err) { res.status(500).json({ ok: false, error: 'create_failed', message: err.message }); }
  });

  /* ---- variants ---- */
  const variantSchema = z.object({
    docId: z.string().min(1).max(80),
    title: z.string().max(140).optional().default(''),
    targetRole: z.string().max(120).optional().default(''),
    targetJobId: z.string().max(80).optional().default(''),
    targetJobDescription: z.string().max(60000).optional().default(''),
    overrides: z.object({}).passthrough().nullable().optional().default(null),
  }).passthrough();
  app.post('/api/resume-os/variants', requireAuth, validate(variantSchema), async (req, res) => {
    try {
      const u = userOf(req);
      const base = dbOn() && db.getResumeDocument ? await db.getResumeDocument({ userId: u.id, email: u.email, docId: req.body.docId }) : null;
      if (!base) return res.status(404).json({ ok: false, error: 'not_found', db: dbOn() });
      const variant = normalizeResumeDocument({
        ...base,
        id: makeId('rd'),
        kind: 'variant', parentId: base.id || req.body.docId,
        title: req.body.title || `${base.title} — ${req.body.targetRole || 'Variant'}`,
        targetRole: req.body.targetRole || base.targetRole,
        targetJobId: req.body.targetJobId,
        targetJobDescription: req.body.targetJobDescription,
        overrides: req.body.overrides || base.overrides || null,
      });
      variant.createdAt = variant.updatedAt = new Date().toISOString();
      if (dbOn() && db.saveResumeDocument) await db.saveResumeDocument({ userId: u.id, email: u.email, doc: variant, engineVersions: ENGINE_VERSIONS });
      emit('resume.variant.created', { docId: variant.id, parentId: variant.parentId });
      res.json({ ok: true, doc: variant, db: dbOn() });
    } catch (err) { res.status(500).json({ ok: false, error: 'variant_failed', message: err.message }); }
  });

  /* ---- snapshots (meaningful versions only) ---- */
  const snapshotSchema = z.object({
    docId: z.string().min(1).max(80),
    trigger: z.enum(['manual', 'export', 'tailor', 'template_change', 'application']).default('manual'),
    note: z.string().max(200).optional().default(''),
    score: z.number().nullable().optional().default(null),
  }).passthrough();
  app.post('/api/resume-os/snapshots', requireAuth, validate(snapshotSchema), async (req, res) => {
    const u = userOf(req);
    const result = dbOn() && db.snapshotResumeDocument
      ? await db.snapshotResumeDocument({ userId: u.id, email: u.email, ...req.body })
      : { ok: false, reason: 'db_disabled' };
    res.json({ ok: result.ok, db: dbOn(), result });
  });
  app.post('/api/resume-os/snapshots/restore', requireAuth, validate(z.object({ docId: z.string().min(1).max(80), index: z.number().int().min(0).max(30) }).passthrough()), async (req, res) => {
    const u = userOf(req);
    const result = dbOn() && db.restoreResumeSnapshot
      ? await db.restoreResumeSnapshot({ userId: u.id, email: u.email, docId: req.body.docId, index: req.body.index })
      : { ok: false, reason: 'db_disabled' };
    res.json({ ok: result.ok, doc: result.doc ? normalizeResumeDocument(result.doc) : null, db: dbOn(), result });
  });

  /* ---- compile: the full deterministic pipeline in one call ----
     document -> truth audit -> ATS V3 (score + 50+ checks + fix center)
     -> optional JD parse + match -> ranking -> evidence opportunities
     -> next best action. Zero AI anywhere in this path. */
  const compileSchema = z.object({
    doc: z.object({}).passthrough(),
    jobDescription: z.string().max(60000).optional().default(''),
    persist: z.boolean().optional().default(false),
    atsSimulation: z.object({ integrity: z.number(), headingRecovery: z.number().optional() }).passthrough().nullable().optional().default(null),
  }).passthrough();
  app.post('/api/resume-os/compile', requireAuth, generationLimiter, validate(compileSchema), async (req, res) => {
    try {
      const u = userOf(req);
      const doc = normalizeResumeDocument(req.body.doc);
      const ctx = await truthContext(req);
      const jdText = req.body.jobDescription || doc.targetJobDescription || '';
      const jd = jdText.trim().length >= 40 ? parseJDv2({ jobDescription: jdText, targetRole: doc.targetRole }) : null;

      const truth = auditResumeTruth(doc, {
        verifiedSkills: ctx.verifiedSkills, profileSkills: ctx.profileSkills,
        verifiedProjectIds: ctx.verifiedProjectIds, evidenceIndex: ctx.evidenceIndex,
      });
      const health = scoreResumeDocument(doc, {
        targetRole: doc.targetRole, jd, verifiedSkills: ctx.verifiedSkills,
        profileSkills: ctx.profileSkills, atsSimulation: req.body.atsSimulation,
      });
      const match = jd ? matchDocumentToJD(doc, jd, { verifiedSkills: ctx.verifiedSkills, targetRole: doc.targetRole }) : null;
      const ranking = rankContentForTarget(doc, { jd, targetRole: doc.targetRole, verifiedSkills: ctx.verifiedSkills });
      const opportunities = ctx.master ? detectEvidenceOpportunities(doc, ctx.master) : [];

      /* Deterministic Resume Next Best Action — one highest-value move. */
      const nba = pickResumeNextBestAction({ truth, health, match, opportunities });

      if (req.body.persist && dbOn() && db.saveResumeDocument) {
        await db.saveResumeDocument({
          userId: u.id, email: u.email, doc,
          lastScore: health.score, lastJdMatch: match?.overall ?? null, engineVersions: ENGINE_VERSIONS,
        });
      }
      emit('resume.score.calculated', { docId: doc.id, score: health.score });
      if (match) emit('resume.jd_matched', { docId: doc.id, match: match.overall });

      res.json({
        ok: true,
        engineVersions: ENGINE_VERSIONS,
        truth, health, jd, match, ranking, opportunities, nextBestAction: nba,
        db: dbOn(),
      });
    } catch (err) { res.status(500).json({ ok: false, error: 'compile_failed', message: err.message }); }
  });

  /* ---- deterministic tailoring proposal (non-destructive) ---- */
  const tailorSchema = z.object({
    doc: z.object({}).passthrough(),
    jobDescription: z.string().max(60000).optional().default(''),
    maxBulletsPerItem: z.number().int().min(2).max(8).optional().default(4),
    maxProjects: z.number().int().min(1).max(8).optional().default(4),
  }).passthrough();
  app.post('/api/resume-os/tailor-v3', requireAuth, generationLimiter, validate(tailorSchema), async (req, res) => {
    try {
      const doc = normalizeResumeDocument(req.body.doc);
      const ctx = await truthContext(req);
      const jdText = req.body.jobDescription || doc.targetJobDescription || '';
      const jd = jdText.trim().length >= 40 ? parseJDv2({ jobDescription: jdText, targetRole: doc.targetRole }) : null;
      const ranking = rankContentForTarget(doc, { jd, targetRole: doc.targetRole, verifiedSkills: ctx.verifiedSkills });
      const proposal = proposeTailoredSelection(doc, ranking, { maxBulletsPerItem: req.body.maxBulletsPerItem, maxProjects: req.body.maxProjects });
      res.json({ ok: true, ranking, proposal, jd, db: dbOn() });
    } catch (err) { res.status(500).json({ ok: false, error: 'tailor_v3_failed', message: err.message }); }
  });

  /* ---- deterministic bullet compiler + quantification prompts ---- */
  app.post('/api/resume-os/bullet/compile', requireAuth, validate(z.object({ facts: z.object({}).passthrough() }).passthrough()), (req, res) => {
    const result = compileBullet(req.body.facts || {});
    res.json({ ok: result.ok, result });
  });
  app.post('/api/resume-os/bullet/quantify', requireAuth, validate(z.object({ text: z.string().max(600) }).passthrough()), (req, res) => {
    res.json({ ok: true, prompts: quantificationPrompts(req.body.text || '') });
  });

  /* ---- ATS parse simulation (render round-trip) ---- */
  const simSchema = z.object({
    doc: z.object({}).passthrough(),
    pagesHtml: z.array(z.string().max(400000)).max(12).optional(),
    extractedText: z.string().max(120000).optional(),
  }).passthrough();
  app.post('/api/resume-os/ats-simulate', requireAuth, validate(simSchema), (req, res) => {
    try {
      const doc = normalizeResumeDocument(req.body.doc);
      const sim = req.body.extractedText
        ? measureParseIntegrity(doc, req.body.extractedText)
        : simulateAtsParse(doc, req.body.pagesHtml || []);
      res.json({ ok: true, simulation: sim });
    } catch (err) { res.status(500).json({ ok: false, error: 'ats_simulate_failed', message: err.message }); }
  });

  /* ---- template certification report ---- */
  app.get('/api/resume-os/templates/certification', requireAuth, (req, res) => {
    try { res.json({ ok: true, certification: certifyAllTemplates() }); }
    catch (err) { res.status(500).json({ ok: false, error: 'certification_failed', message: err.message }); }
  });

  /* ---- plain-text export helper (canonical, ATS-readable) ---- */
  app.post('/api/resume-os/export/text', requireAuth, validate(docSchema), (req, res) => {
    try {
      const doc = normalizeResumeDocument(req.body.doc);
      emit('resume.exported', { docId: doc.id, format: 'txt' });
      res.json({ ok: true, text: toPlainText(doc) });
    } catch (err) { res.status(500).json({ ok: false, error: 'export_text_failed', message: err.message }); }
  });

  /* ---- college observability (aggregate only, tenant-scoped) ---- */
  if (requireRole && requireCollegeScope) {
    const collegeScopeFromQuery = (req) => req.query.collegeId || req.body?.collegeId || null;
    app.get('/api/resume-os/college/overview', requireAuth, requireRole('college_admin', 'admin'), requireCollegeScope(collegeScopeFromQuery), async (req, res) => {
      try {
        const collegeId = req.query.collegeId;
        const signals = dbOn() && db.listCollegeResumeSignals ? await db.listCollegeResumeSignals({ collegeId }) : [];
        res.json({ ok: true, overview: buildCollegeResumeOverview(signals), db: dbOn() });
      } catch (err) { res.status(500).json({ ok: false, error: 'college_resume_overview_failed', message: err.message }); }
    });
  }
}

/* One highest-value action — mirrors the platform NBA philosophy:
   critical truth issue > critical parser/contact check > provable-but-absent
   evidence > required-JD gap > highest-impact fix. Deterministic ordering. */
export function pickResumeNextBestAction({ truth, health, match, opportunities }) {
  const criticalTruth = (truth?.findings || []).find((f) => f.severity === 'critical');
  if (criticalTruth) {
    return { type: 'fix_truth_issue', priority: 'critical', label: criticalTruth.message, action: criticalTruth.recommendedAction, cta: { panel: 'fixes' } };
  }
  const criticalCheck = (health?.fixCenter?.critical || [])[0];
  if (criticalCheck) {
    return { type: 'fix_critical_check', priority: 'critical', label: criticalCheck.message, action: criticalCheck.recommendedAction, scoreImpact: criticalCheck.scoreImpact, cta: { panel: 'fixes' } };
  }
  const provable = (match?.missing || []).find((m) => m.provable) || (opportunities || [])[0];
  if (provable) {
    return {
      type: 'add_verified_evidence', priority: 'high',
      label: provable.skill ? `Add ${provable.skill} — verified evidence exists but the resume never shows it.` : provable.label,
      action: 'Open the Evidence panel and add it in one click.', cta: { panel: 'evidence' },
    };
  }
  const requiredGap = (match?.missing || []).find((m) => m.tier === 'required');
  if (requiredGap) {
    return {
      type: 'build_evidence', priority: 'high',
      label: `${requiredGap.skill} is required by this job and you have no evidence yet.`,
      action: 'Build it — Project OS will create a verified project for exactly this gap.',
      cta: { view: 'projectstudio', context: { targetSkill: requiredGap.skill, reason: 'resume_gap' } },
    };
  }
  const top = (health?.topImprovements || [])[0];
  if (top) return { type: 'highest_impact_fix', priority: 'medium', label: top.message, action: top.action, scoreImpact: top.scoreImpact, cta: { panel: 'fixes' } };
  return { type: 'ready', priority: 'info', label: 'No blocking issues — tailor this resume to an active job next.', action: 'Paste a job description in the Target panel.', cta: { panel: 'target' } };
}

export default { registerResumeOsRoutes };
