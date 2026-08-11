/* ============================================================
   DETERMINISTIC SUMMARY COMPILER — Resume OS V4
   ------------------------------------------------------------
   Compiles a professional 2–4 line summary from FACTS ONLY:
     role, years (computed from experience dates, never guessed),
     domain, top role-relevant technologies actually on the doc,
     verified capability counts, strongest quantified outcome
     (a metric that already exists in an enabled bullet).

   Zero AI. Zero invented claims. Deterministic: same doc + same
   options → same summary. Variation between users comes from a
   stable seed (docId hash) choosing among pattern families, so
   ten thousand students don't get one identical sentence.
   ============================================================ */
import { normalizeResumeDocument, collectBullets } from './resumeDocument.js';
import { resolveDictionary } from './roleDictionaries.js';
import { presentSkills } from './skillMatcher.js';
import { toCanonicalSet, canonicalSkill } from './skillOntology.js';
import { parseResumeDate } from './dateEngine.js';
import { detectCareerStage } from './careerStage.js';

export const SUMMARY_COMPILER_VERSION = 'summary-compiler-v4-career-stage-vocabulary';

/* Stable non-crypto hash for seeded pattern choice. */
function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

/* Years of experience computed ONLY from dated experience entries. */
export function computeYears(doc) {
  const d = normalizeResumeDocument(doc);
  let months = 0;
  const now = new Date();
  for (const e of d.experience) {
    if (!e.enabled) continue;
    const s = parseResumeDate(e.startDate);
    if (!s.ok) continue;
    const end = e.current ? { ok: true, year: now.getFullYear(), month: now.getMonth() } : parseResumeDate(e.endDate);
    if (!end.ok) continue;
    months += Math.max(0, (end.year - s.year) * 12 + (end.month - s.month));
  }
  return { months, years: Math.floor(months / 12) };
}

function yearsPhrase(years, months) {
  if (months <= 0) return '';
  if (years < 1) return '';           // never inflate "months" into experience claims
  if (years === 1) return '1+ year';
  return `${years}+ years`;
}

/* First metric already present in an enabled bullet — never invented. */
function strongestExistingMetric(doc) {
  const bullets = collectBullets(normalizeResumeDocument(doc)).filter((b) => b.enabled && b.text);
  const scored = [];
  for (const b of bullets) {
    const m = b.text.match(/\d[\d,.]*\s*(?:%|percent|x|k|m|tb|gb|users?|requests?|events?|services?|applications?|hours?|crores?|lakhs?)?/i);
    if (m) scored.push({ text: b.text.replace(/\s+/g, ' ').trim(), verified: !!b.verified });
  }
  scored.sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0));
  return scored[0] || null;
}

/* Role-relevant technologies actually on the document. */
function topTechnologies(doc, roleName, dict, limit = 4) {
  const d = normalizeResumeDocument(doc);
  const docText = [
    d.skills.filter((s) => s.enabled).map((s) => s.name).join(', '),
    ...collectBullets(d).filter((b) => b.enabled).map((b) => b.text),
    ...d.projects.filter((p) => p.enabled).map((p) => p.techStack),
  ].join('\n').toLowerCase();
  const pool = [...new Set([...(dict.mustHave || []), ...(dict.goodToHave || []), ...(dict.cloud || []), ...(dict.languages || []), ...(dict.tools || [])])];
  const present = presentSkills(docText, pool);
  /* keep original casing from the doc skills where available */
  const bySkillName = new Map(d.skills.map((s) => [canonicalSkill(s.name), s.name]));
  return present.slice(0, limit).map((p) => bySkillName.get(canonicalSkill(p)) || p);
}

const SENIORITY = (years) => (years >= 8 ? 'Senior' : years >= 4 ? 'Experienced' : '');

/* Pattern families — each is a pure function of extracted facts.
   Every claim in every template maps 1:1 to a provided fact. */
