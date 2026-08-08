/* ============================================================
   TEAM PROGRESS ENGINE  —  pure, deterministic, no AI, no network.
   ------------------------------------------------------------
   Answers the review: "Assigned projects progress can't be seen
   for individually."

   Today the team-project record stores ONE team-level submission
   ({ liveUrl, repoUrl, notes }) and summarizeAssignment() returns
   one team-level status. Nothing anywhere in the codebase tracks
   what an individual student actually did — grep for
   memberProgress / moduleStatus / perMember returns zero hits.

   assignRoles() already hands every member a `modules` array,
   described in that file as "the concrete, checkable deliverables
   this person owns". This engine gives those modules state, and
   derives a per-member percentage from EVIDENCE rather than from
   self-report.

   DESIGN RULES (consistent with proofVerification.js):
     1. A module ticked with no evidence URL is worth LESS than one
        with evidence. A placement cell cannot grade on self-report.
     2. Three outcomes, never two: verified / claimed / unavailable.
        A GitHub rate-limit is "unavailable" and must never look
        like a student did nothing.
     3. The percentage is DERIVED on every read and never stored as
        truth. Stored state is only what was observed.
     4. Contribution imbalance is reported, not judged. The engine
        flags it; the coordinator decides what it means.
   ============================================================ */

export const MODULE_STATES = ['todo', 'in_progress', 'done'];

/* Weights. Evidence-backed work dominates deliberately: a team where
   everyone ticked every box but only one person committed should NOT
   read as evenly distributed. */
export const WEIGHTS = {
  moduleWithEvidence: 1.0,   // marked done AND has a reachable evidence URL
  moduleClaimed: 0.4,        // marked done, no evidence attached
  moduleInProgress: 0.15,    // started, honest partial credit
  commitSignal: 0.25,        // share of the member score that commit history can carry
};

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());

/* ---------------------------------------------------------------- */
/* Normalisation                                                     */
/* ---------------------------------------------------------------- */

/**
 * Build the empty progress skeleton for a freshly-assigned project.
 * Called once at assign time so every member has a row from day one —
 * an absent row and a zero row mean different things to a coordinator.
 */
export function initMemberProgress(brief = {}) {
  const out = {};
  for (const a of brief.assignments || []) {
    const modules = {};
    for (const name of a.modules || []) {
      modules[name] = { status: 'todo', evidenceUrl: '', note: '', updatedAt: null };
    }
    out[String(a.studentId)] = {
      studentId: String(a.studentId),
      role: a.role || 'Contributor',
      area: a.area || '',
      modules,
      commits: { count: 0, lastCommitAt: null, login: '', checkedAt: null, unavailable: true },
      lastActiveAt: null,
    };
  }
  return out;
}

/** Merge a stored progress map against the current brief — assignments can be
    re-generated, so modules are added/removed without losing existing state. */
export function reconcileProgress(stored = {}, brief = {}) {
  const fresh = initMemberProgress(brief);
  const out = {};
  for (const [studentId, blank] of Object.entries(fresh)) {
    const prev = stored[studentId] || {};
    const modules = {};
    for (const [name, def] of Object.entries(blank.modules)) {
      modules[name] = prev.modules?.[name] ? { ...def, ...prev.modules[name] } : def;
    }
    out[studentId] = {
      ...blank,
      ...prev,
      modules,
      commits: { ...blank.commits, ...(prev.commits || {}) },
    };
  }
  return out;
}

/* ---------------------------------------------------------------- */
/* Scoring                                                           */
/* ---------------------------------------------------------------- */

/** Raw module points for one member, before commit blending. */
export function scoreModules(memberRow = {}) {
  const entries = Object.entries(memberRow.modules || {});
  if (!entries.length) return { earned: 0, possible: 0, percent: 0, done: 0, withEvidence: 0, total: 0 };

  let earned = 0;
  let done = 0;
  let withEvidence = 0;

  for (const [, m] of entries) {
    if (m.status === 'done') {
      done += 1;
      if (isUrl(m.evidenceUrl)) { earned += WEIGHTS.moduleWithEvidence; withEvidence += 1; }
      else earned += WEIGHTS.moduleClaimed;
    } else if (m.status === 'in_progress') {
      earned += WEIGHTS.moduleInProgress;
    }
  }

  const possible = entries.length * WEIGHTS.moduleWithEvidence;
  return {
    earned: Number(earned.toFixed(3)),
    possible,
    percent: clamp((earned / possible) * 100),
    done,
    withEvidence,
    total: entries.length,
  };
}

