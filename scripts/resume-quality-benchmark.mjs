#!/usr/bin/env node
/* ============================================================
   RESUME NARRATIVE QUALITY BENCHMARK
   ------------------------------------------------------------
   Runs every golden fixture through BOTH modes and measures:

     truthfulness            unsupported claims + untraced metrics
     jdRelevance             weighted requirement coverage
     specificity             concrete anchors per bullet
     domainAuthenticity      practitioner vocabulary hit rate
     atsAlignment            semantic coverage without stuffing
     naturalness             machine-default pattern absence
     redundancy              inter-bullet similarity
     vocabularyDiversity     distinct openers / structures
     evidenceCoverage        evidence units represented
     unsupportedClaimCount   MUST BE ZERO

   Writes:
     reports/resume-intelligence-quality.json   machine-readable
     reports/resume-intelligence-quality.md     human-readable

   Usage:  node scripts/resume-quality-benchmark.mjs [--ai]
   ============================================================ */
import fs from 'node:fs/promises';
import path from 'node:path';
import { FIXTURES } from '../test/fixtures/resumeNarrativeFixtures.js';
import { enhanceResumeNarrative, tailorResumeNarrative } from '../server/utils/resume/narrative/narrativeEngine.js';
import { bulletSimilarity } from '../server/utils/resume/textQualityEngines.js';
import { evaluateResumeQuality } from '../server/services/resumeOs/resumeQualityEvaluator.js';

const USE_AI = process.argv.includes('--ai');
const OUT_DIR = path.resolve(process.cwd(), 'reports');