const PATTERNS = [
  {
    id: 'role-first',
    needs: (f) => !!f.role,
    build: (f) => {
      const bits = [];
      bits.push(`${f.seniority ? `${f.seniority} ` : ''}${f.role}${f.years ? ` with ${f.years} of experience` : ''}${f.domain ? ` in ${f.domain}` : ''}.`);
      if (f.tech.length) bits.push(`Hands-on with ${listOut(f.tech)}.`);
      if (f.verifiedCount > 0) bits.push(`${f.verifiedCount} platform-verified project${f.verifiedCount > 1 ? 's' : ''} supporting the capabilities presented.`);
      return bits.join(' ');
    },
  },
  {
    id: 'capability-first',
    needs: (f) => f.tech.length >= 2 && !!f.role,
    build: (f) => {
      const bits = [];
      bits.push(`${f.role} focused on ${listOut(f.tech.slice(0, 3))}${f.years ? `, building on ${f.years} of hands-on work` : ''}.`);
      if (f.domain) bits.push(`Domain experience in ${f.domain}.`);
      if (f.verifiedCount > 0) bits.push(`Evidence-backed: ${f.verifiedCount} verified project${f.verifiedCount > 1 ? 's' : ''} on this resume.`);
      return bits.join(' ');
    },
  },
  {
    id: 'evidence-first',
    needs: (f) => f.verifiedCount > 0 && !!f.role,
    build: (f) => {
      const bits = [];
      bits.push(`${f.role} with ${f.verifiedCount} verified project${f.verifiedCount > 1 ? 's' : ''}${f.years ? ` and ${f.years} of experience` : ''}.`);
      if (f.tech.length) bits.push(`Core stack: ${listOut(f.tech)}.`);
      return bits.join(' ');
    },
  },
  {
    id: 'student',
    needs: (f) => !f.years && !!f.role,
    build: (f) => {
      const bits = [];
      bits.push(`${f.education ? `${f.education} graduate` : 'Early-career candidate'} targeting ${f.role} roles.`);
      if (f.projectCount > 0) bits.push(`${f.projectCount} project${f.projectCount > 1 ? 's' : ''}${f.verifiedCount ? ` (${f.verifiedCount} verified)` : ''} demonstrating ${f.tech.length ? listOut(f.tech.slice(0, 3)) : 'practical engineering skills'}.`);
      else if (f.tech.length) bits.push(`Working knowledge of ${listOut(f.tech)}.`);
      return bits.join(' ');
    },
  },
  {
    id: 'experience-stack',
    needs: (f) => !!f.role && !!f.years && f.tech.length >= 2,
    build: (f) => {
      const bits = [`${f.role} with ${f.years} of experience across ${listOut(f.tech.slice(0, 4))}.`];
      if (f.domain) bits.push(`Experience includes ${f.domain} environments.`);
      if (f.verifiedCount > 0) bits.push(`${f.verifiedCount} verified project${f.verifiedCount > 1 ? 's' : ''} provide supporting evidence for the capabilities shown.`);
      return bits.join(' ');
    },
  },
  {
    id: 'practical-profile',
    needs: (f) => !!f.role && f.tech.length >= 2,
    build: (f) => {
      const bits = [`${f.seniority ? `${f.seniority} ` : ''}${f.role}${f.years ? ` bringing ${f.years} of practical experience` : ''} with ${listOut(f.tech.slice(0, 4))}.`];
      if (f.projectCount > 0 && f.verifiedCount > 0) bits.push(`Work shown here includes ${f.verifiedCount} verified project${f.verifiedCount > 1 ? 's' : ''} among ${f.projectCount} selected project${f.projectCount > 1 ? 's' : ''}.`);
      return bits.join(' ');
    },
  },
  {
    id: 'stack-depth',
    needs: (f) => !!f.role && !!f.years && f.tech.length >= 3,
    build: (f) => `${f.role} offering ${f.years} of hands-on delivery across ${listOut(f.tech.slice(0, 4))}${f.domain ? ` in ${f.domain}` : ''}.`,
  },
  {
    id: 'evidence-backed-practice',
    needs: (f) => !!f.role && f.verifiedCount > 0 && f.tech.length >= 2,
    build: (f) => `${f.role} combining practical work in ${listOut(f.tech.slice(0, 3))} with ${f.verifiedCount} platform-verified project${f.verifiedCount > 1 ? 's' : ''} presented as supporting evidence.`,
  },
  {
    id: 'early-career-builder',
    needs: (f) => f.stage === 'early' && !!f.role && f.tech.length >= 2,
    build: (f) => `Early-career ${f.role}${f.years ? ` with ${f.years} of experience` : ''}, building practical depth across ${listOut(f.tech.slice(0, 4))}.`,
  },
  {
    id: 'leadership-technology',
    needs: (f) => (f.stage === 'senior' || f.stage === 'executive') && !!f.role && !!f.years && f.tech.length >= 2,
    build: (f) => `${f.role} with ${f.years} of experience spanning ${listOut(f.tech.slice(0, 4))}${f.domain ? ` and ${f.domain}` : ''}.`,
  },
];

