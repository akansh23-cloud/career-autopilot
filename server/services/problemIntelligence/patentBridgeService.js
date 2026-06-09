/* ============================================================
   Service — patent / project bridge
   ------------------------------------------------------------
   - assembleDisclosure(): builds the invention-disclosure package
     (AI-augmented, deterministic fallback) with the mandatory
     disclaimer and public-disclosure warning.
   - toProjectPayload(): shapes a GeneratedInnovationProject into
     a record the EXISTING project store can persist as a fully usable
     Project Studio workspace.
   - toPatentIdeaPayload(): shapes it for db.createPatentIdeas so
     it lands in the existing Patent OS, carrying source-backed
     problem, novelty angle, prior-art queries and readiness.
   ============================================================ */
import { getAIProvider } from './ai/aiProvider.js';
import { INNOVATION_DISCLAIMER } from './config.js';
import { sanitizeText } from './util.js';

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const clean = (v = '', max = 500) => sanitizeText(v, max);
const uid = (prefix, i) => `${prefix}_${i + 1}`;
const uniq = (items = []) => Array.from(new Set(arr(items).map((x) => String(x).trim()).filter(Boolean)));

export async function assembleDisclosure({ project, priorArtRecords = [] }, cfg) {
  const ai = getAIProvider(cfg);
  const d = await ai.generateDisclosure({ project });
  const priorArtComparison = priorArtRecords.length
    ? priorArtRecords.map((r) => `• ${r.title} — overlap: ${r.technicalOverlap || 'n/a'}; differentiator: ${r.differentiator || 'n/a'}; blocking risk: ${r.blockingRisk || 'Unknown'}`).join('\n')
    : 'No prior-art records added yet — external prior-art risk is UNKNOWN. Complete the Prior-Art Workspace before relying on this section.';
  return {
    title: sanitizeText(d.title || project.title, 200),
    technicalField: sanitizeText(d.technicalField, 600),
    background: sanitizeText(d.background || project.painPoint, 1200),
    problem: sanitizeText(d.problem || project.painPoint, 1200),
    existingLimitations: sanitizeText(d.existingLimitations || project.whyExistingSolutionsFail, 1200),
    proposedInvention: sanitizeText(d.proposedInvention || project.proposedSolution, 1500),
    systemComponents: arr(d.systemComponents),
    technicalWorkflow: sanitizeText(d.technicalWorkflow, 1200),
    novelTechnicalContribution: sanitizeText(d.novelTechnicalContribution || project.noveltyAngle, 800),
    advantages: arr(d.advantages),
    alternativeEmbodiments: arr(d.alternativeEmbodiments),
    prototypeEvidence: sanitizeText(d.prototypeEvidence, 800) || '[Link your repo, demo, and a measured result.]',
    priorArtComparison: sanitizeText(priorArtComparison, 2500),
    possibleClaimDirections: arr(d.possibleClaimDirections),
    drawingsChecklist: arr(d.drawingsChecklist),
    publicDisclosureWarning: sanitizeText(d.publicDisclosureWarning, 600) || 'Do NOT publicly disclose before IP-cell review — public disclosure can jeopardise patentability.',
    attorneyReviewNotes: sanitizeText(d.attorneyReviewNotes, 800),
    disclaimer: INNOVATION_DISCLAIMER,
    aiProvider: d._ai?.provider || 'fallback',
    confidence: d._ai?.confidence || 'low',
  };
}

function normalizeRoadmap(blueprint = {}, project = {}) {
  const raw = arr(blueprint.weeklyRoadmap).length ? arr(blueprint.weeklyRoadmap) : arr(project.mvpScope);
  const phases = raw.length ? raw.slice(0, 8) : [
    'Set up repository, README, and local development environment.',
    'Build the first working MVP flow.',
    'Add evidence collection, tests, and a demo script.',
    'Polish the UI, documentation, and recruiter-safe summary.',
  ];
  return phases.map((item, i) => {
    if (item && typeof item === 'object') {
      const phase = clean(item.phase || item.title || `Phase ${i + 1}`, 90);
      const tasks = arr(item.tasks).length ? arr(item.tasks).map((t) => clean(t, 180)) : [clean(item.description || item.goal || phase, 180)];
      return { phase, tasks };
    }
    const label = clean(item, 180);
    return { phase: `Phase ${i + 1}`, tasks: [label] };
  });
}

function buildTasks(steps = []) {
  const tasks = [];
  steps.forEach((phase, i) => {
    arr(phase.tasks).slice(0, 6).forEach((task, j) => {
      tasks.push({ id: `task_${i + 1}_${j + 1}`, title: clean(task, 180), status: i === 0 && j === 0 ? 'inprogress' : 'todo' });
    });
  });
  return tasks.length ? tasks : [
    { id: 'task_1', title: 'Create GitHub repository and README with problem statement.', status: 'todo' },
    { id: 'task_2', title: 'Build the first MVP screen/API flow.', status: 'todo' },
    { id: 'task_3', title: 'Add demo evidence, screenshots, and test cases.', status: 'todo' },
  ];
}

