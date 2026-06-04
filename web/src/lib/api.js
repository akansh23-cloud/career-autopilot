// Thin fetch wrapper. Same-origin in production (Express serves the SPA);
// proxied to the backend during `vite` dev. Always sends the session cookie.
const json = (r) => r.text().then((t) => (t ? JSON.parse(t) : {}));

async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
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
