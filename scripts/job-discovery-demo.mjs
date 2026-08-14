#!/usr/bin/env node
/* ============================================================
   JOB DISCOVERY OS — LIVE PRODUCT DEMONSTRATION  (§66)
   + SOURCE COVERAGE REPORT                        (§63)
   ------------------------------------------------------------
   Builds a complete fixture world, runs the ACTUAL
   JobDiscoveryService end to end — register -> crawl -> normalize
   -> dedupe -> verify -> index — and then performs the four
   demonstration searches with NO resume, NO profile and NO
   evidence graph.

   EVERY NUMBER PRINTED BY THIS SCRIPT IS A FIXTURE MEASUREMENT.
   It is labelled as such in the output and in both report files.
   These are not production coverage figures and must never be
   presented as one.

     node scripts/job-discovery-demo.mjs
     node scripts/job-discovery-demo.mjs --json
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { makeService, makeSource } from '../test/fixtures/jobDiscovery/harness.js';
import * as F from '../test/fixtures/jobDiscovery/providers.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPORT_DIR = path.join(ROOT, 'reports');
const NOW = () => new Date('2026-08-14T12:00:00.000Z');
const asJson = process.argv.includes('--json');

const out = [];
const say = (s = '') => { out.push(s); if (!asJson) console.log(s); };

/* The demonstration world. Fictional employers only; no live tenant is baked
   in as though it were a real user-facing board (§53). */
