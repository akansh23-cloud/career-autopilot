/* ============================================================
   NEXT BEST ACTION ENGINE  (deterministic; pure; platform-wide)
   ------------------------------------------------------------
   One answer to "what is the single highest-value thing this
   user should do next?", ranked from REAL state:

     college task deadlines > verification remediation >
     active project momentum > role-readiness gaps >
     resume evidence wins > getting started

   Scoring is transparent: every action carries its priority, the
   inputs that produced it, and a CTA into the screen that
   executes it. No AI ranks anything here — AI may later phrase
   explanations, never choose the action.

   Pure function: state in → ranked actions out. Assembly of state
   (db or client stores) happens at the call site, so the same
   engine runs server-side and as the client fallback.
   ============================================================ */

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));

export const NBA_VERSION = 'next-best-action-v1';

const DAY = 24 * 60 * 60 * 1000;

/* ---------------- candidate generators ---------------- */

function collegeTaskActions(state) {
  return arr(state.collegeTasks)
    .filter((t) => !t.done)
    .map((t) => {
      const dueMs = t.dueAt ? Date.parse(t.dueAt) : NaN;
      const daysLeft = Number.isFinite(dueMs) ? Math.floor((dueMs - state.now) / DAY) : null;
      const overdue = daysLeft != null && daysLeft < 0;
      const urgent = daysLeft != null && daysLeft <= 2;
      return {
        actionType: 'college_task',
        title: t.title,
        explanation: overdue
          ? `Assigned by your placement cell and ${Math.abs(daysLeft)} day(s) overdue — coordinators see completion status.`
          : t.dueAt ? `Assigned by your placement cell, due in ${daysLeft} day(s).` : 'Assigned by your placement cell.',
        estimatedEffort: t.estimatedEffort || 'varies',
        expectedImpact: ['Placement-cell task completion'],
        relatedProject: null, relatedSkill: null, relatedReadinessDimension: null,
        cta: { view: 'readiness', label: 'Open my tasks' },
        priority: clamp(82 + (overdue ? 12 : urgent ? 6 : 0), 0, 100),
        source: { taskId: t.id, dueAt: t.dueAt || null },
      };
    });
}

function verificationActions(state) {
  const out = [];
  for (const ws of arr(state.workspaces)) {
    for (const rem of arr(ws.verificationNextActions).slice(0, 1)) {
      out.push({
        actionType: 'submit_evidence',
        title: rem.title,
        explanation: `${ws.title}: ${rem.note} Verified evidence is what recruiters and your readiness score count.`,
        estimatedEffort: '15–30 min',
        expectedImpact: ['Verified task evidence', 'Verified skills', 'Readiness'],
        relatedProject: ws.projectId, relatedSkill: null, relatedReadinessDimension: 'projectEvidence',
        cta: { view: 'projectworkspace', label: 'Open Proof tab' },
        priority: 76,
        source: { projectId: ws.projectId, criterionId: rem.criterionId || null },
      });
    }
    const c = ws.verificationCounts;
    if (c && c.partiallyVerified > 0 && !arr(ws.verificationNextActions).length) {
      out.push({
        actionType: 'submit_evidence',
        title: `Finish verification for ${ws.title}`,
        explanation: `${c.partiallyVerified} task(s) are partially verified — one more piece of evidence completes them.`,
        estimatedEffort: '15–30 min',
        expectedImpact: ['Verified task evidence', 'Verified skills'],
        relatedProject: ws.projectId, relatedSkill: null, relatedReadinessDimension: 'projectEvidence',
        cta: { view: 'projectworkspace', label: 'Run Verify' },
        priority: 72,
        source: { projectId: ws.projectId },
      });
    }
  }
  return out;
}

function activeProjectActions(state) {
  return arr(state.workspaces)
    .filter((ws) => ws.nextAction && ws.nextAction.taskId)
    .map((ws, i) => {
      const doneP = ws.progress?.weightedPercentDone ?? ws.progress?.percentDone ?? 0;
      const momentum = doneP > 0 && doneP < 100;
      return {
        actionType: 'project_task',
        title: ws.nextAction.title,
        explanation: `${ws.title} is ${doneP}% built (${ws.progress?.weightedPercentVerified ?? ws.progress?.percentVerified ?? 0}% verified). ${ws.nextAction.reason}`,
        estimatedEffort: '1–3 hrs',
        expectedImpact: ['Project milestone', 'Buildable evidence'],
        relatedProject: ws.projectId, relatedSkill: null, relatedReadinessDimension: 'projectEvidence',
        cta: { view: 'projectworkspace', label: 'Continue project' },
        priority: clamp(66 + (momentum ? 6 : 0) - i * 4, 0, 100),
        source: { projectId: ws.projectId, taskId: ws.nextAction.taskId },
      };
    });
}

