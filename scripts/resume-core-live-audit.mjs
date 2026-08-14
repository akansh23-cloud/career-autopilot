import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES } from '../test/fixtures/resumeNarrativeFixtures.js';
import { analyzeResume, enhance, improveAgain, optimizeResume } from '../server/services/resumeOs/resumeOsApplicationService.js';

const deepClone = (v) => JSON.parse(JSON.stringify(v));
const byId = (id) => FIXTURES.find((f) => f.id === id);

const strong = byId('devops_engineer');
const fresher = byId('fresher_software_engineer');
const marketing = byId('marketing_manager');
if (!strong || !fresher || !marketing) throw new Error('Required fixtures missing');

const partialDoc = deepClone(strong.doc);
partialDoc.id = 'live_partial_devops';
partialDoc.contact = { name: 'Synthetic Partial DevOps', title: 'Build & Release Engineer' };
partialDoc.summary = 'Build and release engineer supporting application delivery and cloud environments.';
partialDoc.skills = [{ name: 'Jenkins' }, { name: 'Docker' }, { name: 'AWS' }, { name: 'GitLab CI' }, { name: 'Java' }];
partialDoc.experience = [{
  id: 'px1', company: 'Synthetic Systems', role: 'Build & Release Engineer', startDate: '2021', current: true,
  bullets: [
    { id: 'pb1', text: 'Created Docker images for Java services.' },
    { id: 'pb2', text: 'Maintained Jenkins pipelines for build and test.' },
    { id: 'pb3', text: 'Worked with AWS EC2 for deployment environments.' },
    { id: 'pb4', text: 'Supported release activities for development teams.' },
  ],
}];
partialDoc.projects = [];
partialDoc.certifications = [];

const cases = [
  { id: 'strong_devops', label: 'Strong DevOps', doc: deepClone(strong.doc), jd: strong.jd, job: strong.job },
  { id: 'partial_devops', label: 'Partial DevOps', doc: partialDoc, jd: strong.jd, job: strong.job },
  { id: 'fresher', label: 'Fresher', doc: deepClone(fresher.doc), jd: fresher.jd, job: fresher.job },
  { id: 'marketing', label: 'Marketing', doc: deepClone(marketing.doc), jd: marketing.jd, job: marketing.job },
];

function bulletMap(doc) {
  const m = new Map();
  for (const sec of ['experience','projects']) for (const item of doc?.[sec] || []) for (const b of item.bullets || []) m.set(`${sec}:${item.id || item.company || item.name}:${b.id || b.text}`, b.text || '');
  return m;
}

function diffBullets(before, after) {
  const a = bulletMap(before), b = bulletMap(after); const out = [];
  for (const [k, text] of a) {
    const next = b.get(k);
    if (next != null && next !== text) out.push({ before: text, after: next });
  }
  return out;
}

const report = { generatedAt: new Date().toISOString(), version: 'resume-os-core-live-audit-v1', aiPolish: false, cases: [] };

