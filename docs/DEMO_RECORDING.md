# Recording the placement-cell demo

Two ways to get a populated College Workspace. Pick based on whether you have
MongoDB running.

---

## Option A — local, no database (recommended for recording)

Requires Node 18+. Nothing else — no MongoDB, no API keys.

**1. Install**

```bash
npm install
```

**2. Create `.env`**

```bash
cp .env.example .env
```

Then set a session secret in it:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The other demo values are already correct in `.env.example`:
`DEMO_MODE=1`, `ALLOW_DEV_LOGIN=1`,
`ADMIN_EMAILS=tpo@demo-institute.test`, `MONGODB_URI=` (empty — demo mode
requires it to be empty).

**3. Build the frontend and start**

```bash
npm run build
npm start
```

Open **http://localhost:3000**.

**4. Sign in**

Use dev login as `tpo@demo-institute.test`. On first sign-in the DPDP consent
screen appears — **accept it once before you start recording**, otherwise it
blocks the first frame of your take.

The College Workspace is populated immediately. No seeding step.

### Why build-and-start rather than `npm run dev`

`npm run dev` runs Vite on :5173 proxying to Express on :3000, with hot reload.
Fine for development, worse on camera: the HMR overlay can flash mid-take and
you are recording two origins instead of one. `npm run build && npm start`
serves the built SPA from Express on a single origin — closer to production and
visually stable.

If you do want hot reload while adjusting the demo, `npm run dev` works — just
open :5173, and leave `PORT=3000` alone, since the Vite proxy targets it.

### Don't deploy this configuration

`DEMO_MODE` only takes effect when `MONGODB_URI` is empty, and `config.js`
refuses to start with `NODE_ENV=production` and no `MONGODB_URI` — so this
combination cannot run on Vercel by design. `ALLOW_DEV_LOGIN=1` on a public URL
would also let anyone sign in as any address, including the admins listed in
`ADMIN_EMAILS`. Local only.

## Option B — deployed, with MongoDB

For a live link investors can click themselves. Deploy normally with a real
`MONGODB_URI` and Google OAuth, keep `ALLOW_DEV_LOGIN` off, then seed:

```bash
curl -X POST /api/admin/demo/seed \
  -H 'content-type: application/json' \
  -d '{"reset": true, "count": 50}'
```

Writes the same cohort to Mongo as real documents (tagged `College.demo: true`,
`.test` addresses). `reset: true` wipes only demo-tagged records. `count`
defaults to 50 and accepts 1–500.

---

## What's in the cohort

50 students at **Demo Institute of Technology** (Pune), deterministic — the same
50 every run, so a second take looks identical to the first.

| | |
| --- | --- |
| Branches | CSE, IT, ENTC, Mechanical — weighted so CSE is largest |
| Batches | 2026, 2027 |
| Readiness | ~12 placement-ready, a mid-band, and a real tail who aren't ready |
| Resume scores | Present for ~90%; absent for students still at registration |
| Projects | Verified, pending, needs-review and rejected submissions |
| Skills | Verified vs pending XP across 22 skills |
| Engagement | Active, dormant and never-active students over 60 days |
| Also | 3 placement drives, 48-row roster, 3 assigned tasks, 2 pending join requests |

Readiness scores come from the product's own `computeReadiness()` engine, not
invented numbers — so anything a viewer computes by hand from the visible
fields will agree with what the dashboard shows.

The cohort is deliberately **not** all high performers. Roughly half have
verified nothing. That is the point: a placement cell where everyone is already
ready has no reason to buy the product. The gap is the story.

---

## Screens worth recording

1. **Overview** — 50 students, average readiness, placement-ready count
2. **Students** — filter by branch, batch, minimum resume score, verified-only
3. **Student drill-down** — click any student for projects, skill ledger, resume history
4. **Analytics** — branch and batch comparison, skill heatmap
5. **Observability** — 60-day momentum, engagement buckets, at-risk students
6. **Export CSV** — both the summary and full exports
7. **Roster / Members** — approve a pending join request live on camera

`⌘K` / `Ctrl-K` opens the command palette for fast jumps between workspaces.

---

## Everything is obviously synthetic

Every address is under `demo-institute.test` (`.test` is IANA-reserved and can
never route), every id is `demo_`-prefixed, and the college key is
`demo-institute-of-technology`. If a frame of the recording shows an email
address, it is visibly fake — no real student is ever on screen.
