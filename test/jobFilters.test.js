// Regression tests for the job-search filter fix:
//  - the legacy frontend mode values must normalize to canonical values
//    (the old bug: frontend sent mode='On-site/Hybrid', backend
//    validModeMatch could never match it),
//  - work mode / experience level / job type are classified from job text
//    because sources only tag jobs as 'Remote' or 'On-site/Hybrid',
//  - the frontend option lists are a strict subset of the backend enums.
// Pure imports only — runs under `node --test` with no server/DB/network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WORK_MODES, EXPERIENCE_LEVELS, JOB_TYPES,
  normalizeWorkMode, classifyWorkMode, matchesWorkMode,
  normalizeExperienceLevel, classifyExperienceLevel, matchesExperienceLevel,
  normalizeJobType, classifyJobType, matchesJobType,
} from '../server/utils/jobFilters.js';

import {
  WORK_MODES as FE_WORK_MODES,
  EXPERIENCE_LEVELS as FE_EXPERIENCE_LEVELS,
  JOB_TYPES as FE_JOB_TYPES,
  WORK_MODE_OPTIONS, EXPERIENCE_OPTIONS, JOB_TYPE_OPTIONS,
  migrateLegacyWorkMode,
} from '../web/src/lib/jobFilterOptions.js';

/* ------------------------- enum parity (frontend ⊆ backend) ------------ */

test('frontend filter values are a subset of the backend canonical enums', () => {
  for (const v of FE_WORK_MODES) assert.ok(WORK_MODES.includes(v), `work mode ${v} unknown to backend`);
  for (const v of FE_EXPERIENCE_LEVELS) assert.ok(EXPERIENCE_LEVELS.includes(v), `experience ${v} unknown to backend`);
  for (const v of FE_JOB_TYPES) assert.ok(JOB_TYPES.includes(v), `job type ${v} unknown to backend`);
  // every option carries a value + label and the value is canonical
  for (const o of [...WORK_MODE_OPTIONS, ...EXPERIENCE_OPTIONS, ...JOB_TYPE_OPTIONS]) {
    assert.equal(typeof o.value, 'string');
    assert.ok(o.label.length > 0);
    assert.equal(o.value, o.value.toLowerCase());
  }
  // 'any' is always the first/default option
  assert.equal(WORK_MODE_OPTIONS[0].value, 'any');
  assert.equal(EXPERIENCE_OPTIONS[0].value, 'any');
  assert.equal(JOB_TYPE_OPTIONS[0].value, 'any');
});

/* -------------------------------- normalizeWorkMode -------------------- */

test('normalizeWorkMode maps every legacy frontend value', () => {
  assert.equal(normalizeWorkMode('Any'), 'any');
  assert.equal(normalizeWorkMode('Remote'), 'remote');
  assert.equal(normalizeWorkMode('On-site/Hybrid'), 'hybrid'); // THE old bug value
  assert.equal(normalizeWorkMode('hybrid'), 'hybrid');
  assert.equal(normalizeWorkMode('onsite'), 'onsite');
  assert.equal(normalizeWorkMode('On-site'), 'onsite');
  assert.equal(normalizeWorkMode(''), 'any');
  assert.equal(normalizeWorkMode(undefined), 'any');
  assert.equal(normalizeWorkMode('garbage'), 'any'); // never throws, never drops results
});

test('frontend migrateLegacyWorkMode agrees with the backend normalizer', () => {
  for (const v of ['Any', 'Remote', 'On-site/Hybrid', 'hybrid', 'onsite', '', 'weird']) {
    assert.equal(migrateLegacyWorkMode(v), normalizeWorkMode(v), `disagreement on '${v}'`);
  }
});

/* -------------------------------- classifyWorkMode --------------------- */

test('classifyWorkMode reads hybrid/onsite from text — sources only tag Remote or On-site/Hybrid', () => {
  assert.equal(classifyWorkMode({ mode: 'Remote', title: 'Data Engineer' }), 'remote');
  // combined tag + explicit hybrid text
  assert.equal(classifyWorkMode({ mode: 'On-site/Hybrid', summary: 'Hybrid: 3 days in our Pune office' }), 'hybrid');
  // onsite-only signals
  assert.equal(classifyWorkMode({ mode: '', title: 'Plant Engineer', summary: 'This role is fully on-site at our Nashik facility' }), 'onsite');
  assert.equal(classifyWorkMode({ summary: 'work from office, 5 days a week' }), 'onsite');
  assert.equal(classifyWorkMode({ summary: 'work from home allowed' }), 'remote');
  assert.equal(classifyWorkMode({ title: 'Engineer' }), 'unknown');
  // hybrid wins when both hybrid and remote words appear (typical hybrid JD)
  assert.equal(classifyWorkMode({ summary: 'hybrid role with some remote days' }), 'hybrid');
});

