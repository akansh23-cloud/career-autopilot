/* ============================================================
   Routes — Guided Project Workspace v1  (/api/workspace/*)
   ------------------------------------------------------------
   Deterministic workspace plan generation, task tracking,
   honest verification (v1: local/manual only — GitHub and
   deployment verification are "coming next"), template-based
   starter-code preview, and Starter Pack ZIP generation.

   No AI key required. Persistence is best-effort: when the DB
   is disabled every endpoint still works — the client sends its
   own copy of the plan (workspacePlan in body) and mirrors it
   into project state, so the feature degrades gracefully.
   ============================================================ */
import { z } from 'zod';
import {
  buildWorkspacePlan, recalculatePlan, applyTaskPatch,
  applyArchitecturePatch, normalizeCustomProject, runVerification, planGuide,
} from '../utils/workspace/index.js';
import { generateArchitectureSpec } from '../utils/architecture/index.js';
import { generateForFile, generateForTask } from '../utils/codegen/codegenEngine.js';
import { planPatch } from '../utils/codegen/patchPlanner.js';
import { listTemplates } from '../utils/codegen/templateRegistry.js';
import { buildStarterPack, packToZip, newPackId, sanitizeProjectName } from '../utils/starterPack/starterPackBuilder.js';
import { gatherProofEvidence } from '../utils/workspace/proofVerification.js';
import { verifyPlanTasks } from '../utils/workspace/taskVerification.js';
import { verifyProjectSubmission, levelForXp } from '../utils/skillVerificationEngine.js';
import { buildEvidenceGraph, traceSkill } from '../utils/evidenceGraph.js';

const shortText = (max) => z.string().max(max);

const planLike = z.object({
  id: z.string().optional(),
  projectId: z.string().optional(),
  tasks: z.array(z.any()).optional(),
  fileTree: z.array(z.any()).optional(),
}).passthrough();

const generateSchema = z.object({
  projectId: shortText(160).optional().default(''),
  project: z.object({}).passthrough().optional().default({}),
  customInput: z.object({}).passthrough().optional(),
  architectureSpec: z.object({}).passthrough().optional().nullable(),
  architecturePackage: z.object({}).passthrough().optional().nullable(),
  existingPlan: planLike.optional().nullable(),
  regenerate: z.boolean().optional().default(false),
  persist: z.boolean().optional().default(true),
}).passthrough();

const patchPlanSchema = z.object({
  workspacePlan: planLike.optional().nullable(),
  patch: z.object({}).passthrough().optional().default({}),
  architecturePatch: z.object({}).passthrough().optional().nullable(),
  currentTab: shortText(60).optional(),
  selectedItem: z.object({}).passthrough().optional().nullable(),
}).passthrough();

const taskPatchSchema = z.object({
  workspacePlan: planLike.optional().nullable(),
  status: z.enum(['backlog', 'ready', 'in_progress', 'blocked', 'done', 'verified']).optional(),
  blockerReason: shortText(500).optional(),
  notes: shortText(2000).optional(),
}).passthrough();

const planBodySchema = z.object({
  workspacePlan: planLike.optional().nullable(),
}).passthrough();

/* Verify accepts optional evidence — the repo and deployment the student
   wants checked. Both are plain URLs; the server does the fetching so no
   token or origin restriction reaches the browser. */
const verifyBodySchema = z.object({
  workspacePlan: planLike.optional().nullable(),
  evidence: z.object({
    repoUrl: shortText(300).optional().default(''),
    liveUrl: shortText(300).optional().default(''),
    testOutput: shortText(20000).optional().default(''),
  }).optional().nullable(),
}).passthrough();

const codegenPreviewSchema = z.object({
  workspacePlan: planLike.optional().nullable(),
  taskId: shortText(120).optional().default(''),
  filePath: shortText(400).optional().default(''),
  templateKey: shortText(80).optional().default(''),
}).passthrough();

const codegenPlanSchema = z.object({
  workspacePlan: planLike.optional().nullable(),
  taskId: shortText(120),
}).passthrough();

