#!/usr/bin/env node
/* ============================================================================
   Generate cached template gallery previews from the REAL renderers.
   ---------------------------------------------------------------------------
   Resume Studio:
     • Template OS definitions -> vector PDF writer -> Poppler rasterization.
     • legacy/V3/V4 registry templates -> actual Resume Renderer blocks + CSS
       -> static HTML -> WeasyPrint -> Poppler rasterization.

   Legacy Resume Editor:
     • resumeTemplates.js self-contained HTML renderer -> WeasyPrint -> Poppler.

   The resulting PNGs live under web/public/template-previews/. Runtime gallery
   cards load these cached files and fall back to the lightweight SVG skeleton
   only if an asset is missing. No user data and no AI is involved.
   ========================================================================== */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { RESUME_TEMPLATES } from '../web/src/lib/resumeTemplateRegistry.js';
import { TEMPLATES as EDITOR_TEMPLATES, renderResumeHTML } from '../web/src/lib/resumeTemplates.js';
import { buildResumeBlocks, resumeCSS } from '../web/src/lib/resumeRenderer.js';
import { compileTemplate, adaptTreeToShape } from '../web/src/lib/templateOs/compiler.js';
import { analyzeResumeShape } from '../web/src/lib/templateOs/shape.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import {
  TEMPLATE_PREVIEW_CACHE_VERSION, TEMPLATE_PREVIEW_WIDTH, TEMPLATE_PREVIEW_HEIGHT,
} from '../web/src/lib/templateOs/previewAssets.js';
import {
  TEMPLATE_PREVIEW_FIXTURE_VERSION, previewFixtureIdForTemplate,
  getTemplatePreviewStructured, toLegacyEditorPreviewData,
} from '../web/src/lib/templateOs/previewFixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'web', 'public', 'template-previews');
const TMP = path.join(ROOT, '.template-preview-tmp');
const STUDIO_OUT = path.join(OUT, 'resume-studio');
const EDITOR_OUT = path.join(OUT, 'editor');
const W = TEMPLATE_PREVIEW_WIDTH;
const H = TEMPLATE_PREVIEW_HEIGHT;

const hasCommand = (cmd) => spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' }).status === 0;
const PDFTOCAIRO = hasCommand('pdftocairo') ? 'pdftocairo' : null;
const WEASYPRINT = hasCommand('weasyprint') ? 'weasyprint' : null;

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}): ${r.stderr || r.stdout || ''}`);
  return r;
};

function rasterizePdfFile(pdfFile, outFile, tmpName) {
  if (!PDFTOCAIRO) throw new Error('pdftocairo is required to generate cached template previews');
  const prefix = path.join(TMP, `${tmpName}-raster`);
  run(PDFTOCAIRO, ['-png', '-singlefile', '-f', '1', '-l', '1', '-scale-to-x', String(W), '-scale-to-y', String(H), pdfFile, prefix], { quiet: true });
  fs.copyFileSync(`${prefix}.png`, outFile);
}

function rasterizePdfBytes(bytes, outFile, tmpName) {
  const pdf = path.join(TMP, `${tmpName}.pdf`);
  fs.writeFileSync(pdf, bytes);
  rasterizePdfFile(pdf, outFile, tmpName);
}

function htmlToPreview(html, outFile, tmpName) {
  if (!WEASYPRINT) throw new Error('weasyprint is required to generate HTML-rendered cached previews');
  const htmlFile = path.join(TMP, `${tmpName}.html`);
  const pdfFile = path.join(TMP, `${tmpName}.pdf`);
  fs.writeFileSync(htmlFile, html);
  run(WEASYPRINT, [htmlFile, pdfFile], { quiet: true });
  rasterizePdfFile(pdfFile, outFile, tmpName);
}

function studioRendererHtml(tpl, structured) {
  const { blocks } = buildResumeBlocks(structured, tpl);
  const css = resumeCSS(tpl, 'compact', 'a4');
  /* This is the exact block markup + CSS used by the Resume OS renderer. A
     cached gallery thumbnail does not need to run the browser height packer;
     clipping to one A4 page is intentional because only page 1 is displayed. */
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:794px 1123px;margin:0}html,body{margin:0;padding:0;background:#fff;width:794px;height:1123px;overflow:hidden}${css}
.rp-page{margin:0!important;box-shadow:none!important;overflow:hidden!important}
</style></head><body><div class="rp-page"><div class="rp-root">${blocks.map((b) => b.html).join('')}</div></div></body></html>`;
}

