/* ============================================================
   RESUME DOCUMENT — canonical Resume OS V3 model
   ------------------------------------------------------------
   ONE structured schema that every V3 engine (truth, compiler,
   ATS V3, JD match, tailoring, layout, export) operates on.

   Existing structured resumes (web/src/lib/resumeDataModel.js
   shape: personalInfo/summary/skills{groups}/experience/…) and
   raw resume text both convert INTO this model via adapters —
   no destructive migration, old data keeps working.

   Provenance levels (Truth Engine):
     VERIFIED           backed by a verified project / evidence id
     PROFILE_CONFIRMED  present in the user's saved profile
     USER_ENTERED       typed by the user in Resume OS
     UNSUPPORTED        appears in content with no known source
   ============================================================ */

export const RESUME_DOCUMENT_VERSION = 'resume-doc-v4-template-pin';

export const PROVENANCE = Object.freeze({
  VERIFIED: 'VERIFIED',
  PROFILE_CONFIRMED: 'PROFILE_CONFIRMED',
  USER_ENTERED: 'USER_ENTERED',
  UNSUPPORTED: 'UNSUPPORTED',
});
export const PROVENANCE_RANK = Object.freeze({
  VERIFIED: 3, PROFILE_CONFIRMED: 2, USER_ENTERED: 1, UNSUPPORTED: 0,
});

export const SECTION_KEYS = Object.freeze([
  'summary', 'skills', 'experience', 'projects', 'education',
  'certifications', 'achievements', 'publications', 'patents',
  'volunteer', 'languages', 'customSections',
]);

export const DEFAULT_SECTION_ORDER = Object.freeze([
  'summary', 'skills', 'experience', 'projects', 'education',
  'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages',
]);

