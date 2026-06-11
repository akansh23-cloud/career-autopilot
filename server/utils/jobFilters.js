/* ============================================================
   JOB FILTERS — pure, deterministic, no AI / no network.
   ------------------------------------------------------------
   Single source of truth for the job-search filter vocabulary.
   The frontend (web/src/lib/jobFilterOptions.js) must use the
   SAME canonical values — a regression test asserts frontend ⊆
   backend for every enum.

   Why classification exists: job sources only set job.mode to
   'Remote' or 'On-site/Hybrid' (a combined bucket). To support
   separate Hybrid / On-site filters, the work mode must be
   classified from the job's own text (title + summary + mode).
   The same applies to experience level and job type, which most
   sources do not provide as structured fields at all.
   ============================================================ */

export const WORK_MODES = ['any', 'remote', 'hybrid', 'onsite'];
export const EXPERIENCE_LEVELS = ['any', 'internship', 'entry', 'junior', 'mid', 'senior'];
export const JOB_TYPES = ['any', 'full-time', 'internship', 'contract', 'part-time'];

const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();

/* Combined searchable text for a job. Includes the structured mode/type
   fields so explicit source data always participates in classification. */
function jobHaystack(job = {}) {
  return lc([
    job.title, job.summary, job.description, job.mode,
    job.location, job.employmentType, job.jobType, job.type,
    Array.isArray(job.tags) ? job.tags.join(' ') : '',
  ].filter(Boolean).join('\n'));
}

/* ------------------------------------------------- work mode ------- */

/* Map ANY historical or sloppy mode value to a canonical WORK_MODES entry.
   Legacy UI values that MUST keep working:
     'Any'             -> 'any'
     'Remote'          -> 'remote'
     'On-site/Hybrid'  -> 'hybrid'  (legacy combined button; hybrid keeps the
                                     broadest non-remote behaviour because
                                     matchesWorkMode lets the combined
                                     'On-site/Hybrid' source tag satisfy both
                                     hybrid and onsite filters)
   Unknown input falls back to 'any' (never throws, never drops results). */
export function normalizeWorkMode(value) {
  const v = lc(value);
  if (!v || v === 'any' || v === 'all') return 'any';
  if (v === 'remote' || v === 'wfh' || v === 'work from home' || v === 'fully remote') return 'remote';
  if (v === 'on-site/hybrid' || v === 'onsite/hybrid' || v === 'on site/hybrid') return 'hybrid';
  if (v === 'hybrid') return 'hybrid';
  if (v === 'onsite' || v === 'on-site' || v === 'on site' || v === 'office' || v === 'in office' || v === 'in-office') return 'onsite';
  return WORK_MODES.includes(v) ? v : 'any';
}

/* Classify a job's work mode from its own text.
   Returns 'remote' | 'hybrid' | 'onsite' | 'unknown'.
   Priority: hybrid > onsite > remote when multiple signals appear, because
   "hybrid" listings routinely also say "remote" and "office" in the body. */
export function classifyWorkMode(job = {}) {
  const hay = jobHaystack(job);
  if (!hay) return 'unknown';
  if (/\bhybrid\b/.test(hay)) return 'hybrid';
  if (/\bon[\s-]?site\b|\bin[\s-]?office\b|\boffice[\s-]?based\b|\bwork from office\b|\bwfo\b/.test(hay)) return 'onsite';
  if (/\bremote\b|\bwork from home\b|\bwfh\b|\bfully distributed\b|\banywhere\b/.test(hay)) return 'remote';
  return 'unknown';
}

/* Does the job satisfy the requested canonical mode?
   - 'any' matches everything.
   - exact classification match passes.
   - jobs whose ONLY signal is the combined source tag 'On-site/Hybrid'
     classify as... hybrid wins inside classifyWorkMode (the tag contains the
     word "hybrid"), so for an 'onsite' filter we additionally accept jobs
     whose raw mode field is the combined tag — the source asserted the role
     is non-remote without separating the two.
   - 'unknown' classification never matches a specific filter (a job with no
     work-mode signal at all cannot honestly be claimed as remote/hybrid/onsite). */
export function matchesWorkMode(job = {}, mode = 'any') {
  const want = normalizeWorkMode(mode);
  if (want === 'any') return true;
  const got = classifyWorkMode(job);
  if (got === want) return true;
  if (want === 'onsite' && /on[\s-]?site\s*\/\s*hybrid/.test(lc(job.mode))) return true;
  return false;
}

/* -------------------------------------------- experience level ----- */

