/* ============================================================
   Routes — Innovation & Patent Intelligence OS
   ------------------------------------------------------------
   Mounted from server.js via register(app, deps) so server.js
   only gains one import + one call. All routes require the
   app's existing auth (requireAuth) and are user-scoped.

   Works in three persistence modes:
     • DB on  → signals/clusters/projects persisted, real ids.
     • DB off → clusters/projects round-trip through the request
                body (client holds state); still fully usable in
                "limited mode".
   Nothing here throws to the client; failures degrade.
   ============================================================ */
import { z } from 'zod';
import { piConfig, resolveActiveProvider, ALLOWED_SOURCES, INNOVATION_STATUSES, PROOF_GATED_STATUSES, INNOVATION_DISCLAIMER } from '../services/problemIntelligence/config.js';
import { ingestSignals } from '../services/problemIntelligence/ingestionService.js';
import { extractPainPoints } from '../services/problemIntelligence/extractionService.js';
import { clusterSignals } from '../services/problemIntelligence/clusteringService.js';
import { scoreClusters } from '../services/problemIntelligence/opportunityScoringService.js';
import { synthesizeProject } from '../services/problemIntelligence/projectSynthesisService.js';
import { generateBuildBlueprint } from '../services/problemIntelligence/buildBlueprintService.js';
import { estimateFeasibilityAndCost } from '../services/problemIntelligence/feasibilityCostService.js';
import { computeIPReadiness, ipNarrative } from '../services/problemIntelligence/ipReadinessService.js';
import { normalizePriorArtRecord } from '../services/problemIntelligence/priorArtWorkspaceService.js';
import { assembleDisclosure, toProjectPayload, toPatentIdeaPayload } from '../services/problemIntelligence/patentBridgeService.js';
import * as store from '../services/problemIntelligence/store.js';

const discoverSchema = z.object({
  domain: z.string().trim().max(80).optional().default(''),
  targetUser: z.string().trim().max(80).optional().default(''),
  technology: z.string().trim().max(80).optional().default(''),
  goal: z.string().trim().max(120).optional().default(''),
  skills: z.array(z.string().trim().max(60)).max(30).optional().default([]),
  difficulty: z.string().trim().max(40).optional().default(''),
  purpose: z.enum(['portfolio', 'startup', 'research', 'patent-readiness']).optional().default('portfolio'),
  sources: z.array(z.enum(ALLOWED_SOURCES)).max(4).optional().default([]),
  manualProblems: z.array(z.object({
    title: z.string().trim().max(280), description: z.string().trim().max(2000).optional().default(''),
    tags: z.array(z.string().trim().max(40)).max(12).optional().default([]),
  })).max(30).optional().default([]),
  timeRange: z.string().trim().max(20).optional().default(''),
  limit: z.number().int().min(1).max(40).optional().default(20),
}).passthrough();

const priorArtSchema = z.object({
  sourceType: z.enum(['patent', 'paper', 'product', 'github', 'article', 'manual']).optional().default('manual'),
  title: z.string().trim().max(240),
  sourceUrl: z.string().trim().max(500).optional().default(''),
  summary: z.string().trim().max(1500).optional().default(''),
  similarityRisk: z.string().trim().max(20).optional().default('Unknown'),
  technicalOverlap: z.string().trim().max(800).optional().default(''),
  differentiator: z.string().trim().max(800).optional().default(''),
  blockingRisk: z.string().trim().max(20).optional().default('Unknown'),
});

