// User role + onboarding profile.
import { csrfHeaders } from './csrf.js';
// Local cache is scoped by authenticated user; canonical cross-device state is
// stored by backend /api/user/profile when MongoDB is configured.

const BASE_KEY = 'careerAutopilot.profile.v1';
export const PROFILE_EVENT = 'career-profile-updated';

let currentUserKey = 'guest';
function normalizeUserKey(user) {
  const raw = user?.email || user?.id || 'guest';
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9@._-]+/g, '_') || 'guest';
}
export function setProfileUser(user) {
  currentUserKey = normalizeUserKey(user);
}
function key() { return `${BASE_KEY}:${currentUserKey}`; }

export const USER_ROLES = ['student', 'professional', 'recruiter', 'college_admin', 'admin'];

export const ROLE_LABELS = {
  student: 'Student',
  professional: 'Working Professional',
  recruiter: 'Recruiter',
  college_admin: 'College / Placement Cell',
  admin: 'Admin',
};

export const ONBOARDING_CHOICES = [
  { role: 'student', label: 'Student', hint: 'Pick this if you study at a college — build proof, get placement-ready' },
  { role: 'professional', label: 'Working Professional', hint: 'Level up and switch roles' },
  { role: 'recruiter', label: 'Recruiter', hint: 'Find proven candidates' },
  { role: 'college_admin', label: 'College / Placement Cell Staff', hint: 'For TPO, faculty, or placement administrators only' },
];

function read() {
  if (typeof window === 'undefined') return null;
  try {
    // Read ONLY the user-scoped key. Never read the legacy unscoped key for a
    // signed-in user — canonical profile is rehydrated from the server on login.
    const scoped = window.localStorage.getItem(key());
    return scoped ? JSON.parse(scoped) : null;
  } catch { return null; }
}
function write(v) {
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(key(), JSON.stringify(v)); } catch {}
    window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: v }));
  }
  return v;
}
async function saveProfileToServer(profile) {
  try {
    await fetch('/api/user/profile', {
      method: 'PUT', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ profile }),
    });
  } catch { /* local cache still works */ }
}

export async function hydrateProfileFromServer() {
  try {
    const r = await fetch('/api/user/profile', { credentials: 'include' });
    if (!r.ok) return getProfile();
    const d = await r.json();
    if (d?.profile && Object.keys(d.profile).length) return write(d.profile);
  } catch {}
  return getProfile();
}

export function getProfile() { return read() || {}; }

export function saveOnboarding(data) {
  const prev = getProfile();
  const next = { ...prev, ...data, completedAt: new Date().toISOString() };
  if (!USER_ROLES.includes(next.role)) next.role = 'student';
  write(next);
  saveProfileToServer(next);
  return next;
}

export function patchProfile(changes) {
  const next = { ...getProfile(), ...changes, updatedAt: new Date().toISOString() };
  write(next);
  saveProfileToServer(next);
  return next;
}

export function getUserRole() {
  const r = getProfile().role;
  return USER_ROLES.includes(r) ? r : 'student';
}

export function needsOnboarding() {
  const p = getProfile();
  return !p || !p.completedAt || !USER_ROLES.includes(p.role);
}

export function resetOnboarding() {
  if (typeof window !== 'undefined') { try { window.localStorage.removeItem(key()); } catch {} }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: {} }));
}

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
