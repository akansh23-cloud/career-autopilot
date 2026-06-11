// Guided Project Workspace — shared "ensure workspace" helper.
// Used by Project Creator, Project Studio cards and the Dashboard so every
// entry point behaves the same: reuse an existing plan, otherwise fetch the
// server copy, otherwise generate. Never silent — errors are returned.
import WorkspaceApi from './workspaceApi.js';
import { getProject, saveProject } from './projectStore.js';
import { mergePlanIntoProject } from './workspaceSelectors.js';

export function hasWorkspace(project) {
  return !!(project && project.workspacePlan && Array.isArray(project.workspacePlan.tasks));
}

/**
 * Ensure a workspace plan exists for a project.
 * @returns {Promise<{ok:boolean, plan?:object, existed?:boolean, error?:string}>}
 */
export async function ensureWorkspaceForProject(projectOrId) {
  const project = typeof projectOrId === 'string' ? getProject(projectOrId) : projectOrId;
  const projectId = project?.id || (typeof projectOrId === 'string' ? projectOrId : '');
  if (!projectId) return { ok: false, error: 'No project id.' };

  if (hasWorkspace(project)) return { ok: true, plan: project.workspacePlan, existed: true };

  /* Server copy (covers a cleared local store). */
  try {
    const r = await WorkspaceApi.get(projectId);
    if (r?.workspacePlan) {
      if (project) saveProject(mergePlanIntoProject(project, r.workspacePlan));
      return { ok: true, plan: r.workspacePlan, existed: true };
    }
  } catch { /* fall through to generate */ }

  /* Generate. The project stays saved whether or not this succeeds. */
  try {
    const r = await WorkspaceApi.generate({
      projectId,
      project: project || {},
      architectureSpec: project?.architectureSpec || null,
    });
    if (r?.workspacePlan) {
      if (project) saveProject(mergePlanIntoProject(project, r.workspacePlan));
      return { ok: true, plan: r.workspacePlan, existed: false };
    }
    return { ok: false, error: 'Workspace generation returned no plan.' };
  } catch (e) {
    return { ok: false, error: e?.message || 'Workspace generation failed.' };
  }
}
