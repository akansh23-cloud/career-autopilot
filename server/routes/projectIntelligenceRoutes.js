/* ============================================================
   Routes — Project Intelligence OS  (/api/project-intelligence/*)
   ------------------------------------------------------------
   Mounted from server.js via one import + one call. Every route
   requires the app's existing auth (requireAuth) and is
   user-scoped. The engine is DETERMINISTIC: no AI key, DB or
   network is required for any route to work — output is produced
   from the profile signals passed in the request body (the client
   already holds profile/resume/projects/github state). When an
   AI key is present the client may additionally call the existing
   /api/creator/* endpoints to enrich prose; nothing here breaks
   without it. Nothing here throws to the client; failures degrade.
   ============================================================ */
import { z } from 'zod';
import { pjConfig, resolveActiveProvider, PROJECT_INTELLIGENCE_DISCLAIMER, DIFFICULTIES } from '../services/projectIntelligence/config.js';
import { matchProjects } from '../services/projectIntelligence/projectGapMatchingService.js';
import { whyBuildThis } from '../services/projectIntelligence/whyBuildService.js';
import { explainProject } from '../services/projectIntelligence/projectExplainerService.js';
import { generateDiagrams } from '../services/projectIntelligence/projectDiagramService.js';
import { estimateFeasibility } from '../services/projectIntelligence/feasibilityService.js';
import { proofChecklist } from '../services/projectIntelligence/proofChecklistService.js';
import { buildBlueprintV2 } from '../services/projectIntelligence/buildBlueprintService.js';
import { taskBoard } from '../services/projectIntelligence/taskBoardService.js';
import { resumeOutput } from '../services/projectIntelligence/resumeOutputService.js';
import { detectDuplicate } from '../services/projectIntelligence/projectMemoryService.js';
import { importInnovationProject } from '../services/projectIntelligence/innovationBridgeService.js';
import { buildProjectBrief } from '../services/projectBrief/projectBriefService.js';
import { detectDiscipline } from '../services/projectBrief/disciplineProfiles.js';

const projectLike = z.object({}).passthrough();
const recommendationLike = z.object({}).passthrough();

const recommendSchema = z.object({
  userProfile: z.any().optional().default({}),
  targetRole: z.string().trim().max(120).optional().default(''),
  resumeAnalysis: z.any().optional().default({}),
  verifiedSkills: z.array(z.string().trim().max(60)).max(80).optional().default([]),
  claimedSkills: z.array(z.string().trim().max(60)).max(120).optional().default([]),
  githubProof: z.any().optional().default({}),
  savedJobs: z.any().optional().default([]),
  existingProjects: z.array(z.any()).max(200).optional().default([]),
  patentInnovationClusters: z.array(z.any()).max(60).optional().default([]),
  goal: z.string().trim().max(120).optional().default(''),
  max: z.number().int().min(1).max(12).optional(),
}).passthrough();

const enrichSchema = z.object({
  project: projectLike.optional().default({}),
  recommendation: recommendationLike.optional().default({}),
  explainer: z.any().optional().default({}),
  gapSummary: z.any().optional().default({}),
  proofBreakdown: z.any().optional().default(null),
  evidence: z.any().optional().default({}),
}).passthrough();

const similarSchema = z.object({
  candidate: projectLike.optional().default({}),
  existingProjects: z.array(z.any()).max(200).optional().default([]),
  threshold: z.number().min(0).max(1).optional(),
}).passthrough();

const importSchema = z.object({
  source: z.any().optional().default({}),
  existingProjects: z.array(z.any()).max(200).optional().default([]),
}).passthrough();