export function normalizeExperienceLevel(value) {
  const v = lc(value);
  if (!v || v === 'all') return 'any';
  if (v === 'intern' || v === 'trainee') return 'internship';
  if (v === 'fresher' || v === 'entry level' || v === 'entry-level' || v === 'graduate') return 'entry';
  if (v === 'jr' || v === 'jr.') return 'junior';
  if (v === 'mid-level' || v === 'midlevel' || v === 'intermediate') return 'mid';
  if (v === 'sr' || v === 'sr.' || v === 'lead' || v === 'staff' || v === 'principal') return 'senior';
  return EXPERIENCE_LEVELS.includes(v) ? v : 'any';
}

/* Classify from title + description. The TITLE is checked first — a title is
   a far stronger signal than body text ("Senior DevOps Engineer" beats a JD
   that mentions "junior team members").
   Returns 'internship' | 'entry' | 'junior' | 'mid' | 'senior' | 'unknown'. */
export function classifyExperienceLevel(job = {}) {
  const fromText = (text) => {
    if (!text) return null;
    if (/\bintern(ship)?s?\b|\btrainee\b/.test(text)) return 'internship';
    if (/\bfresher\b|\bentry[\s-]?level\b|\bnew\s?grad(uate)?\b|\bgraduate (engineer|trainee|program)\b|\b0\s*[-–to]+\s*1\s*\+?\s*(years?|yrs?)\b/.test(text)) return 'entry';
    if (/\bjunior\b|\bjr\.?\s|\bjr\.?$|\b1\s*[-–to]+\s*3\s*\+?\s*(years?|yrs?)\b/.test(text)) return 'junior';
    if (/\bsenior\b|\bsr\.?\s|\bsr\.?$|\blead\b|\bstaff\b|\bprincipal\b|\barchitect\b|\b(?:[6-9]|1[0-9])\s*\+\s*(years?|yrs?)\b|\b(?:[7-9]|1[0-9])\s*[-–to]+\s*\d+\s*(years?|yrs?)\b/.test(text)) return 'senior';
    if (/\bmid[\s-]?level\b|\bmid[\s-]?senior\b|\b3\s*[-–to]+\s*[4-6]\s*\+?\s*(years?|yrs?)\b|\b[4-6]\s*\+\s*(years?|yrs?)\b/.test(text)) return 'mid';
    return null;
  };
  return fromText(lc(job.title))
    || fromText(lc([job.summary, job.description, job.experienceLevel, job.seniority].filter(Boolean).join('\n')))
    || 'unknown';
}

/* 'any' matches everything; otherwise the classification must match exactly.
   'unknown' is treated as a match for every level EXCEPT 'internship' —
   internships are practically always labelled in the title, so an unlabelled
   job is almost certainly not one; for the other levels, dropping every
   unlabelled listing would silently hide most real jobs. */
export function matchesExperienceLevel(job = {}, level = 'any') {
  const want = normalizeExperienceLevel(level);
  if (want === 'any') return true;
  const got = classifyExperienceLevel(job);
  if (got === want) return true;
  return got === 'unknown' && want !== 'internship';
}

/* ------------------------------------------------- job type -------- */

export function normalizeJobType(value) {
  const v = lc(value);
  if (!v || v === 'all') return 'any';
  if (v === 'fulltime' || v === 'full time' || v === 'permanent' || v === 'fte') return 'full-time';
  if (v === 'intern' || v === 'trainee') return 'internship';
  if (v === 'contractor' || v === 'freelance' || v === 'temporary' || v === 'temp' || v === 'c2c') return 'contract';
  if (v === 'parttime' || v === 'part time') return 'part-time';
  return JOB_TYPES.includes(v) ? v : 'any';
}

export function classifyJobType(job = {}) {
  const hay = jobHaystack(job);
  if (!hay) return 'unknown';
  if (/\bintern(ship)?s?\b|\btrainee\b/.test(hay)) return 'internship';
  if (/\bcontract(or)?\b|\bfreelance\b|\btemporary\b|\bc2c\b|\bcorp[\s-]?to[\s-]?corp\b/.test(hay)) return 'contract';
  if (/\bpart[\s-]?time\b/.test(hay)) return 'part-time';
  if (/\bfull[\s-]?time\b|\bpermanent\b|\bfte\b/.test(hay)) return 'full-time';
  return 'unknown';
}

/* Same philosophy as experience: 'unknown' matches everything except the
   explicitly-labelled categories internship and part-time; the overwhelming
   default for unlabelled listings is a full-time/contract opening. */
export function matchesJobType(job = {}, type = 'any') {
  const want = normalizeJobType(type);
  if (want === 'any') return true;
  const got = classifyJobType(job);
  if (got === want) return true;
  return got === 'unknown' && (want === 'full-time' || want === 'contract');
}

export default {
  WORK_MODES, EXPERIENCE_LEVELS, JOB_TYPES,
  normalizeWorkMode, classifyWorkMode, matchesWorkMode,
  normalizeExperienceLevel, classifyExperienceLevel, matchesExperienceLevel,
  normalizeJobType, classifyJobType, matchesJobType,
};
