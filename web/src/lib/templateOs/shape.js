/* ============================================================
   TEMPLATE OS — RESUME SHAPE ANALYZER + READING ORDER + FIXTURES
   Deterministic rules only. Shape drives recommendation and
   region adaptation; reading order protects ATS extraction;
   fixtures exercise every template family in certification.
   ============================================================ */
import { normalizeResumeDocument, collectBullets, fromStructuredResume } from '../../../../server/utils/resume/resumeDocument.js';
import { computeYears } from '../../../../server/utils/resume/summaryCompiler.js';
import { detectCareerStage } from '../../../../server/utils/resume/careerStage.js';
import { resolveDictionary } from '../../../../server/utils/resume/roleDictionaries.js';

export const RESUME_SHAPE_VERSION = 'resume-shape-v4-full-sections';
export const READING_ORDER_VERSION = 'reading-order-v1';

const density = (n, lo, hi) => (n >= hi ? 'high' : n >= lo ? 'medium' : 'low');

export function analyzeResumeShape(doc, { targetRole = '', atsPriority = 'high', preferredPageCount = 1 } = {}) {
  const looksStructured = !!(doc?.personalInfo || (doc?.skills && !Array.isArray(doc.skills)));
  const d = normalizeResumeDocument(looksStructured ? fromStructuredResume(doc) : doc);
  const { years } = computeYears(d);
  const bullets = collectBullets(d).filter((b) => b.enabled && b.text);
  const skillCount = d.skills.filter((s) => s.enabled).length;
  const projectCount = d.projects.filter((p) => p.enabled).length;
  const certCount = d.certifications.filter((c) => c.enabled).length;
  const expCount = d.experience.filter((e) => e.enabled).length;
  const educationCount = d.education.filter((e) => e.enabled !== false).length;
  const achievementCount = (d.achievements || []).filter((a) => (typeof a === 'string' ? a.trim() : a?.enabled !== false)).length;
  const publicationCount = (d.publications || []).filter((x) => x?.enabled !== false).length;
  const patentCount = (d.patents || []).filter((x) => x?.enabled !== false).length;
  const volunteerCount = (d.volunteer || []).filter((x) => x?.enabled !== false).length;
  const languageCount = (d.languages || []).filter((x) => x?.enabled !== false).length;
  const customSectionCount = (d.customSections || []).filter((x) => x?.enabled !== false && (x.items || []).some((it) => it?.enabled !== false)).length;
  const customItemCount = (d.customSections || []).filter((x) => x?.enabled !== false).reduce((n, x) => n + (x.items || []).filter((it) => it?.enabled !== false).length, 0);
  const optionalContentUnits = publicationCount * 1.35 + patentCount * 1.35 + volunteerCount + languageCount * 0.35 + customSectionCount * 0.8 + customItemCount * 0.85;
  const linkCount = ['linkedin', 'github', 'portfolio'].filter((k) => String(d.contact?.[k] || '').trim()).length + (d.contact?.links || []).filter((x) => String(x || '').trim()).length;
  const role = targetRole || d.targetRole || d.contact?.title || '';
  const { name: roleName } = resolveDictionary(role.replace(/^(senior|junior|lead|principal|staff|sr\.?|jr\.?)\s+/i, ''));
  const careerStage = detectCareerStage(d, { targetRole: role });
  const experiencePriority = (careerStage === 'senior' || careerStage === 'executive' || expCount >= 3 || bullets.length >= 12) ? 'high'
    : (expCount >= 2 || bullets.length >= 7) ? 'medium' : 'low';
  const railLoadScore = Number((skillCount * 0.34 + certCount * 1.35 + educationCount * 1.6 + achievementCount * 0.9 + languageCount * 0.45 + linkCount * 0.65).toFixed(1));
  const railDensity = railLoadScore >= 14 ? 'high' : railLoadScore >= 7 ? 'medium' : 'low';
  const layoutPressure = (bullets.length >= 16 || projectCount >= 4 || skillCount >= 24 || optionalContentUnits >= 8) ? 'high'
    : (bullets.length >= 9 || projectCount >= 3 || skillCount >= 16 || optionalContentUnits >= 4) ? 'medium' : 'low';
  return {
    version: RESUME_SHAPE_VERSION,
    careerStage,
    years,
    experienceCount: expCount,
    experienceBulletCount: bullets.length,
    experienceDensity: density(bullets.length, 8, 16),
    skillCount,
    skillDensity: density(skillCount, 10, 18),
    projectCount,
    projectDensity: density(projectCount, 2, 4),
    certificationCount: certCount,
    certificationDensity: density(certCount, 2, 4),
    educationCount,
    achievementCount,
    publicationCount, patentCount, volunteerCount, languageCount, customSectionCount, customItemCount, optionalContentUnits: Number(optionalContentUnits.toFixed(1)),
    linkCount,
    railLoadScore,
    railDensity,
    experiencePriority,
    layoutPressure,
    educationImportance: careerStage === 'student' ? 'high' : careerStage === 'early' ? 'medium' : years >= 5 ? 'low' : 'medium',
    summaryLength: d.summary.length > 260 ? 'long' : d.summary.length > 90 ? 'medium' : d.summary ? 'short' : 'none',
    targetRole: roleName || role,
    atsPriority,
    preferredPageCount,
  };
}

