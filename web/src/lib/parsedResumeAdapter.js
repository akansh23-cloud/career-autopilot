/* ==========================================================================
   PARSED RESUME  →  STRUCTURED RESUME
   --------------------------------------------------------------------------
   Two resume shapes exist in this app and they are not interchangeable:

     PARSED      what parseResume(plainText) produces, and what the legacy
                 renderer consumes:
                     { name, title, contacts[], summary, sections[] }

     STRUCTURED  what fromStructuredResume() consumes on its way into the
                 canonical ResumeDocument and Template OS:
                     { personalInfo{}, summary, skills[], experience[], … }

   The Editor works in plain text, so it holds the PARSED shape. Template OS
   needs the STRUCTURED one. Handing the first to a function expecting the
   second does not throw — `src.personalInfo` is simply undefined, every field
   resolves to empty, and the renderer produces a pristine blank A4 page.

   That is the failure this module exists to prevent. It is worse than a crash,
   because a crash would have been noticed on the first preview.

   Nothing here invents content. A field the parser did not find stays empty,
   and a section whose kind we do not recognise is preserved as a custom
   section rather than dropped — losing a section silently is the same class of
   bug as the one above.
   ========================================================================== */

/* Contact pieces are typed by the parser as email / phone / location / github /
   link. Everything else lands in `links`, which the header renders verbatim. */
function contactsToPersonalInfo(contacts = []) {
  const info = { email: '', phone: '', location: '', linkedin: '', github: '', portfolio: '', links: [] };
  for (const c of contacts) {
    const value = String(c?.value ?? '').trim();
    if (!value) continue;
    const type = c?.type;

    if (type === 'email' && !info.email) { info.email = value; continue; }
    if (type === 'phone' && !info.phone) { info.phone = value; continue; }
    if (type === 'location' && !info.location) { info.location = value; continue; }
    if (type === 'github' && !info.github) { info.github = value; continue; }

    /* The parser types every URL as a generic "link", so LinkedIn has to be
       recognised here or it lands in the overflow list and the header shows a
       bare URL where a labelled profile belongs. */
    if (/linkedin\.com/i.test(value)) {
      if (!info.linkedin) { info.linkedin = value; continue; }
    } else if (/github\.com/i.test(value)) {
      if (!info.github) { info.github = value; continue; }
    } else if (type === 'link' && !info.portfolio) {
      info.portfolio = value; continue;
    }

    info.links.push({ label: type === 'link' ? 'link' : String(type || 'link'), url: value });
  }
  return info;
}

/* A parsed block is { heading, meta, bullets[] }. `meta` is the residue of a
   "Role | Company | Dates" line, joined with the parser's own separator. */
function splitMeta(meta = '') {
  return String(meta || '')
    .split(/\s*(?:·|\|)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const DATE_RE = /(19|20)\d{2}|present|current|ongoing/i;

function blockToExperience(block) {
  const parts = splitMeta(block.meta);
  const dates = parts.find((p) => DATE_RE.test(p)) || '';
  const rest = parts.filter((p) => p !== dates);
  return {
    role: block.heading || '',
    company: rest[0] || '',
    location: rest[1] || '',
    dates,
    bullets: (block.bullets || []).filter(Boolean),
  };
}

function blockToProject(block) {
  const parts = splitMeta(block.meta);
  const link = parts.find((p) => /^https?:\/\/|\w+\.\w{2,}/.test(p)) || '';
  const techStack = parts.filter((p) => p !== link).join(', ');
  return {
    name: block.heading || '',
    techStack,
    link,
    bullets: (block.bullets || []).filter(Boolean),
  };
}

function blockToEducation(block) {
  const parts = splitMeta(block.meta);
  const dates = parts.find((p) => DATE_RE.test(p)) || '';
  const rest = parts.filter((p) => p !== dates);
  return {
    degree: block.heading || '',
    school: rest[0] || '',
    location: rest[1] || '',
    dates,
    details: (block.bullets || []).filter(Boolean),
  };
}

function blockToLine(block) {
  return [block.heading, block.meta, ...(block.bullets || [])].filter(Boolean).join(' — ');
}

/** True when `data` is the parsed plain-text shape rather than the structured one. */
export function isParsedResumeShape(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.personalInfo) return false;                 // already structured
  return Array.isArray(data.sections) || Array.isArray(data.contacts);
}

/**
 * Convert the parsed plain-text shape into the structured input that
 * fromStructuredResume() expects.
 *
 * Already-structured input is returned untouched, so this is safe to apply at
 * any boundary without knowing which shape arrived.
 */
export function fromParsedResume(data) {
  if (!isParsedResumeShape(data)) return data;

  const out = {
    personalInfo: {
      name: String(data.name || '').trim(),
      title: String(data.title || '').trim(),
      ...contactsToPersonalInfo(data.contacts),
    },
    summary: String(data.summary || '').trim(),
    skills: [],
    experience: [],
    projects: [],
    education: [],
    certifications: [],
    achievements: [],
    customSections: [],
  };

  for (const section of data.sections || []) {
    const blocks = section.blocks || [];
    switch (section.kind) {
      case 'experience':
      case 'work':
        out.experience.push(...blocks.map(blockToExperience));
        break;
      case 'projects':
        out.projects.push(...blocks.map(blockToProject));
        break;
      case 'education':
        out.education.push(...blocks.map(blockToEducation));
        break;
      case 'skills':
        /* The parser has already normalised a skills section into chips. */
        out.skills.push(...(section.chips || []).filter(Boolean));
        break;
      case 'certifications':
        out.certifications.push(...blocks.map(blockToLine).filter(Boolean));
        break;
      case 'achievements':
      case 'awards':
        out.achievements.push(...blocks.map(blockToLine).filter(Boolean));
        break;
      default:
        /* An unrecognised heading is still the candidate's content. Keeping it
           as a custom section is the difference between a template we do not
           style perfectly and a resume that quietly loses a section. */
        out.customSections.push({
          title: section.title || 'Additional',
          items: blocks.map(blockToLine).filter(Boolean),
        });
    }
  }

  return out;
}

export default { fromParsedResume, isParsedResumeShape };
