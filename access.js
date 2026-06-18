// Role-based access control. Admin emails come ONLY from the ADMIN_EMAILS env
// var (comma-separated) and are resolved server-side from the authenticated
// session email — never from client-supplied data.

const U = -1; // JSON-safe "unlimited"

const PLAN_LIMITS = {
  free:    { tailoring: 3,  contacts: 5,   tracking: 20, templates: 4, customUpload: false, docx: false, outreach: 5 },
  pro:     { tailoring: 50, contacts: 100, tracking: U,  templates: U, customUpload: true,  docx: true,  outreach: 100 },
  premium: { tailoring: U,  contacts: U,   tracking: U,  templates: U, customUpload: true,  docx: true,  outreach: U },
  admin:   { tailoring: U,  contacts: U,   tracking: U,  templates: U, customUpload: true,  docx: true,  outreach: U },
};

const norm = (e) => String(e || '').trim().toLowerCase();

export function adminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(norm)
    .filter(Boolean);
}

export function isAdminEmail(email) {
  const e = norm(email);
  return !!e && adminEmails().includes(e);
}

/* Lower-cased Set of admin emails — handy for O(1) lookups when mapping a whole
   user directory. Never derived from anything client-supplied. */
export function adminEmailSet() {
  return new Set(adminEmails());
}

/* Authoritative admin check used by the admin-only API guard. Admin status is
   granted ONLY by (a) the server-side ADMIN_EMAILS allowlist, or (b) a persisted
   User.role === 'admin' from the database — never from client-supplied data. */
export function resolveIsAdmin({ email, dbRole } = {}) {
  return isAdminEmail(email) || dbRole === 'admin';
}

/* getUserRole(userEmail, planId) → 'admin' | existing plan role | 'free' */
export function getUserRole(userEmail, planId = 'free') {
  if (isAdminEmail(userEmail)) return 'admin';
  return PLAN_LIMITS[planId] ? planId : 'free';
}

export function limitsForRole(role, planId = 'free') {
  if (role === 'admin') return PLAN_LIMITS.admin;
  return PLAN_LIMITS[planId] || PLAN_LIMITS.free;
}

export function featuresForRole(role, planId = 'free') {
  const l = limitsForRole(role, planId);
  const unlimited = (n) => n === U;
  return {
    isAdmin: role === 'admin',
    customTemplateUpload: !!l.customUpload,
    docxExport: !!l.docx,
    allTemplates: unlimited(l.templates),
    unlimitedTailoring: unlimited(l.tailoring),
    unlimitedContacts: unlimited(l.contacts),
    unlimitedOutreach: unlimited(l.outreach),
    unlimitedTracking: unlimited(l.tracking),
    recruiterTools: role === 'admin' || planId === 'premium',
    projectStudioPremium: role === 'admin' || planId === 'premium',
  };
}

/* Effective billing plan for a user (admin is implicitly fully entitled).
   Unchanged subscription/payment semantics — restored after the RBAC refactor. */
export function effectivePlan(role, planId = 'free') {
  return role === 'admin' ? 'admin' : planId;
}

/* ---------------------------------------------------------------------------
   Persona roles (student / professional / recruiter / college_admin / admin).
   These are distinct from billing plans. `admin` is the ONLY server-verified
   privileged role — it comes solely from resolveIsAdmin() (ADMIN_EMAILS or a
   persisted User.role === 'admin'). recruiter / college_admin are currently
   self-selected personas (no identity verification yet), so resolvePersonaRole
   NEVER promotes a self-selected role to admin. The structure leaves a single
   place to later require verification for recruiter/college_admin.
--------------------------------------------------------------------------- */
export const PERSONA_ROLES = ['student', 'professional', 'recruiter', 'college_admin', 'admin'];

export function resolvePersonaRole({ email, dbRole, profileRole, networkRole } = {}) {
  // Admin is authoritative and server-verified only.
  if (resolveIsAdmin({ email, dbRole })) return 'admin';
  // Persona comes from persisted profile/network role when available. A
  // self-selected 'admin' is intentionally ignored here (never trusted).
  for (const r of [profileRole, networkRole]) {
    if (r && PERSONA_ROLES.includes(r) && r !== 'admin') return r;
  }
  return 'student';
}

/* Privileged personas that, today, are NOT identity-verified. Used to mark
   req.userRole.verified === false so downstream handlers can keep the most
   sensitive data (PII, non-consenting candidates) admin-only until a real
   recruiter/college verification flow exists. */
export function isPersonaVerified(role) {
  return role === 'admin';
}

/* ---------------------------------------------------------------------------
   SERVER-CONTROLLED privileged role resolution (backend authorization).
   profile.role is a self-selected onboarding PERSONA and is intentionally NOT
   consulted here. A recruiter/college_admin backend privilege is only granted
   from server-controlled account fields: a persisted account role/accountType,
   an explicit roleVerified flag, or admin (allowlist / isAdmin / dbRole).
   Returns 'admin' | 'recruiter' | 'college_admin' | null (no privilege).
--------------------------------------------------------------------------- */
export function resolvePrivilegedRole(src = {}) {
  const { email, dbRole, accountType, roleVerified, isAdmin } = src;
  if (isAdmin === true || resolveIsAdmin({ email, dbRole })) return 'admin';
  // recruiter/college_admin backend privilege requires a SERVER-CONTROLLED
  // accountType that is ALSO verified (admin-approved). A persisted dbRole of
  // recruiter/college_admin is itself server-set and counts as verified.
  const verifiedType = roleVerified === true ? accountType : null;
  const fromDbRole = (dbRole === 'recruiter' || dbRole === 'college_admin') ? dbRole : null;
  const type = verifiedType || fromDbRole;
  if (type === 'recruiter') return 'recruiter';
  if (type === 'college_admin') return 'college_admin';
  return null;
}

/* College scoping: a college_admin may only act on resources in their OWN
   college. Compares stable ids (collegeId / organizationId) — never a typed
   college name. Missing ids fail closed (no cross-college access). */
export function collegeScopeAllowed(userCollegeId, targetCollegeId) {
  if (!userCollegeId || !targetCollegeId) return false;
  return String(userCollegeId).trim() === String(targetCollegeId).trim();
}


