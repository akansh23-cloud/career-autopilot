# Integration guide

Everything in this pack is a **new file**. Nothing here overwrites an existing one, so you can
copy the tree in and integrate one item at a time. The only edits to your existing code are the
small wiring snippets listed below.

Copy the tree into your repo root:

```bash
cp -r fixes/server/*   server/
cp -r fixes/web/src/*  web/src/
cp    fixes/scripts/theme-codemod.mjs scripts/
```

---

## 1 — Rate limiter ordering (5 min, no new files)

`server.js`, currently line 179. Move `globalLimiter` **after** `express.static` and exempt
static assets:

```js
// DELETE the existing `app.use(globalLimiter);` at line 179.

app.use(express.static(UI_DIR));

app.use((req, res, next) => {
  if (req.method === 'GET' && /\.(js|mjs|css|woff2?|png|jpe?g|svg|ico|webp|map)$/i.test(req.path)) return next();
  return globalLimiter(req, res, next);
});
```

Then, for the college deployment:

```
RATE_GLOBAL_PER_MIN=2000
RATE_JOBS_PER_HOUR=200
RATE_GENERATION_PER_HOUR=200
```

**Why:** a lab shares one NAT IP and `keyGen` falls back to `ip:` for unauthenticated
requests — which every static asset is. Thirty students cold-loading a Vite SPA blows a
300/min bucket in seconds.

---

## 2 — Async crash protection (30 min)

`server/utils/asyncRoute.js`. Three insertions in `server.js`:

```js
// with the other imports
import { patchAppAsync, installProcessGuards, errorMiddleware } from './server/utils/asyncRoute.js';

// immediately after `const app = express();`  (line ~104)
patchAppAsync(app);
installProcessGuards(logger);

// AFTER every route registration, BEFORE the 404 catch-all at line 5671
app.use(errorMiddleware(logger));
```

`patchAppAsync` wraps every handler registered after it — that's all ~100 existing async
handlers, with zero edits to your route files. Order matters: it must run before any
`app.get/post/...` call.

**Verify it works:**

```js
app.get('/__boom', async () => { throw new Error('kaboom'); });
// Before: process dies.  After: 500 JSON with a requestId, server still up.
```

Delete the probe afterwards.

---

## 3 — App error boundary (20 min)

`web/src/components/AppErrorBoundary.jsx`. In `App.jsx` around line 333:

```jsx
import AppErrorBoundary from './components/AppErrorBoundary.jsx';

<AppErrorBoundary resetKey={renderActive} onGoHome={() => navigate('dashboard')}>
  <ViewCmp go={navigate} {...(renderActive === active ? viewParams : {})} />
</AppErrorBoundary>
```

It POSTs crash details to `/api/ops/client-error`. Add that endpoint to `opsRoutes.js` —
even a 10-line logger gives you real crash telemetry from the pilot cohort instead of
waiting for students to report white screens.

---

## 4 — Job search rewire (half a day)

`server/routes/jobSearchRoute.js`. This puts your orphaned `jobSearchEngine.js` and
`jobFilters.js` back into the live path.

1. **Delete** the whole `app.get('/jobs/search', jobsLimiter, ...)` block —
   `server.js` line 982 to roughly line 1140 (ends just before the `/health` route).
2. Add the import with the other route imports:
   ```js
   import { registerJobSearchRoute } from './server/routes/jobSearchRoute.js';
   ```
3. Register it **after** `balancedBySource` is defined:
   ```js
   registerJobSearchRoute(app, {
     jobsLimiter, SOURCES, configuredSources, sourceKey, sourceAllowed,
     requestedSources, inferSource, sourceFromUrl, balancedBySource,
     jobKey, verifyMany, withBudget, jobCacheGet, jobCacheSet,
     maxFreshDaysFromQuery, passesFreshness,
     validRoleMatch, validLocationMatch,
     jsearchCountry, logger,
     RAPIDAPI_KEY, RAPIDAPI_HOST, STRICT_JOB_VERIFICATION, JOB_SEARCH_BUDGET,
   });
   ```

