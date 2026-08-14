// ============================================================
// Centralized RBAC / capability control (single source of truth).
// ------------------------------------------------------------
// One place that answers "which SCREENS and ACTIONS may THIS user
// see/use?" based purely on their effective role. Every UI surface
// (top nav, mobile nav, command palette, dashboard cards, quick
// actions, page CTAs, internal navigate() calls) reads from here so
// wrong-role options never render in the normal UX. AccessDenied / a
// minimal fallback is only ever a backstop for direct URL/hash
// tampering — it is NOT the normal experience.
//
// IMPORTANT non-removal guarantee: this module only ever HIDES screens
// for the narrowed `student_early` stage and tightens the previously
// unscoped `college_admin` persona. Every screen a student (year 3–4),
// professional, recruiter or admin can reach today stays reachable —
// `student_placement` is defined as the full student/professional
// surface so nothing existing is removed.
//
// The backend (server.js requireRole/requireAdmin/...) remains the real
// authority for privileged data; this layer keeps the UI honest and
// drives default landings + the unauthorized fallback.
// ============================================================

import { getPlan } from './plan.js';
import { getProfile } from './userProfile.js';
import { getAccessContext } from './accessContext.js';

export const EFFECTIVE_ROLES = [
  'student_early',
  'student_placement',
  'recruiter',
  'college_admin',
  'recruiter_unverified',
  'college_admin_unverified',
  'admin',
];

export const EFFECTIVE_ROLE_LABELS = {
  student_early: 'Student (Year 1–2)',
  student_placement: 'Student / Professional (Placement)',
  recruiter: 'Recruiter',
  college_admin: 'College / Placement Cell',
  recruiter_unverified: 'Recruiter verification pending',
  college_admin_unverified: 'Placement-cell verification pending',
  admin: 'Admin',
};

// ------------------------------------------------------------
// SCREEN SETS — keyed by EFFECTIVE role, valued by the real in-app
// view ids used by App.jsx VIEWS / Shell NAV / navigate().
// (Spec screen ids like 'project-os' are accepted too via SCREEN_ALIASES.)
// ------------------------------------------------------------

// Year 1–2 students: build-only surface. No résumé / jobs / tracker /
// applications / readiness / referral / arena yet (stage-gated, not removed).
const STUDENT_EARLY_SCREENS = [
  'dash',
  'careerprofile',
  'skillsxp',
  'projectstudio',     // project-os
  'projectcreator',    // project-creator
  'projectbuilder',    // sub-surface of project-os
  'projectworkspace',  // sub-surface of project-os
  'architecture',      // architecture-generator
  'marketplace',       // project-marketplace
  'inspirations',      // live-inspirations
  'sandbox',           // project-sandbox
  'partners',          // find-project-partner
  'teamproject',       // placement-cell team assignment (student side)
  'leaderboards',
  'settings',
];

// Placement-ready students (year 3–4) AND working professionals.
// Defined as the FULL student/professional surface so nothing currently
// visible to those personas is ever removed. (Everything except the
// recruiter console and the admin user directory.)
const STUDENT_PLACEMENT_SCREENS = [
  ...STUDENT_EARLY_SCREENS,
  'readiness',
  'studio',            // resume-studio (Resume OS V3 canonical workspace)
  'resume',            // resume / resume-os
  'editor',            // resume-editor
  'applications',      // application-package
  'jobs',
  'tracker',           // application-tracker
  'contacts',          // outreach (kept for professionals)
  'referralexchange',  // referral-exchange
  'opportunities',     // opportunity-arena
  // Patent / innovation stack — kept as advanced/optional (already present).
  'innovation',
  'patents',
  'patentgenerate',
  'patentportfolio',
  'patentworkspace',
  'priorart',
  'patentdisclosures',
  'growth',
];

// Recruiters: exactly the recruiter-safe surface from the spec. No student
// creation/editing tools, no project marketplace, no admin analytics.
const RECRUITER_SCREENS = [
  'dash',           // recruiter-dashboard (RoleDashboard → RecruiterDashboard)
  'recruiter',      // recruiter-console / candidate-search / shortlists / saved-searches
  'careerprofile',  // candidate-profile viewing + own profile
  'leaderboards',   // talent-leaderboards
  'sandbox',        // verified-project-proof browsing
  'settings',
];

