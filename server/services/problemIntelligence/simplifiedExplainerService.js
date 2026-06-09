/* ============================================================
   Service — simplified explainer ("Explain What To Build")
   ------------------------------------------------------------
   Turns a generated project into plain, student-friendly language
   across audiences (beginner/intermediate/faculty/patent_agent/
   recruiter). AI writes the prose when available; a deterministic
   fallback always produces a complete, useful explanation. Clarity
   scores are computed deterministically from content completeness.
   ============================================================ */
import { getAIProvider } from './ai/aiProvider.js';
import { sanitizeText, lc } from './util.js';

const AUDIENCES = ['beginner', 'intermediate', 'faculty', 'recruiter', 'patent_agent'];
const DETAILS = ['simple', 'normal', 'detailed'];
const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map((x) => sanitizeText(String(x), 220)) : []);
const TECH_EFFECT = /(latency|throughput|hardware|sensor|signal|device|real-?time|pipeline|edge|fault|anomaly|compression|optimi[sz])/;

export async function simplifyProject({ project = {}, audience = 'beginner', detailLevel = 'normal' }, cfg) {
  const aud = AUDIENCES.includes(audience) ? audience : 'beginner';
  const detail = DETAILS.includes(detailLevel) ? detailLevel : 'normal';
  const det = deterministic(project, aud);

  const ai = getAIProvider(cfg);
  const { data } = await ai.freeformJSON(
    `You explain a software/innovation project to a ${aud} reader at "${detail}" detail. Use plain, concrete language; NO buzzwords; NO legal claims. For a beginner, avoid jargon entirely. Shape (all strings unless noted): {"oneLineSummary","simpleHook","painPoint","whoFacesIt","realWorldScenario","currentWorkaround","whyExistingSolutionsFail","whatToBuild","mvpModules":[],"howItSolvesProblem","demoMoment","skillsNeeded":[],"firstWeekTasks":[],"patentAngleSimple","technicalChallenge","whatNotToBuildYet":[]}.`,
    `Title: ${project.title}\nProblem: ${project.painPoint}\nSolution: ${project.proposedSolution}\nNovelty: ${project.noveltyAngle}\nAffected users: ${project.affectedUsers}\nMVP: ${(project.mvpScope || []).join('; ')}\nSkills: ${(project.requiredSkills || []).join(', ')}`,
    1800,
  );

  const merged = { ...det, ...pickStrings(data, det), confidence: data ? 'medium' : 'low' };
  merged.audience = aud;
  merged.detailLevel = detail;
  merged.clarityScores = clarityScores(merged, project);
  merged.missingInfo = missingInfo(merged);
  return merged;
}

function deterministic(p, audience) {
  const users = p.affectedUsers || (p.targetUser ? `${p.targetUser}` : 'the people who hit this problem');
  const fr = p.framing || {};
  const build = p.proposedSolution || fr.whatToBuild || '';
  const base = {
    oneLineSummary: sanitizeText(`A tool that helps ${lc(users)} ${verbFor(p)} — built from real, source-backed problem signals.`, 200),
    simpleHook: sanitizeText(fr.hook || p.title || 'A tool people actually need', 160),
    painPoint: sanitizeText(p.painPoint || fr.painPoint, 600),
    whoFacesIt: sanitizeText(users, 300),
    realWorldScenario: sanitizeText(fr.realWorldScenario || p.currentWorkaround || 'Today this is handled manually, step by step, which is slow and error-prone.', 600),
    currentWorkaround: sanitizeText(p.currentWorkaround || fr.brokenWorkaround, 600),
    whyExistingSolutionsFail: sanitizeText(p.whyExistingSolutionsFail || fr.whyExistingNotEnough, 600),
    whatToBuild: sanitizeText(build, 900),
    mvpModules: arr(p.mvpScope).slice(0, 8),
    howItSolvesProblem: sanitizeText(`It gathers the relevant signals, processes them, and shows ${lc(users)} a clear answer plus a next step — replacing the manual checking they do today.`, 600),
    demoMoment: sanitizeText(fr.demoMoment || 'The moment the tool surfaces the likely cause and a concrete fix, and the user says "that\'s exactly it".', 400),
    skillsNeeded: arr(p.requiredSkills).slice(0, 10),
    firstWeekTasks: firstWeek(p),
    patentAngleSimple: sanitizeText(`Any IP angle would live in HOW it works technically (${p.noveltyAngle || 'the processing/correlation method'}) — treat that as "worth review later", not a guarantee.`, 400),
    technicalChallenge: sanitizeText(p.noveltyAngle || fr.technicalChallenge || 'Making the output trustworthy and fast enough to be useful.', 400),
    whatNotToBuildYet: notYet(p),
  };
  if (audience === 'recruiter') {
    // Recruiter-safe: never expose confidential novelty/claim detail.
    base.patentAngleSimple = 'IP status: kept confidential pending review — not disclosed in this summary.';
    base.technicalChallenge = 'Demonstrates applied problem-solving on a real, evidenced problem.';
  }
  return base;
}

