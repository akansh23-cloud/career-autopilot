/* ============================================================
   SSRF GUARD
   ------------------------------------------------------------
   Proof verification fetches URLs the STUDENT supplies. Without a
   guard, that turns the server into an open proxy for probing
   whatever the server can reach:

     http://169.254.169.254/...   cloud instance metadata
     http://127.0.0.1:6379        local Redis
     http://10.0.0.5/admin        internal services

   This module resolves the hostname and refuses anything that is
   not a public unicast address. It also caps redirects and
   re-checks each hop, because a public host can 302 straight to
   169.254.169.254.

   v6 shipped `verifyDeployment` with `redirect: 'follow'` and no
   checks at all. This closes that.
   ============================================================ */

import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 4500; // keep inside a serverless function budget

/* Blocked IPv4 ranges, as [network, maskBits]. */
const BLOCKED_V4 = [
  ['0.0.0.0', 8],        // "this" network
  ['10.0.0.0', 8],       // RFC1918 private
  ['100.64.0.0', 10],    // carrier-grade NAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local — cloud metadata lives here
  ['172.16.0.0', 12],    // RFC1918 private
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.168.0.0', 16],   // RFC1918 private
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved
];

function v4ToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8 >>> 0) + Number(o), 0) >>> 0;
}

export function isBlockedIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return BLOCKED_V4.some(([net_, bits]) => {
      const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
      return (n & mask) >>> 0 === (v4ToInt(net_) & mask) >>> 0;
    });
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;             // unspecified, loopback
    if (s.startsWith('fe80')) return true;                   // link-local
    if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique local
    if (s.startsWith('ff')) return true;                     // multicast
    // IPv4-mapped (::ffff:10.0.0.1) — check the embedded v4
    const m = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isBlockedIp(m[1]);
    return false;
  }
  return true; // not a recognisable IP
}

/**
 * Validate a URL is safe to fetch server-side.
 * Returns { ok, url, reason }.
 */
export async function assertSafeUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'bad_url' };
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'bad_scheme' };
  }
  // A literal IP in the URL is checked directly; a hostname is resolved.
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isBlockedIp(host)) return { ok: false, reason: 'private_address' };
    return { ok: true, url: u.toString() };
  }
  if (/^localhost$/i.test(host) || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    return { ok: false, reason: 'private_address' };
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (!records.length) return { ok: false, reason: 'dns_failed' };
    // Every resolved address must be public — a host that resolves to both a
    // public and a private address is a classic DNS-rebinding attempt.
    if (records.some((r) => isBlockedIp(r.address))) {
      return { ok: false, reason: 'private_address' };
    }
  } catch {
    return { ok: false, reason: 'dns_failed' };
  }

  return { ok: true, url: u.toString() };
}

/**
 * Fetch a student-supplied URL safely: validates every hop, follows at most
 * MAX_REDIRECTS, and never sends credentials.
 * Returns { ok, reason, response, finalUrl, hops }.
 */
export async function safeFetch(rawUrl, { method = 'GET' } = {}) {
  let current = rawUrl;
  const hops = [];

  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    const check = await assertSafeUrl(current);
    if (!check.ok) return { ok: false, reason: check.reason, finalUrl: current, hops };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(check.url, {
        method,
        redirect: 'manual', // we validate each hop ourselves
        signal: controller.signal,
        headers: { 'User-Agent': 'career-autopilot-verifier', Accept: '*/*' },
      });
    } catch {
      return { ok: false, reason: 'unreachable', finalUrl: check.url, hops };
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { ok: true, response: res, finalUrl: check.url, hops };
      hops.push(check.url);
      current = new URL(loc, check.url).toString();
      continue;
    }
    return { ok: true, response: res, finalUrl: check.url, hops };
  }
  return { ok: false, reason: 'too_many_redirects', finalUrl: current, hops };
}

export default { assertSafeUrl, safeFetch, isBlockedIp };
