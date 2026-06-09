/* ============================================================
   Task 3 — "Explain This Project" service
   ------------------------------------------------------------
   Student-friendly explainer (mirrors Patent OS "Explain What To
   Build"). Deterministic; AI may enrich but is never required.
   ============================================================ */
import { asList, uniq, lc } from './util.js';

const firstSentence = (s) => String(s || '').split(/(?<=[.!?])\s/)[0] || String(s || '');

export function explainProject({ project = {}, recommendation = {} } = {}) {
  const title = recommendation.title || project.title || 'this project';
  const role = recommendation.targetRole || project.targetRole || 'your target role';
  const problem = recommendation.problemStatement || project.problemStatement || project.summary ||
    'a specific, repeated workflow problem that current tools handle poorly';
  const skills = uniq(asList(recommendation.skills).concat(asList(project.skillsCovered)).concat(asList(project.skills)));
  const proof = uniq(asList(recommendation.evidenceNeeded).concat(asList(project.expectedProofArtifacts)));

  const isAnalyzer = /analy|detect|diagnos|root.?cause|scan/i.test(title);
  const isPipeline = /pipeline|etl|elt|stream|warehouse|lakehouse/i.test(title);

  const mvpModules = deriveModules(title, isAnalyzer, isPipeline);
  const lowerProblem = lc(problem);

  return {
    oneLineSummary: `${title} — a focused tool that helps ${audienceFor(title, role)} ${actionFor(title)}.`,
    problemSolved: firstSentence(problem),
    whoWillUseIt: audienceFor(title, role),
    whatToBuild: `Build ${title}. ${describeBuild(title, isAnalyzer, isPipeline, mvpModules)}`,
    mvpModules,
    howItWorks: workflowFor(title, isAnalyzer, isPipeline, mvpModules),
    whatNotToBuildYet: ['Multi-tenant billing', 'Mobile apps', 'Advanced auth/SSO', 'Anything not on the core happy path'],
    firstWeekTasks: [
      'Scaffold the repo (frontend + backend + README + CI stub)',
      `Build the first module: ${mvpModules[0] || 'the core input'}`,
      'Wire a single end-to-end happy path with fake data',
      'Deploy a "hello world" version so deployment is solved early',
    ],
    skillsNeeded: skills.length ? skills : ['JavaScript', 'APIs', 'a database', 'deployment'],
    demoMoment: `In the demo, ${demoFor(title, isAnalyzer, isPipeline)} — that one moment is what recruiters remember.`,
    finalOutcome: `A deployed ${title} with a clean README, ${proof.slice(0, 3).join(', ') || 'screenshots and tests'}, and resume bullets you can actually defend in an interview.`,
    confidence: lowerProblem.length > 30 ? 'High' : 'Medium',
  };
}

function deriveModules(title, isAnalyzer, isPipeline) {
  if (isAnalyzer) return ['Upload / input UI', 'Parser', 'Analysis / root-cause engine', 'Recommendation service', 'Results dashboard', 'Export report'];
  if (isPipeline) return ['Source connector', 'Transform layer', 'Data-quality checks', 'Orchestration / scheduler', 'Warehouse load', 'Metrics dashboard'];
  return ['Auth + workspace', 'Core workflow screen', 'Backend API + persistence', 'Results / dashboard', 'Deploy + README'];
}

function audienceFor(title, role) {
  if (/clinic|patient|health/i.test(title)) return 'small clinics and their staff';
  if (/devops|kubernetes|deploy|ci/i.test(title)) return 'DevOps and platform engineers';
  if (/data|etl|pipeline|warehouse/i.test(title)) return 'data engineers and analysts';
  return `people working toward ${role}-style problems`;
}
function actionFor(title) {
  if (/analy|detect|diagnos/i.test(title)) return 'find the root cause fast and act on it';
  if (/pipeline|etl|stream/i.test(title)) return 'move and trust their data reliably';
  return 'finish one important workflow without manual effort';
}
function describeBuild(title, isAnalyzer, isPipeline, modules) {
  if (isAnalyzer) return `A user uploads input (e.g. logs/events). Your backend parses it, detects the root cause, and shows a simple report with fix suggestions.`;
  if (isPipeline) return `Data flows from a source through transforms and quality checks into a warehouse, on a schedule, with a dashboard showing freshness and failures.`;
  return `Keep scope to ${modules.slice(0, 3).join(' → ')} so it ships.`;
}
function workflowFor(title, isAnalyzer, isPipeline) {
  if (isAnalyzer) return 'Upload input → parse → analyze/root-cause → recommend fixes → show dashboard → export report.';
  if (isPipeline) return 'Extract from source → transform → run data-quality checks → load to warehouse → schedule → visualise freshness/failures.';
  return 'Sign up → set up workspace → complete the core task → see the result → return and review history.';
}
function demoFor(title, isAnalyzer, isPipeline) {
  if (isAnalyzer) return 'you upload a broken input and the tool instantly explains the root cause and the fix';
  if (isPipeline) return 'you trigger the pipeline and the dashboard shows data landing with quality checks passing';
  return 'you complete the core task end-to-end in under a minute on the live URL';
}
