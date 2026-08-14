// Thin fetch wrapper. Same-origin in production (Express serves the SPA);
// proxied to the backend during `vite` dev. Always sends the session cookie.
import { recordQuota } from './quota.js';

const json = (r) => r.text().then((t) => (t ? JSON.parse(t) : {}));

/* The backend uses two error envelope shapes:
     A)  { error: { code, message } }            — /ai/messages and friends
     B)  { error: 'quota_exceeded', message }    — quota + rate limiters
   Callers should never have to know which. normalizeError() flattens both
   into a single { code, message } so error handling is one code path. */
function normalizeError(data, res) {
  const e = data?.error;
  let code = '';
  let message = '';
  if (e && typeof e === 'object') {
    // Anthropic's own envelope is { error: { type: 'not_found_error', message } }
    // — the discriminator is `type`, not `code`. Without reading it, every
    // upstream failure arrives at the UI with an empty code and gets rendered
    // as a generic "temporarily unavailable", which hides the real cause.
    code = e.code || e.error || e.type || '';
    message = e.message || '';
  } else if (typeof e === 'string') {
    code = e;
  }
  message = message || data?.message || (typeof e === 'string' ? '' : '') || res.statusText || 'Request failed';
  return { code, message };
}

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
  // The server reports remaining daily allowance on every metered call so the
  // UI can warn BEFORE the student hits the wall, not only after.
  const hdrBucket = res.headers.get('X-Quota-Bucket');
  if (hdrBucket) {
    recordQuota({ bucket: hdrBucket, remaining: res.headers.get('X-Quota-Remaining') });
  }

  const data = await json(res).catch(() => ({}));
  if (!res.ok) {
    const { code, message } = normalizeError(data, res);
    const err = new Error(message);
    err.status = res.status;
    err.code = code;
    err.data = data;
    // Quota rejections carry bucket/limit/resetAt — keep them on the error so
    // views can show "resets at X" and route to the right upgrade tier.
    if (data && (data.bucket || code === 'quota_exceeded')) {
      err.quota = {
        bucket: data.bucket || hdrBucket || null,
        limit: data.limit ?? null,
        remaining: data.remaining ?? 0,
        plan: data.plan || null,
        resetAt: data.resetAt || null,
      };
      if (err.quota.bucket) recordQuota({ ...err.quota });
    }
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
  // Canonical Job Discovery OS search. Product search must use this path;
  // /jobs/search is retained only as a legacy/operator compatibility endpoint.
  discoverySearch: (params) => api.get('/jobs/search-v2?' + new URLSearchParams(params).toString()),
  getCanonical: (id) => api.get(`/jobs/v2/${encodeURIComponent(id)}`),
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
// `generate` is the legacy endpoint (still returns the old shape, now with an
// added architectureSpec). The rest are the Architecture Diagram OS endpoints.
export const Architecture = {
  generate: (project) => api.post('/api/architecture/generate', project),
  spec: (input) => api.post('/api/architecture/spec', input),
  validate: (architectureSpec) => api.post('/api/architecture/validate', { architectureSpec }),
  refine: (architectureSpec, instruction) => api.post('/api/architecture/refine', { architectureSpec, instruction }),
  exportView: (architectureSpec, viewId, format) => api.post('/api/architecture/export', { architectureSpec, viewId, format }),
  savedSpecs: (projectId) => api.get('/api/architecture/specs' + (projectId ? `?projectId=${encodeURIComponent(projectId)}` : '')),
};

// Patent Engine. Readiness/prior-art/disclosure are backend-owned. Not legal advice.
export const Patents = {
  assess: (project) => api.post('/api/patent/assess', project),
  records: () => api.get('/api/patent/records'),
  save: (record) => api.post('/api/patent/records', record),
  remove: (id) => api.del(`/api/patent/records/${encodeURIComponent(id)}`),
  dashboard: () => api.get('/api/patent/dashboard'),
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
  // Privileged-role verification management (admin only).
  verificationRequests: (status = 'pending') => api.get(`/api/admin/verification-requests?status=${encodeURIComponent(status)}`),
  verifyUser: (id, body) => api.post(`/api/admin/users/${encodeURIComponent(id)}/verify`, body),
};

// College / placement-cell APIs. Every call is gated server-side by a VERIFIED
// college_admin (or admin) and scoped to the caller's own collegeId.
export const College = {
  overview: () => api.get('/api/college/overview'),
  interventionRecommendations: () => api.get('/api/college/interventions/recommendations'),
  interventions: () => api.get('/api/college/interventions'),
  assignIntervention: (body) => api.post('/api/college/interventions/assign', body),
  students: (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== false && v != null));
    const qs = new URLSearchParams(clean).toString();
    return api.get('/api/college/students' + (qs ? `?${qs}` : ''));
  },
  student: (id) => api.get(`/api/college/students/${encodeURIComponent(id)}`),
  studentDetail: (id) => api.get(`/api/college/students/${encodeURIComponent(id)}/detail`),
  studentResume: (id) => api.get(`/api/college/students/${encodeURIComponent(id)}/resume`),
  /* Triggers a browser download of the student's resume text.
     Deliberately NOT routed through req(): that helper parses the body as JSON,
     which would swallow the file. Blob + object URL keeps the cookie auth
     (credentials: 'include') and the server's Content-Disposition filename. */
  downloadStudentResume: async (id, fallbackName = 'resume') => {
    const res = await fetch(`/api/college/students/${encodeURIComponent(id)}/resume?download=1`, {
      method: 'GET', credentials: 'include',
    });
    if (!res.ok) {
      let message = 'Could not download this resume.';
      try { message = (await res.json())?.message || message; } catch { /* non-JSON error body */ }
      const err = new Error(message); err.status = res.status; throw err;
    }
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = match ? match[1] : `${fallbackName}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick — revoking synchronously can cancel the download
    // in Safari before it has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true };
  },
  taskAssignees: (taskId) => api.get(`/api/college/tasks/${encodeURIComponent(taskId)}/assignees`),
  observability: (fresh = false) => api.get('/api/college/observability' + (fresh ? '?fresh=1' : '')),
  analytics: () => api.get('/api/college/analytics'),
  // ---- Placement drives (full lifecycle) ----
  drives: () => api.get('/api/college/drives'),
  createDrive: (body) => api.post('/api/college/drives', body),
  updateDrive: (id, patch) => api.patch(`/api/college/drives/${encodeURIComponent(id)}`, patch),
  deleteDrive: (id) => api.del(`/api/college/drives/${encodeURIComponent(id)}`),
  // Who is eligible for a drive, who isn't, and the exact rule that excluded them.
  driveCohort: (id) => api.get(`/api/college/drives/${encodeURIComponent(id)}/cohort`),
  driveOutcomes: (id) => api.get(`/api/college/drives/${encodeURIComponent(id)}/outcomes`),
  saveOutcomes: (id, entries) => api.post(`/api/college/drives/${encodeURIComponent(id)}/outcomes`, { entries }),
  removeOutcome: (driveId, studentId) =>
    api.del(`/api/college/drives/${encodeURIComponent(driveId)}/outcomes/${encodeURIComponent(studentId)}`),
  // ---- Placement outcomes report (placement %, packages, recruiters) ----
  placement: () => api.get('/api/college/placement'),
  exportCsv: (full = false) => api.get('/api/college/export' + (full ? '?full=1' : '')),
  notify: (studentIds, { title = '', message = '' } = {}) => api.post('/api/college/notify', { studentIds, title, message }),
  assignTask: (body) => api.post('/api/college/tasks', body),
  tasks: () => api.get('/api/college/tasks'),
  // ---- Onboarding & tenancy (settings, roster, membership) ----
  settings: () => api.get('/api/college/settings'),
  updateSettings: (body) => api.post('/api/college/settings', body),
  rotateJoinCode: () => api.post('/api/college/settings/rotate-code', {}),
  roster: () => api.get('/api/college/roster'),
  importRoster: (csv) => api.post('/api/college/roster/import', { csv }),
  members: (status = '') => api.get('/api/college/members' + (status ? `?status=${encodeURIComponent(status)}` : '')),
  approveMember: (id) => api.post(`/api/college/members/${encodeURIComponent(id)}/approve`, {}),
  removeMember: (id) => api.del(`/api/college/members/${encodeURIComponent(id)}`),
  // ---- Team projects: form a team, generate a skill-matched project, assign
  //      it, then verify the live hosted URL the team submits. ----
  teamCatalog: () => api.get('/api/college/team-projects/catalog'),
  suggestTeams: (body) => api.post('/api/college/team-projects/suggest', body),
  previewTeamProject: (body) => api.post('/api/college/team-projects/preview', body),
  teamProjects: () => api.get('/api/college/team-projects'),
  teamProject: (id) => api.get(`/api/college/team-projects/${encodeURIComponent(id)}`),
  assignTeamProject: (body) => api.post('/api/college/team-projects', body),
  updateTeamProject: (id, patch) => api.patch(`/api/college/team-projects/${encodeURIComponent(id)}`, patch),
  deleteTeamProject: (id) => api.del(`/api/college/team-projects/${encodeURIComponent(id)}`),
  requestTeamLink: (id, message = '') => api.post(`/api/college/team-projects/${encodeURIComponent(id)}/request-link`, { message }),
  verifyTeamProject: (id) => api.post(`/api/college/team-projects/${encodeURIComponent(id)}/verify`, {}),
};

/* Student self-service: my college binding, notifications, tasks, consent.
   Everything here is the CURRENT user's own data — never another student's. */
export const My = {
  college: () => api.get('/api/my/college'),
  registerCollege: (body) => api.post('/api/my/college/register', body),
  joinCollege: (code) => api.post('/api/my/college/join', { code }),
  leaveCollege: () => api.post('/api/my/college/leave', {}),
  notifications: (unreadOnly = false) => api.get('/api/my/notifications' + (unreadOnly ? '?unread=1' : '')),
  markNotificationsRead: (ids = null) => api.post('/api/my/notifications/read', ids ? { ids } : {}),
  tasks: () => api.get('/api/my/tasks'),
  completeTask: (taskId) => api.post(`/api/my/tasks/${encodeURIComponent(taskId)}/done`, {}),
  // Team projects the signed-in student is a member of. The server filters by
  // membership, so this can only ever return the caller's own assignments.
  teamProjects: () => api.get('/api/my/team-projects'),
  teamProject: (id) => api.get(`/api/my/team-projects/${encodeURIComponent(id)}`),
  submitTeamProject: (id, body) => api.post(`/api/my/team-projects/${encodeURIComponent(id)}/submit`, body),
  verifyTeamProject: (id) => api.post(`/api/my/team-projects/${encodeURIComponent(id)}/verify`, {}),
  consent: (body) => api.post('/api/my/consent', body),
};

/* Platform-admin college registry. */
/* Job Discovery OS — admin ingestion controls. Every route behind these calls
   is requireAuth + requireAdmin server-side; this client is a convenience, not
   the access boundary. */
export const AdminJobDiscovery = {
  health: () => api.get('/api/admin/job-discovery/health'),
  coverage: () => api.get('/api/admin/job-discovery/coverage'),
  stats: () => api.get('/api/admin/job-discovery/stats'),
  /* targets: board URLs, careers pages, company domains or source ids. */
  fetch: (targets, opts = {}) => api.post('/api/admin/job-discovery/fetch', { targets, ...opts }),
  runs: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
    ).toString();
    return api.get('/api/admin/job-discovery/runs' + (qs ? `?${qs}` : ''));
  },
  run: (id) => api.get(`/api/admin/job-discovery/runs/${encodeURIComponent(id)}`),
  jobs: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
    ).toString();
    return api.get('/api/admin/job-discovery/jobs' + (qs ? `?${qs}` : ''));
  },
  tick: (body = {}) => api.post('/api/admin/job-discovery/tick', body),
};

export const AdminColleges = {
  list: (status = '') => api.get('/api/admin/colleges' + (status ? `?status=${encodeURIComponent(status)}` : '')),
  approve: (key, body = {}) => api.post(`/api/admin/colleges/${encodeURIComponent(key)}/approve`, body),
  seedDemo: (reset = false) => api.post('/api/admin/demo/seed', { reset }),
};

// Current caller's SERVER-CONTROLLED access context (verified privileges) and
// self-service verification request. profile.role stays UI-persona only.
export const Account = {
  accessContext: () => api.get('/api/account/access-context'),
  requestVerification: (body) => api.post('/api/account/request-verification', body),
};
