// Thin fetch wrapper. Same-origin in production (Express serves the SPA);
// proxied to the backend during `vite` dev. Always sends the session cookie.
const json = (r) => r.text().then((t) => (t ? JSON.parse(t) : {}));

// Read the readable double-submit CSRF cookie the server sets, so we can echo it
// back in the X-CSRF-Token header on state-changing requests.
function csrfToken() {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|;\s*)ca_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function req(method, path, body) {
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  if (UNSAFE.has(method)) {
    const token = csrfToken();
    if (token) headers['X-CSRF-Token'] = token;
  }
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await json(res).catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || data?.message || data?.error || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
  put: (p, b) => req('PUT', p, b),
  patch: (p, b) => req('PATCH', p, b),
  del: (p) => req('DELETE', p),
};

// ---- High-level helpers tied to the existing backend contract ----
export const Auth = {
  me: () => api.get('/auth/me'),
  status: () => api.get('/auth/status'),
  devLogin: (name, email) => api.post('/auth/dev-login', { name, email }),
  logout: () => api.post('/auth/logout', {}),
  googleStart: (returnTo = '/') =>
    `/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`,
};

export const Jobs = {
  search: (params) => api.get('/jobs/search?' + new URLSearchParams(params).toString()),
  sources: () => api.get('/jobs/sources'),
};

export const Opportunities = {
  search: (params) => api.get('/opportunities/search?' + new URLSearchParams(params).toString()),
  providers: () => api.get('/opportunities/providers'),
};

export const Contacts = {
  find: (b) => api.post('/contacts/find', b),
  referrals: (b) => api.post('/contacts/referrals', b),
  providers: () => api.get('/contacts/providers'),
};

export const Profile = {
  getCareer: () => api.get('/profile/career'),
  saveCareer: (b) => api.put('/profile/career', b),
  getPrefs: () => api.get('/profile/preferences'),
  savePrefs: (b) => api.post('/profile/preferences', b),
};

// Anthropic-format passthrough used by resume analysis / tailoring / interview prep.
export const AI = {
  message: (payload) => api.post('/ai/messages', payload),
};

export const Support = {
  faqs: () => api.get('/support/faqs'),
  chat: (message) => api.post('/support/chat', { message }),
  createTicket: (payload) => api.post('/support/tickets', payload),
  myTickets: () => api.get('/support/tickets/my'),
};

export const Dashboard = {
  summary: () => api.get('/dashboard/summary'),
};

export const UserState = {
  get: () => api.get('/api/user/state'),
  patch: (body) => api.patch('/api/user/state', body),
  getProfile: () => api.get('/api/user/profile'),
  saveProfile: (profile) => api.put('/api/user/profile', { profile }),
};

export const ResumeApi = {
  analyze: ({ resumeText, fileName, targetRole }) =>
    api.post('/api/resume/analyze', { resumeText, fileName, targetRole }),
  tailor: ({ resumeText, jobDescription, fileName, targetRole, mode }) =>
    api.post('/api/resume/tailor', { resumeText, jobDescription, fileName, targetRole, mode }),
  listVersions: () => api.get('/api/resume/versions'),
  saveVersion: (version) => api.post('/api/resume/versions', version),
  deleteVersion: (id) => api.del(`/api/resume/versions/${encodeURIComponent(id)}`),
  saveAnalysis: (resume) => api.post('/api/resume/save-analysis', { resume }),
};

// Verified Skills + XP. Backend owns verification; pending never counts.
export const Skills = {
  submitProject: (submission) => api.post('/api/projects/submit', submission),
  listSubmissions: () => api.get('/api/projects/submissions'),
  xp: (verifiedOnly = false) => api.get('/api/skills/xp' + (verifiedOnly ? '?verifiedOnly=1' : '')),
  verified: () => api.get('/api/skills/verified'),
};