function readinessActions(state) {
  const rr = state.roleReadiness;
  if (!rr) return [];
  return arr(rr.topActions).slice(0, 2).map((a, i) => ({
    actionType: 'build_evidence',
    title: a.title,
    explanation: `${a.why} Closing this gap moves your ${rr.targetRole} readiness the most.`,
    estimatedEffort: 'project-sized',
    expectedImpact: [`${rr.targetRole} readiness`, ...arr(a.skills).slice(0, 2).map((s) => `${s} evidence`)],
    relatedProject: null, relatedSkill: arr(a.skills)[0] || null, relatedReadinessDimension: a.dimensionId,
    cta: { view: 'projectstudio', label: 'Get a matched project' },
    priority: clamp(58 + Math.min(a.impact || 0, 12) - i * 6, 0, 100),
    source: { dimensionId: a.dimensionId, skills: a.skills },
  }));
}

function resumeActions(state) {
  const out = [];
  for (const rec of arr(state.resumeRecommendations)) {
    if (rec.type === 'evidence_exists') {
      out.push({
        actionType: 'resume_add_evidence',
        title: `Add verified ${rec.skill} to your resume`,
        explanation: rec.explanation || `Your verified ${rec.skill} evidence is not represented on your resume — a five-minute, zero-risk improvement.`,
        estimatedEffort: '5–10 min',
        expectedImpact: ['Resume evidence', 'ATS keyword match'],
        relatedProject: rec.projectId || null, relatedSkill: rec.skill, relatedReadinessDimension: 'resumeEvidence',
        cta: { view: 'resume', label: 'Update resume' },
        priority: 62,
        source: { skill: rec.skill },
      });
    }
  }
  return out.slice(0, 2);
}

function gettingStartedActions(state) {
  if (arr(state.workspaces).length) return [];
  const rr = state.roleReadiness;
  const gap = rr && arr(rr.topActions)[0];
  return [{
    actionType: 'start_project',
    title: gap ? `Start a project that builds ${arr(gap.skills).slice(0, 2).join(' + ')} evidence` : 'Start your first guided project',
    explanation: gap
      ? `You have no active guided project, and ${gap.why.toLowerCase()}`
      : 'A guided project is the fastest path to verified, recruiter-trusted evidence.',
    estimatedEffort: '10 min to start',
    expectedImpact: ['Active guided project', 'Evidence pipeline'],
    relatedProject: null, relatedSkill: gap ? arr(gap.skills)[0] : null,
    relatedReadinessDimension: gap ? gap.dimensionId : null,
    cta: { view: 'projectstudio', label: 'Get matched projects' },
    priority: 64,
    source: {},
  }];
}

/* ---------------- public entrypoint ---------------- */

export function rankNextBestActions(state = {}, { max = 5 } = {}) {
  const s = { now: Date.now(), ...state };
  const candidates = [
    ...collegeTaskActions(s),
    ...verificationActions(s),
    ...activeProjectActions(s),
    ...readinessActions(s),
    ...resumeActions(s),
    ...gettingStartedActions(s),
  ].filter((a) => a && str(a.title));

  candidates.sort((a, b) => b.priority - a.priority);

  /* De-duplicate near-identical intents (same type + same related target). */
  const seen = new Set();
  const actions = [];
  for (const a of candidates) {
    const key = `${a.actionType}:${a.relatedProject || ''}:${a.relatedSkill || ''}:${a.source?.taskId || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push(a);
    if (actions.length >= max) break;
  }

  return {
    version: NBA_VERSION,
    generatedAt: new Date(s.now).toISOString(),
    highestImpact: actions[0] || null,
    actions,
    inputsUsed: {
      workspaces: arr(s.workspaces).length,
      collegeTasks: arr(s.collegeTasks).filter((t) => !t.done).length,
      hasRoleReadiness: !!s.roleReadiness,
      resumeRecommendations: arr(s.resumeRecommendations).length,
    },
  };
}

export default { rankNextBestActions, NBA_VERSION };
