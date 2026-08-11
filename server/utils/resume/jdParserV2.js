/* ============================================================
   JD PARSER V2 — section-aware, weighted, deterministic
   ------------------------------------------------------------
   Splits a pasted job description into labelled sections
   (responsibilities / required / preferred / qualifications /
   certifications), extracts ontology skills per section, and
   assigns capped deterministic weights:

     must-have / required ......... 3.0
     + frequency boost ............ +0.5 per extra mention, cap +1.0
     responsibilities ............. 2.0
     qualifications / education ... 1.5
     preferred / good-to-have ..... 1.2
     nice-to-have / bonus ......... 0.8

   Repetition can never inflate a term past its cap — keyword
   stuffing in the JD does not distort the match.
   ============================================================ */
import { ROLE_DICTIONARIES, resolveDictionary } from './roleDictionaries.js';
import { presentSkills, termsForSkill } from './skillMatcher.js';
import { canonicalSkill } from './skillOntology.js';

export const JD_PARSER_VERSION = 'jd-parser-v2';

const ALL_SKILLS = [...new Set(
  Object.values(ROLE_DICTIONARIES).flatMap((d) => [
    ...(d.mustHave || []), ...(d.goodToHave || []), ...(d.tools || []),
    ...(d.cloud || []), ...(d.languages || []), ...(d.databases || []), ...(d.testing || []),
  ]).map((s) => s.toLowerCase())
)];

