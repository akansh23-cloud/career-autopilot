# GitHub Integration — Career Proof Profile (Career Autopilot v11)

A two-layer, security-first GitHub integration that turns real repositories into
verified proof-of-work on the Career Proof Profile — without ever using GitHub as
a login, without broad repo scopes, and without exposing private code.

---

## What was built

**Layer 1 — Identity connection (OAuth, minimal scopes).** "Connect via GitHub"
verifies account ownership and syncs public stats (repo count, followers, top
languages, recent activity). Scopes are limited to `read:user user:email` — **no
repo scope is ever requested in this flow.** OAuth access tokens are encrypted at
rest (AES-256-GCM) and are never returned to the client or logged.

**Layer 2 — Repository verification (GitHub App, user-selected repos).** The user
installs a GitHub App and explicitly chooses which repositories (public and/or
private) Career Autopilot may read. Access uses **short-lived installation tokens
minted server-side per request**, scoped to the selected repo. The engine inspects
only proof-relevant files, computes a Career Proof Score, detects skills from real
evidence, and (optionally) surfaces a privacy-safe proof summary on the public
profile.

The existing **manual GitHub URL** flow and the existing project-level
`analyze-github` public-repo analyzer are fully preserved as fallbacks.

---

## Files changed / added

**New**
- `server/utils/githubIntegrationEngine.js` — pure logic + crypto engine (OAuth/App
  config, token encryption, JWT/installation tokens, safe file inspection, stack/
  skill detection, proof scoring, public-safe filtering, bounded score contribution).
- `web/src/lib/githubIntegration.js` — client API helper + return-flag handling.
- `web/src/components/proof/GithubIntegrationPanel.jsx` — full UI panel (Aurora theme).
- `test/github.test.js` — 20 tests (engine units + API/security).

**Modified**
- `server.js` — GitHub routes, webhook raw-body middleware, opt-in GitHub proof on the
  public profile route, status summary with bounded Career Proof contribution.
- `db.js` — 5 collections + DTOs + data-access functions (tokens never in any DTO).
- `validation.js` — zod schemas for link/visibility/analyze/import.
- `security.js` — webhook added to CSRF-exempt (HMAC-verified); `githubLimiter`.
- `.env.example` — all new env vars, with GitHub OAuth App + GitHub App setup notes.

---

## New API routes (all under `/api/integrations/github`, `requireAuth` except the webhook)

| Method | Path | Purpose |
|---|---|---|
| GET | `/config` | Capability probe (no secrets). |
| GET | `/connect` | Start OAuth (scopes `read:user user:email`). |
| GET | `/callback` | Exchange code, encrypt token, save connection. |
| GET | `/status` | Connection DTO + installations + summary + bounded proof contribution. |
| POST | `/sync` | Refresh public stats (preserves prior data on failure). |
| DELETE | `/` (`/api/integrations/github`) | Disconnect identity (manual URL preserved). |
| GET | `/app/install` | Redirect to the GitHub App install page. |
| GET | `/app/callback` | Persist installation, sync selected repos. |
| POST | `/app/sync-repos` | Re-sync accessible repositories. |
| GET | `/repositories` | List accessible repositories (owner view). |
| POST | `/repositories/:repoId/analyze` | Analyze one repo (private requires `confirmPrivate`). |
| POST | `/repositories/:repoId/link-project` | Link repo to a Career Autopilot project. |
| POST | `/repositories/:repoId/import-project` | Build a project draft from analysis. |
| PATCH | `/repositories/:repoId/visibility` | Set public/private proof visibility. |
| DELETE | `/app/installations/:installationId` | Disconnect an installation locally. |
| POST | `/webhook` | GitHub App lifecycle (HMAC-verified, raw body). |

---

## New DB models (all scoped by `userId`)

- **GithubConnection** — OAuth identity; `encryptedAccessToken` (never in a DTO);
  `status` connected/sync_failed/disconnected; `publicVisible`; `profile`; `stats`.
