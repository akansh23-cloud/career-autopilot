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

  // ---- Patent OS world-class upgrade ----
  simplify: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/simplify`, body),
  indiaCri: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/india-cri`, body),
  priorArtSearchPlan: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/prior-art/search-plan`, body),
  claimDirections: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/claim-directions`, body),
  evidenceChecklist: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/evidence-checklist`, body),
  addEvidence: (projectId, evidence) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/evidence`, evidence),
  setConfidentiality: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/confidentiality`, body),
  disclosureRiskCheck: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/disclosure-risk-check`, body),
  diagramPlan: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/diagram-plan`, body),
  experimentPlan: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/experiment-plan`, body),
  similar: (projectId) => api.get(`${B}/projects/${encodeURIComponent(projectId)}/similar`),
  reindexMemory: () => api.post(`${B}/memory/reindex`, {}),

  convertToProject: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/convert-to-project`, body),
  convertToPatent: (projectId, body = {}) => api.post(`${B}/projects/${encodeURIComponent(projectId)}/convert-to-patent`, body),

  projects: () => api.get(`${B}/projects`),
  project: (id) => api.get(`${B}/projects/${encodeURIComponent(id)}`),
};

export default Innovation;
