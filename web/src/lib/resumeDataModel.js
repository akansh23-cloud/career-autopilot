/* ============================================================================
   resumeDataModel.js — structured resume data for the Resume OS render system
   ----------------------------------------------------------------------------
   The renderer NEVER works from one big text blob. Everything flows through a
   structured model:

   {
     personalInfo: { name, title, email, phone, location, linkedin, github, portfolio, links[] },
     summary,
     skills: { languages[], frontend[], backend[], cloud[], devops[], databases[], aiMl[], tools[], other[] },
     experience: [{ company, role, location, startDate, endDate, dates, bullets[] }],
     projects:   [{ name, techStack, link, bullets[] }],
     education:  [{ school, degree, dates, details[] }],
     certifications: [], achievements: [], publications: [], patents: [],
     volunteer: [], languages: [], extraSections: [{ title, items[] }]
   }

   • parseResumeText(text)        -> legacy section model (name/contacts/sections)
   • toStructuredResume(parsed)   -> structured model above (safe mapper)
   • structuredFromText(text)     -> convenience: parse + map
   • groupSkills(list)            -> categorised skill groups
   • devopsSkillGroups(skills)    -> Cloud / Containers / CI-CD / IaC / Monitoring /
                                     Scripting / Databases / Security grouping
   All functions are pure — they run in the browser AND under `node --test`.
   ========================================================================== */

/* ---------------------------------------------------------------- parser -- */