// Project Marketplace. Ranking, verification + recruiter-ready are backend-owned.
export const Marketplace = {
  list: (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== false && v != null));
    const qs = new URLSearchParams(clean).toString();
    return api.get('/api/marketplace/listings' + (qs ? `?${qs}` : ''));
  },
  get: (id) => api.get(`/api/marketplace/listings/${encodeURIComponent(id)}`),
  publish: (listing) => api.post('/api/marketplace/listings', listing),
  remove: (id) => api.del(`/api/marketplace/listings/${encodeURIComponent(id)}`),
  toggleSave: (id) => api.post(`/api/marketplace/listings/${encodeURIComponent(id)}/save`, {}),
  saved: () => api.get('/api/marketplace/saved'),
  clone: (id) => api.post(`/api/marketplace/listings/${encodeURIComponent(id)}/clone`, {}),
  apply: (id, body) => api.post(`/api/marketplace/listings/${encodeURIComponent(id)}/apply`, body),
  review: (id, body) => api.post(`/api/marketplace/listings/${encodeURIComponent(id)}/review`, body),
  shortlist: (id) => api.post(`/api/marketplace/listings/${encodeURIComponent(id)}/shortlist`, {}),
  contact: (id) => api.post(`/api/marketplace/listings/${encodeURIComponent(id)}/contact`, {}),
  report: (id) => api.post(`/api/marketplace/listings/${encodeURIComponent(id)}/report`, {}),
};

// Live Inspiration Engine + Build-this flow. External APIs are backend-only.
export const Inspirations = {
  list: (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== false && v != null));
    const qs = new URLSearchParams(clean).toString();
    return api.get('/api/inspirations' + (qs ? `?${qs}` : ''));
  },
  refresh: () => api.post('/api/inspirations/refresh', {}),
  build: (id, idea) => api.post(`/api/inspirations/${encodeURIComponent(id || 'custom')}/build`, idea ? { idea } : {}),
  save: (id, idea) => api.post(`/api/inspirations/${encodeURIComponent(id || 'custom')}/save`, idea ? { idea } : {}),
  roadmaps: () => api.get('/api/roadmaps'),
};

// Industry-level Architecture Generator. Score/diagrams/gaps are backend-owned.
export const Architecture = {
  generate: (project) => api.post('/api/architecture/generate', project),
};

// Patent Engine. Readiness/prior-art/disclosure are backend-owned. Not legal advice.
export const Patents = {
  assess: (project) => api.post('/api/patent/assess', project),
  records: () => api.get('/api/patent/records'),
  save: (record) => api.post('/api/patent/records', record),
  remove: (id) => api.del(`/api/patent/records/${encodeURIComponent(id)}`),
  dashboard: () => api.get('/api/patent/dashboard'),
};


// Innovation & Patent Intelligence OS — source-backed problem discovery + project synthesis.
export const ProblemIntelligence = {
  config: () => api.get('/api/problem-intelligence/config'),
  discover: (input) => api.post('/api/problem-intelligence/discover', input),
  clusters: () => api.get('/api/problem-intelligence/clusters'),
  cluster: (id) => api.get(`/api/problem-intelligence/clusters/${encodeURIComponent(id)}`),
  generateProject: (clusterId, body = {}) => api.post(`/api/problem-intelligence/clusters/${encodeURIComponent(clusterId)}/generate-project`, body),
  buildBlueprint: (projectId) => api.post(`/api/problem-intelligence/projects/${encodeURIComponent(projectId)}/build-blueprint`, {}),
  costEstimate: (projectId, body = {}) => api.post(`/api/problem-intelligence/projects/${encodeURIComponent(projectId)}/cost-estimate`, body),
  ipReadiness: (projectId, body = {}) => api.post(`/api/problem-intelligence/projects/${encodeURIComponent(projectId)}/ip-readiness`, body),
  convertToProject: (projectId, body = {}) => api.post(`/api/problem-intelligence/projects/${encodeURIComponent(projectId)}/convert-to-project`, body),
  convertToPatent: (projectId, body = {}) => api.post(`/api/problem-intelligence/projects/${encodeURIComponent(projectId)}/convert-to-patent`, body),
  disclosure: (projectId) => api.post(`/api/problem-intelligence/projects/${encodeURIComponent(projectId)}/generate-disclosure`, {}),
};

