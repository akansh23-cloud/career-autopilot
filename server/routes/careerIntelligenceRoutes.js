/* ============================================================
   Routes — Career Intelligence Engine (collectiveIntelligence)
   ------------------------------------------------------------
   Natural-language collective knowledge search across public,
   free APIs. Mounted from server.js via register(app, deps).

   Endpoints:
     GET  /api/intelligence/sources         source status (no keys)
     POST /api/intelligence/search          main collective search
     POST /api/intelligence/create-project  blueprint → project + workspace plan
     POST /api/intelligence/send-to-patent  blueprint → Patent OS idea
     POST /api/intelligence/resume-output   resume bullets / ATS / LinkedIn
     POST /api/intelligence/save-memory     store result in innovation memory

   Nothing here throws to the client; failures degrade. No API
   key, mailto or credential ever leaves the server.
   ============================================================ */
import { z } from 'zod';
import { ciConfig, sourceRunnable, NEW_SOURCES, REUSED_SOURCES, ALL_CI_SOURCES, CI_DISCLAIMER } from '../services/collectiveIntelligence/config.js';
import { runCareerIntelligence } from '../services/collectiveIntelligence/careerIntelligenceEngine.js';
import { saveIdeaSignal, saveMarketReport } from '../services/collectiveIntelligence/intelligenceStore.js';
import { buildWorkspacePlan, normalizeCustomProject } from '../utils/workspace/index.js';
import { generateArchitectureSpec } from '../utils/architecture/index.js';
import { resumeOutput } from '../services/projectIntelligence/resumeOutputService.js';
import { stripIdentifiers, neutralize } from '../services/innovationMemory/privacyFilterService.js';
import { ingestDiscovery } from '../services/innovationMemory/memoryIngestionService.js';

const searchSchema = z.object({
  query: z.string().trim().min(3).max(500),
  mode: z.enum(['auto', 'project', 'patent', 'resume', 'market', 'career']).optional().default('auto'),
  selectedSources: z.array(z.enum(ALL_CI_SOURCES)).max(25).optional().default([]),
  maxSources: z.number().int().min(1).max(12).optional(),
  createAssets: z.boolean().optional().default(true),
  userContext: z.object({
    targetRole: z.string().trim().max(80).optional(),
    skills: z.array(z.string().trim().max(60)).max(30).optional(),
  }).optional().default({}),
}).passthrough();

const ideaShape = z.object({
  title: z.string().trim().max(240).optional().default(''),
  problemStatement: z.string().trim().max(2000).optional().default(''),
  targetUsers: z.string().trim().max(500).optional().default(''),
  noveltyAngle: z.string().trim().max(800).optional().default(''),
  dataSources: z.array(z.string().trim().max(200)).max(10).optional().default([]),
  skills: z.array(z.string().trim().max(60)).max(20).optional().default([]),
  scores: z.record(z.string(), z.number()).optional().default({}),
}).passthrough();

const blueprintShape = z.object({
  title: z.string().trim().max(240).optional(),
  problemStatement: z.string().trim().max(2000).optional(),
  targetUsers: z.string().trim().max(500).optional(),
  mvpScope: z.array(z.string().trim().max(300)).max(20).optional(),
  architecture: z.string().trim().max(1200).optional(),
  techStack: z.array(z.string().trim().max(60)).max(20).optional(),
  apisAndDataSources: z.array(z.any()).max(12).optional(),
  tasks: z.array(z.string().trim().max(300)).max(30).optional(),
  proofChecklist: z.array(z.string().trim().max(300)).max(12).optional(),
  resumeBullet: z.string().trim().max(500).optional(),
}).passthrough();

const createProjectSchema = z.object({
  idea: ideaShape.optional().default({}),
  blueprint: blueprintShape.optional().default({}),
  understanding: z.any().optional(),
  persist: z.boolean().optional().default(true),
}).passthrough();

const patentSchema = z.object({
  idea: ideaShape.optional().default({}),
  patentAngle: z.object({
    problem: z.string().trim().max(2000).optional().default(''),
    existingLimitations: z.string().trim().max(2000).optional().default(''),
    noveltyAngle: z.string().trim().max(1200).optional().default(''),
    priorArtSignals: z.array(z.any()).max(12).optional().default([]),
    possibleClaimsOutline: z.array(z.string().trim().max(400)).max(12).optional().default([]),
    risk: z.string().trim().max(1200).optional().default(''),
    riskAndLimitations: z.array(z.string().trim().max(400)).max(10).optional().default([]),
  }).passthrough().optional().default({}),
  blueprint: blueprintShape.optional().default({}),
}).passthrough();

