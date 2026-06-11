// Guided Project Workspace v1 — API client.
// Every plan-mutating call also sends the client's copy of the plan so
// the backend works even when its DB is disabled (graceful fallback).
import { api } from './api.js';

const enc = encodeURIComponent;

export const WorkspaceApi = {
  generate: ({ projectId, project, customInput, architectureSpec, existingPlan, regenerate = false } = {}) =>
    api.post('/api/workspace/generate', { projectId, project, customInput, architectureSpec, existingPlan, regenerate }),

  get: (projectId) => api.get(`/api/workspace/${enc(projectId)}`),

  patch: (projectId, { workspacePlan, patch, currentTab, selectedItem } = {}) =>
    api.patch(`/api/workspace/${enc(projectId)}`, { workspacePlan, patch, currentTab, selectedItem }),

  patchTask: (projectId, taskId, { workspacePlan, status, blockerReason, notes } = {}) =>
    api.patch(`/api/workspace/${enc(projectId)}/tasks/${enc(taskId)}`, { workspacePlan, status, blockerReason, notes }),

  recalculate: (projectId, workspacePlan) =>
    api.post(`/api/workspace/${enc(projectId)}/recalculate`, { workspacePlan }),

  verify: (projectId, workspacePlan) =>
    api.post(`/api/workspace/${enc(projectId)}/verify`, { workspacePlan }),

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