// College / placement cell: verified placement-cell workspace. The spec
// analytics screens resolve to the real CollegeWorkspace, not dashboard.
const COLLEGE_ADMIN_SCREENS = [
  'college',        // real placement-cell workspace (directory / readiness / analytics / drives / reports)
  'sandbox',        // verified-projects browsing
  'careerprofile',
  'settings',
];

export const SCREEN_SETS = {
  student_early: new Set(STUDENT_EARLY_SCREENS),
  student_placement: new Set(STUDENT_PLACEMENT_SCREENS),
  recruiter: new Set(RECRUITER_SCREENS),
  college_admin: new Set(COLLEGE_ADMIN_SCREENS),
  recruiter_unverified: new Set(['verification', 'settings']),
  college_admin_unverified: new Set(['verification', 'settings']),
  // admin → everything (handled by short-circuit in canSeeScreen).
  admin: null,
};

// Screens any authenticated user may always reach (utility surfaces).
// 'support' is a widget, not a routed view, but we treat it as allowed.
const ALWAYS_ALLOWED_SCREENS = new Set(['settings', 'support']);

// Spec screen-id → real in-app view id. Identity entries for real ids are
// added programmatically below. Anything unmapped resolves to itself.
const SPEC_SCREEN_ALIASES = {
  dashboard: 'dash',
  profile: 'careerprofile',
  'career-profile': 'careerprofile',
  skills: 'skillsxp',
  xp: 'skillsxp',
  'skills/xp': 'skillsxp',
  'project-os': 'projectstudio',
  'project-creator': 'projectcreator',
  'architecture-generator': 'architecture',
  'project-marketplace': 'marketplace',
  'live-inspirations': 'inspirations',
  'project-sandbox': 'sandbox',
  'find-project-partner': 'partners',
  'resume-os': 'resume',
  'resume/resume-os': 'resume',
  'resume-editor': 'editor',
  'application-package': 'applications',
  'application-tracker': 'tracker',
  'referral-exchange': 'referralexchange',
  'opportunity-arena': 'opportunities',
  patent: 'patents',
  'patent/prior-art': 'priorart',
  'prior-art': 'priorart',
  outreach: 'contacts',
  verification: 'verification',
  'verification-status': 'verification',
  // Recruiter spec screens → real views
  'recruiter-dashboard': 'dash',
  'recruiter-console': 'recruiter',
  'candidate-search': 'recruiter',
  'candidate-profile': 'careerprofile',
  'verified-project-proof': 'sandbox',
  shortlists: 'recruiter',
  'talent-leaderboards': 'leaderboards',
  'saved-searches': 'recruiter',
  // College spec screens → the REAL placement-cell workspace ('college'), which
  // renders each as a section (directory / readiness / analytics / drives /
  // reports) backed by scoped /api/college data — not faked onto the dashboard.
  'college-dashboard': 'college',
  'student-directory': 'college',
  'placement-readiness': 'college',
  'skill-heatmap': 'college',
  'batch-analytics': 'college',
  'branch-analytics': 'college',
  'resume-readiness': 'college',
  'drive-tracker': 'college',
  'company-drives': 'college',
  reports: 'college',
  'verified-projects': 'sandbox',
  // Admin
  'admin-dashboard': 'adminusers',
  'user-directory': 'adminusers',
  'job-discovery-admin': 'adminjobs',
};

export function resolveScreenId(screenId) {
  if (screenId == null) return screenId;
  const id = String(screenId).trim();
  if (Object.prototype.hasOwnProperty.call(SPEC_SCREEN_ALIASES, id)) return SPEC_SCREEN_ALIASES[id];
  // Legacy alias: the old standalone Profile view is now Career Profile.
  if (id === 'profile') return 'careerprofile';
  return id;
}

// ------------------------------------------------------------
// ACTION SETS — keyed by EFFECTIVE role.
// ------------------------------------------------------------
const STUDENT_EARLY_ACTIONS = [
  'create_project', 'continue_project', 'build_architecture', 'generate_roadmap',
  'download_starter_pack', 'add_github_link', 'add_live_demo_link',
  'submit_project_verification', 'improve_project_proof',
  'view_skills', 'improve_skill', 'verify_skill',
  'find_partner', 'view_leaderboard',
];

const STUDENT_PLACEMENT_ACTIONS = [
  ...STUDENT_EARLY_ACTIONS,
  'upload_resume', 'analyze_resume', 'improve_ats_score', 'tailor_resume',
  'export_resume_pdf', 'export_resume_docx', 'generate_cover_letter',
  'generate_recruiter_message', 'search_jobs', 'save_job', 'apply_job',
  'add_to_tracker', 'update_tracker_status', 'remove_from_tracker',
  'view_job_match', 'generate_application_package', 'improve_readiness_score',
];

