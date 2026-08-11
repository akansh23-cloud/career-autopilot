/* ============================================================================
   templateOsApi.js — Template OS client layer
   ----------------------------------------------------------------------------
   Thin wrappers over the deterministic Template OS endpoints. Certification,
   publishing gates and package sanitization stay server-owned; this file only
   carries requests.
   ========================================================================== */
import { api } from './api.js';

export const TemplateOsApi = {
  versions: () => api.get('/api/template-os/versions'),
  adminAccess: () => api.get('/api/template-os/admin/access'),
  list: () => api.get('/api/template-os/templates'),
  catalog: () => api.get('/api/template-os/templates?catalog=1&publishedOnly=1'),
  get: (templateId, version = null) => api.get(`/api/template-os/templates/${encodeURIComponent(templateId)}${version ? `?version=${version}` : ''}`),
  history: (templateId) => api.get(`/api/template-os/templates/${encodeURIComponent(templateId)}/history`),
  shape: (payload) => api.post('/api/template-os/shape', payload),
  validate: (payload) => api.post('/api/template-os/validate', payload),
  /* deep by default: real PDFs are generated and their text layer measured */
  certify: (payload) => api.post('/api/template-os/certify', payload),
  thumbnail: (payload) => api.post('/api/template-os/thumbnail', payload),
  saveDefinition: (payload) => api.post('/api/template-os/save', payload),
  importDefinition: (payload) => api.post('/api/template-os/import', payload),
  importPackage: (payload) => api.post('/api/template-os/import-package', payload),
  generate: (payload) => api.post('/api/template-os/generate', payload),
  render: (payload) => api.post('/api/template-os/render', payload),
  setStatus: (payload) => api.post('/api/template-os/status', payload),
};

export default TemplateOsApi;