/* Deterministic-friendly id: caller may pass a seed for reproducible tests. */
let _seq = 0;
export function makeId(prefix = 'itm', seed = '') {
  if (seed) return `${prefix}_${String(seed).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`;
  _seq = (_seq + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${_seq.toString(36)}`;
}
export function resetIdSequence() { _seq = 0; } // tests only

const str = (v, max = 4000) => String(v == null ? '' : v).slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);
const bool = (v) => v === true;

/* ------------------------------------------------ bullet ---- */
export function normalizeBullet(b, i = 0) {
  if (typeof b === 'string') b = { text: b };
  const o = b && typeof b === 'object' ? b : {};
  return {
    id: str(o.id) || makeId('bl', o.seed || ''),
    text: str(o.text, 600),
    sourceType: str(o.sourceType, 40),          // 'profile'|'project'|'manual'|'import'|'compiled'
    sourceId: str(o.sourceId, 80),
    evidenceIds: arr(o.evidenceIds).map((x) => str(x, 80)).slice(0, 20),
    verified: bool(o.verified),
    userConfirmed: o.userConfirmed !== false,   // imports set false until confirmed
    generatedByRule: str(o.generatedByRule, 60),
    provenance: PROVENANCE[o.provenance] ? o.provenance : (bool(o.verified) ? PROVENANCE.VERIFIED : PROVENANCE.USER_ENTERED),
    facts: o.facts && typeof o.facts === 'object' ? o.facts : null, // structured compiler input, if compiled
    relevanceScore: Number.isFinite(o.relevanceScore) ? o.relevanceScore : null,
    enabled: o.enabled !== false,
    _i: i,
  };
}

/* ------------------------------------------------ skill ---- */
export function normalizeSkillItem(s) {
  if (typeof s === 'string') s = { name: s };
  const o = s && typeof s === 'object' ? s : {};
  const status = ['VERIFIED', 'DECLARED', 'UNSUPPORTED'].includes(o.status) ? o.status : (bool(o.verified) ? 'VERIFIED' : 'DECLARED');
  return {
    id: str(o.id) || makeId('sk', o.name || ''),
    name: str(o.name, 60),
    group: str(o.group, 30),
    status,                                    // VERIFIED | DECLARED | UNSUPPORTED
    evidenceIds: arr(o.evidenceIds).map((x) => str(x, 80)).slice(0, 20),
    enabled: o.enabled !== false,
  };
}

function normalizeExperience(e, i) {
  const o = e && typeof e === 'object' ? e : {};
  return {
    id: str(o.id) || makeId('xp', ''),
    company: str(o.company, 120),
    role: str(o.role, 120),
    location: str(o.location, 80),
    startDate: str(o.startDate, 20),
    endDate: str(o.endDate, 20),
    current: bool(o.current) || /^(present|current|now)$/i.test(str(o.endDate)),
    dates: str(o.dates, 60),
    bullets: arr(o.bullets).map(normalizeBullet),
    provenance: PROVENANCE[o.provenance] ? o.provenance : PROVENANCE.USER_ENTERED,
    enabled: o.enabled !== false,
    _i: i,
  };
}

function normalizeProject(p, i) {
  const o = p && typeof p === 'object' ? p : {};
  return {
    id: str(o.id) || makeId('pj', ''),
    name: str(o.name, 140),
    techStack: str(o.techStack, 240),
    link: str(o.link, 200),
    startDate: str(o.startDate, 20),
    endDate: str(o.endDate, 20),
    current: bool(o.current),
    sourceProjectId: str(o.sourceProjectId, 80),   // Career Autopilot project id
    verified: bool(o.verified),
    evidenceIds: arr(o.evidenceIds).map((x) => str(x, 80)).slice(0, 30),
    bullets: arr(o.bullets).map(normalizeBullet),
    provenance: PROVENANCE[o.provenance] ? o.provenance : (bool(o.verified) ? PROVENANCE.VERIFIED : PROVENANCE.USER_ENTERED),
    enabled: o.enabled !== false,
    _i: i,
  };
}

function normalizeEducation(e, i) {
  const o = typeof e === 'string' ? { school: e } : (e && typeof e === 'object' ? e : {});
  return {
    id: str(o.id) || makeId('ed', ''),
    school: str(o.school, 160),
    degree: str(o.degree, 160),
    startDate: str(o.startDate, 20),
    endDate: str(o.endDate, 20),
    dates: str(o.dates, 60),
    details: arr(o.details).map((d) => str(d, 300)).slice(0, 8),
    enabled: o.enabled !== false,
    _i: i,
  };
}

function normalizeSimpleItem(x, prefix) {
  const o = typeof x === 'string' ? { text: x } : (x && typeof x === 'object' ? x : {});
  return {
    id: str(o.id) || makeId(prefix, ''),
    text: str(o.text || o.name, 400),
    provenance: PROVENANCE[o.provenance] ? o.provenance : PROVENANCE.USER_ENTERED,
    evidenceIds: arr(o.evidenceIds).map((v) => str(v, 80)).slice(0, 10),
    enabled: o.enabled !== false,
  };
}

function normalizeCustomSection(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    id: str(o.id) || makeId('cs', ''),
    title: str(o.title, 60) || 'Additional',
    items: arr(o.items).map((it) => normalizeSimpleItem(it, 'ci')),
    enabled: o.enabled !== false,
  };
}

/* ------------------------------------------------ document ---- */
export function emptyResumeDocument() {
  return normalizeResumeDocument({});
}

export function normalizeResumeDocument(doc) {
  const o = doc && typeof doc === 'object' ? doc : {};
  const contact = o.contact && typeof o.contact === 'object' ? o.contact : {};
  const styling = o.styling && typeof o.styling === 'object' ? o.styling : {};
  const order = arr(o.sectionOrder).filter((k) => DEFAULT_SECTION_ORDER.includes(k) || k === 'customSections');
  return {
    id: str(o.id, 60) || makeId('rd', ''),
    userId: str(o.userId, 60),
    title: str(o.title, 140) || 'My Resume',
    kind: ['master', 'variant'].includes(o.kind) ? o.kind : 'master',
    parentId: str(o.parentId, 60),               // variant -> master reference
    targetRole: str(o.targetRole, 120),
    targetJobId: str(o.targetJobId, 80),
    targetJobDescription: str(o.targetJobDescription, 60000),
    templateId: str(o.templateId, 60) || 'atlas',
    /* Phase 18: exact template revision used by this resume. Null preserves
       legacy documents created before template version pinning; the first
       authoritative save/render may resolve and pin the current version. */
    templateVersion: Number.isInteger(Number(o.templateVersion)) && Number(o.templateVersion) > 0 ? Number(o.templateVersion) : null,
    pageSize: ['a4', 'letter'].includes(o.pageSize) ? o.pageSize : 'a4',
    density: ['comfortable', 'compact', 'tight'].includes(o.density) ? o.density : 'compact',
    atsStrict: bool(o.atsStrict),
    styling: {
      accent: str(styling.accent, 12),
      font: str(styling.font, 120),
      margins: ['compact', 'balanced', 'spacious'].includes(styling.margins) ? styling.margins : 'balanced',
      headingStyle: str(styling.headingStyle, 24),
      bulletStyle: str(styling.bulletStyle, 24),
    },
    contact: {
      name: str(contact.name, 90),
      title: str(contact.title, 120),
      email: str(contact.email, 120),
      phone: str(contact.phone, 40),
      location: str(contact.location, 90),
      linkedin: str(contact.linkedin, 160),
      github: str(contact.github, 160),
      portfolio: str(contact.portfolio, 160),
      links: arr(contact.links).map((l) => str(l, 160)).slice(0, 6),
    },
    summary: str(o.summary, 1200),
    experience: arr(o.experience).map(normalizeExperience),
    projects: arr(o.projects).map(normalizeProject),
    education: arr(o.education).map(normalizeEducation),
    skills: arr(o.skills).map(normalizeSkillItem),
    certifications: arr(o.certifications).map((x) => normalizeSimpleItem(x, 'ct')),
    achievements: arr(o.achievements).map((x) => normalizeSimpleItem(x, 'ac')),
    publications: arr(o.publications).map((x) => normalizeSimpleItem(x, 'pb')),
    patents: arr(o.patents).map((x) => normalizeSimpleItem(x, 'pt')),
    volunteer: arr(o.volunteer).map((x) => normalizeSimpleItem(x, 'vo')),
    languages: arr(o.languages).map((x) => normalizeSimpleItem(x, 'lg')),
    customSections: arr(o.customSections).map(normalizeCustomSection),
    sectionOrder: order.length ? order : DEFAULT_SECTION_ORDER.slice(),
    /* variant overrides: { bulletIds:{[sectionItemId]: [bulletId,…]}, disabled:[itemId,…] } */
    overrides: o.overrides && typeof o.overrides === 'object' ? o.overrides : null,
    metadata: o.metadata && typeof o.metadata === 'object' ? o.metadata : {},
    provenanceNote: str(o.provenanceNote, 400),
    engineVersions: { document: RESUME_DOCUMENT_VERSION, ...(o.engineVersions && typeof o.engineVersions === 'object' ? o.engineVersions : {}) },
    version: Number.isFinite(o.version) ? o.version : 1,
    createdAt: str(o.createdAt, 40),
    updatedAt: str(o.updatedAt, 40),
  };
}

/* -------------------------------- legacy structured -> document ---- */
/* Accepts the resumeDataModel structured shape (personalInfo / grouped
   skills / string list sections) and lifts it into the canonical model. */
export function fromStructuredResume(s, { verifiedSkillSet = null } = {}) {
  const src = s && typeof s === 'object' ? s : {};
  const p = src.personalInfo || {};
  const isVerified = (name) => !!(verifiedSkillSet && verifiedSkillSet.has(String(name).toLowerCase()));
  const flatSkills = [];
  const groups = src.skills && !Array.isArray(src.skills) ? src.skills : null;
  if (groups) {
    for (const [group, list] of Object.entries(groups)) {
      for (const name of arr(list)) flatSkills.push({ name, group, status: isVerified(name) ? 'VERIFIED' : 'DECLARED' });
    }
  } else {
    for (const name of arr(src.skills)) flatSkills.push({ name, status: isVerified(name) ? 'VERIFIED' : 'DECLARED' });
  }
  return normalizeResumeDocument({
    title: p.name ? `${p.name} — Resume` : 'Imported Resume',
    contact: {
      name: p.name, title: p.title, email: p.email, phone: p.phone, location: p.location,
      linkedin: p.linkedin, github: p.github, portfolio: p.portfolio, links: p.links,
    },
    summary: src.summary || '',
    skills: flatSkills,
    experience: arr(src.experience).map((e) => ({
      company: e.company, role: e.role, location: e.location,
      startDate: e.startDate, endDate: e.endDate, dates: e.dates,
      bullets: arr(e.bullets).map((t) => ({ text: t, sourceType: 'import', userConfirmed: false })),
      provenance: PROVENANCE.USER_ENTERED,
    })),
    projects: arr(src.projects).map((pr) => ({
      name: pr.name, techStack: pr.techStack, link: pr.link,
      bullets: arr(pr.bullets).map((t) => ({ text: t, sourceType: 'import', userConfirmed: false })),
    })),
    education: arr(src.education),
    certifications: arr(src.certifications),
    achievements: arr(src.achievements),
    publications: arr(src.publications),
    patents: arr(src.patents),
    volunteer: arr(src.volunteer),
    languages: arr(src.languages),
    customSections: (arr(src.customSections).length ? arr(src.customSections) : arr(src.extraSections))
      .filter((x) => !['volunteer', 'volunteering', 'volunteer experience', 'languages', 'language'].includes(String(x?.title || '').trim().toLowerCase()))
      .map((x) => ({ title: x.title, items: arr(x.items) })),
  });
}

/* -------------------------------- document -> structured (renderer) ---- */
/* The block renderer consumes the resumeDataModel structured shape; this is
   the single bridge so templates/layout keep working untouched. Applies
   enabled flags + variant bullet overrides. */
export function toRendererStructured(doc) {
  const d = normalizeResumeDocument(doc);
  const ov = d.overrides || {};
  const pickedBullets = (item) => {
    const chosen = ov.bulletIds && Array.isArray(ov.bulletIds[item.id]) ? new Set(ov.bulletIds[item.id]) : null;
    return item.bullets
      .filter((b) => b.enabled && (!chosen || chosen.has(b.id)))
      .map((b) => b.text)
      .filter(Boolean);
  };
  const on = (it) => it.enabled && !(ov.disabled || []).includes(it.id);
  const skillGroups = {};
  for (const sk of d.skills) {
    if (!on(sk)) continue;
    const g = sk.group || 'other';
    (skillGroups[g] = skillGroups[g] || []).push(sk.name);
  }
  return {
    personalInfo: {
      name: d.contact.name, title: d.contact.title, email: d.contact.email, phone: d.contact.phone,
      location: d.contact.location, linkedin: d.contact.linkedin, github: d.contact.github,
      portfolio: d.contact.portfolio, links: d.contact.links.slice(),
    },
    summary: d.summary,
    skills: skillGroups,
    experience: d.experience.filter(on).map((e) => ({
      company: e.company, role: e.role, location: e.location,
      dates: e.dates || [e.startDate, e.current ? 'Present' : e.endDate].filter(Boolean).join(' – '),
      startDate: e.startDate, endDate: e.endDate, bullets: pickedBullets(e),
    })),
    projects: d.projects.filter(on).map((p) => ({
      name: p.name, techStack: p.techStack, link: p.link, bullets: pickedBullets(p),
    })),
    education: d.education.filter(on).map((e) => ({
      school: e.school, degree: e.degree,
      dates: e.dates || [e.startDate, e.endDate].filter(Boolean).join(' – '),
      details: e.details.slice(),
    })),
    certifications: d.certifications.filter(on).map((x) => x.text),
    achievements: d.achievements.filter(on).map((x) => x.text),
    publications: d.publications.filter(on).map((x) => x.text),
    patents: d.patents.filter(on).map((x) => x.text),
    volunteer: d.volunteer.filter(on).map((x) => x.text),
    languages: d.languages.filter(on).map((x) => x.text),
    customSections: d.customSections.filter((s) => s.enabled).map((s) => ({ title: s.title, items: s.items.filter((i) => i.enabled).map((i) => i.text) })),
    /* Legacy renderer compatibility: it historically receives volunteer,
       languages and custom sections through extraSections. Template OS reads
       the dedicated fields above and de-duplicates this compatibility view. */
    extraSections: [
      ...d.customSections.filter((s) => s.enabled).map((s) => ({ title: s.title, items: s.items.filter((i) => i.enabled).map((i) => i.text) })),
      ...(d.volunteer.some(on) ? [{ title: 'Volunteer', items: d.volunteer.filter(on).map((x) => x.text) }] : []),
      ...(d.languages.some(on) ? [{ title: 'Languages', items: d.languages.filter(on).map((x) => x.text) }] : []),
    ],
  };
}

/* -------------------------------- document -> plain text ---- */
/* ATS-readable text; also feeds the legacy text-based engines so the two
   scoring paths agree on content. Deterministic ordering. */
export function toPlainText(doc) {
  const d = normalizeResumeDocument(doc);
  const s = toRendererStructured(d);
  const L = [];
  const push = (x) => { if (x && String(x).trim()) L.push(String(x).trim()); };
  push(s.personalInfo.name);
  push(s.personalInfo.title);
  push([s.personalInfo.email, s.personalInfo.phone, s.personalInfo.location, s.personalInfo.linkedin, s.personalInfo.github, s.personalInfo.portfolio, ...s.personalInfo.links].filter(Boolean).join(' | '));
  const sec = (title, body) => { if (body.length) { L.push(''); push(title.toUpperCase()); body.forEach(push); } };
  if (s.summary) sec('Professional Summary', [s.summary]);
  const skillLines = Object.entries(s.skills).filter(([, v]) => v.length).map(([g, v]) => `${g}: ${v.join(', ')}`);
  sec('Skills', skillLines);
  sec('Experience', s.experience.flatMap((e) => [
    `${e.role}${e.company ? ' | ' + e.company : ''}${e.location ? ' | ' + e.location : ''}${e.dates ? ' | ' + e.dates : ''}`,
    ...e.bullets.map((b) => `• ${b}`),
  ]));
  sec('Projects', s.projects.flatMap((p) => [
    `${p.name}${p.techStack ? ' | ' + p.techStack : ''}${p.link ? ' | ' + p.link : ''}`,
    ...p.bullets.map((b) => `• ${b}`),
  ]));
  sec('Education', s.education.flatMap((e) => [
    `${e.school}${e.degree ? ' | ' + e.degree : ''}${e.dates ? ' | ' + e.dates : ''}`,
    ...e.details.map((x) => `• ${x}`),
  ]));
  sec('Certifications', s.certifications.map((x) => `• ${x}`));
  sec('Achievements', s.achievements.map((x) => `• ${x}`));
  sec('Publications', s.publications.map((x) => `• ${x}`));
  sec('Patents', s.patents.map((x) => `• ${x}`));
  for (const ex of s.extraSections) sec(ex.title, ex.items.map((x) => `• ${x}`));
  return L.join('\n');
}

/* All bullets with location refs — shared by checks/redundancy/truth. */
export function collectBullets(doc) {
  const d = normalizeResumeDocument(doc);
  const out = [];
  for (const e of d.experience) for (const b of e.bullets) out.push({ ...b, section: 'experience', itemId: e.id, itemLabel: e.role || e.company, current: e.current });
  for (const p of d.projects) for (const b of p.bullets) out.push({ ...b, section: 'projects', itemId: p.id, itemLabel: p.name, current: p.current, projectVerified: p.verified });
  return out;
}

export default {
  RESUME_DOCUMENT_VERSION, PROVENANCE, PROVENANCE_RANK, SECTION_KEYS, DEFAULT_SECTION_ORDER,
  makeId, resetIdSequence, emptyResumeDocument, normalizeResumeDocument, normalizeBullet,
  normalizeSkillItem, fromStructuredResume, toRendererStructured, toPlainText, collectBullets,
};
