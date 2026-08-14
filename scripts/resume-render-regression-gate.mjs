import fs from 'node:fs/promises';
const gate=JSON.parse(await fs.readFile('reports/resume-render-gate.json','utf8'));
const baseline={ maxPages:{devops:2,fresher:2,'long-senior':3,'unicode-hindi':2}, maxBytes:1500000 };
const failures=[];
for(const r of gate.rows){ if(r.pages>(baseline.maxPages[r.id]||3)) failures.push(`${r.id}: page_count_${r.pages}`); if(r.bytes>baseline.maxBytes) failures.push(`${r.id}: pdf_too_large`); if(!r.selectableText) failures.push(`${r.id}: no_text_layer`); if(!r.criticalOk) failures.push(`${r.id}: critical_text_missing`); }
const passed=gate.passed&&failures.length===0;
const out={version:'resume-render-regression-gate-v1',passed,failures,baseline,rows:gate.rows};
await fs.writeFile('reports/resume-render-regression-gate.json',JSON.stringify(out,null,2));
await fs.writeFile('reports/resume-render-regression-gate.md',`# Resume Render Regression Gate\n\n**${passed?'PASS':'FAIL'}**\n\n${failures.length?failures.map(x=>`- ${x}`).join('\n'):'No render regressions detected.'}\n`);
console.log(JSON.stringify(out,null,2)); if(!passed) process.exitCode=1;
