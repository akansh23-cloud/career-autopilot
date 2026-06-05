// User role + onboarding profile (Part 1 / persistence Part 11).
// Persisted to localStorage with clean helpers. The *role* here is the chosen
// persona (student/professional/recruiter/college_admin). Admin status is NOT
// stored client-side — it is resolved server-side from the session email and
// surfaced via plan.js (isAdmin). Nothing here can grant admin.

const KEY = 'careerAutopilot.profile.v1';
export const PROFILE_EVENT = 'career-profile-updated';

export const USER_ROLES = ['student', 'professional', 'recruiter', 'college_admin', 'admin'];

export const ROLE_LABELS = {
  student: 'Student',
  professional: 'Working Professional',
  recruiter: 'Recruiter',
  college_admin: 'College / Placement Cell',
  admin: 'Admin',
};

export const ONBOARDING_CHOICES = [
  { role: 'student', label: 'Student', hint: 'Build proof, get placement-ready' },
  { role: 'professional', label: 'Working Professional', hint: 'Level up and switch roles' },
  { role: 'recruiter', label: 'Recruiter', hint: 'Find proven candidates' },
  { role: 'college_admin', label: 'College / Placement Cell', hint: 'Track student readiness' },
];

function read() {
  if (typeof window === 'undefined') return null;
  try { const r = window.localStorage.getItem(KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function write(v) {
  if (typeof window === 'undefined') return v;
  try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
  window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: v }));
  return v;
}

export function getProfile() { return read() || {}; }

export function saveOnboarding(data) {
  const prev = getProfile();
  const next = { ...prev, ...data, completedAt: new Date().toISOString() };
  if (!USER_ROLES.includes(next.role)) next.role = 'student';
  return write(next);
}

export function patchProfile(changes) { return write({ ...getProfile(), ...changes }); }

// Stored persona role; falls back to 'student' for routing if unset.
export function getUserRole() {
  const r = getProfile().role;
  return USER_ROLES.includes(r) ? r : 'student';
}

export function needsOnboarding() {
  const p = getProfile();
  return !p || !p.completedAt || !USER_ROLES.includes(p.role);
}

export function resetOnboarding() {
  if (typeof window !== 'undefined') { try { window.localStorage.removeItem(KEY); } catch {} }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: {} }));
}

// Role-specific onboarding field definitions (rendered by the Onboarding view).
export const ROLE_FIELDS = {
  student: [
    { id: 'college', label: 'College name', type: 'text' },
    { id: 'yearSem', label: 'Year / semester', type: 'text' },
    { id: 'branch', label: 'Branch', type: 'text' },
    { id: 'targetRole', label: 'Target role', type: 'role' },
    { id: 'skills', label: 'Current skills (comma separated)', type: 'text' },
    { id: 'weeklyTime', label: 'Weekly time available', type: 'select', options: ['< 3 hrs', '3–6 hrs', '6–10 hrs', '10+ hrs'] },
    { id: 'goal', label: 'Primary goal', type: 'select', options: ['Internship', 'Placement', 'Hackathon', 'Startup', 'Research'] },
  ],
  professional: [
    { id: 'currentRole', label: 'Current role', type: 'text' },
    { id: 'experience', label: 'Experience', type: 'select', options: ['0–1 yrs', '1–3 yrs', '3–5 yrs', '5–8 yrs', '8+ yrs'] },
    { id: 'targetRole', label: 'Target role', type: 'role' },
    { id: 'skills', label: 'Current skills (comma separated)', type: 'text' },
    { id: 'noticePeriod', label: 'Notice period (optional)', type: 'text', optional: true },
  ],
  recruiter: [
    { id: 'company', label: 'Company name', type: 'text' },
    { id: 'hiringRole', label: 'Hiring role', type: 'role' },
    { id: 'companyEmail', label: 'Company email', type: 'email' },
    { id: 'skillsHiring', label: 'Skills hiring for (comma separated)', type: 'text' },
    { id: 'hiringType', label: 'Hiring type', type: 'select', options: ['Internship', 'Fresher', 'Experienced'] },
  ],
  college_admin: [
    { id: 'college', label: 'College name', type: 'text' },
    { id: 'department', label: 'Department', type: 'text' },
    { id: 'placementRole', label: 'Placement role', type: 'text' },
    { id: 'officialEmail', label: 'Official email', type: 'email' },
  ],
};
