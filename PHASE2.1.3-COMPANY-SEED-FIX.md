# Phase 2.1.3 — Company Career Registry Seed Fix

## Production failure fixed
`POST /api/admin/job-discovery/company-seeds` returned HTTP 500 on MongoDB because seed metadata fields were present in both `$setOnInsert` and `$set` in the same `bulkWrite` update. MongoDB rejects overlapping update paths.

The Mongo seed writer now removes `$set`-owned metadata from `$setOnInsert`, preserving idempotent inserts and metadata refreshes while leaving stronger discovered company fields untouched.

## Additional hardening
- Company seed route logs structured failure details for Vercel runtime diagnostics.
- Removed duplicate `assignments.userId` Mongoose index declaration from CollegeTask schema.
- Existing 1,000-company workflow remains: bundled curated direct employers first, then OpenJobs direct career/ATS company records until the requested target is reached.
- Existing searchable 20-row company pages and 20-row job pages are unchanged.

## Validation
- Job Discovery tests: 221/221 PASS.
- New Mongo regression verifies `$set` and `$setOnInsert` have zero overlapping paths.
- Changed JS files pass `node --check`.
- Local Vite build was not rerun in the audit container because dependencies/node_modules are intentionally absent from the artifact; the patch does not modify frontend source.
