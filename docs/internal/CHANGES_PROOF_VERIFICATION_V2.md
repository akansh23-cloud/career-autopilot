# Proof verification v2 — evidence that actually verifies

Answers the user story *"Where to put the details or proof under proof tab"*,
and rebuilds what the v6 Proof tab could actually check.

---

## The bug being fixed

The v6 Proof tab **told students to attach evidence and gave them nowhere to
attach it.** Eight requirements, two input fields.

| Requirement | v6 method | Where you could put it |
|---|---|---|
| Screenshots of the working app | `manual` (**required**) | nowhere |
| Tests pass locally | `local_tests` (**required**) | nowhere |
| Demo video | `manual` | nowhere |

Worse, the verification notes actively pointed at a control that did not
exist — *"Manual evidence — attach it in the Proof tab"* — while
`WorkspaceInspector.jsx` contained zero `input` or `textarea` elements.

**Consequence:** 3 of 5 required items could never leave `pending`, so no
student could ever complete a proof pack.

---

## What changed

### 1. Every requirement now has somewhere to put evidence

| Item | Evidence | Best status |
|---|---|---|
| GitHub repository | repo URL | `verified` |
| README meaningful | repo URL | `verified` |
| Screenshots | committed to `docs/screenshots/` + embedded in README | `verified` |
| Deployed demo URL | deployed URL | `verified` (reachable) |
| API health check | deployed URL | `verified` |
| Tests pass | pasted output, or green CI | `self_reported` / `verified` |
| Architecture spec | workspace-local | `verified` |

Five of seven now reach real verification. In v6, three required items could
reach nothing at all.

### 2. Demo video removed

It was redundant with **screenshots**, not with the deployment check. A
reachable URL only proves the server responds; screenshots show real flows —
and they live in the repo, so they survive a free-tier deployment being
suspended months later, which is exactly when a recruiter looks.

### 3. Screenshots moved into the repo

Checked via the GitHub contents API across `docs/screenshots/`,
`screenshots/`, `docs/images/`, `assets/screenshots/`. Requires **≥2 images
over 1 KB** *and* **≥1 embedded in the README**, so they render on the repo
page. This converts a previously unverifiable item into a verified one, and
gives the student a better portfolio artefact than a file-sharing link.

### 4. New `self_reported` status tier

Statuses are now `verified` / `self_reported` / `pending` / `not_applicable`.
There is deliberately **no `failed`** — a check we could not run is the
platform's problem, and an unmet requirement is just "not done yet".

Self-reported evidence **counts toward completion** (otherwise the pack could
never close) but is **never folded into the verified count**, because a
recruiter-facing score inflated by self-claims is worthless. It renders amber,
not green.

### 5. Tests: two tiers

- **Pasted output → `self_reported`.** `testOutputParser.js` requires a real
  runner summary (Jest, Vitest, Mocha, node:test, pytest, go test), extracts
  pass/fail counts, and **rejects any run with failures** or zero tests. It
  cannot stop a determined faker and does not pretend to.
- **Green GitHub Actions run → `verified`.** Independent evidence, and it
  gives students a concrete reason to add CI.

### 6. Deployment failure signatures — v6 bug fix

v6 judged a deployment live with `body.length > 400 && /<div|script/`. **A
Vercel 404 page passes that**, so dead deployments verified clean. Now matches
against `DEPLOYMENT_NOT_FOUND`, Netlify 404s, Heroku no-such-app, suspended
services, GitHub Pages 404, parked domains, default nginx/Apache pages and
failed builds.

Also honest about its ceiling: a server-side fetch **cannot execute a SPA's
JavaScript**, so the status reads *reachable*, never *working*, and the note
says so. `/api/health` is the stronger signal — JSON can't be faked by an
empty shell — so it stays as a separate check.

### 7. Conditional items

A CLI tool, library or notebook has no URL. Deployment items are now
`not_applicable` and **excluded from required counts** instead of sitting
permanently red.

### 8. SSRF fix — security

**v6 shipped `verifyDeployment` fetching arbitrary student URLs with
`redirect: 'follow'` and no validation.** That let the server be used to probe
`169.254.169.254` (cloud instance metadata), `127.0.0.1:6379`, or any internal
address.

`ssrfGuard.js` now resolves each hostname and refuses non-public unicast
addresses — RFC1918, loopback, link-local, CGNAT, multicast, reserved, IPv6
ULA/link-local and IPv4-mapped IPv6. Redirects are followed manually, capped
at 3, with **every hop re-validated** (a public host can 302 to metadata).

### 9. GitHub rate limiting — scaling fix

Unauthenticated GitHub allows **60 requests/hour per IP** — the *server's* IP,
shared by all students. v6 made 3 anonymous calls per verification, so the
platform supported ~20 verifications/hour in total; this version makes up to 5.

`githubClient.js` adds optional token auth (5,000/hour), a 10-minute per-path
cache, and drill-in calls that only fire once the repo itself resolves. Set
`GITHUB_TOKEN` (classic PAT, `public_repo` scope only) — see `.env.example`.

**Token-optional by design:** with no token, checks that cannot run return
`pending` with an honest note. No student is ever failed for our missing
configuration.

---

## Verification

```
npm run build   ✓ clean
npm test        ✓ 717 passing, 0 failing   (was 695)
npm run lint    ✓ 0 errors
```

**New — `test/proofVerification.test.js` (22 tests):** cloud-metadata and
private-range blocking, IPv4-mapped IPv6 smuggling, scheme and localhost
refusal, runner parsing across six frameworks, rejection of failing/junk/empty
pastes, demo-video removal, conditional skipping, unavailable-never-failed,
hosting-failure-page detection, the reachable-not-working claim, both test
tiers, screenshot count + embed, README-only repos, self-reported accounting,
and a blanket assertion that **no proof item can ever be marked `failed`**.

**Four existing tests updated** — all deliberate contract changes, not
regressions:

- heading renamed *"How verification works"* → *"How each check works"*
- `evidenceUsed.githubReachable` → `evidenceUsed.testOutputProvided`
  (evidence shape changed)
- `runVerification` v1-honesty test — intent preserved under the new statuses

One of them **caught a real loss**: the summary note had dropped the
*"Done is not Verified"* invariant. Restored in the source rather than relaxed
in the test.

---

## Recommended before production

Set `GITHUB_TOKEN`. Without it the platform supports roughly a dozen
verifications an hour across all users. Everything degrades honestly, but
students will see a lot of "could not run just now".
