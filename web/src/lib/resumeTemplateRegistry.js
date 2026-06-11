/* ============================================================================
   resumeTemplateRegistry.js — central registry for Resume OS templates
   ----------------------------------------------------------------------------
   PRODUCT RULE: template cards never carry fake ATS numbers. Templates are
   described with honest capability labels (atsSafe, layoutType, bestFor,
   riskLevel) — a real resume score is computed from actual resume content by
   the deterministic backend scoring engine, completely separately.

   Every entry:
   {
     id, name, category, bestFor[], badges[], atsSafe, layoutType, pageMode,
     supportsOnePage, supportsMultiPage, riskLevel, description, sections[],
     previewType, theme: { font, accent, headerAlign, sectionStyle, bulletChar,
                           density, nameSize, skillsStyle, headerBand, sectionOrder }
   }
   ========================================================================== */

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const CALIBRI = 'Calibri, "Segoe UI", Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

export const STANDARD_SECTIONS = ['Summary', 'Technical Skills', 'Experience', 'Projects', 'Education', 'Certifications', 'Achievements'];

export const RESUME_TEMPLATES = [
  {
    id: 'jake-ats-classic',
    name: 'Jake ATS Classic',
    category: 'ats',
    bestFor: ['SDE', 'Backend', 'DevOps', 'Cloud', 'AI Engineer', 'Fresher', 'Job switchers'],
    badges: ['ATS-safe', 'Single-column', 'Compact'],
    atsSafe: true,
    layoutType: 'single-column',
    pageMode: 'auto',
    supportsOnePage: true,
    supportsMultiPage: true,
    riskLevel: 'low',
    description: 'Inspired by Jake’s Resume — single-column, compact, LaTeX-like structure with thin rules. The default for engineering applications.',
    sections: ['Header', 'Summary', 'Technical Skills', 'Experience', 'Projects', 'Education', 'Certifications', 'Achievements'],
    previewType: 'structural',
    theme: {
      font: SANS, accent: '#0f172a', headerAlign: 'center', sectionStyle: 'rule',
      bulletChar: 'disc', density: 'compact', nameSize: 21, skillsStyle: 'grouped-lines', headerBand: false,
      sectionOrder: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements'],
    },
  },
  {
    id: 'clean-ats-pro',
    name: 'Clean ATS Professional',
    category: 'ats',
    bestFor: ['Most corporate roles', 'Analysts', 'Consultants', 'Portal submissions'],
    badges: ['ATS-safe', 'Single-column', 'Recruiter-friendly'],
    atsSafe: true,
    layoutType: 'single-column',
    pageMode: 'auto',
    supportsOnePage: true,
    supportsMultiPage: true,
    riskLevel: 'low',
    description: 'Single-column, slightly more spacious than Jake. No icons, no tables, no complex layout — the safest choice for any corporate ATS portal.',
    sections: ['Header', 'Summary', 'Technical Skills', 'Experience', 'Projects', 'Education', 'Certifications'],
    previewType: 'structural',
    theme: {
      font: '"Times New Roman", Times, serif', accent: '#111827', headerAlign: 'center', sectionStyle: 'caps',
      bulletChar: 'disc', density: 'comfortable', nameSize: 20, skillsStyle: 'grouped-lines', headerBand: false,
      sectionOrder: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements'],
    },
  },
  {
    id: 'modern-pro',
    name: 'Modern Professional',
    category: 'ats',
    bestFor: ['Startups', 'Product companies', 'Full-stack developers', 'Analysts'],
    badges: ['ATS-friendly', 'Single-column', 'Subtle styling'],
    atsSafe: true,
    layoutType: 'single-column',
    pageMode: 'auto',
    supportsOnePage: true,
    supportsMultiPage: true,
    riskLevel: 'low',
    description: 'Single-column with subtle accent dividers and a confident name block. Contemporary, still parser-friendly.',
    sections: ['Header', 'Summary', 'Technical Skills', 'Experience', 'Projects', 'Education', 'Certifications'],
    previewType: 'structural',
    theme: {
      font: CALIBRI, accent: '#4338ca', headerAlign: 'left', sectionStyle: 'bar',
      bulletChar: 'disc', density: 'compact', nameSize: 22, skillsStyle: 'grouped-lines', headerBand: false,
      sectionOrder: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements'],
    },
  },
  {
    id: 'cloud-devops',
    name: 'Cloud / DevOps Engineer',
    category: 'ats',
    bestFor: ['Cloud', 'DevOps', 'SRE', 'Platform', 'Infrastructure'],
    badges: ['ATS-safe', 'Single-column', 'Best for Cloud/DevOps'],
    atsSafe: true,
    layoutType: 'single-column',
    pageMode: 'auto',
    supportsOnePage: true,
    supportsMultiPage: true,
    riskLevel: 'low',
    description: 'Optimised for cloud, CI/CD, Kubernetes, Terraform and monitoring roles. Skills are grouped into Cloud · Containers · CI/CD · IaC · Monitoring · Scripting · Databases · Security and promoted above experience.',
    sections: ['Header', 'Summary', 'Technical Skills (grouped)', 'Experience', 'Projects', 'Education', 'Certifications'],
    previewType: 'structural',
    theme: {
      font: SANS, accent: '#0369a1', headerAlign: 'left', sectionStyle: 'rule',
      bulletChar: 'disc', density: 'compact', nameSize: 21, skillsStyle: 'devops-groups', headerBand: false,
      sectionOrder: ['summary', 'skills', 'experience', 'projects', 'certifications', 'education', 'achievements'],
    },
  },
  {
    id: 'senior-engineer',
    name: 'Senior Engineer / Architect',
    category: 'ats',
    bestFor: ['Senior Engineer', '5+ years', 'Staff', 'Architect', 'Tech Lead'],
    badges: ['ATS-safe', 'Two-page friendly', 'Best for Senior Engineer'],
    atsSafe: true,
    layoutType: 'single-column',
    pageMode: 'multi',
    supportsOnePage: false,
    supportsMultiPage: true,
    riskLevel: 'low',
    description: 'Two-page friendly layout for senior roles: room for architecture highlights, system design, leadership impact, mentoring, release ownership and business outcomes.',
    sections: ['Header', 'Summary', 'Architecture & Leadership Highlights', 'Experience', 'Technical Skills', 'Projects', 'Education', 'Certifications'],
    previewType: 'structural',
    theme: {
      font: SANS, accent: '#1e3a5f', headerAlign: 'left', sectionStyle: 'bar',
      bulletChar: 'disc', density: 'comfortable', nameSize: 22, skillsStyle: 'grouped-lines', headerBand: false,
      sectionOrder: ['summary', 'achievements', 'experience', 'skills', 'projects', 'education', 'certifications'],
      achievementsTitle: 'Architecture & Leadership Highlights',
    },
  },
  {
    id: 'fresher-project-first',
    name: 'Fresher / Student Project-First',
    category: 'ats',
    bestFor: ['Students', 'Freshers', 'Interns', '0–2 yrs'],
    badges: ['ATS-safe', 'Single-column', 'Best for Fresher'],
    atsSafe: true,
    layoutType: 'single-column',
    pageMode: 'one-page',
    supportsOnePage: true,
    supportsMultiPage: true,
    riskLevel: 'low',
    description: 'Project-first layout for students and freshers: Education → Skills → Projects → Internships → Certifications → Achievements → Hackathons.',
    sections: ['Header', 'Education', 'Technical Skills', 'Projects', 'Internships', 'Certifications', 'Achievements'],
    previewType: 'structural',
    theme: {
      font: CALIBRI, accent: '#6d28d9', headerAlign: 'center', sectionStyle: 'bar',
      bulletChar: 'disc', density: 'compact', nameSize: 21, skillsStyle: 'grouped-lines', headerBand: false,
      sectionOrder: ['summary', 'education', 'skills', 'projects', 'experience', 'certifications', 'achievements'],
      experienceTitle: 'Internships & Experience',
    },
  },
  {
    id: 'executive-leadership',
    name: 'Executive / Leadership',
    category: 'leadership',
    bestFor: ['Senior managers', 'Leads', 'Architects', 'Directors'],
    badges: ['ATS-safe', 'Two-page friendly', 'Best for Leadership'],
    atsSafe: true,
    layoutType: 'single-column',
    pageMode: 'multi',
    supportsOnePage: false,
    supportsMultiPage: true,
    riskLevel: 'low',
    description: 'For senior managers, leads and architects: leads with summary, leadership impact, business outcomes and strategic achievements. Not a default for students.',
    sections: ['Header', 'Summary', 'Leadership Impact', 'Experience', 'Technical Skills', 'Education', 'Certifications'],
    previewType: 'structural',
    theme: {
      font: SERIF, accent: '#92400e', headerAlign: 'left', sectionStyle: 'band',
      bulletChar: 'disc', density: 'comfortable', nameSize: 23, skillsStyle: 'inline-lines', headerBand: true,
      bandBg: '#1c2433', bandText: '#ffffff',
      sectionOrder: ['summary', 'achievements', 'experience', 'skills', 'education', 'certifications', 'projects'],
      achievementsTitle: 'Leadership Impact & Strategic Achievements',
    },
  },
  {
    id: 'visual-creative',
    name: 'Visual Designer / Creative',
    category: 'visual',
    bestFor: ['Designers', 'Creative roles', 'Portfolios'],
    badges: ['Visual, not ATS-first', 'Single-column'],
    atsSafe: false,
    layoutType: 'single-column',
    pageMode: 'auto',
    supportsOnePage: true,
    supportsMultiPage: true,
    riskLevel: 'visual',
    description: 'A visual template with colour accents and skill chips. Clearly marked “Visual, not ATS-first” — do not use it as the default for technical job portals. Content still never overlaps or crops.',
    sections: ['Header', 'Summary', 'Skills', 'Experience', 'Projects', 'Education', 'Achievements'],
    previewType: 'structural',
    theme: {
      font: CALIBRI, accent: '#0e7490', headerAlign: 'left', sectionStyle: 'band',
      bulletChar: 'disc', density: 'comfortable', nameSize: 24, skillsStyle: 'chips', headerBand: true,
      bandBg: '#134e4a', bandText: '#ffffff',
      sectionOrder: ['summary', 'skills', 'experience', 'projects', 'education', 'achievements', 'certifications'],
    },
  },
];

