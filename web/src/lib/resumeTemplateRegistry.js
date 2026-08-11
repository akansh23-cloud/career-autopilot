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

/* ============================================================
   RESUME OS V3 ORIGINAL TEMPLATE SET (12) — Career Autopilot
   originals; layout conventions only, no copied commercial
   designs, system/web-safe font stacks only. Every template is
   certified by the automated ATS render round-trip
   (templateCertification.js) — the badge is earned, not claimed.
   ============================================================ */
const V3 = { pageMode: 'auto', supportsOnePage: true, supportsMultiPage: true, previewType: 'structural', set: 'v3' };
const V3_SECTIONS = ['Header', 'Summary', 'Skills', 'Experience', 'Projects', 'Education', 'Certifications', 'Achievements'];
const ORDER_STD = ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements'];
const ORDER_STUDENT = ['summary', 'education', 'skills', 'projects', 'experience', 'certifications', 'achievements'];
const ORDER_EXEC = ['summary', 'experience', 'skills', 'projects', 'education', 'certifications', 'achievements'];

export const V3_TEMPLATES = [
  /* ---- ATS STRICT ---- */
  {
    ...V3, id: 'atlas', name: 'Atlas', category: 'ats-strict', strictAts: true, atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    bestFor: ['Any ATS portal', 'Default choice', 'Corporate applications'], badges: ['ATS Strict', 'Single-column'],
    description: 'The Career Autopilot default. Plain single column, standard headings, conventional dates — built to survive every parser first and look sharp second.',
    sections: V3_SECTIONS,
    theme: { font: '"Helvetica Neue", Helvetica, Arial, sans-serif', accent: '#1f2937', headerAlign: 'center', sectionStyle: 'caps', bulletChar: 'disc', density: 'compact', nameSize: 20, skillsStyle: 'grouped-lines', headerBand: false, sectionOrder: ORDER_STD },
  },
  {
    ...V3, id: 'oxford', name: 'Oxford', category: 'ats-strict', strictAts: true, atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    bestFor: ['Traditional industries', 'Finance', 'Government', 'Academia-adjacent'], badges: ['ATS Strict', 'Serif'],
    description: 'Conservative serif single column. Reads like a well-set legal brief — for banks, consultancies and anywhere tradition still screens resumes.',
    sections: V3_SECTIONS,
    theme: { font: '"Times New Roman", Times, serif', accent: '#111827', headerAlign: 'center', sectionStyle: 'caps', bulletChar: 'disc', density: 'comfortable', nameSize: 20, skillsStyle: 'grouped-lines', headerBand: false, sectionOrder: ORDER_STD },
  },
  {
    ...V3, id: 'mono', name: 'Mono', category: 'ats-strict', strictAts: true, atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    bestFor: ['Minimalists', 'Text-first portals', 'Plain-text conversions'], badges: ['ATS Strict', 'Zero decoration'],
    description: 'The most austere layout in the set: no rules, no accent colour, pure typographic hierarchy. Nothing exists that a parser could misread.',
    sections: V3_SECTIONS,
    theme: { font: 'Calibri, "Segoe UI", Arial, sans-serif', accent: '#111827', headerAlign: 'left', sectionStyle: 'plain', bulletChar: 'disc', density: 'compact', nameSize: 19, skillsStyle: 'inline-lines', headerBand: false, sectionOrder: ORDER_STD },
  },
  /* ---- PROFESSIONAL ---- */
  {
    ...V3, id: 'sterling', name: 'Sterling', category: 'professional', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    bestFor: ['Experienced professionals', 'Client-facing roles', 'Consulting'], badges: ['ATS-safe', 'Serif accent'],
    description: 'Georgia serif with a restrained navy rule under each heading. Polished without a single parser risk.',
    sections: V3_SECTIONS,
    theme: { font: 'Georgia, "Times New Roman", serif', accent: '#1e3a5f', headerAlign: 'left', sectionStyle: 'rule', bulletChar: 'disc', density: 'compact', nameSize: 21, skillsStyle: 'grouped-lines', headerBand: false, sectionOrder: ORDER_EXEC },
  },
  {
    ...V3, id: 'summit', name: 'Summit', category: 'professional', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    bestFor: ['Managers', 'Program / delivery roles', 'Operations'], badges: ['ATS-safe', 'Confident header'],
    description: 'Left-aligned confident name block, deep-green section bars, comfortable spacing — for profiles where breadth of ownership is the story.',
    sections: V3_SECTIONS,
    theme: { font: 'Calibri, "Segoe UI", Arial, sans-serif', accent: '#14532d', headerAlign: 'left', sectionStyle: 'bar', bulletChar: 'disc', density: 'comfortable', nameSize: 22, skillsStyle: 'grouped-lines', headerBand: false, sectionOrder: ORDER_EXEC },
  },
  {
    ...V3, id: 'ledger', name: 'Ledger', category: 'professional', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    bestFor: ['Finance', 'Analysts', 'Audit / risk'], badges: ['ATS-safe', 'Understated'],
    description: 'Thin hairline dividers and a muted oxblood accent — the quiet confidence of a well-kept ledger.',
    sections: V3_SECTIONS,
    theme: { font: '"Times New Roman", Times, serif', accent: '#7f1d1d', headerAlign: 'center', sectionStyle: 'thinline', bulletChar: 'disc', density: 'compact', nameSize: 20, skillsStyle: 'grouped-lines', headerBand: false, sectionOrder: ORDER_STD },
  },
  /* ---- TECH ---- */
  {
    ...V3, id: 'kernel', name: 'Kernel', category: 'tech', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    bestFor: ['SDE', 'Backend', 'Systems', 'DevOps'], badges: ['ATS-safe', 'Compact'],
    description: 'Dense, engineering-first single column in the compact tradition — maximum verified evidence per square inch, still fully parser-clean.',
    sections: V3_SECTIONS,
    theme: { font: '"Helvetica Neue", Helvetica, Arial, sans-serif', accent: '#334155', headerAlign: 'center', sectionStyle: 'rule', bulletChar: 'disc', density: 'compact', nameSize: 20, skillsStyle: 'grouped-lines', headerBand: false, sectionOrder: ORDER_STD },
  },
  {
    ...V3, id: 'stack', name: 'Stack', category: 'tech', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    bestFor: ['Full-stack', 'Product engineering', 'Startups'], badges: ['ATS-safe', 'Modern'],
    description: 'Contemporary indigo bars and a left-aligned header — modern product-company energy without a single layout risk.',
    sections: V3_SECTIONS,
    theme: { font: 'Calibri, "Segoe UI", Arial, sans-serif', accent: '#4338ca', headerAlign: 'left', sectionStyle: 'bar', bulletChar: 'disc', density: 'compact', nameSize: 22, skillsStyle: 'grouped-lines', headerBand: false, sectionOrder: ORDER_STD },
  },
  {
    ...V3, id: 'circuit', name: 'Circuit', category: 'tech', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    bestFor: ['Data engineering', 'Cloud', 'Platform'], badges: ['ATS-safe', 'Grouped skills'],
    description: 'Teal hairlines and grouped skill lines tuned for infra/data profiles where the stack itself is the headline.',
    sections: V3_SECTIONS,
    theme: { font: 'Arial, Helvetica, sans-serif', accent: '#0f766e', headerAlign: 'left', sectionStyle: 'thinline', bulletChar: 'disc', density: 'compact', nameSize: 21, skillsStyle: 'grouped-lines', headerBand: false, sectionOrder: ORDER_STD },
  },
  /* ---- STUDENT ---- */
  {
    ...V3, id: 'launch', name: 'Launch', category: 'student', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    bestFor: ['Freshers', 'Internships', 'Campus placement'], badges: ['ATS-safe', 'Project-first'],
    description: 'Education and projects lead — the order campus recruiters actually read. Verified projects belong here.',
    sections: ['Header', 'Summary', 'Education', 'Skills', 'Projects', 'Experience', 'Certifications', 'Achievements'],
    theme: { font: 'Calibri, "Segoe UI", Arial, sans-serif', accent: '#1d4ed8', headerAlign: 'center', sectionStyle: 'bar', bulletChar: 'disc', density: 'compact', nameSize: 21, skillsStyle: 'grouped-lines', headerBand: false, sectionOrder: ORDER_STUDENT },
  },
  {
    ...V3, id: 'campus', name: 'Campus', category: 'student', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    bestFor: ['First resume', 'Off-campus drives', 'Conservative recruiters'], badges: ['ATS-safe', 'Classic'],
    description: 'The classic first resume: centered header, capital headings, education up top. Zero surprises for any screening system.',
    sections: ['Header', 'Summary', 'Education', 'Skills', 'Projects', 'Experience', 'Certifications', 'Achievements'],
    theme: { font: 'Arial, Helvetica, sans-serif', accent: '#111827', headerAlign: 'center', sectionStyle: 'caps', bulletChar: 'disc', density: 'comfortable', nameSize: 20, skillsStyle: 'grouped-lines', headerBand: false, sectionOrder: ORDER_STUDENT },
  },
  /* ---- EXECUTIVE ---- */
  {
    ...V3, id: 'boardroom', name: 'Boardroom', category: 'executive', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    bestFor: ['Directors', 'Heads of function', 'Senior leadership'], badges: ['ATS-safe', 'Leadership-first'],
    description: 'Serif authority with a charcoal name band and impact-led ordering. The band is plain text on a background — parsers read straight through it.',
    sections: ['Header', 'Summary', 'Experience', 'Skills', 'Education', 'Achievements', 'Certifications'],
    theme: { font: 'Georgia, "Times New Roman", serif', accent: '#374151', headerAlign: 'left', sectionStyle: 'rule', bulletChar: 'disc', density: 'comfortable', nameSize: 23, skillsStyle: 'grouped-lines', headerBand: true, bandBg: '#1f2430', bandText: '#ffffff', sectionOrder: ORDER_EXEC, experienceTitle: 'Leadership Experience' },
  },
];
RESUME_TEMPLATES.push(...V3_TEMPLATES);

