/* ============================================================================
   resumeTemplates.js  —  single source of truth for the resume template system
   ----------------------------------------------------------------------------
   • parseResume(text)            -> structured resume data
   • TEMPLATES                    -> gallery metadata (name, ATS, pages, layout)
   • getTemplate(idOrName)        -> tolerant lookup (id, name, or legacy name)
   • renderResumeHTML(data, id, { mode })  -> a full, self-contained A4 HTML doc
   • exportResumePDF(...)         -> clean PDF (html2canvas + jsPDF, NO browser
                                     headers/footers, A4, smart page breaks)
   • exportResumeDOCX(...)        -> Word-openable document that keeps the layout
   • buildCustomTemplateStyle(spec)-> turn an analysed/selected style into a theme
   Every template produces a *visibly different* layout — different fonts, accent
   colours, header treatment and column structure — not just a different name.
   ========================================================================== */

/* ----------------------------------------------------------------------------
   1. PARSER  —  plain-text resume  ->  { name, title, contacts[], summary,
                                          sections:[{ title, kind, blocks[] }] }
   -------------------------------------------------------------------------- */

const SECTION_SYNONYMS = [
  { kind: 'summary', re: /^(professional\s+summary|summary|profile|objective|about(\s+me)?|career\s+objective)$/i },
  { kind: 'experience', re: /^(experience|work\s+experience|professional\s+experience|employment(\s+history)?|work\s+history)$/i },
  { kind: 'skills', re: /^(skills|technical\s+skills|core\s+competencies|technologies|tech\s+stack|skills\s*&?\s*tools|expertise)$/i },
  { kind: 'education', re: /^(education|academic(\s+background)?|qualifications)$/i },
  { kind: 'projects', re: /^(projects|key\s+projects|personal\s+projects|academic\s+projects|notable\s+projects)$/i },
  { kind: 'certifications', re: /^(certifications?|licenses?|certifications?\s*&?\s*licenses?|credentials)$/i },
  { kind: 'awards', re: /^(awards?|honou?rs?|achievements?|accomplishments?)$/i },
  { kind: 'publications', re: /^(publications?|research|papers)$/i },
  { kind: 'languages', re: /^(languages?)$/i },
  { kind: 'volunteer', re: /^(volunteer(\s+work)?|community|extracurricular)$/i },
  { kind: 'interests', re: /^(interests?|hobbies)$/i },
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const URL_RE = /((https?:\/\/)?(www\.)?(linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com|medium\.com)\/[^\s|,]+)/i;
const GENERIC_URL_RE = /((https?:\/\/)[^\s|,]+|[a-z0-9-]+\.(com|io|dev|me|net|org)\/[^\s|,]+)/i;

function classifyHeading(line) {
  const t = line.trim().replace(/[:]+$/, '');
  if (!t) return null;
  for (const s of SECTION_SYNONYMS) if (s.re.test(t)) return { kind: s.kind, title: t };
  // ALL-CAPS heading (e.g. "WORK EXPERIENCE") up to ~40 chars, at least 3 chars
  if (/^[A-Z][A-Z0-9\s&/().,'+-]{1,40}$/.test(t) && t.length >= 3 && /[A-Z]{2,}/.test(t)) {
    const lower = t.toLowerCase();
    for (const s of SECTION_SYNONYMS) if (s.re.test(lower)) return { kind: s.kind, title: t };
    return { kind: 'custom', title: t };
  }
  return null;
}

function splitContacts(line) {
  // split a contact line on common separators
  return line
    .split(/\s*[|•·●▪]\s*|\s{2,}|\s+[–—-]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function contactType(piece) {
  if (EMAIL_RE.test(piece)) return 'email';
  if (URL_RE.test(piece)) return /github/i.test(piece) ? 'github' : 'link';
  if (GENERIC_URL_RE.test(piece)) return 'link';
  if (PHONE_RE.test(piece) && piece.replace(/\D/g, '').length >= 8) return 'phone';
  return 'location';
}

function looksLikeContactLine(line) {
  return EMAIL_RE.test(line) || URL_RE.test(line) || (PHONE_RE.test(line) && line.replace(/\D/g, '').length >= 8) || /\s[|•·]\s/.test(line);
}

function isBullet(line) {
  return /^\s*[•·●▪◦*\u2022\-–—]\s+/.test(line);
}
function stripBullet(line) {
  return line.replace(/^\s*[•·●▪◦*\u2022\-–—]\s+/, '').trim();
}
function looksLikeJobHeading(line) {
  // "Role | Company | 2020 - Present"  or contains a year / date range
  return /\s[|]\s/.test(line) || /\b(19|20)\d{2}\b/.test(line) || /\s[–—-]\s/.test(line);
}

export function parseResume(text = '') {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw.split('\n');
  const data = { name: '', title: '', contacts: [], summary: '', sections: [] };

  // find first non-empty line = name
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length) { data.name = lines[i].trim(); i++; }

  // optional title line (not a contact line, not a section, short)
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length) {
    const t = lines[i].trim();
    if (t && !classifyHeading(t) && !looksLikeContactLine(t) && t.length <= 60) {
      data.title = t; i++;
    }
  }

  // gather contact pieces from the next few lines (before first section)
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

  // walk remaining lines into sections
  let current = null;
  let freeSummary = [];
  const pushBlockLine = (line) => {
    if (!current) {
      // pre-section text => summary
      freeSummary.push(line.trim());
      return;
    }
    if (current.kind === 'skills') {
      current.raw.push(line.trim());
      return;
    }
    if (isBullet(line)) {
      const last = current.blocks[current.blocks.length - 1];
      if (last) last.bullets.push(stripBullet(line));
      else current.blocks.push({ heading: '', meta: '', bullets: [stripBullet(line)] });
    } else if (looksLikeJobHeading(line) || !current.blocks.length) {
      // new entry heading; try to split "Role | Company | Dates"
      const parts = line.split(/\s*[|]\s*/).map((s) => s.trim()).filter(Boolean);
      current.blocks.push({
        heading: parts[0] || line.trim(),
        meta: parts.slice(1).join('  ·  '),
        bullets: [],
      });
    } else {
      // continuation line of previous heading / plain paragraph
      const last = current.blocks[current.blocks.length - 1];
      if (last && !last.bullets.length) last.meta = [last.meta, line.trim()].filter(Boolean).join('  ·  ');
      else current.blocks.push({ heading: '', meta: line.trim(), bullets: [] });
    }
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) continue;
    const heading = classifyHeading(t);
    if (heading) {
      current = { kind: heading.kind, title: heading.title, blocks: [], raw: [] };
      data.sections.push(current);
      continue;
    }
    pushBlockLine(line);
  }

  // assemble summary
  const summarySection = data.sections.find((s) => s.kind === 'summary');
  if (summarySection) {
    data.summary = summarySection.blocks.map((b) => [b.heading, b.meta, ...b.bullets].filter(Boolean).join(' ')).join(' ').trim()
      || summarySection.raw.join(' ').trim();
    data.sections = data.sections.filter((s) => s !== summarySection);
  }
  if (!data.summary && freeSummary.length) data.summary = freeSummary.join(' ').trim();

  // normalise skills sections into chip arrays
  data.sections.forEach((s) => {
    if (s.kind === 'skills') {
      const joined = [...s.raw, ...s.blocks.flatMap((b) => [b.heading, b.meta, ...b.bullets])].filter(Boolean).join(', ');
      s.chips = joined.split(/[,;]|\s•\s|\s·\s/).map((x) => x.trim()).filter((x) => x && x.length <= 40);
    }
  });

  return data;
}

/* ----------------------------------------------------------------------------
   2. TEMPLATE METADATA  —  gallery cards
   -------------------------------------------------------------------------- */

export const TEMPLATES = [
  {
    id: 'jake-ats', name: 'Jake ATS Compact', atsScore: 95, atsLabel: 'Very high',
    pages: 'single', tone: 'cyan', layout: 'single',
    fit: 'SDE · DevOps · SRE · Platform',
    desc: 'Single-column Overleaf-style. Dense rules, compact spacing — top recruiter-portal pass rate.',
    style: { font: '"Helvetica Neue", Arial, sans-serif', accent: '#0f172a', rule: 'underline', nameSize: 24, sectionStyle: 'rule', skills: 'inline', headerAlign: 'center' },
  },
  {
    id: 'modern-pro', name: 'Modern Professional', atsScore: 90, atsLabel: 'High',
    pages: 'single', tone: 'violet', layout: 'single',
    fit: 'Most roles · Corporate · Startups',
    desc: 'Accent section bars, confident name block and skill chips. Clean and contemporary.',
    style: { font: '"Calibri", "Segoe UI", Arial, sans-serif', accent: '#6d28d9', rule: 'bar', nameSize: 26, sectionStyle: 'bar', skills: 'chips', headerAlign: 'left' },
  },
  {
    id: 'dark-exec', name: 'Dark Header Executive', atsScore: 88, atsLabel: 'High',
    pages: 'single', tone: 'amber', layout: 'darkheader',
    fit: 'Senior · Leadership · Management',
    desc: 'Dark banner header with name reversed out in white and a gold accent divider.',
    style: { font: 'Georgia, "Times New Roman", serif', accent: '#b45309', headerBg: '#111827', headerText: '#ffffff', rule: 'gold', nameSize: 27, sectionStyle: 'gold', skills: 'inline', headerAlign: 'left' },
  },
  {
    id: 'minimal-ats', name: 'Minimal ATS', atsScore: 98, atsLabel: 'Very high',
    pages: 'single', tone: 'mint', layout: 'single',
    fit: 'Portal submissions · Any role',
    desc: 'Pure black-on-white, Times, zero graphics. The safest possible ATS layout.',
    style: { font: '"Times New Roman", Times, serif', accent: '#000000', rule: 'thin', nameSize: 22, sectionStyle: 'caps', skills: 'inline', headerAlign: 'center' },
  },
  {
    id: 'two-col-tech', name: 'Two Column Technical', atsScore: 82, atsLabel: 'Medium-high',
    pages: 'single', tone: 'cyan', layout: 'twocol',
    fit: 'Engineers with deep skill stacks',
    desc: 'Left sidebar for skills, education & contact; right column for summary & experience.',
    style: { font: '"Segoe UI", Arial, sans-serif', accent: '#0e7490', sidebarBg: '#0f172a', sidebarText: '#e2e8f0', rule: 'bar', nameSize: 23, sectionStyle: 'bar', skills: 'chips', headerAlign: 'left' },
  },
  {
    id: 'cloud-devops', name: 'Cloud/DevOps Engineer', atsScore: 90, atsLabel: 'High',
    pages: 'single', tone: 'cyan', layout: 'single',
    fit: 'AWS · Azure · GCP · CI/CD · Infra',
    desc: 'Cloud & tooling chip grid promoted to the top, then quantified experience.',
    style: { font: '"Helvetica Neue", Arial, sans-serif', accent: '#0284c7', rule: 'bar', nameSize: 24, sectionStyle: 'rule', skills: 'chips', skillsFirst: true, headerAlign: 'left' },
  },
  {
    id: 'fresher', name: 'Fresher Project Focus', atsScore: 88, atsLabel: 'High',
    pages: 'single', tone: 'violet', layout: 'single',
    fit: 'Students · Interns · 0–2 yrs',
    desc: 'Education and projects front-and-centre, experience kept lean. Built for new grads.',
    style: { font: '"Calibri", "Segoe UI", Arial, sans-serif', accent: '#7c3aed', rule: 'bar', nameSize: 24, sectionStyle: 'bar', skills: 'chips', order: ['education', 'projects', 'skills', 'experience'], headerAlign: 'center' },
  },
  {
    id: 'multipage', name: 'Multi Page Detailed', atsScore: 85, atsLabel: 'High',
    pages: 'multi', tone: 'amber', layout: 'single',
    fit: 'Deep experience · 8+ yrs',
    desc: 'Generous spacing across multiple A4 pages — keeps full context, never truncates.',
    style: { font: 'Georgia, "Times New Roman", serif', accent: '#92400e', rule: 'gold', nameSize: 26, sectionStyle: 'gold', skills: 'inline', spacious: true, headerAlign: 'left' },
  },
];

// legacy id/name -> new id mapping (so older saved selections keep working)
const LEGACY_MAP = {
  'jake-tech': 'jake-ats', 'Jake Tech Compact': 'jake-ats',
  'modern-dark': 'dark-exec', 'Modern Dark Header': 'dark-exec',
  'ats-minimal': 'minimal-ats', 'ATS Minimal One Page': 'minimal-ats',
  'executive': 'dark-exec', 'Executive Clean': 'dark-exec',
  'cloud-pro': 'cloud-devops', 'Cloud Engineer Pro': 'cloud-devops',
  'product-analyst': 'modern-pro', 'Product Analyst Clean': 'modern-pro',
  'two-page': 'multipage', 'Two Page Detailed': 'multipage',
  'Modern Professional': 'modern-pro', 'Technical Detailed': 'two-col-tech',
  'ATS Detailed': 'minimal-ats', 'Project Heavy Detailed': 'fresher',
};

// transient custom template (set when a user uploads + generates from a template)
let _custom = null;
export function setCustomTemplate(tpl) { _custom = tpl; }
export function getCustomTemplate() { return _custom; }

export function getTemplate(idOrName) {
  if (!idOrName) return TEMPLATES[0];
  if (idOrName === 'custom' && _custom) return _custom;
  const direct = TEMPLATES.find((t) => t.id === idOrName || t.name === idOrName);
  if (direct) return direct;
  const mapped = LEGACY_MAP[idOrName];
  if (mapped) return TEMPLATES.find((t) => t.id === mapped) || TEMPLATES[0];
  return TEMPLATES[0];
}

export function recommendTemplateId(role = '') {
  const r = String(role).toLowerCase();
  if (/cloud|aws|azure|gcp|infra/.test(r)) return 'cloud-devops';
  if (/devops|sre|site.reliability|platform/.test(r)) return 'jake-ats';
  if (/intern|fresher|student|entry.level|graduate|junior/.test(r)) return 'fresher';
  if (/director|head of|principal|vp |chief|lead|senior.*manager|executive/.test(r)) return 'dark-exec';
  if (/manager|consultant|operations/.test(r)) return 'dark-exec';
  if (/data|machine.learning|ml|backend|software|engineer|developer|sde|swe/.test(r)) return 'two-col-tech';
  if (/analyst|marketing|sales|finance|hr|product/.test(r)) return 'modern-pro';
  return 'modern-pro';
}

/* ----------------------------------------------------------------------------
   3. RENDERER  —  structured data -> a complete, isolated A4 HTML document
   -------------------------------------------------------------------------- */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function contactsHTML(contacts, sep = '  •  ') {
  if (!contacts || !contacts.length) return '';
  return contacts.map((c) => esc(c.value)).join(sep);
}

function sectionHeaderCSS(style) {
  const a = style.accent || '#111827';
  switch (style.sectionStyle) {
    case 'bar':
      return `color:${a};font-weight:700;font-size:11.5pt;text-transform:uppercase;letter-spacing:.6px;border-bottom:2px solid ${a};padding-bottom:2pt;margin:13pt 0 6pt`;
    case 'gold':
      return `color:${a};font-weight:700;font-size:11.5pt;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${a};padding-bottom:2pt;margin:13pt 0 6pt`;
    case 'caps':
      return `color:#000;font-weight:700;font-size:11pt;text-transform:uppercase;letter-spacing:1.2px;border-bottom:1px solid #000;padding-bottom:1pt;margin:11pt 0 5pt`;
    case 'rule':
    default:
      return `color:${a};font-weight:700;font-size:11pt;text-transform:uppercase;letter-spacing:.5px;border-bottom:1.5px solid ${a};padding-bottom:2pt;margin:12pt 0 5pt`;
  }
}

function renderSkills(section, style) {
  if (!section.chips || !section.chips.length) {
    const body = (section.blocks || []).map((b) => [b.heading, b.meta, ...b.bullets].filter(Boolean).join(' ')).join(', ');
    return `<div class="r-body">${esc(body)}</div>`;
  }
  if (style.skills === 'chips') {
    return `<div class="r-chips">${section.chips.map((c) => `<span class="r-chip">${esc(c)}</span>`).join('')}</div>`;
  }
  return `<div class="r-body">${section.chips.map(esc).join(' • ')}</div>`;
}

function renderBlocks(section, style) {
  return (section.blocks || []).map((b) => {
    const head = b.heading ? `<div class="r-jobline">${esc(b.heading)}${b.meta ? ` <span class="r-meta">— ${esc(b.meta)}</span>` : ''}</div>`
      : (b.meta ? `<div class="r-para">${esc(b.meta)}</div>` : '');
    const bullets = b.bullets && b.bullets.length
      ? `<ul class="r-ul">${b.bullets.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    return `<div class="r-entry">${head}${bullets}</div>`;
  }).join('');
}

function renderSection(section, style) {
  const headHTML = `<div class="r-section" style="${sectionHeaderCSS(style)}">${esc(section.title)}</div>`;
  const body = section.kind === 'skills' ? renderSkills(section, style) : renderBlocks(section, style);
  return `<div class="r-block">${headHTML}${body}</div>`;
}

function orderedSections(data, style) {
  const order = style.order;
  if (!order) {
    if (style.skillsFirst) {
      const skills = data.sections.filter((s) => s.kind === 'skills');
      const rest = data.sections.filter((s) => s.kind !== 'skills');
      return [...skills, ...rest];
    }
    return data.sections;
  }
  const used = new Set();
  const out = [];
  order.forEach((k) => data.sections.forEach((s) => { if (s.kind === k && !used.has(s)) { used.add(s); out.push(s); } }));
  data.sections.forEach((s) => { if (!used.has(s)) out.push(s); });
  return out;
}

function baseCSS(style, mode) {
  const compact = mode === 'single';
  const lh = style.spacious ? 1.55 : compact ? 1.32 : 1.42;
  const fs = style.spacious ? 10.8 : compact ? 9.8 : 10.3;
  return `
    *{margin:0;padding:0;box-sizing:border-box}
    .r-root{font-family:${style.font};color:#1f2937;font-size:${fs}pt;line-height:${lh};background:#fff}
    .r-name{font-size:${style.nameSize}pt;font-weight:700;color:${style.headerText || '#0f172a'};letter-spacing:-.3px;line-height:1.05}
    .r-title{font-size:11pt;font-weight:600;color:${style.headerText ? 'rgba(255,255,255,.85)' : style.accent};margin-top:2pt}
    .r-contacts{font-size:9pt;color:${style.headerText ? 'rgba(255,255,255,.8)' : '#475569'};margin-top:5pt;word-break:break-word}
    .r-summary{margin:8pt 0 2pt;color:#374151}
    .r-jobline{font-weight:700;color:#0f172a;font-size:${fs + 0.3}pt;margin-top:6pt}
    .r-meta{font-weight:400;color:#64748b;font-size:${fs - 0.5}pt}
    .r-para{color:#374151;margin-top:3pt}
    .r-ul{list-style:disc;margin:3pt 0 3pt 16pt;color:#374151}
    .r-ul li{margin:1.5pt 0;padding-left:2pt}
    .r-body{color:#374151;margin-top:3pt}
    .r-entry{margin-bottom:${compact ? 3 : 5}pt}
    .r-chips{display:flex;flex-wrap:wrap;gap:4pt;margin-top:4pt}
    .r-chip{display:inline-block;background:${hexA(style.accent, 0.10)};color:${style.accent};border:1px solid ${hexA(style.accent, 0.28)};border-radius:10pt;padding:1.5pt 7pt;font-size:8.6pt;font-weight:600}
    .r-block{margin-bottom:${compact ? 2 : 4}pt}
  `;
}

function hexA(hex, a) {
  const h = String(hex || '#000000').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16) || 0, g = parseInt(n.slice(2, 4), 16) || 0, b = parseInt(n.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}

/* Build the *inner* resume markup for a given layout (no <html> wrapper). */
function renderInner(data, tpl, mode) {
  const style = tpl.style;
  const summaryHTML = data.summary ? `<div class="r-summary">${esc(data.summary)}</div>` : '';

  if (tpl.layout === 'twocol') {
    const side = ['skills', 'education', 'certifications', 'languages', 'awards'];
    const main = data.sections.filter((s) => !side.includes(s.kind));
    const sideSecs = data.sections.filter((s) => side.includes(s.kind));
    const contacts = (data.contacts || []).map((c) => `<div style="margin:1.5pt 0">${esc(c.value)}</div>`).join('');
    return `
      <div style="display:flex;gap:0;min-height:100%">
        <aside style="width:32%;background:${style.sidebarBg};color:${style.sidebarText};padding:14pt 12pt">
          <div style="font-size:${style.nameSize}pt;font-weight:700;line-height:1.05;color:#fff">${esc(data.name)}</div>
          ${data.title ? `<div style="font-size:10.5pt;color:${hexA('#ffffff', 0.85)};margin-top:3pt;font-weight:600">${esc(data.title)}</div>` : ''}
          <div style="font-size:8.6pt;color:${hexA('#ffffff', 0.8)};margin-top:10pt;line-height:1.5">${contacts}</div>
          ${sideSecs.map((s) => `
            <div style="margin-top:13pt">
              <div style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#fff;border-bottom:1px solid ${hexA('#ffffff', 0.25)};padding-bottom:2pt;margin-bottom:5pt">${esc(s.title)}</div>
              ${s.kind === 'skills' && s.chips
        ? `<div style="display:flex;flex-wrap:wrap;gap:3pt">${s.chips.map((c) => `<span style="background:${hexA('#ffffff', 0.12)};border:1px solid ${hexA('#ffffff', 0.22)};border-radius:8pt;padding:1pt 6pt;font-size:8pt">${esc(c)}</span>`).join('')}</div>`
        : `<div style="font-size:8.8pt;color:${hexA('#ffffff', 0.9)};line-height:1.45">${(s.blocks || []).map((b) => `<div style="margin:2pt 0"><b style="color:#fff">${esc(b.heading)}</b>${b.meta ? ` — ${esc(b.meta)}` : ''}${(b.bullets || []).map((x) => `<div>• ${esc(x)}</div>`).join('')}</div>`).join('')}</div>`}
            </div>`).join('')}
        </aside>
        <main style="width:68%;padding:16pt 16pt 16pt 18pt">
          ${summaryHTML}
          ${main.map((s) => renderSection(s, style)).join('')}
        </main>
      </div>`;
  }

  // header (dark band or plain)
  let header;
  if (tpl.layout === 'darkheader') {
    header = `
      <div style="background:${style.headerBg};color:${style.headerText};padding:20px 44px;margin:-40px -44px 12px">
        <div class="r-name">${esc(data.name)}</div>
        ${data.title ? `<div class="r-title">${esc(data.title)}</div>` : ''}
        ${data.contacts.length ? `<div class="r-contacts">${contactsHTML(data.contacts)}</div>` : ''}
      </div>`;
  } else {
    const align = style.headerAlign === 'center' ? 'text-align:center' : '';
    header = `
      <div style="${align};padding-bottom:6pt;border-bottom:${tpl.id === 'minimal-ats' ? '0' : '0'}">
        <div class="r-name">${esc(data.name)}</div>
        ${data.title ? `<div class="r-title">${esc(data.title)}</div>` : ''}
        ${data.contacts.length ? `<div class="r-contacts">${contactsHTML(data.contacts)}</div>` : ''}
      </div>`;
  }

  const secs = orderedSections(data, style).map((s) => renderSection(s, style)).join('');
  return `<div>${header}${summaryHTML}${secs}</div>`;
}

/* Reusable parts: { css, page } where css is style text and page is the
   `.r-page` markup. Used by the preview iframe AND the PDF capture path. */
export function renderResumeParts(data, idOrName, opts = {}) {
  const tpl = getTemplate(idOrName);
  const mode = opts.mode || (tpl.pages === 'multi' ? 'multi' : 'auto');
  const inner = renderInner(data, tpl, mode);
  const pad = tpl.layout === 'twocol' ? '0' : '40px 44px';
  const css = `${baseCSS(tpl.style, mode)}
.r-page{width:794px;min-height:1123px;background:#fff;margin:0 auto;padding:${pad};overflow:hidden}`;
  const page = `<div class="r-root"><div class="r-page">${inner}</div></div>`;
  return { css, page, tpl, mode };
}

/* Public: full standalone A4 HTML document (used by preview iframe). */
export function renderResumeHTML(data, idOrName, opts = {}) {
  const { css, page } = renderResumeParts(data, idOrName, opts);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title> </title>
<style>
@page{size:A4;margin:0}
html,body{margin:0;padding:0;background:#e9edf5}
${css}
@media screen{.r-page{box-shadow:0 8px 40px rgba(0,0,0,.25);margin:14px auto}}
</style></head>
<body>${page}</body></html>`;
}

/* ----------------------------------------------------------------------------
   4. CLEAN PDF EXPORT  —  html2canvas + jsPDF
   • No window.print(), so NO browser URL/title/date/page-number headers/footers
   • A4 size, real margins, whitespace-aware page breaks (avoid cutting lines)
   • singlePage mode scales content to fit one page cleanly
   -------------------------------------------------------------------------- */

function mountForCapture(parts) {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-12000px;top:0;width:794px;background:#fff;z-index:-1;color:#111';
  const style = document.createElement('style');
  style.textContent = parts.css;
  host.appendChild(style);
  const holder = document.createElement('div');
  holder.innerHTML = parts.page;
  host.appendChild(holder);
  document.body.appendChild(host);
  return { host, page: host.querySelector('.r-page') };
}

// find a near-white horizontal cut row scanning upward from `ideal`
function findCut(canvas, ideal, search) {
  try {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const lo = Math.max(1, ideal - search);
    for (let y = ideal; y >= lo; y--) {
      const row = ctx.getImageData(0, y, w, 1).data;
      let dark = 0;
      for (let x = 0; x < row.length; x += 16) {
        if (row[x] < 245 || row[x + 1] < 245 || row[x + 2] < 245) dark++;
        if (dark > 2) break;
      }
      if (dark <= 2) return y;
    }
  } catch {}
  return ideal;
}

export async function exportResumePDF(data, idOrName, { mode, fileName = 'resume.pdf' } = {}) {
  const { default: jsPDF } = await import('jspdf');
  const html2canvas = (await import('html2canvas')).default;
  const tpl = getTemplate(idOrName);
  const parts = renderResumeParts(data, idOrName, { mode: mode || (tpl.pages === 'multi' ? 'multi' : 'auto') });
  const { host, page } = mountForCapture(parts);
  try {
    await new Promise((r) => setTimeout(r, 80)); // let layout/fonts settle
    const canvas = await html2canvas(page, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: 794, width: 794 });
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const imgW = canvas.width, imgH = canvas.height;
    const ratio = pw / imgW;
    const scaledH = imgH * ratio;
    const singlePage = (mode === 'single') || (tpl.pages !== 'multi' && scaledH <= ph * 1.06);

    if (singlePage) {
      const fit = Math.min(pw / imgW, ph / imgH);
      const w = imgW * fit, h = imgH * fit;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pw - w) / 2, 0, w, h, undefined, 'FAST');
    } else {
      const pagePxH = Math.floor(ph / ratio);
      const searchPx = Math.floor(pagePxH * 0.14);
      let y = 0;
      while (y < imgH) {
        let sliceH = Math.min(pagePxH, imgH - y);
        if (y + sliceH < imgH) {
          const cut = findCut(canvas, y + sliceH, searchPx);
          if (cut - y > pagePxH * 0.4) sliceH = cut - y;
        }
        const slice = document.createElement('canvas');
        slice.width = imgW; slice.height = sliceH;
        slice.getContext('2d').drawImage(canvas, 0, y, imgW, sliceH, 0, 0, imgW, sliceH);
        if (y > 0) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/png'), 'PNG', 0, 0, pw, sliceH * ratio, undefined, 'FAST');
        y += sliceH;
      }
    }
    pdf.save(fileName);
  } finally {
    setTimeout(() => { try { document.body.removeChild(host); } catch {} }, 200);
  }
}

/* ----------------------------------------------------------------------------
   5. DOCX EXPORT  —  Word-openable document that preserves the template layout
   (Word + Google Docs both open this; keeps colours, headings & structure.)
   -------------------------------------------------------------------------- */

export function exportResumeDOCX(data, idOrName, { fileName = 'resume.doc' } = {}) {
  const tpl = getTemplate(idOrName);
  const inner = renderInner(data, tpl, tpl.pages === 'multi' ? 'multi' : 'auto');
  const docHTML = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page{size:A4;margin:1.6cm}
${baseCSS(tpl.style, 'auto')}
body{font-family:${tpl.style.font}}
</style></head>
<body><div class="r-root">${inner}</div></body></html>`;
  const blob = new Blob(['\ufeff', docHTML], { type: 'application/msword' });
  triggerDownload(blob, fileName.replace(/\.docx$/i, '.doc'));
}

export function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ----------------------------------------------------------------------------
   6. CUSTOM TEMPLATE  —  turn an analysed/selected style spec into a theme so an
   uploaded template image/PDF can drive a "template-inspired" layout even when
   AI vision is unavailable (fallback path).
   -------------------------------------------------------------------------- */

export function buildCustomTemplate(spec = {}) {
  const accent = spec.accent || '#334155';
  const layout = spec.columns === 2 ? 'twocol' : spec.headerStyle === 'dark' ? 'darkheader' : 'single';
  const style = {
    font: spec.font || '"Helvetica Neue", Arial, sans-serif',
    accent,
    rule: 'bar',
    nameSize: spec.headerStyle === 'dark' ? 26 : 24,
    sectionStyle: spec.headerStyle === 'dark' ? 'gold' : 'bar',
    skills: 'chips',
    headerAlign: spec.headerAlign || (layout === 'single' ? 'left' : 'left'),
  };
  if (layout === 'darkheader') { style.headerBg = spec.headerBg || '#111827'; style.headerText = '#ffffff'; }
  if (layout === 'twocol') { style.sidebarBg = spec.sidebarBg || '#0f172a'; style.sidebarText = '#e2e8f0'; }
  return {
    id: 'custom', name: spec.name || 'Custom template', atsScore: 85, atsLabel: 'High',
    pages: spec.pages === 'multi' ? 'multi' : 'single', tone: 'violet', layout, style,
    fit: 'Based on your uploaded template', desc: spec.note || 'Template-inspired layout built from your upload.',
  };
}
