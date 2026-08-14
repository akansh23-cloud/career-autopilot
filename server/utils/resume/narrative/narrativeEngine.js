/* ============================================================
   NARRATIVE ENGINE — the orchestrator
   ------------------------------------------------------------
   The ONLY entry point. Two modes, one pipeline:

     enhanceResumeNarrative()  strongest general-market version
     tailorResumeNarrative()   targeted at one specific opportunity

   Both run every stage; tailor additionally builds Job Intelligence,
   optional external context, and re-plans the information
   architecture around the target.

   Everything degrades:
     no DB          → works (evidence comes from the document)
     no AI key      → works (deterministic composition)
     no network     → works (external research skipped)
     AI malformed   → works (candidate discarded, others remain)
     weak evidence  → works (nothing is fabricated; gaps reported)
   ============================================================ */
import { normalizeResumeDocument, normalizeBullet, PROVENANCE } from '../resumeDocument.js';
import { buildEvidenceGraph } from './evidenceGraph.js';
import { buildCandidateIntelligence, buildVoiceFingerprint } from './candidateIntelligence.js';
import { buildJobIntelligence } from './jobIntelligence.js';
import { researchRoleContext, NullSearchProvider, researchCache } from './externalContext.js';
import { vocabularyFor } from './domainVocabulary.js';
import { planContentStrategy, planCompression } from './contentStrategy.js';
import { composeCandidates, planSectionIntents, inferIntent } from './bulletComposer.js';
import { rerankCandidates, shapeOf, WEAK_OPENER_RE } from './bulletScoring.js';
import { repairDocument } from './resumeConsistency.js';
import { classifySkills, prioritizeSkills, buildTerminologyAlignment } from './skillIntelligence.js';
import { analyzeAtsAlignment, alignmentOpportunities } from './atsSemantics.js';
import { analyzeNaturalness, assessGenericity } from './naturalness.js';
import { buildDocumentFrequency } from './phraseQuality.js';
import { composeSummary } from './summaryComposer.js';
import { auditGeneratedDocument, findUntracedMetrics } from './truthValidator.js';
import { ChangeLedger, NarrativeTelemetry, reasonCodesFor, jobSignalFor } from './changeLedger.js';
import { createNarrativeRouter, UsageLedger } from './narrativeProviders.js';
import { buildRequirementGraph, SUPPORT_STATE } from './requirementGraph.js';
import {
  auditAndRevert, buildTermSurfaces, DEFAULT_SURFACE_ALIASES, TAILORING_STATUS,
} from './requirementLeakage.js';
import { resolveMode, resolveDepth } from '../../../services/resumeTailoring/modes.js';

export const NARRATIVE_ENGINE_VERSION = 'resume-narrative-engine-v1';

export const NARRATIVE_ENGINE_VERSIONS = Object.freeze({
  engine: NARRATIVE_ENGINE_VERSION,
  evidenceGraph: 'evidence-graph-v1',
  candidateIntelligence: 'candidate-intelligence-v1',
  voice: 'voice-fingerprint-v1',
  jobIntelligence: 'job-intelligence-v1',
  externalContext: 'external-context-v1',
  vocabulary: 'domain-vocabulary-v1',
  phraseQuality: 'phrase-quality-v1',
  contentStrategy: 'content-strategy-v1',
  composer: 'bullet-composer-v1',
  scoring: 'bullet-scoring-v1',
  consistency: 'resume-consistency-v1',
  skillIntelligence: 'skill-intelligence-v1',
  atsSemantics: 'ats-semantics-v1',
  naturalness: 'naturalness-v1',
  genericityGuard: 'genericity-guard-v1',
  summary: 'narrative-summary-composer-v1',
  truthValidator: 'narrative-truth-validator-v1',
  changeLedger: 'change-ledger-v1',
  providers: 'narrative-providers-v1',
  telemetry: 'narrative-telemetry-v1',
  requirementGraph: 'requirement-graph-v1',
  requirementLeakage: 'requirement-leakage-v1',
});

const MAX_AI_UNITS = 24; // cost ceiling: AI is only asked about the top N units

