import crypto from 'node:crypto';
import { normalizeResumeDocument, toRendererStructured } from '../../utils/resume/resumeDocument.js';

export const RESUME_RENDER_SERVICE_VERSION = 'resume-render-service-v1';
export const RENDER_SIGNATURE_VERSION = 'resume-render-signature-v1';


export function normalizeRenderInput(doc) {
  const resumeDocument = normalizeResumeDocument(doc || {});
  return { resumeDocument, structured: toRendererStructured(resumeDocument) };
}

export function collectDocumentStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectDocumentStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectDocumentStrings(v, out));
  return out;
}

export function hasUnsupportedVectorGlyphs(doc) {
  /* Base-14 vector PDF can safely transliterate punctuation/Latin diacritics,
     but must never silently erase meaningful non-Latin letters or numbers. */
  return collectDocumentStrings(doc).some((s) => [...String(s || '')].some((ch) => ch.codePointAt(0) > 0xff && /[\p{L}\p{N}]/u.test(ch)));
}

export function safeFilename(name = 'resume') {
  const clean = String(name || 'resume').normalize('NFKD').replace(/[^a-zA-Z0-9._ -]+/g, '').trim().replace(/\s+/g, '_');
  return (clean || 'resume').slice(0, 100);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
}

export function renderSignature({ doc, definition, sizeId = 'a4', density = '' }) {
  const payload = JSON.stringify(stable({ version: RENDER_SIGNATURE_VERSION, doc, definition, sizeId, density }));
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function normalizeExtractedText(text = '') {
  return String(text).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function criticalTextChecks(structured, extractedText) {
  const hay = normalizeExtractedText(extractedText);
  const candidates = [
    ['name', structured?.personalInfo?.name],
    ['email', structured?.personalInfo?.email],
    ['phone', structured?.personalInfo?.phone],
  ].filter(([, v]) => String(v || '').trim());
  const contains = (value) => {
    const needle = normalizeExtractedText(value);
    if (hay.includes(needle)) return true;
    /* Some PDF text extractors insert spaces between shaped Unicode glyph runs.
       Compare a whitespace-free form as a secondary integrity check. */
    return hay.replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''));
  };
  const checks = Object.fromEntries(candidates.map(([k, v]) => [k, contains(v)]));
  const headings = ['experience', 'education', 'skills'].filter((key) => Array.isArray(structured?.[key]) ? structured[key].length : !!structured?.[key]);
  const sectionChecks = Object.fromEntries(headings.map((key) => [key, hay.includes(key)]));
  return {
    checks: { ...checks, ...sectionChecks },
    criticalOk: (checks.name ?? true) && (checks.email ?? true),
    sectionsOk: Object.values(sectionChecks).every(Boolean),
  };
}

export async function extractPdfTextPortable(bytes) {
  try {
    const { extractPdfText } = await import('../../../web/src/lib/templateOs/pdfValidation.js');
    return await extractPdfText(new Uint8Array(bytes));
  } catch (primaryError) {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const exec = promisify(execFile);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-pdf-text-'));
    const pdf = path.join(dir, 'resume.pdf');
    try {
      await fs.writeFile(pdf, bytes);
      const { stdout } = await exec('pdftotext', ['-layout', pdf, '-'], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
      let pageCount = 1;
      try {
        const info = await exec('pdfinfo', [pdf], { timeout: 10000, maxBuffer: 512 * 1024 });
        const m = info.stdout.match(/^Pages:\s+(\d+)/mi); if (m) pageCount = Number(m[1]);
      } catch { /* text is sufficient */ }
      return { pageCount, pages: String(stdout).split('\f').filter(Boolean), text: String(stdout) };
    } catch (fallbackError) {
      fallbackError.cause = primaryError;
      throw fallbackError;
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
}