const SECTION_SYNONYMS = [
  { kind: 'summary', re: /^(professional\s+summary|summary|profile|objective|about(\s+me)?|career\s+objective)$/i },
  { kind: 'experience', re: /^(experience|work\s+experience|professional\s+experience|employment(\s+history)?|work\s+history|internships?)$/i },
  { kind: 'skills', re: /^(skills|technical\s+skills|core\s+competencies|technologies|tech\s+stack|skills\s*&?\s*tools|expertise)$/i },
  { kind: 'education', re: /^(education|academic(\s+background)?|qualifications)$/i },
  { kind: 'projects', re: /^(projects|key\s+projects|personal\s+projects|academic\s+projects|notable\s+projects)$/i },
  { kind: 'certifications', re: /^(certifications?|licenses?|certifications?\s*&?\s*licenses?|credentials)$/i },
  { kind: 'achievements', re: /^(awards?|honou?rs?|achievements?|accomplishments?|hackathons?)$/i },
  { kind: 'publications', re: /^(publications?|research|papers)$/i },
  { kind: 'patents', re: /^(patents?)$/i },
  { kind: 'languages-spoken', re: /^(languages?)$/i },
  { kind: 'volunteer', re: /^(volunteer(\s+work)?|community|extracurricular)$/i },
  { kind: 'interests', re: /^(interests?|hobbies)$/i },
  { kind: 'leadership', re: /^(leadership(\s+(impact|experience))?|management)$/i },
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const KNOWN_URL_RE = /((https?:\/\/)?(www\.)?(linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com|medium\.com)\/[^\s|,]+)/i;
const GENERIC_URL_RE = /((https?:\/\/)[^\s|,]+|[a-z0-9-]+\.(com|io|dev|me|net|org|app)\/[^\s|,]*)/i;

function classifyHeading(line) {
  const t = line.trim().replace(/[:]+$/, '');
  if (!t) return null;
  for (const s of SECTION_SYNONYMS) if (s.re.test(t)) return { kind: s.kind, title: t };
  if (/^[A-Z][A-Z0-9\s&/().,'+-]{1,40}$/.test(t) && t.length >= 3 && /[A-Z]{2,}/.test(t)) {
    const lower = t.toLowerCase();
    for (const s of SECTION_SYNONYMS) if (s.re.test(lower)) return { kind: s.kind, title: t };
    return { kind: 'custom', title: t };
  }
  return null;
}

function splitContacts(line) {
  return line
    .split(/\s*[|•·●▪]\s*|\s{2,}|\s+[–—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function contactType(piece) {
  if (EMAIL_RE.test(piece)) return 'email';
  if (KNOWN_URL_RE.test(piece)) {
    if (/github/i.test(piece)) return 'github';
    if (/linkedin/i.test(piece)) return 'linkedin';
    return 'link';
  }
  if (GENERIC_URL_RE.test(piece)) return 'link';
  if (PHONE_RE.test(piece) && piece.replace(/\D/g, '').length >= 8) return 'phone';
  return 'location';
}

function looksLikeContactLine(line) {
  return EMAIL_RE.test(line)
    || KNOWN_URL_RE.test(line)
    || (PHONE_RE.test(line) && line.replace(/\D/g, '').length >= 8)
    || /\s[|•·]\s/.test(line);
}

function isBullet(line) { return /^\s*[•·●▪◦*\u2022\-–—]\s+/.test(line); }
function stripBullet(line) { return line.replace(/^\s*[•·●▪◦*\u2022\-–—]\s+/, '').trim(); }
function looksLikeEntryHeading(line) {
  return /\s[|]\s/.test(line) || /\b(19|20)\d{2}\b/.test(line) || /\s[–—-]\s/.test(line);
}

/* Parse plain resume text into the intermediate section model. */
export function parseResumeText(text = '') {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw.split('\n');
  const data = { name: '', title: '', contacts: [], summary: '', sections: [] };

  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length) { data.name = lines[i].trim(); i++; }

  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length) {
    const t = lines[i].trim();
    if (t && !classifyHeading(t) && !looksLikeContactLine(t) && t.length <= 60) { data.title = t; i++; }
  }

  let guard = 0;
  while (i < lines.length && guard < 4) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }
    if (classifyHeading(t)) break;
    if (looksLikeContactLine(t)) {
      splitContacts(t).forEach((p) => data.contacts.push({ type: contactType(p), value: p }));
      i++; guard++; continue;
    }
    break;
  }

  let current = null;
  const freeSummary = [];
  const pushBlockLine = (line) => {
    if (!current) { freeSummary.push(line.trim()); return; }
    if (current.kind === 'skills') { current.raw.push(line.trim()); return; }
    if (isBullet(line)) {
      const last = current.blocks[current.blocks.length - 1];
      if (last) last.bullets.push(stripBullet(line));
      else current.blocks.push({ heading: '', meta: '', bullets: [stripBullet(line)] });
    } else if (looksLikeEntryHeading(line) || !current.blocks.length) {
      const parts = line.split(/\s*[|]\s*/).map((s) => s.trim()).filter(Boolean);
      current.blocks.push({ heading: parts[0] || line.trim(), meta: parts.slice(1).join('  ·  '), bullets: [] });
    } else {
      const last = current.blocks[current.blocks.length - 1];
      if (last && !last.bullets.length) last.meta = [last.meta, line.trim()].filter(Boolean).join('  ·  ');
      else current.blocks.push({ heading: '', meta: line.trim(), bullets: [] });
    }
  };

  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const heading = classifyHeading(t);
    if (heading) {
      current = { kind: heading.kind, title: heading.title, blocks: [], raw: [] };
      data.sections.push(current);
      continue;
    }
    pushBlockLine(lines[i]);
  }

  const summarySection = data.sections.find((s) => s.kind === 'summary');
  if (summarySection) {
    data.summary = summarySection.blocks.map((b) => [b.heading, b.meta, ...b.bullets].filter(Boolean).join(' ')).join(' ').trim()
      || summarySection.raw.join(' ').trim();
    data.sections = data.sections.filter((s) => s !== summarySection);
  }
  if (!data.summary && freeSummary.length) data.summary = freeSummary.join(' ').trim();

  data.sections.forEach((s) => {
    if (s.kind === 'skills') {
      const joined = [...s.raw, ...s.blocks.flatMap((b) => [b.heading, b.meta, ...b.bullets])].filter(Boolean).join(', ');
      s.chips = joined
        .split(/[,;]|\s•\s|\s·\s/)
        .map((x) => x.trim())
        .filter((x) => x && x.length <= 48);
    }
  });

  return data;
}

/* --------------------------------------------------------- skill grouping -- */

