/* ============================================================
   Synthesis Intelligence — memory / RAG augmentation
   ------------------------------------------------------------
   Lightweight RAG / Innovation Memory integration. Uses the
   existing innovationMemory retrieval service when available
   (vector mode if embeddings are configured); otherwise falls
   back to deterministic keyword / domain / title / mechanism
   similarity over supplied candidates. NO paid embedding
   provider is required for the app to run. Enhances Project OS
   and Patent OS — it never replaces Patent OS scoring.
   ============================================================ */
import { extractKeywords, lc, clamp } from '../problemIntelligence/util.js';
import { similarityScore, chunkKeywords } from '../innovationMemory/similarity.js';

/* Outcome semantics for ranking impact. */
const NEGATIVE_OUTCOMES = new Set(['rejected', 'faculty_rejected', 'prior_art_blocked', 'duplicate', 'shelved', 'student_abandoned']);
const POSITIVE_OUTCOMES = new Set(['built', 'project_completed', 'completed', 'filed', 'faculty_positive', 'faculty_approved', 'ip_review_shortlisted', 'recruiter_shown', 'recruiter_shortlisted']);

function ideaQueryText(idea = {}) {
  return `${idea.title || ''} ${idea.problem || idea.painPoint || idea.problemStatement || ''} ${idea.proposedSolution || ''} ${idea.technicalMechanism || ''}`;
}

/* Deterministic similarity that also weighs domain and mechanism overlap —
   the keyword/fallback retrieval the spec requires. */
export function deterministicSimilarity(idea = {}, candidate = {}) {
  const qKw = extractKeywords(ideaQueryText(idea), 14);
  const base = similarityScore(qKw, chunkKeywords(candidate), idea.title || '', candidate.title || '');
  let bonus = 0;
  if (idea.domain && candidate.domain && lc(idea.domain) === lc(candidate.domain)) bonus += 8;
  const mechA = lc(idea.technicalMechanism || '');
  const mechB = lc(candidate.technicalMechanism || candidate.metadata?.technicalMechanism || candidate.safeSummary || '');
  if (mechA && mechB) {
    const mechTokens = mechA.split(/[\s/,:-]+/).filter((t) => t.length > 4);
    const hits = mechTokens.filter((t) => mechB.includes(t)).length;
    if (mechTokens.length) bonus += clamp(Math.round((hits / mechTokens.length) * 12), 0, 12);
  }
  const tags = new Set((candidate.tags || []).map(lc));
  if (tags.size) bonus += clamp(qKw.filter((k) => tags.has(k)).length * 2, 0, 6);
  return clamp(base + bonus, 0, 100);
}

function duplicateRiskLabel(maxScore, count) {
  if (maxScore >= 78) return 'high';
  if (maxScore >= 60 || count >= 3) return 'medium';
  if (maxScore >= 35) return 'low';
  return 'none';
}

/**
 * buildMemoryInsights — pure, deterministic. Takes the idea plus retrieved
 * memory candidates (either from the real retrieval service or from a
 * deterministic fallback list) and produces the RAG output the spec requires.
 */