const ROUTES = [
  [/robots\.txt/, { body: F.robotsTxt, contentType: 'text/plain' }],
  [/boards-api\.greenhouse\.io\/v1\/boards\/northwindlabs\/jobs/, { body: F.greenhouseBoard, headers: { etag: 'W/"gh-1"' } }],
  [/api\.lever\.co\/v0\/postings\/harbourpoint/, { body: F.leverPostings }],
  [/api\.ashbyhq\.com\/posting-api\/job-board\/vellumsystems/, { body: F.ashbyBoard }],
  [/apply\.workable\.com\/api\/v1\/widget\/accounts\/corvidanalytics/, { body: F.workableAccount }],
  [/api\.smartrecruiters\.com\/v1\/companies\/Meridian\/postings/, { body: F.smartRecruitersPostings }],
  [/^https:\/\/careers\.orchardworks\.com\/?$/, { body: F.jsonLdCareerPage }],
  [/^https:\/\/jobs\.tessellate\.io\/?$/, { body: F.nextDataCareerPage }],

  /* Re-verification targets. One posting is deliberately GONE (410) so the
     demonstration exercises real closure detection rather than only the happy
     path; every other posting answers 200 and must survive the pass. */
  [/boards\.greenhouse\.io\/northwindlabs\/jobs\/4118823/, { status: 410, body: 'This job is no longer open.' }],
  [/boards\.greenhouse\.io\/northwindlabs\/jobs\//, { body: '<html><body>Open role</body></html>' }],
  [/jobs\.lever\.co\//, { body: '<html><body>Open role</body></html>' }],
  [/jobs\.ashbyhq\.com\//, { body: '<html><body>Open role</body></html>' }],
  [/apply\.workable\.com\/[a-z]/, { body: '<html><body>Open role</body></html>' }],
  [/jobs\.smartrecruiters\.com\//, { body: '<html><body>Open role</body></html>' }],
  [/careers\.aldermanfoods\.example\//, { body: '<html><body>Open role</body></html>' }],
  [/pelicanfreight\.example\/careers\//, { body: '<html><body>Open role</body></html>' }],
  [/remotive\.com\//, { body: '<html><body>Open role</body></html>' }],
];

const SOURCES = [
  { provider: 'GREENHOUSE', sourceType: 'ATS', sourceClass: 'ORIGINAL_ATS', tenant: 'northwindlabs', companyName: 'Northwind Labs', companyDomain: 'northwindlabs.com' },
  { provider: 'LEVER', sourceType: 'ATS', sourceClass: 'ORIGINAL_ATS', tenant: 'harbourpoint', companyName: 'Harbourpoint', companyDomain: 'harbourpoint.com' },
  { provider: 'ASHBY', sourceType: 'ATS', sourceClass: 'ORIGINAL_ATS', tenant: 'vellumsystems', companyName: 'Vellum Systems', companyDomain: 'vellumsystems.com' },
  { provider: 'WORKABLE', sourceType: 'ATS', sourceClass: 'ORIGINAL_ATS', tenant: 'corvidanalytics', companyName: 'Corvid Analytics', companyDomain: 'corvidanalytics.com' },
  { provider: 'SMARTRECRUITERS', sourceType: 'ATS', sourceClass: 'ORIGINAL_ATS', tenant: 'Meridian', companyName: 'Meridian', companyDomain: 'meridian.com' },
  { provider: 'GENERIC', sourceType: 'CAREER_SITE', sourceClass: 'ORIGINAL_CAREER_SITE', tenant: 'careers.orchardworks.com', companyName: 'Orchard Works', companyDomain: 'orchardworks.com', careersUrl: 'https://careers.orchardworks.com/', crawlStrategy: 'HTML' },
  { provider: 'GENERIC', sourceType: 'CAREER_SITE', sourceClass: 'ORIGINAL_CAREER_SITE', tenant: 'jobs.tessellate.io', companyName: 'Tessellate', companyDomain: 'tessellate.io', careersUrl: 'https://jobs.tessellate.io/', crawlStrategy: 'HTML' },
];

/* A supplemental aggregator that carries ONE vacancy already published on the
   Ashby board — this is the duplicate the dedupe engine must collapse. */
const LEGACY = [{
  name: 'Remotive',
  home: 'https://remotive.com',
  fetch: async () => ([
    {
      title: 'DevOps Engineer', company: 'Vellum Systems', location: 'Remote, India', mode: 'Remote',
      url: 'https://jobs.ashbyhq.com/vellumsystems/e1a2b3c4-d5e6-4f70-8901-234567890abc',
      applyUrl: 'https://remotive.com/out/vellum-devops',
      summary: 'Run our CI/CD pipelines, Kubernetes clusters and Terraform estate. Improve deployment frequency and reduce change failure rate.',
      postedDate: '2026-08-13T06:30:00.000Z', requiredSkills: ['kubernetes', 'terraform'],
    },
    {
      title: 'Remote Support Engineer', company: 'Halcyon Cloud', location: 'Remote — US only', mode: 'Remote',
      url: 'https://remotive.com/remote-jobs/halcyon-support-77',
      summary: 'Front-line support for our cloud console. US residents only.',
      postedDate: '2026-08-12T15:00:00.000Z', requiredSkills: ['support'],
    },
  ]),
}];

const DEMO_QUERIES = [
  { label: 'DevOps Engineer — Remote India', criteria: { q: 'DevOps Engineer', location: 'Remote India', limit: 5 } },
  { label: 'Java Backend — Bangalore', criteria: { q: 'Java Backend', location: 'Bangalore', limit: 5 } },
  { label: 'Data Engineer — Remote', criteria: { q: 'Data Engineer', remote: 'remote', limit: 5 } },
  { label: 'Product Manager — India', criteria: { q: 'Product Manager', location: 'India', limit: 5 } },
];

function pad(s, n) { return String(s ?? '').padEnd(n); }

async function main() {
  const service = await makeService({ routes: ROUTES, legacySources: LEGACY, now: NOW });

  say('════════════════════════════════════════════════════════════');
  say('JOB DISCOVERY OS — FIXTURE DEMONSTRATION');
  say('All figures below are FIXTURE MEASUREMENTS, not production coverage.');
  say(`Clock pinned to ${NOW().toISOString()} for deterministic freshness.`);
  say('════════════════════════════════════════════════════════════');
  say('');

  /* ---------------------------- ingest ---------------------------- */
  say('── INGESTION ──────────────────────────────────────────────');
  const runs = [];
  for (const s of SOURCES) {
    const { source } = await service.registerSource(makeSource(s));
    const r = await service.crawlSource(source.id);
    runs.push({ ...r, tenant: s.tenant, companyName: s.companyName });
    say(`${pad(s.provider, 16)} ${pad(s.tenant, 24)} fetched=${pad(r.fetched, 4)} new=${pad(r.created, 4)} merged=${pad(r.merged, 4)} rejected=${pad(r.rejected, 4)} ${r.ok ? 'OK' : `FAIL(${r.errors.map((e) => e.errorClass).join(',')})`}`);
  }

  const agg = (await service.listSources({ sourceClass: 'AGGREGATOR' }))[0];
  if (agg) {
    const r = await service.crawlSource(agg.id);
    runs.push({ ...r, tenant: agg.tenant, companyName: 'supplemental' });
    say(`${pad('AGGREGATOR', 16)} ${pad(agg.tenant, 24)} fetched=${pad(r.fetched, 4)} new=${pad(r.created, 4)} merged=${pad(r.merged, 4)} rejected=${pad(r.rejected, 4)} ${r.ok ? 'OK' : 'FAIL'}`);
  }
  say('');

  /* -------------------------- verification --------------------------
     The clock is pinned to the ingest instant, so nothing is naturally DUE for
     re-verification yet. The pass is forced here so the demonstration exercises
     the real verification worker against the real source records rather than
     printing an empty summary. This is a forced pass, and it is labelled one. */
  for (const job of await service.store.listJobs({})) {
    await service.store.putJob({ ...job, needsVerification: true });
  }
  const verification = await service.verifier.run({ limit: 50 });
  verification.forced = true;
  say(`── VERIFICATION (forced pass) ── checked=${verification.checked} alive=${verification.alive} closed=${verification.closed} inconclusive=${verification.inconclusive}`);
  say('');

  /* ---------------------------- searches ---------------------------- */
  say('── DEMONSTRATION SEARCHES (no resume, no profile, no evidence) ──');
  const demos = [];
  for (const { label, criteria } of DEMO_QUERIES) {
    const payload = await service.search(criteria);
    demos.push({ label, criteria, payload });
    say('');
    say(`▸ ${label}`);
    say(`  personalization: resume=${payload.personalization.usedResume} profile=${payload.personalization.usedProfile} evidence=${payload.personalization.usedEvidence}`);
    say(`  ${payload.results.length} shown of ${payload.total} matches (${payload.scanned} indexed jobs scanned, ${payload.latencyMs}ms)`);
    if (!payload.results.length) {
      const why = Object.entries(payload.rejected).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(' ');
      say(`  no matches — filtered: ${why || 'none'}`);
      continue;
    }
    for (const r of payload.results) {
      const j = r.job;
      say(`  ${r.rank}. ${j.title} — ${j.company.name}  [score ${r.relevance.overall}, ${r.relevance.titleRelation}]`);
      say(`     source        ${r.source.provider} / ${r.source.type}${r.source.isOriginal ? ' (ORIGINAL)' : ' (supplemental)'} · ${r.source.instanceCount} instance(s): ${r.source.providers.join(', ')}`);
      say(`     published     ${j.sourcePublishedAt ?? 'not stated by source'}`);
      say(`     firstSeenAt   ${j.firstSeenAt}`);
      say(`     lastVerified  ${j.lastVerifiedAt ?? 'not yet re-verified'}`);
      say(`     shown as      "${r.freshness.dateLabel}"  (${r.freshness.dateKind})`);
      say(`     workplace     ${j.workplace.type} / ${j.workplace.remoteScope}${j.workplace.remoteRegions?.length ? ` [${j.workplace.remoteRegions.join(',')}]` : ''}`);
      say(`     salary        ${j.compensation.min == null && j.compensation.max == null ? 'not stated by source' : `${j.compensation.currency ?? ''} ${j.compensation.min ?? ''}–${j.compensation.max ?? ''} ${j.compensation.period ?? ''}`.trim()}`);
      say(`     apply         ${r.apply.directApply ? 'DIRECT' : 'via supplemental'} → ${j.canonicalApplyUrl ?? 'none'}`);
    }
  }
  say('');

  /* ------------------------- dedupe evidence ------------------------- */
  const all = await service.store.listJobs({});
  const multi = all.filter((j) => (j.sourceInstances || []).length > 1);
  say('── DEDUPLICATION ─────────────────────────────────────────');
  say(`${all.length} canonical jobs from ${all.reduce((n, j) => n + j.sourceInstances.length, 0)} source instances`);
  for (const j of multi) {
    say(`  merged: "${j.title}" @ ${j.company.name} ← ${j.sourceInstances.map((s) => s.provider).join(' + ')}`);
    say(`          canonical apply URL prefers the original: ${j.canonicalApplyUrl}`);
    const conflicts = Object.keys(j.conflicts || {});
    if (conflicts.length) say(`          retained source disagreements on: ${conflicts.join(', ')}`);
  }
  say('');

  /* --------------------------- coverage --------------------------- */
  const report = await service.coverageReport();
  report.basis = 'FIXTURE';
  report.basisNote = 'Measured against the offline fixture world in test/fixtures/jobDiscovery/. NOT production coverage.';
  report.verification = verification;
  report.ingestionRuns = runs.map((r) => ({
    tenant: r.tenant, provider: r.provider, ok: r.ok, fetched: r.fetched,
    created: r.created, merged: r.merged, rejected: r.rejected,
    errors: (r.errors || []).map((e) => e.errorClass),
  }));
  report.demonstration = demos.map((d) => ({
    label: d.label,
    criteria: d.criteria,
    shown: d.payload.results.length,
    total: d.payload.total,
    top: d.payload.results.slice(0, 3).map((r) => ({
      rank: r.rank, title: r.job.title, company: r.job.company.name,
      score: r.relevance.overall, titleRelation: r.relevance.titleRelation,
      provider: r.source.provider, isOriginal: r.source.isOriginal,
      sourceInstances: r.source.instanceCount,
      sourcePublishedAt: r.job.sourcePublishedAt, firstSeenAt: r.job.firstSeenAt,
      lastVerifiedAt: r.job.lastVerifiedAt, dateKind: r.freshness.dateKind,
      remoteScope: r.job.workplace.remoteScope, directApply: r.apply.directApply,
    })),
  }));

  say('── COVERAGE (FIXTURE) ─────────────────────────────────────');
  say(`sources registered        ${report.sources.registered}`);
  say(`canonical jobs            ${report.jobs.total}`);
  say(`original-source jobs      ${report.coverage.originalSourceCount} (${report.coverage.originalSourcePct}%)`);
  say(`supplemental-only jobs    ${report.coverage.supplementalOnlyCount} (${report.coverage.supplementalOnlyPct}%)`);
  say(`direct-apply jobs         ${report.coverage.directApplyCount} (${report.coverage.directApplyPct}%)`);
  say(`with a source-stated date ${report.coverage.withPublishedDatePct}%`);
  say(`with a stated salary      ${report.coverage.withSalaryPct}%`);
  say(`verification coverage     ${report.coverage.verificationCoveragePct}%`);
  say(`dedupe ratio              ${report.coverage.dedupeRatio} instances per canonical job`);
  say(`browser fallback          ${report.runtime?.browserFallbackPct ?? 0}%`);
  say('');

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'job-discovery-source-coverage.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(REPORT_DIR, 'job-discovery-source-coverage.md'), renderMarkdown(report));
  say(`Wrote reports/job-discovery-source-coverage.json and .md`);

  if (asJson) console.log(JSON.stringify({ report, transcript: out }, null, 2));
  await service.close?.();
}

function renderMarkdown(r) {
  const adapters = Object.entries(r.adapterStatus)
    .map(([p, a]) => `| ${p} | ${a.adapter} | ${a.sourceClass} | ${a.configured ? a.mode || 'ready' : 'NOT_CONFIGURED'} | ${a.reason} |`)
    .join('\n');
  const runs = (r.ingestionRuns || [])
    .map((x) => `| ${x.provider} | ${x.tenant} | ${x.ok ? 'OK' : 'FAIL'} | ${x.fetched} | ${x.created} | ${x.merged} | ${x.rejected} | ${x.errors.join(', ') || '—'} |`)
    .join('\n');
  const demos = (r.demonstration || []).map((d) => {
    const rows = d.top.map((t) => `| ${t.rank} | ${t.title} | ${t.company} | ${t.score} | ${t.titleRelation} | ${t.provider}${t.isOriginal ? ' (original)' : ''} | ${t.sourceInstances} | ${t.sourcePublishedAt ?? '—'} | ${t.firstSeenAt} | ${t.lastVerifiedAt ?? '—'} | ${t.dateKind} | ${t.remoteScope} | ${t.directApply ? 'yes' : 'no'} |`).join('\n');
    return `### ${d.label}\n\n${d.shown} shown of ${d.total} matches.\n\n| # | Title | Company | Score | Title match | Source | Instances | sourcePublishedAt | firstSeenAt | lastVerifiedAt | Label basis | Remote scope | Direct apply |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n${rows || '| — | no results | | | | | | | | | | | |'}`;
  }).join('\n\n');

  return `# Job Discovery OS — Source Coverage

> **Basis: FIXTURE.** ${r.basisNote}
> Generated ${r.generatedAt}.

## Adapters implemented

| Provider | Adapter | Class | Status | Notes |
|---|---|---|---|---|
${adapters}

## Sources

- Registered: **${r.sources.registered}**
- By provider: ${Object.entries(r.sources.byProvider || {}).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}
- By status: ${Object.entries(r.sources.byStatus || {}).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}
- By class: ${Object.entries(r.sources.byClass || {}).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}

## Ingestion runs (fixture)

| Provider | Tenant | Result | Fetched | New | Merged | Rejected | Errors |
|---|---|---|---|---|---|---|---|
${runs}

## Jobs

- Total canonical jobs: **${r.jobs.total}**
- Active: ${r.jobs.active} · New: ${r.jobs.new} · Stale: ${r.jobs.stale} · Removed: ${r.jobs.removed}
- By status: ${Object.entries(r.jobs.byStatus || {}).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}
- By provider: ${Object.entries(r.jobs.byProvider || {}).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}

## Coverage

| Metric | Value |
|---|---|
| Original-source jobs | ${r.coverage.originalSourceCount} (${r.coverage.originalSourcePct}%) |
| Supplemental-only jobs | ${r.coverage.supplementalOnlyCount} (${r.coverage.supplementalOnlyPct}%) |
| Direct-apply jobs | ${r.coverage.directApplyCount} (${r.coverage.directApplyPct}%) |
| Jobs with a source-stated publish date | ${r.coverage.withPublishedDatePct}% |
| Jobs with a stated salary | ${r.coverage.withSalaryPct}% |
| Verification coverage | ${r.coverage.verificationCoveragePct}% |
| Dedupe ratio (instances per canonical job) | ${r.coverage.dedupeRatio} |
| Browser fallback share of extractions | ${r.runtime?.browserFallbackPct ?? 0}% |

Verification pass: checked ${r.verification?.checked ?? 0}, alive ${r.verification?.alive ?? 0}, closed ${r.verification?.closed ?? 0}, inconclusive ${r.verification?.inconclusive ?? 0}.

## Demonstration searches — no resume, no profile, no evidence graph

${demos}

---

Percentages are computed over the fixture corpus only. Production coverage is
whatever the deployed crawl scheduler has actually ingested, and is reported by
\`GET /api/admin/job-discovery/coverage\`.
`;
}

main().catch((e) => { console.error(e); process.exit(1); });