/* ------------------------------------------------------------------ */
/* Core pipeline                                                       */
/* ------------------------------------------------------------------ */
async function runPipeline(doc, ctx) {
  const {
    mode, master, verifiedSkills, profileSkills, githubEvidence, jobDescription, job,
    userKey, router, telemetry, searchProvider, useExternalResearch, targetRole,
    maxBulletsCurrent, maxBulletsPrevious, maxProjects, useAi,
    strategy: modeStrategy, depth,
  } = ctx;

  const d = normalizeResumeDocument(doc);
  const ledger = new ChangeLedger();

  /* ---- stage 2: evidence graph ---- */
  telemetry.begin('evidence_graph');
  const graph = buildEvidenceGraph(d, { master, verifiedSkills, profileSkills, githubEvidence });
  telemetry.end('evidence_graph', { records: graph.counts.total });
  telemetry.count('evidenceRecords', graph.counts.total);

  /* ---- stage 2b/5: candidate intelligence + voice ---- */
  telemetry.begin('candidate_intelligence');
  const intelligence = buildCandidateIntelligence(d, graph, { targetRole });
  const voice = buildVoiceFingerprint(graph, { doc: d });
  telemetry.end('candidate_intelligence', { family: intelligence.roleFamily, seniority: intelligence.seniority });

  /* ---- stages 3+4: job intelligence + external context (parallel) ---- */
  let jobIntel = null;
  let externalContext = null;
  if (mode === 'tailor' && String(jobDescription || '').trim().length >= 40) {
    telemetry.begin('job_intelligence');
    const jobPromise = Promise.resolve().then(() => buildJobIntelligence({ jobDescription, job, targetRole }));
    const researchPromise = useExternalResearch
      ? researchRoleContext({
        company: job?.company || '', role: job?.title || targetRole || '',
        provider: searchProvider || NullSearchProvider,
      }).catch(() => null)
      : Promise.resolve(null);
    const [ji, rc] = await Promise.all([jobPromise, researchPromise]);
    jobIntel = ji;
    externalContext = rc;
    if (rc) {
      telemetry.count('researchCalls', rc.sources?.length || 0);
      if (rc.cached) telemetry.count('researchCacheHits');
    }
    telemetry.end('job_intelligence', { hash: jobIntel?.hash, research: !!rc?.available });
  }

  /* Effective seniority: the candidate's evidence-supported level, never the
     job's. A JD asking for a senior does not make the candidate one. */
  const seniority = intelligence.seniority;
  const vocab = vocabularyFor(intelligence.roleFamily, { seniority });

  /* ---- stage 14: skill intelligence ---- */
  telemetry.begin('skill_intelligence');
  const targetSkills = jobIntel
    ? (jobIntel.prioritySkills || []).map((p) => p.skill)
    : [...new Set([...(intelligence.coreTechnologies || []).map((t) => t.skill)])];
  const classification = classifySkills(targetSkills, graph, { verifiedSkills });
  const terminologyAlignment = buildTerminologyAlignment(classification, jobIntel);
  telemetry.end('skill_intelligence', {
    supported: classification.supported.length,
    partial: classification.partiallySupported.length,
    unsupported: classification.unsupported.length,
  });

  /* ---- requirement graph (P2.11–P2.13) ----
     Resolves JD requirements into AND/OR groups with explicit support
     states, so an OR group satisfied by OpenShift does not quietly make
     "Kubernetes" a claimable word. */
  telemetry.begin('requirement_graph');
  const evidenceIndex = new Map();
  for (const rec of graph.records || []) {
    for (const sk of rec.skills || []) {
      const k = String(sk).toLowerCase();
      const list = evidenceIndex.get(k) || [];
      if (!list.includes(rec.id)) list.push(rec.id);
      evidenceIndex.set(k, list);
    }
  }
  const requirementGraph = jobIntel
    ? buildRequirementGraph(jobIntel, classification, {
      evidenceIndex, requirementDepth: depth.requirementDepth,
    })
    : null;
  telemetry.end('requirement_graph', {
    groups: requirementGraph?.counts.total || 0,
    supported: requirementGraph?.counts.supported || 0,
    unsupported: requirementGraph?.counts.unsupported || 0,
  });
  if (requirementGraph) {
    telemetry.count('requirementsSupported', requirementGraph.counts.supported);
    telemetry.count('requirementsTransferable', requirementGraph.counts.transferable);
    telemetry.count('requirementsUnsupported', requirementGraph.counts.unsupported);
  }

  /* Forbidden vocabulary: every JD term the evidence does not support.
     Surfaces include abbreviations so "K8s" trips the same wire. */
  const forbiddenTerms = new Set(requirementGraph?.forbiddenTerms || []);
  const termSurfaces = buildTermSurfaces([...forbiddenTerms], DEFAULT_SURFACE_ALIASES);

  /* Entities the candidate genuinely has: employers, role titles, project and
     product names, and their own technologies. The employer-grounding check
     needs these, otherwise it flags the candidate's own job title as an
     invented organisation the moment a rewrite rephrases the sentence. */
  const knownEntities = new Set();
  for (const rec of graph.records || []) {
    for (const v of [rec.company, rec.role, rec.projectName]) {
      if (v) knownEntities.add(String(v));
    }
    for (const sk of rec.skillsDisplay || rec.skills || []) knownEntities.add(String(sk));
  }
  for (const e of d.experience || []) {
    if (e.company) knownEntities.add(String(e.company));
    if (e.role) knownEntities.add(String(e.role));
  }
  for (const p of d.projects || []) if (p.name) knownEntities.add(String(p.name));
  for (const ed of d.education || []) if (ed.school) knownEntities.add(String(ed.school));
  for (const sk of d.skills || []) if (sk.name) knownEntities.add(String(sk.name));
  if (d.contact?.title) knownEntities.add(String(d.contact.title));
  if (targetRole) knownEntities.add(String(targetRole));
  /* Individual words of multi-word entities, so "Engineer" from "DevOps
     Engineer" is recognised rather than treated as a new organisation. */
  for (const e of [...knownEntities]) {
    for (const w of String(e).split(/\s+/)) if (w.length > 2) knownEntities.add(w);
  }
  const auditCtx = { forbiddenTerms, termSurfaces, knownEntities: [...knownEntities] };

  /* Terminology pairs the composer may apply — derived only from SUPPORTED
     skills, so no unsupported keyword can enter through this door. */
  const targetTerms = terminologyAlignment.map((t) => ({ from: t.from, to: t.to }));
  /* External context contributes vocabulary preferences ONLY where the term is
     already a supported candidate skill. */
  if (externalContext?.available) {
    const supported = new Set(classification.supported.map((s) => s.canonical));
    for (const t of externalContext.terminology) {
      if (supported.has(t.term)) targetTerms.push({ from: t.term, to: t.term });
    }
  }

  /* ---- stages 8/13: content strategy + compression ---- */
  telemetry.begin('content_strategy');
  const strategy = planContentStrategy(d, graph, {
    jobIntel, seniority, mode,
    maxBulletsCurrent, maxBulletsPrevious, maxProjects,
    /* P1.5 — fresher mode genuinely weights projects up rather than
       merely declaring that it would. */
    projectFirst: modeStrategy.projectFirst,
    targetBulletLength: modeStrategy.targetBulletLength,
  });
  telemetry.end('content_strategy', { roles: strategy.roles.length, projects: strategy.projects.length });

  /* ---- stages 9/10/11: intent planning, composition, reranking ---- */
  telemetry.begin('composition');
  const documentFrequency = buildDocumentFrequency(graph.records.map((r) => r.rawText).filter(Boolean));
  const corpusShapes = new Map();

  /* Pre-select the units that will actually be written, respecting budgets. */
  const units = [];
  for (const group of [...strategy.roles, ...strategy.projects]) {
    const compression = planCompression(group, { budget: group.bulletBudget });
    telemetry.count('compressionOps', compression.ops.length);
    for (const op of compression.ops) {
      strategy.decisions.push({ action: op.op, target: group.label, evidenceId: op.evidenceId, reason: op.reason });
    }
    const dropped = new Set(compression.droppedIds);
    const surviving = group.records.filter((r) => !dropped.has(r.record.id)).slice(0, group.bulletBudget);
    for (const r of surviving) units.push({ group, record: r.record, relevance: r.relevance, quality: r.quality });
  }
  /* P2.26 — hard performance ceiling, depth-aware and bounded either way. */
  if (units.length > depth.maxUnits) units.length = depth.maxUnits;

  /* Tense is unified PER ROLE from how the candidate wrote that role. A role
     where four bullets are past tense and one is undated must not come back
     half past and half present. */
  for (const group of [...strategy.roles, ...strategy.projects]) {
    const groupUnits = units.filter((u) => u.group.key === group.key);
    if (!groupUnits.length) continue;
    const votes = { past: 0, present: 0 };
    for (const u of groupUnits) {
      const t = u.record.detectedTense;   // only bullets that actually declared one vote
      if (t === 'past' || t === 'present') votes[t] += 1;
    }
    const dominant = votes.present > votes.past ? 'present' : votes.past > 0 ? 'past' : (group.current ? 'present' : 'past');
    for (const u of groupUnits) u.record.tense = dominant;
  }

  /* Intent planning per group so a single role does not repeat one idea. */
  const intentByEvidence = new Map();
  for (const group of [...strategy.roles, ...strategy.projects]) {
    const groupUnits = units.filter((u) => u.group.key === group.key).map((u) => u.record);
    if (!groupUnits.length) continue;
    /* Mode intent preference leads; JD-derived preference follows. A mode
       that says it favours outcomes must actually reorder intents. */
    const preferred = [
      ...(modeStrategy.intentPreference || []),
      ...(jobIntel ? preferredIntentsFor(jobIntel) : []),
    ];
    for (const p of planSectionIntents(groupUnits, { maxSameIntent: 2, preferred })) {
      intentByEvidence.set(p.evidenceId, p.intent);
    }
  }

  /* Optional AI assistance for the highest-value units only (cost control). */
  const aiByEvidence = new Map();
  if (useAi && router.available()) {
    const ranked = units.slice().sort((a, b) => (b.relevance + b.quality) - (a.relevance + a.quality)).slice(0, MAX_AI_UNITS);
    const results = await Promise.all(ranked.map(async (u) => {
      try {
        const out = await router.generateBulletCandidates({
          evidence: u.record,
          vocabulary: vocab,
          intent: intentByEvidence.get(u.record.id) || 'delivery',
          seniority,
          targetTerms: (jobIntel?.prioritySkills || []).slice(0, 8).map((p) => p.skill),
          count: 3,
          voice,
        });
        telemetry.count('aiCalls');
        if (!out.ok) { telemetry.count('aiFailures'); return null; }
        return { id: u.record.id, candidates: out.data.candidates };
      } catch {
        telemetry.count('aiFailures');
        return null;
      }
    }));
    for (const r of results) if (r) aiByEvidence.set(r.id, r.candidates);
    if (!aiByEvidence.size) telemetry.count('fallbacksUsed');
  }

  const selections = [];
  for (const u of units) {
    const intent = intentByEvidence.get(u.record.id) || inferIntent(u.record).intent;
    const composition = composeCandidates(u.record, {
      roleFamily: intelligence.roleFamily,
      seniority,
      intent,
      userKey,
      targetTerms,
      voice,
      /* Ownership bias may nudge register but the ceiling is absolute:
         Math.max(0, ...) keeps a negative bias from going below "exposure"
         and the ceiling itself is never raised. */
      ownershipCeiling: intelligence.ownershipCeiling,
      ownershipBias: modeStrategy.ownershipBias || 0,
      globalPermittedSkills: graph.permittedSkills,
      aiCandidates: aiByEvidence.get(u.record.id) || [],
      /* P1.6 — depth buys more deterministic candidates, not a different engine. */
      maxCandidates: depth.alternativesPerBullet,
      targetBulletLength: modeStrategy.targetBulletLength,
      preferOutcomeLed: !!modeStrategy.preferOutcomeLed,
      forbiddenTerms,
    });
    telemetry.count('candidatesGenerated', composition.generated);
    telemetry.count('candidatesRejected', composition.rejectedCount);
    telemetry.count('rejectedHallucinations', composition.rejected.filter((r) => (r.violations || []).some((v) => v.severity === 'critical')).length);
    telemetry.count('bulletsEvaluated');

    const ranked = rerankCandidates(composition.accepted, {
      evidence: u.record,
      jobIntel,
      roleFamily: intelligence.roleFamily,
      seniority,
      voice,
      documentFrequency,
      corpusShapes,
      intent,
      targetRole: jobIntel?.roleIdentity?.canonicalRole || targetRole,
      domainAvoid: vocab.avoid,
      /* P1.5 — mode weighting is applied, not just declared. */
      weights: modeStrategy.weights,
      targetBulletLength: modeStrategy.targetBulletLength,
      keep: Math.max(depth.rerankKeep, modeStrategy.rerankDepth || 0),
      requirementGraph,
    });

    const chosen = ranked[0];
    if (!chosen) continue;
    corpusShapes.set(shapeOf(chosen.text), (corpusShapes.get(shapeOf(chosen.text)) || 0) + 1);

    selections.push({
      group: u.group,
      evidence: u.record,
      intent,
      chosen,
      ranked,
      rejected: composition.rejected,
      originalText: u.record.rawText,
    });
  }
  telemetry.end('composition', { units: units.length, selections: selections.length });

  /* ---- stage 12: resume-level consistency ---- */
  telemetry.begin('consistency');
  /* P1.6 / P2.16 — deep mode runs additional resume-level passes. Each pass
     may swap in an already-truth-checked alternate candidate, so extra passes
     cannot introduce a claim the first pass would have rejected. */
  let repaired = repairDocument(selections, { jobIntel, seniority });
  let consistencyRepairs = repaired.repairs.length;
  for (let pass = 1; pass < depth.consistencyPasses; pass += 1) {
    const again = repairDocument(repaired.selections, { jobIntel, seniority });
    if (!again.repairs.length) break;
    repaired = again;
    consistencyRepairs += again.repairs.length;
    telemetry.count('extraConsistencyPasses');
  }
  telemetry.count('repetitionRepairs', consistencyRepairs);
  telemetry.count('terminologyNormalisations', repaired.terminologyChanges.length);
  telemetry.end('consistency', { repairs: consistencyRepairs, remaining: repaired.remainingIssues.length, passes: depth.consistencyPasses });

  /* ---- P1.3 — FAIL-CLOSED REQUIREMENT LEAKAGE AUDIT ----
     Runs BEFORE the summary and the ledger, so a reverted bullet is
     reverted everywhere downstream rather than surviving in one
     representation of the document and not another. */
  telemetry.begin('leakage_audit');
  const proposed = repaired.selections.map((sel, i) => ({
    changeId: `chg-${i + 1}`,
    section: sel.evidence.section,
    bulletId: sel.evidence.bulletId,
    evidenceId: sel.evidence.id,
    before: sel.originalText,
    after: sel.chosen.text,
    truthChecks: sel.chosen.verdicts || sel.chosen.truthChecks || {},
  }));
  const leakageAudit = auditAndRevert(proposed, auditCtx);
  /* Apply reversions to the selections themselves. */
  const verdictById = new Map(leakageAudit.changes.map((c) => [c.changeId, c]));
  repaired.selections.forEach((sel, i) => {
    const v = verdictById.get(`chg-${i + 1}`);
    if (!v) return;
    sel.safe = v.safe;
    sel.truthChecks = v.truthChecks;
    sel.reverted = v.reverted;
    if (v.reverted) {
      /* The candidate's own sentence is always a safe fallback. */
      sel.chosen = { ...sel.chosen, text: v.finalText, strategy: 'original', reverted: true };
      telemetry.count('safetyReversions');
    }
  });
  telemetry.end('leakage_audit', {
    reverted: leakageAudit.revertedCount, status: leakageAudit.status,
  });

  /* ---- stage 17: summary ---- */
  telemetry.begin('summary');
  let aiSummaryCandidates = [];
  if (useAi && router.available()) {
    try {
      const out = await router.generateSummaryCandidates({
        facts: {
          role: jobIntel?.roleIdentity?.canonicalRole || targetRole || d.targetRole,
          technologies: (intelligence.coreTechnologies || []).map((t) => t.skill).slice(0, 8),
          seniority,
          employers: intelligence.companies.slice(0, 3),
        },
        vocabulary: vocab,
        seniority,
        targetRole: jobIntel?.roleIdentity?.canonicalRole || targetRole,
        targetTerms: classification.supported.map((s) => s.skill).slice(0, 8),
      });
      telemetry.count('aiCalls');
      if (out.ok) aiSummaryCandidates = out.data.candidates;
      else telemetry.count('aiFailures');
    } catch { telemetry.count('aiFailures'); }
  }
  const summary = composeSummary(d, graph, intelligence, {
    jobIntel, userKey, voice, aiCandidates: aiSummaryCandidates,
    maxCandidates: depth.summaryCandidates,
    requirementGraph,
    forbiddenTerms,
  });
  /* The summary is generated content too, so it gets the same fail-closed
     treatment. A leaked term here is worse than in a bullet — it is the
     first line a recruiter reads. */
  let summarySafe = true;
  if (summary.best) {
    const sv = auditAndRevert([{
      changeId: 'chg-summary', before: d.summary || '', after: summary.best.text,
      truthChecks: summary.best.verdicts || {},
    }], auditCtx);
    if (sv.revertedCount) {
      summarySafe = false;
      telemetry.count('safetyReversions');
      summary.best = d.summary
        ? { ...summary.best, text: d.summary, reverted: true }
        : null;
      leakageAudit.violations.push(...sv.violations);
      leakageAudit.revertedCount += sv.revertedCount;
      leakageAudit.status = TAILORING_STATUS.PARTIAL;
      leakageAudit.safe = false;
    }
  }
  telemetry.end('summary', { candidates: summary.candidates.length, safe: summarySafe });

  /* ---- assemble the document ---- */
  telemetry.begin('assembly');
  const assembled = assembleDocument(d, repaired.selections, {
    summary, strategy, classification, intelligence, jobIntel, mode, job,
  });
  telemetry.end('assembly');

  /* ---- change ledger ---- */
  for (const s of repaired.selections) {
    ledger.record({
      section: s.evidence.section,
      itemId: s.evidence.sourceId,
      bulletId: s.evidence.bulletId,
      evidenceId: s.evidence.id,
      original: s.originalText,
      enhanced: s.chosen.text,
      strategy: s.chosen.strategy,
      structure: s.chosen.structure,
      reasonCodes: reasonCodesFor({ evidence: s.evidence, candidate: s.chosen, original: s.originalText, jobIntel }),
      jobSignal: jobSignalFor(s.chosen, jobIntel),
      sourceEvidence: {
        id: s.evidence.id,
        verificationLevel: s.evidence.verificationLevel,
        skills: s.evidence.skillsDisplay,
        metrics: (s.evidence.numericEvidence || []).map((n) => n.raw),
      },
      confidence: s.evidence.confidence,
      scoreBefore: originalScore(s),
      scoreAfter: s.chosen.finalScore,
      /* P1.4 — definitive truth verdict. The UI's "Accept All Safe" binds to
         THIS field and nothing else. Never inferred from confidence or score. */
      safe: s.safe !== false,
      truthChecks: s.truthChecks || {},
      reverted: !!s.reverted,
      matchedRequirementIds: (requirementGraph?.groups || [])
        .filter((g) => g.status === SUPPORT_STATE.SUPPORTED
          && (g.matchedEvidenceIds || []).includes(s.evidence.id))
        .map((g) => g.id),
    });
  }
  if (summary.best && summary.best.text !== d.summary) {
    ledger.record({
      section: 'summary', itemId: 'summary', evidenceId: 'ev_summary',
      original: d.summary, enhanced: summary.best.text,
      reasonCodes: d.summary ? ['cliche_removed', 'vagueness_replaced'] : ['vagueness_replaced'],
      confidence: 0.9,
      safe: summarySafe,
      truthChecks: { requirementLeakage: summarySafe ? 'PASS' : 'FAIL' },
    });
  }

  /* ---- quality measurement (deterministic verdicts) ---- */
  telemetry.begin('quality');
  const finalTexts = repaired.selections.map((s) => s.chosen.text);
  const allTexts = [...finalTexts, assembled.summary].filter(Boolean);
  const naturalness = analyzeNaturalness(allTexts);
  const genericity = assessGenericity(allTexts);
  const atsText = [assembled.summary, ...finalTexts, ...assembled.skills.map((s) => s.name)].join('\n');
  const atsAlignment = jobIntel ? analyzeAtsAlignment(atsText, jobIntel, graph, { classification }) : null;
  const truthAudit = auditGeneratedDocument(
    [
      ...repaired.selections.map((s) => ({ id: s.evidence.bulletId, text: s.chosen.text, evidenceId: s.evidence.id })),
      ...(summary.best ? [{ id: 'summary', text: summary.best.text, evidence: summary._evidence }] : []),
    ],
    graph,
    { ownershipCeiling: intelligence.ownershipCeiling },
  );
  const untracedMetrics = findUntracedMetrics(allTexts, graph);
  const avgScore = finalTexts.length
    ? Number((repaired.selections.reduce((a, s) => a + s.chosen.finalScore, 0) / repaired.selections.length).toFixed(2))
    : 0;

  telemetry.setQuality({
    averageFinalScore: avgScore,
    averageGenericPenalty: genericity.penalty,
    naturalnessScore: naturalness.score,
    unsupportedClaimCount: truthAudit.unsupportedClaimCount,
  });
  telemetry.end('quality');

  /* ---- gaps ---- */
  const gaps = buildGapReport({ classification, jobIntel, atsAlignment });
  /* Bullets whose own evidence is too thin for the engine to improve honestly.
     We report them instead of inventing detail — this is the one place where
     the right answer is to ask the user a question. */
  for (const s2 of repaired.selections) {
    const ev = s2.evidence;
    if (ev.hasConcreteAnchor || s2.chosen.strategy !== 'original') continue;
    gaps.gaps.push({
      type: 'thin_evidence',
      severity: 'low',
      bulletId: ev.bulletId,
      evidenceId: ev.id,
      message: `"${String(ev.rawText).slice(0, 70)}" carries no system, technology or number, so there was nothing to strengthen without inventing detail.`,
      action: 'Tell us what system this was and what changed, and it becomes a strong bullet.',
      insertable: false,
    });
  }
  gaps.counts.total = gaps.gaps.length;
  gaps.counts.thinEvidence = gaps.gaps.filter((g) => g.type === 'thin_evidence').length;

  /* ---- P2.22 — USEFUL REWRITE RATE ----
     changed/total is the wrong metric: a strong, specific, already-quantified
     bullet SHOULD come back untouched, and counting that as a failure would
     push the engine toward gratuitous churn. What matters is what happened to
     the bullets that were genuinely improvable. */
  const rewriteStats = (() => {
    let improvable = 0;
    let usefullyRewritten = 0;
    let unchangedDespiteEvidence = 0;
    const insufficient = [];

    for (const sel of repaired.selections) {
      const ev = sel.evidence;
      const before = String(sel.originalText || '');
      const after = String(sel.chosen.text || '');
      const changed = after.trim() !== before.trim();

      /* Does the sentence have a WEAKNESS worth fixing? */
      const weakOpener = WEAK_OPENER_RE.test(before);
      const vague = /\b(things?|stuff|various|several|numerous|etc\.?)\b/i.test(before);
      const overlong = before.split(/\s+/).length > 34;
      const nominalised = /\b\w{4,}(?:tion|ment|ance|ence|sion)\s+of\b/i.test(before);
      const hasWeakness = weakOpener || vague || overlong || nominalised;

      /* Is there ENOUGH EVIDENCE to fix it honestly? (P2.18)
         A bullet naming no system, technology, scope, method or outcome
         cannot be strengthened without inventing detail. Counting it as a
         missed rewrite would be counting the engine's correct refusal as a
         failure, and would create pressure to fabricate. */
      const hasMaterial = ev.hasConcreteAnchor || !!ev.method || !!ev.scope || !!ev.outcome;

      if (hasWeakness && !hasMaterial) {
        insufficient.push({
          bulletId: ev.bulletId,
          evidenceId: ev.id,
          status: 'INSUFFICIENT_EVIDENCE_FOR_STRONGER_BULLET',
          text: before.slice(0, 120),
          /* Structured prompts the UI can surface as inline questions. */
          missing: [
            !ev.skillsDisplay?.length && 'Which tool or technology did you use?',
            !ev.scope && 'What was the scale — how many systems, users or teams?',
            !ev.method && 'How did you do it?',
            !ev.outcome && 'What changed as a result?',
            'What was your responsibility on this?',
          ].filter(Boolean),
        });
        continue;
      }

      if (!hasWeakness) continue; // already strong: correctly left alone
      improvable += 1;

      /* "Usefully" rewritten, not merely different. A synonym swap is not an
         improvement, so near-identical output does not count. */
      const beforeWords = new Set(before.toLowerCase().match(/[a-z0-9]+/g) || []);
      const afterWords = new Set(after.toLowerCase().match(/[a-z0-9]+/g) || []);
      let shared = 0;
      for (const w of afterWords) if (beforeWords.has(w)) shared += 1;
      const union = beforeWords.size + afterWords.size - shared;
      const jaccard = union > 0 ? shared / union : 1;
      const substantive = changed && !sel.reverted && jaccard < 0.92;

      if (substantive) usefullyRewritten += 1;
      else unchangedDespiteEvidence += 1;
    }

    return {
      totalBullets: repaired.selections.length,
      improvableBullets: improvable,
      usefullyRewritten,
      unchangedDespiteEvidence,
      /* Reported separately and NEVER folded into the rate, in either
         direction — these are refusals, not misses. */
      insufficientEvidenceBullets: insufficient.length,
      insufficientEvidence: insufficient,
      usefulRewriteRate: improvable ? Number((usefullyRewritten / improvable).toFixed(3)) : null,
    };
  })();
  telemetry.count('improvableBullets', rewriteStats.improvableBullets);
  telemetry.count('usefullyRewritten', rewriteStats.usefullyRewritten);

  return {
    version: NARRATIVE_ENGINE_VERSION,
    engineVersions: NARRATIVE_ENGINE_VERSIONS,
    mode,
    status: leakageAudit.status,
    safe: leakageAudit.safe && summarySafe,
    requirementGraph: requirementGraph ? {
      version: requirementGraph.version,
      groups: requirementGraph.groups,
      counts: requirementGraph.counts,
      claimableTerms: requirementGraph.claimableTerms,
      forbiddenTerms: requirementGraph.forbiddenTerms,
      transferableTerms: requirementGraph.transferableTerms,
    } : null,
    leakage: {
      violations: leakageAudit.violations,
      revertedCount: leakageAudit.revertedCount,
      status: leakageAudit.status,
    },
    rewriteStats,
    doc: assembled.doc,
    summary: {
      chosen: assembled.summary,
      candidates: summary.candidates.slice(0, 3),
      facts: summary.facts,
    },
    intelligence,
    voice,
    jobIntelligence: jobIntel ? publicJobIntelligence(jobIntel) : null,
    externalContext: externalContext ? {
      available: !!externalContext.available,
      terminology: externalContext.terminology,
      contextNotes: externalContext.contextNotes,
      sources: externalContext.sources,
      retrievedAt: externalContext.retrievedAt,
      skipped: !!externalContext.skipped,
      reason: externalContext.reason || '',
      disclaimer: externalContext.disclaimer,
    } : { available: false, skipped: true, reason: 'not_requested' },
    strategy: {
      decisions: strategy.decisions,
      sectionOrder: strategy.sectionOrder,
      roles: strategy.roles.map((r) => ({
        label: r.label, itemId: r.itemId, current: r.current,
        recency: r.recency, relevance: r.relevance, quality: r.quality,
        priority: r.priority, bulletBudget: r.bulletBudget,
      })),
      projects: strategy.projects.map((p) => ({ label: p.label, itemId: p.itemId, priority: p.priority, bulletBudget: p.bulletBudget })),
      droppedProjects: strategy.droppedProjects.map((p) => p.label),
    },
    skills: classification,
    ats: atsAlignment,
    atsOpportunities: atsAlignment ? alignmentOpportunities(atsAlignment, classification) : [],
    naturalness,
    genericity,
    truth: truthAudit,
    untracedMetrics,
    gaps,
    consistency: {
      repairs: repaired.repairs,
      terminologyChanges: repaired.terminologyChanges,
      remainingIssues: repaired.remainingIssues,
    },
    changes: ledger.toJSON(),
    bullets: repaired.selections.map((s) => ({
      bulletId: s.evidence.bulletId,
      evidenceId: s.evidence.id,
      section: s.evidence.section,
      itemId: s.evidence.sourceId,
      intent: s.intent,
      original: s.originalText,
      text: s.chosen.text,
      strategy: s.chosen.strategy,
      structure: s.chosen.structure,
      metadata: s.chosen.metadata,
      alternatives: s.ranked.slice(1, 4).map((c) => ({ text: c.text, strategy: c.strategy, finalScore: c.finalScore })),
      rejectedCount: s.rejected.length,
      safe: s.safe !== false,
      reverted: !!s.reverted,
      truthChecks: s.truthChecks || {},
    })),
    quality: {
      averageFinalScore: avgScore,
      naturalnessScore: naturalness.score,
      genericityPenalty: genericity.penalty,
      unsupportedClaimCount: truthAudit.unsupportedClaimCount,
      evidenceCoverage: graph.counts.achievements
        ? Number((repaired.selections.length / graph.counts.achievements).toFixed(3)) : 0,
      vocabularyDiversity: naturalness.metrics.openerDiversity,
      usefulRewriteRate: rewriteStats.usefulRewriteRate,
      improvableBullets: rewriteStats.improvableBullets,
    },
  };
}

