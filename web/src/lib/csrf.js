// Reads the readable double-submit CSRF cookie and exposes it for the direct
// fetch() calls some stores make outside the central api.js wrapper.
export function csrfToken() {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|;\s*)ca_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// Header object to spread into fetch() calls for state-changing requests.
export function csrfHeaders(extra = {}) {
  const token = csrfToken();
  return token ? { ...extra, 'X-CSRF-Token': token } : { ...extra };
}