const SECTION_MARKERS = [
  { kind: 'required', re: /^(must[-\s]?haves?|required( skills| qualifications)?|requirements|minimum qualifications|what you('|’)ll need|you (must )?have)\b/i, weight: 3.0 },
  { kind: 'responsibilities', re: /^(responsibilities|what you('|’)ll do|the role|your role|key duties|day[-\s]to[-\s]day|about the role)\b/i, weight: 2.0 },
  { kind: 'qualifications', re: /^(qualifications|education|academic)\b/i, weight: 1.5 },
  { kind: 'preferred', re: /^(preferred( skills| qualifications)?|good[-\s]to[-\s]have|desired)\b/i, weight: 1.2 },
  { kind: 'nice', re: /^(nice[-\s]to[-\s]have|bonus( points)?|plus(es)?|it('|’)s a plus)\b/i, weight: 0.8 },
  { kind: 'certifications', re: /^(certifications?|licenses?)\b/i, weight: 1.5 },
];

const WEIGHTS = { required: 3.0, responsibilities: 2.0, qualifications: 1.5, preferred: 1.2, nice: 0.8, certifications: 1.5, body: 1.0 };
const FREQ_BOOST_PER = 0.5;
const FREQ_BOOST_CAP = 1.0;

function splitSections(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const sections = [{ kind: 'body', lines: [] }];
  for (const line of lines) {
    const t = line.trim().replace(/[:：]\s*$/, '');
    const marker = t && t.length <= 70 ? SECTION_MARKERS.find((m) => m.re.test(t)) : null;
    if (marker) sections.push({ kind: marker.kind, lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }
  return sections.map((s) => ({ kind: s.kind, text: s.lines.join('\n') }));
}

function countMentions(text, skill) {
  let n = 0;
  const low = text.toLowerCase();
  for (const term of termsForSkill(skill)) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'gi');
    n += (low.match(re) || []).length;
  }
  return n;
}

function extractYears(text) {
  const m = String(text).match(/(\d{1,2})\s*(?:\+|-|–|to\s*\d{1,2})?\s*(?:years?|yrs?)/i);
  return m ? +m[1] : null;
}
function extractEducation(text) {
  const t = String(text).toLowerCase();
  if (/\b(ph\.?d|doctorate)\b/.test(t)) return 'PhD';
  if (/\b(master'?s|m\.?tech|m\.?s\.?|mba|m\.?sc)\b/.test(t)) return "Master's";
  if (/\b(bachelor'?s|b\.?tech|b\.?e\.?|b\.?sc|undergraduate degree|graduate degree)\b/.test(t)) return "Bachelor's";
  return '';
}
function extractCertifications(text) {
  const out = new Set();
  const t = String(text);
  for (const m of t.matchAll(/\b(aws (?:certified )?(?:solutions? architect|developer|sysops|devops engineer|data engineer|cloud practitioner)(?: associate| professional)?|aws certified [a-z ]{3,40}|azure [a-z-]{2,30} certif\w*|gcp [a-z ]{3,30} certif\w*|google (?:cloud|professional) [a-z ]{3,30}|databricks certified [a-z ]{3,30}|snowflake snowpro[a-z ]{0,20}|ckad?|cka|cks|cissp|ceh|oscp|pmp|prince2|scrum master|csm|safe agilist|comptia [a-z+]{2,15}|itil(?: v?\d)?|terraform associate)\b/gi)) {
    out.add(m[1].trim().replace(/\s+/g, ' '));
  }
  return [...out].slice(0, 8);
}

export function parseJDv2({ jobDescription = '', targetRole = '' } = {}) {
  const raw = String(jobDescription || '');
  const sections = splitSections(raw);
  const skillWeights = new Map(); // canonical -> { skill, weight, mentions, sections:Set }

  for (const sec of sections) {
    if (!sec.text.trim()) continue;
    const base = WEIGHTS[sec.kind] ?? 1.0;
    const found = presentSkills(sec.text.toLowerCase(), ALL_SKILLS);
    for (const skill of found) {
      const c = canonicalSkill(skill);
      const mentions = countMentions(sec.text, skill);
      const boost = Math.min(FREQ_BOOST_CAP, Math.max(0, mentions - 1) * FREQ_BOOST_PER);
      const w = base + (base >= 3.0 ? boost : 0); // frequency boost only lifts required terms
      const prev = skillWeights.get(c);
      if (!prev || w > prev.weight) {
        skillWeights.set(c, { skill, canonical: c, weight: Math.min(4.0, w), mentions: (prev?.mentions || 0) + mentions, sections: new Set([...(prev?.sections || []), sec.kind]) });
      } else {
        prev.mentions += mentions; prev.sections.add(sec.kind);
      }
    }
  }

  const all = [...skillWeights.values()].sort((a, b) => b.weight - a.weight || a.canonical.localeCompare(b.canonical));
  const required = all.filter((x) => x.weight >= 2.5).map((x) => x.skill);
  const responsibilities = all.filter((x) => x.weight >= 1.8 && x.weight < 2.5).map((x) => x.skill);
  const preferred = all.filter((x) => x.weight >= 1.0 && x.weight < 1.8).map((x) => x.skill);
  const nice = all.filter((x) => x.weight < 1.0).map((x) => x.skill);

  const jobTitle = (raw.match(/(?:job title|role|position)\s*[:\-]\s*([^\n]{2,80})/i) || [])[1]?.trim()
    || (raw.match(/^([A-Za-z][A-Za-z /&()+-]{2,60}(engineer|developer|analyst|manager|scientist|architect|consultant|designer))\s*$/im) || [])[1]?.trim()
    || targetRole || '';

  return {
    version: JD_PARSER_VERSION,
    jobTitle,
    required, responsibilities, preferred, nice,
    weighted: all.map((x) => ({ skill: x.skill, canonical: x.canonical, weight: Number(x.weight.toFixed(2)), mentions: x.mentions, sections: [...x.sections] })),
    yearsOfExperience: extractYears(raw),
    education: extractEducation(raw),
    certifications: extractCertifications(raw),
    detectedRole: (() => {
      /* strip seniority prefixes so "Senior DevOps Engineer" resolves */
      const stripped = jobTitle.replace(/^(senior|junior|lead|principal|staff|associate|sr\.?|jr\.?)\s+/i, '');
      const hit = resolveDictionary(stripped);
      return hit.known ? hit.name : (resolveDictionary(jobTitle).known ? resolveDictionary(jobTitle).name : '');
    })(),
    sectionsDetected: [...new Set(sections.map((s) => s.kind))],
  };
}

export default { JD_PARSER_VERSION, parseJDv2 };
