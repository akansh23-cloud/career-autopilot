// Career Intelligence Engine — frontend API client.
// Thin wrapper over lib/api.js (same-origin, CSRF, cookies). No keys here ever.
import { api } from './api.js';

const B = '/api/intelligence';

export const getIntelligenceSources = () => api.get(`${B}/sources`);
export const runCollectiveSearch = (payload) => api.post(`${B}/search`, payload);
export const createProjectFromIntelligence = (payload) => api.post(`${B}/create-project`, payload);
export const sendToPatentOS = (payload) => api.post(`${B}/send-to-patent`, payload);
export const generateResumeOutput = (payload) => api.post(`${B}/resume-output`, payload);
export const saveIntelligenceMemory = (payload) => api.post(`${B}/save-memory`, payload);

export const CareerIntelligence = {
  sources: getIntelligenceSources,
  search: runCollectiveSearch,
  createProject: createProjectFromIntelligence,
  sendToPatent: sendToPatentOS,
  resumeOutput: generateResumeOutput,
  saveMemory: saveIntelligenceMemory,
};

export default CareerIntelligence;
