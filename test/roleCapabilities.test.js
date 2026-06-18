// Unit tests for the centralized RBAC capability layer (web/src/lib/roleCapabilities.js).
// These exercise the pure functions directly — no browser, DB or network — so
// they run under `node --test`. Effective role is passed explicitly via the
// { isAdmin } option (or a string role) so the tests never depend on browser
// storage / plan state.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EFFECTIVE_ROLES,
  getEffectiveRole,
  parseStudentYear,
  canSeeScreen,
  canUseAction,
  filterScreensForUser,
  filterActionsForUser,
  resolveScreenId,
  defaultScreenForRole,
} from '../web/src/lib/roleCapabilities.js';

/* ---------------- effective-role resolution ---------------- */

test('admin override beats any profile role', () => {
  assert.equal(getEffectiveRole({ role: 'student' }, { isAdmin: true }), 'admin');
  assert.equal(getEffectiveRole({ role: 'recruiter' }, { isAdmin: true }), 'admin');
});

test('self-selected recruiter / college_admin are verification-only until server approved', () => {
  assert.equal(getEffectiveRole({ role: 'recruiter' }, { isAdmin: false }), 'recruiter_unverified');
  assert.equal(getEffectiveRole({ role: 'college_admin' }, { isAdmin: false }), 'college_admin_unverified');
  assert.equal(getEffectiveRole({ role: 'recruiter' }, { isAdmin: false, accessContext: { accountType: 'recruiter', roleVerified: true } }), 'recruiter');
  assert.equal(getEffectiveRole({ role: 'college_admin' }, { isAdmin: false, accessContext: { accountType: 'college_admin', roleVerified: true } }), 'college_admin');
});

test('professional maps to student_placement', () => {
  assert.equal(getEffectiveRole({ role: 'professional' }, { isAdmin: false }), 'student_placement');
});

test('student year 1/2 → student_early, year 3/4 → student_placement', () => {
  assert.equal(getEffectiveRole({ role: 'student', yearSem: '1st year' }, { isAdmin: false }), 'student_early');
  assert.equal(getEffectiveRole({ role: 'student', yearSem: 'Year 2 / Sem 4' }, { isAdmin: false }), 'student_early');
  assert.equal(getEffectiveRole({ role: 'student', yearSem: '3rd year' }, { isAdmin: false }), 'student_placement');
  assert.equal(getEffectiveRole({ role: 'student', yearSem: 'final year' }, { isAdmin: false }), 'student_placement');
});

test('student with unknown year defaults to the fuller placement experience', () => {
  assert.equal(getEffectiveRole({ role: 'student' }, { isAdmin: false }), 'student_placement');
  assert.equal(getEffectiveRole({ role: 'student', yearSem: '' }, { isAdmin: false }), 'student_placement');
});

test('unknown / missing role falls back to a student', () => {
  const r = getEffectiveRole({ role: 'nonsense' }, { isAdmin: false });
  assert.ok(r === 'student_placement' || r === 'student_early');
  assert.ok(EFFECTIVE_ROLES.includes(r));
});

test('parseStudentYear handles numbers, ordinals and words', () => {
  assert.equal(parseStudentYear({ year: 2 }), 2);
  assert.equal(parseStudentYear({ yearSem: '4th' }), 4);
  assert.equal(parseStudentYear({ yearSem: 'third year' }), 3);
  assert.equal(parseStudentYear({ yearSem: 'Sem 1' }), 1);
  assert.equal(parseStudentYear({ yearSem: 'graduated' }), null);
});

/* ---------------- screen-id aliasing ---------------- */

test('spec screen ids resolve to real app view ids', () => {
  assert.equal(resolveScreenId('project-os'), 'projectstudio');
  assert.equal(resolveScreenId('resume-os'), 'resume');
  assert.equal(resolveScreenId('resume-editor'), 'editor');
  assert.equal(resolveScreenId('candidate-search'), 'recruiter');
  assert.equal(resolveScreenId('career-profile'), 'careerprofile');
  assert.equal(resolveScreenId('dash'), 'dash'); // identity
});

/* ---------------- screen visibility ---------------- */

test('student_early CANNOT see recruiter / jobs / resume / tracker', () => {
  for (const s of ['recruiter', 'jobs', 'resume', 'editor', 'tracker', 'applications', 'adminusers']) {
    assert.equal(canSeeScreen('student_early', s), false, `student_early should not see ${s}`);
  }
});

test('student_early CAN see its build surface', () => {
  for (const s of ['dash', 'projectstudio', 'projectcreator', 'architecture', 'marketplace', 'skillsxp', 'leaderboards', 'settings']) {
    assert.equal(canSeeScreen('student_early', s), true, `student_early should see ${s}`);
  }
});

test('student_placement keeps the full student/professional surface (incl. outreach + jobs + patents)', () => {
  for (const s of ['jobs', 'resume', 'editor', 'tracker', 'applications', 'contacts', 'innovation', 'patents', 'referralexchange', 'opportunities']) {
    assert.equal(canSeeScreen('student_placement', s), true, `student_placement should see ${s}`);
  }
  // …but still not the recruiter console or the admin directory.
  assert.equal(canSeeScreen('student_placement', 'recruiter'), false);
  assert.equal(canSeeScreen('student_placement', 'adminusers'), false);
});