const RECRUITER_ACTIONS = [
  'search_candidates', 'filter_candidates', 'view_candidate', 'view_resume',
  'view_verified_projects', 'view_github_proof', 'view_live_demo',
  'shortlist_candidate', 'request_contact', 'request_introduction',
  'add_recruiter_note', 'create_saved_search', 'view_top_verified_talent',
];

const COLLEGE_ADMIN_ACTIONS = [
  'view_college_students', 'filter_by_batch', 'filter_by_branch', 'filter_by_year',
  'filter_by_skill', 'filter_by_readiness', 'filter_by_resume_score',
  'filter_by_project_verification', 'view_student_profile_scoped',
  'export_selected_students', 'view_skill_gaps', 'view_resume_scores',
  'view_verified_projects', 'create_placement_drive', 'set_eligibility_criteria',
  'shortlist_eligible_students', 'export_report', 'notify_students',
  'assign_improvement_task',
];

export const ACTION_SETS = {
  student_early: new Set(STUDENT_EARLY_ACTIONS),
  student_placement: new Set(STUDENT_PLACEMENT_ACTIONS),
  recruiter: new Set(RECRUITER_ACTIONS),
  college_admin: new Set(COLLEGE_ADMIN_ACTIONS),
  admin: null, // everything
};

// Every action id mentioned anywhere. An action id NOT in this set is
// considered "ungated" and is allowed for everyone (so we never silently
// break an existing button that predates this RBAC layer).
const ALL_KNOWN_ACTIONS = new Set([
  ...STUDENT_PLACEMENT_ACTIONS,
  ...RECRUITER_ACTIONS,
  ...COLLEGE_ADMIN_ACTIONS,
]);

// ------------------------------------------------------------
// Effective-role resolution.
// ------------------------------------------------------------

// Parse a student academic year (1..4) from common profile shapes.
// Returns null when it can't be determined (→ caller defaults to the
// fuller placement experience to avoid hiding screens from a real
// placement-ready student whose year we simply don't know).
export function parseStudentYear(profile = {}) {
  const direct = Number(profile.year);
  if (Number.isInteger(direct) && direct >= 1 && direct <= 4) return direct;

  const text = String(
    profile.yearSem || profile.yearOfStudy || profile.academicYear || profile.year || ''
  ).toLowerCase();
  if (!text) return null;

  const words = [
    [/(^|\b)(1st|first|i)(\b|st|year|yr)/, 1],
    [/(^|\b)(2nd|second|ii)(\b|nd|year|yr)/, 2],
    [/(^|\b)(3rd|third|iii)(\b|rd|year|yr)/, 3],
    [/(^|\b)(4th|fourth|final|iv)(\b|th|year|yr)/, 4],
  ];
  for (const [re, y] of words) if (re.test(text)) return y;

  const m = text.match(/\b([1-4])\b/);
  if (m) return Number(m[1]);
  return null;
}

const VALID_BASE_ROLES = new Set(['student', 'professional', 'recruiter', 'college_admin', 'admin']);

/**
 * getEffectiveRole(profile, opts) → one of EFFECTIVE_ROLES.
 *
 * - admin (plan.isAdmin OR profile.role==='admin') ⇒ 'admin'
 * - recruiter ⇒ 'recruiter'
 * - college_admin ⇒ 'college_admin'
 * - professional ⇒ 'student_placement'
 * - student: year 1–2 ⇒ 'student_early'; year 3–4 (or unknown) ⇒ 'student_placement'
 *
 * @param {object} [profile] persona profile; defaults to the stored profile.
 * @param {object} [opts] { isAdmin } explicit admin override (else read from plan).
 */