/**
 * Blend module progress with commit evidence.
 * commitShare = this member's commits / the team's busiest member's commits.
 * If commit data is unavailable (rate limit, private repo, no repo yet) the
 * commit term is DROPPED and modules carry the full weight — never scored as
 * zero, which would punish a student for our infrastructure.
 */
export function scoreMember(memberRow = {}, { maxCommits = 0 } = {}) {
  const mods = scoreModules(memberRow);
  const commits = memberRow.commits || {};
  const commitsUsable = !commits.unavailable && Number(maxCommits) > 0;

  let percent = mods.percent;
  if (commitsUsable) {
    const share = clamp((Number(commits.count || 0) / maxCommits) * 100);
    percent = clamp(mods.percent * (1 - WEIGHTS.commitSignal) + share * WEIGHTS.commitSignal);
  }

  const evidenceQuality = mods.done === 0
    ? 'none'
    : mods.withEvidence === mods.done ? 'evidenced'
      : mods.withEvidence > 0 ? 'partial' : 'self_reported';

  return {
    studentId: memberRow.studentId || '',
    role: memberRow.role || '',
    area: memberRow.area || '',
    percent,
    modules: mods,
    commits: {
      count: Number(commits.count || 0),
      lastCommitAt: commits.lastCommitAt || null,
      unavailable: !!commits.unavailable,
      login: commits.login || '',
    },
    evidenceQuality,
    /* Stated plainly so a coordinator reading the row knows what it rests on. */
    basis: commitsUsable
      ? 'modules + repository commit history'
      : commits.unavailable
        ? 'modules only — commit history could not be read'
        : 'modules only — no commit history yet',
    lastActiveAt: memberRow.lastActiveAt || commits.lastCommitAt || null,
  };
}

/* ---------------------------------------------------------------- */
/* Team roll-up                                                      */
/* ---------------------------------------------------------------- */

/**
 * The thing the coordinator dashboard renders.
 * Returns per-member rows plus the imbalance signal that is the actual
 * reason a placement cell wants individual visibility at all.
 */
export function summarizeTeamProgress(project = {}) {
  const progress = reconcileProgress(project.memberProgress || {}, project.brief || {});
  const rows = Object.values(progress);

  const commitCounts = rows
    .filter((r) => !r.commits?.unavailable)
    .map((r) => Number(r.commits?.count || 0));
  const maxCommits = commitCounts.length ? Math.max(...commitCounts) : 0;
  const totalCommits = commitCounts.reduce((a, b) => a + b, 0);

  const nameById = new Map((project.members || []).map((m) => [String(m.studentId), m.name || 'Student']));
  const members = rows
    .map((r) => ({ ...scoreMember(r, { maxCommits }), name: nameById.get(String(r.studentId)) || 'Student' }))
    .sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));

  const percents = members.map((m) => m.percent);
  const teamPercent = percents.length ? clamp(percents.reduce((a, b) => a + b, 0) / percents.length) : 0;
  const spread = percents.length ? Math.max(...percents) - Math.min(...percents) : 0;

  /* Imbalance flags. These are the single most useful output here: they are
     what turns "Team Alpha: submitted" into an actionable conversation. */
  const flags = [];
  for (const m of members) {
    if (totalCommits > 0 && !m.commits.unavailable) {
      const share = (m.commits.count / totalCommits) * 100;
      if (share >= 60 && members.length > 2) {
        flags.push({ studentId: m.studentId, name: m.name, level: 'warn', code: 'carrying_team',
          message: `${m.name} authored ${Math.round(share)}% of the team's commits.` });
      }
      if (share < 10) {
        flags.push({ studentId: m.studentId, name: m.name, level: 'warn', code: 'low_contribution',
          message: `${m.name} has ${Math.round(share)}% of the team's commits (${m.commits.count}).` });
      }
    }
    if (m.evidenceQuality === 'self_reported' && m.modules.done > 0) {
      flags.push({ studentId: m.studentId, name: m.name, level: 'info', code: 'no_evidence',
        message: `${m.name} marked ${m.modules.done} module${m.modules.done === 1 ? '' : 's'} done with no evidence link.` });
    }
    if (m.percent === 0 && m.modules.total > 0) {
      flags.push({ studentId: m.studentId, name: m.name, level: 'warn', code: 'not_started',
        message: `${m.name} has not started any assigned module.` });
    }
  }
  if (spread >= 50 && members.length > 2) {
    flags.push({ studentId: '', name: '', level: 'warn', code: 'uneven_team',
      message: `${spread} point gap between the highest and lowest contributor.` });
  }

  return {
    teamPercent,
    spread,
    members,
    flags,
    totalCommits,
    commitDataAvailable: commitCounts.length > 0,
    memberCount: members.length,
    modulesDone: members.reduce((n, m) => n + m.modules.done, 0),
    modulesTotal: members.reduce((n, m) => n + m.modules.total, 0),
    computedAt: new Date().toISOString(),
    engine: 'deterministic-v1',
  };
}

