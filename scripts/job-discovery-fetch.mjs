#!/usr/bin/env node
/* ============================================================
   JOB DISCOVERY OS — MANUAL FETCH (CLI)
   ------------------------------------------------------------
   The terminal equivalent of the admin "fetch now" endpoint, for
   the job an operator actually has on day one: seeding the store
   with a list of employers.

       node scripts/job-discovery-fetch.mjs \
         https://boards.greenhouse.io/acme \
         https://jobs.lever.co/harborstack

       node scripts/job-discovery-fetch.mjs --file targets.txt
       node scripts/job-discovery-fetch.mjs --file targets.txt --dry-run
       node scripts/job-discovery-fetch.mjs --file targets.txt --queue
       node scripts/job-discovery-fetch.mjs --runs

   Targets can be board URLs, careers pages, bare company domains
   or already-registered source ids, mixed freely — the classifier
   works out which is which.

   `--file` reads one target per line; blank lines and lines
   starting with # are ignored, so a target list can be commented.

   The jobs land in the same canonical store the workers write to.
   Nothing here is a special case at read time: they are searchable
   through the ordinary index the moment this exits.

   THIS TOUCHES THE NETWORK. Every fetch runs through the same
   SSRF, robots, rate-limit and credibility guards as a scheduled
   crawl — being run by a human at a terminal grants no extra
   permission.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';

import { createJobDiscoveryService } from '../server/services/jobDiscovery/index.js';
import { RUN_MODE } from '../server/services/jobDiscovery/manualIngest.js';

const argv = process.argv.slice(2);

function flag(name) { return argv.includes(`--${name}`); }
function opt(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

const asJson = flag('json');
const dryRun = flag('dry-run');
const queueMode = flag('queue');
const showRuns = flag('runs');
const maxPages = Number(opt('max-pages')) || undefined;
const reason = opt('reason');

const say = (m) => { if (!asJson) console.log(m); };

function collectTargets() {
  const inline = argv.filter((a) => !a.startsWith('--'));
  /* Values consumed by --file/--max-pages/--reason are not targets. */
  const consumed = new Set();
  for (const name of ['file', 'max-pages', 'reason']) {
    const v = opt(name);
    if (v) consumed.add(v);
  }
  const targets = inline.filter((t) => !consumed.has(t));

  const file = opt('file');
  if (file) {
    const abs = path.resolve(process.cwd(), file);
    if (!fs.existsSync(abs)) {
      console.error(`target file not found: ${abs}`);
      process.exit(2);
    }
    for (const line of fs.readFileSync(abs, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      targets.push(t);
    }
  }
  return targets;
}

function pad(s, n) { return String(s ?? '').padEnd(n); }

async function main() {
  const service = await createJobDiscoveryService();

  if (showRuns) {
    const runs = await service.ingestRuns({ limit: Number(opt('limit')) || 20 });
    if (asJson) { console.log(JSON.stringify(runs, null, 2)); process.exit(0); }
    if (!runs.length) { say('No manual fetch runs recorded yet.'); process.exit(0); }
    say('past manual fetches');
    say('────────────────────────────────────────────────────────────');
    for (const r of runs) {
      say(`${r.startedAt}  ${pad(r.mode, 6)} ${pad(r.triggeredBy || '-', 22)} `
        + `${r.totals.targets} targets · ${r.totals.jobsCreated} new · ${r.totals.jobsMerged} merged`
        + `${r.dryRun ? ' (dry run)' : ''}`);
      if (r.reason) say(`    note: ${r.reason}`);
    }
    process.exit(0);
  }

  const targets = collectTargets();
  if (!targets.length) {
    console.error('No targets. Pass URLs/domains/source ids as arguments, or --file targets.txt');
    console.error('Run with --runs to see past fetches.');
    process.exit(2);
  }

  say('════════════════════════════════════════════════════════════');
  say(`JOB DISCOVERY OS — MANUAL FETCH${dryRun ? ' (DRY RUN)' : ''}`);
  say('════════════════════════════════════════════════════════════');
  say(`${targets.length} target${targets.length === 1 ? '' : 's'} · mode ${queueMode ? 'QUEUE' : 'INLINE'}`);
  say('');

  const result = await service.fetchNow(targets, {
    mode: queueMode ? RUN_MODE.QUEUE : RUN_MODE.INLINE,
    dryRun,
    maxPagesPerSource: maxPages,
    triggeredBy: process.env.USER || process.env.USERNAME || 'cli',
    reason,
  });

  if (!result.ok) {
    console.error(result.message || 'fetch failed');
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const r of result.results) {
      const mark = r.ok ? '✓' : '✗';
      const label = r.provider && r.tenant ? `${r.provider}:${r.tenant}` : (r.kind || '');
      say(`${mark} ${pad(r.input, 52)} ${pad(r.stage, 15)} ${label}`);
      if (r.ok && r.stage === 'CRAWLED') {
        say(`    ${r.fetched} fetched · ${r.created} new · ${r.merged} merged · ${r.changed} changed`
          + `${r.rejected ? ` · ${r.rejected} rejected` : ''}`);
        /* A small number after a big one is usually a broken parser, not a
           shrinking board. Say which, rather than leaving it to be guessed. */
        if (r.credible === false) {
          say(`    ⚠ this run was NOT credible (${(r.anomalies || []).join(', ')}) — existing jobs were retained and the source is DEGRADED`);
        }
      } else if (!r.ok) {
        say(`    ${r.reason}`);
      } else if (r.reason) {
        say(`    ${r.reason}`);
      }
    }

    const t = result.run.totals;
    say('');
    say('────────────────────────────────────────────────────────────');
    say(`${t.succeeded}/${t.targets} targets succeeded`);
    say(`sources registered  ${t.sourcesRegistered}`);
    say(`sources crawled     ${t.sourcesCrawled}${t.queued ? ` · queued ${t.queued}` : ''}`);
    say(`jobs created        ${t.jobsCreated}`);
    say(`jobs merged         ${t.jobsMerged}  (existing records updated, not duplicated)`);
    say(`jobs changed        ${t.jobsChanged}`);
    if (t.rowsRejected) say(`rows rejected       ${t.rowsRejected}  (no usable title)`);
    if (t.incredibleRuns) say(`⚠ incredible runs   ${t.incredibleRuns}  — jobs retained, sources DEGRADED`);
    if (result.truncated) say(`⚠ ${result.truncatedReason}`);
    if (result.budgetExhausted) say('⚠ the run page budget was exhausted; re-run to continue');
    say('');
    say(dryRun
      ? 'Dry run — nothing was fetched or stored, and no receipt was written.'
      : `Stored. Receipt ${result.run.id} · searchable now via /jobs/search-v2.`);
  }

  await service.close?.();
  process.exit(result.run.totals.failed && !result.run.totals.succeeded ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
