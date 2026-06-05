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

export function effectivePlan(role, planId = 'free') {
  return role === 'admin' ? 'admin' : planId;
}
