/* ============================================================================
   contactFields.js — pure, dependency-free contact + company-domain logic.
   ----------------------------------------------------------------------------
   Shared by the frontend (Jobs/Outreach contact cards) AND the backend
   (server.js /contacts routes) so the rules can never drift:

   1. Company-domain resolution: a job's apply URL usually points at a job
      board (LinkedIn/Indeed/Naukri/...). Those domains must NEVER be used as
      the employer domain for email lookup — Hunter/Snov domain searches
      against linkedin.com return garbage. Only real employer domains qualify.

   2. Email field normalization: providers return emails under many shapes
      (email, workEmail, professionalEmail, emails[0].value, contact.email…).
      The UI must find a valid email no matter which field carries it.

   3. Email status: every contact gets an explicit emailStatus
      ('verified' | 'probable' | 'source' | 'none') and, when none, a
      noEmailReason the UI can show instead of silently hiding the field.
   ========================================================================== */

/* Job boards / ATS / aggregator domains that are never an employer domain. */
export const JOB_BOARD_DOMAINS = [
  'linkedin.com', 'indeed.com', 'naukri.com', 'foundit.in', 'monster.com',
  'google.com', 'jobs.google.com', 'serpapi.com',
  'remoteok.com', 'remoteok.io', 'remotive.com', 'remotive.io',
  'arbeitnow.com', 'jobicy.com',
  'greenhouse.io', 'lever.co', 'workable.com', 'smartrecruiters.com',
  'wellfound.com', 'angel.co', 'glassdoor.com', 'ziprecruiter.com',
  'instahyre.com', 'cutshort.io', 'hirist.com', 'shine.com', 'timesjobs.com',
  'bing.com', 'yahoo.com', 'facebook.com', 'x.com', 'twitter.com',
];

/* 'careers.acme.com' -> 'acme.com'; tolerates full URLs and bare domains. */
export function cleanDomainName(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].split('@').pop();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return '';
  return s;
}

function registrableDomain(domain) {
  const parts = cleanDomainName(domain).split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  // crude public-suffix handling good enough for board matching: keep 3 labels
  // for 2-part TLDs (co.in, com.au, co.uk), else 2.
  const twoPartTld = /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
  return parts.slice(twoPartTld ? -3 : -2).join('.');
}

export function isJobBoardDomain(domain) {
  const d = registrableDomain(domain);
  if (!d) return false;
  return JOB_BOARD_DOMAINS.some((b) => d === b || d.endsWith(`.${b}`));
}

function domainFromUrlSafe(url) {
  const m = String(url || '').match(/^[a-z]+:\/\/([^/?#]+)/i);
  return m ? cleanDomainName(m[1]) : cleanDomainName(url && String(url).includes('.') && !String(url).includes(' ') ? url : '');
}

/**
 * Resolve the EMPLOYER domain for a job. Order:
 *   1. explicit company domain/website fields from the provider
 *      (companyDomain, companyWebsite, employerWebsite, website, companyUrl)
 *   2. the apply/source URL — ONLY if it is not a job-board/ATS domain
 *      (a direct careers.acme.com link is a legitimate employer domain)
 * Returns '' when no real employer domain exists — callers must then ask the
 * user for the domain instead of guessing.
 */
export function resolveCompanyDomain(job = {}) {
  const explicit = [
    job.companyDomain, job.companyWebsite, job.employerWebsite,
    job.company_website, job.website, job.companyUrl, job.domain,
  ];
  for (const c of explicit) {
    const d = c && (String(c).includes('/') || String(c).includes(':') ? domainFromUrlSafe(c) : cleanDomainName(c));
    if (d && !isJobBoardDomain(d)) return registrableDomain(d);
  }
  for (const u of [job.applyUrl, job.url, job.sourceUrl]) {
    const d = domainFromUrlSafe(u);
    if (d && !isJobBoardDomain(d)) return registrableDomain(d);
  }
  return '';
}

/* ----------------------------- email fields ----------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function firstValidEmail(...candidates) {
  for (const c of candidates) {
    const v = typeof c === 'string' ? c.trim() : '';
    if (v && EMAIL_RE.test(v)) return v;
  }
  return '';
}

/** Pull an email out of any known provider shape. */
export function extractContactEmail(c = {}) {
  const arr = Array.isArray(c.emails) ? c.emails : [];
  return firstValidEmail(
    c.email, c.workEmail, c.work_email, c.professionalEmail, c.professional_email,
    c.businessEmail, c.business_email, c.personalEmail, c.personal_email,
    arr[0] && (typeof arr[0] === 'string' ? arr[0] : (arr[0].value || arr[0].email || arr[0].address)),
    c.contact && c.contact.email,
    c.recommended_personal_email, c.work_email_address,
  );
}

/** Pull a LinkedIn URL out of any known provider shape. */
export function extractContactLinkedin(c = {}) {
  const cands = [c.linkedinUrl, c.linkedin, c.linkedin_url, c.profileUrl, c.profile_url,
    c.contact && c.contact.linkedin, c.url];
  for (const v of cands) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && /linkedin\.com/i.test(s)) return s;
  }
  // c.url may be a non-linkedin profile link — return it last only if nothing else
  const u = typeof c.url === 'string' ? c.url.trim() : '';
  return /^https?:\/\//i.test(u) ? u : '';
}

export const EMAIL_STATUSES = ['verified', 'probable', 'source', 'none'];

/**
 * Normalize one contact from any provider into a stable shape the UI can
 * always render. Never throws; never loses an email that exists.
 *
 * ctx (optional): { domainUsed, providersConfigured } — lets the normalizer
 * pick an accurate noEmailReason for the empty case.
 */
export function normalizeContact(c = {}, ctx = {}) {
  const email = extractContactEmail(c);
  const linkedinUrl = extractContactLinkedin(c);
  let emailStatus = 'none';
  if (email) {
    if (c.verified === true || c.emailVerified === true || /^verified$/i.test(String(c.emailStatus || ''))) emailStatus = 'verified';
    else if (c.probable === true || c.emailProbable === true) emailStatus = 'probable';
    else emailStatus = 'source'; // provider-sourced but not explicitly verified
  }
  let noEmailReason = '';
  if (!email) {
    if (c.noEmailReason) noEmailReason = c.noEmailReason;
    else if (c.emailLocked || /locked|credit/i.test(String(c.reason || '')) && /email/i.test(String(c.reason || ''))) noEmailReason = 'Email locked by provider (requires credits/upgrade).';
    else if (ctx.providersConfigured === false) noEmailReason = 'No contact provider configured — add Hunter/Apollo/PDL keys for verified emails.';
    else if (ctx.domainUsed === '' || ctx.domainUsed === false) noEmailReason = 'Missing company domain — add the employer website domain to search verified emails.';
    else noEmailReason = 'Provider returned no email for this person.';
  }
  return {
    ...c,
    name: c.name || '',
    title: c.title || c.position || c.contactType || '',
    company: c.company || '',
    email,
    linkedinUrl,
    emailStatus,
    noEmailReason,
    source: c.source || c.provider || '',
    confidence: typeof c.confidence === 'number' ? c.confidence : (emailStatus === 'verified' ? 70 : emailStatus === 'probable' ? 30 : email ? 45 : 20),
  };
}

export default {
  JOB_BOARD_DOMAINS, cleanDomainName, isJobBoardDomain, resolveCompanyDomain,
  extractContactEmail, extractContactLinkedin, normalizeContact, EMAIL_STATUSES,
};