function verbFor(p) {
  const t = lc(`${p.title} ${p.proposedSolution}`);
  if (/detect|find|diagnos|root.?cause/.test(t)) return 'quickly find out what went wrong and what to do next';
  if (/track|monitor/.test(t)) return 'keep track of what matters without manual checking';
  if (/recommend|match|suggest/.test(t)) return 'get the right suggestion at the right time';
  return 'solve a recurring, real problem with less manual effort';
}

function firstWeek(p) {
  const skill = (p.requiredSkills || [])[0] || 'your main stack';
  return [
    `Set up the repo, a README, and a minimal ${skill} project skeleton.`,
    'Hard-code one realistic example input and render a fake-but-believable output (the "demo moment") first.',
    'Replace the fake output with the simplest real version of the core logic.',
    'Write down 3 example scenarios you will demo, and capture screenshots as you go (evidence).',
  ];
}

function notYet(p) {
  const out = ['Accounts, billing, and multi-tenant setup — not needed for the MVP demo.', 'Mobile apps / fancy dashboards before the core logic works.'];
  if (!TECH_EFFECT.test(lc(`${p.title} ${p.proposedSolution} ${p.noveltyAngle}`))) out.push('Heavy ML/AI before a rule-based version proves the idea.');
  return out;
}

function clarityScores(m, p) {
  const L = (s) => String(s || '').trim().length;
  const painClarity = clamp((L(m.painPoint) > 80 ? 60 : L(m.painPoint) / 1.3) + ((p.sourcesUsed || 0) > 0 ? 30 : 0));
  const buildClarity = clamp((m.mvpModules.length * 12) + (L(m.whatToBuild) > 120 ? 35 : 15));
  const demoClarity = clamp((L(m.demoMoment) > 60 ? 55 : 25) + (m.firstWeekTasks.length * 8));
  const ipAngleClarity = clamp((L(m.technicalChallenge) > 60 ? 45 : 20) + (TECH_EFFECT.test(lc(`${p.proposedSolution} ${p.noveltyAngle}`)) ? 35 : 10));
  return { painClarity, buildClarity, demoClarity, ipAngleClarity };
}

function missingInfo(m) {
  const out = [];
  if (m.clarityScores.painClarity < 45) out.push('Pain point needs sharper, evidenced detail (who, how often, how costly).');
  if (m.clarityScores.buildClarity < 45) out.push('MVP modules and "what to build" need more concrete specifics.');
  if (m.clarityScores.demoClarity < 45) out.push('Define a crisp, demonstrable "demo moment".');
  if (m.clarityScores.ipAngleClarity < 45) out.push('Articulate a concrete technical effect before considering any IP angle.');
  return out;
}

function pickStrings(data, fallback) {
  if (!data || typeof data !== 'object') return {};
  const fields = ['oneLineSummary', 'simpleHook', 'painPoint', 'whoFacesIt', 'realWorldScenario', 'currentWorkaround', 'whyExistingSolutionsFail', 'whatToBuild', 'howItSolvesProblem', 'demoMoment', 'patentAngleSimple', 'technicalChallenge'];
  const listFields = ['mvpModules', 'skillsNeeded', 'firstWeekTasks', 'whatNotToBuildYet'];
  const out = {};
  for (const f of fields) if (typeof data[f] === 'string' && data[f].trim()) out[f] = sanitizeText(data[f], 900);
  for (const f of listFields) if (Array.isArray(data[f]) && data[f].length) out[f] = arr(data[f]).slice(0, 10);
  return out;
}

function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

export const EXPLAINER_AUDIENCES = AUDIENCES;
export default { simplifyProject, EXPLAINER_AUDIENCES };
