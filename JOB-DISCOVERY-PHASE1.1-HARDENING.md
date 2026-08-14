# Job Discovery OS — Phase 1.1 Merge + Production Hardening

**Base:** `career-autopilot-resume-os-final-render.zip`  
**Merged subsystem:** Job Discovery Phase 1 only. Resume OS is frozen.

## Why this patch exists

The first Job Discovery package had a strong crawler/dedupe/freshness design but was built on an older application base. That reintroduced full-resume AI authoring in Jobs/Editor and omitted the completed Resume OS application/render services. It also allowed the crawler worker and HTTP search API to select different persistence backends, used a bounded first-N job scan for search/scheduling, let `REVIEW` crawl policy execute, and let the UI reorder canonical search results.

This patch starts from the final Resume OS and selectively merges the Job Discovery subsystem into it.

## Production blockers fixed

- Final Resume OS application service, truth engine, optimizer and canonical renderer preserved byte-for-byte in their service directories.
- Jobs Tailor & Apply continues through `/api/applications/package` and the canonical Resume OS; no AI-authored resume prompt was restored.
- Resume Editor remains on `ResumeOsApi.tailorForJob()`.
- User-facing Jobs search uses only `/jobs/search-v2`; it has no synchronous legacy-provider fallback.
- Search API and background worker explicitly select Mongo when `MONGODB_URI` is configured.
- Store creation fails closed if Mongo is configured but Mongoose wiring is missing, instead of silently creating a local file index.
- Mongo upserts no longer `$set` immutable `_id` fields.
- Search candidate retrieval is store/index driven; the search layer no longer takes an arbitrary first 5,000 jobs and ranks them in Node.
- Structured location/remote/company/employment/seniority constraints are applied during candidate selection, before candidate limiting. Unknown source facts remain unknown rather than being falsely excluded.
- Verification candidates are selected by due state in the store instead of an arbitrary first 2,000 jobs.
- Source discovery candidates use a durable `sourceDiscovery.nextAttemptAt` queue instead of an arbitrary first-500 scan and process-local negative cache.
- `sourceDiscovery.nextAttemptAt` is a typed Mongo `Date`, not an untyped `Mixed` string compared against a Date query.
- Source scheduling persists `crawlPriority` and queries due `ALLOW` sources by indexed schedule fields.
- `REVIEW` is not executable crawl permission. Generic career crawling proceeds only for explicit `ALLOW`.
- Source Mongo schema now persists registry metadata used by health/discovery (`companyWebsite`, `region`, error metadata, queries, discovery provenance).
- Jobs UI preserves the server's canonical discovery rank by default. Resume data may annotate gaps after selection but does not silently reorder discovery results.
- Visible experience/seniority filter is now sent to Job Discovery rather than ignored.
- Workable ingestion uses its documented public account jobs endpoint as the direct per-company strategy; no private SPI token is assumed.

## Scale regression proofs

The hardening suite includes explicit cases where:

- the only relevant DevOps job is inserted after 5,000 unrelated records and remains discoverable;
- the only Pune job is beyond the candidate limit and remains discoverable because structured location filtering happens before candidate limiting;
- the only due source-discovery record is beyond an arbitrary 500-record prefix and is still selected;
- `REVIEW` sources are absent from the executable crawl queue.

## Validation

- Job Discovery deterministic tests/gates: see `reports/job-discovery-gates.json`.
- Resume OS focused safety/core/render tests were rerun separately; the temporary audit-only Zod shim was removed afterward.
- Final Resume Render and Regression gates were rerun and remain PASS.
- JS/MJS syntax check covers the entire package.

## Deliberate remaining scope

This is still the **Job Discovery foundation**. Candidate-aware job intelligence is not implemented here. Search is deterministic and anonymous/no-resume capable. Large-scale search uses the `JobSearchIndex` abstraction and Mongo indexed candidate retrieval; a future Atlas Search/OpenSearch implementation can replace the candidate-retrieval adapter without changing ingestion or UI contracts.
