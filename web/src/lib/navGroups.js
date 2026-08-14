// ============================================================
// Top-level navigation grouping (pure / testable).
// ------------------------------------------------------------
// Extracted out of Shell.jsx so the grouping rules can be unit
// tested under `node --test` without React / lucide / framer-motion.
//
// Contract enforced by test/navGroups.test.js:
//   Every screen a role may open (canSeeScreen === true) MUST be
//   reachable from the rendered navigation — either in the primary
//   top bar or inside the "More" menu. A group that overflows the
//   bar is NEVER silently dropped, and it keeps its group LABEL so
//   "Patent Engine" stays discoverable as a product surface rather
//   than dissolving into a flat list of loose items.
// ============================================================

import { canSeeScreen } from './roleCapabilities.js';

// Journey groups -> top-level website menus. Short labels keep the bar clean.
// Every existing view id is kept; they are regrouped into clean menus.
// Patents gets its own entry; Profile/XP consolidates identity + verified
// skills + readiness.
export const NAV_GROUPS = [
  { label: 'Overview', short: 'Home', ids: ['dash', 'verification'] },
  { label: 'Resume OS', short: 'Résumé', ids: ['studio', 'resume', 'editor'] },
  { label: 'Job Match', short: 'Jobs', ids: ['jobs', 'tracker', 'contacts', 'referralexchange'] },
  { label: 'Applications', short: 'Apply', ids: ['applications'] },
  { label: 'Project OS', short: 'Project OS', ids: ['projectstudio', 'teamproject', 'projectcreator', 'marketplace', 'inspirations', 'architecture', 'sandbox', 'partners'] },
  { label: 'Patent Engine', short: 'Patents', ids: ['innovation', 'patents', 'patentgenerate', 'patentportfolio', 'priorart', 'patentdisclosures'] },
  { label: 'Profile / XP', short: 'Profile', ids: ['careerprofile', 'skillsxp', 'readiness'] },
  { label: 'Community', short: 'Community', ids: ['leaderboards', 'opportunities'] },
  { label: 'Recruiting', short: 'Recruiting', ids: ['recruiter'] },
  { label: 'Placement Cell', short: 'College', ids: ['college'] },
  { label: 'Admin', short: 'Admin', ids: ['adminusers', 'templatebuilder'] },
];

// Utility surfaces that never belong to a journey group.
export const MORE_IDS = ['growth', 'settings'];
export const UTILITY_GROUP_LABEL = 'Tools & settings';

// Which groups earn a slot in the inline desktop bar, per role. Anything not
// listed here still renders — it moves into the "More" menu with its label
// intact. 'Patent Engine' is deliberately present for every persona that can
// open it so the flagship IP surface is one click away rather than two.
export const TOP_NAV_PRIORITIES = {
  admin: ['Overview', 'Admin', 'Patent Engine', 'Recruiting', 'Placement Cell', 'Project OS'],
  recruiter: ['Overview', 'Recruiting', 'Community', 'Verified Projects'],
  college_admin: ['Overview', 'Placement Cell', 'Profile / XP', 'Verified Projects'],
  student_early: ['Overview', 'Project OS', 'Patent Engine', 'Profile / XP', 'Community'],
  student_placement: ['Overview', 'Resume OS', 'Job Match', 'Project OS', 'Patent Engine', 'Profile / XP'],
};

// Cap chosen so the primary set fits the inline bar even in the tightest case
// (2xl, where the search control expands to a full pill and the centered
// container is already capped at max-w-7xl). Extra groups flow into the "More"
// menu — which is now actually RENDERED on desktop, not just computed.
// Kept role-agnostic so the bar behaves identically for every role.
export const MAX_TOP_NAV_GROUPS = 6;

function orderGroupsForTopNav(groups, role) {
  const priority = TOP_NAV_PRIORITIES[role] || TOP_NAV_PRIORITIES.student_placement;
  const score = (g) => {
    const idx = priority.indexOf(g.label);
    return idx === -1 ? 100 + NAV_GROUPS.findIndex((x) => x.label === g.label) : idx;
  };
  return groups.slice().sort((a, b) => score(a) - score(b));
}

/**
 * buildNavForRole(role, navItems)
 *
 * @param {string} role  effective role id (see roleCapabilities EFFECTIVE_ROLES)
 * @param {Array}  navItems  the NAV table — [{ id, label, icon, adminOnly }]
 * @returns {{ primary: Array, moreGroups: Array, more: Array }}
 *   primary    — groups rendered inline in the desktop bar
 *   moreGroups — overflow groups, LABEL PRESERVED, rendered in the More menu
 *                and in the mobile drawer
 *   more       — the same overflow items flattened (kept for callers that
 *                just need the flat list)
 */
export function buildNavForRole(role, navItems = []) {
  const byId = Object.fromEntries(navItems.map((n) => [n.id, n]));
  const keep = (id) => !!byId[id] && canSeeScreen(role, id) && (!byId[id].adminOnly || role === 'admin');

  // College / recruiter staff never get the student "Project OS" surface — the
  // only project view they can reach is the read-only verified-project Sandbox.
  // Relabel that group to "Verified Projects" so the top-level menu never shows
  // a misleading "Project OS" entry for staff that just opens the Sandbox.
  const staffVerifiedProjects = role === 'college_admin' || role === 'recruiter';

  const grouped = NAV_GROUPS
    .map((g) => {
      const relabel = staffVerifiedProjects && g.label === 'Project OS';
      return {
        label: relabel ? 'Verified Projects' : g.label,
        short: relabel ? 'Verified Projects' : g.short,
        items: g.ids.filter(keep).map((id) => byId[id]),
      };
    })
    .filter((g) => g.items.length);

  const ordered = orderGroupsForTopNav(grouped, role);
  const primary = ordered.slice(0, MAX_TOP_NAV_GROUPS);
  const placed = new Set(primary.flatMap((g) => g.items.map((it) => it.id)));

  const seen = new Set();
  const moreGroups = [];

  // 1. Overflow journey groups keep their label ("Patent Engine" stays
  //    "Patent Engine" instead of becoming six loose entries).
  for (const g of ordered.slice(MAX_TOP_NAV_GROUPS)) {
    const items = g.items.filter((it) => !placed.has(it.id) && !seen.has(it.id));
    items.forEach((it) => seen.add(it.id));
    if (items.length) moreGroups.push({ label: g.label, short: g.short, items });
  }

  // 2. Utility ids + a final safety sweep over the whole NAV table, so a view
  //    that is not listed in any group can still never become unreachable.
  const utility = [];
  const pushUtility = (id) => {
    if (seen.has(id) || placed.has(id) || !keep(id)) return;
    seen.add(id);
    utility.push(byId[id]);
  };
  for (const id of MORE_IDS) pushUtility(id);
  for (const n of navItems) pushUtility(n.id);
  if (utility.length) moreGroups.push({ label: UTILITY_GROUP_LABEL, short: UTILITY_GROUP_LABEL, items: utility });

  const more = moreGroups.flatMap((g) => g.items);
  return { primary, moreGroups, more };
}

// Back-compat alias for the previous Shell-local helper name.
export const groupsForRole = buildNavForRole;