const resumeSchema = z.object({
  idea: ideaShape.optional().default({}),
  blueprint: blueprintShape.optional().default({}),
  resumeValue: z.any().optional(),
  skillXpMapping: z.any().optional(),
}).passthrough();

const memorySchema = z.object({
  query: z.string().trim().max(500).optional().default(''),
  idea: ideaShape.optional().default({}),
  evidence: z.array(z.any()).max(40).optional().default([]),
  marketSignals: z.array(z.any()).max(20).optional().default([]),
  understanding: z.any().optional(),
}).passthrough();

function dbOn(db) { return !!(db && db.dbEnabled && db.dbEnabled()); }

export function registerCareerIntelligenceRoutes(app, deps = {}) {
  const { requireAuth, currentUser, generationLimiter = (req, res, next) => next(), db } = deps;
  if (!requireAuth || !currentUser) throw new Error('careerIntelligenceRoutes: requireAuth + currentUser required');

  const cfg = () => ciConfig();
  const me = (req) => { const u = currentUser(req); return { userId: u?.id, email: u?.email }; };
  const validate = (schema) => (req, res, next) => {
    const r = schema.safeParse(req.body || {});
    if (!r.success) return res.status(400).json({ ok: false, error: 'invalid_request', issues: r.error.issues.slice(0, 8).map((i) => ({ path: i.path.join('.'), message: i.message })) });
    req.body = r.data; next();
  };
  const ifEnabled = (handler) => async (req, res) => {
    if (!cfg().enabled) return res.status(404).json({ ok: false, error: 'feature_disabled', message: 'Career Intelligence is disabled (CAREER_INTELLIGENCE_ENABLED=0).' });
    try { return await handler(req, res); }
    catch (err) { console.error('[career-intelligence route]', req.path, err.message); return res.status(200).json({ ok: false, error: 'internal', message: 'Something went wrong; partial/limited mode.', mode: 'error' }); }
  };

  /* ---- GET /api/intelligence/sources ----
     Status only: enabled, key required, key configured (boolean),
     quota risk. Never the keys themselves. */
  app.get('/api/intelligence/sources', requireAuth, ifEnabled(async (req, res) => {
    const c = cfg();
    const sources = [
      ...NEW_SOURCES.map((name) => {
        const s = c.sources[name] || {};
        return {
          name,
          group: 'knowledge',
          enabled: !!s.enabled,
          keyRequired: !!s.keyRequired,
          keyConfigured: !!s.hasKey,
          quotaRisk: s.quotaRisk || 'low',
          runnable: sourceRunnable(name, c),
        };
      }),
      ...REUSED_SOURCES.map((name) => ({
        name,
        group: 'community',
        enabled: true,
        keyRequired: false,
        keyConfigured: true,
        quotaRisk: 'low',
        runnable: sourceRunnable(name, c),
      })),
    ];
    res.json({
      ok: true,
      enabled: c.enabled,
      networkAllowed: c.networkAllowed,
      maxSourcesPerQuery: c.maxSourcesPerQuery,
      cacheTtlMinutes: c.cacheTtlMinutes,
      sources,
      disclaimer: CI_DISCLAIMER,
      db: dbOn(db),
    });
  }));

  /* ---- POST /api/intelligence/search ---- */
  app.post('/api/intelligence/search', requireAuth, generationLimiter, validate(searchSchema), ifEnabled(async (req, res) => {
    const { query, mode, selectedSources, maxSources, createAssets, userContext } = req.body;
    const result = await runCareerIntelligence({
      query, mode, selectedSources, maxSources, createAssets,
      userContext: { ...userContext, ...me(req) },
    });
    res.json({ ...result, db: dbOn(db) });
  }));

  /* ---- POST /api/intelligence/create-project ----
     Builds a normalized project + Architecture OS package + full
     guided workspace plan from a selected intelligence result.
     Persistence: client saves the project via the existing project
     store (same proven path as Innovation OS convert-to-project);
     the workspace plan is persisted server-side when the DB is on. */
  app.post('/api/intelligence/create-project', requireAuth, generationLimiter, validate(createProjectSchema), ifEnabled(async (req, res) => {
    const { idea, blueprint, understanding, persist } = req.body;
    const title = blueprint.title || idea.title || 'Career Intelligence project';
    const techStack = (blueprint.techStack && blueprint.techStack.length ? blueprint.techStack : idea.skills) || [];

    const project = normalizeCustomProject({
      title,
      problemStatement: blueprint.problemStatement || idea.problemStatement || '',
      targetUsers: blueprint.targetUsers || idea.targetUsers || understanding?.targetUser || '',
      category: understanding?.domain ? `${understanding.domain} app` : 'Web App',
      targetRole: understanding?.targetRole || '',
      difficulty: understanding?.difficulty || 'Intermediate',
      techStack: techStack.join(', '),
      mvpFeatures: (blueprint.mvpScope || []).join(', '),
      flags: { patent: !!understanding?.needs?.patent },
    });
    // Carry intelligence provenance on the payload (client persists it).
    project.sourceFeature = 'career-intelligence';
    project.intelligence = {
      noveltyAngle: idea.noveltyAngle || '',
      dataSources: blueprint.apisAndDataSources || idea.dataSources || [],
      scores: idea.scores || {},
      resumeBullet: blueprint.resumeBullet || '',
      proofChecklist: blueprint.proofChecklist || [],
      tasks: blueprint.tasks || [],
    };

    let architecture = null;
    try {
      const pkg = generateArchitectureSpec({
        projectId: project.id,
        title: project.title,
        description: project.problemStatement,
        techStack: project.techStack,
        targetRole: project.targetRole,
        projectType: project.category,
        cloudProvider: project.cloudProvider || 'generic',
        targetLevel: 'mvp',
      });
      architecture = {
        architectureSpec: pkg?.architectureSpec || null,
        mermaidViews: pkg?.mermaidViews || null,
        validation: pkg?.validation || null,
        designScore: Number.isFinite(pkg?.validation?.score?.overallScore) ? pkg.validation.score.overallScore : null,
      };
    } catch { architecture = null; }

    const { userId, email } = me(req);
    const workspacePlan = buildWorkspacePlan({ project, architecture, existingPlan: null, userId });

    let persistence = { saved: false, reason: persist ? 'db_off' : 'persist_false' };
    if (persist && dbOn(db) && db.saveProjectWorkspace) {
      try {
        const saved = await db.saveProjectWorkspace({ userId, email, projectId: project.id, workspacePlan });
        persistence = { saved: !!saved?.ok || !!saved, reason: 'db' };
      } catch (e) { persistence = { saved: false, reason: 'db_error:' + e.message }; }
    }

    res.json({
      ok: true,
      project,
      projectPayload: project,
      workspacePlan,
      architecture,
      persistVia: 'client-project-store',
      persistence,
      db: dbOn(db),
      note: 'Project payload returned for the client project store; the guided workspace plan was generated from the blueprint.',
    });
  }));

  /* ---- POST /api/intelligence/send-to-patent ----
     Creates a Patent OS idea from a selected result. Persists via
     db.createPatentIdeas when the DB is on (same path Patent OS
     uses); otherwise returns the payload for the client. */
  app.post('/api/intelligence/send-to-patent', requireAuth, generationLimiter, validate(patentSchema), ifEnabled(async (req, res) => {
    const { idea, patentAngle, blueprint } = req.body;
    const payload = {
      title: idea.title || blueprint.title || 'Career Intelligence idea',
      domain: req.body.understanding?.domain || '',
      targetUser: blueprint.targetUsers || idea.targetUsers || '',
      problem: patentAngle.problem || idea.problemStatement || '',
      existingSolutions: patentAngle.existingLimitations || '',
      proposedSolution: blueprint.problemStatement || idea.problemStatement || '',
      technicalMechanism: patentAngle.noveltyAngle || idea.noveltyAngle || '',
      noveltyAngle: patentAngle.noveltyAngle || idea.noveltyAngle || '',
      marketUseCase: blueprint.targetUsers || idea.targetUsers || '',
      implementationPlan: (blueprint.mvpScope || []).join('; '),
      tags: (idea.skills || []).slice(0, 8),
      source: 'career-intelligence',
      score: {
        overall: Number(idea.scores?.patentPotentialScore) || 0,
        grade: '',
        riskLevel: (patentAngle.risk || patentAngle.riskAndLimitations?.length) ? 'See risk notes' : 'Unassessed',
      },
      riskWarnings: [patentAngle.risk, ...(patentAngle.riskAndLimitations || [])].filter(Boolean).slice(0, 6),
      priorArtSignals: (patentAngle.priorArtSignals || []).slice(0, 8),
      claimsOutline: (patentAngle.possibleClaimsOutline || []).slice(0, 8),
    };

    let patentIdeaId = '';
    if (db && db.createPatentIdeas && dbOn(db)) {
      const created = await db.createPatentIdeas({ ...me(req), ideas: [payload], generationWhy: 'Created from Career Intelligence Engine (source-backed, early-stage research assistance — not legal advice).' });
      if (created?.ok && created.ideas?.[0]) patentIdeaId = created.ideas[0].id;
    }
    res.json({
      ok: true,
      patentIdeaId,
      patentIdea: payload,
      persisted: !!patentIdeaId,
      db: dbOn(db),
      disclaimer: 'Early-stage research assistance only — not legal advice.',
      note: patentIdeaId ? 'Created in Patent OS.' : 'DB off — payload returned; open Patent OS to continue.',
    });
  }));

  /* ---- POST /api/intelligence/resume-output ----
     Deterministic resume assets. Draft-only: verified bullets and
     verified XP come exclusively from the existing project
     verification flow — never from a search. */
  app.post('/api/intelligence/resume-output', requireAuth, generationLimiter, validate(resumeSchema), ifEnabled(async (req, res) => {
    const { idea, blueprint } = req.body;
    const out = resumeOutput({
      project: {
        title: idea.title || blueprint.title || '',
        targetRole: req.body.understanding?.targetRole || '',
        skillsCovered: idea.skills || blueprint.techStack || [],
      },
      recommendation: {
        title: idea.title || blueprint.title || '',
        skills: idea.skills || blueprint.techStack || [],
        targetRole: req.body.understanding?.targetRole || '',
      },
      evidence: {},
    });
    res.json({
      ok: true,
      resumeOutput: out,
      resumeValue: req.body.resumeValue || null,
      skillXpMapping: req.body.skillXpMapping || null,
      xpNote: 'Skill XP from intelligence results is suggested only. Verified XP is granted exclusively through the existing project verification flow.',
      db: dbOn(db),
    });
  }));

  /* ---- POST /api/intelligence/save-memory ----
     Stores a privacy-filtered result into innovation memory +
     intelligence collections so future searches improve. */
  app.post('/api/intelligence/save-memory', requireAuth, generationLimiter, validate(memorySchema), ifEnabled(async (req, res) => {
    const { query, idea, evidence, marketSignals, understanding } = req.body;
    const { userId, email } = me(req);
    const safeQuery = stripIdentifiers(query).slice(0, 300);

    const results = { ideaSignal: false, marketReport: false, memoryChunks: 0 };

    if (idea && (idea.title || idea.problemStatement)) {
      const r = await saveIdeaSignal({
        userId, email,
        idea: { ...idea, title: stripIdentifiers(idea.title || ''), problemStatement: neutralize(idea.problemStatement || '') },
        intent: understanding?.primaryIntent || '', domain: understanding?.domain || '',
      });
      results.ideaSignal = !!r?.ok;
    }
    if (marketSignals.length) {
      const r = await saveMarketReport({ userId, email, query: safeQuery, domain: understanding?.domain || '', signals: marketSignals.slice(0, 12), summary: { count: marketSignals.length } });
      results.marketReport = !!r?.ok;
    }
    if (evidence.length) {
      try {
        const signals = evidence.slice(0, 30).map((e) => ({
          source: e.source || 'career-intelligence',
          title: stripIdentifiers(e.title || ''),
          contentSummary: neutralize(e.summary || e.excerpt || ''),
          url: e.url || '',
          tags: (e.tags || []).slice(0, 8),
        }));
        const r = await ingestDiscovery({ userId, email, signals, clusters: [] });
        results.memoryChunks = r?.saved || 0;
      } catch { /* memory disabled or DB off — best effort */ }
    }

    res.json({
      ok: true,
      saved: results,
      db: dbOn(db),
      note: dbOn(db)
        ? 'Saved (privacy-filtered). Career Intelligence continuously improves its knowledge base by storing, indexing, and reusing verified public data and user feedback.'
        : 'DB off — nothing persisted; results remain available in this session.',
    });
  }));
}

export default { registerCareerIntelligenceRoutes };