/* Broken legacy templates that are intentionally REMOVED (not just hidden):
   - 'two-col-tech'  — sidebar two-column collapsed in preview/export and
                       confused ATS parsers. Mapped to Jake ATS Classic.
   - 'dark-exec'     — replaced by Executive / Leadership.
   - 'minimal-ats'   — replaced by Clean ATS Professional.
   - 'multipage'     — replaced by Senior Engineer / Architect.            */
export const LEGACY_TEMPLATE_MAP = {
  'jake-ats': 'jake-ats-classic', 'Jake ATS Compact': 'jake-ats-classic',
  'jake-tech': 'jake-ats-classic', 'Jake Tech Compact': 'jake-ats-classic',
  'minimal-ats': 'clean-ats-pro', 'Minimal ATS': 'clean-ats-pro', 'ATS Minimal One Page': 'clean-ats-pro', 'ats-minimal': 'clean-ats-pro', 'ATS Detailed': 'clean-ats-pro',
  'modern-pro': 'modern-pro', 'Modern Professional': 'modern-pro', 'product-analyst': 'modern-pro', 'Product Analyst Clean': 'modern-pro',
  'dark-exec': 'executive-leadership', 'Dark Header Executive': 'executive-leadership', 'modern-dark': 'executive-leadership', 'Modern Dark Header': 'executive-leadership', 'executive': 'executive-leadership', 'Executive Clean': 'executive-leadership',
  'two-col-tech': 'jake-ats-classic', 'Two Column Technical': 'jake-ats-classic', 'Technical Detailed': 'jake-ats-classic',
  'cloud-devops': 'cloud-devops', 'Cloud/DevOps Engineer': 'cloud-devops', 'cloud-pro': 'cloud-devops', 'Cloud Engineer Pro': 'cloud-devops',
  'fresher': 'fresher-project-first', 'Fresher Project Focus': 'fresher-project-first', 'Project Heavy Detailed': 'fresher-project-first',
  'multipage': 'senior-engineer', 'Multi Page Detailed': 'senior-engineer', 'two-page': 'senior-engineer', 'Two Page Detailed': 'senior-engineer',
};