function originalScore(selection) {
  const orig = selection.ranked.find((c) => c.strategy === 'original');
  return orig ? orig.finalScore : null;
}

function preferredIntentsFor(jobIntel) {
  const out = [];
  const fn = (jobIntel.functionalExpectations || []).join(' | ').toLowerCase();
  if (/automate manual/.test(fn)) out.push('automation');
  if (/reliability|operate and support/.test(fn)) out.push('reliability');
  if (/design systems/.test(fn)) out.push('architecture');
  if (/lead or mentor/.test(fn)) out.push('leadership');
  if (/security and compliance/.test(fn)) out.push('security');
  if (/data quality/.test(fn)) out.push('data');
  if (/build and ship/.test(fn)) out.push('delivery');
  if (/stakeholders/.test(fn)) out.push('stakeholder');
  return out;
}

/* Only non-sensitive, useful parts of Job Intelligence go to the client. */
function publicJobIntelligence(ji) {
  return {
    version: ji.version,
    hash: ji.hash,
    roleIdentity: ji.roleIdentity,
    requirementCounts: {
      mandatory: ji.requirements.mandatory.length,
      strongPreference: ji.requirements.strongPreference.length,
      optional: ji.requirements.optional.length,
      leadership: ji.requirements.leadership.length,
      architecture: ji.requirements.architecture.length,
      operational: ji.requirements.operational.length,
      security: ji.requirements.security.length,
      businessDomain: ji.requirements.businessDomain.length,
      collaboration: ji.requirements.collaboration.length,
    },
    mandatory: ji.requirements.mandatory.slice(0, 12),
    technicalSignalsByKind: ji.technicalSignalsByKind,
    semanticExpectations: ji.semanticExpectations,
    functionalExpectations: ji.functionalExpectations,
    prioritySkills: ji.prioritySkills.slice(0, 25),
    jdVocabulary: ji.jdVocabulary.slice(0, 12),
  };
}

