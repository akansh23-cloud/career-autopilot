// Client helpers for the GitHub integration (Career Proof Profile).
// Two layers: OAuth identity connection + GitHub App selected-repo verification.
// All calls are same-origin and go through the shared api wrapper (CSRF-aware).
// Tokens never touch the client — these helpers only ever see public-safe data.
import { api } from './api.js';

export const GithubIntegration = {
  config: () => api.get('/api/integrations/github/config'),
  status: () => api.get('/api/integrations/github/status'),
  // OAuth identity connect is a full-page redirect (sets server session state).
  connectUrl: () => '/api/integrations/github/connect',
  sync: () => api.post('/api/integrations/github/sync', {}),
  disconnect: () => api.del('/api/integrations/github'),

  // GitHub App installation is a full-page redirect to GitHub's install page.
  installUrl: () => '/api/integrations/github/app/install',
  syncRepos: () => api.post('/api/integrations/github/app/sync-repos', {}),
  repositories: () => api.get('/api/integrations/github/repositories'),
  analyze: (repoId, { confirmPrivate = false } = {}) =>
    api.post(`/api/integrations/github/repositories/${encodeURIComponent(repoId)}/analyze`, { confirmPrivate }),
  linkProject: (repoId, projectId) =>
    api.post(`/api/integrations/github/repositories/${encodeURIComponent(repoId)}/link-project`, { projectId }),
  importProject: (repoId, title) =>
    api.post(`/api/integrations/github/repositories/${encodeURIComponent(repoId)}/import-project`, title ? { title } : {}),
  setVisibility: (repoId, flags) =>
    api.patch(`/api/integrations/github/repositories/${encodeURIComponent(repoId)}/visibility`, flags),
  disconnectInstallation: (installationId) =>
    api.del(`/api/integrations/github/app/installations/${encodeURIComponent(installationId)}`),
};

/* Read GitHub return flags from the URL after an OAuth / App redirect, then
   strip them so a refresh doesn't re-trigger UI. Returns {} when none. */
export function consumeGithubReturnFlags() {
  if (typeof window === 'undefined') return {};
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return {};
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  if (!params.get('gh_return') && !params.get('gh_connected') && !params.get('gh_app') && !params.get('gh_error')) return {};
  const flags = {
    connected: params.get('gh_connected') === '1',
    appInstalled: params.get('gh_app') === '1',
    error: params.get('gh_error') || '',
  };
  // Clean the URL (keep the route, drop the gh_* query).
  const route = hash.slice(0, qIdx);
  try { window.history.replaceState(null, '', window.location.pathname + window.location.search + route); } catch { /* ignore */ }
  return flags;
}

export const GH_ERROR_LABELS = {
  oauth_not_configured: 'GitHub sign-in is not configured on this server.',
  app_not_configured: 'The GitHub App is not configured on this server.',
  denied: 'GitHub authorization was cancelled.',
  bad_state: 'Security check failed — please try connecting again.',
  missing_code: 'GitHub did not return an authorization code.',
  install_cancelled: 'GitHub App installation was cancelled.',
  install_failed: 'GitHub App installation could not be completed.',
  oauth_failed: 'Could not connect your GitHub account. Please try again.',
};