Every dependency already exists in `server.js`. Nothing about how jobs are *fetched* changes —
only how they're gated, ranked and explained.

### What changes behaviourally

| | Old route | New route |
|---|---|---|
| Filter gating | one hard pass, empties on first failure | 5-step fallback ladder |
| Default freshness | `7d` | `30d` |
| Experience / job-type filters | not supported | supported (`jobFilters.js`) |
| Legacy mode values | inconsistent | normalised (`On-site/Hybrid` → `hybrid`) |
| Empty results | cached 90s | never cached |
| Empty explanation | none | per-cause removal counts + a sentence |

### A real engine bug I hit while testing

`progressiveGate()` only returns a step's candidates if that step reaches `minResults`. If the
ladder exhausts without any step clearing the bar, it returns an **empty list even when the
last step found jobs** — with `minResults: 5` and level 4 finding 3, you get zero. That
reproduces the exact symptom the engine was written to fix.

The route works around it by retrying with `minResults: 1`. The comment in the code is marked
*do not remove*. Worth fixing in `jobSearchEngine.js` properly at some point.

**Verified behaviour** (three seeded jobs, the strict query that returned 0 on the old route):

```
exact: 0  shown: 3  fallback L4
"0 exact matches found. Showing 3 broader fallback matches (remote/global).
 Most exact jobs were removed by freshness and role match filters."
```

### Frontend follow-up

`views/Jobs.jsx` still hardcodes `const MODES = ['Any','Remote','On-site/Hybrid']` at line 15.
Replace with `web/src/lib/jobFilterOptions.js` (already written, never imported), and add the
experience + job-type selects. The new `GET /jobs/filters` endpoint serves the canonical
vocabulary so the two can never drift again.

Also render `d.search.explanation` above the results and `d.sources` as a health strip — both
are in the payload and both turn an empty page into a diagnosable one.

### The actual fix for "no jobs in India"

None of the above creates Indian listings. Your four active sources are remote-only
(Remotive, RemoteOK, Jobicy) or European (Arbeitnow). **Set `ADZUNA_APP_ID` /
`ADZUNA_APP_KEY`** — free tier, real `in` coverage, and the connector already exists at
`server.js:438`. Document it in `.env.example`, which currently mentions no job-provider key
at all. The new route detects this case and returns a `coverageHint` explaining it rather
than showing a silent empty list.

---

## 5 — Individual project progress (the fourth review)

Four new files:

```
server/utils/teamProgressEngine.js          deterministic scoring
server/utils/teamContributionVerifier.js    GitHub commit attribution
server/routes/teamProgressRoutes.js         5 endpoints
web/src/lib/teamProgress.js                 API client
web/src/components/college/TeamMemberProgress.jsx   coordinator view
web/src/components/college/MyModuleChecklist.jsx    student view
```

Wire in `server.js`, right after `registerTeamProjectRoutes(...)` at line 3053:

```js
import { registerTeamProgressRoutes } from './server/routes/teamProgressRoutes.js';

registerTeamProgressRoutes(app, {
  requireAuth, requireRole, requireCollegeScope, currentUser, db, logger,
});
```

**No `db.js` changes needed** — `updateTeamProject` already accepts an arbitrary patch, so
`memberProgress` persists alongside the existing record.

### Endpoints

| Method | Path | Who |
|---|---|---|
| GET | `/api/college/team-projects/:id/progress` | coordinator |
| POST | `/api/college/team-projects/:id/sync-commits` | coordinator |
| POST | `/api/college/team-projects/:id/link-github` | coordinator |
| GET | `/api/my/team-projects/:id/progress` | student (self) |
| PATCH | `/api/my/team-projects/:id/modules/:moduleName` | student (self) |