/* ============================================================
   V4 TEMPLATE PLATFORM ADDITIONS
   ------------------------------------------------------------
   • Eight new original designs covering role families the V3 set
     missed (security, data science/ML, consulting/finance, PM,
     graduate/internship, engineering management, director).
   • License metadata on EVERY template. Legal state is data, not
     code: flipping LICENSE_PENDING → LICENSED and
     productionEnabled → true requires a config change only.
     All shipped designs are INTERNAL_ORIGINAL and enabled.
   • Descriptor fields consumed by the deterministic template
     recommender: supportedRoles, careerStages, atsLevel.
   ============================================================ */
export const LICENSE_STATES = Object.freeze(['INTERNAL_ORIGINAL', 'OWNED', 'OPEN_SOURCE', 'LICENSED', 'LICENSE_PENDING', 'DEVELOPMENT_REFERENCE']);
const INTERNAL_LICENSE = Object.freeze({ licenseStatus: 'INTERNAL_ORIGINAL', source: 'Career Autopilot design team', licenseName: '', licenseNotice: '', productionEnabled: true });

const V4 = { ...V3, set: 'v4' };
export const V4_TEMPLATES = [
  {
    ...V4, id: 'sentinel', name: 'Sentinel', category: 'tech', atsSafe: true, layoutType: 'single-column', riskLevel: 'low', strictAts: false,
    supportedRoles: ['security', 'cyber', 'devops', 'sre'], careerStages: ['professional', 'senior'], atsLevel: 'very-high',
    bestFor: ['Security engineers', 'SOC / AppSec', 'Compliance-heavy shops'], badges: ['ATS-safe', 'Certification-forward'],
    description: 'Security-engineering layout: certifications ride directly under skills, dark slate rules, zero parser risk.',
    sections: V3_SECTIONS,
    theme: { font: 'Calibri, "Segoe UI", Arial, sans-serif', accent: '#0f172a', headerAlign: 'left', sectionStyle: 'rule', bulletChar: 'disc', density: 'compact', nameSize: 20, skillsStyle: 'grouped-lines', headerBand: false, sectionOrder: ['summary', 'skills', 'certifications', 'experience', 'projects', 'education', 'achievements'] },
  },
  {
    ...V4, id: 'tensor', name: 'Tensor', category: 'tech', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    supportedRoles: ['data scientist', 'ml', 'machine learning', 'ai'], careerStages: ['professional', 'senior'], atsLevel: 'high',
    bestFor: ['Data scientists', 'ML engineers', 'Research-adjacent roles'], badges: ['ATS-safe', 'Publications-ready'],
    description: 'DS/ML layout with a deep-teal accent; projects sit above experience so models and papers lead.',
    sections: V3_SECTIONS,
    theme: { font: '"Helvetica Neue", Helvetica, Arial, sans-serif', accent: '#0f766e', headerAlign: 'left', sectionStyle: 'rule', bulletChar: 'disc', density: 'compact', nameSize: 20, skillsStyle: 'grouped-lines', headerBand: false, sectionOrder: ['summary', 'skills', 'projects', 'experience', 'education', 'certifications', 'achievements'] },
  },
  {
    ...V4, id: 'meridian', name: 'Meridian', category: 'professional', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    supportedRoles: ['consultant', 'consulting', 'finance', 'analyst'], careerStages: ['professional', 'senior'], atsLevel: 'high',
    bestFor: ['Consulting', 'Finance', 'Strategy'], badges: ['ATS-safe', 'Serif'],
    description: 'Consulting/finance serif with hairline burgundy rules — the quiet confidence of a well-set engagement letter.',
    sections: V3_SECTIONS,
    theme: { font: 'Georgia, "Times New Roman", serif', accent: '#7f1d1d', headerAlign: 'center', sectionStyle: 'rule', bulletChar: 'disc', density: 'comfortable', nameSize: 21, skillsStyle: 'inline-lines', headerBand: false, sectionOrder: ORDER_EXEC },
  },
  {
    ...V4, id: 'compass', name: 'Compass', category: 'professional', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    supportedRoles: ['product manager', 'product', 'program manager'], careerStages: ['professional', 'senior'], atsLevel: 'high',
    bestFor: ['Product managers', 'Program managers'], badges: ['ATS-safe', 'Outcome-forward'],
    description: 'PM layout: summary and impact-heavy experience first, skills demoted, indigo hairlines.',
    sections: V3_SECTIONS,
    theme: { font: '"Helvetica Neue", Helvetica, Arial, sans-serif', accent: '#4338ca', headerAlign: 'left', sectionStyle: 'rule', bulletChar: 'disc', density: 'compact', nameSize: 20, skillsStyle: 'inline-lines', headerBand: false, sectionOrder: ['summary', 'experience', 'projects', 'skills', 'education', 'certifications', 'achievements'] },
  },
  {
    ...V4, id: 'gradient', name: 'Graduate', category: 'student', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    supportedRoles: ['graduate', 'intern', 'fresher'], careerStages: ['student'], atsLevel: 'very-high',
    bestFor: ['Final-year students', 'First job applications'], badges: ['ATS Strict', 'Education-first'], strictAts: true,
    description: 'Graduate hiring layout: education on top, projects immediately after, formal and utterly parser-safe.',
    sections: V3_SECTIONS,
    theme: { font: 'Calibri, "Segoe UI", Arial, sans-serif', accent: '#1e3a5f', headerAlign: 'center', sectionStyle: 'caps', bulletChar: 'disc', density: 'compact', nameSize: 20, skillsStyle: 'grouped-lines', headerBand: false, sectionOrder: ['education', 'summary', 'projects', 'skills', 'experience', 'certifications', 'achievements'] },
  },
  {
    ...V4, id: 'internship', name: 'Internship Sprint', category: 'student', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    supportedRoles: ['intern', 'internship', 'trainee'], careerStages: ['student'], atsLevel: 'high',
    bestFor: ['Internship applications', 'Semester placements'], badges: ['ATS-safe', 'Compact'],
    description: 'Tight one-pager for internship season: coursework-friendly education block, project bullets front and centre.',
    sections: V3_SECTIONS,
    contentBudget: { projects: { preferredCount: 4, maxCount: 5, preferredBullets: 2, maxBullets: 3 } },
    theme: { font: '"Helvetica Neue", Helvetica, Arial, sans-serif', accent: '#0e7490', headerAlign: 'left', sectionStyle: 'rule', bulletChar: 'disc', density: 'tight', nameSize: 19, skillsStyle: 'inline-lines', headerBand: false, sectionOrder: ['education', 'projects', 'skills', 'summary', 'experience', 'certifications', 'achievements'] },
  },
  {
    ...V4, id: 'foreman', name: 'Foreman', category: 'executive', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    supportedRoles: ['engineering manager', 'manager', 'lead'], careerStages: ['senior'], atsLevel: 'high',
    bestFor: ['Engineering managers', 'Tech leads moving up'], badges: ['ATS-safe', 'Leadership + hands-on'],
    description: 'EM layout balancing leadership scope with retained technical depth — team outcomes lead, stack stays visible.',
    sections: V3_SECTIONS,
    theme: { font: 'Georgia, "Times New Roman", serif', accent: '#334155', headerAlign: 'left', sectionStyle: 'rule', bulletChar: 'disc', density: 'compact', nameSize: 21, skillsStyle: 'inline-lines', headerBand: false, experienceTitle: 'Leadership & Engineering Experience', sectionOrder: ORDER_EXEC },
  },
  {
    ...V4, id: 'directorate', name: 'Directorate', category: 'executive', atsSafe: true, layoutType: 'single-column', riskLevel: 'low',
    supportedRoles: ['director', 'vp', 'head'], careerStages: ['senior'], atsLevel: 'balanced',
    bestFor: ['Directors', 'VPs', 'Heads of function'], badges: ['ATS-safe', 'Impact-first'],
    description: 'Director-level presentation: a wider executive summary, impact-led experience, education reduced to a single line each.',
    sections: V3_SECTIONS,
    contentBudget: { summary: { preferredLines: 4, maxLines: 5 }, skills: { preferredCount: 10, maxCount: 14 } },
    theme: { font: 'Georgia, "Times New Roman", serif', accent: '#1f2430', headerAlign: 'center', sectionStyle: 'thinline', bulletChar: 'disc', density: 'comfortable', nameSize: 22, skillsStyle: 'inline-lines', headerBand: true, experienceTitle: 'Leadership Experience', sectionOrder: ORDER_EXEC },
  },
];
RESUME_TEMPLATES.push(...V4_TEMPLATES);

