/* ============================================================
   JOB DISCOVERY OS — COMPANY & TITLE NORMALIZATION
   ------------------------------------------------------------
   Normalization is NEVER destructive (§16): the raw value is
   always carried alongside the normalized one.
   ============================================================ */

import { tokens, normalizeWhitespace, registrableDomain } from './text.js';
import { resolveFamilies, coreTitleTokens, ROLE_FAMILIES } from './taxonomy.js';
import { SENIORITY, EMPLOYMENT_TYPE } from '../schema.js';

/* Legal-form suffixes dropped for MATCHING only. */
const COMPANY_SUFFIXES = new Set([
  'inc', 'inc.', 'llc', 'ltd', 'ltd.', 'limited', 'plc', 'gmbh', 'ag', 'bv', 'nv',
  'sa', 'sas', 'srl', 'spa', 'oy', 'ab', 'as', 'pty', 'pvt', 'private', 'corp',
  'corporation', 'co', 'company', 'holdings', 'group', 'technologies', 'technology',
  'labs', 'lab', 'solutions', 'services', 'systems', 'software', 'india', 'global',
  'international', 'worldwide', 'ventures', 'partners', 'sarl', 'kk', 'kft', 'ou',
]);

/* Trailing decorations aggregators bolt on. */
const COMPANY_NOISE = /\s*[|\-–—]\s*(careers?|jobs?|hiring|we\s+are\s+hiring)\s*$/i;

/**
 * @returns { name, normalizedName, domain }
 * normalizedName is a MATCH KEY, not a display value.
 */
export function normalizeCompany(rawName, { domain = null, website = null } = {}) {
  const name = normalizeWhitespace(String(rawName || '').replace(COMPANY_NOISE, ''));
  const toks = tokens(name).filter((t) => !COMPANY_SUFFIXES.has(t));
  const normalizedName = toks.join(' ') || tokens(name).join(' ');
  const dom = domain ? registrableDomain(domain) : (website ? registrableDomain(website) : null);
  return { name, normalizedName, domain: dom || null };
}

/** True when two company names refer to the same employer with high confidence. */
export function sameCompany(a, b) {
  const an = normalizeCompany(a).normalizedName;
  const bn = normalizeCompany(b).normalizedName;
  if (!an || !bn) return false;
  if (an === bn) return true;
  /* One is a strict token-prefix of the other AND shares the head token,
     e.g. "acme" vs "acme cloud". Deliberately narrow to avoid overmerging. */
  const at = an.split(' '); const bt = bn.split(' ');
  if (at[0] !== bt[0]) return false;
  const [short, long] = at.length <= bt.length ? [at, bt] : [bt, at];
  return short.every((t, i) => long[i] === t) && (long.length - short.length) <= 1;
}

/* ------------------------------ titles ------------------------------ */

const SENIORITY_RULES = [
  [/\b(intern|internship|trainee|apprentice)\b/i, SENIORITY.INTERN],
  [/\b(vp|vice\s+president|c[te]o|chief\s+\w+\s+officer)\b/i, SENIORITY.EXECUTIVE],
  [/\b(director|head\s+of)\b/i, SENIORITY.DIRECTOR],
  [/\b(principal)\b/i, SENIORITY.PRINCIPAL],
  [/\b(staff)\b/i, SENIORITY.STAFF],
  [/\b(lead|leader)\b/i, SENIORITY.LEAD],
  [/\b(manager|mgr)\b/i, SENIORITY.MANAGER],
  [/\b(sr\.?|senior)\b/i, SENIORITY.SENIOR],
  [/\b(jr\.?|junior|entry[\s-]?level|graduate|fresher|associate)\b/i, SENIORITY.ENTRY],
  [/\b(iii|iv)\b/i, SENIORITY.SENIOR],
  [/\b(ii)\b/i, SENIORITY.MID],
  [/\b(i)\b(?!\w)/i, SENIORITY.ENTRY],
];

export function detectSeniority(title, description = '') {
  const t = String(title || '');
  for (const [re, level] of SENIORITY_RULES) if (re.test(t)) return level;
  const d = String(description || '').slice(0, 1200);
  if (/\b(0[-–]?1|fresher|entry[\s-]level)\b/i.test(d)) return SENIORITY.ENTRY;
  return SENIORITY.UNKNOWN;
}