### Frontend

In `components/college/TeamProjectsPanel.jsx`, inside the project drilldown:

```jsx
import TeamMemberProgress from './TeamMemberProgress.jsx';
<TeamMemberProgress projectId={selectedProject.id} />
```

In `views/MyTeamProject.jsx`:

```jsx
import MyModuleChecklist from '../components/college/MyModuleChecklist.jsx';
<MyModuleChecklist projectId={project.id} />
```

### One thing to seed

`initMemberProgress(brief)` should be called at assign time so every member has a row from
day one — an absent row and a zero row mean different things to a coordinator. In
`teamProjectRoutes.js`, in the `POST /api/college/team-projects` handler, add to the
`db.createTeamProject` project object:

```js
memberProgress: progressEngine.initMemberProgress(brief),
```

Existing projects self-heal: `reconcileProgress()` rebuilds missing rows from the brief on
first read, so nothing breaks for teams already assigned.

### Design decisions worth knowing before you demo it

- **Evidence beats self-report.** A module ticked with an evidence URL scores 1.0; ticked
  without one scores 0.4. A placement cell that can't tell those apart is being handed a number
  it shouldn't trust — so the coordinator UI labels the latter *unverified*.
- **"Could not check" is a third state, never zero.** A GitHub rate limit sets
  `unavailable: true`, the commit term is dropped entirely, and modules carry full weight. A
  student is never penalised for your infrastructure. This matches the contract in
  `proofVerification.js`.
- **A student can't tick a teammate's module.** Rejected server-side with `module_not_owned`.
- **Unmatched GitHub logins are surfaced, not guessed.** Wrong attribution is worse than
  missing attribution — it tells a coordinator a student did nothing when you simply failed to
  identify them. The `link-github` endpoint lets them fix it.
- **Imbalance flags are the point.** `carrying_team` (≥60% of commits), `low_contribution`
  (<10%), `not_started`, `uneven_team` (≥50 point spread), `no_evidence`. These are
  coordinator-only — stripped from the student payload so this never becomes a place to blame a
  teammate.

**Verified output** (3 members; Asha 40 commits + evidenced module, Bhavin 3 commits, Chirag 0):

```
team%: 22   spread: 63
Asha 63% commits=40 evidenced | Bhavin 2% commits=3 none | Chirag 0% commits=0 none
flags:
  carrying_team     Asha authored 93% of the team's commits.
  low_contribution  Bhavin has 7% of the team's commits (3).
  low_contribution  Chirag has 0% of the team's commits (0).
  not_started       Chirag has not started any assigned module.
  uneven_team       63 point gap between the highest and lowest contributor.
```

Cross-member update correctly blocked (`module_not_owned`); with commits unavailable the basis
line reads *"modules only — commit history could not be read"* and nobody drops to zero.

---

## 6 — Light mode

See `docs/LIGHT-MODE-TOKEN-MAP.md`. Codemod dry-run against your tree: **3,326 replacements
across 93 files, 96% coverage.**

---

## Suggested order

| When | Items |
|---|---|
| Today (~2h) | 1, 2, 3 |
| This week | 4 (+ Adzuna key), 6 steps 1–4 |
| Before promising team tracking | 5 |
| Ongoing | route-level smoke tests |

---

## Test coverage gap worth closing

Your 615 tests pass while `jobSearchEngine.js`, `jobFilters.js` and `jobFilterOptions.js` are
all unreachable from the running app. Unit tests can't catch that. Add a handful of route-level
smoke tests that boot Express and assert real responses:

```js
// test/routes.smoke.test.js
test('GET /jobs/search returns jobs', async () => { /* boot app, assert d.jobs.length > 0 */ });
test('GET /api/college/team-projects/:id/progress returns a member row per assignment', …);
test('POST /api/projects/submit does not crash the process on malformed input', …);
```

The third one would have caught the async-rejection problem months ago.