/* transient custom template (built from an uploaded template image/PDF) */
let _customTemplate = null;
export function setCustomResumeTemplate(tpl) { _customTemplate = tpl; }
export function getCustomResumeTemplate() { return _customTemplate; }

export function getResumeTemplate(idOrName) {
  if (!idOrName) return RESUME_TEMPLATES[0];
  if (_customTemplate && (idOrName === 'custom' || idOrName === _customTemplate.id || idOrName === _customTemplate.name)) return _customTemplate;
  const direct = RESUME_TEMPLATES.find((t) => t.id === idOrName || t.name === idOrName);
  if (direct) return direct;
  const mapped = LEGACY_TEMPLATE_MAP[idOrName];
  if (mapped) return RESUME_TEMPLATES.find((t) => t.id === mapped) || RESUME_TEMPLATES[0];
  return RESUME_TEMPLATES[0];
}

/* JD / role -> template recommendation with reasons (no fake numbers). */
export function recommendResumeTemplate(role = '', jobDescription = '') {
  const text = `${role} ${jobDescription}`.toLowerCase();
  const pick = (id, reason) => ({ template: getResumeTemplate(id), templateId: id, reason });
  if (/devops|sre|site.reliability|platform|infrastructure|cloud engineer|aws|azure|gcp|kubernetes|terraform/.test(text)) {
    return pick('cloud-devops', 'Role mentions cloud/DevOps tooling — grouped skills (Cloud, CI/CD, IaC, Monitoring) read fastest for these recruiters.');
  }
  if (/intern|fresher|student|entry.level|graduate|campus|junior/.test(text)) {
    return pick('fresher-project-first', 'Early-career roles are evaluated on education and projects first — this layout leads with them.');
  }
  if (/director|head of|vp |vice president|chief|cto|engineering manager|senior manager|leadership/.test(text)) {
    return pick('executive-leadership', 'Leadership roles are screened on impact and outcomes — this template leads with leadership impact.');
  }
  if (/principal|staff|architect|senior|lead\b|10\+|8\+|tech lead/.test(text)) {
    return pick('senior-engineer', 'Senior roles need room for architecture, system design and mentoring — two-page friendly.');
  }
  if (/designer|ux|ui designer|creative|illustrator|brand/.test(text)) {
    return pick('visual-creative', 'Creative roles tolerate visual templates — but submit the ATS-safe version to portals.');
  }
  if (/analyst|product manager|marketing|sales|finance|hr|operations|consultant/.test(text)) {
    return pick('modern-pro', 'Corporate/product roles — clean modern single-column reads well and stays ATS-friendly.');
  }
  if (/backend|frontend|full.stack|software|developer|engineer|sde|swe|data|machine.learning|ml|ai/.test(text)) {
    return pick('jake-ats-classic', 'Engineering roles — the compact Jake-style single column is the proven recruiter-portal default.');
  }
  return pick('clean-ats-pro', 'No strong role signal — the safest universal ATS layout.');
}

/* Legacy alias kept for old call sites: returns just the template id. */
export function recommendTemplateId(role = '') {
  return recommendResumeTemplate(role).templateId;
}

/* ATS-safe rule checklist a template must satisfy to carry atsSafe: true.
   Used by tests and the Template Lab — kept in code so it can't drift. */
export const ATS_SAFE_RULES = [
  'single-column flow (no sidebar columns)',
  'no text inside images',
  'no icons required to read contact info',
  'no progress bars, skill meters or charts',
  'no decorative sidebars',
  'no hidden text',
  'no absolute-positioned overlapping blocks',
  'simple headings with standard section names',
  'normal selectable text',
];

export function isTemplateAtsSafe(tpl) {
  if (!tpl) return false;
  return !!tpl.atsSafe && tpl.layoutType === 'single-column' && tpl.theme?.skillsStyle !== 'chips';
}
