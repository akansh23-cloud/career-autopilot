/* ============================================================
   COLLEGE ONBOARDING HELPERS  (deterministic; pure functions)
   ------------------------------------------------------------
   Everything the multi-college onboarding flow needs that does NOT
   touch the database: roster CSV parsing, email-domain normalization
   and matching, join-code generation/validation, and college key
   slugging. Pure and dependency-free so the whole layer is
   unit-testable without Mongo.
   ============================================================ */
import crypto from 'node:crypto';

/* ---- college key: canonical slug from a name ---- */
export function slugCollegeKey(name = '') {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64);
}

/* ---- join codes: 8 chars, unambiguous alphabet (no 0/O/1/I/L) ---- */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 8;

export function generateJoinCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

export function normalizeJoinCode(code = '') {
  return String(code).trim().toUpperCase().replace(/[\s-]/g, '');
}

export function isValidJoinCodeFormat(code = '') {
  const c = normalizeJoinCode(code);
  // Human-memorable demo/marketing codes (e.g. DEMO2026) are valid alongside
  // generated codes; everything else must use the unambiguous alphabet.
  if (/^DEMO[0-9]{4}$/.test(c)) return true;
  return c.length === JOIN_CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch));
}

/* ---- email domains ---- */
export function normalizeDomain(domain = '') {
  return String(domain).trim().toLowerCase().replace(/^@/, '').replace(/^www\./, '');
}

export function emailDomain(email = '') {
  const at = String(email).lastIndexOf('@');
  return at > 0 ? normalizeDomain(String(email).slice(at + 1)) : '';
}

/* True when the email's domain equals a listed domain OR is a subdomain of
   one (students often get mail at `students.coep.ac.in` under `coep.ac.in`). */
export function domainMatches(email = '', domains = []) {
  const d = emailDomain(email);
  if (!d) return false;
  return (domains || []).map(normalizeDomain).filter(Boolean)
    .some((allowed) => d === allowed || d.endsWith('.' + allowed));
}

/* Public providers must never be claimable as a "college domain" — otherwise
   one careless TPO typing gmail.com auto-binds the entire internet. */
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'outlook.com',
  'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
  'rediffmail.com', 'zoho.com', 'zohomail.in', 'mail.com', 'gmx.com', 'yandex.com',
]);
export function isPublicEmailDomain(domain = '') {
  return PUBLIC_EMAIL_DOMAINS.has(normalizeDomain(domain));
}

export function sanitizeDomains(domains = []) {
  const seen = new Set();
  const out = [];
  const rejected = [];
  for (const raw of domains || []) {
    const d = normalizeDomain(raw);
    if (!d) continue;
    if (!/^[a-z0-9][a-z0-9.-]{2,80}\.[a-z]{2,12}$/.test(d) || isPublicEmailDomain(d)) { rejected.push(d || String(raw)); continue; }
    if (!seen.has(d)) { seen.add(d); out.push(d); }
  }
  return { domains: out.slice(0, 10), rejected };
}

/* ============================================================
   ROSTER CSV PARSER
   ------------------------------------------------------------
   Accepts the messy CSVs placement cells actually export: flexible
   header names, quoted fields, BOM, blank lines, mixed case. Only
   `email` is required; name/branch/batch are optional. Deterministic:
   same text in, same rows and same error list out.
   ============================================================ */

const HEADER_MAP = {
  email: 'email', 'e-mail': 'email', 'email id': 'email', 'mail': 'email', 'email address': 'email',
  name: 'name', 'student name': 'name', 'full name': 'name', 'student': 'name',
  branch: 'branch', dept: 'branch', department: 'branch', stream: 'branch', 'branch/dept': 'branch',
  batch: 'batch', 'passout year': 'batch', 'passing year': 'batch', year: 'batch', 'grad year': 'batch', 'graduation year': 'batch',
  rollno: 'rollNo', 'roll no': 'rollNo', 'roll no.': 'rollNo', 'roll number': 'rollNo', prn: 'rollNo', 'enrollment no': 'rollNo',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* Minimal RFC-4180-ish line splitter (handles quotes + escaped quotes). */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export const ROSTER_MAX_ROWS = 5000;

export function parseRosterCsv(text = '') {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return { rows: [], errors: [{ line: 0, error: 'empty_file' }], headerDetected: false };

  const first = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const mapped = first.map((h) => HEADER_MAP[h] || null);
  const headerDetected = mapped.includes('email');

  let columns;
  let startAt;
  if (headerDetected) {
    columns = mapped;
    startAt = 1;
  } else {
    // No header: assume email-first, then name, branch, batch.
    columns = ['email', 'name', 'branch', 'batch'];
    startAt = 0;
  }

  const rows = [];
  const errors = [];
  const seen = new Set();
  for (let i = startAt; i < lines.length && rows.length < ROSTER_MAX_ROWS; i++) {
    const cells = splitCsvLine(lines[i]);
    const rec = {};
    columns.forEach((col, idx) => { if (col && cells[idx] !== undefined) rec[col] = cells[idx]; });
    const email = String(rec.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { errors.push({ line: i + 1, error: 'invalid_email', value: rec.email || '' }); continue; }
    if (seen.has(email)) { errors.push({ line: i + 1, error: 'duplicate_email', value: email }); continue; }
    seen.add(email);
    rows.push({
      email,
      name: String(rec.name || '').trim().slice(0, 120),
      branch: String(rec.branch || '').trim().slice(0, 80),
      batch: String(rec.batch || '').trim().slice(0, 20),
      rollNo: String(rec.rollNo || '').trim().slice(0, 40),
    });
  }
  if (lines.length - startAt > ROSTER_MAX_ROWS) errors.push({ line: 0, error: 'truncated_at_max_rows', value: String(ROSTER_MAX_ROWS) });
  return { rows, errors, headerDetected };
}

export default {
  slugCollegeKey, generateJoinCode, normalizeJoinCode, isValidJoinCodeFormat, JOIN_CODE_LENGTH,
  normalizeDomain, emailDomain, domainMatches, isPublicEmailDomain, sanitizeDomains,
  parseRosterCsv, ROSTER_MAX_ROWS,
};
