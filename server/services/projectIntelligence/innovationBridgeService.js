/* ============================================================
   Task 11 — Patent OS / Innovation OS bridge
   ------------------------------------------------------------
   Turns a source-backed Patent/Innovation OS project (or cluster)
   into a Project Studio payload, preserving the IP-specific
   fields so the "Innovation-grade" badge is meaningful. Refuses
   to duplicate an already-imported project. Deterministic.
   ============================================================ */
import { asList, uniq, fingerprint, lc } from './util.js';
import { detectDuplicate } from './projectMemoryService.js';

/* Preserve the Patent OS fields the spec calls out. */
export function extractInnovationFields(src = {}) {
  return {
    painPoint: src.painPoint || src.problem || src.summary || '',
    noveltyAngle: src.noveltyAngle || src.novelty?.inventiveAngle || src.differentiator || '',
    ipReadiness: src.ipReadiness?.overall ?? src.patentReadinessScore ?? src.patentPotentialScore ?? null,
    evidenceChecklist: asList(src.evidenceChecklist).length ? asList(src.evidenceChecklist)
      : ['Working prototype', 'Dated invention log', 'Architecture + data-flow diagrams', 'Prior-art notes', 'Test/benchmark results'],
    priorArtWarning: src.priorArtWarning || src.section3kWarning || 'External prior-art risk unknown until reviewed.',
    disclosureStatus: src.disclosureStatus || src.publicDisclosureStatus || 'none',
  };
}

/* Build the Project Studio payload from an innovation source. Returns
   { ok, imported, payload, duplicateOf } — never throws. */
export function importInnovationProject({ source = {}, existingProjects = [] } = {}) {
  const title = source.title || 'Innovation-grade project';
  const skills = uniq(asList(source.skills).concat(asList(source.keywords)).concat(asList(source.skillsCovered)));
  const innovationClusterId = source.id || source.clusterId || source.innovationClusterId || fingerprint(title);

  // Refuse to duplicate an already-imported project.
  const candidate = { title, problemStatement: source.painPoint || source.summary || '', skillsCovered: skills, innovationClusterId };
  const dup = detectDuplicate(candidate, existingProjects, { threshold: 0.55 });
  // strongest signal: same cluster id already present
  const sameCluster = (existingProjects || []).find((p) => p.innovationClusterId && p.innovationClusterId === innovationClusterId);
  if (sameCluster) {
    return { ok: true, imported: false, duplicateOf: { id: sameCluster.id, title: sameCluster.title }, message: 'Already imported into Project Studio.', payload: null };
  }
  if (dup.isDuplicate) {
    return { ok: true, imported: false, duplicateOf: dup.matches[0] || null, message: dup.suggestion, payload: null };
  }

  const innovation = extractInnovationFields(source);
  const payload = {
    title,
    targetRole: source.targetRole || 'Software Engineer',
    type: 'AI/ML',
    difficulty: (innovation.ipReadiness || 0) >= 60 ? 'Advanced' : 'Intermediate',
    duration: '1 month',
    skillsCovered: skills,
    techStack: asList(source.techStack),
    problemStatement: innovation.painPoint || title,
    summary: source.summary || innovation.painPoint || title,
    innovationClusterId,
    innovationGrade: true,
    innovation, // preserved IP fields
    creator: {
      createdVia: 'project-intelligence-innovation-bridge',
      step: 'validate',
      summary: source.summary || innovation.painPoint || title,
      innovationGrade: true,
    },
  };

  return { ok: true, imported: true, duplicateOf: null, payload, message: 'Ready to import as an Innovation-grade project.' };
}

/* When the user picks an innovation/patent-aware goal, prefer innovation
   clusters at the top of recommendations. Returns a boolean flag. */
export function prefersInnovation(goal = '') {
  return /patent|innovation|research|novel|ip/.test(lc(goal));
}
