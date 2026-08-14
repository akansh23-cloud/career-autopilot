import fs from 'node:fs/promises';

const core = JSON.parse(await fs.readFile('reports/resume-os-core-phase-gate.json', 'utf8'));
const render = JSON.parse(await fs.readFile('reports/resume-render-gate.json', 'utf8'));
const regression = JSON.parse(await fs.readFile('reports/resume-render-regression-gate.json', 'utf8'));
const gates = {
  safety: !!core.gates?.safety,
  quality: !!core.gates?.quality,
  optimization: !!core.gates?.optimization,
  integration: !!core.gates?.integration,
  render: !!render.passed,
  regression: !!regression.passed,
};
const passed = Object.values(gates).every(Boolean);
const report = {
  generatedAt: new Date().toISOString(),
  version: 'resume-os-final-gate-v1',
  passed,
  gates,
  renderer: {
    vectorAtsFirst: true,
    playwrightChromiumImplemented: true,
    unicodeFallbackImplemented: true,
    activeUnicodeProviderInAudit: render.rows.find((r) => r.id === 'unicode-hindi')?.provider || null,
    previewAndExportShareTemplateCompiler: true,
    selectableTextRequired: true,
  },
  coreVersion: core.version,
  renderVersion: render.version,
  regressionVersion: regression.version,
};
await fs.writeFile('reports/resume-os-final-gate.json', JSON.stringify(report, null, 2));
await fs.writeFile('reports/resume-os-final-gate.md', `# Resume OS Final Gate\n\n**${passed ? 'PASS' : 'FAIL'}**\n\n${Object.entries(gates).map(([k,v]) => `- ${k}: ${v ? 'PASS' : 'FAIL'}`).join('\n')}\n\nRenderer: ATS vector default; Playwright/Chromium preferred for Unicode/high-fidelity HTML; WeasyPrint is a fail-safe HTML/CSS Unicode provider when Chromium is unavailable.\n`);
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;