test('recruiter sees only the recruiter-safe surface', () => {
  for (const s of ['recruiter', 'dash', 'sandbox', 'careerprofile', 'leaderboards', 'settings']) {
    assert.equal(canSeeScreen('recruiter', s), true);
  }
  for (const s of ['jobs', 'resume', 'editor', 'projectcreator', 'tracker', 'adminusers']) {
    assert.equal(canSeeScreen('recruiter', s), false, `recruiter should not see ${s}`);
  }
});

test('college_admin sees only its tight surface (not the global recruiter console or admin directory)', () => {
  assert.equal(canSeeScreen('college_admin', 'college'), true);
  assert.equal(canSeeScreen('college_admin', 'dash'), false);
  assert.equal(canSeeScreen('college_admin', 'sandbox'), true);
  assert.equal(canSeeScreen('college_admin', 'recruiter'), false);
  assert.equal(canSeeScreen('college_admin', 'adminusers'), false);
  assert.equal(canSeeScreen('college_admin', 'jobs'), false);
});

test('admin can see everything', () => {
  for (const s of ['recruiter', 'adminusers', 'jobs', 'resume', 'patents', 'dash']) {
    assert.equal(canSeeScreen('admin', s), true, `admin should see ${s}`);
  }
});

test('support + settings are utility screens; dash is only for roles whose default dashboard is safe', () => {
  for (const role of EFFECTIVE_ROLES) {
    assert.equal(canSeeScreen(role, 'support'), true);
    assert.equal(canSeeScreen(role, 'settings'), true);
  }
  assert.equal(canSeeScreen('student_early', 'dash'), true);
  assert.equal(canSeeScreen('student_placement', 'dash'), true);
  assert.equal(canSeeScreen('recruiter', 'dash'), true);
  assert.equal(canSeeScreen('college_admin', 'dash'), false);
  assert.equal(canSeeScreen('recruiter_unverified', 'dash'), false);
  assert.equal(canSeeScreen('college_admin_unverified', 'dash'), false);
});

/* ---------------- action capabilities ---------------- */

test('student_early action gating', () => {
  assert.equal(canUseAction('student_early', 'create_project'), true);
  assert.equal(canUseAction('student_early', 'verify_skill'), true);
  // placement-only actions are blocked for early students
  assert.equal(canUseAction('student_early', 'tailor_resume'), false);
  assert.equal(canUseAction('student_early', 'search_jobs'), false);
  // recruiter actions blocked
  assert.equal(canUseAction('student_early', 'shortlist_candidate'), false);
});

test('student_placement gets all student_early + placement actions', () => {
  assert.equal(canUseAction('student_placement', 'create_project'), true);
  assert.equal(canUseAction('student_placement', 'tailor_resume'), true);
  assert.equal(canUseAction('student_placement', 'apply_job'), true);
  // recruiter-only action still blocked
  assert.equal(canUseAction('student_placement', 'request_contact'), false);
});

test('recruiter vs college_admin action separation', () => {
  assert.equal(canUseAction('recruiter', 'shortlist_candidate'), true);
  assert.equal(canUseAction('recruiter', 'request_introduction'), true);
  assert.equal(canUseAction('recruiter', 'create_placement_drive'), false);

  assert.equal(canUseAction('college_admin', 'create_placement_drive'), true);
  assert.equal(canUseAction('college_admin', 'view_college_students'), true);
  assert.equal(canUseAction('college_admin', 'shortlist_candidate'), false);
});

test('admin can use every action; unknown actions are ungated (never break legacy buttons)', () => {
  assert.equal(canUseAction('admin', 'create_placement_drive'), true);
  assert.equal(canUseAction('admin', 'request_contact'), true);
  // an action id not in any role set is allowed for everyone
  assert.equal(canUseAction('student_early', 'some_legacy_button_action'), true);
  assert.equal(canUseAction('recruiter', 'open_settings_modal'), true);
});

/* ---------------- collection filters ---------------- */

test('filterScreensForUser drops wrong-role + adminOnly items', () => {
  const nav = [
    { id: 'dash', label: 'Dashboard' },
    { id: 'jobs', label: 'Jobs' },
    { id: 'recruiter', label: 'Recruiter Console' },
    { id: 'adminusers', label: 'User Directory', adminOnly: true },
  ];
  const earlyIds = filterScreensForUser('student_early', nav).map((n) => n.id);
  assert.deepEqual(earlyIds, ['dash']);

  const placementIds = filterScreensForUser('student_placement', nav).map((n) => n.id);
  assert.deepEqual(placementIds, ['dash', 'jobs']);

  const adminIds = filterScreensForUser('admin', nav).map((n) => n.id);
  assert.deepEqual(adminIds, ['dash', 'jobs', 'recruiter', 'adminusers']);
});

