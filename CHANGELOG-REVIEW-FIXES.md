# Review-fix release — what changed

Applied against the `career-autopilot-recruiter-bridge-prod` build in response to four
college-pilot reviews. Every change below is in this tree; nothing here is a proposal.

**Verification on this exact tree**

| Check | Result |
|---|---|
| `npm test` | **894 / 894 passing** (883 original + 11 new smoke tests) |
| `npm run build` | clean |
| `npm run lint` | **0 errors**, 1,627 warnings (was 1 error, 1,619 warnings) |
| Theme tokens in compiled CSS | `html.light`, `--bg-base`, `--text-primary`, `--brand-text` present |
| Tailwind theme utilities generated | `.text-fg`, `.bg-elevated`, `.border-subtle`, `.bg-surface-1` present |

---

## Review 1 — "need a great Light mode"

There was no theme system at all: `index.css` hardcoded `color-scheme: dark`, and there were
**3,475 dark-coupled utility class usages across 94 files**.

- **`web/src/lib/theme.js`** *(new)* — system / light / dark, persisted, applied synchronously
  before React mounts so a light-mode load never flashes the dark shell. Defaults to `system`.
- **`web/src/index.css`** — CSS custom-property token layer for both themes. `body`, `.panel`,
  `.glass`, `.gradient-border` and the scrollbar now read tokens. `color-scheme: dark` removed
  (set per resolved theme by `theme.js`).
- **`tailwind.config.js`** — theme utilities: `fg` / `fg-secondary` / `fg-muted` / `fg-inverse`,
  `base` / `elevated` / `sunken`, `surface-1` / `surface-2` / `surface-hover`, `subtle` /
  `strong`.
- **`scripts/theme-codemod.mjs`** *(new)* — dry-run by default. Applied here: **3,337
  replacements across 95 files**.
- **Light-mode contrast corrections.** The foil lilac `#BCA8FF` sits at roughly 2:1 on white and
  fails WCAG AA, so light mode substitutes `#5B47C4`; `--ok` `#57E6A8` → `#0E8F5C`; `--warn`
  `#EAC97C` → `#8A6A12`. `.text-aurora` / `.text-flow` drop the gradient for a solid brand
  colour in light.
- **Deliberately skipped:** `resumeRenderer.js`, `resumeTemplates.js`,
  `resumeTemplateRegistry.js` (these generate the printed PDF, which must stay ink-on-white
  regardless of app theme) and `Atmosphere.jsx` / `NetworkSphere.jsx` (additive-light canvas
  effects — dimmed to 0.28 opacity in light rather than rewritten).

**Still to do by hand:** wire the toggle into `Shell.jsx` / `Settings.jsx` (the provider is
ready — `useTheme()`), pass a light theme to `MermaidDiagram.jsx`, and review the ~46
`text-[#…]` literals. Then run axe/Lighthouse on Dashboard, Jobs, Project Studio and College
Workspace in light mode.

---

## Review 2 — "JobSearch is unable to find any job with any filter"

Three stacked causes. The middle one was the surprise.

### Your v2 engine was dead code

`server/utils/jobSearchEngine.js` — a tested five-step progressive fallback ladder whose header
says it *"fixes the chronic 'No matching jobs found' problem"* — **was never imported by
`server.js`**. Nor was `server/utils/jobFilters.js`. Nor did `views/Jobs.jsx` import
`lib/jobFilterOptions.js`; it defined its own three-value array instead.

The live route gated in one hard pass (`role` → `location` → `mode`) and returned an empty
array the moment any filter failed, with no explanation.

- **`server/routes/jobSearchRoute.js`** *(new)* — wires both engines in. The 167-line inline
  block in `server.js` is replaced by a 24-line registration call. Fetching, verification and
  caching are unchanged; only gating, ranking and the returned explanation differ.
- **`GET /jobs/filters`** *(new)* — serves the canonical vocabulary so frontend and backend can
  never drift again.
- **`views/Jobs.jsx`** — now uses `jobFilterOptions.js`, gained the experience and job-type
  filters the backend always supported, migrates persisted legacy values
  (`On-site/Hybrid` → `hybrid`), renders the fallback explanation, and offers a
  "clear all filters" action on an empty result.