/* ============================================================
   TEMPLATE OS (V5) — DSL-compiled premium layouts
   These cards are PROJECTIONS of TemplateDefinitions; rendering
   goes through the Template OS layout compiler, not the legacy
   theme renderer (previewType 'template-os' keeps them out of
   the legacy certification path). Their ATS level is measured
   at certification time by the Template OS pipeline.
   ============================================================ */
import { TEMPLATE_OS_BUILTINS, BUILTIN_CERTIFICATION } from './templateOs/builtins.js';
import { toRegistryCard } from './templateOs/adapter.js';
import { getRuntimeTemplateCard, mergeTemplateCatalog } from './runtimeTemplateCatalog.js';
export const TEMPLATE_OS_CARDS = TEMPLATE_OS_BUILTINS.map((d) => toRegistryCard(d, BUILTIN_CERTIFICATION[d.id] || null));
RESUME_TEMPLATES.push(...TEMPLATE_OS_CARDS);

/* License metadata for every template. All current designs are original
   Career Autopilot work; the fields exist so externally sourced templates can
   ship as LICENSE_PENDING / DEVELOPMENT_REFERENCE with productionEnabled=false
   until rights are cleared — enabling them is a data flip, not a rewrite. */
for (const t of RESUME_TEMPLATES) {
  if (!t.license) t.license = { ...INTERNAL_LICENSE };
}

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