/* ------------------------------------------------------------------ */
/* Semantic reading-order validation                                   */
/* Expected: canonical anchor tokens in semantic order; extracted text */
/* must contain them in a compatible order (longest increasing match). */
/* ------------------------------------------------------------------ */
export function expectedOrderAnchors(structured, order) {
  const anchors = [];
  const push = (t) => { const v = String(t || '').trim(); if (v.length >= 3) anchors.push(v); };
  push(structured.personalInfo?.name);
  for (const key of order) {
    if (key === 'summary' && structured.summary) push(structured.summary.split(/\s+/).slice(0, 4).join(' '));
    if (key === 'experience') for (const e of structured.experience || []) { push(e.role); push(e.company); }
    if (key === 'projects') for (const p of structured.projects || []) push(p.name);
    if (key === 'education') for (const e of structured.education || []) push(e.school);
    if (key === 'certifications') for (const c of (structured.certifications || []).slice(0, 3)) push(typeof c === 'string' ? c : c?.text);
    if (key === 'achievements') for (const x of (structured.achievements || []).slice(0, 2)) push(typeof x === 'string' ? x : x?.text);
    if (key === 'publications') for (const x of (structured.publications || []).slice(0, 2)) push(typeof x === 'string' ? x : x?.text);
    if (key === 'patents') for (const x of (structured.patents || []).slice(0, 2)) push(typeof x === 'string' ? x : x?.text);
    if (key === 'volunteer') for (const x of (structured.volunteer || []).slice(0, 2)) push(typeof x === 'string' ? x : x?.text);
    if (key === 'languages' && (structured.languages || []).length) push((structured.languages || []).map((x) => typeof x === 'string' ? x : x?.text).filter(Boolean).slice(0, 3).join('  ·  '));
    if (key === 'customSections') for (const cs of (structured.customSections || [])) { push(cs.title); for (const x of (cs.items || []).slice(0, 1)) push(typeof x === 'string' ? x : x?.text); }
  }
  return anchors;
}

export function scoreReadingOrder(structured, extractedText, order) {
  const anchors = expectedOrderAnchors(structured, order);
  const hay = String(extractedText || '').toLowerCase();
  if (!anchors.length) return { version: READING_ORDER_VERSION, score: 0, found: 0, total: 0, inOrder: 0, misplaced: 0 };
  /* Sequential walk: a parser reading top-to-bottom must meet each anchor at or
     after the previous one. This is robust to substring collisions (a role
     echoed in the header title never satisfies the experience-section anchor —
     the cursor has already moved past the header by then only if the summary
     anchor matched, so early echoes simply don't advance the walk). */
  let cursor = 0; let inOrder = 0; let found = 0;
  for (const a of anchors) {
    const needle = a.toLowerCase();
    const seq = hay.indexOf(needle, cursor);
    if (seq >= 0) { inOrder += 1; found += 1; cursor = seq + 1; continue; }
    if (hay.indexOf(needle) >= 0) found += 1; // present, but behind the cursor → misplaced
  }
  return {
    version: READING_ORDER_VERSION,
    total: anchors.length,
    found,
    inOrder,
    score: Math.round((inOrder / anchors.length) * 100),
    misplaced: found - inOrder,
  };
}

