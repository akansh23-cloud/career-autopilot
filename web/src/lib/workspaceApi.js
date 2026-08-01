// Guided Project Workspace v1 — API client.
// Every plan-mutating call also sends the client's copy of the plan so
// the backend works even when its DB is disabled (graceful fallback).
import { api } from './api.js';

const enc = encodeURIComponent;

export const WorkspaceApi = {
  generate: ({ projectId, project, customInput, architectureSpec, existingPlan, regenerate = false } = {}) =>
    api.post('/api/workspace/generate', { projectId, project, customInput, architectureSpec, existingPlan, regenerate }),

  get: (projectId) => api.get(`/api/workspace/${enc(projectId)}`),

  // Guided Path — derives per-task steps, hints and AI prompts from the plan.
  guide: (workspacePlan) => api.post('/api/workspace/guide', { workspacePlan }),

  patch: (projectId, { workspacePlan, patch, architecturePatch, currentTab, selectedItem } = {}) =>
    api.patch(`/api/workspace/${enc(projectId)}`, { workspacePlan, patch, architecturePatch, currentTab, selectedItem }),

  patchTask: (projectId, taskId, { workspacePlan, status, blockerReason, notes } = {}) =>
    api.patch(`/api/workspace/${enc(projectId)}/tasks/${enc(taskId)}`, { workspacePlan, status, blockerReason, notes }),

  recalculate: (projectId, workspacePlan) =>
    api.post(`/api/workspace/${enc(projectId)}/recalculate`, { workspacePlan }),

  // evidence: { repoUrl, liveUrl } — optional; the server falls back to
  // whatever the workspace already has on file.
  verify: (projectId, workspacePlan, evidence = null) =>
    api.post(`/api/workspace/${enc(projectId)}/verify`, { workspacePlan, evidence }),

  codegenPreview: (projectId, { workspacePlan, taskId, filePath, templateKey } = {}) =>
    api.post(`/api/workspace/${enc(projectId)}/codegen/preview`, { workspacePlan, taskId, filePath, templateKey }),

  codegenPlan: (projectId, { workspacePlan, taskId } = {}) =>
    api.post(`/api/workspace/${enc(projectId)}/codegen/plan`, { workspacePlan, taskId }),

  starterPackPreview: (projectId, workspacePlan) =>
    api.post(`/api/workspace/${enc(projectId)}/starter-pack/preview`, { workspacePlan }),

  starterPackGenerate: (projectId, workspacePlan) =>
    api.post(`/api/workspace/${enc(projectId)}/starter-pack/generate`, { workspacePlan }),

  starterPackDownloadUrl: (projectId, packId) =>
    `/api/workspace/${enc(projectId)}/starter-pack/download/${enc(packId)}`,
};

export default WorkspaceApi;