for (const c of cases) {
  const original = await analyzeResume({ doc: c.doc, targetRole: c.doc.targetRole });
  const enhanced = await enhance({ doc: c.doc, targetRole: c.doc.targetRole, aiPolish: false });
  const improved = await improveAgain({ doc: enhanced.resumeDocument, targetRole: c.doc.targetRole, aiPolish: false });
  const optimized = await optimizeResume({ doc: improved.resumeDocument, targetRole: c.doc.targetRole, aiPolish: false, maxPasses: 7 });
  const directOptimized = await optimizeResume({ doc: c.doc, targetRole: c.doc.targetRole, aiPolish: false, maxPasses: 7 });

  const stages = { original, enhanced, improved, optimized };
  const allAiCalls = Object.values(stages).reduce((n, x) => n + Number(x?.aiPolish?.calls || 0), 0);
  const truthFailures = Object.values(stages).flatMap((x) => x?.quality?.hardFailures || []);
  report.cases.push({
    id: c.id,
    label: c.label,
    scores: {
      original: original.quality.overall,
      enhance: enhanced.quality.overall,
      improveAgain: improved.quality.overall,
      optimize: optimized.quality.overall,
    },
    summaries: {
      original: c.doc.summary || '',
      enhance: enhanced.resumeDocument.summary || '',
      optimize: optimized.resumeDocument.summary || '',
    },
    bulletChanges: {
      enhance: diffBullets(c.doc, enhanced.resumeDocument),
      improveAgain: diffBullets(enhanced.resumeDocument, improved.resumeDocument),
      optimizeFromImprove: diffBullets(improved.resumeDocument, optimized.resumeDocument),
    },
    improveObjective: improved.objective || null,
    optimizePasses: optimized.passes,
    acceptedOptimizationPasses: optimized.improvement?.acceptedPasses || 0,
    directOptimize: {
      before: directOptimized.beforeQuality.overall,
      after: directOptimized.quality.overall,
      acceptedPasses: directOptimized.improvement?.acceptedPasses || 0,
      attemptedPasses: directOptimized.improvement?.attemptedPasses || 0,
      stopReason: directOptimized.stopReason,
      converged: directOptimized.converged,
    },
    stopReason: optimized.stopReason,
    converged: optimized.converged,
    finalStatus: optimized.status,
    aiCalls: allAiCalls,
    truthFailures: truthFailures.map((f) => ({ code: f.code, severity: f.severity, message: f.message })),
    optimizationCeiling: optimized.optimization?.ceiling || null,
    autofit: {
      enhanceCalled: !!enhanced.autofit?.called,
      improveCalled: !!improved.autofit?.called,
      optimizeCalled: !!optimized.autofit?.called,
      pendingMeasurement: !!optimized.autofit?.pendingMeasurement,
    },
    monotonicAccepted: optimized.quality.overall >= improved.quality.overall && improved.quality.overall >= enhanced.quality.overall,
  });
}

report.gates = {
  aiOffZeroCalls: report.cases.every((c) => c.aiCalls === 0),
  noCriticalTruthFailures: report.cases.every((c) => c.truthFailures.length === 0),
  bestVersionMonotonic: report.cases.every((c) => c.monotonicAccepted),
  optimizerBounded: report.cases.every((c) => c.optimizePasses.length <= 7),
  autofitActivated: report.cases.every((c) => c.autofit.enhanceCalled && c.autofit.optimizeCalled),
  optimizerActuallyImprovesBaseline: report.cases.every((c) => c.directOptimize.after >= c.directOptimize.before) && report.cases.some((c) => c.directOptimize.acceptedPasses > 0),
};
report.passed = Object.values(report.gates).every(Boolean);

const reportDir = path.resolve('reports');
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, 'resume-os-core-live-audit.json'), JSON.stringify(report, null, 2));
let md = `# Resume OS Core Live Audit\n\nGenerated: ${report.generatedAt}\n\n**Gate:** ${report.passed ? 'PASS' : 'FAIL'}\n\n`;
for (const c of report.cases) {
  md += `## ${c.label}\n\n`;
  md += `- Scores: ${c.scores.original} → ${c.scores.enhance} → ${c.scores.improveAgain} → ${c.scores.optimize}\n`;
  md += `- Improve objective: ${c.improveObjective || 'none'}\n- Optimize: ${c.finalStatus}, stop=${c.stopReason}, accepted passes=${c.acceptedOptimizationPasses}\n- AI calls: ${c.aiCalls}\n- Truth failures: ${c.truthFailures.length}\n- AutoFit activated: ${c.autofit.enhanceCalled && c.autofit.optimizeCalled}\n\n`;
  md += `**Original summary:** ${c.summaries.original}\n\n**Final summary:** ${c.summaries.optimize}\n\n`;
  const changes = [...c.bulletChanges.enhance, ...c.bulletChanges.improveAgain, ...c.bulletChanges.optimizeFromImprove];
  for (const ch of changes.slice(0, 6)) md += `- ${ch.before}\n  → ${ch.after}\n`;
  md += '\n';
}
md += `## Gates\n\n${Object.entries(report.gates).map(([k,v]) => `- ${k}: ${v ? 'PASS' : 'FAIL'}`).join('\n')}\n`;
fs.writeFileSync(path.join(reportDir, 'resume-os-core-live-audit.md'), md);

console.log(JSON.stringify({ passed: report.passed, gates: report.gates, cases: report.cases.map((c) => ({ label: c.label, scores: c.scores, improveObjective: c.improveObjective, acceptedPasses: c.acceptedOptimizationPasses, directOptimize: c.directOptimize, stopReason: c.stopReason, aiCalls: c.aiCalls, truthFailures: c.truthFailures.length })) }, null, 2));
if (!report.passed) process.exitCode = 1;
