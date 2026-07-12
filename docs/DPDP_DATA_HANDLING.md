# Career Autopilot × Your College — Data Handling One-Pager
*The document your admin office / tech committee will ask for. One page, no legalese.*

## What the platform does
Gives your placement cell a live command center over student placement readiness: verified projects (GitHub-linked, viva-checked), deterministic resume scores, skill coverage, at-risk flags, and audit-ready CSV exports — months before placement season.

## What student data is processed
Profile (branch, batch, skills), resumes + scores, project submissions + verification evidence, skill XP, activity signals, and college membership. **No payment cards, no ID documents, no location tracking, no ads, no resale of data — ever.**

## How students are linked to your college (no impersonation by typing a name)
1. **Roster import** — your placement cell uploads the student CSV; accounts link automatically when each student signs in with their listed email.
2. **Join code** — an 8-character code you share in class groups; joins can require your approval.
3. **Verified email domains** — sign-ins from `@yourcollege.ac.in` (and subdomains) auto-link. Public providers (gmail etc.) cannot be claimed as college domains.

Your dashboard shows **only your institution's students** — tenancy is enforced in every query server-side, and a second college can never see your data.

## Consent (DPDP Act 2023–compliant, enforced in code)
- Every student explicitly accepts a plain-language, versioned consent screen before using the platform.
- Visibility of a student's readiness to your placement cell is a **specific consent choice**; students who decline simply don't appear in your dashboards (the filter is server-side).
- Students can withdraw at any time (leave college / toggle consent) with immediate effect.
- **Minors:** first-years under 18 require verifiable guardian consent under DPDP; the college collects this alongside its usual admissions consents when onboarding via roster. We supply the consent text.

## Student rights, delivered in-product
- **Full data export** (JSON, one click) covering every collection held.
- **Account deletion** with a 7-day grace window, then an automatic cascade that removes all data, roster rows and task assignments.
- Grievance channel in-app with DPDP-timeline responses.

## Security posture
- OAuth sign-in only (no passwords stored); httpOnly signed session cookies; CSRF protection; strict CORS; Helmet security headers; per-route and per-plan rate limits.
- Role- and college-scoped access control on every endpoint; placement-cell accounts are individually verified before activation.
- Request-id tracing on every response; server errors logged with 30-day auto-expiry.
- Verified skill credentials signed with Ed25519 (tamper-evident), key rotation supported.
- Hosting: MongoDB (Mumbai region recommended for Indian deployments), TLS everywhere.

## What your college receives
- Placement-cell command center (funnel, at-risk register, branch/batch matrices, skill coverage, momentum).
- Roster and membership administration with approval controls.
- Real nudges and task assignments to students (in-app guaranteed; email when enabled).
- One-click CSV exports suitable as evidence for **NAAC Criterion 5 / NIRF graduation-outcome documentation**.

## What we ask of the college
A placement-cell owner for the pilot, the student roster CSV, a kickoff slot with the cohort, and guardian-consent collection for any minors — that's all.

*Questions or a security review call: raise them with your Career Autopilot contact. We would rather answer them before the pilot than after.*
