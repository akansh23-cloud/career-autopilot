/* ============================================================
   TEMPLATE OS — PREVIEW FIXTURES
   ------------------------------------------------------------
   Curated, deterministic sample data used only when generating cached
   template gallery images. The fixture is chosen by template family so
   a student template is not previewed with an executive resume and vice
   versa. No AI and no user data is involved.
   ============================================================ */
import { getResumeFixture } from '../resumeFixtures.js';

export const TEMPLATE_PREVIEW_FIXTURE_VERSION = 'template-preview-fixtures-v1';

const clone = (value) => JSON.parse(JSON.stringify(value));

function categoryOf(template = {}) {
  const raw = String(template.category || '').toLowerCase();
  if (raw.includes('student') || raw.includes('fresher') || /campus|launch|internship|graduate/i.test(template.id || '')) return 'student';
  if (raw.includes('executive') || /executive|boardroom|director|leadership/i.test(template.id || '')) return 'executive';
  if (raw.includes('technical') || raw === 'tech' || /devops|cloud|platform|kernel|stack|circuit|tensor/i.test(template.id || '')) return 'technical';
  return 'professional';
}

export function previewFixtureIdForTemplate(template = {}) {
  switch (categoryOf(template)) {
    case 'student': return 'student-project-heavy';
    case 'executive': return 'senior-long';
    case 'technical': return 'devops-cloud';
    default: return 'devops-cloud';
  }
}

export function getTemplatePreviewStructured(template = {}) {
  return clone(getResumeFixture(previewFixtureIdForTemplate(template)).data);
}

const flattenSkills = (skills = {}) => Object.values(skills).flatMap((items) => Array.isArray(items) ? items : []);
const contactList = (p = {}) => [
  ['email', p.email], ['phone', p.phone], ['location', p.location], ['linkedin', p.linkedin],
  ['github', p.github], ['link', p.portfolio], ...(p.links || []).map((value) => ['link', value]),
].filter(([, value]) => value).map(([type, value]) => ({ type, value }));

/** Convert Resume OS structured data into the older ResumeTemplates gallery model. */
export function toLegacyEditorPreviewData(structured = {}) {
  const p = structured.personalInfo || {};
  const sections = [];
  const skills = flattenSkills(structured.skills);
  if (skills.length) sections.push({ kind: 'skills', title: 'Technical Skills', chips: skills, blocks: [], raw: [] });
  if ((structured.experience || []).length) sections.push({
    kind: 'experience', title: 'Experience', raw: [],
    blocks: structured.experience.map((e) => ({
      heading: e.role || e.company || 'Role',
      meta: [e.company, e.location, e.dates].filter(Boolean).join(' · '),
      bullets: [...(e.bullets || [])],
    })),
  });
  if ((structured.projects || []).length) sections.push({
    kind: 'projects', title: 'Projects', raw: [],
    blocks: structured.projects.map((project) => ({
      heading: project.name || 'Project',
      meta: [project.techStack || project.tech, project.link].filter(Boolean).join(' · '),
      bullets: [...(project.bullets || [])],
    })),
  });
  if ((structured.education || []).length) sections.push({
    kind: 'education', title: 'Education', raw: [],
    blocks: structured.education.map((e) => ({
      heading: e.school || e.degree || 'Education',
      meta: [e.degree, e.dates].filter(Boolean).join(' · '),
      bullets: Array.isArray(e.details) ? [...e.details] : [],
    })),
  });
  if ((structured.certifications || []).length) sections.push({
    kind: 'certifications', title: 'Certifications', raw: [],
    blocks: structured.certifications.map((value) => ({ heading: String(value), meta: '', bullets: [] })),
  });
  if ((structured.achievements || []).length) sections.push({
    kind: 'awards', title: 'Achievements', raw: [],
    blocks: structured.achievements.map((value) => ({ heading: String(value), meta: '', bullets: [] })),
  });
  return {
    name: p.name || 'Candidate Name',
    title: p.title || '',
    contacts: contactList(p),
    summary: structured.summary || '',
    sections,
  };
}

export default {
  TEMPLATE_PREVIEW_FIXTURE_VERSION,
  previewFixtureIdForTemplate,
  getTemplatePreviewStructured,
  toLegacyEditorPreviewData,
};
