// Regression tests for the top-level navigation grouping
// (web/src/lib/navGroups.js).
//
// Background: the grouping logic used to compute an overflow ("more") list on
// desktop that Shell.jsx never rendered. Because MAX_TOP_NAV_GROUPS (6) was
// <= the number of groups every role can see, whole product surfaces —
// "Patent Engine" for EVERY role, plus Resume OS / Job Match / Applications /
// Community for admin — were computed and then thrown away. canSeeScreen()
// returned true the whole time, so the RBAC tests passed while the screens
// were unreachable from the nav.
//
// These tests lock the real contract: anything a role may open must be
// reachable, and overflow groups must keep their label.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NAV_GROUPS,
  MORE_IDS,
  MAX_TOP_NAV_GROUPS,
  UTILITY_GROUP_LABEL,
  buildNavForRole,
} from '../web/src/lib/navGroups.js';
import { canSeeScreen, EFFECTIVE_ROLES } from '../web/src/lib/roleCapabilities.js';

// Mirror of the Shell NAV table (ids + adminOnly only — icons are React
// components and are irrelevant to grouping).
const NAV = [
  'dash', 'verification', 'careerprofile', 'projectcreator', 'marketplace',
  'inspirations', 'architecture', 'innovation', 'patents', 'patentgenerate',
  'patentportfolio', 'priorart', 'patentdisclosures', 'applications',
  'readiness', 'skillsxp', 'resume', 'editor', 'jobs', 'tracker', 'contacts',
  'referralexchange', 'leaderboards', 'opportunities', 'projectstudio',
  'sandbox', 'partners', 'recruiter', 'college', 'growth', 'settings',
].map((id) => ({ id, label: id })).concat([{ id: 'adminusers', label: 'User Directory', adminOnly: true }]);

const allItems = ({ primary, moreGroups }) =>
  [...primary, ...moreGroups].flatMap((g) => g.items.map((it) => it.id));

/* ---------------- reachability (the bug this file exists for) ---------------- */

for (const role of EFFECTIVE_ROLES) {
  test(`[${role}] every visible screen is reachable from the nav`, () => {
    const nav = buildNavForRole(role, NAV);
    const reachable = new Set(allItems(nav));
    for (const item of NAV) {
      if (item.adminOnly && role !== 'admin') continue;
      if (!canSeeScreen(role, item.id)) continue;
      assert.ok(reachable.has(item.id), `${role} may open "${item.id}" but it is not in the nav`);
    }
  });

  test(`[${role}] nav never exposes a screen the role cannot open`, () => {
    const nav = buildNavForRole(role, NAV);
    for (const id of allItems(nav)) {
      assert.ok(canSeeScreen(role, id), `${role} sees "${id}" in the nav but cannot open it`);
    }
  });

  test(`[${role}] no duplicate entries across primary and More`, () => {
    const ids = allItems(buildNavForRole(role, NAV));
    assert.equal(ids.length, new Set(ids).size, `duplicate nav ids for ${role}: ${ids.join(', ')}`);
  });
}

/* ---------------- Patent Engine specifically ---------------- */

const PATENT_IDS = NAV_GROUPS.find((g) => g.label === 'Patent Engine').ids;

test('admin can reach the full Patent Engine surface', () => {
  const nav = buildNavForRole('admin', NAV);
  const reachable = new Set(allItems(nav));
  for (const id of PATENT_IDS) {
    assert.ok(reachable.has(id), `admin cannot reach patent screen "${id}"`);
  }
});

test('Patent Engine sits in the admin top bar, not buried', () => {
  const { primary } = buildNavForRole('admin', NAV);
  assert.ok(primary.some((g) => g.label === 'Patent Engine'), 'Patent Engine missing from admin primary nav');
});

test('placement students can reach the Patent Engine', () => {
  const reachable = new Set(allItems(buildNavForRole('student_placement', NAV)));
  for (const id of PATENT_IDS) assert.ok(reachable.has(id), `student_placement cannot reach "${id}"`);
});

test('recruiter and college_admin never see patent screens', () => {
  for (const role of ['recruiter', 'college_admin']) {
    const reachable = new Set(allItems(buildNavForRole(role, NAV)));
    for (const id of PATENT_IDS) assert.ok(!reachable.has(id), `${role} should not see "${id}"`);
  }
});

/* ---------------- overflow shape ---------------- */

test('primary bar is capped and overflow keeps its group label', () => {
  for (const role of EFFECTIVE_ROLES) {
    const { primary, moreGroups } = buildNavForRole(role, NAV);
    assert.ok(primary.length <= MAX_TOP_NAV_GROUPS, `${role} primary exceeds cap`);
    for (const g of moreGroups) {
      assert.ok(typeof g.label === 'string' && g.label.length, `${role} overflow group missing a label`);
      assert.ok(g.items.length, `${role} overflow group "${g.label}" is empty`);
    }
  }
});

test('utility ids land in the Tools & settings group', () => {
  const { moreGroups } = buildNavForRole('student_placement', NAV);
  const utility = moreGroups.find((g) => g.label === UTILITY_GROUP_LABEL);
  assert.ok(utility, 'utility group missing');
  for (const id of MORE_IDS) {
    assert.ok(utility.items.some((it) => it.id === id), `"${id}" not in ${UTILITY_GROUP_LABEL}`);
  }
});

test('staff roles see "Verified Projects", never a misleading "Project OS"', () => {
  for (const role of ['recruiter', 'college_admin']) {
    const { primary, moreGroups } = buildNavForRole(role, NAV);
    const labels = [...primary, ...moreGroups].map((g) => g.label);
    assert.ok(!labels.includes('Project OS'), `${role} should not see a Project OS menu`);
  }
});

test('unverified roles get only their verification surface', () => {
  for (const role of ['recruiter_unverified', 'college_admin_unverified']) {
    const ids = allItems(buildNavForRole(role, NAV));
    assert.deepEqual(new Set(ids), new Set(['verification', 'settings']), `${role} nav leaked screens`);
  }
});