// Patent OS — invention intelligence. All scoring backend-owned. Not legal advice.
export const PatentOS = {
  dashboard: () => api.get('/api/patents/dashboard'),
  generate: (input) => api.post('/api/patents/ideas/generate', input),
  ideas: (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    const qs = new URLSearchParams(clean).toString();
    return api.get('/api/patents/ideas' + (qs ? `?${qs}` : ''));
  },
  idea: (id) => api.get(`/api/patents/ideas/${encodeURIComponent(id)}`),
  patch: (id, patch) => api.patch(`/api/patents/ideas/${encodeURIComponent(id)}`, patch),
  remove: (id) => api.del(`/api/patents/ideas/${encodeURIComponent(id)}`),
  strengthen: (id) => api.post(`/api/patents/ideas/${encodeURIComponent(id)}/strengthen`, {}),
  rescore: (id) => api.post(`/api/patents/ideas/${encodeURIComponent(id)}/score`, {}),
  priorArtPlan: (id) => api.post(`/api/patents/ideas/${encodeURIComponent(id)}/prior-art-plan`, {}),
  addPriorArt: (id, record) => api.post(`/api/patents/ideas/${encodeURIComponent(id)}/prior-art`, record),
  priorArt: (id) => api.get(`/api/patents/ideas/${encodeURIComponent(id)}/prior-art`),
  removePriorArt: (recordId) => api.del(`/api/patents/prior-art/${encodeURIComponent(recordId)}`),
  disclosure: (id) => api.post(`/api/patents/ideas/${encodeURIComponent(id)}/disclosure`, {}),
  getDisclosure: (id) => api.get(`/api/patents/ideas/${encodeURIComponent(id)}/disclosure`),
  convert: (id) => api.post(`/api/patents/ideas/${encodeURIComponent(id)}/convert-to-project`, {}),
  feedback: (id, body) => api.post(`/api/patents/ideas/${encodeURIComponent(id)}/feedback`, body),
  pipeline: () => api.get('/api/patents/pipeline'),
  activity: () => api.get('/api/patents/activity'),
  disclosures: () => api.get('/api/patents/disclosures'),
};

// Application Package Generator. Uses verified skills only; no fake claims.
export const Applications = {
  generate: (body) => api.post('/api/applications/package', body),
};

// Readiness + recruiter/admin (verified-only).
export const Readiness = {
  mine: () => api.get('/api/readiness'),
  candidates: (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    const qs = new URLSearchParams(clean).toString();
    return api.get('/api/recruiter/candidates' + (qs ? `?${qs}` : ''));
  },
  queue: () => api.get('/api/admin/verification-queue'),
  overview: () => api.get('/api/admin/readiness-overview'),
};

// Admin-only User Directory / Talent Intelligence. Every call is gated by
// requireAuth + requireAdmin on the backend; the UI also hides these surfaces
// from non-admins, but the server is the source of truth.
export const Admin = {
  listUsers: (params = {}) => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== '' && v !== false && v != null)
    );
    const qs = new URLSearchParams(clean).toString();
    return api.get('/api/admin/users' + (qs ? `?${qs}` : ''));
  },
  getUser: (id) => api.get(`/api/admin/users/${encodeURIComponent(id)}`),
  setVisibility: (id, recruiterVisible) => api.patch(`/api/admin/users/${encodeURIComponent(id)}/visibility`, { recruiterVisible }),
  setNotes: (id, adminNotes) => api.patch(`/api/admin/users/${encodeURIComponent(id)}/admin-notes`, { adminNotes }),
  setFeatured: (id, featuredTalent) => api.patch(`/api/admin/users/${encodeURIComponent(id)}/featured`, { featuredTalent }),
};
