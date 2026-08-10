/* ============================================================
   NEXT BEST ACTION — client lib
   ------------------------------------------------------------
   API-first: GET /api/next-best-action returns the server-ranked
   answer built from persisted state (workspaces, verification,
   college tasks, role readiness).

   When the DB is off (ok:false, reason db_off) or the call fails,
   we compute a LOCAL fallback from the stores this browser
   actually holds (project store + profile) using the same action
   shape, so the dashboard renders identically. The fallback never
   pretends to know server state — it only ranks what is locally
   real, and it says so in `source`.
   ============================================================ */
import { api } from './api.js';
import { getProjects } from './projectStore.js';
import { getProfile } from './userProfile.js';

const arr = (v) => (Array.isArray(v) ? v : []);

/* ---- deterministic local fallback (no fabrication) ---- */
export function computeLocalNextBestActions() {
  const projects = getProjects();
  const profile = getProfile();
  const actions = [];

  const withPlan = projects.filter((p) => p.workspacePlan && arr(p.workspacePlan.tasks).length);
  for (const p of withPlan.slice(0, 2)) {
    const plan = p.workspacePlan;
    const next = plan.nextAction;
    const prog = plan.progress || {};
    if (next && next.taskId) {
      actions.push({
        actionType: 'project_task',
        title: next.title,
        explanation: `${plan.title || p.title} is ${prog.weightedPercentDone ?? prog.percentDone ?? 0}% built (${prog.weightedPercentVerified ?? prog.percentVerified ?? 0}% verified). ${next.reason || ''}`.trim(),
        estimatedEffort: '1–3 hrs',
        expectedImpact: ['Project milestone', 'Buildable evidence'],
        relatedProject: p.id, relatedSkill: null, relatedReadinessDimension: 'projectEvidence',
        cta: { view: 'projectworkspace', label: 'Continue project' },
        priority: 66,
        source: { projectId: p.id, taskId: next.taskId, local: true },
      });
    }
    const rem = plan.taskVerification?.nextActions?.[0];
    if (rem) {
      actions.push({
        actionType: 'submit_evidence',
        title: rem.title,
        explanation: `${plan.title || p.title}: ${rem.note}`,
        estimatedEffort: '15–30 min',
        expectedImpact: ['Verified task evidence', 'Verified skills'],
        relatedProject: p.id, relatedSkill: null, relatedReadinessDimension: 'projectEvidence',
        cta: { view: 'projectworkspace', label: 'Open Proof tab' },
        priority: 76,
        source: { projectId: p.id, local: true },
      });
    }
  }

  const published = projects.filter((p) => p.published);
  if (!projects.length) {
    actions.push({
      actionType: 'start_project',
      title: profile.targetRole ? `Start a project matched to ${profile.targetRole}` : 'Start your first guided project',
      explanation: 'A guided project is the fastest path to verified, recruiter-trusted evidence.',
      estimatedEffort: '10 min to start',
      expectedImpact: ['Active guided project', 'Evidence pipeline'],
      relatedProject: null, relatedSkill: null, relatedReadinessDimension: null,
      cta: { view: 'projectstudio', label: 'Get matched projects' },
      priority: 64,
      source: { local: true },
    });
  } else if (!published.length) {
    actions.push({
      actionType: 'publish_project',
      title: 'Publish a project to get discovered',
      explanation: 'Publishing your strongest project makes it count toward leaderboards and recruiter discovery.',
      estimatedEffort: '10 min',
      expectedImpact: ['Recruiter visibility'],
      relatedProject: projects[0]?.id || null, relatedSkill: null, relatedReadinessDimension: null,
      cta: { view: 'sandbox', label: 'Publish to sandbox' },
      priority: 55,
      source: { local: true },
    });
  }

  actions.sort((a, b) => b.priority - a.priority);
  return {
    version: 'next-best-action-v1',
    computedBy: 'local-fallback',
    highestImpact: actions[0] || null,
    actions: actions.slice(0, 5),
  };
}

/* ---- API-first fetch with fallback ---- */
export async function fetchNextBestActions({ targetRole = '' } = {}) {
  try {
    const q = targetRole ? `?targetRole=${encodeURIComponent(targetRole)}` : '';
    const r = await api.get(`/api/next-best-action${q}`);
    if (r?.ok && Array.isArray(r.actions)) {
      return { ...r, computedBy: 'server' };
    }
    return computeLocalNextBestActions();
  } catch {
    return computeLocalNextBestActions();
  }
}

export async function fetchReadiness({ targetRole = '' } = {}) {
  try {
    const q = targetRole ? `?targetRole=${encodeURIComponent(targetRole)}` : '';
    const r = await api.get(`/api/readiness${q}`);
    return r?.ok ? r : null;
  } catch { return null; }
}

export default { fetchNextBestActions, fetchReadiness, computeLocalNextBestActions };
