/* ============================================================
   Project Brief service — "what am I actually building?"
   ------------------------------------------------------------
   The gap this closes: a generated project (or a patent idea
   converted into a POC) arrived in the workspace as a pile of
   artifacts — APIs, schema, task list — with no plain-language
   explanation of what the thing IS, who it is for, how it works,
   or what "finished" looks like. Students opened the workspace
   and could not tell you what they were building.

   This service produces that explanation.

   AI usage follows the existing house rule: the STRUCTURE is
   deterministic and backend-owned; AI (Gemini / Anthropic /
   OpenAI, whichever is configured — see problemIntelligence
   config) only writes the prose on top. With no key configured,
   the deterministic brief is complete and useful on its own. The
   response always reports which provider wrote it and at what
   confidence, so nothing is passed off as authoritative that was
   in fact templated.

   Never throws. Never blocks on the network.
   ============================================================ */

import { getAIProvider } from '../problemIntelligence/ai/aiProvider.js';
import { piConfig } from '../problemIntelligence/config.js';
import { detectDiscipline, hasSoftwareComponent } from './disciplineProfiles.js';

const str = (v, max = 800) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const arr = (v, max = 10, len = 240) =>
  (Array.isArray(v) ? v : []).filter(Boolean).map((x) => str(x, len)).filter(Boolean).slice(0, max);
const first = (...vals) => vals.find((v) => str(v).length > 0) || '';

/* ---------------- glossary ----------------
   Every brief lists the terms a student is likely to hit and does
   not know. Deterministic; AI may add to it but never replaces it. */
const GLOSSARY = {
  'reduction to practice': 'Proving an idea actually works by building and demonstrating it, rather than only describing it. It matters for IP because a working prototype is much stronger evidence than a description.',
  'prior art': 'Anything already public that resembles your idea — patents, papers, products, even a forum post. It sets the bar your idea has to clear to be considered new.',
  mvp: 'Minimum Viable Product — the smallest version that still solves the core problem for a real user. Everything not on that path is deliberately postponed.',
  baseline: 'The dumbest approach that could work, measured first. If your clever solution cannot beat it, the cleverness is not earning its keep.',
  'control (experiment)': 'A version of the experiment where the thing you are testing is absent, run alongside the real one. Without it you cannot tell whether your result came from your intervention or from chance.',
  'bill of materials': 'The complete list of physical parts with quantities, suppliers and prices. Writing it before ordering is what stops a hardware project stalling halfway.',
  calibration: 'Comparing your instrument against a trusted reference and recording the difference, so your readings mean something to someone else.',
  'held-out test set': 'Data your model never saw during training, used exactly once at the end. Looking at it repeatedly quietly invalidates your result.',
  'factor of safety': 'How much stronger the design is than the worst load it should ever see. Codes specify the minimum; your report has to show you cleared it.',
  'happy path': 'The main flow where nothing goes wrong. Build it end-to-end first; error handling comes after it works once.',
};

function glossaryFor(text, discipline) {
  const hay = String(text || '').toLowerCase();
  const picked = [];
  for (const [term, meaning] of Object.entries(GLOSSARY)) {
    const key = term.split(' (')[0];
    if (hay.includes(key)) picked.push({ term, meaning });
  }
  // Always seed the discipline's own must-know terms.
  const seeds = {
    hardware: ['bill of materials', 'calibration'],
    data_ml: ['baseline', 'held-out test set'],
    bio_chem: ['control (experiment)'],
    mechanical: ['factor of safety'],
    civil_infra: ['factor of safety'],
    software: ['mvp', 'happy path'],
    business_ops: ['mvp'],
  }[discipline?.id] || ['mvp'];
  for (const s of seeds) {
    if (!picked.some((p) => p.term === s) && GLOSSARY[s]) picked.push({ term: s, meaning: GLOSSARY[s] });
  }
  return picked.slice(0, 6);
}

/* ---------------- deterministic brief ---------------- */