export function registerProjectIntelligenceRoutes(app, deps = {}) {
  const { requireAuth, currentUser, generationLimiter = (req, res, next) => next() } = deps;
  if (!requireAuth || !currentUser) throw new Error('projectIntelligenceRoutes: requireAuth + currentUser required');

  const cfg = () => pjConfig();
  const validate = (schema) => (req, res, next) => {
    const r = schema.safeParse(req.body || {});
    if (!r.success) return res.status(400).json({ ok: false, error: 'invalid_request', issues: r.error.issues.slice(0, 8).map((i) => ({ path: i.path.join('.'), message: i.message })) });
    req.body = r.data; next();
  };

  // Feature flag guard: when disabled, every route 404s cleanly. Never throws.
  const guard = (handler) => async (req, res) => {
    if (!cfg().enabled) return res.status(404).json({ ok: false, error: 'feature_disabled', message: 'Project Intelligence is disabled (PROJECT_INTELLIGENCE_ENABLED=0).' });
    try { return await handler(req, res); }
    catch (err) { console.error('[project-intelligence]', req.path, err && err.message); return res.status(200).json({ ok: false, error: 'internal', message: 'Something went wrong; running in limited mode.', mode: 'error' }); }
  };

  const mode = () => (resolveActiveProvider(cfg()) === 'fallback' ? 'deterministic' : 'deterministic+ai-available');

  /* ---- config / capabilities ---- */
  app.get('/api/project-intelligence/config', requireAuth, guard(async (req, res) => {
    const c = cfg();
    res.json({
      ok: true,
      enabled: c.enabled,
      mode: mode(),
      aiProvider: resolveActiveProvider(c),
      aiAvailable: resolveActiveProvider(c) !== 'fallback',
      difficulties: DIFFICULTIES,
      maxRecommendations: c.maxRecommendations,
      capabilities: ['recommend', 'why-build', 'explain', 'blueprint', 'diagrams', 'feasibility', 'proof-checklist', 'task-board', 'resume-output', 'similar', 'import-innovation-project'],
      disclaimer: PROJECT_INTELLIGENCE_DISCLAIMER,
    });
  }));

  /* ---- Task 1: gap-driven recommendations ---- */
  app.post('/api/project-intelligence/recommend', requireAuth, generationLimiter, validate(recommendSchema), guard(async (req, res) => {
    const out = matchProjects(req.body, { max: req.body.max || cfg().maxRecommendations });
    res.json({ ok: true, mode: mode(), ...out, disclaimer: PROJECT_INTELLIGENCE_DISCLAIMER });
  }));

  /* ---- Task 2: why build this ---- */
  app.post('/api/project-intelligence/why-build', requireAuth, generationLimiter, validate(enrichSchema), guard(async (req, res) => {
    res.json({ ok: true, mode: mode(), whyBuild: whyBuildThis(req.body) });
  }));

  /* ---- Task 3: explain this project ---- */
  app.post('/api/project-intelligence/explain', requireAuth, generationLimiter, validate(enrichSchema), guard(async (req, res) => {
    res.json({ ok: true, mode: mode(), explanation: explainProject(req.body) });
  }));

  /* ---- Project brief: "what am I actually building?" ----
     AI-written prose (Gemini / Anthropic / OpenAI, whichever is configured)
     over a deterministic, discipline-aware skeleton. Degrades to a complete
     templated brief with no key set — `generatedBy` always says which. */
  app.post('/api/project-intelligence/brief', requireAuth, generationLimiter, validate(enrichSchema), guard(async (req, res) => {
    const project = req.body?.project || req.body?.recommendation || req.body || {};
    const brief = await buildProjectBrief({ project, audience: req.body?.audience || 'student' });
    res.json({ ok: true, mode: mode(), brief });
  }));

  /* ---- Discipline probe: cheap, deterministic, no AI ---- */
  app.post('/api/project-intelligence/discipline', requireAuth, validate(enrichSchema), guard(async (req, res) => {
    const project = req.body?.project || req.body?.recommendation || req.body || {};
    const d = detectDiscipline(project);
    res.json({ ok: true, discipline: { id: d.id, label: d.label, confidence: d.confidence, buildUnit: d.buildUnit, toolchain: d.toolchain, runMeans: d.runMeans } });
  }));

  /* ---- Task 6: build blueprint v2 ---- */
  app.post('/api/project-intelligence/blueprint', requireAuth, generationLimiter, validate(enrichSchema), guard(async (req, res) => {
    res.json({ ok: true, mode: mode(), blueprint: buildBlueprintV2(req.body) });
  }));

  /* ---- Task 4: project-specific diagrams ---- */
  app.post('/api/project-intelligence/diagrams', requireAuth, generationLimiter, validate(enrichSchema), guard(async (req, res) => {
    const { model, diagrams } = generateDiagrams(req.body);
    res.json({ ok: true, mode: mode(), diagrams, model });
  }));

  /* ---- Task 5: feasibility / cost / team / time ---- */
  app.post('/api/project-intelligence/feasibility', requireAuth, generationLimiter, validate(enrichSchema), guard(async (req, res) => {
    res.json({ ok: true, mode: mode(), feasibility: estimateFeasibility(req.body) });
  }));

  /* ---- Task 8: proof checklist ---- */
  app.post('/api/project-intelligence/proof-checklist', requireAuth, validate(enrichSchema), guard(async (req, res) => {
    res.json({ ok: true, mode: mode(), proofChecklist: proofChecklist(req.body) });
  }));

  /* ---- Task 7: github task board ---- */
  app.post('/api/project-intelligence/task-board', requireAuth, generationLimiter, validate(enrichSchema), guard(async (req, res) => {
    res.json({ ok: true, mode: mode(), taskBoard: taskBoard(req.body) });
  }));

  /* ---- Task 9: evidence-backed resume output ---- */
  app.post('/api/project-intelligence/resume-output', requireAuth, generationLimiter, validate(enrichSchema), guard(async (req, res) => {
    res.json({ ok: true, mode: mode(), resume: resumeOutput(req.body) });
  }));

  /* ---- Task 10: duplicate / similar detection ----
     POST because the client holds project state (no DB persistence in this
     phase). A GET alias documents usage for discoverability. */
  app.post('/api/project-intelligence/similar', requireAuth, validate(similarSchema), guard(async (req, res) => {
    const result = detectDuplicate(req.body.candidate, req.body.existingProjects, { threshold: req.body.threshold });
    res.json({ ok: true, mode: mode(), ...result });
  }));
  app.get('/api/project-intelligence/similar', requireAuth, guard(async (req, res) => {
    const candidate = { title: req.query.title || '', problemStatement: req.query.q || '' };
    res.json({ ok: true, mode: mode(), candidate, note: 'POST { candidate, existingProjects } for a real similarity check — the client holds your project list.' });
  }));

  /* ---- Task 11: import an innovation-grade project ---- */
  app.post('/api/project-intelligence/import-innovation-project', requireAuth, generationLimiter, validate(importSchema), guard(async (req, res) => {
    const result = importInnovationProject(req.body);
    res.json({ ok: true, mode: mode(), ...result, persistVia: 'client-project-store', disclaimer: PROJECT_INTELLIGENCE_DISCLAIMER });
  }));
}

export default { registerProjectIntelligenceRoutes };
