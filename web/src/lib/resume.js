// Extract plain text from an uploaded resume file (PDF / DOCX / TXT / MD).
// PDF uses pdfjs-dist with a bundled worker; DOCX uses mammoth; text files read directly.
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export const ACCEPT = '.pdf,.docx,.txt,.md';

/* ============================================================
   PDF LINE RECONSTRUCTION
   ------------------------------------------------------------
   pdfjs returns positioned text fragments, not lines. The previous
   implementation joined every fragment on a page with a space and
   emitted ONE newline per page, so a two-page resume arrived as two
   lines of text.

   That silently destroyed every downstream deterministic engine:
   sliceSections() splits on newlines and needs a section header alone
   on a line, so with one line per page it could never find
   "EXPERIENCE", "SKILLS" or "EDUCATION". The document had no
   structure, and the renderer had nothing to lay out but a blob.

   An LLM could reconstruct structure from that blob, which is why the
   AI path looked fine and the deterministic path looked broken. The
   deterministic path was not worse at writing — it was being handed
   unusable input.

   We rebuild lines from the geometry pdfjs already gives us.
   ============================================================ */

/* Two fragments belong to the same line when their baselines agree within
   a fraction of the text height. Tolerance is relative, so it holds for
   headings and body text alike. */
function itemsToLines(items) {
  const frags = [];
  for (const it of items) {
    const str = it.str;
    if (str === undefined || str === null) continue;
    const t = it.transform || [1, 0, 0, 1, 0, 0];
    frags.push({
      str,
      x: t[4],
      y: t[5],
      /* transform[3] is the vertical scale — effectively the font size. */
      h: Math.abs(t[3]) || Math.abs(it.height) || 10,
      w: it.width || 0,
      eol: !!it.hasEOL,
    });
  }
  if (!frags.length) return '';

  /* Group by baseline, top of page first. */
  frags.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = [];
  let current = [];
  let baseline = null;
  let lineHeight = 0;

  for (const f of frags) {
    const tol = Math.max(2, (f.h || lineHeight || 10) * 0.5);
    if (baseline === null || Math.abs(f.y - baseline) <= tol) {
      if (baseline === null) { baseline = f.y; lineHeight = f.h; }
      current.push(f);
    } else {
      lines.push(current);
      current = [f];
      baseline = f.y;
      lineHeight = f.h;
    }
    /* pdfjs marks explicit end-of-line on some producers; trust it. */
    if (f.eol) {
      lines.push(current);
      current = [];
      baseline = null;
    }
  }
  if (current.length) lines.push(current);

  return lines
    .map((line) => joinLine(line.sort((a, b) => a.x - b.x)))
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/* Within a line, a space belongs between two fragments only when there is a
   real horizontal gap. Joining everything with " " is what turned
   "GitLab" + "CI/CD" into readable text but also turned kerned glyph runs
   into "A K A N S H". */
function joinLine(frags) {
  let out = '';
  let prevEnd = null;
  for (const f of frags) {
    if (prevEnd !== null) {
      const gap = f.x - prevEnd;
      const threshold = (f.h || 10) * 0.2;
      if (gap > threshold) out += ' ';
    }
    out += f.str;
    prevEnd = f.x + (f.w || 0);
  }
  return out;
}

/* Letter-spaced headings ("A K A N S H  M O W A R") come back as runs of
   single characters. Collapse a run only when it is long enough to be
   unambiguous, so "A B testing" and initials like "J. R. R." survive. */
export function repairLetterSpacing(text) {
  return String(text || '').split('\n').map((line) => {
    /* Four or more consecutive single-character tokens, letters only. */
    return line.replace(/(?:(?<![\p{L}\p{N}])\p{L}(?![\p{L}\p{N}])[ ]){3,}\p{L}(?![\p{L}\p{N}])/gu,
      (run) => run.replace(/ /g, ''));
  }).join('\n');
}

export async function extractResumeText(file) {
  const name = (file.name || '').toLowerCase();

  if (name.endsWith('.pdf')) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      pages.push(itemsToLines(tc.items));
    }
    return repairLetterSpacing(pages.join('\n\n')).trim();
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