test('filterActionsForUser respects the role action set', () => {
  const actions = [
    { id: 'create_project' },
    { id: 'tailor_resume' },
    { id: 'shortlist_candidate' },
  ];
  assert.deepEqual(filterActionsForUser('student_early', actions).map((a) => a.id), ['create_project']);
  assert.deepEqual(filterActionsForUser('student_placement', actions).map((a) => a.id), ['create_project', 'tailor_resume']);
  assert.deepEqual(filterActionsForUser('recruiter', actions).map((a) => a.id), ['shortlist_candidate']);
});

/* ---------------- default landing ---------------- */

test('every role has a sane default landing screen it can actually see', () => {
  for (const role of EFFECTIVE_ROLES) {
    const dest = defaultScreenForRole(role);
    assert.equal(canSeeScreen(role, dest), true, `${role} cannot see its own default landing ${dest}`);
  }
});

/* ---------------- spec scenarios (#8) ---------------- */

test('scenario: a student cannot see any recruiter nav / card / button / command item', () => {
  for (const role of ['student_early', 'student_placement']) {
    assert.equal(canSeeScreen(role, 'recruiter'), false);
    assert.equal(canSeeScreen(role, 'candidate-search'), false); // spec alias → recruiter
    assert.equal(canSeeScreen(role, 'shortlists'), false);
    assert.equal(canUseAction(role, 'shortlist_candidate'), false);
    assert.equal(canUseAction(role, 'search_candidates'), false);
  }
});

test('scenario: a recruiter cannot see resume editor / jobs / project creator actions', () => {
  for (const s of ['editor', 'resume-editor', 'jobs', 'projectcreator', 'project-creator']) {
    assert.equal(canSeeScreen('recruiter', s), false, `recruiter should not see ${s}`);
  }
  for (const a of ['tailor_resume', 'export_resume_pdf', 'search_jobs', 'apply_job', 'create_project', 'build_architecture']) {
    assert.equal(canUseAction('recruiter', a), false, `recruiter should not be able to ${a}`);
  }
});

test('scenario: college_admin cannot see the global recruiter candidate search or the admin directory', () => {
  assert.equal(canSeeScreen('college_admin', 'recruiter'), false);
  assert.equal(canSeeScreen('college_admin', 'candidate-search'), false);
  assert.equal(canSeeScreen('college_admin', 'adminusers'), false);
  assert.equal(canSeeScreen('college_admin', 'user-directory'), false); // spec alias → adminusers
});

test('scenario: command palette filtering respects RBAC (uses the same filter as the palette)', () => {
  const paletteItems = [
    { id: 'dash' }, { id: 'recruiter' }, { id: 'jobs' }, { id: 'projectcreator' },
    { id: 'adminusers', adminOnly: true },
  ];
  assert.deepEqual(filterScreensForUser('student_early', paletteItems).map((i) => i.id).sort(), ['dash', 'projectcreator']);
  assert.deepEqual(filterScreensForUser('recruiter', paletteItems).map((i) => i.id), ['dash', 'recruiter']);
  assert.deepEqual(filterScreensForUser('admin', paletteItems).map((i) => i.id).sort(),
    ['adminusers', 'dash', 'jobs', 'projectcreator', 'recruiter']);
});

test('scenario: direct blocked navigation resolves to a safe default the role CAN see (no blocked render)', () => {
  const tryNavigate = (role, target) => (canSeeScreen(role, target) ? target : defaultScreenForRole(role));
  const dest = tryNavigate('student_early', 'recruiter');
  assert.notEqual(dest, 'recruiter');
  assert.equal(canSeeScreen('student_early', dest), true);
  const dest2 = tryNavigate('recruiter', 'editor');
  assert.notEqual(dest2, 'editor');
  assert.equal(canSeeScreen('recruiter', dest2), true);
});

test('scenario: admin retains full access to every screen and action', () => {
  for (const s of ['recruiter', 'adminusers', 'jobs', 'editor', 'projectcreator', 'candidate-search']) {
    assert.equal(canSeeScreen('admin', s), true);
  }
  for (const a of ['shortlist_candidate', 'create_placement_drive', 'tailor_resume', 'search_candidates']) {
    assert.equal(canUseAction('admin', a), true);
  }
});

test('scenario: college analytics screens map to the REAL placement-cell workspace (not faked onto dash)', () => {
  // They resolve to the real 'college' workspace screen, which a college_admin
  // can see and a student cannot.
  for (const s of ['student-directory', 'skill-heatmap', 'batch-analytics', 'drive-tracker', 'reports']) {
    assert.equal(resolveScreenId(s), 'college');
    assert.equal(canSeeScreen('college_admin', s), true);
    assert.equal(canSeeScreen('student_placement', s), false);
    assert.equal(canSeeScreen('recruiter', s), false);
  }
  assert.equal(canSeeScreen('college_admin', 'college-dashboard'), true); // → college
  assert.equal(canSeeScreen('college_admin', 'verified-projects'), true); // → sandbox
});
