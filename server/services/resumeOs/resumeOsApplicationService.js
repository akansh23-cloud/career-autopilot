import { normalizeResumeDocument, fromStructuredResume, toPlainText } from '../../utils/resume/resumeDocument.js';
import { structuredFromText } from '../../../web/src/lib/resumeDataModel.js';
import { runTailoring } from '../resumeTailoring/canonicalTailoringService.js';
import { evaluateResumeQuality } from './resumeQualityEvaluator.js';
import { detectResumeWeaknesses } from './weaknessDetector.js';
import { appendOptimizationPass, attemptedObjectives, hasVisited, readOptimizationHistory, resumeStateHash } from './optimizationHistory.js';
import { applyOptionalGeminiPolish } from './geminiPolish.js';
import { parseJDv2 } from '../../utils/resume/jdParserV2.js';
import { rankContentForTarget } from '../../utils/resume/jobMatchEngineV3.js';
import { buildAutoFitPlan } from '../../utils/resume/contentBudget.js';

export const RESUME_OS_APPLICATION_VERSION = 'resume-os-application-v1';
export const MIN_MEANINGFUL_DELTA = 0.5;
export const DEFAULT_MAX_OPTIMIZATION_PASSES = 7;

const OBJECTIVE_MODE = Object.freeze({
  weak_language: 'balanced',
  specificity: 'achievement-focus',
  evidence_utilization: 'achievement-focus',
  summary_quality: 'balanced',
  domain_authenticity: 'balanced',
  jd_alignment: 'ats-optimize',
  ats_supported_terminology: 'ats-optimize',
  naturalness: 'balanced',
  redundancy: 'concise',
  concision: 'concise',
  information_hierarchy: 'balanced',
});

function contextForQuality(context = {}) {
  return {
    verifiedSkills: context.verifiedSkills || [],
    profileSkills: context.profileSkills || [],
    verifiedProjectIds: context.verifiedProjectIds || [],
    evidenceIndex: context.evidenceIndex || null,
  };
}

export function documentFromInput({ doc = null, resumeText = '', targetRole = '', templateId = '' } = {}) {
  if (doc && typeof doc === 'object') return normalizeResumeDocument({ ...doc, targetRole: targetRole || doc.targetRole, templateId: templateId || doc.templateId });
  const text = String(resumeText || '').trim();
  if (!text) return normalizeResumeDocument({ targetRole, templateId: templateId || 'atlas' });
  const structured = structuredFromText(text);
  return normalizeResumeDocument({ ...fromStructuredResume(structured), targetRole, templateId: templateId || 'atlas', metadata: { importedFromPlainText: true } });
}

function standardLedger(run, aiPolish = null, objective = '') {
  const base = Array.isArray(run?.changes) ? run.changes : (run?.changes?.entries || []);
  const deterministic = base.filter((e) => e?.changed !== false && e?.enhanced && e?.original !== e?.enhanced).map((e) => ({
    path: e.section ? `${e.section}.${e.itemId || ''}.${e.bulletId || ''}` : '',
    section: e.section || '', itemId: e.itemId || '', bulletId: e.bulletId || '',
    before: e.original || '', after: e.enhanced || '', reason: e.reason || '', objective,
    evidence: e.evidenceId ? [e.evidenceId] : [], matchedRequirement: e.jobSignal || null,
    truthChecks: e.truthChecks || {}, source: 'deterministic', accepted: true,
  }));
  const ai = (aiPolish?.applied || []).map((e) => ({
    path: `bullet.${e.bulletId}`, section: '', itemId: '', bulletId: e.bulletId,
    before: e.before, after: e.after, reason: 'Optional Gemini wording candidate improved language and passed every Career Autopilot truth gate.', objective,
    evidence: [], matchedRequirement: null, truthChecks: e.truthChecks || {}, source: 'gemini-polish', accepted: true,
  }));
  return [...deterministic, ...ai];
}

function optimizationCeiling(run) {
  const insufficient = run?.rewriteStats?.insufficientEvidence || [];
  const missing = new Set();
  for (const row of insufficient) for (const m of row.missing || []) {
    const s = String(m || '').toLowerCase();
    if (s.includes('scale')) missing.add('scale');
    else if (s.includes('result') || s.includes('changed')) missing.add('result');
    else if (s.includes('tool') || s.includes('technology')) missing.add('tool/technology');
    else if (s.includes('responsibility')) missing.add('ownership/responsibility');
    else if (s.includes('how')) missing.add('method');
  }
  return { reached: insufficient.length > 0, missingEvidence: [...missing], affectedBullets: insufficient.map((x) => x.bulletId).filter(Boolean) };
}

