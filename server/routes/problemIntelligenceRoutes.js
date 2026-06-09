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
import { piConfig, resolveActiveProvider, ALL_SOURCES, INNOVATION_STATUSES, PROOF_GATED_STATUSES, INNOVATION_DISCLAIMER } from '../services/problemIntelligence/config.js';
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
import { simplifyProject } from '../services/problemIntelligence/simplifiedExplainerService.js';
import { validateIndiaCRI } from '../services/problemIntelligence/indiaCriValidatorService.js';
import { priorArtSearchPlan, claimDirections, evidenceChecklist, scoreEvidence, disclosureRiskCheck, diagramPlan, experimentPlan } from '../services/problemIntelligence/patentWorkflowService.js';
import { retrieveSimilar } from '../services/innovationMemory/retrievalService.js';
import { detectDuplicates } from '../services/innovationMemory/duplicateDetectionService.js';
import { ingestDiscovery, ingestProject } from '../services/innovationMemory/memoryIngestionService.js';
import * as store from '../services/problemIntelligence/store.js';

const discoverSchema = z.object({
  domain: z.string().trim().max(80).optional().default(''),
  targetUser: z.string().trim().max(80).optional().default(''),
  technology: z.string().trim().max(80).optional().default(''),
  goal: z.string().trim().max(120).optional().default(''),
  skills: z.array(z.string().trim().max(60)).max(30).optional().default([]),
  difficulty: z.string().trim().max(40).optional().default(''),
  purpose: z.enum(['portfolio', 'startup', 'research', 'patent-readiness']).optional().default('portfolio'),
  sources: z.array(z.enum(ALL_SOURCES)).max(11).optional().default([]),
  communities: z.object({
    redditSubreddits: z.array(z.string().trim().max(60)).max(10).optional().default([]),
    discourseForums: z.array(z.string().trim().max(200)).max(10).optional().default([]),
    specializedForums: z.array(z.string().trim().max(200)).max(10).optional().default([]),
    devtoTags: z.array(z.string().trim().max(40)).max(10).optional().default([]),
    hashnodeTags: z.array(z.string().trim().max(40)).max(10).optional().default([]),
    hackerNewsQuery: z.string().trim().max(120).optional().default(''),
  }).optional().default({}),
  manualProblems: z.array(z.object({
    title: z.string().trim().max(280), description: z.string().trim().max(2000).optional().default(''),
    tags: z.array(z.string().trim().max(40)).max(12).optional().default([]),
  })).max(30).optional().default([]),
  timeRange: z.enum(['30d', '90d', '1y', 'all', '']).optional().default(''),
  limit: z.number().int().min(1).max(40).optional().default(20),
}).passthrough();

const simplifySchema = z.object({
  audience: z.enum(['beginner', 'intermediate', 'faculty', 'recruiter', 'patent_agent']).optional().default('beginner'),
  detailLevel: z.enum(['simple', 'normal', 'detailed']).optional().default('normal'),
  project: z.any().optional(),
}).passthrough();

const evidenceSchema = z.object({
  type: z.string().trim().max(40),
  title: z.string().trim().max(200),
  url: z.string().trim().max(500).optional().default(''),
  description: z.string().trim().max(1000).optional().default(''),
  visibility: z.enum(['private', 'team', 'faculty', 'college', 'public_safe']).optional().default('private'),
  verified: z.boolean().optional().default(false),
  source: z.enum(['github', 'live_demo', 'upload', 'manual', 'screenshot', 'video', 'benchmark']).optional().default('manual'),
}).passthrough();

const disclosureRiskSchema = z.object({
  action: z.enum(['make_public', 'export_recruiter', 'post_linkedin', 'publish_github', 'share_disclosure', 'move_to_patent_review']).optional().default('make_public'),
  project: z.any().optional(),
}).passthrough();