function buildChecklist(project = {}, blueprint = {}) {
  const items = [
    'Write the problem statement and target user clearly.',
    'Create GitHub repository with README and architecture section.',
    'Implement the MVP workflow end-to-end.',
    'Add tests or sample scenarios.',
    'Add screenshots or a short demo video.',
    'Document what makes the solution different from existing work.',
  ];
  arr(blueprint.evidenceChecklist).slice(0, 8).forEach((x) => items.push(clean(x, 140)));
  arr(project.mvpScope).slice(0, 5).forEach((x) => items.push(`Build: ${clean(x, 110)}`));
  return uniq(items).slice(0, 14).map((label) => ({ label, done: false }));
}

function buildGuideTasks(project = {}, blueprint = {}) {
  const steps = normalizeRoadmap(blueprint, project);
  return steps.slice(0, 6).map((phase, i) => ({
    id: `guide_${i + 1}`,
    title: clean(phase.tasks?.[0] || phase.phase, 160),
    why: i === 0 ? 'This makes the project understandable and reviewable before coding.' : 'This moves the project closer to working proof instead of only an idea.',
    filesToCreate: i === 0 ? ['README.md', 'docs/problem.md'] : ['src/', 'docs/demo.md'],
    steps: arr(phase.tasks).length ? arr(phase.tasks) : [phase.phase],
    expectedOutput: i === 0 ? 'A clear repo/project skeleton.' : 'A visible working increment that can be shown in a demo.',
    howToTest: 'Run the local app/API flow and capture the output or screenshot.',
    commonMistakes: 'Do not keep it as a text-only concept. Produce proof that the MVP works.',
    status: 'todo',
  }));
}

