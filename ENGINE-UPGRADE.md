# Project Creator Engine v2 — making generated projects buildable

The ideas the engine generated were good. The generated *artifact* had holes
exactly where students stall. This pass closes them.

Everything below was verified by generating projects, installing them, running
them, and implementing features by hand — not by reading code.

---

## 1. What was actually wrong

Generated a project from the v1 engine ("Clinic Follow-up Reminder System"),
installed it, and ran it. Findings:

| # | Problem | Consequence for the student |
|---|---|---|
| 1 | Primary entity was always `Record` with `title / description / status` | A clinic app served `/api/records`. Every real field — patient name, phone, follow-up date — had to be invented from nothing |
| 2 | MVP feature tasks had **no files, no code, no checks** | Guide literally said *"No specific files — this task is about your environment or process"* for "Patient list". Tasks 11–15 (the actual product) were vapor |
| 3 | One mega-task: 7 files, 8 TODOs, CRUD + auth + scoring + health | Unfinishable in one sitting; no sense of progress |
| 4 | No seed data | First run showed an empty list — nothing to demo, nothing to react to |
| 5 | Root `npm run dev` echoed *"open two terminals"* | Two installs, two terminals, before anything happened |
| 6 | Checks were `todoCleared` / `manual` | Passing a check meant **deleting a comment**. Nothing proved a feature worked |
| 7 | `/score` threw a Mongoose `CastError` in the default memory mode | A generated endpoint crashed out of the box |

---

## 2. What changed

### Domain modelling — `server/utils/domain/domainModeler.js` (new)
18 domain packs (clinic, attendance, delivery, invoicing, booking, tickets,
inventory, hiring, commerce, civic, fitness, library, CRM, restaurant,
property, learning, content) plus noun inference for anything unmatched.

Each entity carries real fields with types, enums, relations, and three
realistic seed rows.

```
Clinic Follow-up Reminder System
  → Patient { fullName, phone, age, condition, lastVisitAt,
              followUpAt, followUpStatus[pending|reminded|confirmed|missed], notes }
  → Reminder { patientId, channel[sms|whatsapp|call], sendAt, status, message }
```

`derivePrimaryEntity()` now delegates here, so the whole plan — models, APIs,
screens, guides, seeds, tests — speaks the student's vocabulary.

### Feature compilation — `server/utils/workspace/featureCompiler.js` (new)
Each MVP feature phrase compiles to a contract: **verb + object → endpoint +
service module + screen + acceptance test**. Features already covered by the
CRUD or auth scaffold are marked `builtin` and folded in rather than
duplicated as busywork.

### Schema-driven codegen — `server/utils/codegen/templatesV2.js` (new)
`backend/schemas/<entity>.schema.js` is the single source of truth. The
Mongoose model, the validator, the storage layer, the seed data, the React
form and the React table are all generated from it. Add a field there and it
appears everywhere with no other edit.

Storage adapter (`backend/lib/store.js`) makes memory mode and MongoDB expose
identical methods — which is what killed the `CastError`: `isValidObjectId`
guards every lookup instead of letting Mongoose throw at the user.

### The red → green loop
Unbuilt features return **501** with their guide filename in the response.
The matching acceptance test asserts the real contract, so it is **red on day
one and green the moment the student implements it**. This is the single
biggest change: "am I done?" now has an answer you can run.

### One-command experience
`npm run setup` · `npm run dev` · `npm run doctor` · `npm run check` —
all zero-dependency Node scripts. `doctor` names the four things that break a
first hour and prints the exact fix for each.

### Self-verification — `server/utils/starterPack/buildDoctor.js` (new)
The engine checks its own output before a student ever sees it: unresolved
imports, unparseable JSON, tasks pointing at files that were never generated,
checks reading paths that do not exist, duplicate endpoints, route shadowing.
Blocking problems set `pack.buildable = false`; the report ships as
`BUILD-REPORT.md` and `workspace/build-report.json`.

**It earned its place immediately** — on first run it caught four real defects
in this very upgrade, including acceptance tests importing `./helpers/server.js`
instead of `../helpers/server.js`, which would have made every acceptance test
die with a module-not-found instead of the actionable "still returning 501".

