/* ============================================================
   JOB DESCRIPTION PARSER (deterministic)
   ------------------------------------------------------------
   Extracts structured fields from a raw JD without AI. Uses the role
   dictionaries + skill matcher to recognise required/preferred skills and
   tools, plus simple section heuristics for responsibilities.
   ============================================================ */
import { normalizeResumeText } from './normalizeResumeText.js';
import { resolveDictionary, ROLE_DICTIONARIES } from './roleDictionaries.js';
import { presentSkills } from './skillMatcher.js';

const ALL_SKILLS = Array.from(new Set(
  Object.values(ROLE_DICTIONARIES).flatMap((d) => [
    ...(d.mustHave || []), ...(d.goodToHave || []), ...(d.tools || []),
    ...(d.cloud || []), ...(d.languages || []), ...(d.databases || []), ...(d.testing || []),
  ])
));

function firstMatch(re, text) {
  const m = text.match(re);
  return m ? (m[1] || m[0]).trim() : '';
}

export function parseJD({ jobDescription = '', targetRole = '' } = {}) {
  const raw = String(jobDescription || '');
  const norm = normalizeResumeText(raw);

  const jobTitle = firstMatch(/(?:job title|role|position)\s*[:-]\s*([^\n]{2,80})/i, raw) ||
    firstMatch(/^([a-z][a-z /&]{2,60}(engineer|developer|analyst|manager|scientist|designer|architect))/im, raw) || targetRole || '';
  const company = firstMatch(/(?:company|organization|employer|at)\s*[:-]\s*([^\n]{2,60})/i, raw);

  const { dict } = resolveDictionary(targetRole || jobTitle);

  // Required vs preferred: split the JD around "preferred/nice to have" markers.
  const prefIdx = norm.search(/\b(preferred|nice to have|good to have|bonus|plus)\b/);
  const requiredText = prefIdx > -1 ? norm.slice(0, prefIdx) : norm;
  const preferredText = prefIdx > -1 ? norm.slice(prefIdx) : '';

  const skillsInJD = presentSkills(norm, ALL_SKILLS);
  const requiredSkills = presentSkills(requiredText, skillsInJD.length ? skillsInJD : ALL_SKILLS);
  const preferredSkills = presentSkills(preferredText, ALL_SKILLS).filter((s) => !requiredSkills.includes(s));

  // Responsibilities: bullet lines or "responsibilities" section lines.
  const respBlockIdx = raw.search(/responsibilit/i);
  const respSource = respBlockIdx > -1 ? raw.slice(respBlockIdx) : raw;
  const responsibilities = respSource.split('\n').map((l) => l.trim())
    .filter((l) => /^[•\-*]/.test(l) || /\b(build|develop|design|maintain|own|lead|manage|deliver|implement|collaborate|deploy|automate|test|analyze)\b/i.test(l))
    .slice(0, 12).map((l) => l.replace(/^[•\-*]\s*/, ''));

  const tools = presentSkills(norm, Array.from(new Set([...(dict.tools || []), ...(dict.cloud || [])])));

  const ym = norm.match(/\b(\d{1,2})\+?\s*years?\b/);
  const years = ym ? Number(ym[1]) : null;
  const experienceLevel = years == null ? (/(senior|lead|principal|staff)/.test(norm) ? 'senior' : /(junior|entry|fresher|intern)/.test(norm) ? 'junior' : 'mid')
    : years >= 6 ? 'senior' : years >= 2 ? 'mid' : 'junior';

  const domain = firstMatch(/\b(fintech|healthcare|e-commerce|ecommerce|edtech|saas|banking|insurance|logistics|gaming|cybersecurity|ai|ml|data)\b/i, raw).toLowerCase();

  const keywords = Array.from(new Set([...requiredSkills, ...preferredSkills, ...tools])).slice(0, 40);

  return {
    jobTitle: jobTitle.slice(0, 120),
    company: company.slice(0, 80),
    requiredSkills,
    preferredSkills,
    responsibilities,
    experienceLevel,
    domain,
    tools,
    keywords,
  };
}

export default { parseJD };