export function getResumeTemplateCatalog() {
  return mergeTemplateCatalog(RESUME_TEMPLATES);
}

export function templateVersionOf(tpl) {
  const n = Number(tpl?.templateVersion || tpl?.definition?.version || 1);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function getResumeTemplate(idOrName, templateVersion = null, { strictVersion = false } = {}) {
  if (!idOrName) return RESUME_TEMPLATES[0];
  const requested = Number.isInteger(Number(templateVersion)) && Number(templateVersion) > 0 ? Number(templateVersion) : null;
  if (_customTemplate && (idOrName === 'custom' || idOrName === _customTemplate.id || idOrName === _customTemplate.name)) {
    if (!requested || templateVersionOf(_customTemplate) === requested) return _customTemplate;
    return strictVersion ? null : _customTemplate;
  }
  const runtime = getRuntimeTemplateCard(idOrName, requested);
  if (runtime) return runtime;
  const direct = RESUME_TEMPLATES.find((t) => t.id === idOrName || t.name === idOrName);
  if (direct && (!requested || templateVersionOf(direct) === requested)) return direct;
  if (requested && strictVersion) return null;
  if (direct) return direct;
  const mapped = LEGACY_TEMPLATE_MAP[idOrName];
  if (mapped) {
    const mappedTpl = RESUME_TEMPLATES.find((t) => t.id === mapped) || RESUME_TEMPLATES[0];
    if (!requested || templateVersionOf(mappedTpl) === requested || !strictVersion) return mappedTpl;
    return null;
  }
  return strictVersion ? null : RESUME_TEMPLATES[0];
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
