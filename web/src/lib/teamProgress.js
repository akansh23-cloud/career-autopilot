/* ============================================================
   teamProgress.js — API client for per-member team progress.
   ------------------------------------------------------------
   Kept in its own module rather than appended to lib/api.js so
   this ships as a new file, not a diff to a shared one. It reuses
   the same `api` wrapper, so CSRF, credentials and the quota
   headers all behave identically.

   If you prefer them inline, move these into the College and My
   sections of lib/api.js — the call signatures are unchanged.
   ============================================================ */
import { api } from './api.js';

const id = (v) => encodeURIComponent(String(v || ''));

/* ---- Coordinator (college_admin | admin) ---- */
export const CollegeTeamProgress = {
  /** Per-member breakdown + imbalance flags for one team project. */
  get: (projectId) => api.get(`/api/college/team-projects/${id(projectId)}/progress`),

  /** Re-read commit attribution from the team's repository.
      Returns { unavailable, matched, unmatchedLogins, progress } — `unavailable`
      is a real third state and MUST NOT be rendered as zero contribution. */
  syncCommits: (projectId) => api.post(`/api/college/team-projects/${id(projectId)}/sync-commits`, {}),

  /** Map an unmatched GitHub login to a student, then re-sync. */
  linkGithub: (projectId, studentId, login) =>
    api.post(`/api/college/team-projects/${id(projectId)}/link-github`, { studentId, login }),
};

/* ---- Student (self only) ---- */
export const MyTeamProgress = {
  /** { me, team } — own detail plus the team roll-up (flags stripped server-side). */
  get: (projectId) => api.get(`/api/my/team-projects/${id(projectId)}/progress`),

  /** Update one module the student owns. Attempting a teammate's module is
      rejected server-side with `module_not_owned`. */
  setModule: (projectId, moduleName, patch) =>
    api.patch(`/api/my/team-projects/${id(projectId)}/modules/${id(moduleName)}`, patch),
};

/* ---- Presentation helpers (pure) ---- */

export const EVIDENCE_LABEL = {
  evidenced: 'All completed modules have evidence',
  partial: 'Some completed modules have no evidence',
  self_reported: 'Completed modules are self-reported only',
  none: 'Nothing completed yet',
};

export const FLAG_TONE = {
  carrying_team: 'warn',
  low_contribution: 'warn',
  not_started: 'warn',
  uneven_team: 'warn',
  no_evidence: 'info',
};

/** Colour band for a percentage. Deliberately conservative: a self-reported
    90% should not look the same as an evidenced 90%. */
export function progressTone(member) {
  if (!member) return 'muted';
  if (member.evidenceQuality === 'self_reported') return 'caution';
  if (member.percent >= 70) return 'good';
  if (member.percent >= 35) return 'caution';
  return 'low';
}

export default { CollegeTeamProgress, MyTeamProgress, EVIDENCE_LABEL, FLAG_TONE, progressTone };