export function registerProblemIntelligenceRoutes(app, deps = {}) {
  const { requireAuth, currentUser, generationLimiter = (req, res, next) => next(), db } = deps;
  if (!requireAuth || !currentUser) throw new Error('problemIntelligenceRoutes: requireAuth + currentUser required');

  const cfg = () => piConfig();
  const me = (req) => { const u = currentUser(req); return { userId: u?.id, email: u?.email }; };
  const validate = (schema) => (req, res, next) => {
    const r = schema.safeParse(req.body || {});
    if (!r.success) return res.status(400).json({ ok: false, error: 'invalid_request', issues: r.error.issues.slice(0, 8).map((i) => ({ path: i.path.join('.'), message: i.message })) });
    req.body = r.data; next();
  };

  // Feature flag guard: when disabled, every route 404s cleanly.
  const ifEnabled = (handler) => async (req, res) => {
    if (!cfg().enabled) return res.status(404).json({ ok: false, error: 'feature_disabled', message: 'Innovation OS is disabled (PROBLEM_INTELLIGENCE_ENABLED=0).' });
    try { return await handler(req, res); }
    catch (err) { console.error('[innovation route]', req.path, err.message); return res.status(200).json({ ok: false, error: 'internal', message: 'Something went wrong; running in limited mode.', mode: 'error' }); }
  };

  /* ---- config / capabilities ---- */
  app.get('/api/problem-intelligence/config', requireAuth, ifEnabled(async (req, res) => {
    const c = cfg();
    const provider = resolveActiveProvider(c);
    res.json({
      ok: true,
      enabled: c.enabled,
      mode: provider === 'fallback' ? 'limited/fallback' : 'full',
      aiProvider: provider,
      sources: {
        github: { available: true, mode: c.githubToken ? 'authenticated' : 'public' },
        stackexchange: { available: true, mode: c.stackExchangeKey ? 'keyed' : 'keyless' },
        arxiv: { available: true, mode: 'public' },
        manual: { available: true, mode: 'manual' },
      },
      warnings: buildKeyWarnings(c, provider),
      statuses: INNOVATION_STATUSES,
      proofGatedStatuses: PROOF_GATED_STATUSES,
      db: !!(db && db.dbEnabled && db.dbEnabled()),
      disclaimer: INNOVATION_DISCLAIMER,
    });
  }));

  /* ---- discovery (ingest → extract → cluster → score → persist) ---- */
  app.post('/api/problem-intelligence/discover', requireAuth, generationLimiter, validate(discoverSchema), ifEnabled(async (req, res) => {
    const c = cfg();
    const provider = resolveActiveProvider(c);
    const input = req.body;
    const ing = await ingestSignals(input);
    const warnings = [...ing.warnings];

    if (!ing.signals.length) {
      return res.json({ ok: true, mode: provider === 'fallback' ? 'limited/fallback' : 'full', signalsCount: 0, clusters: [], warnings: [...warnings, 'No source signals found. Try broader terms, add a GITHUB_TOKEN/STACKEXCHANGE_KEY, or add manual problems.'], db: dbOn(db) });
    }

    const extracted = await extractPainPoints({ signals: ing.signals }, c);
    const context = { domain: input.domain, technology: input.technology, targetUser: input.targetUser };
    const { clusters: rawClusters, duplicatesSkipped } = clusterSignals(extracted.signals, context);
    if (duplicatesSkipped) warnings.push(`${duplicatesSkipped} duplicate cluster(s) skipped.`);
    let clusters = scoreClusters(rawClusters);

    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (dbOn(db)) {
      const saved = await store.saveDiscovery({ ...me(req), runId, signals: extracted.signals, clusters });
      if (saved.ok) clusters = mergeIds(clusters, saved.clusters);
      else warnings.push('Discovery could not be saved; returning live results only.');
    } else {
      clusters = clusters.map((c2) => ({ ...c2, id: c2.dedupeFingerprint, persisted: false }));
    }

    res.json({
      ok: true,
      mode: provider === 'fallback' ? 'limited/fallback' : 'full',
      aiProvider: extracted.provider,
      confidence: extracted.confidence,
      signalsCount: ing.signalsCount,
      bySource: ing.bySource,
      painPoints: extracted.painPoints,
      clusters: clusters.map(publicCluster),
      warnings,
      db: dbOn(db),
    });
  }));

  app.get('/api/problem-intelligence/clusters', requireAuth, ifEnabled(async (req, res) => {
    const clusters = await store.listClusters({ ...me(req) });
    res.json({ ok: true, clusters: clusters.map(publicCluster), db: dbOn(db) });
  }));

  app.get('/api/problem-intelligence/clusters/:clusterId', requireAuth, ifEnabled(async (req, res) => {
    const cluster = await store.getCluster({ ...me(req), id: req.params.clusterId });
    if (!cluster) return res.status(404).json({ ok: false, error: 'not_found', message: 'Cluster not found (it may be unsaved — DB is off).' });
    res.json({ ok: true, cluster, db: dbOn(db) });
  }));

  /* ---- generate a source-backed project from a cluster ---- */
  app.post('/api/problem-intelligence/clusters/:clusterId/generate-project', requireAuth, generationLimiter, ifEnabled(async (req, res) => {
    const c = cfg();
    let cluster = await store.getCluster({ ...me(req), id: req.params.clusterId });
    if (!cluster && req.body && req.body.cluster) cluster = req.body.cluster; // no-DB mode
    if (!cluster) return res.status(404).json({ ok: false, error: 'not_found', message: 'Cluster not found. Pass the cluster in the body when DB is off.' });

    const project = await synthesizeProject({
      cluster, skills: req.body?.skills || [], difficulty: req.body?.difficulty || '', purpose: req.body?.purpose || cluster.recommendedRoute || 'portfolio',
    }, c);
    project.clusterId = cluster.id || cluster.dedupeFingerprint || '';
    project.status = 'project_blueprint_ready';

    let saved = { ok: false };
    if (dbOn(db)) saved = await store.saveProject({ ...me(req), project });
    const id = saved.ok ? saved.project.id : project.fingerprint;
    res.json({ ok: true, project: { ...project, id }, persisted: saved.ok, duplicate: !!saved.duplicate, db: dbOn(db) });
  }));

  /* ---- per-project enrichments. Each accepts a stored id OR a project body. ---- */
  const loadProject = async (req) => {
    const stored = await store.getProject({ ...me(req), id: req.params.projectId });
    if (stored) return { project: stored, persisted: true };
    if (req.body && req.body.project) return { project: req.body.project, persisted: false };
    return { project: null, persisted: false };
  };

  app.post('/api/problem-intelligence/projects/:projectId/build-blueprint', requireAuth, generationLimiter, ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const blueprint = await generateBuildBlueprint({ project }, cfg());
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch: { buildBlueprint: blueprint } });
    res.json({ ok: true, blueprint, db: dbOn(db) });
  }));

  app.post('/api/problem-intelligence/projects/:projectId/cost-estimate', requireAuth, generationLimiter, ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const costEstimate = await estimateFeasibilityAndCost({ project }, cfg());
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch: { costEstimate } });
    res.json({ ok: true, costEstimate, db: dbOn(db) });
  }));

  app.post('/api/problem-intelligence/projects/:projectId/ip-readiness', requireAuth, generationLimiter, ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const priorArtRecords = persisted ? await store.listPriorArt({ ...me(req), projectId: req.params.projectId }) : (req.body?.priorArtRecords || []);
    const hasPrototypeEvidence = !!(project.convertedProjectId || req.body?.hasPrototypeEvidence);
    const ipReadiness = computeIPReadiness({ project, priorArtRecords, hasPrototypeEvidence });
    const narrative = await ipNarrative(project, cfg());
    ipReadiness.narrative = narrative.narrative; ipReadiness.aiProvider = narrative.aiProvider;
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch: { ipReadiness } });
    res.json({ ok: true, ipReadiness, db: dbOn(db) });
  }));

  app.post('/api/problem-intelligence/projects/:projectId/strengthen', requireAuth, generationLimiter, ifEnabled(async (req, res) => {
    const { project } = await loadProject(req);
    if (!project) return notFound(res);
    const priorArtRecords = await store.listPriorArt({ ...me(req), projectId: req.params.projectId });
    const ip = computeIPReadiness({ project, priorArtRecords, hasPrototypeEvidence: !!project.convertedProjectId });
    res.json({ ok: true, suggestions: ip.requiredEvidenceToImprove, section3kWarning: ip.section3kWarning, recommendedIPRoute: ip.recommendedIPRoute, currentReadiness: ip.overall, label: ip.label, db: dbOn(db) });
  }));

  /* ---- prior-art workspace ---- */
  app.get('/api/problem-intelligence/projects/:projectId/prior-art', requireAuth, ifEnabled(async (req, res) => {
    const records = await store.listPriorArt({ ...me(req), projectId: req.params.projectId });
    res.json({ ok: true, records, count: records.length, status: records.length ? `${records.length} record(s)` : 'External prior-art risk unknown.', db: dbOn(db) });
  }));

  app.post('/api/problem-intelligence/projects/:projectId/prior-art', requireAuth, validate(priorArtSchema), ifEnabled(async (req, res) => {
    const u = currentUser(req);
    const record = normalizePriorArtRecord(req.body, u?.email || '');
    const saved = await store.addPriorArt({ ...me(req), projectId: req.params.projectId, record });
    // Recalculate readiness with the new record set.
    const project = await store.getProject({ ...me(req), id: req.params.projectId });
    let ipReadiness = null;
    if (project) {
      const records = await store.listPriorArt({ ...me(req), projectId: req.params.projectId });
      ipReadiness = computeIPReadiness({ project, priorArtRecords: records, hasPrototypeEvidence: !!project.convertedProjectId });
      await store.updateProject({ ...me(req), id: req.params.projectId, patch: { ipReadiness } });
    }
    res.status(saved.ok || !dbOn(db) ? 200 : 500).json({ ok: saved.ok, record: saved.record || record, recalculatedReadiness: ipReadiness, db: dbOn(db) });
  }));

  /* ---- disclosure ---- */
  app.post('/api/problem-intelligence/projects/:projectId/generate-disclosure', requireAuth, generationLimiter, ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const priorArtRecords = persisted ? await store.listPriorArt({ ...me(req), projectId: req.params.projectId }) : (req.body?.priorArtRecords || []);
    const disclosure = await assembleDisclosure({ project, priorArtRecords }, cfg());
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch: { disclosureDraft: disclosure, status: 'disclosure_drafted' } });
    res.json({ ok: true, disclosure, disclaimer: INNOVATION_DISCLAIMER, db: dbOn(db) });
  }));

  /* ---- bridges ---- */
  app.post('/api/problem-intelligence/projects/:projectId/convert-to-project', requireAuth, generationLimiter, ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const payload = toProjectPayload(project, project.buildBlueprint || req.body?.buildBlueprint || {}, project.costEstimate || req.body?.costEstimate || {});
    // The client persists via the existing project store (saveProject) — a real,
    // tested persistence path (localStorage + PATCH /api/user/state). We stamp
    // the link on our record so it is genuinely connected, not a toast.
    const clientProjectId = req.body?.clientProjectId || '';
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch: { convertedProjectId: clientProjectId || 'pending-client-save', status: 'poc_planned' } });
    res.json({ ok: true, projectPayload: payload, persistVia: 'client-project-store', db: dbOn(db) });
  }));

  app.post('/api/problem-intelligence/projects/:projectId/convert-to-patent', requireAuth, generationLimiter, ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const priorArtRecords = persisted ? await store.listPriorArt({ ...me(req), projectId: req.params.projectId }) : [];
    const ip = project.ipReadiness || computeIPReadiness({ project, priorArtRecords, hasPrototypeEvidence: !!project.convertedProjectId });
    const payload = toPatentIdeaPayload(project, ip);

    let patentIdeaId = '';
    if (db && db.createPatentIdeas && dbOn(db)) {
      const created = await db.createPatentIdeas({ ...me(req), ideas: [payload], generationWhy: 'Converted from Innovation & Patent Intelligence OS (source-backed).' });
      if (created.ok && created.ideas?.[0]) patentIdeaId = created.ideas[0].id;
    }
    if (persisted && patentIdeaId) await store.updateProject({ ...me(req), id: req.params.projectId, patch: { convertedPatentIdeaId: patentIdeaId, status: 'prior_art_review' } });
    res.json({ ok: true, patentIdeaId, patentIdea: payload, persisted: !!patentIdeaId, db: dbOn(db), note: patentIdeaId ? 'Created in Patent OS.' : 'DB off — open Patent OS to generate persistently.' });
  }));

  /* ---- list (UI rehydrate) ---- */
  app.get('/api/problem-intelligence/projects', requireAuth, ifEnabled(async (req, res) => {
    const projects = await store.listProjects({ ...me(req) });
    res.json({ ok: true, projects, db: dbOn(db) });
  }));
  app.get('/api/problem-intelligence/projects/:projectId', requireAuth, ifEnabled(async (req, res) => {
    const project = await store.getProject({ ...me(req), id: req.params.projectId });
    if (!project) return notFound(res);
    res.json({ ok: true, project, db: dbOn(db) });
  }));
}

