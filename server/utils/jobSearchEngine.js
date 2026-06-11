/* ============================================================
   JOB SEARCH ENGINE v2 — pure, deterministic, unit-testable.
   ------------------------------------------------------------
   Fixes the chronic "No matching jobs found" problem. The old
   pipeline dropped jobs at the first failing filter and gave up;
   one strict freshness window or a batch of undated jobs could
   empty the entire result set with no explanation.

   v2 behaviour:
   1. Gate jobs once per criteria set, counting exactly WHY each
      job was removed (freshness/location/role/work mode/
      experience/job type/invalid/duplicate).
   2. If too few jobs survive, progressively relax criteria
      through the documented FALLBACK_STEPS instead of returning
      an empty list.
   3. Return the fallback level used + removal counts so the UI
      can explain the results ("0 exact verified jobs — showing
      18 broader source-listed jobs…").

   The engine takes injected matcher helpers so it stays free of
   server.js and runs under `node --test`.
   ============================================================ */

/* Filter modes:
   - inclusive (default): unknown seniority/job-type/date are kept when the
     classifier has low confidence — empty results are worse than a few
     loosely-matched jobs.
   - strict: only confidently matched jobs pass; undated jobs are excluded
     from bounded freshness windows. */
export const FILTER_MODES = ['inclusive', 'strict'];
export function normalizeFilterMode(v) {
  return String(v || '').toLowerCase() === 'strict' ? 'strict' : 'inclusive';
}

/* Progressive relaxation ladder. Step 0 = the user's exact request.
   `relax` describes what each step changes RELATIVE to the base criteria. */
export const FALLBACK_STEPS = [
  { level: 0, group: 'exact',          label: 'Exact matches',
    relax: {} },
  { level: 1, group: 'broader-fresh',  label: 'Broader matches (30-day window)',
    relax: { freshness: '30d' } },
  { level: 2, group: 'source-listed',  label: 'Source-listed matches (any date)',
    relax: { freshness: 'latest', includeUndated: true, sourceListed: true } },
  { level: 3, group: 'broader-role',   label: 'Broader role matches (any date)',
    relax: { freshness: 'latest', includeUndated: true, sourceListed: true, broadRole: true } },
  { level: 4, group: 'broader-global', label: 'Broader fallback matches (remote/global)',
    relax: { freshness: 'latest', includeUndated: true, sourceListed: true, broadRole: true, anyLocation: true, anyMode: true } },
];

/* Never relax freshness to something TIGHTER than the user already chose. */
function effectiveFreshness(baseFreshness, stepFreshness, maxDaysOf) {
  if (!stepFreshness) return baseFreshness;
  const base = maxDaysOf(baseFreshness);
  const step = maxDaysOf(stepFreshness);
  return step >= base ? stepFreshness : baseFreshness;
}

/* --------------------------- broad role matching --------------------------- */

const ROLE_QUALIFIERS = new Set([
  'senior', 'junior', 'jr', 'sr', 'lead', 'staff', 'principal', 'associate',
  'entry', 'level', 'mid', 'midlevel', 'fresher', 'intern', 'trainee',
  'i', 'ii', 'iii', 'iv', '1', '2', '3',
]);
const ROLE_SYNONYMS = {
  developer: ['developer', 'engineer', 'programmer', 'dev'],
  engineer: ['engineer', 'developer', 'programmer', 'dev'],
  analyst: ['analyst', 'analytics'],
  devops: ['devops', 'sre', 'platform', 'infrastructure'],
  data: ['data', 'analytics', 'etl'],
};

function normTokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').split(/\s+/).filter(Boolean);
}

/** Core role tokens with seniority qualifiers stripped ("Senior Java Developer" -> ['java','developer']). */
export function broadenRoleTokens(role) {
  const core = normTokens(role).filter((t) => !ROLE_QUALIFIERS.has(t));
  const out = new Set();
  for (const t of core) {
    out.add(t);
    for (const syn of ROLE_SYNONYMS[t] || []) out.add(syn);
  }
  return [...out];
}

