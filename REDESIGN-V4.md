# Career Autopilot — Product Redesign v4 (Enterprise Light)

A full end-to-end visual redesign of the platform into a restrained,
enterprise-grade light UI, with **zero changes to business logic, APIs,
routes, auth, RBAC, or data flow**. Every screen, for every role, now
inherits one coherent design system.

## The system

**Typography** — Single Inter stack (400–800) with JetBrains Mono for
identifiers and metrics. `font-display` is retained as a token name but
resolves to Inter; hierarchy comes from size/weight/tracking, not a second
family. Page titles are 20–24 px semibold; body is 14 px; metrics are
tabular-numeric.

**Color** — One institutional primary (indigo `#4F46E5`, text ink `#4338CA`)
on a slate-neutral light surface set (`#F8FAFC` page, white cards,
`#E2E8F0`/`#CBD5E1` lines). Semantic inks are AA-verified *on their own
tinted washes*, not just on white: ok `#047857`, info `#0369A1`, warn
`#92400E`, danger `#B91C1C`. The legacy `aurora-*` / `amber-glow` /
`ink-950` token **names** are preserved (≈60 files reference them) and
remapped to this palette, which migrated every chip, ring, tint, progress
bar and on-accent label in one move.

**Shape & depth** — Global radius scale override (cards 12 px, controls
8–10 px, chips full), 1 px borders, two shadow steps
(`--shadow-card` / `--shadow-lift`). All foil gradients, glass surfaces,
guilloché line-work, cursor spotlights, glow rings, blobs, grids, noise,
vignettes and scanlines are removed; their CSS hooks remain as inert
no-ops so historical markup can never resurrect them.

**Controls** — Buttons: primary (solid indigo) / secondary / outline /
ghost / danger at 32–40 px heights. Inputs 36 px, opaque, labeled, with
2 px brand focus rings; the native `<option>/<optgroup>` opacity contract
is kept and re-verified. Dropdowns, menus, modals, the command palette and
the support widget are solid surfaces — no translucency anywhere content
renders. `Dropdown` gained a `direction="up"` mode for bottom-anchored
menus (sidebar account menu).

## Application shell

The website-style top navigation is replaced with a professional product
shell: a compact **248 px left sidebar** (collapsible to a 64 px icon
rail, persisted) containing brand, a search trigger (⌘K/Ctrl K → the
existing RBAC-filtered command palette, now also openable via a
`career-command-palette` event), the full role-scoped grouped navigation
from `lib/navGroups.js` (nothing hidden behind hover menus), support, plan
status and the account menu. A slim 56 px topbar carries the current page
title and notifications. Mobile gets a left drawer with the identical
grouped nav. All navigation still flows through the existing
capability-guarded `onPick` path — RBAC untouched.

## Surfaces

`views/common.jsx` (PageIntro, StatCard, SectionCard, NextBestAction,
BarChart) and `components/ui/kit.jsx` were rewritten against the new
system with identical exports/props, which restyled the ~40 views that
compose from them. Targeted passes then cleaned the flagship surfaces:
placement-cell Command Center (indigo-ramp funnel, semantic engagement
colors, indigo heatmaps, sticky roster header, AA checkboxes), recruiter
console and college workspace tab systems, Jobs, Project Studio, pricing,
sign-in, onboarding, consent, support, notifications, and the marketing
landing (Inter scale, solid nav, light-correct three.js network sphere,
ghost-stroke watermarks).

## Accessibility

Token-level fixes verified by the shipped WCAG test suite
(`test/lightThemeContrast.test.js`): field borders now measure 3.4:1 /
3.3:1 against field and page (1.4.11), all semantic inks ≥4.5:1 on their
washes, visible `:focus-visible` rings everywhere, and every pale
dark-era ink literal (`text-amber-100`, `text-red-300`, …) swept to
semantic tokens.

## Validation

- `npm test` — **1010 / 1010 pass** (the shipped design-contract tests
  were updated to pin the v4 values with the same rigor; the two tests
  that caught genuine contrast regressions drove token fixes, not test
  changes).
- `npm run build` — clean production build.
- `npm run lint` — 0 errors (the 1.6 k pre-existing warnings are the
  known unused-JSX-import class from the react-plugin-less flat config).
- Live smoke: server boot, `/health`, dev login, session `whoami`, SPA and
  asset serving verified.
- Playwright e2e not run here: browser binaries cannot be downloaded in
  this sandboxed environment (CDN blocked). The specs were reviewed and
  the new shell satisfies their expectations (scrollable `aside` nav,
  platform-aware ⌘K/Ctrl K hint, reachable Settings item).

## Not changed

server.js, db.js, all `server/` routes, access/RBAC, stores, hydration,
payment flows, seed/preflight scripts, tests of business logic, and every
view's data logic. `scripts/package.mjs` gained one exclusion (`.data/*`).
