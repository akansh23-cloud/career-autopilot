// Shared test harness: boots the real Express app on an ephemeral port and
// returns a small fetch client with a cookie jar + automatic CSRF echo.
//
// IMPORTANT: set the test environment BEFORE importing this module so the app
// validates/configures itself in test mode.
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEV_LOGIN = '1';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-please-ignore-0123456789';

import http from 'node:http';
import app from '../server.js';

export async function startServer() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

export function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

/** A cookie-jar client that mimics a browser: stores Set-Cookie and echoes the
 *  ca_csrf cookie back as X-CSRF-Token on unsafe methods. */
export function makeClient(base) {
  const jar = new Map();

  function cookieHeader() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  function storeSetCookie(res) {
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : res.headers.raw?.()['set-cookie'] || [];
    for (const c of set) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      if (idx > -1) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
  function csrf() {
    return jar.get('ca_csrf') || '';
  }

  async function request(method, path, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    const cookie = cookieHeader();
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (!['GET', 'HEAD'].includes(method)) {
      const token = csrf();
      if (token) headers['X-CSRF-Token'] = token;
    }
    const res = await fetch(base + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    storeSetCookie(res);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
    return { status: res.status, json, text, headers: res.headers };
  }

  return {
    jar,
    get: (p, h) => request('GET', p, undefined, h),
    post: (p, b, h) => request('POST', p, b, h),
    put: (p, b, h) => request('PUT', p, b, h),
    patch: (p, b, h) => request('PATCH', p, b, h),
    del: (p, h) => request('DELETE', p, undefined, h),
    /** Establish a CSRF cookie (and session) by hitting a public GET first. */
    async bootstrap() {
      await request('GET', '/auth/me');
      return this;
    },
    async devLogin(name, email) {
      await this.bootstrap();
      return request('POST', '/auth/dev-login', { name, email });
    },
  };
}
