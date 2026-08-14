import fs from 'node:fs/promises';
import path from 'node:path';
import { fromStructuredResume } from '../server/utils/resume/resumeDocument.js';
import { renderResumePdf } from '../server/services/resumeRender/resumeRenderService.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';

const outDir = path.resolve('reports/render-samples');
await fs.mkdir(outDir, { recursive: true });
const def = TEMPLATE_OS_BUILTINS.find((x) => x.id === 'cloud-infrastructure-pro') || TEMPLATE_OS_BUILTINS[0];
const cases = [
  ['devops', 'devops-cloud', null],
  ['fresher', 'student-project-heavy', null],
  ['long-senior', 'senior-architect', null],
  ['unicode-hindi', 'devops-cloud', (d) => { d.contact.name='आरव शर्मा'; d.summary='क्लाउड और DevOps इंजीनियर, Kubernetes और AWS अनुभव के साथ।'; }],
];
const rows=[];
for (const [id, fixtureId, mutate] of cases) {
  const doc=fromStructuredResume(getResumeFixture(fixtureId).data); doc.templateId=def.id; doc.pageSize='a4'; mutate?.(doc);
  const out=await renderResumePdf({ doc, definition:def, provider:'auto' });
  const file=path.join(outDir, `${id}.pdf`); await fs.writeFile(file,out.bytes);
  rows.push({ id, provider:out.selectedProvider, engine:out.engine||out.selectedProvider, bytes:out.bytes.length, pages:out.pageCount, selectableText:out.validation.selectableText, criticalOk:out.validation.criticalOk, signature:out.renderSignature, file:path.relative(process.cwd(),file) });
}
const passed=rows.every(r=>r.bytes>1000&&r.pages>=1&&r.selectableText&&r.criticalOk) && ['chromium','weasyprint'].includes(rows.find(r=>r.id==='unicode-hindi')?.provider);
const report={ version:'resume-render-gate-v1', passed, rows, requirements:{ selectableText:true, criticalFields:true, unicodeUsesHtmlRenderer:true } };
await fs.writeFile('reports/resume-render-gate.json',JSON.stringify(report,null,2));
await fs.writeFile('reports/resume-render-gate.md',`# Resume Render Gate\n\n**${passed?'PASS':'FAIL'}**\n\n${rows.map(r=>`- ${r.id}: ${r.provider}/${r.engine}, ${r.pages} page(s), ${r.bytes} bytes, selectable=${r.selectableText}, critical=${r.criticalOk}`).join('\n')}\n`);
console.log(JSON.stringify(report,null,2));
if(!passed) process.exitCode=1;
