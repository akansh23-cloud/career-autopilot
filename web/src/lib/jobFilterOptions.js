/* ============================================================================
   jobFilterOptions.js — the job-search filter vocabulary used by the UI.
   ----------------------------------------------------------------------------
   These values MUST stay a subset of the canonical enums in
   server/utils/jobFilters.js (WORK_MODES / EXPERIENCE_LEVELS / JOB_TYPES) —
   a regression test in test/jobFilters.test.js asserts frontend ⊆ backend.
   The backend additionally accepts legacy values ('Any', 'Remote',
   'On-site/Hybrid') via normalizeWorkMode, but NEW UI code only ever sends
   canonical values.
   ========================================================================== */

export const WORK_MODE_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
];

export const EXPERIENCE_OPTIONS = [
  { value: 'any', label: 'Any level' },
  { value: 'internship', label: 'Internship' },
  { value: 'entry', label: 'Entry / Fresher' },
  { value: 'junior', label: 'Junior (1–3y)' },
  { value: 'mid', label: 'Mid (3–6y)' },
  { value: 'senior', label: 'Senior (6y+)' },
];

export const JOB_TYPE_OPTIONS = [
  { value: 'any', label: 'Any type' },
  { value: 'full-time', label: 'Full-time' },
  { value: 'internship', label: 'Internship' },
  { value: 'contract', label: 'Contract' },
  { value: 'part-time', label: 'Part-time' },
];

export const WORK_MODES = WORK_MODE_OPTIONS.map((o) => o.value);
export const EXPERIENCE_LEVELS = EXPERIENCE_OPTIONS.map((o) => o.value);
export const JOB_TYPES = JOB_TYPE_OPTIONS.map((o) => o.value);

/* Migrate any persisted legacy mode value to a canonical one. Pure mirror of
   the backend's normalizeWorkMode legacy mapping, so old localStorage state
   ('Any' / 'Remote' / 'On-site/Hybrid') keeps working after the upgrade. */
export function migrateLegacyWorkMode(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (!v || v === 'any' || v === 'all') return 'any';
  if (v === 'remote' || v === 'wfh' || v === 'work from home' || v === 'fully remote') return 'remote';
  if (v === 'on-site/hybrid' || v === 'onsite/hybrid' || v === 'on site/hybrid' || v === 'hybrid') return 'hybrid';
  if (v === 'onsite' || v === 'on-site' || v === 'on site' || v === 'office' || v === 'in office' || v === 'in-office') return 'onsite';
  return WORK_MODES.includes(v) ? v : 'any';
}

export function migrateLegacyExperience(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return EXPERIENCE_LEVELS.includes(v) ? v : 'any';
}

export function migrateLegacyJobType(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return JOB_TYPES.includes(v) ? v : 'any';
}

export default {
  WORK_MODE_OPTIONS, EXPERIENCE_OPTIONS, JOB_TYPE_OPTIONS,
  WORK_MODES, EXPERIENCE_LEVELS, JOB_TYPES,
  migrateLegacyWorkMode, migrateLegacyExperience, migrateLegacyJobType,
};
