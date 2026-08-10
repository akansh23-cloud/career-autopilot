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
  const { requireAuth, currentUser, generationLimiter = (req, res, next) => next(), db = null } = deps;
  if (!requireAuth || !currentUser) throw new Error('resumeOsRoutes: requireAuth + currentUser required');

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
}

export default { registerResumeOsRoutes };