### Rewritten
`fileTreePlanner` · `taskPlanner` · `guidePlanner` · `databasePlanner` ·
`apiPlanner` · `customProjectBuilder` · `codegenEngine` · `templateRegistry` ·
`kitFiles` · `starterPackBuilder`

---

## 3. Bugs found and fixed during the work

Each of these was found by running the output, not by reading it.

| Bug | Why it mattered |
|---|---|
| Acceptance tests imported `./helpers/server.js` from `tests/acceptance/` | Every acceptance test died with module-not-found instead of the intended message |
| `node --test tests/*.test.js` never matched `tests/acceptance/` | Acceptance tests silently never ran — checks looked green while nothing was proven |
| `/api/issues/summary` shadowed by `/api/issues/:id` | A student's implemented handler was unreachable; they got 404 from `getOne` and would debug the wrong file |
| "Report an issue" and "Issue heatmap" both compiled to `GET /api/issues/summary` | Second router was dead code |
| `apiPlanner` produced `/api/campuss`, `/api/companys` | Docs documented URLs that returned 404 |
| `admin.routes.js` generated but never mounted | Dead file with no purpose |
| `upload` / `score` endpoints dropped in the v2 rewrite | Feature regression, caught by your existing tests |
| `userId` in the request schema | Every create failed with "Owner is required" |
| Task 08 check passed on an untouched pack | The shipped `Dashboard.jsx` contained the word "search" in a TODO comment — a green tick for doing nothing |
| `.github/workflows/ci.yml` ran `npm ci` with no lockfile | CI red on first push for an unrelated reason |
| `singularize('Campus')` → `'Campu'` | Entity names like `Campu`, `Statu` |

---

## 4. Verification performed

**Four archetypes generated, installed, tested and built end to end:**

| Project | Entity | Pack | Tasks wired | Acceptance tests | Buildable |
|---|---|---|---|---|---|
| Clinic Follow-up Reminder System | `Patient` | clinic | 16/16 | 2 | ✅ |
| Pharmacy Stock and Expiry Tracker | `Product` | inventory | 17/17 | 3 | ✅ |
| Civic Issue Reporting Heatmap | `Issue` | civic | 15/15 | 2 | ✅ |
| Campus Skill Exchange | `Skill` | generic | 17/17 | 3 | ✅ |

For every one: `npm run setup` succeeded, `npm test` failed **exactly** the
number of unbuilt features, and `npx vite build` produced a bundle.

**Full student journey, played by hand** on the civic project: implemented both
features using only the commented sketch in each module → suite went from
7/9 to **9/9 green** → live endpoint returned real computed metrics
(`{"ok":true,"metrics":{"total":3,"byStatus":{"resolved":1,...}}}`) → entity CRUD
still served correctly (no shadowing).

**Test suite: 1009 / 1010 passing.**
The one failure (`root serves the SPA html`) is **pre-existing** — it fails
identically on your untouched upload, because `legacy_index.html` is not in the
archive. 27 new tests added in `test/buildableEngine.test.js`.

Where existing tests encoded v1 contracts that v2 deliberately replaced, they
were **updated with a comment explaining why**, never deleted. Where they were
protecting something real (upload/score wiring, mounting every route file, API
doc honesty), the **code** was fixed instead.

---

## 5. What a student now gets

```
npm run setup     # installs both workspaces, writes backend/.env
npm run dev       # API + app together, seeded demo data already loaded
npm test          # smoke green, acceptance red — each red test is a task
npm run check     # progress board across every task
npm run doctor    # names the problem and the fix
```

A fresh pack reports **0 of 11 machine-checkable tasks passing** — honestly.
No check passes until the student does the work, and there is a test to
prove each one.

---

## 6. Suggested next steps

1. **Wire `pack.buildable` into the download route.** `workspaceRoutes.js` still
   serves the ZIP unconditionally. Refusing (or loudly warning) on
   `buildable === false` closes the loop the doctor opens.
2. **Surface the contract in the in-app Guided Path.** `planGuide()` already
   emits `entry.contract` — the UI does not render it yet.
3. **Add domain packs as your cohorts reveal them.** A pack is ~25 lines; the
   generic path handles the tail safely in the meantime.
4. **Consider `npm run check` in CI**, so a student's repo shows real progress
   to a placement cell rather than a self-reported checkbox.