### A real bug in the engine itself

`progressiveGate()` only returns a step's candidates if that step reaches `minResults`. If the
ladder exhausts without any step clearing the bar it returns **empty even when the last step
found jobs** — with `minResults: 5` and level 4 finding 3, you get zero. That reproduces the
exact symptom the engine was written to fix. The route retries with `minResults: 1`; the
comment is marked *do not remove*. Worth fixing in the engine properly.

### Other fixes

- **Empty results are never cached.** The old route cached unconditionally for 90s, so one bad
  upstream minute poisoned every identical search.
- **Default freshness 7d → 30d.** A one-week hard wall against four remote-only boards was the
  single biggest cause of empty sets.

### The actual root cause, which code cannot fix

Your four active sources are remote-only (Remotive, RemoteOK, Jobicy) or European (Arbeitnow).
**None list Indian jobs.** A student searching "DevOps Engineer, Pune" gets zero legitimately.
`.env.example` documented no job-provider key at all.

`.env.example` now documents `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` (free tier, real `in` coverage,
connector already exists at `server.js:438`), `RAPIDAPI_KEY`, and `SERPAPI_KEY`. Until one is
set, the route returns a `coverageHint` explaining the gap instead of a silent blank page.

**Set the Adzuna key before the campus demo — nothing else in this release creates Indian
listings.**

---

## Review 3 — "Project engine crashed while going through flow"

Two independent causes, one backend and one frontend.

### The process was dying

Express 4 does not catch rejections from `async (req, res)` handlers, and this app registered
~100 of them with almost no try/catch — `collegeRoutes.js` 39 handlers / 0 try blocks,
`teamProjectRoutes.js` 13 / 0, `projectIntelligenceRoutes.js` 16 / 1. No async wrapper, no
error middleware, no process guards. On Node 18+ one throw **terminates the process**.

- **`server/utils/asyncRoute.js`** *(new)* — `patchAppAsync(app)` wraps every handler registered
  after it (all ~100, zero edits to route files), `installProcessGuards(logger)` catches
  escapees, `errorMiddleware(logger)` returns a clean 500 with a `requestId` the student can
  quote.

### A crash white-screened the whole app

The only error boundary was `TabCrashBoundary`, local to `ProjectStudio.jsx`. `App.jsx`
rendered `<ViewCmp />` raw, so a throw in any other view unmounted the entire React tree —
blank page, no navigation, no error text. That's why the report had no detail.

- **`web/src/components/AppErrorBoundary.jsx`** *(new)* — wraps the view render, clears on
  navigation (`resetKey`), offers retry / home / reload / copy-details.
- **`POST /api/ops/client-error`** *(new, in `opsRoutes.js`)* — crash telemetry, CSRF-exempt
  because a crashed UI can't be relied on to attach a token.

### The blocker that wasn't in any review

`globalLimiter` (300 req/min, keyed by IP for unauthenticated requests) was mounted **before**
`express.static`, so every JS chunk, font and image counted against it. A college lab shares one
NAT public IP; thirty students cold-loading a Vite SPA is 1,000+ requests in the first minute.
Result: random 429s across the whole app, indistinguishable from "it broke" — and it explains
*"was working fine till yesterday"* exactly, since it depends on how many people are on the
network, not on any code change.

Moved after `express.static` with asset extensions exempted. `.env.example` now documents
campus-scale rate limits (`RATE_GLOBAL_PER_MIN=2000` etc.).

---

## Review 4 — "Assigned projects progress can't be seen for individually"

A missing feature, not a bug. `assignRoles()` already gave each member a `modules` array
described as *"the concrete, checkable deliverables this person owns"* — but grepping for
`memberProgress` / `moduleStatus` / `perMember` returned **zero hits codebase-wide**. Submission
was one team-level URL; `summarizeAssignment()` was team-level only; none of the 13 team-project
routes was member-scoped.

- **`server/utils/teamProgressEngine.js`** *(new)* — deterministic per-member scoring.
- **`server/utils/teamContributionVerifier.js`** *(new)* — real GitHub commit attribution via
  the existing `ghGet` client.
