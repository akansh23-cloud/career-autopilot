/* ============================================================
   NORMALIZE INSPIRATION  (deterministic)
   ------------------------------------------------------------
   Turns a raw source item (HN/GitHub/PH) into a normalized, buildable
   inspiration: a problem statement, a buildable project idea, suggested
   target roles + skills, difficulty, and category. No AI — keyword-driven so
   the same raw item always normalizes the same way.
   ============================================================ */

const ROLE_SIGNALS = [
  { role: 'DevOps Engineer', kws: ['kubernetes', 'docker', 'ci/cd', 'terraform', 'devops', 'observability', 'monitoring', 'sre', 'deploy', 'infra'] },
  { role: 'Data Scientist', kws: ['ml', 'machine learning', 'llm', 'ai', 'model', 'neural', 'pytorch', 'tensorflow', 'nlp', 'dataset'] },
  { role: 'Data Analyst', kws: ['analytics', 'dashboard', 'sql', 'bi', 'visualization', 'metrics', 'report'] },
  { role: 'Frontend Developer', kws: ['react', 'frontend', 'ui', 'css', 'tailwind', 'next.js', 'svelte', 'vue', 'design system'] },
  { role: 'Backend Developer', kws: ['api', 'backend', 'database', 'postgres', 'redis', 'graphql', 'microservice', 'queue', 'auth'] },
  { role: 'Full Stack Developer', kws: ['full stack', 'saas', 'webapp', 'platform', 'crud', 'mern', 'app'] },
  { role: 'Cloud Engineer', kws: ['aws', 'azure', 'gcp', 'serverless', 'lambda', 'cloud', 'iam'] },
  { role: 'Product Manager', kws: ['product', 'roadmap', 'users', 'growth', 'onboarding', 'retention'] },
];

const SKILL_SIGNALS = ['react', 'node.js', 'typescript', 'python', 'docker', 'kubernetes', 'aws', 'postgresql', 'mongodb', 'redis', 'graphql', 'terraform', 'next.js', 'tailwind', 'fastapi', 'express', 'llm', 'openai', 'rag', 'vector db', 'kafka', 'spark'];

const CATEGORY_SIGNALS = [
  { category: 'AI / LLM', kws: ['ai', 'llm', 'gpt', 'agent', 'rag', 'embedding', 'chatbot', 'ml'] },
  { category: 'DevTools', kws: ['developer', 'cli', 'sdk', 'framework', 'library', 'devtool', 'ci'] },
  { category: 'Productivity', kws: ['productivity', 'notes', 'task', 'workflow', 'automation', 'calendar'] },
  { category: 'FinTech', kws: ['finance', 'payments', 'fintech', 'billing', 'invoice', 'cost'] },
  { category: 'Data / Analytics', kws: ['analytics', 'dashboard', 'data', 'metrics', 'observability'] },
  { category: 'Infrastructure', kws: ['cloud', 'kubernetes', 'infra', 'deploy', 'serverless'] },
];

const lc = (s) => String(s || '').toLowerCase();
function hits(text, kws) { return kws.filter((k) => text.includes(k)); }

export function normalizeInspiration(raw = {}) {
  const text = `${lc(raw.sourceTitle)} ${lc(raw.sourceDescription)} ${(raw.topics || []).map(lc).join(' ')} ${lc(raw.language)}`;

  const targetRoles = ROLE_SIGNALS
    .map((r) => ({ role: r.role, score: hits(text, r.kws).length }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((r) => r.role);
  if (!targetRoles.length) targetRoles.push('Full Stack Developer');

  const suggestedSkills = Array.from(new Set([
    ...SKILL_SIGNALS.filter((s) => text.includes(s)),
    ...(raw.language ? [lc(raw.language)] : []),
  ])).slice(0, 8);

  const category = (CATEGORY_SIGNALS.find((c) => hits(text, c.kws).length) || { category: 'General' }).category;

  // Difficulty heuristic from infra/AI signals.
  const advanced = /kubernetes|distributed|llm|rag|kafka|terraform|microservice|real-?time/.test(text);
  const beginner = /todo|clone|starter|simple|beginner|tutorial/.test(text);
  const difficulty = advanced ? 'Advanced' : beginner ? 'Beginner' : 'Intermediate';

  const cleanTitle = raw.sourceTitle.includes('/') ? raw.sourceTitle.split('/').pop() : raw.sourceTitle;
  const title = `Build: ${cleanTitle}`.slice(0, 140);

  const problemStatement = raw.sourceDescription
    ? `Inspired by "${raw.sourceTitle}": ${raw.sourceDescription}`.slice(0, 400)
    : `A trending ${category} project inspired by "${raw.sourceTitle}".`;

  const buildableProjectIdea = `Recreate a focused version of "${cleanTitle}" as a portfolio project: ship a working ${category} app with a clear problem, real deployment, and recruiter-visible proof (README, live demo, measurable results).`;

  const businessAngle = `${category} space is active right now (signal from ${raw.source}). A focused, well-built version doubles as a startup MVP and strong proof-of-work.`;

  return {
    source: raw.source,
    sourceId: raw.sourceId,
    sourceUrl: raw.sourceUrl,
    sourceTitle: raw.sourceTitle,
    sourceDescription: raw.sourceDescription || '',
    title,
    summary: buildableProjectIdea.slice(0, 200),
    problemStatement,
    buildableProjectIdea,
    businessAngle,
    targetRoles,
    suggestedSkills,
    difficulty,
    estimatedDuration: difficulty === 'Advanced' ? '3-5 weeks' : difficulty === 'Beginner' ? '3-7 days' : '1-3 weeks',
    category,
    tags: suggestedSkills.slice(0, 6),
    rawPayload: raw,
  };
}

export default { normalizeInspiration };
