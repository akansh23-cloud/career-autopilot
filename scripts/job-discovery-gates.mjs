#!/usr/bin/env node
/* ============================================================
   JOB DISCOVERY OS — QUALITY GATES  (§64)
   ------------------------------------------------------------
   Runs the deterministic, network-free job-discovery test suite
   and maps every assertion to one of the seven gates:

     SOURCE_GATE      adapters normalize to the canonical contract
     INGEST_GATE      raw -> normalized, no fabricated fields
     DEDUPE_GATE      adversarial duplicate fixtures
     FRESHNESS_GATE   closure vs transient failure, date semantics
     SEARCH_GATE      zero-candidate search, ranking, filters
     SECURITY_GATE    SSRF, redirects, robots, rate limits, browser
     INTEGRATION_GATE UI migration, no fan-out, Resume OS boundary

   A gate with no assertions is reported NO COVERAGE, never PASS.

     node scripts/job-discovery-gates.mjs
     node scripts/job-discovery-gates.mjs --json
   ============================================================ */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const asJson = process.argv.includes('--json');

const TEST_FILES = [
  'test/jobDiscoveryNormalization.test.js',
  'test/jobDiscoveryDedupeFreshness.test.js',
  'test/jobDiscoverySearch.test.js',
  'test/jobDiscoverySecurity.test.js',
  'test/jobDiscoveryIntegration.test.js',
  'test/jobDiscoveryPhase11Hardening.test.js',
];

/* Assertion -> gate. Explicit gate prefixes win; otherwise the file and the
   subject matter decide, so nothing is silently unattributed. */
const GATES = {
  SOURCE_GATE: {
    label: 'Source adapters',
    match: (name, file) => /^SOURCE_GATE/.test(name)
      || (file.includes('Normalization') && /adapter|Greenhouse|Lever|Ashby|Workable|SmartRecruiters|ATS fingerprint/i.test(name)),
    requires: ['Greenhouse', 'Lever', 'Ashby', 'Workable'],
  },
  INGEST_GATE: {
    label: 'Raw → normalized ingestion',
    match: (name, file) => /^INGEST_GATE/.test(name)
      || (file.includes('Normalization') && /normaliz|canonical|provenance|parseSourceDate|compensation|employment|location|remote scope|taxonomy|title|company|MinHash|ingest pipeline|JSON-LD|__NEXT_DATA__|HTML job links|normalizeUrl|registrableDomain|salary|expands to the families/i.test(name))
      || /ingesting the same vacancy/i.test(name),
  },
  DEDUPE_GATE: {
    label: 'Deduplication',
    match: (name) => /^DEDUPE_GATE/.test(name) || /dedupe|duplicate|blocking keys|SOURCE AUTHORITY/i.test(name),
  },
  FRESHNESS_GATE: {
    label: 'Freshness & lifecycle',
    match: (name) => /^FRESHNESS_GATE/.test(name)
      || /§58|staleness|needsVerification|reappear|transient|404|closed/i.test(name),
  },
  SEARCH_GATE: {
    label: 'Search & ranking',
    match: (name, file) => /^SEARCH_GATE/.test(name)
      || (file.includes('Search') && !/^SECURITY_GATE/.test(name))
      || /§57/.test(name),
  },
  SECURITY_GATE: {
    label: 'Crawler safety',
    match: (name, file) => /^SECURITY_GATE/.test(name) || file.includes('Security'),
  },
  INTEGRATION_GATE: {
    label: 'Product integration',
    match: (name, file) => /^INTEGRATION_GATE/.test(name) || file.includes('Integration'),
  },
};

function runFile(file) {
  const res = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' }, maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = res.stdout || '';
  const assertions = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*(not ok|ok)\s+\d+\s+-\s+(.*)$/);
    if (!m) continue;
    const name = m[2].trim();
    if (name.endsWith('.test.js')) continue; // file-level roll-up
    assertions.push({ ok: m[1] === 'ok', name, file });
  }
  return { file, assertions, exitCode: res.status, stdout };
}

function main() {
  const started = Date.now();
  const all = [];
  const perFile = [];

  for (const file of TEST_FILES) {
    if (!fs.existsSync(path.join(ROOT, file))) {
      perFile.push({ file, missing: true, assertions: 0, failures: 0 });
      continue;
    }
    const r = runFile(file);
    all.push(...r.assertions);
    perFile.push({
      file, missing: false,
      assertions: r.assertions.length,
      failures: r.assertions.filter((a) => !a.ok).length,
      exitCode: r.exitCode,
    });
  }

  const results = {};
  const claimed = new Set();

  for (const [gate, def] of Object.entries(GATES)) {
    const hits = all.filter((a) => def.match(a.name, a.file));
    hits.forEach((h) => claimed.add(h));
    const failures = hits.filter((a) => !a.ok);

    /* A gate that names required subjects must actually cover each of them. */
    const missingRequirements = (def.requires || []).filter(
      (req) => !hits.some((h) => new RegExp(req, 'i').test(h.name)),
    );

    let status;
    if (!hits.length) status = 'NO COVERAGE';
    else if (failures.length) status = 'FAIL';
    else if (missingRequirements.length) status = 'INCOMPLETE';
    else status = 'PASS';

    results[gate] = {
      label: def.label,
      status,
      assertions: hits.length,
      failures: failures.map((f) => f.name),
      missingRequirements,
    };
  }

  const unattributed = all.filter((a) => !claimed.has(a));
  const totalFailures = all.filter((a) => !a.ok).length;
  const overall = Object.values(results).every((r) => r.status === 'PASS') && totalFailures === 0
    ? 'PASS' : 'FAIL';

  const summary = {
    generatedAt: new Date().toISOString(),
    overall,
    totalAssertions: all.length,
    totalFailures,
    durationMs: Date.now() - started,
    gates: results,
    files: perFile,
    unattributedAssertions: unattributed.length,
    network: 'none — every test runs against injected fetch, DNS, clock and jitter',
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('════════════════════════════════════════════════════════════');
    console.log('JOB DISCOVERY OS — QUALITY GATES');
    console.log('════════════════════════════════════════════════════════════');
    for (const [gate, r] of Object.entries(results)) {
      const mark = { PASS: '✓', FAIL: '✗', 'NO COVERAGE': '·', INCOMPLETE: '!' }[r.status];
      console.log(`${mark} ${gate.padEnd(18)} ${r.status.padEnd(12)} ${String(r.assertions).padStart(3)} assertions  ${r.label}`);
      for (const f of r.failures) console.log(`    FAILED: ${f}`);
      for (const m of r.missingRequirements) console.log(`    MISSING COVERAGE FOR: ${m}`);
    }
    console.log('────────────────────────────────────────────────────────────');
    console.log(`${summary.totalAssertions} assertions, ${summary.totalFailures} failures, ${summary.durationMs}ms`);
    console.log(`unattributed assertions: ${summary.unattributedAssertions}`);
    console.log(`OVERALL: ${overall}`);
  }

  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'reports/job-discovery-gates.json'), `${JSON.stringify(summary, null, 2)}\n`);

  process.exit(overall === 'PASS' ? 0 : 1);
}

main();
