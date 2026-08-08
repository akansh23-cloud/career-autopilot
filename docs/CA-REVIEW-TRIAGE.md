# Career Autopilot — review triage before college onboarding

Analysed `career-autopilot-recruiter-bridge-prod.zip` (486 files, 8.1 MB, `server.js` 323 KB,
`db.js` 292 KB, 94 frontend view/component files).

**Headline:** the four reviews are not four independent bugs. Three of them share one root
cause — **the app has no error handling at either layer** — and one is a genuine missing
feature. Two of them are made much worse by a rate limiter that a college computer lab will
trip in the first thirty seconds.

There's also a structural finding worth acting on immediately: **your best job-search code is
not wired into the app.**

---

## Priority order

| # | Issue | Severity | Root cause | Effort |
|---|---|---|---|---|
| 0 | Rate limiter runs before static assets | **Blocker for campus demo** | Middleware ordering | 5 min |
| 1 | "Project engine crashed" | **P0** | ~100 async route handlers with no try/catch, no error middleware, no process guards | 30 min |
| 2 | Blank screen on crash | **P0** | Exactly one error boundary in the whole app | 20 min |
| 3 | Job search returns nothing | **P1** | v2 search engine is dead code; live route has no fallback; no India job source | 1 day |
| 4 | No individual progress on assigned projects | **P1** (feature gap) | Per-member progress is not modelled, stored, or exposed | 2 days |
| 5 | Light mode | **P1** | 3,475 dark-coupled classes, no token layer | 1–3 days |

Everything at P0 and #0 is in the attached `fixes/` pack and can ship today.

---

## #0 — The rate limiter will take down your campus demo

`server.js:179`

```js
app.use(globalLimiter);          // 300 requests / minute, keyed by IP
...
app.use(express.static(UI_DIR)); // line ~190
```

`globalLimiter` is mounted **before** static file serving, so every JS chunk, CSS file, font
and image counts against the ceiling. `keyGen` (`security.js:160`) falls back to
`ip:${req.ip}` for any unauthenticated request — and static asset requests are
unauthenticated.

A college computer lab sits behind **one NAT public IP**. A cold load of your Vite SPA is
dozens of asset requests. Thirty students opening the app at the start of a session is
comfortably 1,000+ requests in the first minute against a 300/min bucket.

What that looks like from the room: assets 429, screens render half-loaded, `/jobs/search`
429s, project generation 429s. It is indistinguishable from "the app broke" — and it matches
**"was working fine till yesterday"** precisely, because it depends on how many people are on
the network, not on any code change.

**Fix (5 minutes):**

```js
// Move globalLimiter to AFTER express.static, and exempt static paths.
app.use(express.static(UI_DIR));

app.use((req, res, next) => {
  if (req.method === 'GET' && /\.(js|mjs|css|woff2?|png|jpe?g|svg|ico|webp|map)$/i.test(req.path)) return next();
  return globalLimiter(req, res, next);
});
```

Also raise `RATE_GLOBAL_PER_MIN` for the college deployment. Shared-IP cohorts need headroom:

```
RATE_GLOBAL_PER_MIN=2000
RATE_JOBS_PER_HOUR=200
RATE_GENERATION_PER_HOUR=200
```

Longer term, key the limiter on session ID with an IP fallback rather than raw IP, so one lab
can't starve itself.

---

## #1 — "Project engine crashed while going through flow"

This is the most serious finding in the codebase.

```
server/routes/collegeRoutes.js            39 async handlers,  0 try blocks
server/routes/teamProjectRoutes.js        13 async handlers,  0 try blocks
server/routes/problemIntelligenceRoutes.js 29 async handlers,  4 try blocks
server/routes/projectIntelligenceRoutes.js 16 async handlers,  1 try block
server/routes/careerIntelligenceRoutes.js   7 async handlers,  4 try blocks
```

You're on **Express 4.19** (`package.json`). Express 4 does **not** catch rejected promises
from `async (req, res)` handlers. There is also:

- no `asyncHandler` / `express-async-errors` wrapper anywhere (grepped — zero hits)
- no global error middleware (`app.use((err, req, res, next) => …)` — zero hits)
- no `process.on('unhandledRejection')` or `('uncaughtException')` — zero hits

So a single throw inside any of those ~100 handlers becomes an unhandled rejection, and on
Node 18+ the default `--unhandled-rejections=throw` **terminates the process**. On a
long-running host that is a full outage for everyone; on Vercel it kills the invocation and
the client hangs. That is literally "the engine crashed."