/** Broad role match: ANY core token (or synonym) appears in title/summary/skills. */
export function broadRoleMatch(job = {}, role = '') {
  const tokens = broadenRoleTokens(role);
  if (!tokens.length) return true;
  const hay = ` ${normTokens(`${job.title} ${job.summary} ${(job.requiredSkills || []).join(' ')}`).join(' ')} `;
  return tokens.some((t) => hay.includes(` ${t} `));
}

/* -------------------------------- gating -------------------------------- */

export const REMOVAL_KEYS = [
  'invalid', 'freshness', 'role', 'location', 'workMode', 'experience', 'jobType', 'duplicate',
];

/**
 * Gate one pass of jobs against one criteria set.
 * criteria: { role, location, mode, experience, jobType, freshness, filterMode,
 *             includeUndated, broadRole, anyLocation, anyMode }
 * helpers:  { passesFreshness, matchRole, matchLocation, matchesWorkMode,
 *             matchesExperienceLevel, matchesJobType, jobKey }
 * Returns { candidates, removed, audit } — `removed` is a per-cause count map,
 * `audit` one row per job (decision + reason).
 */
export function gateJobs(jobs = [], criteria = {}, helpers = {}) {
  const {
    passesFreshness, matchRole, matchLocation,
    matchesWorkMode, matchesExperienceLevel, matchesJobType, jobKey,
  } = helpers;
  const strict = normalizeFilterMode(criteria.filterMode) === 'strict';
  const removed = Object.fromEntries(REMOVAL_KEYS.map((k) => [k, 0]));
  const seen = new Set();
  const candidates = [];
  const audit = [];

  for (const j of jobs) {
    let reason = ''; let cause = '';
    const hasDate = typeof j.postedDays === 'number' && Number.isFinite(j.postedDays);

    if (!j.title || !j.company) { reason = 'missing title/company'; cause = 'invalid'; }
    else if (!j.url || !/^https?:\/\//i.test(j.url)) { reason = 'missing direct job URL'; cause = 'invalid'; }
    else {
      if (!hasDate) j.dateUnknown = true; // "date unavailable" label for the UI
      const fr = passesFreshness(hasDate ? j.postedDays : null, criteria.freshness);
      if (!fr.ok) {
        // Undated jobs: hard-excluded only in strict mode. In inclusive mode
        // (or any fallback step with includeUndated) they pass, labelled.
        const undatedException = !hasDate && (criteria.includeUndated || !strict);
        if (!undatedException) { reason = fr.reason; cause = 'freshness'; }
      }
      if (!reason) {
        const roleOk = criteria.broadRole ? broadRoleMatch(j, criteria.role) : matchRole(j, criteria.role);
        if (!roleOk) { reason = criteria.broadRole ? 'no role-token overlap' : 'role mismatch'; cause = 'role'; }
        else if (!criteria.anyLocation && !matchLocation(j, criteria.location)) { reason = 'location mismatch'; cause = 'location'; }
        else if (!criteria.anyMode && !matchesWorkMode(j, criteria.mode)) { reason = `work mode mismatch (filter: ${criteria.mode})`; cause = 'workMode'; }
        else if (!matchesExperienceLevel(j, criteria.experience)) { reason = `experience level mismatch (filter: ${criteria.experience})`; cause = 'experience'; }
        else if (!matchesJobType(j, criteria.jobType)) { reason = `job type mismatch (filter: ${criteria.jobType})`; cause = 'jobType'; }
      }
    }
    const k = jobKey(j);
    if (!reason && seen.has(k)) { reason = 'duplicate'; cause = 'duplicate'; }

    const row = {
      title: j.title || '—', company: j.company || '—', source: j.source || '—',
      postedDate: j.postedDate || '(none)', ageDays: hasDate ? j.postedDays : 'unknown',
      decision: reason ? 'EXCLUDED' : 'CANDIDATE',
      reason: reason || 'passed filters; pending URL verification',
    };
    audit.push(row);
    if (!reason) { seen.add(k); j._auditRow = row; candidates.push(j); }
    else removed[cause] = (removed[cause] || 0) + 1;
  }
  return { candidates, removed, audit };
}

/* ------------------------------- ranking -------------------------------- */

/** Deterministic rank: fresher + exact-role + dated + reliable source first. */
export function rankJobs(jobs = [], criteria = {}, helpers = {}) {
  const score = (j) => {
    let s = 0;
    const hasDate = typeof j.postedDays === 'number' && Number.isFinite(j.postedDays);
    if (hasDate) s += Math.max(0, 30 - Math.min(30, j.postedDays)); // newer = higher
    else s -= 5;
    if (helpers.matchRole ? helpers.matchRole(j, criteria.role) : true) s += 12;
    if (j.verified) s += 8;
    if (j.verifyLevel === 'live') s += 4;
    if (j.providerBacked) s += 2;
    return s;
  };
  return [...jobs].sort((a, b) => score(b) - score(a));
}

/* --------------------------- progressive search -------------------------- */

/**
 * Run the fallback ladder until at least `minResults` candidates survive or
 * the ladder is exhausted. Always evaluates step 0 first; its removal counts
 * are reported as the "why your exact search was empty" diagnostics.
 *
 * extraHelpers.maxDaysOf — maps a freshness token to max days (used so a
 * relaxation step never tightens a user-chosen window).
 *
 * Returns { candidates, step, baseRemoved, baseCount, audit, attempts }.
 */
export function progressiveGate(jobs = [], baseCriteria = {}, helpers = {}, { minResults = 1, maxLevel = 4 } = {}) {
  const maxDaysOf = helpers.maxDaysOf || (() => Infinity);
  let base = null;
  const attempts = [];
  for (const step of FALLBACK_STEPS) {
    if (step.level > maxLevel) break;
    const criteria = {
      ...baseCriteria,
      ...step.relax,
      freshness: effectiveFreshness(baseCriteria.freshness, step.relax.freshness, maxDaysOf),
      role: baseCriteria.role,
    };
    // gateJobs mutates audit-row helpers on the job objects; pass shallow copies
    const pass = gateJobs(jobs.map((j) => ({ ...j })), criteria, helpers);
    attempts.push({ level: step.level, group: step.group, label: step.label, count: pass.candidates.length });
    if (step.level === 0) { base = pass; }
    if (pass.candidates.length >= minResults) {
      return {
        candidates: pass.candidates,
        step,
        baseRemoved: base.removed,
        baseCount: base.candidates.length,
        audit: pass.audit,
        attempts,
      };
    }
  }
  // every step failed — return the base pass so diagnostics still explain why
  return { candidates: [], step: FALLBACK_STEPS[Math.min(maxLevel, FALLBACK_STEPS.length - 1)], baseRemoved: base.removed, baseCount: base.candidates.length, audit: base.audit, attempts };
}

/* ------------------------------ explanation ----------------------------- */

const REMOVAL_LABELS = {
  freshness: 'freshness', location: 'location', role: 'role match',
  workMode: 'work mode', experience: 'experience level', jobType: 'job type',
  verification: 'link verification', invalid: 'missing data', duplicate: 'duplicates',
};

/** One concise sentence the UI shows above fallback results. */
export function summarizeSearch({ baseCount = 0, shownCount = 0, fallbackLevel = 0, fallbackLabel = '', removed = {}, verifiedRemoved = 0 } = {}) {
  if (fallbackLevel === 0 && shownCount > 0) return '';
  const causes = Object.entries({ ...removed, verification: verifiedRemoved })
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => REMOVAL_LABELS[k] || k);
  const why = causes.length ? ` Most exact jobs were removed by ${causes.join(' and ')} filters.` : '';
  if (shownCount === 0) return `0 jobs found even after relaxing filters (freshness, role breadth, location).${why}`;
  return `${baseCount} exact match${baseCount === 1 ? '' : 'es'} found. Showing ${shownCount} ${fallbackLabel.toLowerCase()}.${why}`;
}

export default {
  FILTER_MODES, normalizeFilterMode, FALLBACK_STEPS, REMOVAL_KEYS,
  broadenRoleTokens, broadRoleMatch, gateJobs, rankJobs, progressiveGate, summarizeSearch,
};