export function getEffectiveRole(profile, opts = {}) {
  const p = profile || getProfile() || {};
  const ctx = opts.accessContext || p.accessContext || getAccessContext() || {};
  const isAdmin = opts.isAdmin != null ? !!opts.isAdmin : !!safeIsAdmin();

  // The LOCAL persona/profile role is the gating signal for any privileged UI.
  // The server access-context can only CONFIRM (verify) a privileged role the
  // user has actually chosen — it can never, on its own, promote a student into
  // the recruiter or placement-cell experience. This is what keeps a student who
  // merely belongs to a college (college / collegeId / branch / yearSem fields,
  // or a stale / misattributed server `accountType`) on the student surface.
  const base = VALID_BASE_ROLES.has(p.role) ? p.role : 'student';

  // Admin always wins (billing flag, server context, or explicit profile role).
  if (isAdmin || ctx.isAdmin === true || ctx.role === 'admin' || base === 'admin') return 'admin';

  const accountType = String(ctx.accountType || '').trim();
  const verified = ctx.roleVerified === true;

  // A verified privileged context upgrades the UI ONLY when the local persona
  // agrees. `collegeId` is never consulted here, so college affiliation alone
  // never changes the effective UI role.
  if (verified && accountType === 'recruiter' && base === 'recruiter') return 'recruiter';
  if (verified && accountType === 'college_admin' && base === 'college_admin') return 'college_admin';

  // Self-selected privileged personas are UI intent only. Until the server
  // access-context confirms verification, they get only verification/status UI.
  if (base === 'recruiter') return 'recruiter_unverified';
  if (base === 'college_admin') return 'college_admin_unverified';
  if (base === 'professional') return 'student_placement';

  // student
  const year = parseStudentYear(p);
  if (year === 1 || year === 2) return 'student_early';
  return 'student_placement';
}

function safeIsAdmin() {
  try { return !!getPlan().isAdmin; } catch { return false; }
}

// Convenience: effective role for the current signed-in user (UI use).
export function getCurrentEffectiveRole() {
  return getEffectiveRole(getProfile(), { isAdmin: safeIsAdmin() });
}

// ------------------------------------------------------------
// Capability checks.
// ------------------------------------------------------------

export function canSeeScreen(profile, screenId, opts = {}) {
  const role = typeof profile === 'string' ? profile : getEffectiveRole(profile, opts);
  if (role === 'admin') return true;
  const id = resolveScreenId(screenId);
  if (ALWAYS_ALLOWED_SCREENS.has(id)) return true;
  const set = SCREEN_SETS[role];
  if (!set) return false; // unknown role → fail closed (admin already returned true)
  return set.has(id);
}

export function canUseAction(profile, actionId, opts = {}) {
  const role = typeof profile === 'string' ? profile : getEffectiveRole(profile, opts);
  if (role === 'admin') return true;
  const id = actionId == null ? '' : String(actionId).trim();
  // Ungated/unknown action ids are allowed (don't break legacy buttons).
  if (!ALL_KNOWN_ACTIONS.has(id)) return true;
  const set = ACTION_SETS[role];
  if (!set) return false;
  return set.has(id);
}

// ------------------------------------------------------------
// Collection filters (sidebar/nav/palette/cards/quick actions).
// ------------------------------------------------------------

// Each item may carry its screen id under `id`, `screen`, `screenId`,
// `target` or `view`. adminOnly items are kept only for admins.
function screenOf(item) {
  if (item == null) return undefined;
  if (typeof item === 'string') return item;
  return item.screenId ?? item.screen ?? item.target ?? item.view ?? item.id;
}

export function filterScreensForUser(profile, items, opts = {}) {
  const role = typeof profile === 'string' ? profile : getEffectiveRole(profile, opts);
  const list = Array.isArray(items) ? items : [];
  return list.filter((it) => {
    if (it && typeof it === 'object' && it.adminOnly && role !== 'admin') return false;
    return canSeeScreen(role, screenOf(it));
  });
}

function actionOf(item) {
  if (item == null) return undefined;
  if (typeof item === 'string') return item;
  return item.actionId ?? item.action ?? item.id;
}

export function filterActionsForUser(profile, items, opts = {}) {
  const role = typeof profile === 'string' ? profile : getEffectiveRole(profile, opts);
  const list = Array.isArray(items) ? items : [];
  return list.filter((it) => canUseAction(role, actionOf(it)));
}

// ------------------------------------------------------------
// Default landing + ordering.
// ------------------------------------------------------------

export function defaultScreenForRole(role) {
  switch (role) {
    case 'recruiter': return 'dash';        // recruiter dashboard (RoleDashboard)
    case 'college_admin': return 'college'; // real placement-cell workspace
    case 'recruiter_unverified': return 'verification';
    case 'college_admin_unverified': return 'verification';
    case 'admin': return 'dash';            // admin keeps the command-centre dash
    case 'student_early': return 'dash';
    case 'student_placement': return 'dash';
    default: return 'dash';
  }
}

export function defaultScreenForUser(profile, opts = {}) {
  return defaultScreenForRole(getEffectiveRole(profile, opts));
}