function repoStructure(project = {}, blueprint = {}) {
  const fromBlueprint = arr(blueprint.githubRepoStructure).join('\n');
  if (fromBlueprint.trim()) return fromBlueprint;
  const slug = String(project.title || 'innovation-project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'innovation-project';
  return `${slug}/\n  README.md\n  docs/\n    problem.md\n    architecture.md\n    demo-script.md\n    ip-notes.md\n  src/\n    frontend/\n    backend/\n    core-engine/\n  tests/\n  evidence/\n    screenshots/\n    benchmark-results.md`;
}

function readme(project = {}, blueprint = {}, cost = {}) {
  const skills = uniq([...(project.requiredSkills || []), ...(project.skills || [])]).join(', ') || 'TBD';
  const modules = arr(blueprint.mvpScope).length ? arr(blueprint.mvpScope) : arr(project.mvpScope);
  return `# ${project.title || 'Innovation Project'}\n\n## Problem\n${project.painPoint || project.problemStatement || 'Define the problem clearly.'}\n\n## Target users\n${project.affectedUsers || project.targetUser || 'Target users to be validated.'}\n\n## Proposed solution\n${project.proposedSolution || 'Build an MVP that solves the stated pain point.'}\n\n## Why existing solutions are not enough\n${project.whyExistingSolutionsFail || 'Document current workarounds and gaps.'}\n\n## MVP modules\n${modules.map((m) => `- ${m}`).join('\n') || '- Core MVP workflow'}\n\n## Skills used\n${skills}\n\n## Demo plan\n${blueprint.demoScript || 'Show the end-to-end flow with sample input and generated output.'}\n\n## IP review note\n${project.noveltyAngle || 'Document the technical mechanism and collect prior-art/prototype evidence before IP review.'}\n\n## Cost / feasibility\n${Array.isArray(cost.indiaCostBands) ? cost.indiaCostBands.join('\n') : 'Use free tiers first; upgrade only for demo polish.'}\n`;
}

function mermaidForProject(project = {}, blueprint = {}) {
  const title = clean(project.title || 'Innovation Project', 34).replace(/[\[\]{}<>|`]/g, '');
  const engine = clean(project.technology || project.domain || 'Core Engine', 24).replace(/[\[\]{}<>|`]/g, '');
  const out = clean(project.proposedSolution || 'Action Plan', 34).replace(/[\[\]{}<>|`]/g, '');
  return `flowchart LR\n  U[Student / User] --> UI[Project UI]\n  UI --> API[Backend API]\n  API --> ENG[${title} ${engine}]\n  ENG --> DATA[(Project Data)]\n  ENG --> OUT[${out}]\n  OUT --> UI\n  UI --> EVD[GitHub / Demo Evidence]`;
}

/* Shape for the EXISTING Project Studio store. */
export function toProjectPayload(project, blueprint = {}, cost = {}) {
  const steps = normalizeRoadmap(blueprint, project);
  const skills = uniq([...(project.requiredSkills || []), ...(project.skills || []), project.technology].filter(Boolean));
  const stack = uniq([
    ...(blueprint.frontendScreens?.length ? ['Frontend UI'] : []),
    ...(blueprint.backendApis?.length ? ['Backend API'] : []),
    ...(blueprint.databaseSchema?.length ? ['Database'] : []),
    project.technology,
    project.domain,
  ].filter(Boolean));
  const tasks = buildTasks(steps);
  const checklist = buildChecklist(project, blueprint);
  const guideTasks = buildGuideTasks(project, blueprint);
  const sourceCitations = project.sourceCitations || [];
  const title = clean(project.title || 'Innovation Project', 160);

  return {
    title,
    name: title,
    type: 'Innovation / Patent-aware Project',
    source: 'innovation-os',
    generatedBy: project.aiProvider && project.aiProvider !== 'fallback' ? 'ai' : 'source-backed',
    targetRole: project.targetUser || project.purpose || 'Innovation Builder',
    difficulty: project.difficulty || cost.difficulty || 'Intermediate',
    duration: cost.timeline || '3–6 weeks',
    problemStatement: project.painPoint || project.problemStatement || '',
    useCase: project.framing?.realWorldScenario || project.whyExistingSolutionsFail || project.proposedSolution || '',
    solution: project.proposedSolution || '',
    architecture: blueprint.systemArchitecture || project.noveltyAngle || 'Use the Architecture tab to refine the system design.',
    architectureDiagram: mermaidForProject(project, blueprint),
    skillsCovered: skills,
    techStack: stack.length ? stack : ['Frontend UI', 'Backend API', 'Database'],
    steps,
    tasks,
    checklist,
    guideTasks,
    resources: sourceCitations.map((s) => s.url).filter(Boolean),
    screenshots: [],
    repoStructure: repoStructure(project, blueprint),
    databaseSchema: arr(blueprint.databaseSchema),
    deploymentPlan: arr(blueprint.deploymentPlan) || [],
    testingPlan: arr(blueprint.testPlan),
    githubPlan: arr(blueprint.githubRepoStructure),
    githubChecklist: arr(blueprint.githubRepoStructure),
    demoChecklist: [blueprint.demoScript].filter(Boolean),
    evidenceChecklist: arr(blueprint.evidenceChecklist),
    readme: readme(project, blueprint, cost),
    resumeBullets: [
      `Built ${title} to solve ${clean(project.painPoint || 'a real-world problem', 120)}.`,
      `Designed MVP modules covering ${skills.slice(0, 4).join(', ') || 'core product engineering'} with evidence-ready documentation.`,
    ],
    linkedinPost: `Building ${title}: ${clean(project.painPoint || project.proposedSolution || 'a real-world innovation project', 180)}`,
    interviewQuestions: [
      `What problem does ${title} solve?`,
      'What is the core technical mechanism?',
      'How did you validate that the MVP works?',
      'What evidence proves your contribution?',
    ],
    recruiterSummary: `${title} is an innovation project focused on ${clean(project.painPoint || project.proposedSolution || 'a real-world problem', 220)}. Skills demonstrated: ${skills.slice(0, 6).join(', ') || 'product engineering'}.`,
    industry: {
      overview: {
        whoShouldBuild: `Students targeting ${project.targetUser || 'technical/product roles'} who want proof-backed project evidence.`,
        expectedOutcome: 'A working MVP with GitHub/demo evidence and a clear IP-review story if the technical contribution is strong.',
      },
      technicalArchitecture: {
        input: project.painPoint || 'User/problem input',
        engine: project.noveltyAngle || blueprint.coreAlgorithm || 'Core analysis/build mechanism',
        output: project.proposedSolution || 'Actionable result',
      },
      milestones: steps.map((s, i) => ({
        n: i + 1,
        title: s.phase,
        goal: s.tasks?.[0] || s.phase,
        tasks: s.tasks || [],
        expectedOutput: 'Working project increment with visible evidence.',
        commonMistakes: 'Do not skip README, demo proof, and test evidence.',
        verification: ['Commit code to GitHub', 'Capture screenshot/demo output', 'Update checklist'],
      })),
    },
    innovationSource: {
      projectId: project.id || '',
      clusterId: project.clusterId || '',
      badge: project.badge || '',
      evidenceStrength: project.evidenceStrength || 0,
      sourceCitations,
      ipAngle: project.noveltyAngle || '',
    },
    costEstimate: cost.indiaCostBands || cost,
    sourceCitations,
    createdFrom: 'Innovation & Patent Intelligence OS',
  };
}

/* Shape for db.createPatentIdeas (existing Patent OS). */
export function toPatentIdeaPayload(project, ipReadiness = {}) {
  return {
    title: project.title,
    domain: project.domain || '',
    targetUser: project.targetUser || '',
    problem: project.painPoint || '',
    existingSolutions: project.whyExistingSolutionsFail || '',
    proposedSolution: project.proposedSolution || '',
    technicalMechanism: project.noveltyAngle || '',
    noveltyAngle: project.noveltyAngle || '',
    marketUseCase: project.affectedUsers || '',
    implementationPlan: (project.mvpScope || []).join('; '),
    tags: (project.requiredSkills || []).slice(0, 8),
    source: 'innovation-os',
    score: { overall: ipReadiness.overall || 0, grade: ipReadiness.label || '', riskLevel: ipReadiness.section3kWarning ? 'Section 3(k) risk' : 'See readiness' },
    riskWarnings: [ipReadiness.section3kWarning].filter(Boolean),
    strengtheningSuggestions: ipReadiness.requiredEvidenceToImprove || [],
  };
}

export default { assembleDisclosure, toProjectPayload, toPatentIdeaPayload };