const EMPLOYMENT_RULES = [
  [/\b(full[\s-]?time|fulltime|permanent|regular)\b/i, EMPLOYMENT_TYPE.FULL_TIME],
  [/\b(part[\s-]?time|parttime)\b/i, EMPLOYMENT_TYPE.PART_TIME],
  [/\b(contract|contractor|freelance|c2h|corp[\s-]to[\s-]corp|b2b)\b/i, EMPLOYMENT_TYPE.CONTRACT],
  [/\b(temporary|temp|seasonal|fixed[\s-]term)\b/i, EMPLOYMENT_TYPE.TEMPORARY],
  [/\b(intern|internship|apprentice)\b/i, EMPLOYMENT_TYPE.INTERNSHIP],
  [/\b(volunteer)\b/i, EMPLOYMENT_TYPE.VOLUNTEER],
];

const SCHEMA_ORG_EMPLOYMENT = {
  FULL_TIME: EMPLOYMENT_TYPE.FULL_TIME,
  FULLTIME: EMPLOYMENT_TYPE.FULL_TIME,
  PART_TIME: EMPLOYMENT_TYPE.PART_TIME,
  PARTTIME: EMPLOYMENT_TYPE.PART_TIME,
  CONTRACTOR: EMPLOYMENT_TYPE.CONTRACT,
  CONTRACT: EMPLOYMENT_TYPE.CONTRACT,
  TEMPORARY: EMPLOYMENT_TYPE.TEMPORARY,
  INTERN: EMPLOYMENT_TYPE.INTERNSHIP,
  INTERNSHIP: EMPLOYMENT_TYPE.INTERNSHIP,
  VOLUNTEER: EMPLOYMENT_TYPE.VOLUNTEER,
  PER_DIEM: EMPLOYMENT_TYPE.TEMPORARY,
  OTHER: EMPLOYMENT_TYPE.OTHER,
};

/**
 * Explicit employment type only. An absent value stays UNKNOWN — never
 * defaulted to FULL_TIME (§37).
 */
export function normalizeEmploymentType(raw) {
  if (raw == null || raw === '') return EMPLOYMENT_TYPE.UNKNOWN;
  const values = Array.isArray(raw) ? raw : [raw];
  for (const v of values) {
    const key = String(v).toUpperCase().replace(/[\s-]+/g, '_');
    if (SCHEMA_ORG_EMPLOYMENT[key]) return SCHEMA_ORG_EMPLOYMENT[key];
  }
  const s = values.join(' ');
  for (const [re, type] of EMPLOYMENT_RULES) if (re.test(s)) return type;
  return EMPLOYMENT_TYPE.UNKNOWN;
}

const TITLE_DECORATION = [
  /\s*\((?:m|f|d|w|x|gn|m\/f\/d|m\/w\/d|f\/m\/d|all genders?|any gender)[^)]*\)\s*/gi,
  /\s*\[[^\]]*\]\s*/g,
  /\s*[–—-]\s*(remote|hybrid|on[\s-]?site|work from home|wfh)\b.*$/i,
  /\s*\|\s*.*$/,
];

/**
 * @returns { title, normalizedTitle, titleFamily, titleFamilies, seniority }
 * `title` keeps the source's display string; only `normalizedTitle` is reduced.
 */
export function normalizeTitle(rawTitle, { description = '' } = {}) {
  const title = normalizeWhitespace(rawTitle || '');
  let cleaned = title;
  for (const re of TITLE_DECORATION) cleaned = cleaned.replace(re, ' ');
  cleaned = normalizeWhitespace(cleaned);

  const normalizedTitle = coreTitleTokens(cleaned).join(' ') || tokens(cleaned).join(' ');
  const { families, primary } = resolveFamilies(cleaned);
  return {
    title,
    cleanedTitle: cleaned,
    normalizedTitle,
    titleFamily: primary,
    titleFamilies: families,
    titleFamilyLabel: primary ? ROLE_FAMILIES[primary].label : null,
    seniority: detectSeniority(cleaned, description),
  };
}

export default {
  normalizeCompany, sameCompany, normalizeTitle, detectSeniority,
  normalizeEmploymentType,
};