const confidentialitySchema = z.object({
  confidentialityStatus: z.enum(['private', 'shared_with_faculty', 'shared_with_ip_cell', 'public_safe']).optional(),
  publicDisclosureStatus: z.enum(['none', 'planned', 'already_disclosed', 'unknown']).optional(),
  disclosureDate: z.string().trim().max(40).optional(),
  disclosureChannel: z.string().trim().max(120).optional(),
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
        github_discussions: { available: true, mode: c.githubToken ? 'authenticated' : 'public' },
        stackexchange: { available: true, mode: c.stackExchangeKey ? 'keyed' : 'keyless' },
        arxiv: { available: true, mode: 'public' },
        manual: { available: true, mode: 'manual' },
      },
      communitySources: {
        enabled: c.community.enabled,
        reddit: { enabled: c.community.reddit.enabled, configured: !!(c.community.reddit.clientId && c.community.reddit.clientSecret), note: (!c.community.reddit.enabled || !(c.community.reddit.clientId && c.community.reddit.clientSecret)) ? 'Reddit source is disabled. Add official Reddit API credentials and enable REDDIT_DISCOVERY_ENABLED=1.' : 'Reddit official API ready.' },
        hackernews: { enabled: c.community.hackernews.enabled, mode: 'public-api' },
        discourse: { enabled: c.community.discourse.enabled, allowlistCount: c.community.discourse.allowedBaseUrls.length, note: 'Only allowlisted Discourse base URLs are queried (DISCOURSE_ALLOWED_BASE_URLS).' },
        devto: { enabled: c.community.devto.enabled, mode: 'public-api' },
        hashnode: { enabled: c.community.hashnode.enabled, mode: 'public-api' },
        specialized_forum: { enabled: c.community.specializedForum.enabled, allowlistCount: c.community.specializedForum.allowedSources.length, note: 'Specialized forums must be allowlisted (SPECIALIZED_FORUM_ALLOWED_SOURCES).' },
        trustPolicy: 'Community discussions are early signals, not verified evidence. Community-only evidence caps IP-readiness at 55.',
      },
      memory: {
        enabled: c.memory.enabled,
        embeddingProvider: c.memory.embeddingProvider,
        vectorSearch: c.memory.vectorSearchEnabled,
        mode: c.memory.vectorSearchEnabled && ((c.memory.embeddingProvider === 'openai' && c.openaiKey) || (c.memory.embeddingProvider === 'gemini' && c.geminiKey)) ? 'vector' : 'keyword',
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

    // ---- RAG: retrieve similar past memory + ingest these signals/clusters (privacy-filtered) ----
    const rag = { memoryUsed: false, retrievedMemoryCount: 0, duplicateWarnings: [], mode: 'disabled' };
    if (c.memory.enabled) {
      try {
        const retrieval = await retrieveSimilar({ ...me(req), query: { title: input.goal || input.domain, keywords: ing.keywords, summary: (extracted.painPoints || []).join(' ') }, sourceTypes: ['generated_project', 'problem_cluster'], limit: 6, cfg: c });
        rag.memoryUsed = retrieval.retrievalUsed; rag.retrievedMemoryCount = retrieval.retrievedMemoryCount; rag.mode = retrieval.mode;
        rag.duplicateWarnings = retrieval.similarityWarnings || [];
        // store the new (safe) signals + clusters for future retrieval/dedupe
        await ingestDiscovery({ ...me(req), signals: extracted.signals, clusters, cfg: c });
      } catch (e) { /* memory is best-effort */ }
    }

    const sourceMix = ing.sourceMix || {};
    const mode = provider === 'fallback' ? 'fallback' : (sourceMix.communityOnly ? 'mixed' : (sourceMix.distinctTypes > 1 ? 'mixed' : 'source_backed'));
    if (sourceMix.communityOnly) warnings.push('Early community signal — validate with technical sources, prior-art search, and prototype evidence before treating as IP-worthy.');

    res.json({
      ok: true,
      mode,
      aiProvider: extracted.provider,
      confidence: extracted.confidence,
      signalsCount: ing.signalsCount,
      communitySignalsCount: ing.communitySignalsCount || 0,
      bySource: ing.bySource,
      sourceMix,
      painPoints: extracted.painPoints,
      clusters: clusters.map((cl) => publicCluster(cl, sourceMix)),
      rag,
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
    if (cluster.sources) project.sourceMix = { communityOnly: (cluster.sources.length > 0 && cluster.sources.every((s) => ['reddit', 'hackernews', 'discourse', 'devto', 'hashnode', 'specialized_forum'].includes(s))) };

    // Duplicate detection against memory BEFORE saving (skip near-duplicates).
    let duplicateInfo = { isDuplicate: false, duplicateCount: 0, duplicates: [], reason: '' };
    if (c.memory.enabled) {
      try { duplicateInfo = await detectDuplicates({ ...me(req), project, cfg: c }); } catch { /* best-effort */ }
    }
    if (duplicateInfo.isDuplicate && !req.body?.allowDuplicate) {
      return res.json({ ok: true, duplicate: true, skipped: true, duplicateCount: duplicateInfo.duplicateCount, duplicates: duplicateInfo.duplicates, message: duplicateInfo.reason || `${duplicateInfo.duplicateCount} similar idea(s) already exist in your workspace.`, db: dbOn(db) });
    }

    let saved = { ok: false };
    if (dbOn(db)) saved = await store.saveProject({ ...me(req), project });
    const id = saved.ok ? saved.project.id : project.fingerprint;
    // Ingest the generated project into memory for future duplicate detection / retrieval.
    if (c.memory.enabled) { try { await ingestProject({ ...me(req), project: { ...project, id }, cfg: c }); } catch { /* best-effort */ } }
    res.json({ ok: true, project: { ...project, id }, persisted: saved.ok, duplicate: !!saved.duplicate, similarSkipped: duplicateInfo.duplicates || [], db: dbOn(db) });
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
    const hasPrototypeEvidence = !!(project.convertedProjectId || project.linkedGithubRepoId || (project.evidence || []).length || req.body?.hasPrototypeEvidence);
    const ipReadiness = computeIPReadiness({ project, priorArtRecords, hasPrototypeEvidence, communityOnly: communityOnlyOf(project) });
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

  /* ============================================================
     Patent OS world-class upgrade — new endpoints
     ============================================================ */

  // Student Build Explainer — "Explain What To Build"
  app.post('/api/problem-intelligence/projects/:projectId/simplify', requireAuth, generationLimiter, validate(simplifySchema), ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const simplified = await simplifyProject({ project, audience: req.body.audience, detailLevel: req.body.detailLevel }, cfg());
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch: { simplified } });
    res.json({ ok: true, simplified, db: dbOn(db) });
  }));

  // India CRI / Section 3(k) validator
  app.post('/api/problem-intelligence/projects/:projectId/india-cri', requireAuth, ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const indiaCri = validateIndiaCRI(project);
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch: { indiaCri } });
    res.json({ ok: true, indiaCri, disclaimer: INNOVATION_DISCLAIMER, db: dbOn(db) });
  }));

  // Prior-art search plan
  app.post('/api/problem-intelligence/projects/:projectId/prior-art/search-plan', requireAuth, generationLimiter, ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const plan = priorArtSearchPlan(project);
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch: { priorArtSearchPlan: plan } });
    res.json({ ok: true, searchPlan: plan, note: 'External prior-art risk unknown until reviewed.', db: dbOn(db) });
  }));

  // Safe claim directions (NOT legal claims)
  app.post('/api/problem-intelligence/projects/:projectId/claim-directions', requireAuth, generationLimiter, ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const directions = await claimDirections({ project }, cfg());
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch: { claimDirections: directions } });
    res.json({ ok: true, claimDirections: directions, db: dbOn(db) });
  }));

  // Prototype evidence checklist
  app.post('/api/problem-intelligence/projects/:projectId/evidence-checklist', requireAuth, ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const checklist = evidenceChecklist(project);
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch: { evidenceChecklist: checklist } });
    res.json({ ok: true, evidenceChecklist: checklist, db: dbOn(db) });
  }));

  // Attach evidence metadata → bump prototype + IP readiness
  app.post('/api/problem-intelligence/projects/:projectId/evidence', requireAuth, validate(evidenceSchema), ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const item = { ...req.body, addedAt: new Date().toISOString() };
    const evidence = [...(project.evidence || []), item];
    const { prototypeEvidenceScore, hasPrototypeEvidence } = scoreEvidence(evidence);
    const priorArtRecords = persisted ? await store.listPriorArt({ ...me(req), projectId: req.params.projectId }) : (req.body?.priorArtRecords || []);
    const ipReadiness = computeIPReadiness({ project: { ...project, evidence }, priorArtRecords, hasPrototypeEvidence, communityOnly: communityOnlyOf(project) });
    const patch = { evidence, prototypeEvidenceScore, ipReadiness };
    if (item.source === 'github' && item.url) { patch.linkedGithubRepoId = item.url; patch.githubProofSummary = { url: item.url, title: item.title, verified: !!item.verified }; }
    if (hasPrototypeEvidence && ['project_blueprint_ready', 'source_backed_problem', 'poc_planned'].includes(project.status)) patch.status = 'prototype_ready';
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch });
    res.json({ ok: true, evidence, prototypeEvidenceScore, hasPrototypeEvidence, ipReadiness, db: dbOn(db) });
  }));

  // Confidentiality / disclosure-status update
  app.post('/api/problem-intelligence/projects/:projectId/confidentiality', requireAuth, validate(confidentialitySchema), ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const patch = {}; for (const k of ['confidentialityStatus', 'publicDisclosureStatus', 'disclosureDate', 'disclosureChannel']) if (k in req.body) patch[k] = req.body[k];
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch });
    res.json({ ok: true, confidentiality: { ...project, ...patch }, db: dbOn(db) });
  }));

  // Disclosure risk check (run BEFORE making public / posting / exporting)
  app.post('/api/problem-intelligence/projects/:projectId/disclosure-risk-check', requireAuth, validate(disclosureRiskSchema), ifEnabled(async (req, res) => {
    const { project } = await loadProject(req);
    if (!project) return notFound(res);
    const result = disclosureRiskCheck({ project, action: req.body.action });
    res.json({ ok: true, ...result, db: dbOn(db) });
  }));

  // Diagram plan (Mermaid text — no image generation)
  app.post('/api/problem-intelligence/projects/:projectId/diagram-plan', requireAuth, ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const plan = diagramPlan(project);
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch: { diagramPlan: plan } });
    res.json({ ok: true, diagramPlan: plan, db: dbOn(db) });
  }));

  // Benchmark / experiment plan
  app.post('/api/problem-intelligence/projects/:projectId/experiment-plan', requireAuth, ifEnabled(async (req, res) => {
    const { project, persisted } = await loadProject(req);
    if (!project) return notFound(res);
    const plan = experimentPlan(project);
    if (persisted) await store.updateProject({ ...me(req), id: req.params.projectId, patch: { experimentPlan: plan } });
    res.json({ ok: true, experimentPlan: plan, db: dbOn(db) });
  }));

  // Find similar past ideas (RAG, public-safe across users)
  app.get('/api/problem-intelligence/projects/:projectId/similar', requireAuth, ifEnabled(async (req, res) => {
    const project = await store.getProject({ ...me(req), id: req.params.projectId });
    const query = project
      ? { title: project.title, painPoint: project.painPoint, proposedSolution: project.proposedSolution }
      : { title: req.query.title || '', painPoint: req.query.q || '' };
    const result = await retrieveSimilar({ ...me(req), query, sourceTypes: ['generated_project', 'patent_idea', 'problem_cluster'], limit: 8, cfg: cfg() });
    res.json({ ok: true, ...result, db: dbOn(db) });
  }));

  // Reindex this user's memory from their stored projects/clusters
  app.post('/api/problem-intelligence/memory/reindex', requireAuth, generationLimiter, ifEnabled(async (req, res) => {
    if (!cfg().memory.enabled) return res.json({ ok: false, reason: 'memory_disabled' });
    if (!dbOn(db)) return res.json({ ok: false, reason: 'db_disabled', message: 'Memory reindex requires the database.' });
    const projects = await store.listProjects({ ...me(req) });
    let reindexed = 0;
    for (const p of projects) { const r = await ingestProject({ ...me(req), project: p, cfg: cfg() }); if (r.ok) reindexed += r.saved || 0; }
    res.json({ ok: true, reindexed, projects: projects.length, db: dbOn(db) });
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
function communityOnlyOf(project) {
  const mix = project && project.sourceMix;
  if (mix && typeof mix.communityOnly === 'boolean') return mix.communityOnly;
  const COMMUNITY = ['reddit', 'hackernews', 'discourse', 'devto', 'hashnode', 'specialized_forum'];
  const cites = (project && project.sourceCitations) || [];
  if (!cites.length) return false;
  return cites.every((c) => COMMUNITY.includes(c.source));
}
function notFound(res) { return res.status(404).json({ ok: false, error: 'not_found', message: 'Project not found. Pass the project in the body when DB is off.' }); }
function mergeIds(clusters, saved) {
  const byFp = Object.fromEntries(saved.map((s) => [s.dedupeFingerprint, s.id]));
  return clusters.map((c) => ({ ...c, id: byFp[c.dedupeFingerprint] || c.dedupeFingerprint, persisted: !!byFp[c.dedupeFingerprint] }));
}
function publicCluster(c, sourceMix = null) {
  const sources = c.sources || [];
  const COMMUNITY = ['reddit', 'hackernews', 'discourse', 'devto', 'hashnode', 'specialized_forum'];
  const communityCount = (c.signals || []).filter((s) => COMMUNITY.includes(s.source)).length;
  const distinctTypes = new Set(sources).size;
  const communityOnly = sources.length > 0 && sources.every((s) => COMMUNITY.includes(s));
  return {
    id: c.id || c.dedupeFingerprint, title: c.title, summary: c.summary, domain: c.domain, technology: c.technology, targetUser: c.targetUser,
    keywords: c.keywords || [], signalCount: c.signalCount || 0, sources, topSources: c.topSources || [],
    evidenceStrengthScore: c.evidenceStrengthScore, severityScore: c.severityScore, trendScore: c.trendScore,
    buildFeasibilityScore: c.buildFeasibilityScore, portfolioValueScore: c.portfolioValueScore,
    researchPotentialScore: c.researchPotentialScore, patentPotentialScore: c.patentPotentialScore,
    recommendedRoute: c.recommendedRoute, sourceBacked: (c.signalCount || 0) > 0 && (c.evidenceStrengthScore || 0) >= 25,
    badge: ((c.signalCount || 0) > 0 && (c.evidenceStrengthScore || 0) >= 25) ? 'Source-backed' : 'Fallback draft',
    communitySignalCount: communityCount,
    privacySafe: true,
    corroborated: distinctTypes >= 2 && !communityOnly,
    validationNeeded: communityOnly || distinctTypes < 2,
    validationLabel: communityOnly ? 'Early community signal — needs validation' : (distinctTypes >= 2 ? 'Corroborated across multiple sources' : 'Single-source signal — validate before relying on it'),
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