const SKILL_DICTIONARY = {
  languages: ['javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'go', 'golang', 'rust', 'kotlin', 'swift', 'ruby', 'php', 'scala', 'c', 'r', 'dart', 'bash', 'shell', 'powershell', 'sql'],
  frontend: ['react', 'react.js', 'reactjs', 'next.js', 'nextjs', 'vue', 'vue.js', 'angular', 'svelte', 'html', 'css', 'tailwind', 'tailwindcss', 'sass', 'redux', 'vite', 'webpack', 'jquery', 'bootstrap', 'material ui', 'mui'],
  backend: ['node', 'node.js', 'nodejs', 'express', 'express.js', 'django', 'flask', 'fastapi', 'spring', 'spring boot', 'rails', 'laravel', 'nest.js', 'nestjs', 'graphql', 'rest', 'rest api', 'grpc', 'microservices', 'websockets', 'kafka', 'rabbitmq'],
  cloud: ['aws', 'azure', 'gcp', 'google cloud', 'amazon web services', 'ec2', 's3', 'lambda', 'cloudfront', 'route53', 'eks', 'ecs', 'cloudformation', 'gke', 'aks', 'vercel', 'netlify', 'heroku', 'digitalocean', 'serverless'],
  devops: ['docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'jenkins', 'ci/cd', 'cicd', 'github actions', 'gitlab ci', 'circleci', 'argocd', 'helm', 'prometheus', 'grafana', 'datadog', 'new relic', 'elk', 'nagios', 'puppet', 'chef', 'vagrant', 'nginx', 'linux', 'devops', 'sre'],
  databases: ['mongodb', 'postgresql', 'postgres', 'mysql', 'redis', 'sqlite', 'dynamodb', 'cassandra', 'elasticsearch', 'oracle', 'mariadb', 'firestore', 'firebase', 'supabase', 'neo4j', 'snowflake', 'bigquery'],
  aiMl: ['machine learning', 'deep learning', 'tensorflow', 'pytorch', 'keras', 'scikit-learn', 'sklearn', 'nlp', 'computer vision', 'opencv', 'llm', 'langchain', 'hugging face', 'transformers', 'pandas', 'numpy', 'rag', 'genai', 'generative ai'],
  tools: ['git', 'github', 'gitlab', 'bitbucket', 'jira', 'confluence', 'postman', 'figma', 'vs code', 'intellij', 'slack', 'notion', 'swagger', 'maven', 'gradle', 'npm', 'yarn', 'pnpm', 'jest', 'cypress', 'playwright', 'selenium', 'junit', 'pytest'],
};

const SKILL_GROUP_ORDER = ['languages', 'frontend', 'backend', 'cloud', 'devops', 'databases', 'aiMl', 'tools', 'other'];
export const SKILL_GROUP_LABELS = {
  languages: 'Languages', frontend: 'Frontend', backend: 'Backend', cloud: 'Cloud',
  devops: 'DevOps', databases: 'Databases', aiMl: 'AI / ML', tools: 'Tools', other: 'Other',
};

function emptySkillGroups() {
  return { languages: [], frontend: [], backend: [], cloud: [], devops: [], databases: [], aiMl: [], tools: [], other: [] };
}

export function classifySkill(skill) {
  const s = String(skill || '').toLowerCase().trim();
  if (!s) return 'other';
  for (const group of SKILL_GROUP_ORDER) {
    const dict = SKILL_DICTIONARY[group];
    if (!dict) continue;
    if (dict.some((k) => s === k || s.replace(/\.js$/, '') === k.replace(/\.js$/, ''))) return group;
  }
  // looser containment pass for compound entries ("AWS Lambda", "React Native")
  for (const group of SKILL_GROUP_ORDER) {
    const dict = SKILL_DICTIONARY[group];
    if (!dict) continue;
    if (dict.some((k) => k.length > 2 && s.includes(k))) return group;
  }
  return 'other';
}

/* Group a flat skill list into the structured skill buckets. Dedupe, keep order. */
export function groupSkills(list = []) {
  const groups = emptySkillGroups();
  const seen = new Set();
  for (const raw of list) {
    const skill = String(raw || '').trim().replace(/^[-•·]\s*/, '');
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    groups[classifySkill(skill)].push(skill);
  }
  return groups;
}

/* Flatten structured skill groups back into one ordered list. */
export function flattenSkills(skills = {}) {
  const out = [];
  for (const g of SKILL_GROUP_ORDER) for (const s of skills[g] || []) out.push(s);
  return out;
}

/* DevOps-focused grouping required by the Cloud/DevOps template. */
const DEVOPS_GROUPS = [
  ['Cloud', ['aws', 'azure', 'gcp', 'google cloud', 'ec2', 's3', 'lambda', 'cloudformation', 'eks', 'gke', 'aks', 'route53', 'cloudfront', 'serverless', 'digitalocean']],
  ['Containers', ['docker', 'kubernetes', 'k8s', 'helm', 'containerd', 'podman', 'ecs', 'openshift']],
  ['CI/CD', ['jenkins', 'github actions', 'gitlab ci', 'circleci', 'argocd', 'ci/cd', 'cicd', 'travis', 'teamcity', 'spinnaker']],
  ['IaC', ['terraform', 'ansible', 'cloudformation', 'pulumi', 'puppet', 'chef', 'packer', 'vagrant']],
  ['Monitoring', ['prometheus', 'grafana', 'datadog', 'new relic', 'elk', 'splunk', 'nagios', 'cloudwatch', 'opentelemetry', 'sentry']],
  ['Scripting', ['bash', 'shell', 'python', 'powershell', 'go', 'golang', 'groovy', 'perl']],
  ['Databases', ['mongodb', 'postgresql', 'postgres', 'mysql', 'redis', 'dynamodb', 'elasticsearch', 'cassandra', 'sqlite']],
  ['Security', ['vault', 'iam', 'security', 'tls', 'ssl', 'sast', 'dast', 'snyk', 'trivy', 'owasp', 'kms', 'secrets']],
];

export function devopsSkillGroups(skills) {
  const flat = Array.isArray(skills) ? skills : flattenSkills(skills);
  const out = [];
  const used = new Set();
  for (const [label, dict] of DEVOPS_GROUPS) {
    const matched = flat.filter((s) => {
      const low = s.toLowerCase();
      return dict.some((k) => low === k || low.includes(k));
    }).filter((s) => !used.has(s.toLowerCase()));
    matched.forEach((s) => used.add(s.toLowerCase()));
    if (matched.length) out.push({ label, skills: matched });
  }
  const rest = flat.filter((s) => !used.has(s.toLowerCase()));
  if (rest.length) out.push({ label: 'Other', skills: rest });
  return out;
}

/* ----------------------------------------------------------------- mapper -- */

function splitDates(meta = '') {
  const m = String(meta).match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}|\d{4}|\d{1,2}\/\d{4})\s*[–—-]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}|\d{4}|present|current|now)/i);
  if (!m) return { dates: '', startDate: '', endDate: '' };
  return { dates: m[0], startDate: m[1], endDate: m[2] };
}

