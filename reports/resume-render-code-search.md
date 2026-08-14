# Resume Render Code Search

Canonical production resume exports use `ResumeRenderService`. Remaining legacy/client render occurrences are listed below.

## `html2canvas`

- `web/src/lib/resumeRenderer.js:9: • the snapshot PDF fallback (html2canvas per page),`
- `web/src/lib/resumeRenderer.js:646: const html2canvas = (await import('html2canvas')).default;`
- `web/src/lib/resumeRenderer.js:670: const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: size.width, width: size.width });`
- `web/src/lib/resumeTemplates.js:8: • exportResumePDF(...)         -> clean PDF (html2canvas + jsPDF, NO browser`
- `web/src/lib/resumeTemplates.js:468: 4. CLEAN PDF EXPORT  —  html2canvas + jsPDF`
- `web/src/lib/resumeTemplates.js:509: const html2canvas = (await import('html2canvas')).default;`
- `web/src/lib/resumeTemplates.js:515: const canvas = await html2canvas(page, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: 794, width: 794 });`

## `jsPDF`

- `web/src/lib/resumeRenderer.js:645: const { default: jsPDF } = await import('jspdf');`
- `web/src/lib/resumeRenderer.js:664: const pdf = new jsPDF({ unit: 'pt', format, compress: true });`
- `web/src/lib/collegeReport.js:9: Built with vector text via jsPDF — not a screenshot. That keeps`
- `web/src/lib/collegeReport.js:46: const { default: jsPDF } = await import('jspdf');`
- `web/src/lib/collegeReport.js:47: const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });`
- `web/src/lib/resumeTemplates.js:8: • exportResumePDF(...)         -> clean PDF (html2canvas + jsPDF, NO browser`
- `web/src/lib/resumeTemplates.js:468: 4. CLEAN PDF EXPORT  —  html2canvas + jsPDF`
- `web/src/lib/resumeTemplates.js:508: const { default: jsPDF } = await import('jspdf');`
- `web/src/lib/resumeTemplates.js:516: const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });`

## `exportResumePDF(`

- `web/src/views/Editor.jsx:380: await exportResumePDF(data, tplId, { mode: lenToMode(len), fileName: `${safeName}-${selectedTpl.id}.pdf` });`
- `web/src/lib/resumeRenderer.js:621: export async function exportResumePDF(data, templateId, opts = {}) {`
- `web/src/lib/resumeTemplates.js:8: • exportResumePDF(...)         -> clean PDF (html2canvas + jsPDF, NO browser`
- `web/src/lib/resumeTemplates.js:507: export async function exportResumePDF(data, idOrName, { mode, fileName = 'resume.pdf' } = {}) {`
- `web/src/components/ResumeTemplates.jsx:175: await exportResumePDF(data, templateId, { mode, fileName: `${safeName}-${tpl.id}.pdf` });`

## `window.print`

- `web/src/lib/resumeTemplates.js:469: • No window.print(), so NO browser URL/title/date/page-number headers/footers`

## `page.pdf(`

- `server/services/resumeRender/chromiumRenderProvider.js:40: const bytes = await page.pdf({ format: sizeId === 'letter' ? 'Letter' : 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });`

## `renderTemplatePdf(`

- `web/src/lib/templateOs/pdfValidation.js:78: const rendered = renderTemplatePdf(compiled, structured, { sizeId });`
- `web/src/lib/templateOs/pdfWriter.js:504: export function renderTemplatePdf(compiled, structuredInput, { sizeId = 'a4', rebalanceOrphans = true } = {}) {`
- `web/src/lib/templateOs/multiParserAts.js:93: const rendered = renderTemplatePdf(compiled, structured, { sizeId });`
- `server/services/resumeRender/vectorPdfRenderProvider.js:17: const out = renderTemplatePdf(compiled, structured, { sizeId });`

## `downloadResumePdf(`

- `web/src/views/ResumeStudio.jsx:1146: await downloadResumePdf(doc, tplX, { provider: 'auto' });`
- `web/src/views/Editor.jsx:386: await downloadResumePdf(doc, { id: tplId }, { provider: 'auto' });`
- `web/src/lib/resumeOs.js:78: export async function downloadResumePdf(doc, template, { provider = 'auto' } = {}) {`
- `web/src/components/ResumeTemplates.jsx:181: await downloadResumePdf(doc, { id: templateId }, { provider: 'auto' });`

## Interpretation

- `ResumeStudio.jsx` built-in/template-os PDF downloads use `downloadResumePdf()` and the canonical server renderer.
- `Editor.jsx` and `TemplatePreviewModal` built-in template downloads now use `downloadResumePdf()`; the transient image-derived `custom-upload` template is the only deliberate legacy PDF exception until Phase 3 persists a server-safe template definition.
- `resumeTemplates.js` and `resumeRenderer.js` retain legacy `html2canvas/jsPDF` helper implementations for compatibility; they are no longer the normal built-in Resume OS export path.
- `templateOs/pdfWriter.js` remains the ATS-first vector provider behind `ResumeRenderService`, so `renderTemplatePdf()` is a legitimate provider implementation rather than a bypass.
- `chromiumRenderProvider.js` owns the production `page.pdf()` call for HTML/Unicode rendering.