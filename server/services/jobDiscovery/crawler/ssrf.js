/* ============================================================
   JOB DISCOVERY OS — SSRF PROTECTION  (HARD SECURITY REQUIREMENT §14/§47)
   ------------------------------------------------------------
   The crawler fetches URLs DISCOVERED AT RUNTIME. Source-discovery
   input is untrusted by definition, so every URL — initial and
   every redirect hop — passes through here before a socket opens.

   Blocked: non-http(s) protocols, localhost, loopback, private and
   shared IPv4 space, link-local (including 169.254.169.254 and the
   other cloud metadata endpoints), CGNAT, multicast/reserved,
   IPv6 loopback/ULA/link-local and IPv4-mapped IPv6 forms of all
   of the above.

   DNS is resolved HERE and the resolved address is what gets
   validated, so a public hostname that resolves into private space
   is rejected rather than fetched.
   ============================================================ */

import dns from 'node:dns/promises';
import net from 'node:net';

export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export const DENIED_PROTOCOLS = new Set([
  'file:', 'ftp:', 'ftps:', 'data:', 'gopher:', 'ws:', 'wss:', 'blob:',
  'javascript:', 'about:', 'chrome:', 'view-source:', 'jar:', 'mailto:',
  'tel:', 'sftp:', 'ldap:', 'ldaps:', 'dict:', 'tftp:',
]);

/** Hostnames that must never be fetched regardless of DNS. */
export const DENIED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata', 'metadata.google.internal', 'metadata.goog',
  'instance-data', 'instance-data.ec2.internal',
]);

const DENIED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

export class SsrfError extends Error {
  constructor(message, code = 'SSRF_BLOCKED', detail = {}) {
    super(message);
    this.name = 'SsrfError';
    this.code = code;
    this.detail = detail;
  }
}

function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

/* CIDR blocks that must never be reachable from the crawler. */
const V4_BLOCKS = [
  ['0.0.0.0', 8, 'this-network'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'cgnat'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local / cloud-metadata'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'ietf-protocol'],
  ['192.0.2.0', 24, 'test-net'],
  ['192.88.99.0', 24, '6to4-relay'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'benchmark'],
  ['198.51.100.0', 24, 'test-net'],
  ['203.0.113.0', 24, 'test-net'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
].map(([base, bits, why]) => ({ base: ipv4ToInt(base), mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0, why }));

export function classifyIPv4(ip) {
  const n = ipv4ToInt(ip);
  if (n == null) return { blocked: true, why: 'unparseable-ipv4' };
  for (const b of V4_BLOCKS) {
    if ((n & b.mask) >>> 0 === b.base) return { blocked: true, why: b.why };
  }
  if (ip === '255.255.255.255') return { blocked: true, why: 'broadcast' };
  return { blocked: false, why: null };
}

export function classifyIPv6(ip) {
  const lower = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === '::' || lower === '::0') return { blocked: true, why: 'unspecified' };
  if (lower === '::1') return { blocked: true, why: 'loopback' };

  /* IPv4-mapped / IPv4-compatible forms: ::ffff:127.0.0.1, ::ffff:7f00:1 */
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return classifyIPv4(mapped[1]);
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const a = parseInt(mappedHex[1], 16); const b = parseInt(mappedHex[2], 16);
    const v4 = [(a >> 8) & 255, a & 255, (b >> 8) & 255, b & 255].join('.');
    return classifyIPv4(v4);
  }
  const compat = lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (compat) return classifyIPv4(compat[1]);

  const head = lower.split(':')[0];
  const h = parseInt(head || '0', 16);
  if (Number.isFinite(h)) {
    if ((h & 0xfe00) === 0xfc00) return { blocked: true, why: 'unique-local (fc00::/7)' };
    if ((h & 0xffc0) === 0xfe80) return { blocked: true, why: 'link-local (fe80::/10)' };
    if ((h & 0xff00) === 0xff00) return { blocked: true, why: 'multicast (ff00::/8)' };
  }
  if (lower.startsWith('64:ff9b:')) return { blocked: true, why: 'nat64' };
  if (lower.startsWith('2002:')) return { blocked: true, why: '6to4' };
  return { blocked: false, why: null };
}

