/* ============================================================
   SECTION DETECTOR
   ------------------------------------------------------------
   Detects standard resume sections (with aliases) and slices the
   normalized text into per-section blocks so other engines can do
   evidence-based matching (skills mentioned under EXPERIENCE matter more).
   ============================================================ */

const SECTION_ALIASES = {
  summary: ['summary', 'profile', 'objective', 'about me', 'professional summary', 'career objective'],
  skills: ['skills', 'technical skills', 'core competencies', 'technologies', 'tech stack', 'key skills'],
  experience: ['experience', 'work experience', 'employment', 'professional experience', 'work history', 'career history'],
  projects: ['projects', 'project', 'personal projects', 'academic projects', 'key projects', 'selected projects'],
  education: ['education', 'academics', 'qualification', 'academic background'],
  certifications: ['certifications', 'certification', 'licenses', 'courses', 'certificates'],
  achievements: ['achievements', 'achievement', 'awards', 'accomplishments', 'honors', 'honours'],
};

const HEADER_RE = /^[ \t]*([a-z][a-z &/]{1,40})[ \t]*:?[ \t]*$/i;

export function detectSections(normalizedText = '') {
  const present = {};
  for (const key of Object.keys(SECTION_ALIASES)) {
    present[key] = SECTION_ALIASES[key].some((alias) =>
      new RegExp(`(^|\\n)[ \\t]*${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normalizedText)
    );
  }
  return present;
}

/* Map each line that looks like a header to its canonical section, then
   collect the body text belonging to each detected section. */
/* ------------------------------------------------------------------
   BLOB RECOVERY
   ------------------------------------------------------------------
   Section slicing needs headers on their own line. Real input does not
   always cooperate: a PDF with no usable text geometry, a copy-paste out
   of a web page, or a producer that emits one run per page all arrive as
   a wall of text with the headers buried inline.

   Rather than dumping the whole document into `preamble` — which leaves
   every downstream engine with no structure at all — we re-break the text
   at recognised section headers. Only applied when the text genuinely
   looks like a blob, so well-formed input is never touched.
   ------------------------------------------------------------------ */
const ALL_ALIASES = Object.entries(SECTION_ALIASES)
  .flatMap(([canon, aliases]) => aliases.map((a) => ({ canon, alias: a })))
  /* Longest first: "professional experience" must win over "experience". */
  .sort((a, b) => b.alias.length - a.alias.length);

export function looksLikeBlob(text) {
  const t = String(text || '');
  if (t.length < 400) return false;
  const lines = t.split('\n').filter((l) => l.trim());
  if (!lines.length) return false;
  const meanLineLength = t.length / lines.length;
  /* A formatted resume averages well under 120 characters per line. Anything
     above that is a wall of text regardless of how many newlines it has. */
  return meanLineLength > 160;
}

/* "EDUCATION & CERTIFICATIONS" is ONE header, not two. Splitting it leaves
   an orphan "&" as the education body and pushes the degree into
   certifications. Compounds are broken out first and protected. */
const COMPOUND_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${Object.values(SECTION_ALIASES).flat()
    .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`
  + `[ \\t]*(?:&|and|/)[ \\t]*`
  + `(${Object.values(SECTION_ALIASES).flat()
    .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`
  + `[ \\t]*:?(?![\\p{L}\\p{N}])`,
  'giu',
);

export function recoverInlineHeaders(text) {
  let out = String(text || '');
  /* Compounds first, and marked so the per-alias pass below leaves them be. */
  out = out.replace(COMPOUND_RE, (m, a, b) => `\n\u0000${a} & ${b}\u0000\n`);
  for (const { alias } of ALL_ALIASES) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /* Break BEFORE the header and AFTER it, so the header ends up alone on
       its own line — which is exactly what sliceSections needs. Requires a
       word boundary on both sides so "skills" inside "soft skills matter"
       is not treated as a header. */
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}[ \\t]*:?(?![\\p{L}\\p{N}])`, 'giu'),
      (m, offset, whole) => {
        /* Leave anything inside a protected compound header alone. */
        const before = whole.slice(0, offset);
        const opened = (before.match(/\u0000/g) || []).length;
        if (opened % 2 === 1) return m;
        return `\n${m.replace(/[ \t]*:?$/, '')}\n`;
      },
    );
  }
  return out.replace(/\u0000/g, '').replace(/\n{3,}/g, '\n\n');
}

export function sliceSections(normalizedText = '') {
  const source = looksLikeBlob(normalizedText)
    ? recoverInlineHeaders(normalizedText)
    : normalizedText;
  const lines = source.split('\n');
  const blocks = {};
  let current = 'preamble';
  blocks[current] = [];
  const lookup = {};
  for (const [canon, aliases] of Object.entries(SECTION_ALIASES)) {
    for (const a of aliases) lookup[a] = canon;
  }
  /* A compound header resolves to its FIRST member, and its body is shared —
     "EDUCATION & CERTIFICATIONS" really does contain both. */
  const resolveHeader = (h) => {
    if (lookup[h]) return lookup[h];
    const parts = h.split(/\s*(?:&|and|\/)\s*/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const canons = parts.map((x) => lookup[x]).filter(Boolean);
    return canons.length >= 2 ? canons : null;
  };

  for (const line of lines) {
    const m = line.match(HEADER_RE);
    const headerText = m ? m[1].trim().toLowerCase() : '';
    const resolved = headerText ? resolveHeader(headerText) : null;
    if (Array.isArray(resolved)) {
      /* Body accumulates under the first; the others are aliased afterwards. */
      current = resolved[0];
      if (!blocks[current]) blocks[current] = [];
      blocks[`__alias__${current}`] = resolved.slice(1);
      continue;
    }
    if (headerText && lookup[headerText]) {
      current = lookup[headerText];
      if (!blocks[current]) blocks[current] = [];
      continue;
    }
    // also catch "skills:" style inline headers at start of a line
    const inline = line.match(/^[ \t]*([a-z][a-z &/]{1,40})\s*:/i);
    if (inline && lookup[inline[1].trim().toLowerCase()]) {
      current = lookup[inline[1].trim().toLowerCase()];
      if (!blocks[current]) blocks[current] = [];
      blocks[current].push(line.slice(line.indexOf(':') + 1));
      continue;
    }
    (blocks[current] = blocks[current] || []).push(line);
  }
  const text = {};
  const aliasPairs = [];
  for (const k of Object.keys(blocks)) {
    if (k.startsWith('__alias__')) {
      aliasPairs.push([k.replace('__alias__', ''), blocks[k]]);
      continue;
    }
    text[k] = blocks[k].join('\n').trim();
  }
  for (const [primary, others] of aliasPairs) {
    for (const other of others) {
      if (!text[other]) text[other] = text[primary] || '';
    }
  }
  // Convenience aggregates used by the skill evidence engine.
  text.experienceProjects = [text.experience || '', text.projects || ''].join('\n').trim();
  return text;
}

export function detectExperienceLevel(normalizedText = '') {
  const fresherSignals = ['intern', 'fresher', 'b.tech', 'b.e.', 'bachelor', 'undergraduate', 'cgpa', 'gpa', 'final year', 'pursuing', 'student'];
  const expPatterns = [/\b(\d{1,2})\+?\s*years?\b/, /years of experience/, /work experience/, /professional experience/];
  const fresher = fresherSignals.reduce((n, w) => n + (normalizedText.includes(w) ? 1 : 0), 0);
  const exp = expPatterns.reduce((n, re) => n + (re.test(normalizedText) ? 1 : 0), 0);
  // Try to read an explicit "<n> years"
  const ym = normalizedText.match(/\b(\d{1,2})\+?\s*years?\b/);
  const years = ym ? Number(ym[1]) : null;
  let level = 'fresher';
  if (years != null) level = years >= 6 ? 'senior' : years >= 2 ? 'mid' : 'junior';
  else if (exp > fresher) level = 'mid';
  return { level, years, isExperienced: level !== 'fresher' && level !== 'junior' ? true : (exp > fresher) };
}

export default {
  detectSections, sliceSections, detectExperienceLevel,
  looksLikeBlob, recoverInlineHeaders,
};