Note that `projectIntelligenceRoutes.js` has this in its own header comment:

> *"Nothing here throws to the client; failures degrade."*

That is the intent, but only one of its sixteen handlers has a try block. The intent was
never implemented.

**Fix:** `fixes/server/utils/asyncRoute.js` — drop-in, three lines in `server.js`:

```js
import { patchAppAsync, installProcessGuards, errorMiddleware } from './server/utils/asyncRoute.js';

const app = express();
patchAppAsync(app);              // ← immediately after; auto-wraps every later handler
installProcessGuards(logger);    // ← before routes

// …all existing route registration, unchanged…

app.use(errorMiddleware(logger)); // ← after all routes, BEFORE the /jobs /auth 404 catch-all at line 5671
```

`patchAppAsync` is the zero-diff path: it monkey-patches `app.get/post/put/patch/delete/use`
so all ~100 existing handlers get wrapped without editing a single route file. Errors go to
`next(err)` → your error middleware → a clean 500 with a `requestId` the student can quote,
instead of a dead process.

**Do this before the college onboarding.** It is a half-hour change that removes an entire
class of outage.

---

## #2 — Nothing catches a render crash

`web/src/App.jsx:333`

```jsx
<ViewCmp go={navigate} {...(renderActive === active ? viewParams : {})} />
```

Rendered raw. The **only** error boundary in the codebase is `TabCrashBoundary`, defined
locally inside `views/ProjectStudio.jsx:105`. Every other view — Jobs, ProjectBuilder,
ProjectWorkspace, CollegeWorkspace, MyTeamProject, RecruiterConsole — is unprotected.

A throw in any of them unmounts the entire React tree. The student gets a **white page with
no navigation and no error text**. That's why the review said "crashed" with no further
detail — there was nothing on screen to report.

**Fix:** `fixes/web/src/components/AppErrorBoundary.jsx`

```jsx
import AppErrorBoundary from './components/AppErrorBoundary.jsx';

<AppErrorBoundary resetKey={renderActive} onGoHome={() => navigate('dashboard')}>
  <ViewCmp go={navigate} {...viewParams} />
</AppErrorBoundary>
```

`resetKey={renderActive}` clears the error on navigation, so a student is never stuck. It also
POSTs to `/api/ops/client-error` — worth adding that endpoint to `opsRoutes.js` so you get
real crash telemetry from the pilot cohort instead of relying on students to report it.

---

## #3 — "JobSearch is unable to find any job with any filter"

Three separate problems stack here. The middle one is the surprise.

### 3a. Your v2 search engine is not wired in

`server/utils/jobSearchEngine.js` is a well-built 247-line engine: a five-step progressive
fallback ladder (exact → 30-day → source-listed → broad role → global), per-cause removal
counts, and a `summarizeSearch()` that explains results to the user. Its header comment reads:

> *"Fixes the chronic 'No matching jobs found' problem."*

**It is never imported by `server.js`.** Grepping for `progressiveGate` outside the module
returns only `test/jobSearchEngine.test.js`.

Same for `server/utils/jobFilters.js` (canonical work-mode / experience / job-type
vocabulary) — imported only by its own test. And `web/src/lib/jobFilterOptions.js` is not
imported by `views/Jobs.jsx`, which defines its own three-value array instead:

```js
// Jobs.jsx:15
const MODES = ['Any', 'Remote', 'On-site/Hybrid'];
```

The live route (`server.js:982`) uses an inline gate — `validRoleMatch` → `validLocationMatch`
→ `validModeMatch` — that **drops a job at the first failing filter and returns an empty array
with no fallback**. Exactly the behaviour the v2 engine was written to eliminate.

This is worth pausing on: **615 tests pass and the feature is still broken**, because the
tests cover modules the running app never calls. Add one integration test that boots the
Express app and asserts `GET /jobs/search` returns jobs — a route-level smoke test would have
caught this.

### 3b. You have no Indian job source

`SOURCES` (`server.js:328`) is four free APIs:

| Source | Coverage |
|---|---|
| Remotive | Remote-only, US/EU skew |
| RemoteOK | Remote-only, US skew |
| Jobicy | Remote-only |
| Arbeitnow | Europe (mostly Germany) |

Adzuna, JSearch/RapidAPI and USAJobs exist in the code but are key-gated — and
**`.env.example` documents none of `RAPIDAPI_KEY`, `ADZUNA_APP_ID`, or `SERPAPI_KEY`**, which
strongly suggests production is running with none of them set.