function preflightAutoFit(doc, { jobDescription = '', context = {} } = {}) {
  const jdText = String(jobDescription || doc.targetJobDescription || '').trim();
  const jd = jdText.length >= 40 ? parseJDv2({ jobDescription: jdText, targetRole: doc.targetRole }) : null;
  const ranking = rankContentForTarget(doc, { jd, targetRole: doc.targetRole, verifiedSkills: context.verifiedSkills || [] });
  /* This phase has no production renderer measurement yet. Calling the shipped
     Auto-Fit engine with overflow=0 is an intentional preflight; the Studio
     follows it with measured overflow after browser pagination. */
  const plan = buildAutoFitPlan({ overflowLines: 0, density: doc.density, pageTarget: 1, ranking, doc });
  return { called: true, measured: false, pendingMeasurement: true, plan };
}

function markPendingAutoFit(doc, operation) {
  const d = normalizeResumeDocument(doc);
  return normalizeResumeDocument({ ...d, metadata: { ...(d.metadata || {}), pendingAutoFit: { requested: true, operation, at: new Date().toISOString() } } });
}

function clearPendingAutoFit(doc) {
  const d = normalizeResumeDocument(doc); const metadata = { ...(d.metadata || {}) }; delete metadata.pendingAutoFit;
  return normalizeResumeDocument({ ...d, metadata });
}

function engineRequest({ operation, doc, jobDescription, job, targetRole, mode, depth, plan, surface, context }) {
  return {
    operation, doc, jobDescription, job: job || {}, targetRole: targetRole || doc.targetRole,
    mode, depth, plan: plan || context.plan || 'free', surface,
    userKey: context.userKey || '', master: context.master || null,
    verifiedSkills: context.verifiedSkills || [], profileSkills: context.profileSkills || [],
    githubEvidence: context.githubEvidence || null,
  };
}

async function executeCanonical({ operation, doc, jobDescription = '', job = {}, targetRole = '', mode = 'balanced', depth = '', plan = '', surface = 'resume-os/application', context = {}, aiPolish = false, env = process.env, fetchImpl } = {}) {
  const beforeQuality = evaluateResumeQuality(doc, { ...contextForQuality(context), jobDescription, targetRole });
  const run = await runTailoring(engineRequest({ operation, doc, jobDescription, job, targetRole, mode, depth, plan, surface, context }));
  if (!run?.ok) return { ok: false, run, resumeDocument: doc, quality: beforeQuality, beforeQuality };

  const polish = await applyOptionalGeminiPolish({
    sourceDoc: doc, deterministicResult: run, jobDescription,
    context: { master: context.master, verifiedSkills: context.verifiedSkills, profileSkills: context.profileSkills, githubEvidence: context.githubEvidence },
    enabled: !!aiPolish, env, fetchImpl,
  });
  let resumeDocument = markPendingAutoFit(polish.doc || run.doc, operation);
  const quality = evaluateResumeQuality(resumeDocument, { ...contextForQuality(context), jobDescription, targetRole });
  const changeLedger = standardLedger(run, polish, operation);
  const autofit = preflightAutoFit(resumeDocument, { jobDescription, context });
  return {
    ok: true, version: RESUME_OS_APPLICATION_VERSION, operation, resumeDocument,
    beforeQuality, quality, changeLedger, truth: quality.truth, optimization: { ceiling: optimizationCeiling(run) },
    canonical: run, aiPolish: { enabled: !!aiPolish, available: polish.available, calls: polish.calls || 0, model: polish.model || null, applied: polish.applied?.length || 0, rejected: polish.rejected?.length || 0, error: polish.error || '' },
    autofit,
  };
}

export async function analyzeResume({ doc, resumeText = '', jobDescription = '', targetRole = '', context = {} } = {}) {
  const resumeDocument = documentFromInput({ doc, resumeText, targetRole });
  const quality = evaluateResumeQuality(resumeDocument, { ...contextForQuality(context), jobDescription, targetRole });
  const weaknesses = detectResumeWeaknesses(resumeDocument, quality, { hasJob: String(jobDescription || '').trim().length >= 40 });
  return { ok: true, version: RESUME_OS_APPLICATION_VERSION, operation: 'analyze', resumeDocument, quality, weaknesses, truth: quality.truth, optimization: { history: readOptimizationHistory(resumeDocument) }, aiPolish: { enabled: false, calls: 0 }, autofit: { called: false, reason: 'no_content_change' } };
}

