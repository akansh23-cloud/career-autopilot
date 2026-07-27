# Fix: Patent Engine (and other groups) missing from the top navigation

## Root cause
`Shell.jsx` computed a `more` overflow list but only ever passed it to
`MobileNav`. The desktop bar rendered `primary.map(...)` and nothing else, so
any group past `MAX_TOP_NAV_GROUPS` (6) was computed and discarded.

`TOP_NAV_PRIORITIES.admin` listed exactly 6 labels, none of them
`Patent Engine`, so for an admin the whole Patent Engine group scored
`100 + index` and fell into the discarded overflow. `Patent Engine` was in
fact absent from *every* role's priority list, so no role could reach it from
the desktop bar. RBAC was never the problem: `canSeeScreen('admin', ...)`
short-circuits to `true`, and all 24 `/api/patent*` routes are `requireAuth`
only.

## Changes
- **`web/src/lib/navGroups.js` (new)** — grouping rules extracted into a pure,
  testable module. Overflow groups keep their label instead of being flattened.
  `Patent Engine` added to the admin and student priority lists.
- **`web/src/components/app/Shell.jsx` (rewritten)** — renders a real desktop
  **More ▾** dropdown for overflow groups; mobile drawer now shows overflow
  groups under their own headings rather than a generic "Tools & settings".
- **`test/navGroups.test.js` (new)** — 30 assertions locking the contract:
  every screen a role may open is reachable from the nav, nothing leaks to a
  role that cannot open it, and no duplicates across primary/More.

## Result
- admin bar: `Home | Admin | Patents | Recruiting | College | Project OS | More ▾`
- student bar: `Home | Résumé | Jobs | Project OS | Patents | Profile | More ▾`

No RBAC, route, or backend behaviour changed.
