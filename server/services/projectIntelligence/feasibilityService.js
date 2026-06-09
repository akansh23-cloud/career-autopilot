/* ============================================================
   Task 5 — MVP feasibility: cost / team / time estimator
   ------------------------------------------------------------
   Deterministic. India-realistic cost bands. AI never required.
   ============================================================ */
import { asList, uniq, lc } from './util.js';

const DIFFICULTY_ORDER = ['beginner', 'intermediate', 'advanced', 'research-grade'];

/* India cost bands (INR), per the spec. */
const COST_BANDS = {
  beginner: { studentPrototype: '₹0–₹2,000', polishedDemo: '₹2,000–₹8,000', startupGrade: '₹20,000–₹50,000' },
  intermediate: { studentPrototype: '₹0–₹2,000', polishedDemo: '₹2,000–₹10,000', startupGrade: '₹50,000–₹1,50,000' },
  advanced: { studentPrototype: '₹500–₹3,000', polishedDemo: '₹5,000–₹20,000', startupGrade: '₹1,00,000+' },
  'research-grade': { studentPrototype: '₹1,000–₹5,000', polishedDemo: '₹10,000–₹50,000', startupGrade: '₹2,00,000+' },
};

const TIMELINE = {
  beginner: '1–2 weeks (solo, part-time)',
  intermediate: '2–4 weeks (solo, part-time)',
  advanced: '4–8 weeks (solo) or 2–4 weeks (small team)',
  'research-grade': '8–12 weeks with iterative experiments',
};

function inferDifficulty(project, recommendation) {
  const d = lc(recommendation.difficulty || project.difficulty || project.creator?.difficulty || '');
  if (DIFFICULTY_ORDER.includes(d)) return d;
  const text = lc(`${recommendation.title || project.title || ''} ${(asList(recommendation.skills).concat(asList(project.skillsCovered))).join(' ')}`);
  if (/research|novel|patent|distributed|crdt|consensus/.test(text)) return 'research-grade';
  if (/kubernetes|terraform|streaming|mlops|lakehouse|real-?time|kafka/.test(text)) return 'advanced';
  if (/auth|dashboard|pipeline|api|full.?stack/.test(text)) return 'intermediate';
  return 'beginner';
}

const hasHardware = (text) => /iot|hardware|sensor|camera|device|robot|edge/.test(lc(text));
const isCloudHeavy = (text) => /kubernetes|spark|kafka|stream|gpu|ml|training|warehouse|lakehouse/.test(lc(text));

export function estimateFeasibility({ project = {}, recommendation = {} } = {}) {
  const difficulty = inferDifficulty(project, recommendation);
  const skills = uniq(asList(recommendation.skills).concat(asList(project.skillsCovered)).concat(asList(project.skills)));
  const text = `${recommendation.title || project.title || ''} ${skills.join(' ')} ${recommendation.problemStatement || project.problemStatement || ''}`;

  const rolesRequired = ['Full-stack builder'];
  if (/data|pipeline|etl|warehouse|spark|kafka/.test(lc(text))) rolesRequired.push('Data engineer');
  if (/ml|model|llm|rag|train/.test(lc(text))) rolesRequired.push('ML engineer');
  if (/devops|kubernetes|terraform|deploy|ci/.test(lc(text))) rolesRequired.push('DevOps / infra');
  if (/design|ux|frontend|accessib/.test(lc(text))) rolesRequired.push('Frontend / UX');

  const teamSize = difficulty === 'beginner' ? '1 (solo)'
    : difficulty === 'intermediate' ? '1–2'
      : difficulty === 'advanced' ? '2–3' : '2–4';

  const costBand = isCloudHeavy(text) || hasHardware(text)
    ? { studentPrototype: '₹0–₹2,000', polishedDemo: '₹2,000–₹10,000', startupGrade: hasHardware(text) ? '₹10,000–₹50,000' : COST_BANDS[difficulty].startupGrade }
    : COST_BANDS[difficulty];

  const resourcesRequired = ['Free-tier cloud (Vercel/Render/Railway)', 'Free-tier database (Postgres/Mongo)', 'GitHub (repo + CI)'];
  if (isCloudHeavy(text)) resourcesRequired.push('Occasional paid compute for benchmarks (keep runs short)');
  if (/llm|openai|anthropic|gpt/.test(lc(text))) resourcesRequired.push('LLM API credits (start with the smallest model)');
  if (hasHardware(text)) resourcesRequired.push('Low-cost hardware (e.g. Raspberry Pi / sensor kit)');

  const executionRisks = ['Scope creep beyond the core happy path', 'Skipping deployment until the end (leave time for it early)'];
  if (difficulty === 'advanced' || difficulty === 'research-grade') executionRisks.push('Underestimating the hard technical core — timebox spikes');
  if (rolesRequired.length > 2) executionRisks.push('Needing skills you do not yet have — pair the build with focused learning');

  const shouldBuildVerdict = difficulty === 'research-grade'
    ? 'Build it if you can commit 8+ weeks and want an innovation-grade, patent-trackable artifact; otherwise pick an advanced project first.'
    : difficulty === 'beginner'
      ? 'Good quick win — ship it, then layer on a harder project to show range.'
      : 'Strong portfolio choice — feasible solo with a focused MVP scope.';

  return {
    difficulty,
    teamSize,
    rolesRequired: uniq(rolesRequired),
    mustHaveSkills: skills.slice(0, 6),
    goodToHaveSkills: ['Testing', 'CI/CD', 'Docker', 'Observability'].filter((g) => !skills.some((s) => lc(s) === lc(g))).slice(0, 4),
    estimatedTimeline: recommendation.estimatedTime || TIMELINE[difficulty],
    costEstimateIndia: costBand,
    resourcesRequired: uniq(resourcesRequired),
    executionRisks,
    soloBuilderAdvice: difficulty === 'research-grade' || difficulty === 'advanced'
      ? 'Solo is possible — cut scope to one defensible core, fake everything around it for the demo, and deploy early.'
      : 'Perfect for a solo builder — keep to one core workflow and deploy in week one.',
    shouldBuildVerdict,
  };
}