function listOut(items) {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] || '';
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/* Preserve whole sentences when a template gives the summary a tight content
   budget. If even the first sentence is too long, cut only on a word boundary
   and restore punctuation — never leave a visibly chopped word in a resume. */
function clipSummary(text, maxChars) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!Number.isFinite(maxChars) || maxChars <= 0 || clean.length <= maxChars) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
  let out = '';
  for (const raw of sentences) {
    const sentence = raw.trim();
    const candidate = out ? `${out} ${sentence}` : sentence;
    if (candidate.length <= maxChars) { out = candidate; continue; }
    break;
  }
  if (out) return out;
  const cut = clean.slice(0, maxChars + 1);
  const boundary = cut.lastIndexOf(' ');
  const clipped = (boundary >= Math.floor(maxChars * 0.7) ? cut.slice(0, boundary) : clean.slice(0, maxChars)).trim().replace(/[,:;\-]+$/, '');
  return /[.!?]$/.test(clipped) ? clipped : `${clipped}.`;
}

export function extractSummaryFacts(doc, { targetRole = '', verifiedSkills = [], domain = '' } = {}) {
  const d = normalizeResumeDocument(doc);
  const role = targetRole || d.targetRole || d.contact.title || '';
  const { name: roleName, dict } = resolveDictionary(role);
  const { years, months } = computeYears(d);
  const vSet = toCanonicalSet(verifiedSkills);
  const verifiedCount = d.projects.filter((p) => p.enabled && p.verified).length;
  const stage = detectCareerStage(d, { targetRole: role });
  return {
    role: role || roleName,
    roleFamily: roleName,
    stage,
    seniority: /\b(senior|sr\.?|lead|staff|principal|manager|director|head|chief|vice president|vp)\b/i.test(role) ? '' : SENIORITY(years),
    years: yearsPhrase(years, months),
    domain: String(domain || '').trim(),
    tech: topTechnologies(d, roleName, dict),
    verifiedCount,
    verifiedSkillCount: d.skills.filter((s) => s.enabled && vSet.has(canonicalSkill(s.name))).length,
    projectCount: d.projects.filter((p) => p.enabled).length,
    education: d.education.find((e) => e.enabled)?.degree || '',
    metric: strongestExistingMetric(d),
  };
}

/* Returns MULTIPLE deterministic candidates (primary first). */
export function compileSummary(doc, opts = {}) {
  const facts = extractSummaryFacts(doc, opts);
  const eligible = PATTERNS.filter((p) => p.needs(facts));
  if (!eligible.length) {
    return {
      ok: false, version: SUMMARY_COMPILER_VERSION, facts,
      reason: 'insufficient_facts',
      questions: ['What role are you targeting?', 'Add at least one experience entry or project so the summary has something true to say.'],
      candidates: [],
    };
  }
  const seed = seedOf(String(doc?.id || 'doc') + (opts.targetRole || ''));
  const ordered = [...eligible];
  /* seeded rotation so different users lead with different families */
  const rot = seed % ordered.length;
  const rotated = [...ordered.slice(rot), ...ordered.slice(0, rot)];
  const maxLen = Number.isFinite(opts.maxChars) ? opts.maxChars : 360;
  const candidates = rotated.map((p) => ({
    patternId: p.id,
    text: clipSummary(p.build(facts), maxLen),
  })).filter((c, i, arr) => c.text && arr.findIndex((x) => x.text === c.text) === i);
  return { ok: true, version: SUMMARY_COMPILER_VERSION, facts, candidates };
}

export default { SUMMARY_COMPILER_VERSION, compileSummary, extractSummaryFacts, computeYears };