const round = (n, d = 3) => Number(Number(n).toFixed(d));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function measure(result, fixture, mode) {
  const bullets = result.bullets || [];
  const texts = bullets.map((b) => b.text);

  /* redundancy: worst pairwise similarity between chosen bullets */
  let worst = 0;
  for (let i = 0; i < texts.length; i += 1) {
    for (let k = i + 1; k < texts.length; k += 1) {
      worst = Math.max(worst, bulletSimilarity(texts[i], texts[k]));
    }
  }

  const openers = new Set(texts.map((t) => t.split(/\s+/)[0].toLowerCase()));
  const dims = bullets.map((b) => b.metadata || {});
  const globalQuality = evaluateResumeQuality(result.doc || fixture.doc, {
    jobDescription: mode === 'tailor' ? fixture.jd : '',
    targetRole: result.doc?.targetRole || fixture.doc?.targetRole || '',
  });

  return {
    fixture: fixture.id,
    label: fixture.label,
    mode,
    roleFamily: result.intelligence?.roleFamily,
    evidenceRoleFamily: result.intelligence?.evidenceRoleFamily,
    seniority: result.intelligence?.seniority,
    bulletCount: bullets.length,

    /* --- the metrics --- */
    truthfulness: round(1 - Math.min(1, (result.truth?.unsupportedClaimCount || 0) / Math.max(1, bullets.length))),
    unsupportedClaimCount: result.truth?.unsupportedClaimCount ?? -1,
    untracedMetricCount: (result.untracedMetrics || []).length,
    jdRelevance: round(mean(dims.map((d) => d.relevanceScore ?? 0))),
    specificity: round(mean(dims.map((d) => d.specificityScore ?? 0))),
    domainAuthenticity: round(mean(dims.map((d) => d.domainScore ?? 0))),
    atsAlignment: result.ats ? round(result.ats.score / 100) : null,
    atsSemanticCoverage: result.ats ? round(result.ats.semanticCoverage) : null,
    atsUnsupportedPenalty: result.ats ? round(result.ats.unsupportedPenalty) : null,
    naturalness: round(result.naturalness?.score ?? 0),
    redundancy: round(worst),
    vocabularyDiversity: round(texts.length ? openers.size / texts.length : 0),
    genericityPenalty: round(result.genericity?.penalty ?? 0),
    evidenceCoverage: round(result.quality?.evidenceCoverage ?? 0),
    averageFinalScore: round(result.quality?.averageFinalScore ?? 0, 2),
    globalQualityOverall: globalQuality.overall,
    globalJdRelevance: globalQuality.dimensions.jdRelevance,
    globalNaturalness: globalQuality.dimensions.naturalness,
    globalSpecificity: globalQuality.dimensions.specificity,

    /* --- P2.22 useful rewrite rate --- */
    improvableBullets: result.rewriteStats?.improvableBullets ?? 0,
    usefullyRewritten: result.rewriteStats?.usefullyRewritten ?? 0,
    insufficientEvidenceBullets: result.rewriteStats?.insufficientEvidenceBullets ?? 0,
    unchangedDespiteEvidence: result.rewriteStats?.unchangedDespiteEvidence ?? 0,
    usefulRewriteRate: result.rewriteStats?.usefulRewriteRate,

    /* --- A.1 action provenance --- */
    unsupportedActionClaims: (result.bullets || []).reduce(
      (a, b) => a + ((b.truthChecks && b.truthChecks.actionProvenance === 'FAIL') ? 1 : 0), 0),
    actionProvenanceNotRun: (result.bullets || []).reduce(
      (a, b) => a + ((b.truthChecks && b.truthChecks.actionProvenance === 'NOT_RUN') ? 1 : 0), 0),

    /* --- P1.3 safety reversions --- */
    safetyReversions: result.leakage?.revertedCount ?? 0,
    tailoringStatus: result.status || '',

    /* --- cost --- */
    durationMs: result.telemetry?.durationMs ?? 0,
    aiCalls: result.telemetry?.ai?.totalCalls ?? 0,
    inputTokens: result.telemetry?.ai?.inputTokens ?? 0,
    outputTokens: result.telemetry?.ai?.outputTokens ?? 0,
    candidatesGenerated: result.telemetry?.counters?.candidatesGenerated ?? 0,
    candidatesRejected: result.telemetry?.counters?.candidatesRejected ?? 0,
    rejectedHallucinations: result.telemetry?.counters?.rejectedHallucinations ?? 0,
    repetitionRepairs: result.telemetry?.counters?.repetitionRepairs ?? 0,

    /* --- samples for the human report --- */
    samples: bullets.slice(0, 3).map((b) => ({
      original: b.original, enhanced: b.text, strategy: b.strategy, score: b.metadata?.finalScore,
    })),
    summary: result.summary?.chosen || '',
    gapCount: result.gaps?.counts?.total ?? 0,
  };
}

function vocabularyOverlapMatrix(rows) {
  const sets = new Map();
  for (const r of rows) {
    if (r.mode !== 'tailor') continue;
    const words = new Set((r.samples.map((s) => s.enhanced).join(' ').toLowerCase().match(/[a-z][a-z-]{3,}/g) || []));
    sets.set(r.fixture, words);
  }
  const ids = [...sets.keys()];
  const pairs = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let k = i + 1; k < ids.length; k += 1) {
      const a = sets.get(ids[i]); const b = sets.get(ids[k]);
      let inter = 0;
      for (const w of a) if (b.has(w)) inter += 1;
      pairs.push({ a: ids[i], b: ids[k], jaccard: round(inter / (a.size + b.size - inter || 1)) });
    }
  }
  return {
    maxOverlap: pairs.length ? Math.max(...pairs.map((p) => p.jaccard)) : 0,
    meanOverlap: round(mean(pairs.map((p) => p.jaccard))),
    worstPairs: pairs.sort((x, y) => y.jaccard - x.jaccard).slice(0, 3),
  };
}

