# Go-Live Runbook — Career Autopilot (multi-college)
The exact sequence from zero to a demo-ready, multi-college production deployment. Every step is something the codebase actually supports today — nothing here is aspirational.

## 0. Prerequisites
- MongoDB Atlas cluster (Mumbai region for Indian colleges), connection string in hand.
- A domain + host (Render/Railway/VM — anything that runs Node 20+; Vercel works via the included `vercel.json`).
- Google OAuth client (id + secret) with your domain's callback URL.
- Optional but recommended: SMTP credentials (any provider) for email nudges.

## 1. Configure environment (server)
```bash
SESSION_SECRET="$(openssl rand -hex 32)"   # generate FRESH — never reuse a secret that was ever in a shared zip
MONGODB_URI="mongodb+srv://…"
FRONTEND_ORIGIN="https://app.yourdomain.in"
GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=…
ADMIN_EMAILS="you@yourdomain.in"           # platform admin(s): college approvals, demo seeding
SMTP_URL="smtp://user:pass@host:587"       # optional — in-app delivery works without it
EMAIL_FROM="Career Autopilot <no-reply@yourdomain.in>"
```
Legal identity (served publicly at `GET /api/legal` and on `#/legal`):
```bash
LEGAL_ENTITY_NAME="<your operating name>"
SUPPORT_EMAIL="support@yourdomain.in"
GRIEVANCE_EMAIL="grievance@yourdomain.in"   # DPDP grievance officer; defaults to SUPPORT/ADMIN if unset
```
Everything else degrades gracefully without keys (see `.env.example`). Deploy with `npm install && npm run build && npm start`.

## 1.5 Run the preflight (every deploy)
```bash
npm run preflight   # exit 1 on any FAIL — safe to gate CI/CD on
```
Static checks (secret strength, origin https, OAuth/admin/legal env, dev-login off in prod) plus **live** Mongo ping and SMTP handshake where configured. It also lists what it *can't* verify from the server — Google callback URL, Razorpay webhook delivery, SPF/DKIM/DMARC DNS — do those once manually.

**Payment-gateway activation:** Razorpay's site review wants public Terms, Privacy, Refund/Cancellation and Contact URLs. They exist and render signed-out:
`https://<your-domain>/#/legal/terms` · `#/legal/privacy` · `#/legal/refunds` · `#/legal/contact` — paste these four into the Razorpay dashboard.

**Email deliverability:** before trusting nudge emails, set SPF + DKIM (+ DMARC) on the sending domain and send one test to a Gmail address — if it lands in spam, fix DNS before the pilot, not during it.

## 2. Verify the deployment (5 minutes)
1. `GET /api/health` → `{ ok: true }` with an `X-Request-Id` header. `GET /api/ready` → `ready: true` once Mongo connects.
2. Sign in with your admin email → the DPDP consent screen appears → accept.
3. Admin → User Directory → **College registry** card renders.

## 3. Seed the demo college (before ANY outreach demo)
Admin → College registry → **Seed demo college** (or `POST /api/admin/demo/seed`).
You get *Demo Institute of Technology*: deterministic synthetic students across every funnel stage (registered → recruiter-ready), branches/batches, at-risk flags, drives — join code `DEMO2026`. Bind a demo TPO account to it (register + approve, step 4 flow) and every sales demo runs on a full command center, never an empty screen. Re-seed is idempotent; `{ "reset": true }` rebuilds it clean.

## 4. Onboard the first REAL college (the pilot sequence)
1. **TPO registers:** they sign in → Settings → My College → *Register your college* (name, city, official domains). This creates a `pending` college **and** a pending `college_admin` verification for their account, together.
2. **You activate:** Admin → College registry → *Activate*. One click approves the college and the TPO.
3. **TPO onboards students** (College workspace → *Onboarding & roster*):
   - Import the roster CSV (`email,name,branch,batch,rollno`) — already-registered students link instantly; the rest link at first sign-in.
   - Add verified email domains for auto-binding.
   - Share the join code in class groups (toggle approval-required if they want control).
4. **Students sign in** → accept consent (college visibility is their explicit choice) → they appear in the command center as they consent and engage.
5. **TPO drives the pilot:** at-risk register → select students → **Nudge** or **Assign task** (in-app guaranteed; email if configured, honestly reported). Weekly CSV export for their records.

## 5. Data-rights answers (when the college asks — they will)
- Consent: versioned, blocking, explicit; college visibility is server-enforced, not cosmetic.
- Export: `GET /api/account/export` — every collection, same list the delete cascade uses.
- Deletion: `DELETE /api/account` — 7-day grace, sign-in cancels, then full cascade (including roster rows and task assignments).
- Hand them `docs/DPDP_DATA_HANDLING.md`. Minors on the roster need guardian consent collected by the college (noted in the one-pager).

## 6. Before crossing ~500 students in one college
- Run the load test (k6: 100/250/500 VUs against staging). The observability endpoint is cached per college (60s), but verify your Mongo tier holds.
- Confirm SMTP is live so nudges reach inboxes during placement season.
- Set an uptime monitor on `/api/ready` and skim `/api/admin/errors` weekly (30-day TTL log, request-id correlated).

## 7. Sharing the codebase
Always `npm run package` — it produces a zip with `.env`, git history, and `node_modules` hard-excluded and refuses to emit an archive containing any env file. Never hand-zip the folder again.

## Multi-college invariants (what keeps N colleges safe on one deployment)
- Every college-facing query filters on the caller's pinned `collegeId` in the data layer; cross-tenant reads are structurally impossible, not just hidden.
- Students bind through roster / domain / code only — a typed college name grants nothing.
- Consent gates readiness visibility per student, per college, server-side.
- Join codes rotate on demand; domains can't be public providers; pending colleges are invisible and unjoinable until you activate them.
