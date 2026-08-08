# Getting the demo college to appear on a deployment

Short version: the demo data has to be **seeded into MongoDB**. It is not
bundled with the code and it is not generated at boot.

## Why it was invisible before

There were two unrelated demo worlds:

| | Where it lived | When it was served |
|---|---|---|
| 200 students, 4 CSE specialisations, 4 year-groups | `server/utils/demoCollegeData.js`, in memory | only when `DEMO_MODE=1` **and** `MONGODB_URI` was **absent** |
| 120 students, CSE/IT/ENTC, 2 batches | written to MongoDB by `seedDemoCollege()` | when a database was configured |

`config.js` refuses to boot in production without `MONGODB_URI`
(`assertEnvOrExit` → `process.exit(1)`), and Vercel sets `NODE_ENV=production`.
So on Vercel:

* **no `MONGODB_URI`** → the function exits on cold start; every `/api/*` call
  returns 500 and the UI renders empty.
* **with `MONGODB_URI`** → the app boots, but the in-memory cohort is gated off
  and the database is empty. Also empty, just silently.

`seedDemoCollege()` now persists the in-memory world, so there is one cohort and
it survives in the database.

## Seeding

From a machine that can reach the cluster (your laptop is fine — this talks to
MongoDB directly, so nothing needs to be signed in yet):

```bash
MONGODB_URI="mongodb+srv://…" npm run seed:demo:reset -- --tpo=you@yourdomain.com
```

`--tpo` matters as much as the seed. Every `/api/college/*` route is scoped to
the caller's own college, so signing in with a personal account puts you in a
different, empty tenant. That flag binds your real address to the demo college
as a verified `college_admin`. Google sign-in preserves those fields, so you do
**not** need `ALLOW_DEV_LOGIN=1` in production.

Other options:

```bash
npm run seed:demo:status                   # report what is in the database
node scripts/seed-demo.mjs --per-branch=25 # 100 students instead of 200
```

`--reset` only ever deletes records tagged `demo` or addressed
`@demo-institute.test`. It cannot touch a real college.

The same seed is available at `POST /api/admin/demo/seed` (`{"reset": true}`)
for an authenticated admin — an email listed in `ADMIN_EMAILS`.

## Vercel environment

```
MONGODB_URI=mongodb+srv://…      required — the app will not boot without it
SESSION_SECRET=<32+ random chars>
ADMIN_EMAILS=you@yourdomain.com
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
DEMO_MODE                        leave UNSET
```

`DEMO_MODE=1` is a local-only path. On serverless it is worse than useless:
the in-memory cohort's drives, outcomes and snapshots live in per-process
memory, so anything created during a demo vanishes on the next request, which
lands on a different container. `npm run preflight` fails the build on it.

## Verifying

* `/health` — should return 200. A 500 here means the function exited at boot;
  check the Vercel function log for `MONGODB_URI is required in production`.
* `npm run seed:demo:status` — should report 200 students, 8 drives, 90 snapshots.
* `/api/college/overview` as your TPO account — a non-zero `avgReadiness`
  confirms the whole chain is wired.

## Removing it later

```bash
MONGODB_URI="…" node -e "import('./db.js').then(d=>d.wipeDemoCollege()).then(r=>console.log(r))"
```
