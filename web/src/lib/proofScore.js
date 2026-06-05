// Project Proof Score (Part 3 / Part 5).
// Scores a project out of 100 from REAL evidence (GitHub analysis, verified
// live link, README, architecture diagram, screenshots, tests/CI, checklist,
// interview prep, recruiter summary), returns a breakdown, the missing items,
// and concrete next steps. computeProofScore() in projectStore delegates here.

const has = (s) => typeof s === 'string' && s.trim().length > 0;
const len = (a) => (Array.isArray(a) ? a.length : 0);

function checklistPct(p = {}) {
  const c = p.checklist || [];
  if (!c.length) return 0;
  return c.filter((x) => x.done).length / c.length;
}
const ghOk = (p) => !!(p.github && p.github.success);
const ghFiles = (p) => (ghOk(p) ? p.github.files || {} : {});
const liveVerified = (p) => !!(p.liveVerification && p.liveVerification.reachable);
const readmeOk = (p) => (ghOk(p) && p.github.readme && p.github.readme.exists) || (has(p.readme) && p.readme.trim().length > 120);
const archOk = (p) => has(p.architectureDiagram) || has(p.architecture);
const deployOk = (p) => {
  const f = ghFiles(p);
  return liveVerified(p) || !!(f.githubWorkflows || f.Dockerfile || f['docker-compose.yml'] || f.deployment || f.terraform || f.kubernetes);
};
const testsOk = (p) => checklistPct(p) >= 0.7 || !!ghFiles(p).tests;

// Part 3 point allocation (sums to 110, capped at 100 - so any one gap is OK).
export const PROOF_WEIGHTS = {
  githubAdded: 10,
  githubAnalysis: 10,
  readme: 10,
  liveDemo: 15,
  architecture: 10,
  screenshots: 10,
  tests: 10,
  deployment: 10,
  checklist: 15,
  interview: 5,
  recruiterSummary: 5,
};

export function proofBreakdown(p = {}) {
  const pct = checklistPct(p);

  const rows = [
    {
      key: 'githubAdded', label: 'GitHub repo added', max: PROOF_WEIGHTS.githubAdded,
      score: has(p.githubUrl) ? PROOF_WEIGHTS.githubAdded : 0,
      tip: 'Push the code and paste your public GitHub repo URL.',
    },
    {
      key: 'githubAnalysis', label: 'GitHub analysis passes', max: PROOF_WEIGHTS.githubAnalysis,
      score: ghOk(p) ? PROOF_WEIGHTS.githubAnalysis : 0,
      tip: 'Run "Analyze repo" so the stack and files are verified.',
    },
    {
      key: 'readme', label: 'README quality', max: PROOF_WEIGHTS.readme,
      score: readmeOk(p) ? PROOF_WEIGHTS.readme : (has(p.readme) ? Math.round(PROOF_WEIGHTS.readme * 0.5) : 0),
      tip: 'Generate or expand the README with setup, screenshots and results.',
    },
    {
      key: 'liveDemo', label: 'Live demo verified', max: PROOF_WEIGHTS.liveDemo,
      score: liveVerified(p) ? PROOF_WEIGHTS.liveDemo : (has(p.liveDemoUrl) ? Math.round(PROOF_WEIGHTS.liveDemo * 0.4) : 0),
      tip: 'Deploy the project, add the URL, then click "Verify live demo".',
    },
    {
      key: 'architecture', label: 'Architecture diagram', max: PROOF_WEIGHTS.architecture,
      score: archOk(p) ? PROOF_WEIGHTS.architecture : 0,
      tip: 'Generate the architecture diagram on the Architecture tab.',
    },
    {
      key: 'screenshots', label: 'Screenshots / demo proof', max: PROOF_WEIGHTS.screenshots,
      score: len(p.screenshots) > 0 ? PROOF_WEIGHTS.screenshots : 0,
      tip: 'Add screenshots or a short demo clip.',
    },
    {
      key: 'tests', label: 'Tests / checklist proof', max: PROOF_WEIGHTS.tests,
      score: testsOk(p) ? PROOF_WEIGHTS.tests : (pct >= 0.4 ? Math.round(PROOF_WEIGHTS.tests * 0.6) : 0),
      tip: 'Add tests (a tests/ folder is detected automatically) or finish the checklist.',
    },
    {
      key: 'deployment', label: 'Deployment / CI-CD proof', max: PROOF_WEIGHTS.deployment,
      score: deployOk(p) ? PROOF_WEIGHTS.deployment : 0,
      tip: 'Add a Dockerfile, CI workflow or deploy config - or verify a live demo.',
    },
    {
      key: 'checklist', label: 'Checklist progress', max: PROOF_WEIGHTS.checklist,
      score: Math.round(PROOF_WEIGHTS.checklist * pct),
      tip: 'Work through the roadmap checklist.',
    },
    {
      key: 'interview', label: 'Interview explanation', max: PROOF_WEIGHTS.interview,
      score: len(p.interviewQuestions) > 0 ? PROOF_WEIGHTS.interview : 0,
      tip: 'Generate interview prep so you can defend the project.',
    },
    {
      key: 'recruiterSummary', label: 'Recruiter summary', max: PROOF_WEIGHTS.recruiterSummary,
      score: has(p.recruiterSummary) ? PROOF_WEIGHTS.recruiterSummary : 0,
      tip: 'Generate the recruiter summary on the Verification tab.',
    },
  ];

  const score = Math.min(100, rows.reduce((s, r) => s + r.score, 0));
  const missing = rows.filter((r) => r.score < r.max);

  const nextSteps = [...missing]
    .sort((a, b) => (b.max - b.score) - (a.max - a.score))
    .slice(0, 3)
    .map((r) => r.tip);

  let recommendation = '';
  if (score < 100 && nextSteps.length) {
    const gain = missing.slice(0, 2).reduce((s, r) => s + (r.max - r.score), 0);
    recommendation = `${nextSteps.slice(0, 2).join(' ')} (~ +${gain} points -> ${Math.min(100, score + gain)}/100).`;
  }

  return { score, rows, missing, nextSteps, recommendation };
}

export function proofScore(p = {}) {
  return proofBreakdown(p).score;
}
