/* ============================================================
   ATS COMPATIBILITY AUDIT ENGINE  (deterministic, Phase 4)
   ------------------------------------------------------------
   Given resume text (and optional structural flags the client knows
   about its template — tables/columns/images), score raw PARSEABILITY:
   can a dumb ATS extract sections, contact info, dates and bullets?
   Same input → same score. Returns the score plus specific fixes.
   No AI, no DB, no network — safe to unit test under node --test.
   ============================================================ */
import { normalizeResumeText } from './normalizeResumeText.js';
import { detectSections, sliceSections } from './sectionDetector.js';
import { extractContact } from './contactExtractor.js';

export const ATS_AUDIT_VERSION = 'ats-audit-v1';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/* Date formats a typical ATS parser recognises. */
const DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b|\b\d{1,2}\/\d{4}\b|\b\d{4}\s*[-–—]\s*(\d{4}|present|current)\b|\b(19|20)\d{2}\b/i;

const BULLET_RE = /^\s*[•\-*▪◦‣]\s+/;
const BULLET_MIN_WORDS = 5;   // shorter reads as a fragment
const BULLET_MAX_WORDS = 40;  // longer gets truncated/mangled by parsers

/**
 * auditAtsCompatibility({ text, structure })
 * - text: raw or extracted resume text (required)
 * - structure: optional flags from the client/template registry:
 *     { usesTables, usesColumns, usesImages, usesTextBoxes, templateId, atsSafeTemplate }
 * Returns { score, grade, checks[], fixes[], version }
 */
export function auditAtsCompatibility({ text = '', structure = {} } = {}) {
  const raw = String(text || '');
  const norm = normalizeResumeText(raw);
  const checks = [];
  const fixes = [];
  const add = (id, label, passed, weight, fix) => {
    checks.push({ id, label, passed: !!passed, weight });
    if (!passed && fix) fixes.push(fix);
  };

  /* ---- 1. Standard section headers (35 pts across four checks) ---- */
  const sections = detectSections(norm); // { experience: bool, education: bool, ... }
  const hasExperience = !!sections.experience || !!sections.projects;
  const hasEducation = !!sections.education;
  const hasSkills = !!sections.skills;
  add('section_experience', 'Experience or Projects section with a standard header', hasExperience, 15,
    'Add a section titled "Experience" (or "Projects") — ATS parsers key on standard headers and skip decorative ones.');
  add('section_education', 'Education section with a standard header', hasEducation, 10,
    'Add an "Education" section header so parsers can place your degree.');
  add('section_skills', 'Skills section with a standard header', hasSkills, 10,
    'Add a "Skills" section header — keyword matchers look for it explicitly.');

  /* ---- 2. Contact info extractable (20 pts) ---- */
  const contact = extractContact(raw) || {}; // boolean flags: { email, phone, ... }
  const hasEmail = !!contact.email;
  const hasPhone = !!contact.phone;
  add('contact_email', 'Email address present in plain text', hasEmail, 12,
    'Put your email in plain text near the top — emails inside images or headers are invisible to most parsers.');
  add('contact_phone', 'Phone number present in plain text', hasPhone, 8,
    'Add a phone number in plain text (e.g. +91 98xxxxxx10).');

  /* ---- 3. Dates parseable (15 pts) ---- */
  const slices = sliceSections(norm);
  const expText = slices.experience || slices.projects || norm;
  const dateHits = (expText.match(new RegExp(DATE_RE.source, 'gi')) || []).length;
  add('dates_parseable', 'Experience entries carry parseable dates (e.g. "Jan 2023 – Present")', dateHits >= 1, 15,
    'Add dates in a standard format ("Mon YYYY – Mon YYYY" or "YYYY – Present") to each role — ATS systems compute tenure from them.');

  /* ---- 4. Bullet length bounds (15 pts) ---- */
  const lines = raw.split('\n');
  const bullets = lines.filter((l) => BULLET_RE.test(l));
  const badBullets = bullets.filter((l) => {
    const words = l.replace(BULLET_RE, '').trim().split(/\s+/).filter(Boolean).length;
    return words < BULLET_MIN_WORDS || words > BULLET_MAX_WORDS;
  });
  const bulletsOk = bullets.length === 0 ? true : badBullets.length / bullets.length <= 0.25;
  add('bullet_bounds', `Bullets are ${BULLET_MIN_WORDS}–${BULLET_MAX_WORDS} words (parse + readability sweet spot)`, bulletsOk, 15,
    `Rewrite ${badBullets.length} bullet(s) to ${BULLET_MIN_WORDS}–${BULLET_MAX_WORDS} words — fragments and run-ons both parse poorly.`);

  /* ---- 5. Layout structure flags (15 pts) — only meaningful when the
     client tells us about its template; absent flags pass by default so
     plain-text audits are not penalised for unknown layout. ---- */
  const noTables = !structure.usesTables;
  const noColumns = !structure.usesColumns;
  const noImages = !structure.usesImages && !structure.usesTextBoxes;
  add('layout_tables', 'No tables in the ATS template', noTables, 6,
    'Remove tables from the ATS export — many parsers read tables cell-by-cell and scramble the order.');
  add('layout_columns', 'Single-column layout in the ATS template', noColumns, 5,
    'Use a single column for the ATS export — multi-column text interleaves when parsed.');
  add('layout_images', 'No images or text boxes in the ATS template', noImages, 4,
    'Remove images/text boxes from the ATS export — their content is invisible to parsers.');

  const totalWeight = checks.reduce((a, c) => a + c.weight, 0);
  const earned = checks.reduce((a, c) => a + (c.passed ? c.weight : 0), 0);
  const score = clamp(Math.round((earned / totalWeight) * 100), 0, 100);
  const grade = score >= 85 ? 'ATS-ready' : score >= 65 ? 'Minor fixes needed' : score >= 45 ? 'Several parse risks' : 'Likely to parse badly';

  return { score, grade, checks, fixes, version: ATS_AUDIT_VERSION };
}

export default { auditAtsCompatibility, ATS_AUDIT_VERSION };
