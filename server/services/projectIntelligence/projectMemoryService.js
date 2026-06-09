/* ============================================================
   Task 10 — Project memory / duplicate detection (foundation)
   ------------------------------------------------------------
   Lightweight keyword-similarity duplicate detection (no vector
   DB in this phase). Compares a candidate project against the
   user's existing + generated projects across title, problem,
   tech stack and skill-gaps-fixed. Deterministic.
   ============================================================ */
import { asList, uniq, textSimilarity, lc } from './util.js';
import { pjConfig } from './config.js';

function memoryRecord(p = {}) {
  return {
    id: p.id || '',
    title: p.title || '',
    problem: p.problemStatement || p.summary || '',
    techStack: asList(p.techStack),
    skills: uniq(asList(p.skillsCovered).concat(asList(p.skills))),
    skillGapsFixed: asList(p.skillGapsFixed),
    sourceContext: p.sourceContext || '',
    innovationClusterId: p.innovationClusterId || '',
  };
}

function similarity(a, b) {
  const titleSim = textSimilarity(a.title, b.title);
  const probSim = textSimilarity(a.problem, b.problem);
  const aSkills = new Set(a.skills.map(lc));
  const bSkills = new Set(b.skills.map(lc));
  let inter = 0;
  for (const s of aSkills) if (bSkills.has(s)) inter++;
  const skillSim = aSkills.size ? inter / aSkills.size : 0;
  // weighted: title/problem dominate, skills refine
  return Math.round((Math.max(titleSim, probSim) * 0.6 + skillSim * 0.4) * 100) / 100;
}

/* Detect near-duplicates of `candidate` within `existing`. */
export function detectDuplicate(candidate = {}, existing = [], opts = {}) {
  const cfg = pjConfig();
  const threshold = opts.threshold || cfg.similarityThreshold || 0.55;
  const cand = memoryRecord(candidate);
  const matches = (existing || [])
    .map((p) => memoryRecord(p))
    .map((rec) => ({ rec, score: similarity(cand, rec) }))
    // an exact innovation import counts as a duplicate regardless of text
    .map((x) => ({ ...x, score: cand.innovationClusterId && cand.innovationClusterId === x.rec.innovationClusterId ? Math.max(x.score, 0.95) : x.score }))
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score);

  const top = matches[0];
  if (!top) {
    return { isDuplicate: false, similarity: 0, matches: [], suggestion: '' };
  }
  return {
    isDuplicate: true,
    similarity: top.score,
    matches: matches.slice(0, 3).map((x) => ({ id: x.rec.id, title: x.rec.title, similarity: x.score })),
    suggestion: buildSuggestion(cand, top.rec, existing),
  };
}

/* Suggest a DIFFERENT proof gap to cover, per the spec example. */
function buildSuggestion(cand, dup, existing) {
  const coveredSkills = new Set(existing.flatMap((p) => asList(p.skillsCovered).concat(asList(p.skills))).map(lc));
  const candSkills = cand.skills.map(lc);
  const newAngle = candSkills.find((s) => !coveredSkills.has(s));
  const base = `You already have a similar project ("${dup.title}").`;
  if (/kubernetes|deploy|k8s/.test(lc(dup.title))) {
    return `${base} Build a Terraform infrastructure project instead to cover a different proof gap.`;
  }
  if (newAngle) return `${base} If you still want this space, pivot to ${newAngle} so it covers a proof gap you don't have yet.`;
  return `${base} Pick a project that covers a different skill or proof gap rather than duplicating it.`;
}

/* Batch helper: filter a recommendation list, attaching duplicate info. */
export function annotateRecommendations(recommendations = [], existing = []) {
  return recommendations.map((rec) => {
    const dup = detectDuplicate(rec, existing);
    return { ...rec, duplicate: dup.isDuplicate, duplicateInfo: dup.isDuplicate ? dup : null, duplicateWarning: dup.isDuplicate ? dup.suggestion : (rec.duplicateWarning || '') };
  });
}
