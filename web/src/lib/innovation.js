// Innovation & Patent Intelligence OS — frontend API client.
// Mirrors the thin wrapper style of lib/api.js (same-origin, CSRF, cookies).
import { api } from './api.js';

const B = '/api/problem-intelligence';

export const Innovation = {
  config: () => api.get(`${B}/config`),
  discover: (input) => api.post(`${B}/discover`, input),
  clusters: () => api.get(`${B}/clusters`),
  cluster: (id) => api.get(`${B}/clusters/${encodeURIComponent(id)}`),

  // generate-project accepts the cluster in the body too, so it works when DB
  // is off (the client holds the cluster from the discover response).
  generateProject: (clusterId, body = {}) => api.post(`${B}/clusters/${encodeURIComponent(clusterId)}/generate-project`, body),

  // Per-project enrichments. Pass { project } in the body when DB is off.
  buildBlueprint: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/build-blueprint`, body),
  costEstimate: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/cost-estimate`, body),
  ipReadiness: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/ip-readiness`, body),
  strengthen: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/strengthen`, body),
  disclosure: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/generate-disclosure`, body),

  priorArt: (projectId) => api.get(`${B}/projects/${encodeURIComponent(projectId)}/prior-art`),
  addPriorArt: (projectId, record) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/prior-art`, record),

  convertToProject: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/convert-to-project`, body),
  convertToPatent: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/convert-to-patent`, body),

  projects: () => api.get(`${B}/projects`),
  project: (id) => api.get(`${B}/projects/${encodeURIComponent(id)}`),
};

export default Innovation;