export function deterministicBrief(project = {}, discipline = detectDiscipline(project)) {
  const title = first(project.title, project.projectTitle, 'this project');
  const problem = first(project.problem, project.painPoint, project.problemStatement,
    'a specific, repeated problem that current approaches handle badly');
  const solution = first(project.proposedSolution, project.summary, project.mvpDescription,
    'a focused tool that removes the manual work in that problem');
  const users = first(project.targetUser, project.affectedUsers, 'the people who face this problem day to day');
  const mechanism = first(project.technicalMechanism, project.processingLogic, '');
  const softwarePart = hasSoftwareComponent(discipline, project);

  const stages = [
    { stage: 'Input', what: first(project.inputData, `What goes in: the raw material, data or measurement ${title} starts from.`) },
    { stage: 'Processing', what: first(mechanism, `The core work: where ${title} turns that input into something useful. This is the part worth explaining carefully — it is what makes the project yours.`) },
    { stage: 'Output', what: first(project.outputResult, `What comes out: the result a user acts on, in a form they can trust.`) },
    { stage: 'Feedback', what: first(project.feedbackLoop, 'What you learn from a real run, and how that changes the next one.') },
  ];

  return {
    discipline: discipline.id,
    disciplineLabel: discipline.label,
    disciplineConfidence: discipline.confidence,

    oneLine: str(`${title} — ${verbPhrase(discipline)} for ${users}.`, 220),
    inPlainEnglish: str(
      `You are building ${title}. Today, ${lower(problem)} ${capitalize(lower(solution))} ` +
      `The point of the build is not the feature list — it is being able to show one person the thing working and have them immediately understand why it matters.`,
      1200),
    whoIsItFor: str(audienceSentence(users, problem), 400),
    problemInOneParagraph: str(problem, 900),
    whatSuccessLooksLike: str(
      `Success is not "all features done". Success is: ${discipline.runMeans}, and you can show ` +
      `${discipline.proofArtifacts[0] ? lower(discipline.proofArtifacts[0]) : 'evidence it works'} to someone who was not involved in building it.`,
      600),

    howItWorks: stages,
    buildUnits: buildUnitsFor(project, discipline),
    buildUnitLabel: discipline.buildUnit,

    firstWeek: discipline.firstWeek,
    toolchain: discipline.toolchain,
    proofArtifacts: discipline.proofArtifacts,
    howYouKnowItWorks: discipline.validation,
    costReality: discipline.costNote,

    notBuildingYet: notYetFor(discipline),
    commonFailureMode: failureModeFor(discipline),
    glossary: glossaryFor([title, problem, solution, mechanism].join(' '), discipline),

    softwareComponent: softwarePart,
    note: softwarePart || discipline.id === 'software'
      ? null
      : `This is not a web app — it is a ${discipline.label.toLowerCase()} project. The build steps below are deliberately not web-app steps, so ignore any "run npm" style instructions if you meet them elsewhere in the workspace.`,

    generatedBy: 'deterministic',
    confidence: 'low',
  };
}

function audienceSentence(users, problem) {
  const u = str(users, 200);
  if (!u) return 'The people who hit this problem regularly — name a specific one before you start building, because a vague user produces a vague product.';
  // A bare label ("Small farmer") is not an audience description; expand it.
  if (u.split(/\s+/).length <= 4) {
    return `${capitalize(u)} — specifically the ones who currently deal with ${lower(str(problem, 240)) || 'this problem'} by hand. Pick one real person in that group and build for them, not for the category.`;
  }
  return u;
}

function verbPhrase(d) {
  return {
    software: 'a working tool that removes a repeated manual step',
    hardware: 'a physical rig that measures or controls something real',
    data_ml: 'a model that makes a specific, measurable prediction',
    mechanical: 'a physical assembly designed and tested against real loads',
    bio_chem: 'a lab protocol that tests one clear hypothesis',
    civil_infra: 'a code-compliant design backed by real site data',
    business_ops: 'a redesigned workflow proven on a real pilot',
  }[d.id] || 'a working solution';
}

function buildUnitsFor(project, d) {
  const given = arr(project.coreFeatures || project.mvpScope || project.mvpFeatures, 8);
  if (given.length) return given;
  return {
    software: ['The one screen the user spends their time on', 'The service that does the actual work', 'Storage for the records that matter', 'A result view someone can screenshot', 'Deployment so it has a URL'],
    hardware: ['Sensing / input subsystem', 'Power and wiring', 'Firmware read loop', 'Data logging', 'Enclosure and mounting'],
    data_ml: ['Dataset acquisition and cleaning', 'Baseline model', 'Feature pipeline', 'Evaluation harness', 'A minimal way to run inference on a new example'],
    mechanical: ['Requirement sheet with numbers', 'CAD of the critical part', 'Load / motion analysis', 'Fabricated prototype', 'Test rig and results'],
    bio_chem: ['Hypothesis statement', 'Written protocol', 'Controls', 'Run and raw data capture', 'Analysis and replication'],
    civil_infra: ['Site / survey data', 'Preliminary design', 'Code-compliance checks', 'Analysis model', 'Drawings and estimate'],
    business_ops: ['Evidence from real interviews', 'Current-process map with timings', 'The redesigned step', 'A small live pilot', 'Before/after measurement'],
  }[d.id] || ['Core capability', 'Supporting work', 'Result and evidence'];
}

function notYetFor(d) {
  const common = ['Anything not on the path from input to a result someone can see'];
  return {
    software: ['Multi-tenant billing', 'Mobile apps', 'SSO / advanced auth', ...common],
    hardware: ['Custom PCB fabrication', 'Injection-moulded enclosure', 'Wireless mesh networking', ...common],
    data_ml: ['A larger architecture before the baseline is beaten', 'Hyperparameter sweeps', 'A serving cluster', ...common],
    mechanical: ['Production tooling', 'Full assembly when one part is the risk', 'Aesthetic finishing', ...common],
    bio_chem: ['Scaling up before one clean replicated run', 'Novel reagent synthesis', ...common],
    civil_infra: ['Full site detailing before the governing check clears', 'Complete BIM model', ...common],
    business_ops: ['A software product before the manual pilot works', 'Nationwide rollout plans', ...common],
  }[d.id] || common;
}

