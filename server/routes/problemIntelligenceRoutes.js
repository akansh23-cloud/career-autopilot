import express from 'express';
import { discover, synthesizeProject, estimateFeasibilityAndCost, assessIPReadiness, generateDisclosureOutline, problemIntelligenceConfig } from '../services/problemIntelligence/index.js';

function safeInput(body = {}) {
  return {
    domain: String(body.domain || '').slice(0, 80),
    targetUser: String(body.targetUser || '').slice(0, 120),
    technology: String(body.technology || '').slice(0, 80),
    goal: String(body.goal || '').slice(0, 160),
    problem: String(body.problem || '').slice(0, 4000),
    existingSolutions: String(body.existingSolutions || '').slice(0, 4000),
    difficulty: String(body.difficulty || '').slice(0, 80),
    purpose: String(body.purpose || 'portfolio').slice(0, 80),
    skills: Array.isArray(body.skills) ? body.skills.map(String).slice(0, 30) : String(body.skills || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30),
    sources: Array.isArray(body.sources) ? body.sources.map(String).slice(0, 5) : undefined,
    timeRange: String(body.timeRange || '').slice(0, 80),
    limit: Math.min(Math.max(Number(body.limit || process.env.PROBLEM_DISCOVERY_MAX_SIGNALS || 24), 3), 50),
  };
}

function projectToSubmission(project = {}) {
  return {
    title: project.title || 'Innovation project',
    description: [
      `Pain point: ${project.painPoint || ''}`,
      `Solution: ${project.proposedSolution || ''}`,
      `Novelty angle: ${project.noveltyAngle || ''}`,
      `MVP: ${(project.mvpScope || []).join('; ')}`,
      `Demo: ${(project.demoScript || []).join('; ')}`,
    ].filter(Boolean).join('\n\n').slice(0, 8000),
    roleInProject: 'Builder / inventor',
    technologies: (project.requiredSkills || []).slice(0, 30),
    claimedSkills: (project.requiredSkills || []).slice(0, 30),
    proofUrls: (project.sourceCitations || []).map((c) => c.url).filter(Boolean).slice(0, 10),
    complexityLevel: project.costEstimate?.difficulty || 'intermediate',
    contributionType: 'Source-backed innovation project generated from public problem signals.',
    outcome: project.costEstimate?.verdict || 'Build MVP, collect evidence, and prepare recruiter/IP-review package.',
  };
}

function projectToPatentIdea(project = {}) {
  const ip = project.ipReadiness || {};
  return {
    title: project.title || 'Innovation project',
    domain: project.domain || '',
    targetUser: (project.affectedUsers || [])[0] || '',
    problem: project.painPoint || '',
    existingSolutions: project.currentWorkaround || '',
    proposedSolution: project.proposedSolution || '',
    technicalMechanism: [project.technicalChallenge, project.noveltyAngle].filter(Boolean).join(' '),
    inputData: 'Source/problem signals, user inputs, implementation evidence, and test scenarios.',
    processingLogic: 'Ingest signals → extract pain points → cluster problem → score feasibility/IP-readiness → produce build plan and evidence checklist.',
    outputResult: 'A source-backed project blueprint and IP-review package.',
    feedbackLoop: 'Prototype results, prior-art records, and faculty/reviewer feedback update readiness score and roadmap.',
    noveltyAngle: project.noveltyAngle || '',
    marketUseCase: project.hook || '',
    implementationPlan: (project.buildRoadmap || []).map((r) => `${r.phase}: ${(r.tasks || []).join(', ')}`).join('\n'),
    tags: ['source-backed', 'innovation', ip.recommendedIPRoute || 'portfolio'].filter(Boolean),
    source: project.sourceMode || 'problem-intelligence',
    score: { overall: ip.overall || 0, grade: ip.label || 'Needs review', riskLevel: ip.externalPriorArtRisk === 'Unknown' ? 'Medium' : 'Medium' },
    riskWarnings: ip.capsApplied || [],
    strengtheningSuggestions: ip.requiredEvidence || [],
  };
}

