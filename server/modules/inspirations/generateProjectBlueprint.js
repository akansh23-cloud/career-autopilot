/* ============================================================
   GENERATE PROJECT BLUEPRINT  (deterministic; "Build this" flow)
   ------------------------------------------------------------
   Turns an inspiration (or any idea) into a full buildable roadmap:
   milestones, tech stack, skill outcomes, proof requirements, verification
   checklist, expected resume bullets, interview talking points. No AI.
   The resulting blueprint feeds both the marketplace (build_roadmap listing)
   and the skill-verification submission flow.
   ============================================================ */
const PROJECT_STATUS_FLOW = [
  'idea', 'roadmap_created', 'in_progress', 'submitted_for_verification',
  'verified', 'needs_review', 'rejected', 'recruiter_ready',
];

function milestonesFor(difficulty, skills) {
  const base = [
    { phase: 'Scope & design', detail: 'Write the problem statement, pick the core user, and sketch the architecture and data model.' },
    { phase: 'Core build', detail: `Implement the primary flow end-to-end using ${skills.slice(0, 3).join(', ') || 'your core stack'}.` },
    { phase: 'Polish & deploy', detail: 'Add auth/error handling, write a strong README, and deploy a live demo.' },
    { phase: 'Prove it', detail: 'Capture measurable results (numbers, screenshots) and prepare recruiter-visible proof.' },
  ];
  if (difficulty === 'Advanced') {
    base.splice(2, 0, { phase: 'Scale & reliability', detail: 'Add observability, tests, and one production-grade concern (caching, queueing, or CI/CD).' });
  }
  return base;
}

export function generateProjectBlueprint(idea = {}) {
  const title = idea.title || idea.buildableProjectIdea || 'New portfolio project';
  const targetRole = (idea.targetRoles && idea.targetRoles[0]) || idea.targetRole || 'Full Stack Developer';
  const difficulty = idea.difficulty || 'Intermediate';
  const skills = idea.suggestedSkills || idea.tags || [];
  const techStack = Array.from(new Set([...(idea.suggestedSkills || []), ...(idea.tags || [])])).slice(0, 8);

  const milestones = milestonesFor(difficulty, skills);

  const proofRequirements = [
    'Public GitHub repository with meaningful commit history',
    'README with problem, architecture, setup, and results',
    'Live deployed demo URL (or a recorded walkthrough)',
    'At least one measurable outcome (performance, coverage, users, or cost)',
  ];

  const verificationChecklist = [
    { item: 'GitHub repo is public and analyzable', required: true },
    { item: 'Live demo reachable or video walkthrough provided', required: true },
    { item: 'README documents architecture and results', required: true },
    { item: 'Claimed skills are visible in the actual code', required: true },
    { item: 'A quantified outcome is stated', required: false },
  ];

  const skillOutcomes = skills.slice(0, 6).map((s) => `Demonstrated, evidence-backed use of ${s}`);

  const resumeBullets = [
    `Built and deployed ${title} (${difficulty.toLowerCase()} ${targetRole} project) using ${techStack.slice(0, 4).join(', ') || 'a modern stack'}.`,
    'Documented architecture and measurable results in a README to provide recruiter-visible proof of work.',
  ];

  const interviewTalkingPoints = [
    'What problem does this solve and who is the user?',
    'Walk through the architecture and the key trade-offs you made.',
    'What was the hardest bug or scaling issue, and how did you diagnose and fix it?',
    'What measurable result did you achieve, and how did you verify it?',
  ];

  return {
    title,
    problemStatement: idea.problemStatement || `Build a focused, deployable solution: ${title}.`,
    targetRole,
    difficulty,
    techStack,
    architecturePreview: difficulty === 'Advanced'
      ? 'Production-ready modular monolith with a clear API layer, persistent store, background jobs, and observability.'
      : 'Modular monolith: a single deployable app with a clean API layer and a persistent store.',
    milestones,
    skillOutcomes,
    proofRequirements,
    verificationChecklist,
    resumeBullets,
    interviewTalkingPoints,
    estimatedDuration: idea.estimatedDuration || (difficulty === 'Advanced' ? '3-5 weeks' : '1-3 weeks'),
    status: 'roadmap_created',
    statusFlow: PROJECT_STATUS_FLOW,
    suggestedSkills: skills,
    category: idea.category || 'General',
  };
}

export { PROJECT_STATUS_FLOW };
export default { generateProjectBlueprint, PROJECT_STATUS_FLOW };
