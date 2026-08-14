# Job Discovery OS — Phase 2.1 Production Runtime Hardening

This package continues from the Phase 2 Scale branch and keeps Resume OS frozen.

## Changes

- **No artificial manual-ingestion count ceiling.** Admin batches are no longer truncated by target/page-count caps. On serverless deployments the wall-clock execution deadline still applies; unfinished targets/pages are checkpointed or queued so work continues instead of returning a destructive partial result.
- **Durable Vercel workers.** Secret-protected cron endpoints process bootstrap, crawl, discovery and verification queues. `CRON_SECRET` is mandatory for these machine-to-machine routes.
- **1,000-company searchable registry.** 268 curated direct employer career entry points ship with the package. `Seed / refresh 1,000` extends and persists the registry from the public Outscal/OpenJobs dataset when outbound network is available. Imported rows are marked `SEEDED_UNVERIFIED` until validated.
- **Server-side company search.** CompanyRegistry is searchable by company, domain, industry, region, career URL and provider and is shown 20 rows per page.
- **20-job paging.** Admin canonical jobs and the normal Jobs search show 20 jobs per page with Previous/Next navigation rather than one long vertical result list.
- **Mongo scale fixes.** Admin browsing and production coverage use database pagination/aggregation rather than reading 100k–200k documents into Node.
- **Duplicate Mongoose indexes removed.** `fetchedAt` keeps its TTL index and `startedAt` keeps its explicit descending index without duplicate field-level declarations.
- **Muse authenticated mode.** `MUSE_API_KEY` is appended as `api_key` when present; unauthenticated Muse access remains a graceful fallback.

## Required production environment

```env
MONGODB_URI=...
SESSION_SECRET=...
JOB_DISCOVERY_STORE=mongo
CRON_SECRET=<strong-random-secret>
```

Recommended/optional:

```env
MUSE_API_KEY=...
JOB_DISCOVERY_CRON_BUDGET_MS=45000
JOB_DISCOVERY_MANUAL_BUDGET_MS=45000
JOB_DISCOVERY_BROWSER=0
JOB_DISCOVERY_ATLAS_SEARCH_INDEX=job_search
```

The count of jobs/companies is intentionally not capped for operator stress tests. `*_BUDGET_MS` is a **request-lifetime safety budget**, not a data limit: once the budget is reached, the next cursor/task remains durable and later worker invocations continue it.

## Company seed semantics

The UI target of 1,000 means **1,000 persisted company career-source records**, not 1,000 claims that were live-verified during build time.

- bundled curated rows: `CURATED_DIRECT`
- imported public rows: `SEEDED_UNVERIFIED`
- later source discovery / fetches update provider, source health and verification state

This prevents stale third-party metadata from being presented as verified truth.

## Vercel cron routes

- `GET /api/cron/job-discovery/bootstrap`
- `GET /api/cron/job-discovery/crawl`
- `GET /api/cron/job-discovery/discover`
- `GET /api/cron/job-discovery/verify`

All require `Authorization: Bearer $CRON_SECRET`. The shipped `vercel.json` schedules daily staggered invocations for broad plan compatibility. On a Vercel plan that supports more frequent Cron schedules, increase cadence without changing the worker design.

## Seed scheduling fairness

Seeded employers are not processed by repeatedly taking the first rows forever. Each company carries a durable `discoveryQueueCount`; candidate selection sorts the least-queued employers first. This guarantees the catalog rotates even when multiple queue operations share the same timestamp or an early employer is already in backoff/dedup state.

The career catalog is actionable input: unsourced rows are fed into the same durable discovery queue as job-derived leads, preserving source-policy, SSRF, robots, provider detection, retry/backoff, and provenance behavior.
