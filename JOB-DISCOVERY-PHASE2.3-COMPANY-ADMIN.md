# Job Discovery OS Phase 2.3 — Company-Centric Admin

## Production seed correction

- Fixes the production MongoDB `MongoBulkWriteError` code 40 caused by Mongoose timestamps colliding with `updatedAt` in `$setOnInsert`.
- Seed bulk writes remove `createdAt` and `updatedAt` from insert payloads and let Mongoose timestamps own those paths.
- Curated seed metadata remains disjoint between `$setOnInsert` and `$set`.
- The bundled curated direct-employer tier is committed before remote catalog expansion. If remote expansion is unavailable, the registry remains populated and usable instead of reverting to an empty state.
- Remote expansion still targets 1,000 persisted company career entries from the public OpenJobs company/ATS dataset when reachable.

## Company-centric administration

- Searchable/paginated company registry: 20 companies per page.
- Company groups: Startup/Scale-up, MNC/Enterprise, Unclassified.
- Group counters show stored companies by classification.
- Filters: company type, industry, region, India relevance, ATS/provider, source-resolution state, and whether currently available jobs exist.
- Exact available-job counts are attached to each company.
- Clicking a company opens only that company's currently available canonical jobs, with search and 20 jobs per page.
- Available means `NEW + ACTIVE + LIKELY_ACTIVE`; `STALE` and `REMOVED` records remain available for provenance but do not inflate available-job counts.
- Company type is not guessed for externally sourced seed rows when reliable size/funding evidence is absent.

## Preserved production hardening

- Dedicated Admin → Job Discovery route/navigation.
- Exact global currently-available job count.
- No artificial admin target/page ceiling; large work checkpoints/resumes at execution deadline.
- Vercel cron consumers with `CRON_SECRET`.
- Vercel `builds`/`functions` conflict removed.
- Muse API key support retained.
- Duplicate Mongo index warnings fixed.
