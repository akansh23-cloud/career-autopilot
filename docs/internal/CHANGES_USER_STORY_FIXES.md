# User-story fixes — plan gating, project regeneration, verification, UI

Addresses the six items raised in `User_story.docx`, plus the shared root
cause behind three of them.

---

## Root cause

Two quota systems existed and did not know about each other.

| | Where | Unit | Enforced? |
|---|---|---|---|
| Entitlements | `web/src/lib/plan.js` | per month | client-side, partially |
| Compute quota | `server/utils/quotaMiddleware.js` | per UTC day | **yes — the real one** |

`PricingModal` advertised the monthly numbers. The backend rejected on the
daily numbers. Neither number was visible to the student, and the two error
envelope shapes (`{error:{code}}` vs `{error:'code'}`) meant the client's
error handling only ever recognised one of them — so a genuine plan limit was
reported as *"temporarily unavailable"*.

Meters `workspaces` and `aiGen` were declared and **never enforced anywhere**.
Meter `tailoring` was enforced only in `Editor.jsx`, not on the two screens
students actually use.

---

## 1 · Plan visibility (basic-pack dashboard)

- **New** `web/src/components/PlanUsageStrip.jsx` — plan tier, per-meter usage
  bars, the daily account cap shown beside each monthly allowance, and a
  warning row when the server reports a bucket running low.
- **New** `web/src/lib/quota.js` — mirrors the server's `QUOTA_CONFIG` and
  holds live remaining counts.
- Mounted on `Dashboard.jsx`.

> Plan tiers remain `Free` / `Pro` / `Premium`. "Basic pack" in the user story
> maps to **Free**. If you want the tier renamed, that is a one-line change in
> `PLAN_LABELS` — say the word.

## 2 · Resume tailoring failures

- `ResumeTailor.jsx` had **no plan check at all**. Now gates before the call,
  consumes the meter, shows runs remaining, and distinguishes a monthly
  entitlement block from a daily server 429.
- `Jobs.jsx` `TailorModal`: the `degrade()` path no longer disguises a quota
  rejection as an outage; the "upload a resume first" dead end now separates
  *missing* from *too short* and offers a **Go to Resume** button.
- `api.js` normalises both error envelopes into `err.code` + `err.quota`, and
  records the `X-Quota-*` headers so the UI can warn before the wall.

## 3 · Second project not generating

Root cause was **not** a plan limit. `saveProject()` folded a new project into
a title-matching existing one and returned it as if new, so `pickProject(p.id)`
redirected the student into project #1 with no message.

- `projectStore.js`: added `saveProjectDetailed()` returning
  `{ project, merged, mergedWith, created }` and `saveProjectAsNew()`.
  `saveProject()` kept as a back-compatible wrapper.
- `projectCreator.js`: throws a `workspace_limit` error when the cap is hit —
  the cap that was previously declared and never checked.
- `ProjectCreator.jsx` / `ProjectStudio.jsx`: both surface a dismissible
  notice explaining a merge or a cap.

## 4 · Task board UI

`xl:grid-cols-6` inside a three-column page left each card ~120px, so titles
wrapped one word per line.

- `WorkspaceTaskBoard.jsx` rewritten: horizontal scroll, fixed 300px columns,
  colour-accented sticky headers, and **empty columns hidden by default**
  (a fresh workspace has four of six empty).
- **Depth cap (follow-up fix).** The first pass traded horizontal cramping for
  vertical sprawl — roomier cards plus a per-card description line made each
  card ~180px, so a column with 11 tasks ran ~2000px and took several page
  scrolls to reach the end. Now:
  - each column scrolls **inside itself** (`max-h-[min(60vh,520px)]`), so the
    board is a fixed-height surface regardless of task count;
  - the description moved off the card face — it shows only for the selected
    card, and lives in the inspector otherwise;
  - card chrome tightened (~180px → ~120px per card).

  Net: the board fits one screen. Horizontal roominess is unchanged.
- `ProjectWorkspace.jsx`: the inspector was a permanent flex sibling from `xl`
  up. It is now inline only at `2xl` and a slide-over below that — worth about
  400px back to the board.

## 5 · GitHub + deployment verification

Previously "coming next". The backend capability already existed; the
workspace never used it.

- **New** `server/utils/workspace/proofVerification.js` — public repo
  existence, README presence *and* substance (≥400 bytes), CI workflow
  detection under `.github/workflows`, plus a server-side deployment fetch
  recording status, response time, title and whether a real page rendered.
- `workspaceValidator.runVerification(plan, evidence)` is now evidence-driven.
  **A check that cannot run stays `pending`** — never a fake pass, never a
  failure blamed on the student.
- `POST /api/workspace/:id/verify` accepts `{ evidence: { repoUrl, liveUrl } }`
  and persists it, so URLs need pasting only once.
- Proof panel gained the two inputs, a Run verification button, per-item
  verification notes, and a collapsible **How verification works** explainer.
- `access.js`: documented `deploymentVerification` — it was declared and never
  read, which made the Premium pricing line untrue.

## 6 · Internal identifiers in student-facing copy

`ANTHROPIC_API_KEY` removed from all four user-facing strings
(`Outreach.jsx`, `PatentIdeaGenerator.jsx`, two in `server.js`). Operational
detail now goes to `logger.warn` instead. A test asserts it stays out.

---

## Verification

```
npm run build   ✓ clean
npm test        ✓ 695 passing, 0 failing   (was 685)
npm run lint    ✓ 0 errors
```

**New tests** — `test/planQuotaMessaging.test.js` (8):

- client quota mirror matches server `QUOTA_CONFIG` exactly (fails on drift)
- a quota rejection is described as a limit, not an outage
- a burst rate limit suggests no upgrade
- an unconfigured-AI error never names an env var
- an unknown failure never leaks raw error text
- quota state records what the server reported
- no user-facing file mentions the provider key
- verification copy no longer says "coming next"

**Updated** — `test/workspaceApi.test.js`: the old test pinned `mode:'local_v1'`.
Its intent (github/deployment stay pending) is preserved and extended with two
new cases: unusable evidence never fakes a pass, and evidence persists across
runs. Malformed URLs are rejected before any network call, so these stay fast
and deterministic.

## Not done

- Lint reports 1488 pre-existing `no-unused-vars` warnings across all 449
  files — the eslint config does not recognise JSX component usage. Untouched;
  it is a config fix, not a code fix.
- The `Free`/`Pro`/`Premium` vs "basic pack" naming question is still open.
