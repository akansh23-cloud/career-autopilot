#!/usr/bin/env node
/* ============================================================
   JOB DISCOVERY OS — QUALITY GATES
   ------------------------------------------------------------
   Runs the deterministic, network-free job-discovery suite and
   maps every assertion to a gate. A gate with no assertions is
   reported NO COVERAGE — never PASS, because "nothing ran" and
   "everything passed" must not look the same.

     SOURCE_GATE              phase-1 adapters, canonical contract
     SOURCE_EXPANSION_GATE    the 20-provider surface: detection,
                              tenants, configuration honesty
     DISCOVERY_GATE           durable lead queue, dedupe, backoff,
                              company registry, end-to-end chain
     INGEST_GATE              raw -> normalized, crawl queue,
                              leases, checkpoints, dead letters,
                              and the destructive-failure guard
     DEDUPE_GATE              adversarial duplicate fixtures
     FRESHNESS_GATE           closure vs transient failure, dates
     SEARCH_GATE              phase-1 search, ranking, filters
     SEARCH_RELEVANCE_GATE    graded nDCG benchmarks + query parsing
     SEARCH_SCALE_GATE        large-corpus retrieval correctness
     SECURITY_GATE            SSRF, redirects, robots, rate limits
     INTEGRATION_GATE         UI wiring, no fan-out, OS boundary
     RESUME_OS_REGRESSION_GATE  Resume OS and Template OS compared
                              against a baseline recorded from the
                              pristine pre-phase-2 package. NEW
                              failures fail the gate; failures that
                              were already there do not, and are
                              reported as inherited.

     node scripts/job-discovery-gates.mjs
     node scripts/job-discovery-gates.mjs --json
     node scripts/job-discovery-gates.mjs --skip-resume   (faster)
   ============================================================ */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const skipResume = argv.includes('--skip-resume');

const TEST_FILES = [
  'test/jobDiscoveryNormalization.test.js',
  'test/jobDiscoveryDedupeFreshness.test.js',
  'test/jobDiscoverySearch.test.js',
  'test/jobDiscoverySecurity.test.js',
  'test/jobDiscoveryIntegration.test.js',
  'test/jobDiscoveryPhase11Hardening.test.js',
  'test/jobDiscoveryProviders.test.js',
  'test/jobDiscoveryQueues.test.js',
  'test/jobDiscoveryRelevance.test.js',
  'test/jobDiscoveryScale.test.js',
];

const BASELINE_PATH = 'test/fixtures/resumeOsBaseline.json';

/* Assertion -> gate. An explicit gate prefix always wins; the file and subject
   matter are only a fallback, so nothing is silently unattributed. */