- **GithubInstallation** — App installations; `installationId`; `repositorySelection`;
  `permissions`; `status` active/suspended/disconnected. Unique `(userId, installationId)`.
- **GithubRepository** — per-user repo cache; `private`; `accessible`;
  `selectedForVerification`; `publicProofVisible` (default false);
  `privateProofSummaryVisible` (default false); `analysisStatus`; `proofScore`;
  `detectedSkills`; `evidence`; `linkedProjectId`. Unique `(userId, githubRepoId)`.
- **GithubRepoAnalysis** — full analysis records (stack/skills/evidence/quality/
  summaries). (The `errors` field is named `analysisErrors` — `errors` is a Mongoose
  reserved word.)
- **GithubAudit** — best-effort audit trail of connect/install/analyze/visibility events.

DTOs (`githubConnectionDTO`, `githubRepoDTO`) are the only shapes that leave the
server; neither ever carries a token, and `githubRepoDTO` hides private repo
name/URL/description from non-owner views.

---

## New environment variables

```
# OAuth identity (Layer 1)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_OAUTH_CALLBACK_URL=http://localhost:3000/api/integrations/github/callback
GITHUB_OAUTH_SCOPES=read:user user:email
OAUTH_TOKEN_ENCRYPTION_KEY=            # falls back to SESSION_SECRET if unset

# GitHub App (Layer 2)
GITHUB_APP_ID=
GITHUB_APP_NAME=                       # app slug used in the install URL
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY=                # PEM; \n escapes or multiline both supported
GITHUB_APP_WEBHOOK_SECRET=
GITHUB_APP_INSTALLATION_CALLBACK_URL=http://localhost:3000/api/integrations/github/app/callback

RATE_GITHUB_PER_HOUR=60
# FRONTEND_ORIGIN=http://localhost:3000   # used to build redirect URLs
```

The feature degrades cleanly to "not configured" when these are absent; the manual
GitHub URL keeps working regardless.

---

## Setup