So a UPES or Bharati Vidyapeeth student searching *"DevOps Engineer, Pune"* is querying four
remote-job boards with no Indian listings. `validLocationMatch` does let bare-`Remote` and
`worldwide` listings through, which is why it sometimes returns a handful — but the expected
result for an India-located search is **zero**. It "worked till yesterday" because two or three
worldwide-remote listings happened to fall inside the window.

### 3c. Default freshness is a hard 7-day wall, and empty results get cached

- `maxFreshDaysFromQuery` defaults to `7d` (`freshness.js`).
- Undated jobs are **excluded** from any bounded window — and RemoteOK/Arbeitnow date parsing
  is fragile, so a lot of real jobs become undated.
- `jobCacheSet` (`server.js:1137`) caches the payload **unconditionally**, including
  zero-result payloads, for 90 seconds. One bad upstream minute poisons every identical search
  for the next minute and a half.

### Fix, in order of value

1. **Get an India source.** This is the actual fix; everything else is polish. Adzuna has a
   free tier with real `in` country coverage and the connector already exists at
   `server.js:438` — you only need `ADZUNA_APP_ID` / `ADZUNA_APP_KEY`. JSearch on RapidAPI
   also covers India well. Document both in `.env.example`.
2. **Wire in `progressiveGate`.** The code is written and tested. Replace the inline gate in
   `/jobs/search` with a call to `progressiveGate(jobs, criteria, helpers, { minResults: 5 })`
   and surface `summarizeSearch()` above the results — so the student sees *"0 exact matches;
   showing 18 broader source-listed jobs"* instead of an empty page.
3. **Never cache empties:** `if (kept.length) jobCacheSet(cacheKey, payload);`
4. **Default freshness to `30d`, not `7d`**, and expose the removal counts in the UI so a
   student can see *which* filter emptied their search.
5. **Point `Jobs.jsx` at `jobFilterOptions.js`** and add the experience/job-type filters that
   already exist backend-side. Right now the UI can't even express them.
6. **Show source health.** The route already returns a `sources[]` array with per-source
   `status` (`fetched` / `failed` / `no_results`). Render it. "Remotive: 12, RemoteOK: failed"
   turns a mystery into a diagnosable state — and it's already in the payload.

---

## #4 — "Assigned projects progress can't be seen individually"

The reviewer is right, and this is a feature gap rather than a bug. There is nothing to fix —
there is something to build.

What exists today (`server/utils/teamProjectEngine.js:433`, `assignRoles`): every member gets
a role, an area, and a `modules` array described in the code as *"the concrete, checkable
deliverables this person owns."*

What does not exist:

- **No per-member state.** `db.js:1217` — the record is `{ id, title, members, brief,
  submission, verification }`. Grepping for `memberProgress`, `moduleStatus`, `perMember`,
  `individualProgress` returns **zero hits across the entire codebase**.
- **Submission is team-level.** `submitTeamProjectLink` (`db.js:2047`) stores one `liveUrl`,
  one `repoUrl`, one `notes`, for the whole team.
- **Summary is team-level.** `summarizeAssignment` returns `status`, `overdue`,
  `hasSubmission`, `verified`, `memberCount`, `daysLeft`. Nothing per student.
- **No route.** `teamProjectRoutes.js` has 13 endpoints; none is scoped to a member.

So a coordinator sees "Team Alpha: submitted" and has no way to know whether one student did
everything and three coasted. For a placement cell, **that is the whole point of the feature** —
it's how they decide who is actually employable.

### Recommended design

Small, deterministic, and consistent with the rest of your architecture (backend-owned
scoring, evidence-based verification, no self-reported ticks).

**1. Model per-member module state.** Extend the team project record:

```js
memberProgress: {
  [studentId]: {
    modules: { [moduleName]: { status: 'todo'|'in_progress'|'done', updatedAt, evidenceUrl } },
    commits:   { count, lastCommitAt, verifiedAt },   // from the GitHub connector
    percent:   0,                                     // computed, never stored as truth
  }
}
```

**2. Derive the percentage, don't trust it.** You already have `proofVerification.js`
(SSRF-guarded, GitHub repo/README/CI reads) and `progressCalculator.js`. Compute per-member
progress as a weighted blend of:

- modules marked done **that have an evidence URL** (self-report alone is worthless to a TPO)
- commits attributable to that student in the team repo (`verifyGithubRepo` already fetches
  contributor data)