const GATES = {
  SOURCE_GATE: {
    label: 'Source adapters (phase 1)',
    match: (name, file) => /^SOURCE_GATE/.test(name)
      || (file.includes('Normalization') && /adapter|Greenhouse|Lever|Ashby|Workable|SmartRecruiters|ATS fingerprint/i.test(name)),
    requires: ['Greenhouse', 'Lever', 'Ashby', 'Workable'],
  },
  SOURCE_EXPANSION_GATE: {
    label: 'Provider expansion',
    match: (name, file) => /^SOURCE_EXPANSION_GATE/.test(name) || file.includes('Providers'),
    /* The expansion is only real if these specific surfaces are exercised. */
    requires: ['Workday', 'Oracle', 'NOT_CONFIGURED', 'spec-driven', 'schema.org'],
  },
  DISCOVERY_GATE: {
    label: 'Autonomous source discovery',
    match: (name) => /^DISCOVERY_GATE/.test(name),
    requires: ['never queued twice', 'back off', 'end to end', 'company registry'],
  },
  INGEST_GATE: {
    label: 'Ingestion & crawl queue',
    match: (name, file) => /^INGEST_GATE/.test(name)
      || (file.includes('Normalization') && /normaliz|canonical|provenance|parseSourceDate|compensation|employment|location|remote scope|taxonomy|title|company|MinHash|ingest pipeline|JSON-LD|__NEXT_DATA__|HTML job links|normalizeUrl|registrableDomain|salary|expands to the families/i.test(name))
      || /ingesting the same vacancy/i.test(name),
    requires: ['exactly one crawl', 'lease', 'checkpoint', 'dead-letter', 'survive untouched'],
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
    label: 'Search & ranking (phase 1)',
    match: (name, file) => /^SEARCH_GATE/.test(name)
      || (file.includes('DiscoverySearch') && !/^SECURITY_GATE/.test(name))
      || /§57/.test(name),
  },
  SEARCH_RELEVANCE_GATE: {
    label: 'Graded relevance',
    match: (name, file) => /^SEARCH_RELEVANCE_GATE/.test(name) || file.includes('Relevance'),
    requires: ['relation-class ordering', 'parsed into the right intent'],
  },
  SEARCH_SCALE_GATE: {
    label: 'Retrieval at scale',
    match: (name, file) => /^SEARCH_SCALE_GATE/.test(name) || file.includes('DiscoveryScale'),
    requires: ['one-in-N posting', 'bounded', 'closed jobs never surface'],
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
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' },
    maxBuffer: 32 * 1024 * 1024, timeout: 600000,
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

/**
 * Resume OS regression.
 *
 * The comparison is against a baseline recorded from the PRISTINE pre-phase-2
 * package, so this answers precisely "did phase 2 break anything?" — not "does
 * every Resume OS test pass in this environment?". Several suites cannot even
 * load without installed dependencies; they were already failing before phase 2
 * touched anything, and reporting them as new damage would be false.
 */
function runResumeRegression() {
  const baselinePath = path.join(ROOT, BASELINE_PATH);
  if (!fs.existsSync(baselinePath)) {
    return {
      label: 'Resume OS / Template OS regression',
      status: 'NO COVERAGE',
      assertions: 0,
      failures: ['no baseline recorded; cannot prove absence of regression'],
      missingRequirements: [],
    };
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const files = Object.keys(baseline.files);

  const newFailures = [];
  const inherited = [];
  let checked = 0;

  for (const file of files) {
    if (!fs.existsSync(path.join(ROOT, file))) {
      newFailures.push(`${file} no longer exists`);
      continue;
    }
    const r = runFile(file);
    const now = new Map(r.assertions.map((a) => [a.name, a.ok]));

    for (const name of baseline.files[file].passingNames) {
      checked += 1;
      if (!now.has(name)) {
        newFailures.push(`${file} :: "${name}" disappeared`);
      } else if (!now.get(name)) {
        newFailures.push(`${file} :: "${name}" passed before phase 2 and fails now`);
      }
    }
    for (const name of baseline.files[file].failingNames) {
      inherited.push(`${file} :: ${name}`);
    }
  }

  return {
    label: 'Resume OS / Template OS regression',
    status: newFailures.length ? 'FAIL' : 'PASS',
    assertions: checked,
    failures: newFailures,
    missingRequirements: [],
    inheritedFailures: inherited,
    baselineRecordedAt: baseline.generatedAt,
    baselineSource: baseline.source,
  };
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

    /* A gate that names required subjects must actually cover each of them —
       otherwise a gate can go green while testing nothing that matters. */
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

  results.RESUME_OS_REGRESSION_GATE = skipResume
    ? {
      label: 'Resume OS / Template OS regression',
      status: 'NO COVERAGE',
      assertions: 0,
      failures: ['skipped with --skip-resume'],
      missingRequirements: [],
    }
    : runResumeRegression();

  const unattributed = all.filter((a) => !claimed.has(a));
  const totalFailures = all.filter((a) => !a.ok).length;
  const overall = Object.values(results).every((r) => r.status === 'PASS') && totalFailures === 0
    ? 'PASS' : 'FAIL';

  const summary = {
    generatedAt: new Date().toISOString(),
    overall,
    jobDiscoveryAssertions: all.length,
    resumeRegressionAssertions: results.RESUME_OS_REGRESSION_GATE.assertions || 0,
    totalFailures,
    durationMs: Date.now() - started,
    gates: results,
    files: perFile,
    unattributedAssertions: unattributed.length,
    unattributedNames: unattributed.map((a) => `${a.file} :: ${a.name}`),
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
      console.log(`${mark} ${gate.padEnd(26)} ${r.status.padEnd(12)} ${String(r.assertions).padStart(4)} assertions  ${r.label}`);
      for (const f of r.failures) console.log(`    FAILED: ${f}`);
      for (const m of r.missingRequirements) console.log(`    MISSING COVERAGE FOR: ${m}`);
      if (r.inheritedFailures?.length) {
        console.log(`    inherited (already failing before phase 2, unchanged): ${r.inheritedFailures.length}`);
        for (const i of r.inheritedFailures) console.log(`      · ${i}`);
      }
    }
    console.log('────────────────────────────────────────────────────────────');
    console.log(`${summary.jobDiscoveryAssertions} job-discovery assertions + ${summary.resumeRegressionAssertions} regression checks, ${summary.totalFailures} failures, ${summary.durationMs}ms`);
    console.log(`unattributed assertions: ${summary.unattributedAssertions}`);
    for (const n of summary.unattributedNames) console.log(`    · ${n}`);
    console.log(`OVERALL: ${overall}`);
  }

  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'reports/job-discovery-gates.json'), `${JSON.stringify(summary, null, 2)}\n`);

  process.exit(overall === 'PASS' ? 0 : 1);
}

main();