function dbOn(db) { return !!(db && db.dbEnabled && db.dbEnabled()); }
function notFound(res) { return res.status(404).json({ ok: false, error: 'not_found', message: 'Project not found. Pass the project in the body when DB is off.' }); }
function mergeIds(clusters, saved) {
  const byFp = Object.fromEntries(saved.map((s) => [s.dedupeFingerprint, s.id]));
  return clusters.map((c) => ({ ...c, id: byFp[c.dedupeFingerprint] || c.dedupeFingerprint, persisted: !!byFp[c.dedupeFingerprint] }));
}
function publicCluster(c) {
  return {
    id: c.id || c.dedupeFingerprint, title: c.title, summary: c.summary, domain: c.domain, technology: c.technology, targetUser: c.targetUser,
    keywords: c.keywords || [], signalCount: c.signalCount || 0, sources: c.sources || [], topSources: c.topSources || [],
    evidenceStrengthScore: c.evidenceStrengthScore, severityScore: c.severityScore, trendScore: c.trendScore,
    buildFeasibilityScore: c.buildFeasibilityScore, portfolioValueScore: c.portfolioValueScore,
    researchPotentialScore: c.researchPotentialScore, patentPotentialScore: c.patentPotentialScore,
    recommendedRoute: c.recommendedRoute, sourceBacked: (c.signalCount || 0) > 0 && (c.evidenceStrengthScore || 0) >= 25,
    badge: ((c.signalCount || 0) > 0 && (c.evidenceStrengthScore || 0) >= 25) ? 'Source-backed' : 'Fallback draft',
    persisted: c.persisted !== false,
    // keep signals only on the detail endpoint to keep list payloads small
    ...(c.signals ? { signals: c.signals } : {}),
  };
}
function buildKeyWarnings(c, provider) {
  const w = [];
  if (provider === 'fallback') w.push('No AI key detected — running in deterministic/fallback mode (low-confidence output).');
  if (!c.githubToken) w.push('GITHUB_TOKEN not set — GitHub uses lower public rate limits.');
  if (!c.stackExchangeKey) w.push('STACKEXCHANGE_KEY not set — Stack Exchange uses lower keyless quota.');
  return w;
}

export default { registerProblemIntelligenceRoutes };
