// Project Proof Score (Part 5).
// Scores a project out of 100 from REAL evidence, returns a breakdown, the
// missing items, and concrete next steps. computeProofScore() in projectStore
// delegates here so every existing import keeps returning a number.

const has = (s) => typeof s === 'string' && s.trim().length > 0;
const len = (a) => (Array.isArray(a) ? a.length : 0);

function checklistPct(p = {}) {
  const c = p.checklist || [];
  if (!c.length) return 0;
  return c.filter((x) => x.done).length / c.length;
}

// Weighted dimensions — total 100.
export const PROOF_WEIGHTS = {
  usefulness: 10,
  complexity: 10,
  github: 15,
  liveDemo: 15,
  readme: 15,
  screenshots: 10,
  architecture: 10,
  testing: 10,
  interview: 5,
};

export function proofBreakdown(p = {}) {
  const pct = checklistPct(p);
  const diff = { Beginner: 0.5, Intermediate: 0.75, Advanced: 1 }[p.difficulty] ?? 0.7;
  const stackDepth = Math.min(1, len(p.techStack) / 6);

  const rows = [
    {
      key: 'usefulness', label: 'Real-world usefulness', max: PROOF_WEIGHTS.usefulness,
      score: has(p.useCase) || has(p.problemStatement) ? PROOF_WEIGHTS.usefulness : 0,
      tip: 'Describe a real problem the project solves.',
    },
    {
      key: 'complexity', label: 'Project complexity', max: PROOF_WEIGHTS.complexity,
      score: Math.round(PROOF_WEIGHTS.complexity * Math.max(diff, stackDepth)),
      tip: 'Add more depth to the stack or tackle an advanced variant.',
    },
    {
      key: 'github', label: 'GitHub repo added', max: PROOF_WEIGHTS.github,
      score: has(p.githubUrl) ? PROOF_WEIGHTS.github : 0,
      tip: 'Push the code and paste your public GitHub repo URL.',
    },
    {
      key: 'liveDemo', label: 'Live demo added', max: PROOF_WEIGHTS.liveDemo,
      score: has(p.liveDemoUrl) ? PROOF_WEIGHTS.liveDemo : 0,
      tip: 'Deploy the project and add the live demo URL.',
    },
    {
      key: 'readme', label: 'README quality', max: PROOF_WEIGHTS.readme,
      score: has(p.readme) && p.readme.trim().length > 200 ? PROOF_WEIGHTS.readme
        : has(p.readme) && p.readme.trim().length > 40 ? Math.round(PROOF_WEIGHTS.readme * 0.6) : 0,
      tip: 'Generate or expand the README with setup, screenshots and results.',
    },
    {
      key: 'screenshots', label: 'Screenshots / demo proof', max: PROOF_WEIGHTS.screenshots,
      score: len(p.screenshots) > 0 ? PROOF_WEIGHTS.screenshots : 0,
      tip: 'Add screenshots or a short demo clip.',
    },
    {
      key: 'architecture', label: 'Architecture / design', max: PROOF_WEIGHTS.architecture,
      score: has(p.architecture) ? PROOF_WEIGHTS.architecture : 0,
      tip: 'Document the architecture and key design decisions.',
    },
    {
      key: 'testing', label: 'Testing / checklist', max: PROOF_WEIGHTS.testing,
      score: pct >= 0.7 ? PROOF_WEIGHTS.testing : pct >= 0.4 ? Math.round(PROOF_WEIGHTS.testing * 0.6) : 0,
      tip: 'Add tests and complete the project checklist.',
    },
    {
      key: 'interview', label: 'Interview explanation', max: PROOF_WEIGHTS.interview,
      score: len(p.interviewQuestions) > 0 ? PROOF_WEIGHTS.interview : 0,
      tip: 'Generate interview prep so you can defend the project.',
    },
  ];

  const score = Math.min(100, rows.reduce((s, r) => s + r.score, 0));
  const missing = rows.filter((r) => r.score < r.max);

  // Build 1–3 high-impact next steps (largest gaps first).
  const nextSteps = [...missing]
    .sort((a, b) => (b.max - b.score) - (a.max - a.score))
    .slice(0, 3)
    .map((r) => r.tip);

  let recommendation = '';
  if (score < 100 && nextSteps.length) {
    const gain = missing.slice(0, 2).reduce((s, r) => s + (r.max - r.score), 0);
    recommendation = `${nextSteps.slice(0, 2).join(' ')} (≈ +${gain} points → ${Math.min(100, score + gain)}/100).`;
  }

  return { score, rows, missing, nextSteps, recommendation };
}

export function proofScore(p = {}) {
  return proofBreakdown(p).score;
}