- **`server/routes/teamProgressRoutes.js`** *(new)* — 5 endpoints, mounted alongside
  `teamProjectRoutes.js` so its 586 lines of working tenancy logic stay untouched.
- **`web/src/components/college/TeamMemberProgress.jsx`** *(new)* — coordinator view, wired into
  the `TeamProjectsPanel` drilldown.
- **`web/src/components/college/MyModuleChecklist.jsx`** *(new)* — student view, wired into
  `MyTeamProject`.
- **`teamProjectRoutes.js`** — seeds `memberProgress` at assign time. Existing projects
  self-heal: `reconcileProgress()` rebuilds missing rows from the brief on first read.

**No `db.js` changes needed** — `updateTeamProject` already accepts an arbitrary patch.

### Endpoints

| Method | Path | Who |
|---|---|---|
| GET | `/api/college/team-projects/:id/progress` | coordinator |
| POST | `/api/college/team-projects/:id/sync-commits` | coordinator |
| POST | `/api/college/team-projects/:id/link-github` | coordinator |
| GET | `/api/my/team-projects/:id/progress` | student (self) |
| PATCH | `/api/my/team-projects/:id/modules/:moduleName` | student (self) |

### Design decisions to know before you demo it

- **Evidence beats self-report.** A module ticked with an evidence URL scores 1.0; ticked
  without one scores 0.4, and the coordinator UI labels it *unverified*. A placement cell that
  can't tell those apart is being handed a number it shouldn't trust.
- **"Could not check" is a third state, never zero.** A GitHub rate limit sets `unavailable`,
  the commit term is dropped entirely, and modules carry full weight. A student is never
  penalised for your infrastructure — same contract as `proofVerification.js`.
- **A student cannot tick a teammate's module** (`module_not_owned`).
- **Unmatched GitHub logins are surfaced, not guessed.** Wrong attribution is worse than
  missing attribution: it tells a coordinator a student did nothing when you simply failed to
  identify them. `link-github` lets them fix it.
- **Imbalance flags are coordinator-only** — stripped from the student payload so this never
  becomes a place to blame a teammate.

Verified with a deliberately lopsided team (Asha 40 commits + evidenced module, Bhavin 3,
Chirag 0): team 22%, spread 63, flags `carrying_team` (93% of commits), `low_contribution` ×2,
`not_started`, `uneven_team`.

---

## Test coverage

`test/routes.smoke.test.js` *(new, 11 tests)*. Your 883 tests were green while three shipped
modules were unreachable from the running app — unit tests cannot catch "this module is never
imported". These boot the real Express app and assert on real HTTP responses.

Also fixed: `test/api.test.js` → *"root serves the SPA html"* was **already failing** in the
original zip (404, because the archive ships without `dist/` or `legacy_index.html`). Building
the frontend resolves it. Worth knowing your baseline was 882/883, not 883/883.

---

## Lint

`npm run lint` went from **1 error** to **0 errors**. The error was pre-existing and unrelated
to these fixes: `InterventionsPanel.jsx:88` carried
`// eslint-disable-next-line react-hooks/exhaustive-deps`, but this project's flat config never
registers `eslint-plugin-react-hooks`, so ESLint 9 reported the unknown rule as a hard error on
every run. The dead comment is replaced with a plain comment explaining why the deps array is
intentionally narrow.

Warnings went 1,619 → 1,627. All eight are the same pre-existing false positive: the config has
no React plugin, so JSX components are reported as "defined but never used". Three are the new
components, three are their imports, two are codemod-adjacent. If you want these gone, add
`eslint-plugin-react` — it would also clear several hundred existing warnings.

---

## Deployment checklist

1. `npm install && npm run build` — the build is required; the app 404s at `/` without `dist/`.
2. Set `ADZUNA_APP_ID` / `ADZUNA_APP_KEY`. **Without this, job search still returns nothing for
   Indian searches.**
3. Set `GITHUB_TOKEN`. Without it the whole server shares GitHub's anonymous 60/hour limit and
   commit attribution will mostly report "could not check".
4. Raise the rate limits for a campus deployment (see `.env.example`).
5. Wire the theme toggle into `Shell.jsx` / `Settings.jsx`.
6. Click through Jobs, Project Studio, College Workspace and Recruiter Console in **both**
   themes before the visit.