async function main() {
  const rows = [];
  for (const f of FIXTURES) {
    const enhanced = await enhanceResumeNarrative(f.doc, { userKey: `bench-${f.id}`, useAi: USE_AI });
    if (enhanced.ok) rows.push(measure(enhanced, f, 'enhance'));
    else rows.push({ fixture: f.id, mode: 'enhance', failed: true, error: enhanced.message });

    const tailored = await tailorResumeNarrative(f.doc, {
      jobDescription: f.jd, job: f.job, userKey: `bench-${f.id}`, useAi: USE_AI, useExternalResearch: false,
    });
    if (tailored.ok) rows.push(measure(tailored, f, 'tailor'));
    else rows.push({ fixture: f.id, mode: 'tailor', failed: true, error: tailored.message });
  }

  const ok = rows.filter((r) => !r.failed);
  const enhanceRows = ok.filter((r) => r.mode === 'enhance');
  const tailorRows = ok.filter((r) => r.mode === 'tailor');
  const aggRows = (source, key) => round(mean(source.map((r) => r[key]).filter((v) => typeof v === 'number')));
  const agg = (key) => aggRows(ok, key);
  const totalUnsupported = ok.reduce((a, r) => a + (r.unsupportedClaimCount || 0), 0);
  const totalUntraced = ok.reduce((a, r) => a + (r.untracedMetricCount || 0), 0);
  const overlap = vocabularyOverlapMatrix(ok);

  const report = {
    generatedAt: new Date().toISOString(),
    aiEnabled: USE_AI,
    fixtures: FIXTURES.length,
    runs: rows.length,
    failures: rows.filter((r) => r.failed).length,
    /* ---- P2.21 — TWO GATES, NOT ONE ----
       Safety and quality answer different questions and must be reported
       separately. A run that invents nothing but also improves nothing is a
       SAFETY PASS and a QUALITY FAIL, and collapsing the two into a single
       green tick is how an engine ships that is honest and useless. */
    gate: {
      unsupportedClaimCount: totalUnsupported,
      untracedMetricCount: totalUntraced,
      passed: totalUnsupported === 0 && totalUntraced === 0 && rows.every((r) => !r.failed),
      rule: 'UNSUPPORTED CLAIM COUNT MUST BE ZERO',
    },
    safetyGate: {
      unsupportedClaims: totalUnsupported,
      untracedMetrics: totalUntraced,
      failedRuns: rows.filter((r) => r.failed).length,
      unsupportedActionClaims: ok.reduce((a, r) => a + (r.unsupportedActionClaims || 0), 0),
      passed: totalUnsupported === 0 && totalUntraced === 0
        && ok.reduce((a, r) => a + (r.unsupportedActionClaims || 0), 0) === 0
        && rows.every((r) => !r.failed),
      rule: 'unsupported claims, unsupported metrics and failed runs must all be zero',
    },
    qualityGate: (() => {
      /* POOLED, not a mean of per-fixture rates. Averaging rates gives a
         fixture with one improvable bullet the same weight as one with six,
         which is how a headline number drifts away from what actually
         happened across the corpus. */
      const pooledNum = ok.reduce((a, r) => a + (r.usefullyRewritten || 0), 0);
      const pooledDen = ok.reduce((a, r) => a + (r.improvableBullets || 0), 0);
      const rate = pooledDen ? round(pooledNum / pooledDen) : null;
      const checks = [
        { name: 'usefulRewriteRate', value: rate, min: 0.55 },
        { name: 'enhanceGlobalSpecificity', value: aggRows(enhanceRows, 'globalSpecificity'), min: 45 },
        { name: 'tailorGlobalJdRelevance', value: aggRows(tailorRows, 'globalJdRelevance'), min: 40 },
        { name: 'globalNaturalness', value: agg('globalNaturalness'), min: 65 },
        { name: 'domainAuthenticity', value: agg('domainAuthenticity'), min: 0.30 },
      ];
      const fixtureFloors = tailorRows.map((r) => ({ fixture: r.fixture, label: r.label, value: r.globalJdRelevance, min: 25, passed: Number(r.globalJdRelevance) >= 25 }));
      const failed = checks.filter((c) => !(Number(c.value) >= c.min));
      const failedFixtures = fixtureFloors.filter((c) => !c.passed);
      return {
        checks, fixtureFloors,
        failed: [...failed.map((c) => c.name), ...failedFixtures.map((c) => `fixture:${c.fixture}`)],
        passed: failed.length === 0 && failedFixtures.length === 0,
        rule: 'enhance and job-tailor quality are gated separately; poor role fixtures cannot hide inside an aggregate',
      };
    })(),
    operationAggregate: {
      enhance: {
        globalQuality: aggRows(enhanceRows, 'globalQualityOverall'),
        specificity: aggRows(enhanceRows, 'globalSpecificity'),
        naturalness: aggRows(enhanceRows, 'globalNaturalness'),
        jdRelevance: null,
      },
      tailor: {
        globalQuality: aggRows(tailorRows, 'globalQualityOverall'),
        jdRelevance: aggRows(tailorRows, 'globalJdRelevance'),
        narrativeBulletRelevance: aggRows(tailorRows, 'jdRelevance'),
        specificity: aggRows(tailorRows, 'globalSpecificity'),
        naturalness: aggRows(tailorRows, 'globalNaturalness'),
      },
    },
    aggregate: {
      truthfulness: agg('truthfulness'),
      jdRelevance: agg('jdRelevance'),
      specificity: agg('specificity'),
      domainAuthenticity: agg('domainAuthenticity'),
      atsAlignment: agg('atsAlignment'),
      naturalness: agg('naturalness'),
      redundancy: agg('redundancy'),
      vocabularyDiversity: agg('vocabularyDiversity'),
      genericityPenalty: agg('genericityPenalty'),
      evidenceCoverage: agg('evidenceCoverage'),
      averageFinalScore: agg('averageFinalScore'),
      usefulRewriteRate: agg('usefulRewriteRate'),
    },
    rewrite: {
      /* Two denominators are reported deliberately. The strict rate divides
         only by bullets that had BOTH a weakness and enough evidence to fix
         it honestly (P2.18). The broad rate also counts thin-evidence bullets
         the engine correctly refused to touch. The numerator is identical in
         both; publishing only the flattering one would be the benchmark
         cheating P2.25 warns about. */
      improvableBullets: ok.reduce((a, r) => a + (r.improvableBullets || 0), 0),
      usefullyRewritten: ok.reduce((a, r) => a + (r.usefullyRewritten || 0), 0),
      insufficientEvidenceBullets: ok.reduce((a, r) => a + (r.insufficientEvidenceBullets || 0), 0),
      unchangedDespiteEvidence: ok.reduce((a, r) => a + (r.unchangedDespiteEvidence || 0), 0),
      safetyReversions: ok.reduce((a, r) => a + (r.safetyReversions || 0), 0),
      unsupportedActionClaims: ok.reduce((a, r) => a + (r.unsupportedActionClaims || 0), 0),
      usefulRewriteRateStrict: (() => {
        const n = ok.reduce((a, r) => a + (r.usefullyRewritten || 0), 0);
        const d = ok.reduce((a, r) => a + (r.improvableBullets || 0), 0);
        return d ? round(n / d) : null;
      })(),
      usefulRewriteRateIncludingThinEvidence: (() => {
        const n = ok.reduce((a, r) => a + (r.usefullyRewritten || 0), 0);
        const d = ok.reduce((a, r) => a + (r.improvableBullets || 0) + (r.insufficientEvidenceBullets || 0), 0);
        return d ? round(n / d) : null;
      })(),
    },
    cost: {
      totalDurationMs: ok.reduce((a, r) => a + (r.durationMs || 0), 0),
      meanDurationMs: Math.round(mean(ok.map((r) => r.durationMs || 0))),
      totalAiCalls: ok.reduce((a, r) => a + (r.aiCalls || 0), 0),
      totalInputTokens: ok.reduce((a, r) => a + (r.inputTokens || 0), 0),
      totalOutputTokens: ok.reduce((a, r) => a + (r.outputTokens || 0), 0),
      candidatesGenerated: ok.reduce((a, r) => a + (r.candidatesGenerated || 0), 0),
      candidatesRejected: ok.reduce((a, r) => a + (r.candidatesRejected || 0), 0),
      rejectedHallucinations: ok.reduce((a, r) => a + (r.rejectedHallucinations || 0), 0),
    },
    crossDomainVocabulary: overlap,
    runs_detail: rows,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'resume-intelligence-quality.json'), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(OUT_DIR, 'resume-intelligence-quality.md'), renderMarkdown(report));

  console.log(`\nSAFETY gate : ${report.safetyGate.passed ? 'PASS' : 'FAIL'} — unsupported claims ${totalUnsupported}, untraced metrics ${totalUntraced}, reversions ${report.rewrite.safetyReversions}`);
  console.log(`QUALITY gate: ${report.qualityGate.passed ? 'PASS' : 'FAIL'}${report.qualityGate.failed.length ? ` — below threshold: ${report.qualityGate.failed.join(', ')}` : ''}`);
  console.log(`Useful rewrite rate: strict ${report.rewrite.usefulRewriteRateStrict} (${report.rewrite.usefullyRewritten}/${report.rewrite.improvableBullets}) · including thin-evidence ${report.rewrite.usefulRewriteRateIncludingThinEvidence} · thin-evidence bullets ${report.rewrite.insufficientEvidenceBullets}`);
  console.log(`Naturalness ${report.aggregate.naturalness} · Specificity ${report.aggregate.specificity} · Domain ${report.aggregate.domainAuthenticity} · Vocabulary diversity ${report.aggregate.vocabularyDiversity}`);
  console.log(`Cross-domain vocabulary overlap: max ${overlap.maxOverlap}, mean ${overlap.meanOverlap}`);
  console.log(`Reports written to ${OUT_DIR}\n`);
  /* Phase B1 — every gate is a release gate. A benchmark that prints FAIL and
     exits 0 is decoration: CI goes green and the regression ships. */
  /* PHASE A.1 gate. Deliberately NOT called a final release gate: render and
     regression do not exist yet, and a green tick that omits them would be
     claiming more than has been verified. */
  const gates = {
    safety: report.safetyGate.passed,
    quality: report.qualityGate.passed,
    actionProvenance: (report.safetyGate.unsupportedActionClaims || 0) === 0,
    /* Not yet implemented. Reported as such rather than defaulted to true,
       because a gate nobody wrote must not read as a gate that passed. */
    render: report.renderGate ? report.renderGate.passed : null,
    regression: report.regressionGate ? report.regressionGate.passed : null,
  };
  const notImplemented = Object.entries(gates).filter(([, v]) => v === null).map(([k]) => k);
  const failed = Object.entries(gates).filter(([, v]) => v === false).map(([k]) => k);

  console.log(`\nCORE_QUALITY_GATE: ${Object.entries(gates)
    .map(([k, v]) => `${k}=${v === null ? 'NOT_IMPLEMENTED' : v ? 'PASS' : 'FAIL'}`).join(' · ')}`);
  if (notImplemented.length) {
    console.log(`  (${notImplemented.join(', ')} are FUTURE gates — not implemented, and NOT counted as passes)`);
    console.log('  → This is a CORE QUALITY pass at most. Final rendering remains pending.');
  }
  if (failed.length) console.log(`  FAILING: ${failed.join(', ')}`);
  if (failed.length) process.exitCode = 1;
}