function mapExperienceBlock(b) {
  const metaParts = String(b.meta || '').split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean);
  const { dates, startDate, endDate } = splitDates([b.heading, b.meta].join(' '));
  const nonDate = metaParts.filter((p) => !/\b(19|20)\d{2}\b/.test(p) || /,/.test(p));
  return {
    role: b.heading || '',
    company: nonDate[0] || '',
    location: nonDate[1] || '',
    dates, startDate, endDate,
    bullets: (b.bullets || []).slice(),
  };
}

function mapProjectBlock(b) {
  const link = (String(b.heading + ' ' + b.meta).match(GENERIC_URL_RE) || [])[0] || '';
  return {
    name: b.heading || (b.meta || '').slice(0, 60),
    techStack: (b.meta || '').replace(link, '').replace(/\s*·\s*$/, '').trim(),
    link,
    bullets: (b.bullets || []).slice(),
  };
}

function mapEducationBlock(b) {
  const { dates } = splitDates([b.heading, b.meta].join(' '));
  return {
    school: b.heading || '',
    degree: (b.meta || '').replace(dates, '').replace(/\s*·\s*$/, '').trim(),
    dates,
    details: (b.bullets || []).slice(),
  };
}

function listItemsFromSection(section) {
  const out = [];
  for (const b of section.blocks || []) {
    const head = [b.heading, b.meta].filter(Boolean).join(' — ');
    if (head) out.push(head);
    for (const bullet of b.bullets || []) out.push(bullet);
  }
  return out.filter(Boolean);
}

export function emptyStructuredResume() {
  return {
    personalInfo: { name: '', title: '', email: '', phone: '', location: '', linkedin: '', github: '', portfolio: '', links: [] },
    summary: '',
    skills: emptySkillGroups(),
    experience: [],
    projects: [],
    education: [],
    certifications: [],
    achievements: [],
    publications: [],
    patents: [],
    volunteer: [],
    languages: [],
    extraSections: [],
  };
}

