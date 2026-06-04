// Extract plain text from an uploaded resume file (PDF / DOCX / TXT / MD).
// PDF uses pdfjs-dist with a bundled worker; DOCX uses mammoth; text files read directly.
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export const ACCEPT = '.pdf,.docx,.txt,.md';

export async function extractResumeText(file) {
  const name = (file.name || '').toLowerCase();

  if (name.endsWith('.pdf')) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let out = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      out += tc.items.map((it) => it.str).join(' ') + '\n';
    }
    return out.trim();
  }

  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth/mammoth.browser.js');
    const buf = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer: buf });
    return (res.value || '').trim();
  }

  if (name.endsWith('.doc')) {
    throw new Error('Old .doc not supported — export as PDF or .docx');
  }

  // .txt / .md / fallback
  return (await file.text()).trim();
}
