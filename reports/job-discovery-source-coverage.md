# Job Discovery OS — Source Coverage

> **Basis: FIXTURE.** Measured against the offline fixture world in test/fixtures/jobDiscovery/. NOT production coverage.
> Generated 2026-08-14T07:40:29.896Z.

## Adapters implemented

| Provider | Adapter | Class | Status | Notes |
|---|---|---|---|---|
| GREENHOUSE | GreenhouseAdapter | ORIGINAL_ATS | ready | no credentials required |
| LEVER | LeverAdapter | ORIGINAL_ATS | ready | no credentials required |
| ASHBY | AshbyAdapter | ORIGINAL_ATS | ready | no credentials required |
| WORKABLE | WorkableAdapter | ORIGINAL_ATS | ready | no credentials required |
| SMARTRECRUITERS | SmartRecruitersAdapter | ORIGINAL_ATS | PUBLIC | public postings endpoint |
| GENERIC | GenericCareerSiteAdapter | ORIGINAL_CAREER_SITE | ready | no credentials required |
| API | AggregatorAdapter | AGGREGATOR | ready | no credentials required |

## Sources

- Registered: **8**
- By provider: API=1, GREENHOUSE=1, LEVER=1, ASHBY=1, WORKABLE=1, SMARTRECRUITERS=1, GENERIC=2
- By status: ACTIVE=8
- By class: AGGREGATOR=1, ORIGINAL_ATS=5, ORIGINAL_CAREER_SITE=2

## Ingestion runs (fixture)

| Provider | Tenant | Result | Fetched | New | Merged | Rejected | Errors |
|---|---|---|---|---|---|---|---|
| GREENHOUSE | northwindlabs | OK | 3 | 3 | 0 | 0 | — |
| LEVER | harbourpoint | OK | 2 | 2 | 0 | 0 | — |
| ASHBY | vellumsystems | OK | 2 | 2 | 0 | 0 | — |
| WORKABLE | corvidanalytics | FAIL | 0 | 0 | 0 | 0 | UNKNOWN |
| SMARTRECRUITERS | Meridian | OK | 1 | 1 | 0 | 0 | — |
| GENERIC | careers.orchardworks.com | OK | 1 | 1 | 0 | 0 | — |
| GENERIC | jobs.tessellate.io | OK | 2 | 2 | 0 | 0 | — |
| API | Remotive | OK | 20 | 1 | 19 | 0 | — |

## Jobs

- Total canonical jobs: **12**
- Active: 11 · New: 9 · Stale: 0 · Removed: 1
- By status: NEW=9, REMOVED=1, ACTIVE=2
- By provider: GREENHOUSE=3, LEVER=2, ASHBY=2, API=2, SMARTRECRUITERS=1, GENERIC=3

## Coverage

| Metric | Value |
|---|---|
| Original-source jobs | 11 (91.7%) |
| Supplemental-only jobs | 1 (8.3%) |
| Direct-apply jobs | 11 (91.7%) |
| Jobs with a source-stated publish date | 91.7% |
| Jobs with a stated salary | 25% |
| Verification coverage | 100% |
| Dedupe ratio (instances per canonical job) | 1.08 |
| Browser fallback share of extractions | 0% |

Verification pass: checked 12, alive 11, closed 1, inconclusive 0.

## Demonstration searches — no resume, no profile, no evidence graph

### DevOps Engineer — Remote India

5 shown of 7 matches.

| # | Title | Company | Score | Title match | Source | Instances | sourcePublishedAt | firstSeenAt | lastVerifiedAt | Label basis | Remote scope | Direct apply |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | DevOps Engineer | Vellum Systems | 95 | EXACT | ASHBY (original) | 2 | 2026-08-13T06:30:00.000Z | 2026-08-14T12:00:00.000Z | 2026-08-14T12:00:00.000Z | posted | REMOTE_COUNTRY | yes |
| 2 | Senior Platform Engineer | Northwind Labs | 54 | STRONG | GREENHOUSE (original) | 1 | 2026-08-11T14:00:00.000Z | 2026-08-14T12:00:00.000Z | 2026-08-14T12:00:00.000Z | posted | ONSITE | yes |
| 3 | Backend Engineer, Payments | Harbourpoint | 38 | RELATED | LEVER (original) | 1 | 2026-08-11T00:00:00.000Z | 2026-08-14T12:00:00.000Z | 2026-08-14T12:00:00.000Z | posted | HYBRID | yes |

### Java Backend — Bangalore

2 shown of 2 matches.

| # | Title | Company | Score | Title match | Source | Instances | sourcePublishedAt | firstSeenAt | lastVerifiedAt | Label basis | Remote scope | Direct apply |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Java Backend Engineer | Meridian | 73 | ALIAS | SMARTRECRUITERS (original) | 1 | 2026-08-12T11:45:00.000Z | 2026-08-14T12:00:00.000Z | 2026-08-14T12:00:00.000Z | posted | ONSITE | yes |
| 2 | Backend Engineer, Payments | Harbourpoint | 73 | ALIAS | LEVER (original) | 1 | 2026-08-11T00:00:00.000Z | 2026-08-14T12:00:00.000Z | 2026-08-14T12:00:00.000Z | posted | HYBRID | yes |

### Data Engineer — Remote

5 shown of 5 matches.

| # | Title | Company | Score | Title match | Source | Instances | sourcePublishedAt | firstSeenAt | lastVerifiedAt | Label basis | Remote scope | Direct apply |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | DevOps Engineer | Vellum Systems | 35 | RELATED | ASHBY (original) | 2 | 2026-08-13T06:30:00.000Z | 2026-08-14T12:00:00.000Z | 2026-08-14T12:00:00.000Z | posted | REMOTE_COUNTRY | yes |
| 2 | Remote Support Engineer | Alderman Foods | 31 | WEAK | GENERIC (original) | 1 | 2026-08-12T00:00:00.000Z | 2026-08-14T12:00:00.000Z | 2026-08-14T12:00:00.000Z | posted | REMOTE_COUNTRY | yes |
| 3 | QA Engineer | Tessellate | 29 | WEAK | GENERIC (original) | 1 | 2026-08-06T00:00:00.000Z | 2026-08-14T12:00:00.000Z | 2026-08-14T12:00:00.000Z | posted | UNKNOWN | yes |

### Product Manager — India

1 shown of 1 matches.

| # | Title | Company | Score | Title match | Source | Instances | sourcePublishedAt | firstSeenAt | lastVerifiedAt | Label basis | Remote scope | Direct apply |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Product Manager, Growth | Vellum Systems | 72 | ALIAS | ASHBY (original) | 1 | 2026-08-09T08:00:00.000Z | 2026-08-14T12:00:00.000Z | 2026-08-14T12:00:00.000Z | posted | ONSITE | yes |

---

Percentages are computed over the fixture corpus only. Production coverage is
whatever the deployed crawl scheduler has actually ingested, and is reported by
`GET /api/admin/job-discovery/coverage`.
