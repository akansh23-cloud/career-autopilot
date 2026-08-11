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
import { sanitizeDocumentTrust, TRUST_BOUNDARY_VERSION } from '../utils/resume/trustBoundary.js';
import { compileSummary, SUMMARY_COMPILER_VERSION } from '../utils/resume/summaryCompiler.js';
import { planContentBudget, buildAutoFitPlan, budgetForTemplate, CONTENT_BUDGET_VERSION } from '../utils/resume/contentBudget.js';
import { rankTemplates, TEMPLATE_RECOMMENDER_VERSION } from '../utils/resume/templateRecommender.js';
import { assistRewrite, makeAnthropicWritingProvider, WRITING_PROVIDERS_VERSION } from '../utils/resume/writingProviders.js';
import { renderResumeDocx, DOCX_WRITER_VERSION } from '../utils/docxWriter.js';
import { makeRuntimeTemplateCatalog, SERVER_RUNTIME_TEMPLATE_CATALOG_VERSION } from '../utils/templateOs/runtimeCatalog.js';

const ENGINE_VERSIONS = Object.freeze({
  document: RESUME_DOCUMENT_VERSION, truth: TRUTH_ENGINE_VERSION, ats: ATS_ENGINE_VERSION,
  jdParser: JD_PARSER_VERSION, jobMatch: JOB_MATCH_VERSION, compiler: COMPILER_VERSION,
  trustBoundary: TRUST_BOUNDARY_VERSION, summary: SUMMARY_COMPILER_VERSION,
  contentBudget: CONTENT_BUDGET_VERSION, templateRecommender: TEMPLATE_RECOMMENDER_VERSION,
  writingProviders: WRITING_PROVIDERS_VERSION, docx: DOCX_WRITER_VERSION,
  runtimeTemplateCatalog: SERVER_RUNTIME_TEMPLATE_CATALOG_VERSION,
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
  /* Phase 18: recommendations/tailoring/export resolve the same published
     runtime catalog AND honor an exact templateVersion when a ResumeDocument
     is pinned. Legacy documents without a pin resolve latest once, then the
     authoritative save path persists that exact version. */
  const runtimeTemplates = makeRuntimeTemplateCatalog(db, () => !!process.env.MONGODB_URI);

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
      /* TRUST BOUNDARY V2: what gets persisted is server-truth, never client
         flags — verified markers are recomputed from the evidence store. */
      const ctx = await truthContext(req);
      const trust = sanitizeDocumentTrust({ ...req.body.doc, userId: u.id || u.email || '' }, ctx);
      let doc = trust.doc;
      const pin = await runtimeTemplates.pinDocument(doc, { strictExisting: true });
      if (!pin.ok) return res.status(409).json({ ok: false, error: pin.error, templateId: pin.templateId, templateVersion: pin.templateVersion });
      doc = normalizeResumeDocument(pin.pinned);
      doc.updatedAt = new Date().toISOString();
      if (!doc.createdAt) doc.createdAt = doc.updatedAt;
      const result = dbOn() && db.saveResumeDocument
        ? await db.saveResumeDocument({ userId: u.id, email: u.email, doc, engineVersions: ENGINE_VERSIONS })
        : { ok: false, reason: 'db_disabled' };
      emit('resume.saved', { docId: doc.id, kind: doc.kind });
      res.json({ ok: true, doc, trust: { changes: trust.changes, version: trust.version }, persisted: result.ok, db: dbOn(), result });
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
    templateVersion: z.number().int().min(1).optional().nullable().default(null),
    importText: z.string().max(60000).optional().default(''),
  }).passthrough();
  app.post('/api/resume-os/create', requireAuth, validate(createSchema), async (req, res) => {
    try {
      const u = userOf(req);
      const { source, title, targetRole, templateId, templateVersion, importText } = req.body;
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
      if (templateVersion) doc.templateVersion = templateVersion;
      const pin = await runtimeTemplates.pinDocument(doc, { strictExisting: !!templateVersion });
      if (!pin.ok) return res.status(409).json({ ok: false, error: pin.error, templateId: pin.templateId, templateVersion: pin.templateVersion });
      doc = normalizeResumeDocument(pin.pinned);
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
      const ctx = await truthContext(req);
      /* TRUST BOUNDARY V2: every verdict below runs on the sanitized doc. */
      const trust = sanitizeDocumentTrust(req.body.doc, ctx);
      let doc = trust.doc;
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
        const pin = await runtimeTemplates.pinDocument(doc, { strictExisting: true });
        if (!pin.ok) return res.status(409).json({ ok: false, error: pin.error, templateId: pin.templateId, templateVersion: pin.templateVersion });
        doc = normalizeResumeDocument(pin.pinned);
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
        doc, trust: { changes: trust.changes, version: trust.version },
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
      const ctx = await truthContext(req);
      const doc = sanitizeDocumentTrust(req.body.doc, ctx).doc;
      const jdText = req.body.jobDescription || doc.targetJobDescription || '';
      const jd = jdText.trim().length >= 40 ? parseJDv2({ jobDescription: jdText, targetRole: doc.targetRole }) : null;
      const ranking = rankContentForTarget(doc, { jd, targetRole: doc.targetRole, verifiedSkills: ctx.verifiedSkills });
      const proposal = proposeTailoredSelection(doc, ranking, { maxBulletsPerItem: req.body.maxBulletsPerItem, maxProjects: req.body.maxProjects });
      res.json({ ok: true, ranking, proposal, jd, db: dbOn() });
    } catch (err) { res.status(500).json({ ok: false, error: 'tailor_v3_failed', message: err.message }); }
  });

  /* ============================================================
     RESUME OS V4 — canonical zero-AI "Tailor for Job"
     One request produces the complete job package: sanitized trust,
     parsed JD, weighted match, ranked content, budgeted selection,
     deterministic summary candidates, template recommendation and a
     ready-to-apply VARIANT PROPOSAL. Everything is a proposal — the
     client applies on explicit Accept; nothing is silently written.
     ============================================================ */
  const tailorJobSchema = z.object({
    doc: z.object({}).passthrough(),
    jobDescription: z.string().min(40).max(60000),
    job: z.object({ company: z.string().max(200).optional(), title: z.string().max(200).optional() }).optional().default({}),
    pageTarget: z.number().int().min(1).max(2).optional().default(1),
    atsPreference: z.enum(['very-high', 'high', 'balanced']).optional().default('high'),
  }).passthrough();
  app.post('/api/resume-os/tailor-for-job', requireAuth, generationLimiter, validate(tailorJobSchema), async (req, res) => {
    try {
      const ctx = await truthContext(req);
      const trust = sanitizeDocumentTrust(req.body.doc, ctx);
      const master = trust.doc;
      const { jobDescription, job, pageTarget, atsPreference } = req.body;

      /* 1–5. parse + weight the JD (detects role, must-have vs preferred) */
      const jd = parseJDv2({ jobDescription, targetRole: master.targetRole });
      const targetRole = jd.detectedRole || master.targetRole || '';

      /* 6–12. compare profile + evidence, rank all content */
      const match = matchDocumentToJD(master, jd, { verifiedSkills: ctx.verifiedSkills, targetRole });
      const ranking = rankContentForTarget(master, { jd, targetRole, verifiedSkills: ctx.verifiedSkills });

      /* 17–18. rank the complete published runtime catalog for THIS document + target */
      const templateCatalog = await runtimeTemplates.listPublishedCards();
      const templateRanking = rankTemplates(templateCatalog, master, { targetRole, atsPreference, pageTarget });
      const templateId = templateRanking.best?.id || master.templateId;
      const template = await runtimeTemplates.resolve(templateId, templateRanking.best?.templateVersion || null);

      /* 12. choose content within the recommended template's budget */
      const budgetPlan = planContentBudget(master, ranking, template, { pageTarget });

      /* 13. deterministic summary candidates from facts only. Phase 19 feeds
         the selected template's actual summary capacity into the compiler. */
      const summary = compileSummary(master, {
        targetRole, verifiedSkills: ctx.verifiedSkills,
        maxChars: budgetPlan.summary?.maxChars,
      });
      let variantSummary = master.summary;
      const shouldCompileSummary = !String(master.summary || '').trim() || !!budgetPlan.summary?.overBudget;
      if (shouldCompileSummary && summary.ok && summary.candidates[0]?.text) {
        variantSummary = summary.candidates[0].text;
        if (budgetPlan.summary?.overBudget) {
          budgetPlan.decisions.unshift({
            action: 'replace_summary_for_fit', section: 'summary',
            reason: `The current summary exceeds the ${template?.name || 'selected template'} budget (${budgetPlan.summary.maxChars} chars). Proposed a shorter deterministic summary built only from confirmed resume facts.`,
          });
        }
      }

      /* variant proposal — non-destructive; master untouched */
      const variantDoc = normalizeResumeDocument({
        ...master,
        id: makeId('rd'),
        kind: 'variant', parentId: master.id,
        title: [job.company, job.title].filter(Boolean).join(' — ') || `${targetRole || 'Job'} variant`,
        targetRole, targetJobDescription: jobDescription,
        templateId,
        templateVersion: Number(template?.templateVersion || template?.definition?.version || 1),
        overrides: budgetPlan.overrides,
        summary: variantSummary,
      });

      /* 20–23. truth, health, coverage, gaps on the PROPOSED variant */
      const truth = auditResumeTruth(variantDoc, { verifiedSkills: ctx.verifiedSkills, profileSkills: ctx.profileSkills, verifiedProjectIds: ctx.verifiedProjectIds, evidenceIndex: ctx.evidenceIndex });
      const health = scoreResumeDocument(variantDoc, { targetRole, jd, verifiedSkills: ctx.verifiedSkills, profileSkills: ctx.profileSkills });
      const requiredTotal = (jd.required || []).length;
      const requiredMet = (match.strong || []).filter((x) => x.tier === 'required').length;
      const missingEvidence = (match.missing || []).filter((x) => x.tier === 'required');
      const evidenceCoverage = requiredTotal ? Math.round(((requiredTotal - missingEvidence.length) / requiredTotal) * 100) : 100;

      emit('resume.tailored_for_job', { docId: master.id, jobTitle: job.title || jd.jobTitle || '', match: match.overall });
      res.json({
        ok: true,
        engineVersions: ENGINE_VERSIONS,
        package: {
          job: { company: job.company || '', title: job.title || jd.jobTitle || '', detectedRole: targetRole },
          jobMatch: match.overall,
          atsHealth: health.score,
          evidenceCoverage,
          criticalRequirements: { met: requiredMet, total: requiredTotal },
          missingEvidence: missingEvidence.map((m2) => ({ skill: m2.skill, provable: !!m2.provable })),
          template: templateRanking.best,
          templateAlternatives: templateRanking.ranked.slice(1, 4),
          pageTarget,
        },
        variant: variantDoc,
        jd, match, ranking, budgetPlan, summary, truth, health, templateRanking,
        trust: { changes: trust.changes, version: trust.version },
        db: dbOn(),
      });
    } catch (err) { res.status(500).json({ ok: false, error: 'tailor_for_job_failed', message: err.message }); }
  });

  /* ---- deterministic summary compiler ---- */
  app.post('/api/resume-os/summary/compile', requireAuth, validate(docSchema), async (req, res) => {
    try {
      const ctx = await truthContext(req);
      const doc = sanitizeDocumentTrust(req.body.doc, ctx).doc;
      res.json({ ok: true, summary: compileSummary(doc, { targetRole: req.body.targetRole || doc.targetRole, verifiedSkills: ctx.verifiedSkills, domain: req.body.domain || '' }) });
    } catch (err) { res.status(500).json({ ok: false, error: 'summary_failed', message: err.message }); }
  });

  /* ---- template recommendation (explainable, deterministic) ---- */
  app.post('/api/resume-os/templates/recommend', requireAuth, validate(docSchema), async (req, res) => {
    try {
      const ctx = await truthContext(req);
      const doc = sanitizeDocumentTrust(req.body.doc, ctx).doc;
      const cert = certifyAllTemplates();
      const catalog = await runtimeTemplates.listPublishedCards();
      const withCert = catalog.map((t) => ({
        ...t,
        certification: t.certification || { certified: cert.certified.includes(t.id) },
      }));
      res.json({ ok: true, recommendation: rankTemplates(withCert, doc, { targetRole: req.body.targetRole || doc.targetRole, atsPreference: req.body.atsPreference || 'high', pageTarget: req.body.pageTarget || 1 }), catalogVersion: runtimeTemplates.version });
    } catch (err) { res.status(500).json({ ok: false, error: 'recommend_failed', message: err.message }); }
  });

  /* ---- auto-fit plan (deterministic overflow resolution) ---- */
  app.post('/api/resume-os/autofit', requireAuth, validate(docSchema), async (req, res) => {
    try {
      const ctx = await truthContext(req);
      const doc = sanitizeDocumentTrust(req.body.doc, ctx).doc;
      const jdText = req.body.jobDescription || doc.targetJobDescription || '';
      const jd = jdText.trim().length >= 40 ? parseJDv2({ jobDescription: jdText, targetRole: doc.targetRole }) : null;
      const ranking = rankContentForTarget(doc, { jd, targetRole: doc.targetRole, verifiedSkills: ctx.verifiedSkills });
      const template = await runtimeTemplates.resolve(doc.templateId, doc.templateVersion, { strictVersion: !!doc.templateVersion });
      if (!template) return res.status(409).json({ ok: false, error: 'template_version_unavailable', templateId: doc.templateId, templateVersion: doc.templateVersion });
      const budgetPlan = planContentBudget(doc, ranking, template, { pageTarget: req.body.pageTarget || 1 });
      const plan = buildAutoFitPlan({
        overflowLines: Number(req.body.overflowLines) || 0,
        density: doc.density, pageTarget: req.body.pageTarget || 1,
        duplicates: req.body.duplicates || [], ranking, doc, budgetPlan,
      });
      res.json({ ok: true, plan, budgetPlan, budget: budgetForTemplate(template) });
    } catch (err) { res.status(500).json({ ok: false, error: 'autofit_failed', message: err.message }); }
  });

  /* ============================================================
     OPTIONAL AI ASSIST — wording only, truth-gated, never required
     Deterministic candidates are always returned; AI candidates are
     returned ONLY when the user opted in AND each one passed the
     truth gate. Rejected AI output is counted, never shown as
     applyable. AI failure degrades to deterministic-only.
     ============================================================ */
  const assistSchema = z.object({
    kind: z.enum(['bullet', 'summary', 'concise', 'alternatives']).default('bullet'),
    text: z.string().min(1).max(2000),
    facts: z.object({}).passthrough().nullish(),
    jdSkills: z.array(z.string().max(80)).max(20).optional().default([]),
    allowedSkills: z.array(z.string().max(80)).max(200).optional().default([]),
    useAi: z.boolean().optional().default(false),
  }).passthrough();
  app.post('/api/resume-os/assist', requireAuth, generationLimiter, validate(assistSchema), async (req, res) => {
    try {
      const aiProvider = process.env.ANTHROPIC_API_KEY
        ? makeAnthropicWritingProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.AI_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5' })
        : null;
      const result = await assistRewrite({
        kind: req.body.kind, text: req.body.text, facts: req.body.facts || null,
        jdSkills: req.body.jdSkills, allowedSkills: req.body.allowedSkills,
        useAi: !!req.body.useAi, aiProvider,
      });
      res.json({ ok: true, result });
    } catch (err) { res.status(500).json({ ok: false, error: 'assist_failed', message: err.message }); }
  });

  /* ---- REAL DOCX export (WordprocessingML, editable) ---- */
  app.post('/api/resume-os/export/docx', requireAuth, validate(docSchema), async (req, res) => {
    try {
      const ctx = await truthContext(req);
      const doc = sanitizeDocumentTrust(req.body.doc, ctx).doc;
      const template = await runtimeTemplates.resolve(doc.templateId, doc.templateVersion, { strictVersion: !!doc.templateVersion });
      if (!template) return res.status(409).json({ ok: false, error: 'template_version_unavailable', templateId: doc.templateId, templateVersion: doc.templateVersion });
      const buf = await renderResumeDocx(doc, template);
      const name = String(doc.title || 'resume').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'resume';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.docx"`);
      res.send(buf);
    } catch (err) { res.status(500).json({ ok: false, error: 'docx_failed', message: err.message }); }
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
