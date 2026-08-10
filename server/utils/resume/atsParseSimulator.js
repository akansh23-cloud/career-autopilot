/* ============================================================
   ATS PARSE SIMULATOR — render round-trip integrity
   ------------------------------------------------------------
   Pipeline (the "actually test it" requirement):
     ResumeDocument -> renderer blocks -> page HTML
       -> deterministic text extraction (what a text-layer ATS
          sees in the exported PDF, which is print-rendered from
          this exact HTML)
       -> field-by-field recovery vs the source document
       -> ATS Parse Integrity score.

   Extraction is pure: strip tags preserving block boundaries,
   decode entities — no DOM, runs identically in node tests,
   server routes and the browser.
   ============================================================ */
import { normalizeResumeDocument, toRendererStructured } from './resumeDocument.js';

export const ATS_SIM_VERSION = 'ats-sim-v1';

/* HTML -> plain text. Block-level tags become newlines; <li> keeps a bullet. */
export function extractTextFromHtml(html) {
  let s = String(html || '');
  s = s.replace(/<\s*(style|script)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '');
  s = s.replace(/<\s*li[^>]*>/gi, '\n• ');
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\/\s*(div|p|ul|ol|li|h[1-6]|section|header|tr)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
  return s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

const normToken = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
function textContains(extractedNorm, value) {
  const v = normToken(value);
  return v ? extractedNorm.includes(v) : null; // null = nothing to recover
}

/* Compare extracted text against the source document. */
export function measureParseIntegrity(doc, extractedText) {
  const d = normalizeResumeDocument(doc);
  const s = toRendererStructured(d);
  const ex = normToken(extractedText);

  const fields = [];
  const check = (label, value, weight = 1) => {
    const r = textContains(ex, value);
    if (r === null) return;
    fields.push({ label, value: String(value).slice(0, 60), recovered: r, weight });
  };

  check('name', s.personalInfo.name, 3);
  check('email', s.personalInfo.email, 3);
  check('phone', s.personalInfo.phone, 2);
  check('linkedin', s.personalInfo.linkedin, 1);
  check('github', s.personalInfo.github, 1);
  for (const e of s.experience) { check('company', e.company, 2); check('title', e.role, 2); check('dates', e.dates, 1); }
  for (const p of s.projects) check('project', p.name, 1.5);
  for (const e of s.education) { check('school', e.school, 1.5); check('degree', e.degree, 1); }
  const flatSkills = Object.values(s.skills).flat();
  for (const sk of flatSkills.slice(0, 25)) check('skill', sk, 0.6);
  const bulletSample = [...s.experience, ...s.projects].flatMap((x) => x.bullets).slice(0, 20);
  for (const b of bulletSample) check('bullet', b.slice(0, 60), 0.8);

  const headings = [];
  const expectHeading = (label, present) => { if (present) headings.push({ label, recovered: ex.includes(normToken(label)) }); };
  expectHeading('experience', s.experience.length > 0);
  expectHeading('projects', s.projects.length > 0);
  expectHeading('education', s.education.length > 0);
  expectHeading('skills', flatSkills.length > 0);

  const totalW = fields.reduce((n, f) => n + f.weight, 0) || 1;
  const gotW = fields.reduce((n, f) => n + (f.recovered ? f.weight : 0), 0);
  const integrity = Math.round((gotW / totalW) * 100);
  const headingRecovery = headings.length ? headings.filter((h) => h.recovered).length / headings.length : 1;

  const missing = fields.filter((f) => !f.recovered);
  const critical = missing.filter((f) => ['name', 'email', 'company', 'title'].includes(f.label));

  return {
    version: ATS_SIM_VERSION,
    integrity,
    headingRecovery: Number(headingRecovery.toFixed(2)),
    fieldsChecked: fields.length,
    fieldsRecovered: fields.length - missing.length,
    missing: missing.slice(0, 12).map((f) => ({ label: f.label, value: f.value })),
    criticalLoss: critical.map((f) => ({ label: f.label, value: f.value })),
    pass: integrity >= 90 && critical.length === 0,
  };
}

/* Full round trip when the caller can supply rendered page HTML. */
export function simulateAtsParse(doc, pagesHtml) {
  const html = Array.isArray(pagesHtml) ? pagesHtml.join('\n') : String(pagesHtml || '');
  const extracted = extractTextFromHtml(html);
  return { ...measureParseIntegrity(doc, extracted), extractedChars: extracted.length };
}

export default { ATS_SIM_VERSION, extractTextFromHtml, measureParseIntegrity, simulateAtsParse };
