import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildLayoutHTML, extractPdfText } from '../../../web/src/lib/templateOs/index.js';
import { compileRenderLayout } from './vectorPdfRenderProvider.js';
import { criticalTextChecks, extractPdfTextPortable } from './renderUtils.js';

const execFileAsync = promisify(execFile);
export const CHROMIUM_RENDER_PROVIDER_VERSION = 'chromium-render-provider-v1';

const PAGE_MM = { a4: { w: 210, h: 297 }, letter: { w: 215.9, h: 279.4 } };

function hardenedHtml(compiled, structured, sizeId) {
  const page = PAGE_MM[sizeId] || PAGE_MM.a4;
  const html = buildLayoutHTML(compiled, structured, { sizeId });
  return html.replace('</style>', `\n@page{size:${page.w}mm ${page.h}mm;margin:0;} html,body{background:#fff!important;} *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}\n</style>`)
    .replace('</body>', '<script>Promise.all([document.fonts?document.fonts.ready:Promise.resolve(),...Array.from(document.images||[]).map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=i.onerror=r}))]).then(()=>{document.documentElement.dataset.resumeRenderReady="1";});</script></body>');
}

async function tryPlaywright(html, { sizeId = 'a4', executablePath = null } = {}) {
  let pw;
  try { pw = await import('playwright'); } catch { return null; }
  const browser = await pw.chromium.launch({ headless: true, executablePath: executablePath || undefined, args: ['--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith('data:') || u.startsWith('about:')) return route.continue();
      return route.abort();
    });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; await Promise.all(Array.from(document.images || []).map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))); });
    const layout = await page.evaluate(() => {
      const p = document.querySelector('.t-page');
      if (!p) return { overflowX: 0, scrollHeight: 0, clientHeight: 0 };
      return { overflowX: Math.max(0, p.scrollWidth - p.clientWidth), scrollHeight: p.scrollHeight, clientHeight: p.clientHeight };
    });
    const bytes = await page.pdf({ format: sizeId === 'letter' ? 'Letter' : 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    return { bytes: Buffer.from(bytes), engine: 'playwright', layout };
  } finally { await browser.close(); }
}

async function chromiumExecutable() {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_EXECUTABLE_PATH;
  if (configured) return configured;
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']) {
    try { await fs.access(p); return p; } catch { /* continue */ }
  }
  return null;
}

async function renderWithCli(html) {
  if (process.env.CHROMIUM_CLI_FALLBACK !== '1') return null;
  const executable = await chromiumExecutable();
  if (!executable) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-render-'));
  const htmlPath = path.join(dir, 'resume.html');
  const pdfPath = path.join(dir, 'resume.pdf');
  try {
    await fs.writeFile(htmlPath, html, 'utf8');
    const args = ['--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`];
    if (process.env.CHROMIUM_NO_SANDBOX === '1' || (typeof process.getuid === 'function' && process.getuid() === 0)) args.unshift('--no-sandbox');
    await execFileAsync(executable, args, { timeout: 30000, maxBuffer: 1024 * 1024 });
    return { bytes: await fs.readFile(pdfPath), engine: 'chromium-cli', layout: null };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

export async function renderChromiumPdf({ definition, resumeDocument, structured, sizeId = 'a4' }) {
  const compiled = compileRenderLayout(definition, resumeDocument, structured, { sizeId });
  const html = hardenedHtml(compiled, structured, sizeId);
  const executable = await chromiumExecutable();
  const rendered = await tryPlaywright(html, { sizeId, executablePath: executable }) || await renderWithCli(html);
  if (!rendered) throw Object.assign(new Error('chromium_renderer_unavailable'), { code: 'chromium_renderer_unavailable' });
  const extracted = await extractPdfTextPortable(rendered.bytes);
  const critical = criticalTextChecks(structured, extracted.text);
  return {
    provider: 'chromium', engine: rendered.engine, providerVersion: CHROMIUM_RENDER_PROVIDER_VERSION,
    bytes: rendered.bytes, pageCount: extracted.pageCount,
    extractedText: extracted.text, extractedPageCount: extracted.pageCount,
    html, compiled, layout: rendered.layout,
    validation: { ...critical, selectableText: extracted.text.trim().length > 0, pageRoundTrip: true },
  };
}
