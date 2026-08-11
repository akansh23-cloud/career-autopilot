/* ============================================================
   TEMPLATE OS — PACKAGE SECURITY PRIMITIVES
   ------------------------------------------------------------
   Dependency-free guards used before/while reading template ZIPs.
   Keeping CSS/path/magic-byte validation separate lets security
   tests run even when the optional JSZip runtime is not installed.
   ============================================================ */

export const PACKAGE_SECURITY_VERSION = 'template-package-security-v2-strict';


const PACKAGE_METADATA_KEYS = Object.freeze({
  source: 200,
  licenseName: 120,
  author: 120,
  notes: 1000,
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function sanitizePackageText(value, { maxChars = 1000 } = {}) {
  if (typeof value !== 'string') return { ok: false, value: '', reason: 'must be a string' };
  if (value.length > maxChars) return { ok: false, value: '', reason: `exceeds ${maxChars} characters` };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)) {
    return { ok: false, value: '', reason: 'contains forbidden control/bidi characters' };
  }
  if (/[<>]/.test(value)) return { ok: false, value: '', reason: 'markup delimiters are not allowed' };
  return { ok: true, value: value.trim(), reason: null };
}

export function sanitizePackageMetadata(input) {
  const rejected = [];
  if (!isPlainObject(input)) return { ok: false, value: null, rejected: [{ field: 'metadata', reason: 'must be a plain object' }] };
  const value = {};
  for (const [key, raw] of Object.entries(input)) {
    const limit = PACKAGE_METADATA_KEYS[key];
    if (!limit) { rejected.push({ field: key, reason: 'field is not in metadata allowlist' }); continue; }
    const safe = sanitizePackageText(raw, { maxChars: limit });
    if (!safe.ok) { rejected.push({ field: key, reason: safe.reason }); continue; }
    value[key] = safe.value;
  }
  return { ok: rejected.length === 0, value: rejected.length ? null : value, rejected };
}

const CSS_VAR_RULES = Object.freeze({
  '--tpl-accent': /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i,
  '--tpl-rule': /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i,
  '--tpl-side': /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i,
  '--tpl-text': /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i,
  '--tpl-muted': /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i,
});

export function sanitizePackageCss(css = '', { maxBytes = 8 * 1024 } = {}) {
  const accepted = {};
  const rejected = [];
  const raw = String(css);
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return { ok: false, version: PACKAGE_SECURITY_VERSION, accepted, rejected: [{ rule: 'styles.css exceeds size limit' }] };
  }
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (/@|url\s*\(|expression\s*\(|javascript\s*:|<|>|\\|[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/i.test(text)) {
    rejected.push({ rule: 'forbidden CSS construct' });
  }
  const root = text.match(/^:root\s*\{([\s\S]*)\}\s*$/i);
  if (!root) rejected.push({ rule: 'styles.css must contain exactly one :root block' });
  const body = root ? root[1].trim() : '';
  if (body && /[{}]/.test(body)) rejected.push({ rule: 'nested CSS blocks are not allowed' });

  if (root) {
    const declarations = body.split(';').map((x) => x.trim()).filter(Boolean);
    for (const declaration of declarations) {
      const m = declaration.match(/^(--tpl-[a-z-]+)\s*:\s*(.+)$/i);
      if (!m) { rejected.push({ rule: 'malformed CSS variable declaration', sample: declaration.slice(0, 80) }); continue; }
      const name = m[1].toLowerCase();
      const value = m[2].trim();
      const rule = CSS_VAR_RULES[name];
      if (!rule) { rejected.push({ name, value, rule: 'variable not in allowlist' }); continue; }
      if (!rule.test(value)) { rejected.push({ name, value, rule: 'value failed format check' }); continue; }
      accepted[name] = value;
    }
  }
  return { ok: rejected.length === 0, version: PACKAGE_SECURITY_VERSION, accepted: rejected.length ? {} : accepted, rejected };
}

export function unsafePackagePath(path = '') {
  const p = String(path);
  return !p || p.includes('..') || p.startsWith('/') || /^[a-z]:/i.test(p) || p.includes('\\') || p.split('/').some((segment) => !segment || segment === '.');
}

export function imageSignatureMatches(name, buf) {
  const b = buf || new Uint8Array();
  if (/\.png$/i.test(name)) return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
  if (/\.jpe?g$/i.test(name)) return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (/\.webp$/i.test(name)) return b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP';
  return false;
}

export default { PACKAGE_SECURITY_VERSION, sanitizePackageCss, sanitizePackageText, sanitizePackageMetadata, unsafePackagePath, imageSignatureMatches };