test('matchesWorkMode behaves per the documented rules', () => {
  const hybridJob = { mode: 'On-site/Hybrid', summary: 'hybrid, 2 days office' };
  const remoteJob = { mode: 'Remote' };
  const unknownJob = { title: 'Engineer' };
  assert.equal(matchesWorkMode(remoteJob, 'any'), true);
  assert.equal(matchesWorkMode(remoteJob, 'remote'), true);
  assert.equal(matchesWorkMode(remoteJob, 'onsite'), false);
  assert.equal(matchesWorkMode(hybridJob, 'hybrid'), true);
  // a job whose only signal is the combined source tag satisfies BOTH
  // non-remote filters (the source asserted non-remote without separating)
  const combinedOnly = { mode: 'On-site/Hybrid' };
  assert.equal(matchesWorkMode(combinedOnly, 'hybrid'), true);
  assert.equal(matchesWorkMode(combinedOnly, 'onsite'), true);
  assert.equal(matchesWorkMode(combinedOnly, 'remote'), false);
  // unknown never matches a specific filter
  assert.equal(matchesWorkMode(unknownJob, 'remote'), false);
  assert.equal(matchesWorkMode(unknownJob, 'any'), true);
  // legacy filter values keep working end to end
  assert.equal(matchesWorkMode(hybridJob, 'On-site/Hybrid'), true);
  assert.equal(matchesWorkMode(remoteJob, 'Remote'), true);
});

/* ----------------------------- experience level ------------------------ */

test('classifyExperienceLevel follows the keyword rules, title first', () => {
  assert.equal(classifyExperienceLevel({ title: 'Software Engineering Intern' }), 'internship');
  assert.equal(classifyExperienceLevel({ title: 'Graduate Engineer Trainee' }), 'internship'); // trainee outranks
  assert.equal(classifyExperienceLevel({ title: 'Data Engineer', summary: 'freshers welcome, 0-1 years' }), 'entry');
  assert.equal(classifyExperienceLevel({ title: 'Junior DevOps Engineer' }), 'junior');
  assert.equal(classifyExperienceLevel({ title: 'Engineer', summary: '1-3 years of experience required' }), 'junior');
  assert.equal(classifyExperienceLevel({ title: 'Engineer', summary: 'mid-level, 3-6 years' }), 'mid');
  assert.equal(classifyExperienceLevel({ title: 'Senior Data Engineer' }), 'senior');
  assert.equal(classifyExperienceLevel({ title: 'Staff Engineer' }), 'senior');
  assert.equal(classifyExperienceLevel({ title: 'Principal Architect' }), 'senior');
  assert.equal(classifyExperienceLevel({ title: 'Engineer', summary: '8+ years building data platforms' }), 'senior');
  assert.equal(classifyExperienceLevel({ title: 'Engineer', summary: 'great team' }), 'unknown');
  // title outranks body text
  assert.equal(classifyExperienceLevel({ title: 'Senior Engineer', summary: 'mentor junior engineers' }), 'senior');
});

test('matchesExperienceLevel: any passes, exact passes, unknown passes except for internship', () => {
  const senior = { title: 'Senior Data Engineer' };
  const unknown = { title: 'Data Engineer' };
  assert.equal(matchesExperienceLevel(senior, 'any'), true);
  assert.equal(matchesExperienceLevel(senior, 'senior'), true);
  assert.equal(matchesExperienceLevel(senior, 'entry'), false);
  assert.equal(matchesExperienceLevel(unknown, 'senior'), true);  // unlabelled jobs stay visible
  assert.equal(matchesExperienceLevel(unknown, 'internship'), false); // internships are always labelled
  assert.equal(matchesExperienceLevel({ title: 'SDE Intern' }, 'internship'), true);
  assert.equal(normalizeExperienceLevel('Entry Level'), 'entry');
  assert.equal(normalizeExperienceLevel(''), 'any');
});

/* --------------------------------- job type ---------------------------- */

test('job type normalization, classification and matching', () => {
  assert.equal(normalizeJobType('Full Time'), 'full-time');
  assert.equal(normalizeJobType('freelance'), 'contract');
  assert.equal(normalizeJobType(''), 'any');
  assert.equal(classifyJobType({ employmentType: 'Contract' }), 'contract');
  assert.equal(classifyJobType({ title: 'Data Analyst (Part-time)' }), 'part-time');
  assert.equal(classifyJobType({ title: 'SDE Internship' }), 'internship');
  assert.equal(classifyJobType({ summary: 'permanent full-time position' }), 'full-time');
  assert.equal(classifyJobType({ title: 'Engineer' }), 'unknown');
  const unknown = { title: 'Engineer' };
  assert.equal(matchesJobType(unknown, 'any'), true);
  assert.equal(matchesJobType(unknown, 'full-time'), true);   // default assumption
  assert.equal(matchesJobType(unknown, 'internship'), false); // explicit-only categories
  assert.equal(matchesJobType(unknown, 'part-time'), false);
  assert.equal(matchesJobType({ employmentType: 'contract' }, 'contract'), true);
});
