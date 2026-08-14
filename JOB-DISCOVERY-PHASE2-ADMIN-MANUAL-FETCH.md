# Job Discovery Phase 2 — Admin Manual Fetch

Added a platform-admin-only Job Discovery control surface and bounded manual ingestion API.

## Operator flow

- **Fetch next due batch**: processes 1–3 due sources.
- **Fetch selected source**: runs one registered ALLOW source immediately.
- **Register & fetch**: accepts a public ATS/careers URL, registers it through the normal source-discovery/policy layer, then ingests it.
- Optional small discovery and verification slices can run after the fetch.

## Safety

Manual fetch does not bypass the normal SSRF, robots/access policy, rate control, normalizer, dedupe, freshness or provenance pipeline. Source and page limits are server-side capped (3 sources, 3 pages/source) to reduce serverless timeout risk. REVIEW/DENY sources cannot be forced by the admin UI.
