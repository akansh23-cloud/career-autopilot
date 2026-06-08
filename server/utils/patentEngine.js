/* ============================================================
   PATENT ENGINE  (deterministic readiness + prior-art keywords +
   invention disclosure scaffold). NOT legal advice. No guaranteed
   patentability. AI (in the route) may only enrich prose, never the score.
   ============================================================ */
export const PATENT_VERSION = 'patent-v1';

export const PATENT_DISCLAIMER =
  'This is a patent readiness and prior-art research assistant, not legal advice. Consult a qualified patent professional before filing.';

export const PATENT_STATUSES = [
  'idea_identified', 'invention_disclosure_drafted', 'prior_art_search_started',
  'prior_art_reviewed', 'patent_attorney_review', 'provisional_filed',
  'non_provisional_filed', 'published', 'office_action', 'granted',
  'rejected_abandoned', 'licensed_commercialized',
];

export const PATENT_BADGES = {
  not_assessed: 'Not assessed',
  patent_ready: 'Patent-ready',
  disclosure_drafted: 'Disclosure drafted',
  patent_filed: 'Patent filed',
  patent_granted: 'Patent granted',
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n);
const lc = (s) => String(s || '').toLowerCase();

/* Generic / low-novelty signals that reduce technical-novelty + raise prior-art risk. */
const GENERIC_SIGNALS = ['todo', 'crud', 'blog', 'clone', 'tutorial', 'portfolio', 'landing page', 'to-do', 'notes app', 'weather app', 'calculator'];
const NOVEL_SIGNALS = ['algorithm', 'novel', 'optimization', 'real-time', 'distributed', 'pipeline', 'model', 'protocol', 'compression', 'detection', 'prediction', 'orchestration', 'inference', 'encryption', 'scheduling', 'routing'];
const IMPL_SIGNALS = ['architecture', 'deployed', 'benchmark', 'latency', 'throughput', 'experiment', 'evaluation', 'prototype', 'implementation', 'tested', 'metrics'];

function corpus(p) {
  return `${lc(p.title)} ${lc(p.problemStatement || p.problem)} ${lc(p.description || p.summary)} ${lc(p.technicalSolution)} ${(p.skills || p.skillsCovered || []).map(lc).join(' ')} ${(p.techStack || []).map(lc).join(' ')}`;
}
const count = (text, list) => list.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);

export function assessPatentReadiness(project = {}) {
  const text = corpus(project);
  const generic = count(text, GENERIC_SIGNALS);
  const novel = count(text, NOVEL_SIGNALS);
  const impl = count(text, IMPL_SIGNALS);
  const hasProof = !!(project.githubUrl || project.liveDemoUrl || (project.proofUrls || []).length || project.verificationStatus === 'verified');
  const hasProblem = lc(project.problemStatement || project.problem).length > 40;
  const hasSolution = lc(project.technicalSolution || project.description || project.summary).length > 60;

  const breakdown = {
    technicalNovelty: clamp(round((novel * 6) - (generic * 8) + 6), 0, 25),
    problemSolutionClarity: clamp((hasProblem ? 9 : 3) + (hasSolution ? 6 : 0), 0, 15),
    implementationDepth: clamp(round(impl * 4) + (hasProof ? 5 : 0), 0, 15),
    differentiation: clamp(round(novel * 4) - round(generic * 5) + 5, 0, 15),
    priorArtRisk: clamp(15 - round(generic * 5) - (novel >= 2 ? 0 : 4), 0, 15), // higher = lower risk
    evidenceMaturity: clamp((project.verificationStatus === 'verified' ? 10 : 0) + (hasProof ? 5 : 0), 0, 10),
    inventorContributionClarity: clamp((project.inventors && project.inventors.length ? 5 : project.roleInProject ? 4 : 2), 0, 5),
  };
  const total = clamp(round(Object.values(breakdown).reduce((a, b) => a + b, 0)), 0, 100);

  const classification = total >= 75 ? 'Patent Review Recommended'
    : total >= 55 ? 'Research/Innovation Candidate'
    : total >= 35 ? 'Startup MVP' : 'Portfolio Project';

  const risks = [];
  if (generic) risks.push('Idea resembles common/generic software — abstract-idea and prior-art risk is high in many jurisdictions.');
  if (novel < 2) risks.push('Limited explicit technical novelty signals — articulate a specific, non-obvious technical solution.');
  if (!hasProof) risks.push('No implementation evidence (repo/demo) — prototype maturity strengthens an application.');
  risks.push('Public disclosure before filing can affect rights in some jurisdictions.');

  return {
    patentReadinessScore: total,
    breakdown,
    classification,
    risks,
    badge: total >= 75 ? 'patent_ready' : 'not_assessed',
    patentVersion: PATENT_VERSION,
    disclaimer: PATENT_DISCLAIMER,
  };
}

/* Deterministic prior-art search keyword sets. */
export function priorArtKeywords(project = {}) {
  const text = corpus(project);
  const terms = Array.from(new Set([
    ...NOVEL_SIGNALS.filter((w) => text.includes(w)),
    ...(project.techStack || project.skills || project.skillsCovered || []).map(lc),
  ])).slice(0, 10);
  const base = (project.title || 'system').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const queries = [
    `${base} method system`,
    `${base} apparatus`,
    ...terms.slice(0, 4).map((t) => `${base} ${t}`),
    `${terms.slice(0, 3).join(' ')} patent`,
  ].filter((q) => q.trim().length > 3);
  return {
    keywords: terms,
    suggestedQueries: Array.from(new Set(queries)).slice(0, 8),
    searchTargets: ['Google Patents', 'USPTO Patent Full-Text Search', 'Espacenet', 'WIPO PATENTSCOPE'],
    disclaimer: PATENT_DISCLAIMER,
  };
}

/* Deterministic invention-disclosure scaffold (AI may enrich prose in route). */
export function inventionDisclosureDraft(project = {}) {
  const title = project.title || 'Invention';
  return {
    title,
    inventors: project.inventors || (project.roleInProject ? ['Primary inventor'] : []),
    technicalField: `Software systems relating to ${project.category || 'the described domain'}.`,
    backgroundProblem: project.problemStatement || project.problem || 'Describe the specific technical problem the invention solves.',
    summaryOfInvention: project.technicalSolution || project.summary || project.description || 'Summarize the technical solution and its core inventive contribution.',
    detailedDescriptionOutline: [
      'System overview and key components',
      'Data flow and core algorithm/method steps',
      'Implementation details and variations',
      'Example embodiment(s) and results',
    ],
    noveltyPoints: NOVEL_SIGNALS.filter((w) => corpus(project).includes(w)).slice(0, 6).map((w) => `Inventive use of ${w} to solve the stated problem`),
    industrialApplicability: 'Describe the practical, real-world use and commercial application.',
    claimsPreparationNotes: [
      'Draft one independent method claim and one system/apparatus claim.',
      'Add dependent claims for key variations and embodiments.',
      'Avoid claiming purely abstract ideas — tie claims to a concrete technical implementation.',
    ],
    documentationChecklist: [
      'Architecture and data-flow diagrams',
      'Working prototype / repo link',
      'Benchmark or evaluation results',
      'Dated records of conception and reduction to practice',
    ],
    disclaimer: PATENT_DISCLAIMER,
    patentVersion: PATENT_VERSION,
  };
}

export default { assessPatentReadiness, priorArtKeywords, inventionDisclosureDraft, PATENT_STATUSES, PATENT_BADGES, PATENT_DISCLAIMER, PATENT_VERSION };
