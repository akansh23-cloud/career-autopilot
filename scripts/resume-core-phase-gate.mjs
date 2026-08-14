import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const benchmark = readJson('reports/resume-intelligence-quality.json');
const live = readJson('reports/resume-os-core-live-audit.json');
const gemini = readJson('reports/resume-os-gemini-polish-contract-audit.json');

const jobs = read('web/src/views/Jobs.jsx');
const editor = read('web/src/views/Editor.jsx');
const studio = read('web/src/views/ResumeStudio.jsx');
const server = read('server.js');
const routes = read('server/routes/resumeOsRoutes.js');
const appPkg = read('server/utils/applicationPackageEngine.js');
const legacy = read('server/utils/resume/tailoringEngine.js');

const integrationChecks = {
  jobsCanonical: /Applications\.generate\(/.test(jobs) && !/AI\.resumeMessage\(/.test(jobs) && !/"latexResume":"Jake/i.test(jobs),
  editorCanonical: /ResumeOsApi\.tailorForJob\(/.test(editor) && !/AI\.message\(/.test(editor) && !/AI\.resumeMessage\(/.test(editor),
  studioCanonical: /ResumeOsApi\.enhance\(/.test(studio) && /ResumeOsApi\.improveAgain\(/.test(studio) && /ResumeOsApi\.optimize\(/.test(studio),
  studioAutoFit: /ResumeOsApi\.autofit\(/.test(studio) && /pendingAutoFit/.test(studio),
  legacyHttpCanonical: /appTailorForJob\(/.test(server),
  resumeOsRoutesCanonical: /appEnhance\(/.test(routes) && /appTailorForJob\(/.test(routes) && /appImproveAgain\(/.test(routes) && /appOptimizeResume\(/.test(routes),
  applicationPackageCanonical: /canonicalTailorForJob\(/.test(appPkg) && !/tailoringEngine\.js/.test(appPkg),
  legacyModuleAdapter: /canonicalTailorForJob\(/.test(legacy) && !/Assemble tailored resume text/.test(legacy),
  deterministicDefault: /useAi:\s*z\.boolean\(\)\.optional\(\)\.default\(false\)/.test(routes),
  aiOffLiveZeroCalls: live.gates?.aiOffZeroCalls === true,
  geminiPolishTruthGated: gemini.passed === true,
};

const safety = Boolean(benchmark.safetyGate?.passed) && Number(benchmark.safetyGate?.unsupportedActionClaims || 0) === 0 && live.gates?.noCriticalTruthFailures === true;
const quality = Boolean(benchmark.qualityGate?.passed);
const optimization = Boolean(live.passed) && live.gates?.bestVersionMonotonic === true && live.gates?.optimizerBounded === true && live.gates?.optimizerActuallyImprovesBaseline === true;
const integration = Object.values(integrationChecks).every(Boolean);

const report = {
  generatedAt: new Date().toISOString(),
  version: 'resume-os-core-phase-gate-v1',
  gates: { safety, quality, optimization, integration },
  integrationChecks,
  benchmark: {
    usefulRewriteRate: benchmark?.qualityGate?.checks?.find((x) => x.name === 'usefulRewriteRate')?.value ?? null,
    enhance: benchmark.operationAggregate?.enhance || null,
    tailor: benchmark.operationAggregate?.tailor || null,
    fixtureFloors: benchmark.qualityGate?.fixtureFloors || [],
  },
  geminiPolishContract: { passed: gemini.passed, deterministicCalls: gemini.deterministic?.aiCalls, safeApplied: gemini.safePolish?.applied, unsafeRejected: gemini.unsafePolish?.rejected },
  live: live.cases?.map((c) => ({ label: c.label, scores: c.scores, directOptimize: c.directOptimize, aiCalls: c.aiCalls, truthFailures: c.truthFailures?.length || 0 })) || [],
  coreResumeOs: safety && quality && optimization && integration ? 'PASS' : 'FAIL',
  finalRendering: 'PENDING',
  note: 'Final ResumeRenderService/Vector normalization/Playwright/Unicode/render-regression gates are intentionally outside this phase.',
};

fs.writeFileSync(path.join(root, 'reports/resume-os-core-phase-gate.json'), JSON.stringify(report, null, 2));
let md = `# Resume OS Core Phase Gate\n\n**CORE RESUME OS: ${report.coreResumeOs}**  \n**FINAL RENDERING: PENDING**\n\n`;
for (const [k,v] of Object.entries(report.gates)) md += `- ${k.toUpperCase()}: ${v ? 'PASS' : 'FAIL'}\n`;
md += `\n## Integration checks\n${Object.entries(integrationChecks).map(([k,v]) => `- ${k}: ${v ? 'PASS' : 'FAIL'}`).join('\n')}\n`;
fs.writeFileSync(path.join(root, 'reports/resume-os-core-phase-gate.md'), md);

console.log(`CORE RESUME OS: ${report.coreResumeOs}`);
console.log('FINAL RENDERING: PENDING');
for (const [k,v] of Object.entries(report.gates)) console.log(`${k.toUpperCase()}: ${v ? 'PASS' : 'FAIL'}`);
if (report.coreResumeOs !== 'PASS') process.exitCode = 1;