### GitHub OAuth App (Layer 1 — identity only)
1. https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**.
2. **Authorization callback URL** = your `GITHUB_OAUTH_CALLBACK_URL`.
3. Copy Client ID/Secret into `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
4. Do **not** add repo scopes; the app requests only `read:user user:email`.

### GitHub App (Layer 2 — selected-repository verification)
1. https://github.com/settings/apps → **New GitHub App**.
2. **Permissions (read-only):** Repository **Contents: Read-only**, **Metadata:
   Read-only**. Optionally also read-only **Actions**, **Commit statuses**, **Pull
   requests**, **Issues**. **No** write/admin/secrets/delete permissions.
3. **Where can this app be installed:** Any account.
4. **Repository access:** allow users to pick **Only select repositories**.
5. **Setup/Callback URL** = `GITHUB_APP_INSTALLATION_CALLBACK_URL`.
6. **Webhook (recommended):** URL = `<host>/api/integrations/github/webhook`,
   secret = `GITHUB_APP_WEBHOOK_SECRET`; subscribe to **Installation** and
   **Installation repositories**.
7. Generate a **private key** → paste into `GITHUB_APP_PRIVATE_KEY`. Set
   `GITHUB_APP_ID`, `GITHUB_APP_NAME` (the slug), and the App client id/secret.

---

## How it works

**Selected-repo access.** Repo data is reachable only for repositories the user
selected during installation. Each analysis mints a fresh installation token scoped
to that repo's id; tokens are short-lived and never persisted.

**Private-repo access & protection.** Private repos are analyzed only when the user
selected them *and* explicitly confirms (`confirmPrivate`). Analysis is read-only and
inspects only an allowlist of proof files (README, dependency manifests,
Dockerfile/compose, `.github/workflows/*`, Terraform, k8s/Helm yaml, common entry
files). A secret blocklist (`.env`, `*.pem`, `*.key`, `id_rsa`, `credentials*`,
token/password/secret patterns, `.aws/`, `.ssh/`, …) is enforced twice — at file
selection and again before analysis. Private repos are **private by default** and are
hidden from public/recruiter views unless the user opts in to a **safe summary**
(skills + evidence categories + score, with **no** repo name, URL, or file content).

**Proof score (0–100).** Computed from concrete signals: README quality, dependency
manifest, source structure, tests, CI/CD, deployment config, IaC, recent activity,
commit history, not-archived, not-empty, linked project. Levels: ≥85 Strong, ≥70
Good, ≥50 Partial, else Weak.

**Detected skills → verification.** Detected skills map to evidence items
(`status: evidence_detected`) and align with the existing
`skillVerificationEngine` philosophy: GitHub evidence supports verification but never
auto-inflates it. Linking a repo to a project feeds that evidence into the normal
project verification flow.

**Career Proof Score change.** GitHub evidence contributes a **bounded** amount
(`githubProofContribution`, cap **30 pts**): identity connection, app installation,
per-repo proof (scaled, capped), and skill breadth. Public and private contributions
are tracked separately so private work can count for the owner without leaking.

**Public/recruiter visibility.** The public profile route attaches GitHub proof only
for non-private profiles and only through `filterPrivateRepoDataForPublicView`, which
returns `null` unless the user opted in — private repos can surface only the safe
summary, never identifying details.

---

## Security summary

- OAuth scopes limited to `read:user user:email`; repo access only via the App.
- OAuth tokens encrypted at rest (AES-256-GCM); never in any DTO; never logged.
- Installation tokens minted server-side, short-lived, repo-scoped, never persisted.
- Repo + installation ownership verified before any repo operation.
- Secret files excluded by blocklist (checked twice); only an allowlist is read.
- Webhook is HMAC-verified (`X-Hub-Signature-256`, timing-safe compare); CSRF-exempt
  because it is signature-authenticated, not cookie-authenticated.
- Per-user rate limiting on sync/analyze (`RATE_GITHUB_PER_HOUR`).
- Private repos private by default; public exposure is strictly opt-in and safe-summary only.

---

## Manual testing steps

1. Leave all GitHub env vars unset → panel shows "not configured"; manual GitHub URL
   still works.
2. Configure the OAuth App → "Connect GitHub" → authorize → redirected back with
   identity connected, public stats + top languages shown.
3. Confirm scopes on the GitHub authorization screen are only Read user / email.
4. Click "Sync profile" → stats refresh; break the token and sync → previous data
   preserved, status shows a soft failure (no data wiped).
5. Configure the GitHub App → "Install GitHub App & choose repositories" → select a
   couple of **public** repos (and optionally a **private** one).
6. Back in the app, repositories appear; private repos show "Hidden from public
   profile by default."
7. Analyze a public repo → proof score, detected stack/skills, evidence checklist,
   recommendations.
8. Analyze a private repo → confirmation modal first; after confirming, analysis is
   stored and stays private.
9. Open "Visibility" on a private repo → choose "Show safe proof summary only".
10. Open a recruiter/public view of the profile → only the safe summary appears for
    the private repo (no name/URL); public repo proof appears only if opted in.
11. "Link to project" / "Import as project" → repo evidence flows into a project.
12. Uninstall the app on GitHub (or hit the webhook) → installation marked
    disconnected, repos marked inaccessible (never deleted).
13. Disconnect identity → manual GitHub URL remains intact.

---

## Test results

`node --test test/*.test.js` → **101 passing, 0 failing** (81 prior + 20 new).
`npm run build` → passes. `npm run lint` → **0 errors** (warnings are the
pre-existing `jsx-uses-vars` style warnings shared across the codebase).

---

## Known limitations

- Per-repo file inspection is bounded (≤12 proof files, ≤64 KB each, ≤4000 tree
  entries); very large repos return a **partial** proof analysis (surfaced in the UI).
- Skill/stack detection is deterministic and signal-based (manifests + structure),
  not a deep semantic code analysis.
- Stats sync covers owner repositories via the OAuth identity; organization-wide
  aggregation is out of scope.
- The webhook re-sync path resolves the owning user via the stored installation row;
  installs created entirely outside the app flow are reconciled on the next
  authenticated "Sync repositories".