function pngInfo(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error(`invalid PNG: ${file}`);
  return { bytes: b.length, width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

async function main() {
  await fsp.rm(TMP, { recursive: true, force: true });
  await fsp.mkdir(TMP, { recursive: true });
  await fsp.mkdir(STUDIO_OUT, { recursive: true });
  await fsp.mkdir(EDITOR_OUT, { recursive: true });

  const manifest = {
    version: TEMPLATE_PREVIEW_CACHE_VERSION,
    fixtureVersion: TEMPLATE_PREVIEW_FIXTURE_VERSION,
    dimensions: { width: W, height: H },
    generatedAt: new Date().toISOString(),
    surfaces: { 'resume-studio': [], editor: [] },
  };

  for (const tpl of RESUME_TEMPLATES) {
    const source = tpl.engine === 'template-os' ? tpl.definition : tpl;
    const fixtureId = previewFixtureIdForTemplate(source);
    const structured = getTemplatePreviewStructured(source);
    const out = path.join(STUDIO_OUT, `${tpl.id}.png`);
    let renderer;
    if (tpl.engine === 'template-os') {
      renderer = 'template-os-vector-pdf';
      if (!fs.existsSync(out)) {
        const compiled = adaptTreeToShape(compileTemplate(tpl.definition, { density: 'balanced' }), analyzeResumeShape(structured));
        if (!compiled.ok) throw new Error(`compile failed for ${tpl.id}`);
        const pdf = renderTemplatePdf(compiled, structured, { sizeId: 'a4' });
        rasterizePdfBytes(pdf.bytes, out, `tos-${tpl.id}`);
      }
    } else {
      renderer = 'resume-renderer-blocks-css';
      if (!fs.existsSync(out)) htmlToPreview(studioRendererHtml(tpl, structured), out, `studio-${tpl.id}`);
    }
    const info = pngInfo(out);
    manifest.surfaces['resume-studio'].push({ id: tpl.id, templateVersion: tpl.definition?.version || 1, fixtureId, renderer, path: `/template-previews/resume-studio/${tpl.id}.png`, ...info });
    process.stdout.write(`studio  ${tpl.id.padEnd(30)} ${renderer}\n`);
  }

  for (const tpl of EDITOR_TEMPLATES) {
    const pseudo = { id: tpl.id, category: /fresher/i.test(tpl.id) ? 'student' : /exec|multipage/i.test(tpl.id) ? 'executive' : /cloud|tech|jake/i.test(tpl.id) ? 'technical' : 'professional' };
    const fixtureId = previewFixtureIdForTemplate(pseudo);
    const data = toLegacyEditorPreviewData(getTemplatePreviewStructured(pseudo));
    const html = renderResumeHTML(data, tpl.id, { mode: tpl.pages === 'multi' ? 'multi' : 'auto' });
    const out = path.join(EDITOR_OUT, `${tpl.id}.png`);
    if (!fs.existsSync(out)) htmlToPreview(html.replace('</style>', '\n@page{size:794px 1123px;margin:0}\nhtml,body{width:794px;height:1123px;overflow:hidden;background:#fff}.r-page{margin:0!important;box-shadow:none!important}\n</style>'), out, `editor-${tpl.id}`);
    const info = pngInfo(out);
    manifest.surfaces.editor.push({ id: tpl.id, templateVersion: 1, fixtureId, renderer: 'resume-templates-html', path: `/template-previews/editor/${tpl.id}.png`, ...info });
    process.stdout.write(`editor  ${tpl.id.padEnd(30)} resume-templates-html\n`);
  }

  await fsp.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await fsp.writeFile(path.join(OUT, 'README.md'), `# Template preview cache\n\nGenerated by \`npm run previews:templates\`.\n\n- Cache contract: ${TEMPLATE_PREVIEW_CACHE_VERSION}\n- Fixture contract: ${TEMPLATE_PREVIEW_FIXTURE_VERSION}\n- Size: ${W} × ${H}px\n- Template OS previews are rasterized from the actual vector-PDF renderer.\n- Resume Studio legacy/V3/V4 previews use the actual Resume Renderer block markup + CSS.\n- Legacy Editor previews use its actual self-contained HTML renderer.\n- Runtime galleries fall back to the deterministic SVG skeleton only when an asset is missing.\n- Preview generation is an offline/dev step; the shipped application has no WeasyPrint/Poppler runtime dependency.\n`);
  await fsp.rm(TMP, { recursive: true, force: true });
  process.stdout.write(`\nGenerated ${manifest.surfaces['resume-studio'].length + manifest.surfaces.editor.length} cached previews.\n`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