export async function enhance({ doc, resumeText = '', targetRole = '', context = {}, aiPolish = false, mode = 'balanced', depth = '', plan = '', env, fetchImpl } = {}) {
  const resumeDocument = documentFromInput({ doc, resumeText, targetRole });
  return executeCanonical({ operation: 'enhance', doc: resumeDocument, targetRole, mode, depth, plan, surface: 'resume-os/enhance', context, aiPolish, env, fetchImpl });
}

export async function tailorForJob({ doc, resumeText = '', jobDescription = '', job = {}, targetRole = '', context = {}, aiPolish = false, mode = 'balanced', depth = '', plan = '', env, fetchImpl } = {}) {
  const resumeDocument = documentFromInput({ doc, resumeText, targetRole });
  return executeCanonical({ operation: 'job-tailor', doc: resumeDocument, jobDescription, job, targetRole, mode, depth, plan, surface: 'resume-os/job-tailor', context, aiPolish, env, fetchImpl });
}

export async function assistUnit({ doc, resumeText = '', targetRole = '', context = {}, scope = {}, kind = 'bullet', aiPolish = false, env, fetchImpl } = {}) {
  const resumeDocument = documentFromInput({ doc, resumeText, targetRole });
  const operation = kind === 'summary' ? 'summary-assist' : 'bullet-assist';
  const result = await executeCanonical({ operation, doc: resumeDocument, targetRole, surface: 'resume-os/assist', context, aiPolish, env, fetchImpl });
  if (scope && result.canonical?.changes) {
    /* Scoped compatibility remains delegated to canonical runTailoring; this
       application service never creates a second unit-rewrite engine. */
  }
  return result;
}

function chooseObjective(doc, quality, { jobDescription = '' } = {}) {
  const weaknesses = detectResumeWeaknesses(doc, quality, { hasJob: String(jobDescription).trim().length >= 40 }).weaknesses;
  const attempted = attemptedObjectives(doc);
  return weaknesses.find((w) => w.actionable && !attempted.has(w.objective)) || null;
}

async function improveOnce({ doc, jobDescription = '', job = {}, targetRole = '', context = {}, aiPolish = false, minDelta = MIN_MEANINGFUL_DELTA, env, fetchImpl } = {}) {
  const current = normalizeResumeDocument(doc);
  const beforeQuality = evaluateResumeQuality(current, { ...contextForQuality(context), jobDescription, targetRole });
  const selected = chooseObjective(current, beforeQuality, { jobDescription });
  if (!selected) {
    return { ok: true, operation: 'improve-again', accepted: false, converged: true, reason: 'no_actionable_unattempted_weakness', resumeDocument: current, beforeQuality, quality: beforeQuality, objective: null, history: readOptimizationHistory(current), changeLedger: [], aiPolish: { enabled: !!aiPolish, calls: 0 }, autofit: { called: false, reason: 'no_content_change' } };
  }
  const hasJob = String(jobDescription).trim().length >= 40;
  const operation = hasJob && ['jd_alignment', 'ats_supported_terminology'].includes(selected.objective) ? 'job-tailor' : 'enhance';
  const candidate = await executeCanonical({ operation, doc: current, jobDescription, job, targetRole, mode: OBJECTIVE_MODE[selected.objective] || 'balanced', depth: 'deep', plan: context.plan || 'premium', surface: `resume-os/improve:${selected.objective}`, context, aiPolish, env, fetchImpl });
  if (!candidate.ok) return { ...candidate, operation: 'improve-again', objective: selected.objective };
  const candidateHash = resumeStateHash(candidate.resumeDocument);
  const beforeHash = resumeStateHash(current);
  const revisits = candidateHash !== beforeHash && hasVisited(current, candidateHash);
  const delta = Number((candidate.quality.overall - beforeQuality.overall).toFixed(2));
  const accepted = !revisits && candidateHash !== beforeHash && delta >= minDelta && candidate.quality.hardFailures.length === 0;
  const pass = {
    pass: readOptimizationHistory(current).passes.length + 1,
    objective: selected.objective,
    weakness: selected.type,
    beforeScore: beforeQuality.overall,
    afterScore: candidate.quality.overall,
    delta,
    accepted,
    reason: revisits ? 'oscillation_prevented' : candidateHash === beforeHash ? 'no_material_change' : delta < minDelta ? 'below_minimum_delta' : candidate.quality.hardFailures.length ? 'truth_failure' : 'improved',
    acceptedChanges: accepted ? candidate.changeLedger : [],
    rejectedChanges: accepted ? [] : candidate.changeLedger,
    aiCalls: candidate.aiPolish?.calls || 0,
    beforeHash,
    afterHash: candidateHash,
  };
  const base = accepted ? candidate.resumeDocument : current;
  const withHistory = appendOptimizationPass(base, pass);
  return {
    ...candidate,
    operation: 'improve-again', objective: selected.objective, accepted, converged: false,
    resumeDocument: accepted ? markPendingAutoFit(withHistory, 'improve-again') : clearPendingAutoFit(withHistory),
    beforeQuality,
    quality: accepted ? evaluateResumeQuality(withHistory, { ...contextForQuality(context), jobDescription, targetRole }) : beforeQuality,
    history: readOptimizationHistory(withHistory),
    changeLedger: accepted ? candidate.changeLedger : [],
    rejectedChangeLedger: accepted ? [] : candidate.changeLedger,
    improvement: { delta, minDelta, revisits, reason: pass.reason },
    autofit: accepted ? candidate.autofit : { called: false, reason: 'candidate_rejected' },
  };
}