/* ---------------------------------------------------------------- */
/* Writes                                                            */
/* ---------------------------------------------------------------- */

/**
 * Apply one student's module update. Returns the FULL new memberProgress map
 * so the caller can hand it straight to db.updateTeamProject as a patch.
 * Rejects updates to a module the student does not own — a student cannot
 * tick a teammate's deliverable.
 */
export function applyModuleUpdate(project = {}, { studentId, moduleName, status, evidenceUrl, note } = {}) {
  const progress = reconcileProgress(project.memberProgress || {}, project.brief || {});
  const row = progress[String(studentId)];
  if (!row) return { ok: false, reason: 'not_a_member' };
  if (!Object.prototype.hasOwnProperty.call(row.modules, moduleName)) {
    return { ok: false, reason: 'module_not_owned' };
  }
  if (status && !MODULE_STATES.includes(status)) return { ok: false, reason: 'bad_status' };
  if (evidenceUrl && !isUrl(evidenceUrl)) return { ok: false, reason: 'bad_evidence_url' };

  const now = new Date().toISOString();
  row.modules[moduleName] = {
    ...row.modules[moduleName],
    ...(status ? { status } : {}),
    ...(evidenceUrl !== undefined ? { evidenceUrl: String(evidenceUrl || '').trim() } : {}),
    ...(note !== undefined ? { note: String(note || '').slice(0, 500) } : {}),
    updatedAt: now,
  };
  row.lastActiveAt = now;
  progress[String(studentId)] = row;
  return { ok: true, memberProgress: progress };
}

/**
 * Merge freshly-read GitHub contributor stats into the progress map.
 * `contributors` is [{ login, count, lastCommitAt }]. `matchMember` maps a
 * GitHub login to a studentId — pass the resolver from the route so this file
 * stays free of DB access.
 */
export function applyCommitStats(project = {}, contributors = [], matchMember = () => null, { unavailable = false } = {}) {
  const progress = reconcileProgress(project.memberProgress || {}, project.brief || {});
  const now = new Date().toISOString();

  if (unavailable) {
    for (const row of Object.values(progress)) {
      row.commits = { ...row.commits, unavailable: true, checkedAt: now };
    }
    return { ok: true, memberProgress: progress, matched: 0, unmatched: [] };
  }

  /* Reset counts before applying: a member who no longer appears in the
     contributor list genuinely has zero, and a stale count would hide that. */
  for (const row of Object.values(progress)) {
    row.commits = { count: 0, lastCommitAt: null, login: row.commits?.login || '', checkedAt: now, unavailable: false };
  }

  let matched = 0;
  const unmatched = [];
  for (const c of contributors) {
    const studentId = matchMember(c);
    if (!studentId || !progress[String(studentId)]) { unmatched.push(c.login); continue; }
    const row = progress[String(studentId)];
    row.commits = {
      count: Number(c.count || 0),
      lastCommitAt: c.lastCommitAt || null,
      login: c.login || '',
      checkedAt: now,
      unavailable: false,
    };
    if (c.lastCommitAt && (!row.lastActiveAt || c.lastCommitAt > row.lastActiveAt)) row.lastActiveAt = c.lastCommitAt;
    matched += 1;
  }
  return { ok: true, memberProgress: progress, matched, unmatched };
}

export default {
  MODULE_STATES, WEIGHTS,
  initMemberProgress, reconcileProgress,
  scoreModules, scoreMember, summarizeTeamProgress,
  applyModuleUpdate, applyCommitStats,
};
