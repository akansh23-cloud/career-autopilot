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
export function sliceSections(normalizedText = '') {
  const lines = normalizedText.split('\n');
  const blocks = {};
  let current = 'preamble';
  blocks[current] = [];
  const lookup = {};
  for (const [canon, aliases] of Object.entries(SECTION_ALIASES)) {
    for (const a of aliases) lookup[a] = canon;
  }
  for (const line of lines) {
    const m = line.match(HEADER_RE);
    const headerText = m ? m[1].trim().toLowerCase() : '';
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
  for (const k of Object.keys(blocks)) text[k] = blocks[k].join('\n').trim();
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

export default { detectSections, sliceSections, detectExperienceLevel };