/* In-memory starter pack cache. Serverless-safe: if a pack id is
   missing on download we regenerate deterministically from the
   stored/sent plan instead of failing. */
const PACK_TTL_MS = 15 * 60 * 1000;
const PACK_MAX = 20;
const packCache = new Map(); // packId -> { zip, name, createdAt, userKey }

function prunePacks() {
  const now = Date.now();
  for (const [id, p] of packCache) {
    if (now - p.createdAt > PACK_TTL_MS) packCache.delete(id);
  }
  while (packCache.size > PACK_MAX) {
    const oldest = packCache.keys().next().value;
    packCache.delete(oldest);
  }
}

export function registerWorkspaceRoutes(app, deps = {}) {
  const { requireAuth, currentUser, generationLimiter = (req, res, next) => next(), db = null } = deps;
  if (!requireAuth || !currentUser) throw new Error('workspaceRoutes: requireAuth + currentUser required');

  const validate = (schema) => (req, res, next) => {
    const r = schema.safeParse(req.body || {});
    if (!r.success) {
      return res.status(400).json({ success: false, error: 'invalid_input', details: r.error.issues.slice(0, 5).map((i) => i.message) });
    }
    req.body = r.data;
    next();
  };

  const userOf = (req) => {
    const u = currentUser(req) || {};
    return { userId: u.id || u._id || '', email: u.email || '' };
  };

  /* ---------- persistence helpers (best-effort, never throw) ---------- */
  async function loadPlan(req, projectId) {
    if (!db?.dbEnabled?.()) return null;
    try {
      const { userId, email } = userOf(req);
      const doc = await db.getProjectWorkspace({ userId, email, projectId });
      return doc?.workspacePlan || null;
    } catch { return null; }
  }
  async function savePlan(req, projectId, workspacePlan) {
    if (!db?.dbEnabled?.()) return { saved: false, reason: 'db_disabled' };
    try {
      const { userId, email } = userOf(req);
      const r = await db.saveProjectWorkspace({ userId, email, projectId, workspacePlan });
      return { saved: !!r?.ok };
    } catch { return { saved: false, reason: 'db_error' }; }
  }

  /* Resolve the plan for routes that act on one: prefer the
     client-sent copy (works DB-less), fall back to the DB. */
  async function resolvePlan(req, projectId) {
    const sent = req.body?.workspacePlan;
    if (sent && Array.isArray(sent.tasks)) return { plan: sent, source: 'client' };
    const stored = await loadPlan(req, projectId);
    if (stored) return { plan: stored, source: 'db' };
    return { plan: null, source: 'none' };
  }

  /* ============ POST /api/workspace/generate ============ */
  app.post('/api/workspace/generate', requireAuth, generationLimiter, validate(generateSchema), async (req, res) => {
    try {
      const { projectId, project, customInput, regenerate, persist } = req.body;
      const { userId } = userOf(req);

      const normalized = customInput ? normalizeCustomProject({ ...customInput, id: projectId || customInput.id }) : null;
      const proj = normalized || project || {};
      const pid = String(projectId || proj.id || '').trim() || ('proj_' + Date.now().toString(36));
      proj.id = proj.id || pid;

      /* Build a clean Architecture OS package: spec + mermaid views +
         validation + designScore. Accepts a client-sent package or a bare
         spec, otherwise generates one. No hidden __validation fields. */
      let architecture = null;
      const sent = req.body.architecturePackage || req.body.architectureSpec || null;
      if (sent && typeof sent === 'object') {
        const spec = sent.architectureSpec || sent;
        const validation = sent.validation || proj.architectureValidation || null;
        architecture = {
          architectureSpec: spec,
          mermaidViews: sent.mermaidViews || proj.mermaidViews || null,
          validation,
          designScore: Number.isFinite(sent.designScore) ? sent.designScore
            : Number.isFinite(validation?.score?.overallScore) ? validation.score.overallScore : null,
        };
      } else {
        try {
          const pkg = generateArchitectureSpec({
            projectId: pid,
            title: proj.title || '',
            description: proj.problemStatement || proj.description || '',
            techStack: Array.isArray(proj.techStack) ? proj.techStack : [],
            targetRole: proj.targetRole || '',
            projectType: proj.category || '',
            cloudProvider: proj.cloudProvider || 'generic',
            targetLevel: 'mvp',
          });
          architecture = {
            architectureSpec: pkg?.architectureSpec || null,
            mermaidViews: pkg?.mermaidViews || null,
            validation: pkg?.validation || null,
            designScore: Number.isFinite(pkg?.validation?.score?.overallScore) ? pkg.validation.score.overallScore : null,
          };
        } catch { architecture = null; }
      }

      const existingPlan = regenerate ? (req.body.existingPlan || await loadPlan(req, pid)) : (req.body.existingPlan || null);
      const workspacePlan = buildWorkspacePlan({
        project: proj,
        architecture,
        existingPlan,
        userId,
      });

      let persistence = { saved: false, reason: 'persist_false' };
      if (persist) persistence = await savePlan(req, pid, workspacePlan);

      res.json({ success: true, workspacePlan, project: proj, persistence });
    } catch (err) {
      console.error('[workspace] generate failed:', err.message);
      res.status(500).json({ success: false, error: 'generate_failed' });
    }
  });

  /* ============ POST /api/workspace/guide ============
     Derives the Guided Path (per-task steps, hints, AI prompts, learn
     recaps) from a workspace plan. Stateless + deterministic, so the
     guide can never drift from the plan and needs no storage. The client
     sends the plan it already holds; we compute and return the guide. */
  app.post('/api/workspace/guide', requireAuth, validate(z.object({ workspacePlan: planLike }).passthrough()), (req, res) => {
    try {
      const guide = planGuide(req.body.workspacePlan || {});
      res.json({ success: true, guide });
    } catch (err) {
      console.error('[workspace] guide failed:', err.message);
      res.status(500).json({ success: false, error: 'guide_failed' });
    }
  });

  /* ============ GET /api/workspace/templates ============ */
  app.get('/api/workspace/templates', requireAuth, (req, res) => {
    res.json({ success: true, templates: listTemplates() });
  });

  /* ============ GET /api/workspace/:projectId ============ */
  app.get('/api/workspace/:projectId', requireAuth, async (req, res) => {
    try {
      const projectId = String(req.params.projectId || '');
      if (!db?.dbEnabled?.()) {
        return res.json({ success: true, workspacePlan: null, persistence: { available: false, reason: 'db_disabled' } });
      }
      const { userId, email } = userOf(req);
      const doc = await db.getProjectWorkspace({ userId, email, projectId });
      res.json({
        success: true,
        workspacePlan: doc?.workspacePlan || null,
        currentTab: doc?.currentTab || null,
        selectedItem: doc?.selectedItem || null,
        persistence: { available: true },
      });
    } catch (err) {
      console.error('[workspace] get failed:', err.message);
      res.status(500).json({ success: false, error: 'get_failed' });
    }
  });

  /* ============ PATCH /api/workspace/:projectId ============ */
  app.patch('/api/workspace/:projectId', requireAuth, validate(patchPlanSchema), async (req, res) => {
    try {
      const projectId = String(req.params.projectId || '');
      const { patch, architecturePatch, currentTab, selectedItem } = req.body;
      const { plan } = await resolvePlan(req, projectId);

      let updated = plan;
      let architectureChanged = false;
      if (plan && architecturePatch && Object.keys(architecturePatch).length) {
        const r = applyArchitecturePatch(updated, architecturePatch);
        updated = r.plan;
        architectureChanged = r.changed;
        await savePlan(req, projectId, updated);
      }
      if (plan && patch && Object.keys(patch).length) {
        updated = recalculatePlan({ ...(updated || plan), ...patch });
        await savePlan(req, projectId, updated);
      }
      if ((currentTab || selectedItem) && db?.dbEnabled?.()) {
        const { userId, email } = userOf(req);
        await db.saveWorkspaceUiState({ userId, email, projectId, currentTab, selectedItem });
      }
      res.json({ success: true, workspacePlan: updated || null, architectureChanged });
    } catch (err) {
      console.error('[workspace] patch failed:', err.message);
      res.status(500).json({ success: false, error: 'patch_failed' });
    }
  });

  /* ============ PATCH /api/workspace/:projectId/tasks/:taskId ============ */
  app.patch('/api/workspace/:projectId/tasks/:taskId', requireAuth, validate(taskPatchSchema), async (req, res) => {
    try {
      const projectId = String(req.params.projectId || '');
      const taskId = String(req.params.taskId || '');
      const { plan } = await resolvePlan(req, projectId);
      if (!plan) return res.status(404).json({ success: false, error: 'workspace_not_found' });

      const { status, blockerReason, notes } = req.body;
      if (!(plan.tasks || []).some((t) => t.id === taskId)) {
        return res.status(404).json({ success: false, error: 'task_not_found' });
      }
      const result = applyTaskPatch(plan, taskId, { status, blockerReason, notes });
      const task = (result.plan.tasks || []).find((t) => t.id === taskId) || null;

      await savePlan(req, projectId, result.plan);
      res.json({ success: true, workspacePlan: result.plan, task, notes: result.notes || [] });
    } catch (err) {
      console.error('[workspace] task patch failed:', err.message);
      res.status(500).json({ success: false, error: 'task_patch_failed' });
    }
  });

  /* ============ POST /api/workspace/:projectId/recalculate ============ */
  app.post('/api/workspace/:projectId/recalculate', requireAuth, validate(planBodySchema), async (req, res) => {
    try {
      const projectId = String(req.params.projectId || '');
      const { plan } = await resolvePlan(req, projectId);
      if (!plan) return res.status(404).json({ success: false, error: 'workspace_not_found' });
      const updated = recalculatePlan(plan);
      await savePlan(req, projectId, updated);
      res.json({ success: true, workspacePlan: updated });
    } catch (err) {
      console.error('[workspace] recalculate failed:', err.message);
      res.status(500).json({ success: false, error: 'recalculate_failed' });
    }
  });

  /* ============ POST /api/workspace/:projectId/verify ============ */
  app.post('/api/workspace/:projectId/verify', requireAuth, validate(verifyBodySchema), async (req, res) => {
    try {
      const projectId = String(req.params.projectId || '');
      const { plan } = await resolvePlan(req, projectId);
      if (!plan) return res.status(404).json({ success: false, error: 'workspace_not_found' });

      // Evidence may come from the request or from what the workspace already
      // has on file, so a student who attached a repo once does not have to
      // re-paste it on every run.
      const rawEvidence = {
        repoUrl: req.body?.evidence?.repoUrl || plan?.proofEvidence?.repoUrl || '',
        liveUrl: req.body?.evidence?.liveUrl || plan?.proofEvidence?.liveUrl || '',
        testOutput: req.body?.evidence?.testOutput || plan?.proofEvidence?.testOutput || '',
      };
      const hasEvidence = !!(rawEvidence.repoUrl || rawEvidence.liveUrl || rawEvidence.testOutput);
      const evidence = hasEvidence ? await gatherProofEvidence(rawEvidence) : null;

      const { proofRequirements, verificationSummary } = runVerification(plan, evidence);

      /* Verification V3 — requirement-aware, per task. Connects
         acceptance criteria to the same evidence, promotes done→verified
         only when every machine rule passed, and attributes skills to the
         tasks whose evidence proved them. */
      const { tasks, taskVerification } = verifyPlanTasks({ ...plan, proofRequirements }, evidence);

      const updated = recalculatePlan({
        ...plan,
        tasks,
        proofRequirements,
        proofEvidence: { ...rawEvidence, lastVerifiedAt: new Date().toISOString() },
        verificationSummary,
        taskVerification,
      });
      await savePlan(req, projectId, updated);

      /* Verified workspace evidence flows into the EXISTING skill ledger via
         the canonical submission engine (duplicate-safe), so "verified
         evidence produces verified skills" without a parallel XP path. Only
         runs when real repo evidence verified at least one task. */
      let skillLedger = null;
      if (taskVerification.promotedTaskIds.length && evidence?.github?.present && db?.dbEnabled?.() && db.saveProjectSubmission && db.applySkillVerification) {
        try {
          const skills = taskVerification.skillEvidence.map((s) => s.skill);
          const submission = {
            subjectId: userOf(req).userId || userOf(req).email || '',
            projectTitle: updated.title,
            description: `${updated.projectSummary?.problemStatement || updated.title}. Workspace-verified tasks: ${taskVerification.promotedTaskIds.length}.`,
            technologies: [...new Set([...(updated.projectSummary?.techStack || []), ...skills])],
            claimedSkills: skills,
            complexity: String(updated.projectSummary?.difficulty || 'intermediate').toLowerCase(),
            githubUrl: rawEvidence.repoUrl,
            liveDemoUrl: rawEvidence.liveUrl || '',
            sourceFeature: 'workspace-verification',
            workspaceProjectId: projectId,
          };
          const result = verifyProjectSubmission(submission);
          const { userId, email } = userOf(req);
          const saved = await db.saveProjectSubmission({ userId, email, submission, result });
          if (saved?.ok) {
            await db.applySkillVerification({ userId, email, projectId: saved.id, result, levelForXp });
            skillLedger = { applied: true, submissionId: saved.id || null, status: result.verificationStatus };
          }
        } catch (e) { skillLedger = { applied: false, reason: e.message }; }
      }

      res.json({ success: true, verificationSummary, taskVerification, skillLedger, updatedWorkspacePlan: updated });
    } catch (err) {
      console.error('[workspace] verify failed:', err.message);
      res.status(500).json({ success: false, error: 'verify_failed' });
    }
  });

  /* ============ GET /api/workspace/:projectId/evidence-graph ============
     Traceability: role → gaps → project → milestones → tasks → criteria →
     evidence → skills, from real plan state. ?skill=<name> answers
     "why is this skill considered verified?" as a readable chain. */
  app.post('/api/workspace/:projectId/evidence-graph', requireAuth, validate(planBodySchema), async (req, res) => {
    try {
      const projectId = String(req.params.projectId || '');
      const { plan } = await resolvePlan(req, projectId);
      if (!plan) return res.status(404).json({ success: false, error: 'workspace_not_found' });
      const graph = buildEvidenceGraph(plan, {});
      const skill = String(req.query.skill || req.body?.skill || '').trim();
      res.json({ success: true, graph, trace: skill ? traceSkill(graph, skill) : null });
    } catch (err) {
      console.error('[workspace] evidence-graph failed:', err.message);
      res.status(500).json({ success: false, error: 'evidence_graph_failed' });
    }
  });

  /* ============ POST /api/workspace/:projectId/codegen/preview ============ */
  app.post('/api/workspace/:projectId/codegen/preview', requireAuth, generationLimiter, validate(codegenPreviewSchema), async (req, res) => {
    try {
      const projectId = String(req.params.projectId || '');
      const { plan } = await resolvePlan(req, projectId);
      if (!plan) return res.status(404).json({ success: false, error: 'workspace_not_found' });

      const { taskId, filePath, templateKey } = req.body;
      let out;
      if (taskId) out = generateForTask(plan, taskId);
      else if (filePath) out = generateForFile(plan, filePath, templateKey);
      else return res.status(400).json({ success: false, error: 'taskId_or_filePath_required' });

      res.json({ success: true, generatedFiles: out.generatedFiles || [], warnings: out.warnings || [] });
    } catch (err) {
      console.error('[workspace] codegen preview failed:', err.message);
      res.status(500).json({ success: false, error: 'codegen_preview_failed' });
    }
  });

  /* ============ POST /api/workspace/:projectId/codegen/plan ============ */
  app.post('/api/workspace/:projectId/codegen/plan', requireAuth, generationLimiter, validate(codegenPlanSchema), async (req, res) => {
    try {
      const projectId = String(req.params.projectId || '');
      const { plan } = await resolvePlan(req, projectId);
      if (!plan) return res.status(404).json({ success: false, error: 'workspace_not_found' });

      const out = planPatch(plan, req.body.taskId);
      res.json({ success: true, patchPlan: out.patchPlan || [], generatedFiles: out.generatedFiles || [], warnings: out.warnings || [] });
    } catch (err) {
      console.error('[workspace] codegen plan failed:', err.message);
      res.status(500).json({ success: false, error: 'codegen_plan_failed' });
    }
  });

  /* ============ POST /api/workspace/:projectId/starter-pack/preview ============ */
  app.post('/api/workspace/:projectId/starter-pack/preview', requireAuth, generationLimiter, validate(planBodySchema), async (req, res) => {
    try {
      const projectId = String(req.params.projectId || '');
      const { plan } = await resolvePlan(req, projectId);
      if (!plan) return res.status(404).json({ success: false, error: 'workspace_not_found' });

      const pack = buildStarterPack(plan);
      res.json({
        success: true,
        files: pack.files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content || '', 'utf8'), templateKey: f.templateKey || '' })),
        setupCommands: pack.setupCommands,
        warnings: pack.warnings,
      });
    } catch (err) {
      console.error('[workspace] starter pack preview failed:', err.message);
      res.status(500).json({ success: false, error: 'starter_pack_preview_failed' });
    }
  });

  /* ============ POST /api/workspace/:projectId/starter-pack/generate ============ */
  app.post('/api/workspace/:projectId/starter-pack/generate', requireAuth, generationLimiter, validate(planBodySchema), async (req, res) => {
    try {
      const projectId = String(req.params.projectId || '');
      const { plan } = await resolvePlan(req, projectId);
      if (!plan) return res.status(404).json({ success: false, error: 'workspace_not_found' });

      const pack = buildStarterPack(plan);
      const zip = packToZip(pack);
      const packId = newPackId();
      prunePacks();
      const { userId } = userOf(req);
      packCache.set(packId, { zip, name: pack.name, createdAt: Date.now(), userKey: String(userId || '') });

      const starterPackMeta = {
        available: true,
        lastGeneratedAt: new Date().toISOString(),
        packId,
        includedFiles: pack.files.map((f) => f.path),
        setupCommands: pack.setupCommands,
        warnings: pack.warnings,
      };
      /* Generating a starter pack NEVER changes task/verification
         status — it only records metadata. */
      if (db?.dbEnabled?.()) {
        const { email } = userOf(req);
        await db.saveWorkspaceStarterPackMeta({ userId, email, projectId, starterPack: starterPackMeta });
      }

      res.json({
        success: true,
        packId,
        files: starterPackMeta.includedFiles,
        downloadUrl: `/api/workspace/${encodeURIComponent(projectId)}/starter-pack/download/${packId}`,
        setupCommands: pack.setupCommands,
        warnings: pack.warnings,
        starterPack: starterPackMeta,
      });
    } catch (err) {
      console.error('[workspace] starter pack generate failed:', err.message);
      res.status(500).json({ success: false, error: 'starter_pack_generate_failed' });
    }
  });

  /* ============ GET /api/workspace/:projectId/starter-pack/download/:packId ============ */
  app.get('/api/workspace/:projectId/starter-pack/download/:packId', requireAuth, async (req, res) => {
    try {
      const projectId = String(req.params.projectId || '');
      const packId = String(req.params.packId || '');
      prunePacks();
      let entry = packCache.get(packId);

      /* Serverless-safe fallback: regenerate deterministically from
         the stored plan when the in-memory cache is cold. */
      if (!entry) {
        const stored = await loadPlan(req, projectId);
        if (!stored) return res.status(404).json({ success: false, error: 'pack_not_found' });
        const pack = buildStarterPack(stored);
        entry = { zip: packToZip(pack), name: pack.name, createdAt: Date.now() };
      }

      const fileName = `${sanitizeProjectName(entry.name || 'starter-pack')}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', entry.zip.length);
      res.end(entry.zip);
    } catch (err) {
      console.error('[workspace] starter pack download failed:', err.message);
      res.status(500).json({ success: false, error: 'starter_pack_download_failed' });
    }
  });
}
