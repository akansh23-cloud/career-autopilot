import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildLayoutHTML } from '../../../web/src/lib/templateOs/index.js';
import { compileRenderLayout } from './vectorPdfRenderProvider.js';
import { criticalTextChecks, extractPdfTextPortable } from './renderUtils.js';

const exec = promisify(execFile);
export const WEASYPRINT_RENDER_PROVIDER_VERSION = 'weasyprint-render-provider-v1';

async function executable() {
  const configured = process.env.WEASYPRINT_EXECUTABLE_PATH;
  if (configured) { try { await fs.access(configured); return configured; } catch { return null; } }
  for (const p of ['/opt/pyvenv/bin/weasyprint','/usr/bin/weasyprint']) { try { await fs.access(p); return p; } catch { /* continue */ } }
  return null;
}

export async function renderWeasyPrintPdf({ definition, resumeDocument, structured, sizeId='a4' }) {
  const bin=await executable(); if(!bin) throw Object.assign(new Error('weasyprint_renderer_unavailable'),{code:'weasyprint_renderer_unavailable'});
  const compiled=compileRenderLayout(definition,resumeDocument,structured,{sizeId});
  const html=buildLayoutHTML(compiled,structured,{sizeId}).replace('</style>', `\n@page{size:${sizeId==='letter'?'Letter':'A4'};margin:0;} html,body{background:#fff!important;}\n</style>`);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'resume-weasy-')); const htmlPath=path.join(dir,'resume.html'); const pdfPath=path.join(dir,'resume.pdf');
  try {
    await fs.writeFile(htmlPath,html,'utf8'); await exec(bin,[htmlPath,pdfPath],{timeout:30000,maxBuffer:1024*1024});
    const bytes=await fs.readFile(pdfPath); const extracted=await extractPdfTextPortable(bytes); const critical=criticalTextChecks(structured,extracted.text);
    return { provider:'weasyprint',engine:'weasyprint',providerVersion:WEASYPRINT_RENDER_PROVIDER_VERSION,bytes,pageCount:extracted.pageCount,extractedText:extracted.text,extractedPageCount:extracted.pageCount,html,compiled,validation:{...critical,selectableText:extracted.text.trim().length>0,pageRoundTrip:true} };
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
}
