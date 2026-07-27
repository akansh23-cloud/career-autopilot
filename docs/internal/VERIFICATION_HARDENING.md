# Verification Hardening — toward recruiter-grade, market-ready proof

The honest goal: a checkmark an outside recruiter can trust without trusting us.
This is the v2 pass. It fixes the three things that made v1 NOT market-ready.

## What was wrong in v1 (and is now fixed)

1. **Signatures weren't third-party verifiable.** v1 used HMAC (symmetric) — an
   outside recruiter could only "verify" by calling our server, i.e. trusting us.
   **v2 uses Ed25519 asymmetric signatures.** We sign with a private key that
   never leaves the server; anyone fetches the published public key and verifies
   **offline**, and cannot forge. This is W3C-Verifiable-Credentials-aligned.

2. **Commit attribution was being called "authored, high confidence."** Git
   emails are user-set, history is rewritable, and code can be copied or
   AI-generated — so attribution proves possession, not authorship or
   competence. **v2 caps all GitHub evidence at MEDIUM.** HIGH is reserved for a
   corroborating human signal: a **passed live comprehension viva / assessment**
   or **human review**. There is now an `assessment_passed` path wired end-to-end
   so the viva (the real moat) plugs straight in.

3. **No revocation, expiry, or issuer identity.** **v2 adds** a revocation
   registry (a credential found fraudulent is killable and fails verification
   thereafter), optional `expiresAt` (assessment proof decays; default 365d),
   and an `issuer` + published key (`kid`) for chain-of-trust.

Plus: **authorship-risk flags** (`fork`, `single_burst`, `shallow_history`) that
deterministically detect a copied/AI-dumped repo and refuse to treat it as
authored work.

## Surface

- `server/utils/verificationCredentialEngine.js` — Ed25519 issue/verify, public
  key (JWK + PEM), expiry, revocation registry, honest method ceilings.
- `server/utils/githubIntegrationEngine.js` — `verifyRepoAuthorship` now emits
  `riskFlags` + `lowAuthorshipConfidence`.
- `server/utils/skillVerificationEngine.js` — description never verifies; GitHub
  authorship → MEDIUM; passed assessment/viva → HIGH.
- Routes: `GET /api/verification/public-key` (public, for offline verify),
  `GET /api/verification/methods`, `POST /api/verification/verify-credential`
  (reports tampered/expired/revoked), `POST /api/verification/revoke` (admin).
- UI: `web/src/lib/verification.js`, `web/src/components/proof/VerificationReport.jsx`
  (human-verified vs artifact, expired/revoked states, "verify offline" framing),
  wired into `RecruiterConsole`.

## Status
- `npm test` → **355 / 356** (+ new v2 tests incl. offline-verify, expiry,
  revocation, risk flags; zero regressions). The 1 failure is the **pre-existing,
  unrelated** `problemIntelligence` test (stale orchestrator only its own test
  imports). `npm run lint` → **0 errors**. `npm run build` → ok, code bundled.

## Config
- `VERIFICATION_ED25519_PRIVATE_KEY` (PKCS8 PEM) in production. If absent, a
  stable key is derived from `VERIFICATION_SIGNING_KEY || SESSION_SECRET` so
  self-host/dev works with zero setup. **Set a dedicated key in prod** and back
  the revocation registry with the DB via `setRevocationStore()`.

## Is it market-ready now?
Closer, and the substrate genuinely is: third-party-verifiable, honest about
confidence, revocable. But "market-ready" in the full sense still needs two
things that are product/operational, not just crypto:
  1. **The live comprehension viva actually built and proctored** — it's the only
     thing that earns HIGH and the only real defense against copied/AI work. The
     `assessment_passed` slot is wired; the viva itself is the next build.
  2. **A plagiarism / originality check** on submitted repos (similarity to known
     repos and to each other). The risk flags are a deterministic first cut; real
     copy-detection is the follow-up.
Until those land, present MEDIUM credentials as "evidenced," not "proven" — which
is exactly what the labels now say.

---

# Top tier added: Live Comprehension Viva

The highest-trust signal there is: the candidate proving, live and on the clock,
that they understand the specific code they committed. This is the only thing
that defeats copied / AI-generated repos, and it completes the chain:

  identity (OAuth) → authorship (commit attribution + risk flags)
  → LIVE comprehension viva → deterministic score → tamper-evident HIGH credential

## How it works
- `server/utils/vivaEngine.js` — generates **code-grounded probes** from the
  candidate's OWN repo files (imports, function arity, explanations, and a
  "modify your function" task). Answer keys are extracted deterministically from
  the source and **kept server-side** — the client only ever sees the questions.
- **Deterministic scoring** (no AI judge): factual probes match the code-derived
  key; explanations need genuine token coverage + length; modify-probes are
  checked structurally. **Anti-cheat:** per-probe minimum answer times flag
  paste/lookup speed, and a session with many fast answers or over the time
  budget is **blocked from passing regardless of textual correctness**.
- `server/utils/vivaSessionStore.js` — server-side cache of sanitized files +
  authorship (populated at analyze time) and live sessions (TTL). Pluggable for
  DB/Redis via `setStore()`.
- Routes: `POST /api/viva/start` (gated: requires an **authorship-verified**,
  analyzed repo) and `POST /api/viva/submit` (deterministic scoring; a PASS mints
  HIGH-confidence, 365-day `assessment_passed` credentials with the score bound
  into the signed evidence).
- UI: `web/src/lib/viva.js` + `web/src/components/proof/VivaSession.jsx` (timed,
  one-question-at-a-time modal), launched from an analyzed repo in the GitHub
  panel via a **Take viva** button.

## Eligibility gate (why a pass means something)
A viva is only offered for repos whose authorship is verified — you said you
wrote it; now explain it. Forks/dumps with risk flags don't qualify, so passing
is a statement about your own work.

## Now the trust ladder is complete
  LOW    self-report (never counts)
  MEDIUM authored code / verified deploy / detected stack (artifact-level)
  HIGH   live viva passed OR human review  ← recruiter-grade

## Honest remaining gap
The viva makes HIGH meaningful; the last hardening item is **automated
plagiarism / cross-repo similarity** at analyze time (the risk flags are a
deterministic first cut). And in production the viva probe set should be
periodically rotated/expanded so it can't be pre-farmed. Both are additive on
top of this architecture, not redesigns.

## Status (this pass)
`npm test` → **363 / 364** (+8 viva tests incl. anti-cheat blocking and the
pass→HIGH-credential chain; the 1 failure is the pre-existing, unrelated
`problemIntelligence` test). `npm run lint` → **0 errors**. `npm run build` → ok,
viva code bundled.