/* Safe mapper: legacy parsed model (or already-structured data) -> structured. */
export function toStructuredResume(parsed) {
  if (!parsed) return emptyStructuredResume();
  // Already structured? (has personalInfo) — normalise and return.
  if (parsed.personalInfo) {
    const base = emptyStructuredResume();
    const skills = parsed.skills && !Array.isArray(parsed.skills)
      ? { ...base.skills, ...parsed.skills }
      : groupSkills(parsed.skills || []);
    return {
      ...base,
      ...parsed,
      personalInfo: { ...base.personalInfo, ...parsed.personalInfo },
      skills,
      experience: (parsed.experience || []).map((e) => ({ company: '', role: '', location: '', dates: '', startDate: '', endDate: '', bullets: [], ...e })),
      projects: (parsed.projects || []).map((p) => ({ name: '', techStack: '', link: '', bullets: [], ...p })),
      education: (parsed.education || []).map((e) => (typeof e === 'string' ? { school: e, degree: '', dates: '', details: [] } : { school: '', degree: '', dates: '', details: [], ...e })),
      certifications: (parsed.certifications || []).slice(),
      achievements: (parsed.achievements || []).slice(),
      publications: (parsed.publications || []).slice(),
      patents: (parsed.patents || []).slice(),
      volunteer: (parsed.volunteer || []).slice(),
      languages: (parsed.languages || []).slice(),
      extraSections: (parsed.extraSections || []).slice(),
    };
  }

  const out = emptyStructuredResume();
  out.personalInfo.name = parsed.name || '';
  out.personalInfo.title = parsed.title || '';
  for (const c of parsed.contacts || []) {
    if (c.type === 'email' && !out.personalInfo.email) out.personalInfo.email = c.value;
    else if (c.type === 'phone' && !out.personalInfo.phone) out.personalInfo.phone = c.value;
    else if (c.type === 'github' && !out.personalInfo.github) out.personalInfo.github = c.value;
    else if (c.type === 'linkedin' && !out.personalInfo.linkedin) out.personalInfo.linkedin = c.value;
    else if (c.type === 'link' && !out.personalInfo.portfolio) out.personalInfo.portfolio = c.value;
    else if (c.type === 'location' && !out.personalInfo.location) out.personalInfo.location = c.value;
    else out.personalInfo.links.push(c.value);
  }
  out.summary = parsed.summary || '';

  for (const s of parsed.sections || []) {
    switch (s.kind) {
      case 'skills':
        out.skills = groupSkills(s.chips || []);
        break;
      case 'experience':
        out.experience.push(...(s.blocks || []).map(mapExperienceBlock));
        break;
      case 'projects':
        out.projects.push(...(s.blocks || []).map(mapProjectBlock));
        break;
      case 'education':
        out.education.push(...(s.blocks || []).map(mapEducationBlock));
        break;
      case 'certifications':
        out.certifications.push(...listItemsFromSection(s));
        break;
      case 'achievements':
        out.achievements.push(...listItemsFromSection(s));
        break;
      case 'publications':
        out.publications.push(...listItemsFromSection(s));
        break;
      case 'patents':
        out.patents.push(...listItemsFromSection(s));
        break;
      case 'volunteer':
        out.volunteer.push(...listItemsFromSection(s));
        break;
      case 'languages-spoken':
        out.languages.push(...listItemsFromSection(s));
        break;
      default:
        out.extraSections.push({ title: s.title || 'Additional', items: listItemsFromSection(s) });
    }
  }
  return out;
}

export function structuredFromText(text) {
  return toStructuredResume(parseResumeText(text));
}

/* Rough content size estimate used by the optimizer (pure, no DOM). */
export function estimateContentUnits(data) {
  const d = toStructuredResume(data);
  let units = 6; // header
  if (d.summary) units += Math.ceil(d.summary.length / 90);
  units += flattenSkills(d.skills).length * 0.35;
  for (const e of d.experience) units += 2 + e.bullets.length * 1.2;
  for (const p of d.projects) units += 2 + p.bullets.length * 1.2;
  units += d.education.length * 2;
  units += d.certifications.length + d.achievements.length + d.publications.length + d.patents.length + d.volunteer.length + d.languages.length * 0.45;
  for (const s of d.extraSections) units += 1 + s.items.length;
  return Math.round(units);
}