export function classifyAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return classifyIPv4(ip);
  if (family === 6) return classifyIPv6(ip);
  return { blocked: true, why: 'not-an-ip' };
}

export function hostnameBlocked(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h) return 'empty-hostname';
  if (DENIED_HOSTNAMES.has(h)) return `denied-hostname:${h}`;
  for (const suffix of DENIED_HOST_SUFFIXES) if (h.endsWith(suffix)) return `denied-suffix:${suffix}`;
  if (!h.includes('.') && net.isIP(h) === 0) return 'unqualified-hostname';
  return null;
}

/**
 * Validate a single URL. Resolves DNS and validates EVERY returned address —
 * a multi-record answer where one record is private is rejected outright
 * (defence against DNS rebinding via mixed answers).
 *
 * @returns { url, hostname, addresses } on success
 * @throws  SsrfError
 */
export async function assertUrlAllowed(rawUrl, { resolver = dns, allowPrivate = false } = {}) {
  let u;
  try { u = new URL(String(rawUrl)); } catch {
    throw new SsrfError(`Unparseable URL: ${String(rawUrl).slice(0, 120)}`, 'BAD_URL');
  }

  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    throw new SsrfError(`Protocol not permitted: ${u.protocol}`, 'BAD_PROTOCOL', { protocol: u.protocol });
  }
  if (u.username || u.password) {
    throw new SsrfError('Credentials in URL are not permitted', 'URL_CREDENTIALS');
  }

  const hostname = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (allowPrivate) return { url: u.toString(), hostname, addresses: [] };

  const nameIssue = hostnameBlocked(hostname);
  if (nameIssue && net.isIP(hostname) === 0) {
    throw new SsrfError(`Hostname not permitted (${nameIssue})`, 'BLOCKED_HOST', { hostname, reason: nameIssue });
  }

  /* Literal IP in the URL — validate directly, no DNS involved. */
  if (net.isIP(hostname)) {
    const c = classifyAddress(hostname);
    if (c.blocked) throw new SsrfError(`Address in reserved range (${c.why})`, 'BLOCKED_ADDRESS', { hostname, reason: c.why });
    return { url: u.toString(), hostname, addresses: [hostname] };
  }

  let records;
  try {
    records = await resolver.lookup(hostname, { all: true, verbatim: true });
  } catch (e) {
    throw new SsrfError(`DNS resolution failed for ${hostname}`, 'DNS_FAILED', { hostname, cause: e?.code || e?.message });
  }
  const addresses = (records || []).map((r) => r.address).filter(Boolean);
  if (!addresses.length) throw new SsrfError(`No addresses for ${hostname}`, 'DNS_EMPTY', { hostname });

  for (const addr of addresses) {
    const c = classifyAddress(addr);
    if (c.blocked) {
      throw new SsrfError(`${hostname} resolves into a reserved range (${addr} — ${c.why})`, 'BLOCKED_ADDRESS', { hostname, address: addr, reason: c.why });
    }
  }
  return { url: u.toString(), hostname, addresses };
}

/**
 * Validate a redirect hop. Public -> private is the classic bypass, so the
 * destination is re-validated from scratch rather than trusted because the
 * origin was fine.
 */
export async function assertRedirectAllowed(fromUrl, toUrl, opts = {}) {
  const resolved = new URL(toUrl, fromUrl).toString();
  return assertUrlAllowed(resolved, opts);
}

export default {
  assertUrlAllowed, assertRedirectAllowed, classifyAddress, classifyIPv4,
  classifyIPv6, hostnameBlocked, SsrfError, ALLOWED_PROTOCOLS, DENIED_PROTOCOLS,
};
