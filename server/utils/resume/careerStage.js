/* ============================================================
   CAREER STAGE NORMALIZATION — Resume OS / Template OS
   ------------------------------------------------------------
   One canonical vocabulary across recommendation, generation,
   layout adaptation and template metadata.

   Canonical stages:
     student → early → mid → senior → executive

   Historical aliases (professional, experienced, fresher, etc.)
   remain accepted so old templates/documents do not break.
   ============================================================ */
import { normalizeResumeDocument } from './resumeDocument.js';
import { parseResumeDate } from './dateEngine.js';

export const CAREER_STAGE_VERSION = 'career-stage-v1';
export const CAREER_STAGES = Object.freeze(['student', 'early', 'mid', 'senior', 'executive']);

const ALIASES = Object.freeze({
  student: 'student', fresher: 'student', graduate: 'student', campus: 'student', internship: 'student', intern: 'student', trainee: 'student',
  early: 'early', junior: 'early', 'early-career': 'early', entry: 'early', associate: 'early',
  mid: 'mid', professional: 'mid', experienced: 'mid', intermediate: 'mid',
  senior: 'senior', staff: 'senior', principal: 'senior', lead: 'senior', manager: 'senior',
  executive: 'executive', leadership: 'executive', director: 'executive', head: 'executive', vp: 'executive', chief: 'executive', cxo: 'executive',
});

export function normalizeCareerStage(value, fallback = 'mid') {
  const raw = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (!raw) return fallback;
  if (ALIASES[raw]) return ALIASES[raw];
  if (/student|fresher|graduate|intern|campus|trainee/.test(raw)) return 'student';
  if (/junior|entry|associate|early/.test(raw)) return 'early';
  if (/director|head|vice-president|vp|chief|c[etio]o|executive/.test(raw)) return 'executive';
  if (/senior|staff|principal|lead|manager/.test(raw)) return 'senior';
  if (/professional|mid|experienced/.test(raw)) return 'mid';
  return fallback;
}

export function normalizeCareerStages(values = [], { fallback = [] } = {}) {
  const source = Array.isArray(values) ? values : [values];
  const out = [...new Set(source.filter(Boolean).map((v) => normalizeCareerStage(v, '')).filter(Boolean))];
  return out.length ? out : [...fallback];
}


function computeExperienceTenure(doc) {
  let months = 0;
  const now = new Date();
  for (const e of doc.experience || []) {
    if (!e.enabled) continue;
    const start = parseResumeDate(e.startDate);
    if (!start.ok) continue;
    const end = e.current ? { ok: true, year: now.getFullYear(), month: now.getMonth() } : parseResumeDate(e.endDate);
    if (!end.ok) continue;
    months += Math.max(0, (end.year - start.year) * 12 + (end.month - start.month));
  }
  return { months, years: Math.floor(months / 12) };
}

export function detectCareerStage(doc, { targetRole = '' } = {}) {
  const d = normalizeResumeDocument(doc);
  const { years, months } = computeExperienceTenure(d);
  const expCount = d.experience.filter((e) => e.enabled).length;
  const role = String(targetRole || d.targetRole || d.contact?.title || '').trim();
  const lower = role.toLowerCase();

  /* Explicit title signals beat tenure thresholds. They describe the market
     level the resume is targeting, while years are used only as a fallback. */
  if (/student|fresher|graduate|intern|campus|trainee/.test(lower) && years < 2) return 'student';
  if (/chief|cto|cio|ciso|ceo|cdo|vice president|\bvp\b|director|head of|executive/.test(lower)) return 'executive';
  if (/staff|principal|senior|\bsr\.?\b|lead|manager|architect/.test(lower)) return 'senior';
  if (/junior|\bjr\.?\b|entry|associate/.test(lower)) return years < 4 ? 'early' : 'mid';

  if (!expCount) return 'student';
  /* Imported/renderer-structured fixtures and older resumes may have role
     entries without parseable start/end fields. Do not demote real work
     history to student merely because tenure is unavailable. */
  if (months < 6) return expCount >= 2 ? 'mid' : 'early';
  if (years < 3) return 'early';
  if (years < 7) return 'mid';
  return 'senior';
}

export function careerStageDistance(a, b) {
  const aa = normalizeCareerStage(a, 'mid');
  const bb = normalizeCareerStage(b, 'mid');
  return Math.abs(CAREER_STAGES.indexOf(aa) - CAREER_STAGES.indexOf(bb));
}

export function careerStageLabel(stage) {
  return ({ student: 'Student / Fresher', early: 'Early Career', mid: 'Mid Career', senior: 'Senior', executive: 'Executive / Leadership' })[normalizeCareerStage(stage)] || 'Mid Career';
}

export default { CAREER_STAGE_VERSION, CAREER_STAGES, normalizeCareerStage, normalizeCareerStages, detectCareerStage, careerStageDistance, careerStageLabel };
