#!/usr/bin/env node
/* ============================================================
   JOB DISCOVERY OS — BACKGROUND WORKER  (§26)
   ------------------------------------------------------------
   Ingestion is a BACKGROUND activity. User search reads the
   canonical index and never fetches the internet.

   This app deploys to Vercel, where a permanent in-process
   setInterval is not a valid scheduler, so the worker exposes
   both shapes and the deployment picks one:

     node scripts/job-discovery-worker.mjs --once
         one bounded slice. Use from a cron trigger, a queue
         consumer, or a CI job.

     node scripts/job-discovery-worker.mjs --forever
         long-running worker. Local development, a container, or
         any always-on host.

   The same slice is also reachable as an authenticated HTTP
   endpoint for platforms that only offer cron-over-HTTP:

     POST /api/admin/job-discovery/tick

   Flags:
     --once | --forever
     --interval=60000       ms between ticks in forever mode
     --sources=5            sources crawled per tick
     --verify=20            jobs re-verified per tick
     --discover=5           source-discovery probes per tick
     --no-crawl --no-verify --no-discover
     --json
   ============================================================ */

import process from 'node:process';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.split('=')[1]);
  return Number.isFinite(n) ? n : fallback;
};

const asJson = has('--json');
const forever = has('--forever');
const intervalMs = val('interval', 60_000);

function log(obj, line) {
  if (asJson) console.log(JSON.stringify(obj));
  else console.log(line);
}

async function main() {
  /* Imported lazily so `--help` costs nothing and a misconfigured store fails
     with a clear message rather than at module load. */
  const { createJobDiscoveryService } = await import('../server/services/jobDiscovery/index.js');

  let mongoose = null;
  let connect = null;
  if (process.env.MONGODB_URI) {
    try {
      mongoose = (await import('mongoose')).default;
      connect = async () => {
        if (mongoose.connection.readyState === 0) {
          await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
        }
      };
    } catch (e) {
      throw new Error(`MONGODB_URI is configured but mongoose could not be loaded; refusing to split worker/API persistence: ${e?.message || e}`);
    }
  }

  /* The legacy aggregators live inside server.js. Importing server.js from a
     worker would boot the whole HTTP app, so the worker runs on ATS + career
     sites only unless JOB_DISCOVERY_LEGACY_SOURCES explicitly opts in. The
     aggregator sweep is a supplemental bootstrap, not the foundation (§2). */
  const service = await createJobDiscoveryService({
    mongoose, connect,
    backend: process.env.MONGODB_URI ? 'mongo' : undefined,
    enableBrowser: String(process.env.JOB_DISCOVERY_BROWSER || '').toLowerCase() === '1',
  });

  service.scheduler.sourcesPerTick = val('sources', service.scheduler.sourcesPerTick);
  service.scheduler.verifyPerTick = val('verify', service.scheduler.verifyPerTick);
  service.scheduler.discoverPerTick = val('discover', service.scheduler.discoverPerTick);

  const opts = {
    crawl: !has('--no-crawl'),
    verify: !has('--no-verify'),
    discover: !has('--no-discover'),
  };

  const runOnce = async () => {
    const r = await service.tick(opts);
    const crawled = r.crawled?.length ?? 0;
    const created = (r.crawled || []).reduce((n, c) => n + (c.created || 0), 0);
    const failed = (r.crawled || []).filter((c) => !c.ok).length;
    log(r, [
      `[${r.at}] tick ${r.durationMs}ms`,
      `sources=${crawled}`,
      `new=${created}`,
      `failed=${failed}`,
      r.verification ? `verified=${r.verification.checked} closed=${r.verification.closed}` : '',
      r.discovery ? `discovered=${r.discovery.results.filter((x) => x.created).length}` : '',
      r.skipped ? `SKIPPED (${r.reason})` : '',
    ].filter(Boolean).join('  '));
    return r;
  };

  if (!forever) {
    await runOnce();
    await service.close();
    if (mongoose?.connection?.readyState) await mongoose.disconnect().catch(() => {});
    return;
  }

  const controller = new AbortController();
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal} — finishing the current tick, then exiting.`);
    controller.abort();
    await service.close();
    if (mongoose?.connection?.readyState) await mongoose.disconnect().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  console.log(`Job Discovery worker started. Interval ${intervalMs}ms. Ctrl-C to stop.`);
  /* eslint-disable no-await-in-loop */
  while (!controller.signal.aborted) {
    try { await runOnce(); } catch (e) { console.error('tick failed:', e?.message || e); }
    await new Promise((r) => {
      const t = setTimeout(r, intervalMs);
      if (typeof t.unref === 'function') t.unref();
      controller.signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
    });
  }
  /* eslint-enable no-await-in-loop */
}

main().catch((e) => { console.error(e); process.exit(1); });