export function createProblemIntelligenceRouter({ db, requireAuth, generationLimiter, currentUser, persistenceStatus, verifyProjectSubmission }) {
  const router = express.Router();

  router.get('/config', requireAuth, (req, res) => {
    res.json({ ok: true, ...problemIntelligenceConfig(), db: db.dbEnabled() });
  });

  router.post('/discover', requireAuth, generationLimiter, async (req, res) => {
    const u = currentUser(req);
    const input = safeInput(req.body || {});
    const result = await discover(input);
    let persisted = { ok: false, clusters: result.clusters, signals: result.signals };
    if (db.saveProblemIntelligenceRun) persisted = await db.saveProblemIntelligenceRun({ userId: u?.id, email: u?.email, signals: result.signals, clusters: result.clusters });
    res.status(persistenceStatus(persisted)).json({
      ...result,
      signals: undefined,
      clusters: persisted.clusters || result.clusters,
      signalsCount: result.signalsCount,
      db: db.dbEnabled(),
      persistence: { ok: persisted.ok, reason: persisted.reason || null },
    });
  });

  router.get('/clusters', requireAuth, async (req, res) => {
    const u = currentUser(req);
    const clusters = db.listProblemClusters ? await db.listProblemClusters({ userId: u?.id, email: u?.email }) : [];
    res.json({ ok: true, clusters, db: db.dbEnabled() });
  });

  router.get('/clusters/:clusterId', requireAuth, async (req, res) => {
    const u = currentUser(req);
    const cluster = db.getProblemCluster ? await db.getProblemCluster({ userId: u?.id, email: u?.email, id: req.params.clusterId }) : null;
    if (!cluster) return res.status(404).json({ error: 'not_found', message: 'Problem cluster not found.' });
    res.json({ ok: true, cluster, db: db.dbEnabled() });
  });

  router.post('/clusters/:clusterId/generate-project', requireAuth, generationLimiter, async (req, res) => {
    const u = currentUser(req);
    const input = safeInput(req.body?.input || req.body || {});
    let cluster = req.body?.cluster || null;
    if (!cluster && db.getProblemCluster) cluster = await db.getProblemCluster({ userId: u?.id, email: u?.email, id: req.params.clusterId });
    if (!cluster) return res.status(404).json({ error: 'not_found', message: 'Problem cluster not found. Re-run discovery or pass the cluster payload.' });
    const project = synthesizeProject(cluster, input);
    const saved = db.saveGeneratedInnovationProject ? await db.saveGeneratedInnovationProject({ userId: u?.id, email: u?.email, project }) : { ok: false, reason: 'db_disabled', project };
    res.status(persistenceStatus(saved)).json({ ok: true, project: saved.project || project, db: db.dbEnabled(), persistence: { ok: saved.ok, reason: saved.reason || null } });
  });

  router.post('/projects/:projectId/build-blueprint', requireAuth, async (req, res) => {
    const u = currentUser(req);
    const project = db.getGeneratedInnovationProject ? await db.getGeneratedInnovationProject({ userId: u?.id, email: u?.email, id: req.params.projectId }) : null;
    if (!project) return res.status(404).json({ error: 'not_found', message: 'Generated project not found.' });
    res.json({ ok: true, blueprint: { architecture: project.technicalArchitecture, roadmap: project.buildRoadmap, repoStructure: project.githubRepoStructure, testPlan: project.testPlan, demoScript: project.demoScript }, db: db.dbEnabled() });
  });

  router.post('/projects/:projectId/cost-estimate', requireAuth, async (req, res) => {
    const u = currentUser(req);
    const project = db.getGeneratedInnovationProject ? await db.getGeneratedInnovationProject({ userId: u?.id, email: u?.email, id: req.params.projectId }) : null;
    if (!project) return res.status(404).json({ error: 'not_found', message: 'Generated project not found.' });
    res.json({ ok: true, costEstimate: estimateFeasibilityAndCost(project, req.body || {}), db: db.dbEnabled() });
  });

  router.post('/projects/:projectId/ip-readiness', requireAuth, async (req, res) => {
    const u = currentUser(req);
    const project = db.getGeneratedInnovationProject ? await db.getGeneratedInnovationProject({ userId: u?.id, email: u?.email, id: req.params.projectId }) : null;
    if (!project) return res.status(404).json({ error: 'not_found', message: 'Generated project not found.' });
    res.json({ ok: true, ipReadiness: assessIPReadiness(project, {}, req.body || {}, req.body || {}), db: db.dbEnabled() });
  });

  router.post('/projects/:projectId/convert-to-project', requireAuth, generationLimiter, async (req, res) => {
    const u = currentUser(req);
    const project = db.getGeneratedInnovationProject ? await db.getGeneratedInnovationProject({ userId: u?.id, email: u?.email, id: req.params.projectId }) : req.body?.project;
    if (!project) return res.status(404).json({ error: 'not_found', message: 'Generated project not found.' });
    const submission = projectToSubmission(project);
    const result = verifyProjectSubmission ? verifyProjectSubmission(submission) : { projectVerificationStatus: 'pending', pendingSkills: submission.claimedSkills, xpPending: 0, verificationNotes: ['Pending review.'] };
    const saved = await db.saveProjectSubmission({ userId: u?.id, email: u?.email, submission, result });
    if (saved.ok && db.updateGeneratedInnovationProjectLinks) await db.updateGeneratedInnovationProjectLinks({ userId: u?.id, email: u?.email, id: req.params.projectId, convertedProjectId: saved.id });
    res.status(persistenceStatus(saved)).json({ ok: saved.ok, projectId: saved.id || null, submission, db: db.dbEnabled() });
  });

  router.post('/projects/:projectId/convert-to-patent', requireAuth, generationLimiter, async (req, res) => {
    const u = currentUser(req);
    const project = db.getGeneratedInnovationProject ? await db.getGeneratedInnovationProject({ userId: u?.id, email: u?.email, id: req.params.projectId }) : req.body?.project;
    if (!project) return res.status(404).json({ error: 'not_found', message: 'Generated project not found.' });
    const idea = projectToPatentIdea(project);
    const saved = await db.createPatentIdeas({ userId: u?.id, email: u?.email, ideas: [idea], generationWhy: 'Converted from source-backed Problem Intelligence project.' });
    const ideaId = saved.ideas?.[0]?.id || null;
    if (ideaId && db.updateGeneratedInnovationProjectLinks) await db.updateGeneratedInnovationProjectLinks({ userId: u?.id, email: u?.email, id: req.params.projectId, convertedPatentIdeaId: ideaId });
    res.status(persistenceStatus(saved)).json({ ok: saved.ok, patentIdeaId: ideaId, idea, db: db.dbEnabled() });
  });

  router.post('/projects/:projectId/generate-disclosure', requireAuth, async (req, res) => {
    const u = currentUser(req);
    const project = db.getGeneratedInnovationProject ? await db.getGeneratedInnovationProject({ userId: u?.id, email: u?.email, id: req.params.projectId }) : null;
    if (!project) return res.status(404).json({ error: 'not_found', message: 'Generated project not found.' });
    res.json({ ok: true, disclosure: generateDisclosureOutline(project), disclaimer: 'Not legal advice. Draft for faculty/IP-cell/patent-agent review only.', db: db.dbEnabled() });
  });

  return router;
}