/* ------------------------------------------------------------------ */
/* Document assembly — non-destructive, canonical schema               */
/* ------------------------------------------------------------------ */
function assembleDocument(d, selections, { summary, strategy, classification, intelligence, jobIntel, mode, job }) {
  const byItem = new Map();
  for (const s of selections) {
    const key = `${s.evidence.section}:${s.evidence.sourceId}`;
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key).push(s);
  }

  const experience = d.experience.map((e) => {
    const sels = byItem.get(`experience:${e.id}`) || [];
    if (!sels.length) return e;
    return {
      ...e,
      bullets: sels.map((s) => normalizeBullet({
        ...(e.bullets.find((b) => b.id === s.evidence.bulletId) || {}),
        id: s.evidence.bulletId || undefined,
        text: s.chosen.text,
        generatedByRule: `${NARRATIVE_ENGINE_VERSION}:${s.chosen.strategy}`,
        evidenceIds: s.evidence.evidenceIds,
        provenance: s.evidence.verificationLevel === 'verified' ? PROVENANCE.VERIFIED
          : s.evidence.verificationLevel === 'profile_confirmed' ? PROVENANCE.PROFILE_CONFIRMED
            : PROVENANCE.USER_ENTERED,
        relevanceScore: s.chosen.metadata?.relevanceScore ?? null,
      })),
    };
  });

  const keptProjectIds = new Set(strategy.projects.map((p) => p.itemId));
  const projects = d.projects.map((p) => {
    const sels = byItem.get(`projects:${p.id}`) || [];
    const base = sels.length ? {
      ...p,
      bullets: sels.map((s) => normalizeBullet({
        ...(p.bullets.find((b) => b.id === s.evidence.bulletId) || {}),
        id: s.evidence.bulletId || undefined,
        text: s.chosen.text,
        generatedByRule: `${NARRATIVE_ENGINE_VERSION}:${s.chosen.strategy}`,
        evidenceIds: s.evidence.evidenceIds,
        provenance: p.verified ? PROVENANCE.VERIFIED : PROVENANCE.PROFILE_CONFIRMED,
      })),
    } : p;
    /* Projects outside the budget are DISABLED on the variant, never deleted —
       the master document keeps everything. */
    return mode === 'tailor' && !keptProjectIds.has(p.id) && p.bullets.length
      ? { ...base, enabled: false }
      : base;
  });

  const prioritized = prioritizeSkills(d.skills, classification);
  const chosenSummary = summary.best?.text || d.summary || '';

  const doc = normalizeResumeDocument({
    ...d,
    summary: chosenSummary,
    experience,
    projects,
    skills: prioritized.ordered,
    sectionOrder: strategy.sectionOrder,
    targetRole: jobIntel?.roleIdentity?.canonicalRole || d.targetRole,
    metadata: {
      ...(d.metadata || {}),
      narrative: {
        engine: NARRATIVE_ENGINE_VERSION,
        mode,
        roleFamily: intelligence.roleFamily,
        seniority: intelligence.seniority,
        generatedAt: new Date().toISOString(),
        ...(job?.company ? { targetCompany: String(job.company).slice(0, 200) } : {}),
      },
    },
    provenanceNote: 'Every statement traces to evidence you provided. No metric, technology or responsibility was added by the engine.',
  });

  return { doc, summary: chosenSummary, skills: doc.skills };
}