function failureModeFor(d) {
  return {
    software: 'Building six half-features instead of one that works end to end. Deploy something empty on day one and grow it.',
    hardware: 'Ordering parts before writing the bill of materials, then losing three weeks to a component that never arrives.',
    data_ml: 'Skipping the baseline, then having no way to say whether the model is actually good.',
    mechanical: 'Trusting a simulation that was never sanity-checked by hand against a governing calculation.',
    bio_chem: 'Running the experiment once, getting a nice result, and having no controls or replicates to defend it.',
    civil_infra: 'Designing against assumed ground conditions and discovering the real site data invalidates the whole layout.',
    business_ops: 'Presenting a projected saving instead of a measured one from a real pilot.',
  }[d.id] || 'Scope creep — adding work before the core path produces a visible result.';
}

const lower = (s) => { const t = str(s, 900); return t ? t.charAt(0).toLowerCase() + t.slice(1) : t; };
const capitalize = (s) => { const t = str(s, 900); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };

/* ---------------- AI-enriched brief ---------------- */

const AI_FIELDS = ['oneLine', 'inPlainEnglish', 'whoIsItFor', 'problemInOneParagraph', 'whatSuccessLooksLike', 'howYouKnowItWorks', 'commonFailureMode'];
const AI_LISTS = ['firstWeek', 'buildUnits', 'notBuildingYet', 'proofArtifacts'];

/**
 * buildProjectBrief({ project, audience, cfg })
 *
 * Returns a complete brief. `generatedBy` is the provider that wrote
 * the prose ('gemini' | 'anthropic' | 'openai' | 'deterministic') and
 * `confidence` reflects that — a templated brief never claims medium.
 */
export async function buildProjectBrief({ project = {}, audience = 'student' } = {}, cfg = piConfig()) {
  const discipline = detectDiscipline(project);
  const base = deterministicBrief(project, discipline);

  let ai = null;
  try {
    const provider = getAIProvider(cfg);
    const out = await provider.freeformJSON(
      `You explain a ${discipline.label} project to a ${audience} who has just opened their project workspace and does not yet understand what they are building. ` +
      'Plain, concrete language. No buzzwords, no marketing tone, no legal claims about patentability. ' +
      `This is NOT necessarily a web app — it is a ${discipline.label} project, so do not suggest frontend screens, APIs or npm commands unless the project genuinely involves software. ` +
      `Refer to build units as "${discipline.buildUnit}s". "Running it" here means: ${discipline.runMeans}. ` +
      'Shape: {"oneLine","inPlainEnglish","whoIsItFor","problemInOneParagraph","whatSuccessLooksLike","howYouKnowItWorks","commonFailureMode",' +
      '"howItWorks":[{"stage","what"}],"buildUnits":[],"firstWeek":[],"notBuildingYet":[],"proofArtifacts":[],"glossary":[{"term","meaning"}]}. ' +
      'inPlainEnglish should be 4-6 sentences and must answer "what is this thing?" before anything else.',
      [
        `Title: ${first(project.title, project.projectTitle)}`,
        `Domain: ${str(project.domain, 120)}`,
        `Problem: ${first(project.problem, project.painPoint, project.problemStatement)}`,
        `Proposed solution: ${first(project.proposedSolution, project.summary, project.mvpDescription)}`,
        `Technical mechanism: ${str(project.technicalMechanism, 600)}`,
        `Target user: ${first(project.targetUser, project.affectedUsers)}`,
        `Inputs: ${str(project.inputData, 300)}`,
        `Outputs: ${str(project.outputResult, 300)}`,
        `Known scope: ${arr(project.mvpScope || project.coreFeatures, 8).join('; ')}`,
      ].filter((l) => !/:\s*$/.test(l)).join('\n'),
      2000,
    );
    ai = out?.data || null;
    if (ai) base.generatedBy = out.provider;
  } catch { ai = null; }

  if (!ai) return base;

  for (const f of AI_FIELDS) if (str(ai[f]).length > 20) base[f] = str(ai[f], f === 'inPlainEnglish' ? 1600 : 900);
  for (const f of AI_LISTS) { const v = arr(ai[f], 8); if (v.length) base[f] = v; }

  if (Array.isArray(ai.howItWorks) && ai.howItWorks.length) {
    const stages = ai.howItWorks
      .filter((s) => s && (s.stage || s.what))
      .map((s) => ({ stage: str(s.stage, 60), what: str(s.what, 500) }))
      .slice(0, 6);
    if (stages.length) base.howItWorks = stages;
  }

  if (Array.isArray(ai.glossary) && ai.glossary.length) {
    const extra = ai.glossary
      .filter((g) => g && g.term && g.meaning)
      .map((g) => ({ term: str(g.term, 60), meaning: str(g.meaning, 320) }));
    const seen = new Set(base.glossary.map((g) => g.term.toLowerCase()));
    for (const g of extra) {
      if (!seen.has(g.term.toLowerCase())) { base.glossary.push(g); seen.add(g.term.toLowerCase()); }
    }
    base.glossary = base.glossary.slice(0, 8);
  }

  base.confidence = 'medium';
  return base;
}

export default { buildProjectBrief, deterministicBrief };