- their own workspace task completion, if they have a personal workspace

This matches the pattern you use everywhere else: deterministic core, evidence at the edges.

**3. Add three routes** to `teamProjectRoutes.js`:

```
PATCH /api/my/team-projects/:id/modules/:moduleId    — student marks own module + evidence URL
GET   /api/college/team-projects/:id/progress        — coordinator: per-member breakdown
POST  /api/college/team-projects/:id/sync-commits    — pull contributor stats from the repo
```

**4. Surface it in `TeamProjectsPanel.jsx`** as a per-member row: name, role, module
checklist, commit count, last-active date, derived %. Add a **contribution imbalance flag**
when one member is above 60% or below 10% of team commits — that single signal is the thing a
placement coordinator will actually use, and it's cheap to compute.

**5. Mirror it in `MyTeamProject.jsx`** so students see their own modules and can check them
off. Visible peer progress also drives completion.

---

## #5 — Light mode

There is currently **no theme system at all**. `index.css:15` hardcodes `color-scheme: dark`,
`body` is `#070908`, and there are **3,475 dark-coupled class usages across 94 files**
(`text-white` ×359, `bg-white/*` ×532, `border-white/*` ×652, plus `text-slate-*` and
`bg-ink-*`).

A find-and-replace across 94 files is a multi-day job with a high regression rate. Do it with
tokens instead. Full instructions in `fixes/docs/LIGHT-MODE-TOKEN-MAP.md`; the pack includes:

- `fixes/web/src/index.light-tokens.css` — CSS custom property layer for both themes, with
  contrast-corrected light brand values (your foil lilac `#BCA8FF` is ~2:1 on white and fails
  WCAG AA; the light token drops it to `#5B47C4`)
- `fixes/web/src/lib/theme.js` — system/light/dark provider, persisted, no flash on load
- `fixes/scripts/theme-codemod.mjs` — dry-run-by-default codemod

I ran the codemod against your actual tree: **3,326 replacements across 93 files, 96%
coverage.** It deliberately skips `resumeRenderer.js`, `resumeTemplates.js`,
`resumeTemplateRegistry.js`, `Atmosphere.jsx` and `NetworkSphere.jsx` — the resume renderers
generate the printed PDF, which must stay dark-ink-on-white regardless of app theme, and the
two canvas components use additive-light effects that turn to grey mud on a white background.

**Default the theme to `system`.** A placement cell demoing on a projector in a bright room
gets light automatically — which is probably what generated this review in the first place.

---

## What I'd do before the college onboarding

**Today (about 2 hours, all in the `fixes/` pack):**

1. Move `globalLimiter` after `express.static` and exempt asset paths — #0
2. `patchAppAsync` + `installProcessGuards` + `errorMiddleware` — #1
3. `AppErrorBoundary` around `<ViewCmp />` — #2
4. Raise the rate-limit env vars for the college deployment

That removes every "it crashed" and most "it stopped working" reports.

**This week:**

5. Add `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` (free tier, India coverage) and document them in
   `.env.example`
6. Wire `progressiveGate` into `/jobs/search`; stop caching empty results; default freshness
   to 30d; render the `sources[]` health strip
7. Ship light mode Steps 1–4 (tokens + codemod + toggle), default `system`

**Before you promise the team-project feature to the coordinator:**

8. Build per-member progress (#4). It is ~2 days and it is the feature the placement cell will
   judge the product on. If it won't be ready, say so explicitly in the walkthrough rather than
   demoing the team view and letting them assume individual tracking exists.

**Process change worth making:**

9. Add route-level smoke tests that boot Express and hit `/jobs/search`,
   `/api/college/team-projects`, and the project generation endpoints. Your 615 tests are green
   while three shipped modules are unreachable from the running app — unit coverage is not
   telling you whether features work.

---

## One thing to flag honestly

Sunita at Bharati Vidyapeeth is expecting a campus visit. Four reviews came back and three of
them describe crashes or dead features — that's a signal the product isn't demo-stable yet, not
just that it needs polish. The #0 and P0 fixes are cheap and change that materially, so they're
worth doing before the visit rather than after.

If you can't get per-member progress (#4) and a working India job source (#3b) done in time, I'd
scope the demo around what is genuinely solid — Resume OS, Project Studio, the proof/verification
flow — and describe team-project individual tracking as on the roadmap. A coordinator who
discovers a gap during a live demo is a much worse outcome than one who was told about it.