export async function improveAgain(args = {}) {
  const doc = documentFromInput(args);
  return improveOnce({ ...args, doc });
}

export async function optimizeResume({ doc, resumeText = '', jobDescription = '', job = {}, targetRole = '', context = {}, aiPolish = false, maxPasses = DEFAULT_MAX_OPTIMIZATION_PASSES, minDelta = MIN_MEANINGFUL_DELTA, env, fetchImpl } = {}) {
  let best = documentFromInput({ doc, resumeText, targetRole });
  const initialQuality = evaluateResumeQuality(best, { ...contextForQuality(context), jobDescription, targetRole });
  const passes = [];
  let stopReason = 'max_passes';
  const limit = Math.max(1, Math.min(8, Number(maxPasses) || DEFAULT_MAX_OPTIMIZATION_PASSES));
  for (let i = 0; i < limit; i++) {
    const step = await improveOnce({ doc: best, jobDescription, job, targetRole, context, aiPolish, minDelta, env, fetchImpl });
    passes.push({ objective: step.objective, accepted: !!step.accepted, before: step.beforeQuality?.overall, after: step.quality?.overall, reason: step.improvement?.reason || step.reason || '' });
    if (step.converged || !step.objective) { stopReason = step.reason || 'converged'; best = step.resumeDocument || best; break; }
    best = step.resumeDocument || best;
    const history = readOptimizationHistory(best);
    const remaining = detectResumeWeaknesses(best, evaluateResumeQuality(best, { ...contextForQuality(context), jobDescription, targetRole }), { hasJob: String(jobDescription).trim().length >= 40 }).weaknesses.filter((w) => !new Set(history.passes.map((p) => p.objective)).has(w.objective));
    if (!remaining.length) { stopReason = 'all_actionable_objectives_attempted'; break; }
    if (i === limit - 1) stopReason = 'max_passes';
  }
  const quality = evaluateResumeQuality(best, { ...contextForQuality(context), jobDescription, targetRole });
  const history = readOptimizationHistory(best);
  const weaknesses = detectResumeWeaknesses(best, quality, { hasJob: String(jobDescription).trim().length >= 40 });
  const converged = stopReason !== 'max_passes' || !weaknesses.weaknesses.some((w) => !new Set(history.passes.map((p) => p.objective)).has(w.objective));
  return {
    ok: true, version: RESUME_OS_APPLICATION_VERSION, operation: 'optimize',
    resumeDocument: best, beforeQuality: initialQuality, quality, passes, history, weaknesses,
    converged, stopReason, status: converged ? 'OPTIMIZED' : 'IMPROVED',
    improvement: { delta: Number((quality.overall - initialQuality.overall).toFixed(2)), acceptedPasses: passes.filter((p) => p.accepted).length, attemptedPasses: passes.length },
    truth: quality.truth,
    optimization: { ceiling: { reached: converged && quality.overall < 88, missingEvidence: weaknesses.weaknesses.filter((w) => ['LOW_SPECIFICITY', 'UNDERUSED_EVIDENCE'].includes(w.type)).map((w) => w.type.toLowerCase()) } },
    aiPolish: { enabled: !!aiPolish, calls: history.passes.reduce((n, p) => n + (p.aiCalls || 0), 0) },
    autofit: { called: true, measured: false, pendingMeasurement: true, plan: buildAutoFitPlan({ overflowLines: 0, density: best.density, pageTarget: 1, doc: best }) },
  };
}

export default { RESUME_OS_APPLICATION_VERSION, MIN_MEANINGFUL_DELTA, DEFAULT_MAX_OPTIMIZATION_PASSES, documentFromInput, analyzeResume, enhance, tailorForJob, assistUnit, improveAgain, optimizeResume };