export function buildMemoryInsights({ idea = {}, candidates = [], retrievalMode = 'keyword-fallback' } = {}) {
  const scored = (candidates || [])
    .map((c) => ({ candidate: c, score: typeof c.similarity === 'number' ? c.similarity : deterministicSimilarity(idea, c) }))
    .filter((s) => s.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const similarIdeas = scored.map((s) => ({
    title: s.candidate.title || '(untitled past idea)',
    similarity: s.score,
    sourceType: s.candidate.sourceType || 'generated_project',
    outcome: s.candidate.outcome || '',
  }));

  const maxScore = scored.length ? scored[0].score : 0;
  const duplicateRisk = duplicateRiskLabel(maxScore, scored.length);

  const pastOutcomeSignals = [];
  const lessonsFromPastIdeas = [];
  const warnings = [];
  let rankingDelta = 0;

  for (const s of scored) {
    const outcome = lc(s.candidate.outcome || '');
    if (!outcome) continue;
    if (NEGATIVE_OUTCOMES.has(outcome)) {
      pastOutcomeSignals.push(`"${s.candidate.title}" (similarity ${s.score}) was previously ${outcome.replace(/_/g, ' ')}.`);
      rankingDelta -= outcome === 'prior_art_blocked' ? 12 : 8;
      if (outcome === 'prior_art_blocked') {
        warnings.push(`A similar past idea ("${s.candidate.title}") was blocked on prior art — IP-readiness for this idea should stay conservative until a fresh prior-art search clears it.`);
        lessonsFromPastIdeas.push('A close prior-art collision exists in memory: differentiate the technical mechanism explicitly, not just the use case.');
      } else if (outcome === 'faculty_rejected' || outcome === 'rejected') {
        lessonsFromPastIdeas.push(`Faculty previously rejected a similar idea — review the rejection reasons before resubmitting this framing.`);
      } else if (outcome === 'student_abandoned' || outcome === 'shelved') {
        lessonsFromPastIdeas.push('Similar past ideas were abandoned/shelved — scope the MVP tighter and front-load the proof checklist.');
      }
    } else if (POSITIVE_OUTCOMES.has(outcome)) {
      pastOutcomeSignals.push(`"${s.candidate.title}" (similarity ${s.score}) previously reached: ${outcome.replace(/_/g, ' ')}.`);
      rankingDelta += outcome === 'faculty_approved' || outcome === 'faculty_positive' ? 8 : 5;
      lessonsFromPastIdeas.push(`A similar idea succeeded ("${s.candidate.title}") — reuse its working pattern: keep the mechanism deterministic and the evidence checklist front-loaded.`);
    }
  }

  if (duplicateRisk === 'high') warnings.push(`${scored.filter((s) => s.score >= 78).length} near-duplicate past idea(s) found — confirm this is a deliberate iteration, not an accidental repeat.`);
  else if (duplicateRisk === 'medium') warnings.push('Moderately similar past ideas exist — differentiate the title and mechanism before generating a workspace.');

  rankingDelta = clamp(rankingDelta, -20, 15);
  const rankingImpact = rankingDelta === 0
    ? 'No ranking adjustment from memory: no outcome-bearing similar ideas were found.'
    : rankingDelta > 0
      ? `Ranking boosted by +${rankingDelta}: similar past ideas were completed/approved — this pattern has worked before.`
      : `Ranking reduced by ${rankingDelta}: similar past ideas were rejected, blocked or abandoned.`;

  return {
    similarIdeas,
    duplicateRisk,
    pastOutcomeSignals,
    lessonsFromPastIdeas: [...new Set(lessonsFromPastIdeas)].slice(0, 5),
    rankingImpact,
    warnings,
    _meta: { rankingDelta, retrievalMode, candidateCount: (candidates || []).length },
  };
}

/**
 * retrieveIdeaMemory — async entry that prefers the real innovation-memory
 * retrieval service (vector OR keyword mode, per existing config) and falls
 * back to deterministic similarity over caller-supplied candidates when
 * memory is disabled, the DB is off, or retrieval throws. Best-effort by
 * design: it can never break generation.
 */
export async function retrieveIdeaMemory({ userId, email, collegeId = '', idea = {}, cfg = null, fallbackCandidates = [] } = {}) {
  if (cfg && cfg.memory && cfg.memory.enabled && (userId || email)) {
    try {
      const { retrieveSimilar } = await import('../innovationMemory/retrievalService.js');
      const r = await retrieveSimilar({
        userId, email, collegeId,
        query: { title: idea.title || '', summary: idea.problem || idea.painPoint || '', proposedSolution: idea.proposedSolution || '', keywords: extractKeywords(ideaQueryText(idea), 14) },
        sourceTypes: ['generated_project', 'patent_idea', 'problem_cluster', 'prior_art', 'faculty_feedback'],
        limit: 8,
        cfg,
      });
      if (r && r.retrievalUsed) {
        return buildMemoryInsights({ idea, candidates: r.results || [], retrievalMode: r.mode || 'memory' });
      }
    } catch { /* fall through to deterministic */ }
  }
  return buildMemoryInsights({ idea, candidates: fallbackCandidates, retrievalMode: 'keyword-fallback' });
}

/* Apply memory insights to a project package: adjusts quality warnings,
   evidence framing and IP-readiness language. Never mutates Patent OS
   numeric scores — only the package's own conservative narrative. */
export function applyMemoryToPackage(pkg, memory) {
  if (!pkg || !memory) return pkg;
  const delta = memory._meta?.rankingDelta || 0;
  pkg.memory = {
    similarIdeas: memory.similarIdeas,
    duplicateRisk: memory.duplicateRisk,
    pastOutcomeSignals: memory.pastOutcomeSignals,
    lessonsFromPastIdeas: memory.lessonsFromPastIdeas,
    rankingImpact: memory.rankingImpact,
    warnings: memory.warnings,
  };
  if (memory.warnings.length) {
    pkg.quality.warnings = [...pkg.quality.warnings, ...memory.warnings];
    pkg.projectOsPayload.warnings = [...pkg.projectOsPayload.warnings, ...memory.warnings];
  }
  if (delta < 0) {
    pkg.quality.evidenceGroundingScore = clamp(pkg.quality.evidenceGroundingScore + delta, 0, 100);
    if (memory.warnings.some((w) => /prior art|prior-art/i.test(w))) {
      pkg.buildBrief.ipReadinessAngle = `Prior-art caution from memory: a similar past idea was blocked. ${pkg.buildBrief.ipReadinessAngle}`;
      pkg.projectOsPayload.ipReadinessPossibility = 'Conservative — a similar past idea hit prior art; requires a fresh prior-art search and faculty/IP-cell review before any IP claim.';
    }
  } else if (delta > 0 && memory.lessonsFromPastIdeas.length) {
    // Strengthen the blueprint with the successful past pattern.
    pkg.projectBlueprint.proofChecklist = [...new Set([...pkg.projectBlueprint.proofChecklist, 'Reuse the evidence pattern from the similar successfully-completed past project (memory hit).'])].slice(0, 8);
  }
  return pkg;
}

export default { buildMemoryInsights, retrieveIdeaMemory, deterministicSimilarity, applyMemoryToPackage };