/* ------------------------------------------------------------------ */
/* Certification fixtures — structured renderer inputs                 */
/* ------------------------------------------------------------------ */
const P = (name, title, extra = {}) => ({
  personalInfo: { name, title, email: 'fixture@example.com', phone: '+91 98000 00000', location: 'Pune, IN', linkedin: 'linkedin.com/in/fixture', github: '', portfolio: '' },
  summary: 'Focused professional summary used for layout certification runs across all templates.',
  skills: [{ group: 'Core', items: ['Python', 'SQL', 'AWS'] }],
  experience: [], projects: [], education: [{ school: 'UPES Dehradun', degree: 'B.Tech CSE', dates: '2019' }],
  certifications: [], achievements: [],
  ...extra,
});
const exp = (role, company, dates, n, long = false) => ({ role, company, dates, bullets: Array.from({ length: n }, (_, i) => (long
  ? `Delivered measurable outcome number ${i + 1} for ${company}: scoped the initiative with stakeholders, coordinated delivery across dependent teams, instrumented the rollout with clear success metrics, and documented the verified results for audit.`
  : `Delivered measurable outcome number ${i + 1} for ${company} with clear scope and verifiable detail.`)) });

export const TEMPLATE_FIXTURES = [
  { id: 'short-fresher', structured: P('Diya Kulkarni', 'Graduate', { projects: [{ name: 'Campus Portal', tech: 'React', bullets: ['Built the student portal end to end.'] }] }) },
  { id: 'senior-technical', structured: P('Rohan Iyer', 'Senior DevOps Engineer', { experience: [exp('Senior DevOps Engineer', 'CloudWorks', '2021 – Present', 5), exp('DevOps Engineer', 'InfraCo', '2018 – 2021', 3), exp('Systems Engineer', 'NetServe', '2016 – 2018', 2)], skills: [{ group: 'Cloud', items: ['AWS', 'Azure', 'Terraform', 'Kubernetes', 'Docker', 'Helm'] }, { group: 'CI/CD', items: ['GitLab CI', 'Jenkins', 'ArgoCD'] }], certifications: ['AWS Solutions Architect Professional', 'CKA'], projects: [{ name: 'Zero-Downtime Migration', tech: 'Kubernetes', verified: true, bullets: ['Migrated 40 services with zero downtime.'] }] }) },
  { id: 'skills-heavy', structured: P('Sara Menon', 'Data Engineer', { skills: [{ group: 'Languages', items: ['Python', 'Scala', 'SQL', 'Java', 'Go'] }, { group: 'Data', items: ['Spark', 'Kafka', 'Airflow', 'dbt', 'Iceberg', 'Snowflake', 'Redshift', 'Databricks'] }, { group: 'Cloud', items: ['AWS', 'GCP', 'Terraform', 'Docker', 'Kubernetes', 'Glue', 'EMR', 'Lambda', 'Athena', 'Kinesis'] }], experience: [exp('Data Engineer', 'DataCo', '2022 – Present', 4)] }) },
  { id: 'certification-heavy', structured: P('Vikram Shah', 'Security Engineer', { certifications: ['CISSP', 'CEH', 'OSCP', 'AWS Security Specialty', 'CompTIA Security+', 'GIAC GSEC'], experience: [exp('Security Engineer', 'SecureNet', '2020 – Present', 4)] }) },
  { id: 'long-names', structured: P('Anantha Padmanabhan Venkatasubramanian', 'Principal Software Engineering Architect', { experience: [exp('Principal Software Engineering Architect and Technical Delivery Lead', 'International Business Process Transformation Technologies Private Limited', 'January 2019 – Present', 4)], projects: [{ name: 'Enterprise Customer Relationship Management Modernization Initiative', tech: 'Java, Spring', bullets: ['Modernized the platform in phased releases.'] }] }) },
  { id: 'two-page', structured: P('Meera Joshi', 'Engineering Manager', { experience: [exp('Engineering Manager', 'ScaleCo', '2022 – Present', 7, true), exp('Tech Lead', 'BuildIt', '2019 – 2022', 6, true), exp('Senior Engineer', 'DevHouse', '2016 – 2019', 6, true), exp('Engineer', 'StartLab', '2014 – 2016', 5, true)], projects: [{ name: 'Platform Rebuild', tech: 'Go', bullets: ['Rebuilt core platform.', 'Cut infra cost 30%.'] }, { name: 'Hiring System', tech: 'React', bullets: ['Shipped internal ATS.'] }], certifications: ['PMP', 'AWS SA Associate'] }) },
  { id: 'international', structured: P('Zoë Núñez-Ōkawa', 'Développeuse Logiciel', { summary: 'Ingénieure focalisée sur la fiabilité — 日本語対応, señales claras.', experience: [exp('Développeuse Senior', 'Société Générale d\u2019Ingénierie', '2020 – Present', 3)] }) },
];

export default { RESUME_SHAPE_VERSION, READING_ORDER_VERSION, analyzeResumeShape, scoreReadingOrder, expectedOrderAnchors, TEMPLATE_FIXTURES };