function renderMarkdown(r) {
  const L = [];
  L.push('# Resume Narrative Intelligence — Quality Report', '');
  L.push(`Generated: ${r.generatedAt}`);
  L.push(`AI enabled: ${r.aiEnabled ? 'yes' : 'no (deterministic composition only)'}`);
  L.push(`Fixtures: ${r.fixtures} · Runs: ${r.runs} · Failures: ${r.failures}`, '');

  L.push('## Gate', '');
  L.push(`**${r.gate.passed ? 'PASS' : 'FAIL'}** — ${r.gate.rule}`, '');
  L.push('| Check | Value | Required |', '|---|---|---|');
  L.push(`| Unsupported claims | ${r.gate.unsupportedClaimCount} | 0 |`);
  L.push(`| Untraced metrics | ${r.gate.untracedMetricCount} | 0 |`);
  L.push(`| Failed runs | ${r.failures} | 0 |`, '');

  L.push('## Gates', '');
  L.push(`- **Safety: ${r.safetyGate.passed ? 'PASS' : 'FAIL'}** — ${r.safetyGate.rule}`);
  L.push(`- **Quality: ${r.qualityGate.passed ? 'PASS' : 'FAIL'}** — ${r.qualityGate.rule}`, '');
  L.push('| Quality check | Value | Minimum | Verdict |', '|---|---|---|---|');
  for (const c of r.qualityGate.checks) L.push(`| ${c.name} | ${c.value} | ${c.min} | ${Number(c.value) >= c.min ? 'pass' : 'FAIL'} |`);
  L.push('');
  L.push('### Job-tailor fixture floors', '', '| Fixture | JD relevance | Minimum | Verdict |', '|---|---:|---:|---|');
  for (const c of (r.qualityGate.fixtureFloors || [])) L.push(`| ${c.label || c.fixture} | ${c.value} | ${c.min} | ${c.passed ? 'pass' : 'FAIL'} |`);
  L.push('');
  L.push('## Useful rewrite rate', '', '| Measure | Count |', '|---|---|');
  for (const [k, v] of Object.entries(r.rewrite)) L.push(`| ${k} | ${v} |`);
  L.push('');
  L.push('## Aggregate quality', '', '| Metric | Score |', '|---|---|');
  for (const [k, v] of Object.entries(r.aggregate)) L.push(`| ${k} | ${v} |`);
  L.push('');

  L.push('## Cost', '', '| Measure | Value |', '|---|---|');
  for (const [k, v] of Object.entries(r.cost)) L.push(`| ${k} | ${v} |`);
  L.push('');

  L.push('## Cross-domain vocabulary overlap', '');
  L.push(`Max pairwise Jaccard: **${r.crossDomainVocabulary.maxOverlap}** (lower is better — proves the engine does not collapse into one vocabulary).`, '');
  L.push('| Domain A | Domain B | Overlap |', '|---|---|---|');
  for (const p of r.crossDomainVocabulary.worstPairs) L.push(`| ${p.a} | ${p.b} | ${p.jaccard} |`);
  L.push('');

  L.push('## Per-fixture results', '');
  L.push('| Fixture | Mode | Family | Seniority | Unsupported | Natural | Specific | Domain | Diversity |', '|---|---|---|---|---|---|---|---|---|');
  for (const row of r.runs_detail) {
    if (row.failed) { L.push(`| ${row.fixture} | ${row.mode} | — | — | FAILED | — | — | — | — |`); continue; }
    L.push(`| ${row.fixture} | ${row.mode} | ${row.roleFamily} | ${row.seniority} | ${row.unsupportedClaimCount} | ${row.naturalness} | ${row.specificity} | ${row.domainAuthenticity} | ${row.vocabularyDiversity} |`);
  }
  L.push('');

  L.push('## Sample transformations', '');
  for (const row of r.runs_detail) {
    if (row.failed || row.mode !== 'tailor') continue;
    L.push(`### ${row.label}`, '');
    L.push(`*Summary:* ${row.summary}`, '');
    for (const s of row.samples) {
      L.push(`- **Before:** ${s.original}`);
      L.push(`  **After:** ${s.enhanced}  \`[${s.strategy}, score ${s.score}]\``);
    }
    L.push('');
  }
  return `${L.join('\n')}\n`;
}

main().catch((err) => {
  console.error('benchmark failed:', err);
  process.exitCode = 1;
});