/* ------------------------------------------------------------------ */
function buildGapReport({ classification, jobIntel, atsAlignment }) {
  const gaps = [];
  for (const u of classification.unsupported) {
    const req = jobIntel?.requirements?.mandatory?.find((r) => r.skills.includes(u.skill));
    gaps.push({
      type: 'no_evidence',
      skill: u.skill,
      severity: req ? 'critical' : 'medium',
      requirementTier: req ? 'mandatory' : 'preferred',
      message: `${u.skill} is asked for and you have no evidence for it anywhere in your profile.`,
      action: 'Build verifiable evidence for it — this is a real gap, not a wording problem.',
      cta: { view: 'projectstudio', context: { targetSkill: u.skill, reason: 'resume_gap' } },
      insertable: false,
    });
  }
  for (const p of classification.partiallySupported) {
    gaps.push({
      type: p.basis === 'adjacent_experience' ? 'adjacent_only' : 'declared_not_demonstrated',
      skill: p.skill,
      severity: 'low',
      message: p.note,
      action: p.basis === 'adjacent_experience'
        ? 'Related experience exists but is not the same claim — we did not write it in for you.'
        : 'Add one bullet showing where you used it, and it becomes usable content.',
      insertable: false,
    });
  }
  for (const o of (atsAlignment ? alignmentOpportunities(atsAlignment, classification) : [])) {
    if (o.type === 'supported_but_absent') {
      gaps.push({
        type: 'supported_but_absent', skill: o.skill, severity: 'high',
        message: o.action, action: 'One click adds it from your own evidence.',
        evidenceIds: o.evidenceIds, insertable: true,
      });
    }
  }
  return {
    gaps,
    counts: {
      total: gaps.length,
      critical: gaps.filter((g) => g.severity === 'critical').length,
      insertable: gaps.filter((g) => g.insertable).length,
    },
    /* Restated because it is the product promise. */
    policy: 'A requirement you cannot evidence is reported as a gap. It is never written into the resume to raise a score.',
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */
function baseContext(opts) {
  const usage = new UsageLedger();
  /* A caller-supplied router owns its own ledger; reporting the unused local
     one would understate real token spend. */
  const router = opts.router || createNarrativeRouter({ env: opts.env || process.env, ledger: usage, forceDisable: opts.useAi === false });
  return {
    master: opts.master || null,
    verifiedSkills: opts.verifiedSkills || [],
    profileSkills: opts.profileSkills || [],
    githubEvidence: opts.githubEvidence || [],
    userKey: String(opts.userKey || 'anon'),
    router,
    usage: router.usage || usage,
    searchProvider: opts.searchProvider || NullSearchProvider,
    useExternalResearch: opts.useExternalResearch !== false,
    useAi: opts.useAi !== false,
    maxBulletsCurrent: opts.maxBulletsCurrent || 5,
    maxBulletsPrevious: opts.maxBulletsPrevious || 4,
    maxProjects: opts.maxProjects || 4,
    /* P1.5 / P1.6 — mode + depth are real configuration consumed below,
       not decorative metadata. Defaults keep legacy callers working. */
    strategy: opts.strategy || resolveMode(opts.mode),
    depth: opts.depth || resolveDepth(opts.depthId),
    operation: opts.operation || '',
  };
}

/**
 * ENHANCE — the strongest general-market representation of the candidate.
 * No single job is optimised for; role family and seniority drive vocabulary.
 */
export async function enhanceResumeNarrative(doc, opts = {}) {
  const telemetry = new NarrativeTelemetry({ mode: 'enhance' });
  const ctx = {
    ...baseContext(opts),
    mode: 'enhance',
    jobDescription: '',
    job: {},
    targetRole: opts.targetRole || doc?.targetRole || '',
    telemetry,
    useExternalResearch: false, // enhance never researches a company
  };
  try {
    const out = await runPipeline(doc, ctx);
    return { ok: true, ...out, telemetry: telemetry.snapshot({ usage: ctx.usage, researchStats: researchCache.stats() }) };
  } catch (err) {
    telemetry.count('errors');
    return {
      ok: false,
      error: 'narrative_enhance_failed',
      message: String(err?.message || err).slice(0, 300),
      /* Failure preserves the original document exactly. */
      doc: normalizeResumeDocument(doc),
      telemetry: telemetry.snapshot({ usage: ctx.usage }),
    };
  }
}

/**
 * TAILOR — a targeted version for one specific opportunity.
 */
export async function tailorResumeNarrative(doc, opts = {}) {
  const telemetry = new NarrativeTelemetry({ mode: 'tailor' });
  const ctx = {
    ...baseContext(opts),
    mode: 'tailor',
    jobDescription: opts.jobDescription || '',
    job: opts.job || {},
    targetRole: opts.targetRole || doc?.targetRole || '',
    telemetry,
  };
  try {
    const out = await runPipeline(doc, ctx);
    return { ok: true, ...out, telemetry: telemetry.snapshot({ usage: ctx.usage, researchStats: researchCache.stats() }) };
  } catch (err) {
    telemetry.count('errors');
    return {
      ok: false,
      error: 'narrative_tailor_failed',
      message: String(err?.message || err).slice(0, 300),
      doc: normalizeResumeDocument(doc),
      telemetry: telemetry.snapshot({ usage: ctx.usage }),
    };
  }
}

export default {
  NARRATIVE_ENGINE_VERSION, NARRATIVE_ENGINE_VERSIONS,
  enhanceResumeNarrative, tailorResumeNarrative,
};
