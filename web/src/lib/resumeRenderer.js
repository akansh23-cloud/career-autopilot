/* ============================================================================
   resumeRenderer.js — THE single rendering engine for Resume OS
   ----------------------------------------------------------------------------
   The same block builder + CSS + paginator powers:
     • the full preview modal,
     • the live editor preview,
     • the Template Lab,
     • PDF export (print path, selectable text),
     • the snapshot PDF fallback (html2canvas per page),
     • DOCX export.
   There is intentionally NO separate "thumbnail renderer" for content —
   gallery thumbnails are structural skeletons generated from template
   metadata (see ResumeTemplates.jsx), never tiny squeezed resumes.

   Pipeline:
     structured data ──buildResumeBlocks──▶ blocks (atomic / splittable)
                      ──measureBlocks (DOM)──▶ measured heights
                      ──packBlocksIntoPages (pure)──▶ page assignments
                      ──composePages──▶ [pageHtml...] + css
   `packBlocksIntoPages` is pure and unit-tested under node --test.
   ========================================================================== */

import {
  toStructuredResume, flattenSkills, devopsSkillGroups, SKILL_GROUP_LABELS,
} from './resumeDataModel.js';
import { getResumeTemplate } from './resumeTemplateRegistry.js';

/* ------------------------------------------------------------- geometry -- */

export const PAGE_SIZES = {
  a4: { id: 'a4', label: 'A4', width: 794, height: 1123, css: '210mm 297mm' },
  letter: { id: 'letter', label: 'Letter', width: 816, height: 1056, css: '8.5in 11in' },
};

/* Body font never drops below this — readability floor for compact fitting. */
export const MIN_BODY_FONT_PX = 9.5;

export const DENSITIES = {
  comfortable: { id: 'comfortable', fontPx: 13.4, lineHeight: 1.42, margin: 48, sectionGap: 13, entryGap: 8 },
  compact: { id: 'compact', fontPx: 12.7, lineHeight: 1.34, margin: 42, sectionGap: 10, entryGap: 6 },
  tight: { id: 'tight', fontPx: 12.1, lineHeight: 1.28, margin: 36, sectionGap: 8, entryGap: 5 },
};
export const DENSITY_STEPS = ['comfortable', 'compact', 'tight'];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------------------------------------------------------------- blocks -- */

const SECTION_TITLES = {
  summary: 'Summary',
  skills: 'Technical Skills',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  achievements: 'Achievements',
  publications: 'Publications',
  patents: 'Patents',
};

let _blockSeq = 0;
function block(kind, html, opts = {}) {
  return {
    id: `b${++_blockSeq}`,
    kind,
    html,
    keepWithNext: !!opts.keepWithNext,
    splittable: !!opts.splittable,
    units: opts.units || null, // splittable: array of unit html strings
    wrapOpen: opts.wrapOpen || '',
    wrapClose: opts.wrapClose || '',
    section: opts.section || '',
  };
}

function headerBlock(d, tpl) {
  const p = d.personalInfo;
  const contacts = [p.email, p.phone, p.location, p.linkedin, p.github, p.portfolio, ...(p.links || [])]
    .filter(Boolean).map(esc).join('  |  ');
  const inner = `
    <div class="rp-name">${esc(p.name) || 'Your Name'}</div>
    ${p.title ? `<div class="rp-role">${esc(p.title)}</div>` : ''}
    ${contacts ? `<div class="rp-contacts">${contacts}</div>` : ''}`;
  if (tpl.theme.headerBand) {
    return block('header', `<div class="rp-band">${inner}</div>`, { section: 'header' });
  }
  return block('header', `<div class="rp-header">${inner}</div>`, { section: 'header' });
}

function sectionHeading(title, section) {
  return block('section-heading', `<div class="rp-sec">${esc(title)}</div>`, { keepWithNext: true, section });
}

function paragraphBlock(text, section) {
  return block('paragraph', `<div class="rp-para">${esc(text)}</div>`, { section });
}

function bulletsBlock(bullets, section) {
  const units = bullets.map((b) => `<li>${esc(b)}</li>`);
  return block('bullets', `<ul class="rp-ul">${units.join('')}</ul>`, {
    splittable: true, units, wrapOpen: '<ul class="rp-ul">', wrapClose: '</ul>', section,
  });
}

function entryHeadHTML(left, right, sub) {
  return `<div class="rp-entry-head"><div class="rp-entry-row"><span class="rp-entry-title">${left}</span>${right ? `<span class="rp-entry-dates">${right}</span>` : ''}</div>${sub ? `<div class="rp-entry-sub">${sub}</div>` : ''}</div>`;
}

function skillsBlocks(d, tpl) {
  const style = tpl.theme.skillsStyle || 'grouped-lines';
  const flat = flattenSkills(d.skills);
  if (!flat.length) return [];
  const out = [];
  if (style === 'chips') {
    out.push(block('skills', `<div class="rp-chips">${flat.map((s) => `<span class="rp-chip">${esc(s)}</span>`).join('')}</div>`, { section: 'skills' }));
    return out;
  }
  if (style === 'inline-lines') {
    out.push(block('skills', `<div class="rp-skline">${flat.map(esc).join(' · ')}</div>`, { section: 'skills' }));
    return out;
  }
  let groups;
  if (style === 'devops-groups') {
    groups = devopsSkillGroups(d.skills).map((g) => ({ label: g.label, skills: g.skills }));
  } else {
    groups = Object.entries(d.skills)
      .filter(([, v]) => v && v.length)
      .map(([k, v]) => ({ label: SKILL_GROUP_LABELS[k] || k, skills: v }));
  }
  if (!groups.length) groups = [{ label: 'Skills', skills: flat }];
  const units = groups.map((g) => `<div class="rp-skline"><span class="rp-sklabel">${esc(g.label)}:</span> ${g.skills.map(esc).join(', ')}</div>`);
  out.push(block('skills', units.join(''), {
    splittable: units.length > 2, units, wrapOpen: '', wrapClose: '', section: 'skills',
  }));
  return out;
}

function experienceBlocks(d, tpl, title) {
  if (!d.experience.length) return [];
  const out = [sectionHeading(title, 'experience')];
  d.experience.forEach((e, idx) => {
    const left = `${esc(e.role || e.company || 'Role')}`;
    const sub = [e.company, e.location].filter(Boolean).map(esc).join(' · ');
    out.push(block('entry-head', entryHeadHTML(left, esc(e.dates || [e.startDate, e.endDate].filter(Boolean).join(' – ')), sub), { keepWithNext: (e.bullets || []).length > 0, section: 'experience' }));
    if ((e.bullets || []).length) out.push(bulletsBlock(e.bullets, 'experience'));
    if (idx < d.experience.length - 1) out.push(block('gap', '<div class="rp-entry-gap"></div>', { section: 'experience' }));
  });
  return out;
}

function projectBlocks(d, tpl) {
  if (!d.projects.length) return [];
  const out = [sectionHeading(SECTION_TITLES.projects, 'projects')];
  d.projects.forEach((p, idx) => {
    const right = p.link ? `<span class="rp-link">${esc(p.link)}</span>` : '';
    const sub = p.techStack ? esc(p.techStack) : '';
    out.push(block('entry-head', entryHeadHTML(esc(p.name || 'Project'), right, sub), { keepWithNext: (p.bullets || []).length > 0, section: 'projects' }));
    if ((p.bullets || []).length) out.push(bulletsBlock(p.bullets, 'projects'));
    if (idx < d.projects.length - 1) out.push(block('gap', '<div class="rp-entry-gap"></div>', { section: 'projects' }));
  });
  return out;
}

function educationBlocks(d) {
  if (!d.education.length) return [];
  const out = [sectionHeading(SECTION_TITLES.education, 'education')];
  d.education.forEach((e) => {
    out.push(block('entry-head', entryHeadHTML(esc(e.school || e.degree || 'Education'), esc(e.dates || ''), esc(e.degree && e.school ? e.degree : '')), { keepWithNext: (e.details || []).length > 0, section: 'education' }));
    if ((e.details || []).length) out.push(bulletsBlock(e.details, 'education'));
  });
  return out;
}

function listSectionBlocks(items, title, section) {
  if (!items || !items.length) return [];
  return [sectionHeading(title, section), bulletsBlock(items, section)];
}

/* Build the ordered render blocks for a structured resume + template. */
export function buildResumeBlocks(input, templateOrId, opts = {}) {
  _blockSeq = 0;
  const tpl = typeof templateOrId === 'string' ? getResumeTemplate(templateOrId) : templateOrId;
  const d = toStructuredResume(input);
  const theme = tpl.theme || {};
  const order = opts.sectionOrder || theme.sectionOrder
    || ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements'];

  const blocks = [headerBlock(d, tpl)];
  const expTitle = theme.experienceTitle || SECTION_TITLES.experience;
  const achTitle = theme.achievementsTitle || SECTION_TITLES.achievements;

  const done = new Set();
  const renderSection = (key) => {
    if (done.has(key)) return;
    done.add(key);
    switch (key) {
      case 'summary':
        if (d.summary) blocks.push(sectionHeading(SECTION_TITLES.summary, 'summary'), paragraphBlock(d.summary, 'summary'));
        break;
      case 'skills': {
        const sb = skillsBlocks(d, tpl);
        if (sb.length) blocks.push(sectionHeading(SECTION_TITLES.skills, 'skills'), ...sb);
        break;
      }
      case 'experience':
        blocks.push(...experienceBlocks(d, tpl, expTitle));
        break;
      case 'projects':
        blocks.push(...projectBlocks(d, tpl));
        break;
      case 'education':
        blocks.push(...educationBlocks(d));
        break;
      case 'certifications':
        blocks.push(...listSectionBlocks(d.certifications, SECTION_TITLES.certifications, 'certifications'));
        break;
      case 'achievements':
        blocks.push(...listSectionBlocks(d.achievements, achTitle, 'achievements'));
        break;
      case 'publications':
        blocks.push(...listSectionBlocks(d.publications, SECTION_TITLES.publications, 'publications'));
        break;
      case 'patents':
        blocks.push(...listSectionBlocks(d.patents, SECTION_TITLES.patents, 'patents'));
        break;
      default:
        break;
    }
  };

  order.forEach(renderSection);
  // anything the order missed (e.g. publications/patents on templates that don't list them)
  ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements', 'publications', 'patents'].forEach(renderSection);
  for (const s of d.extraSections || []) {
    blocks.push(...listSectionBlocks(s.items, s.title, 'extra'));
  }
  return { blocks, structured: d, template: tpl };
}

/* ------------------------------------------------------------------- CSS -- */

export function resumeCSS(templateOrId, densityId = null, sizeId = 'a4') {
  const tpl = typeof templateOrId === 'string' ? getResumeTemplate(templateOrId) : templateOrId;
  const theme = tpl.theme || {};
  const den = DENSITIES[densityId || theme.density || 'compact'] || DENSITIES.compact;
  const size = PAGE_SIZES[sizeId] || PAGE_SIZES.a4;
  const accent = theme.accent || '#111827';
  const fs = Math.max(den.fontPx, MIN_BODY_FONT_PX);
  const align = theme.headerAlign === 'center' ? 'center' : 'left';

  const secStyles = {
    rule: `color:${accent};font-weight:700;font-size:${fs - 1}px;text-transform:uppercase;letter-spacing:.6px;border-bottom:1.5px solid ${accent};padding-bottom:2px;`,
    bar: `color:${accent};font-weight:700;font-size:${fs - 0.6}px;text-transform:uppercase;letter-spacing:.7px;border-bottom:2px solid ${accent};padding-bottom:2px;`,
    caps: `color:#000;font-weight:700;font-size:${fs - 1}px;text-transform:uppercase;letter-spacing:1.1px;border-bottom:1px solid #000;padding-bottom:1px;`,
    band: `color:${accent};font-weight:700;font-size:${fs - 0.6}px;text-transform:uppercase;letter-spacing:.9px;border-bottom:2px solid ${accent};padding-bottom:2px;`,
  };
  const sec = secStyles[theme.sectionStyle] || secStyles.rule;
  const bandBg = theme.bandBg || '#1c2433';
  const bandText = theme.bandText || '#ffffff';

  return `
*{margin:0;padding:0;box-sizing:border-box}
.rp-root{font-family:${theme.font || 'Arial, sans-serif'};color:#1f2430;font-size:${fs}px;line-height:${den.lineHeight};-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rp-page{width:${size.width}px;height:${size.height}px;background:#fff;padding:${den.margin}px ${den.margin + 4}px;overflow:visible;position:relative}
.rp-page + .rp-page{margin-top:18px}
.rp-header{text-align:${align};margin-bottom:${den.sectionGap}px}
.rp-band{background:${bandBg};color:${bandText};text-align:${align};margin:${-den.margin}px ${-(den.margin + 4)}px ${den.sectionGap + 2}px;padding:${den.margin * 0.55}px ${den.margin + 4}px}
.rp-band .rp-name{color:${bandText}}
.rp-band .rp-role{color:${bandText};opacity:.88}
.rp-band .rp-contacts{color:${bandText};opacity:.82}
.rp-name{font-size:${theme.nameSize || 21}px;font-weight:700;letter-spacing:-.2px;line-height:1.12;color:#10131c}
.rp-role{font-size:${fs + 1}px;font-weight:600;color:${accent};margin-top:2px}
.rp-contacts{font-size:${fs - 1.6}px;color:#46505f;margin-top:4px;word-break:break-word}
.rp-sec{${sec}margin:${den.sectionGap}px 0 ${Math.max(4, den.entryGap - 1)}px;break-after:avoid;page-break-after:avoid}
.rp-para{color:#2a3140;break-inside:avoid-column}
.rp-entry-head{break-inside:avoid;page-break-inside:avoid;margin-top:2px}
.rp-entry-row{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.rp-entry-title{font-weight:700;color:#10131c;font-size:${fs + 0.4}px;min-width:0;overflow-wrap:anywhere}
.rp-entry-dates{font-size:${fs - 1.4}px;color:#5a6372;white-space:nowrap;flex:none}
.rp-entry-sub{font-size:${fs - 0.8}px;color:#46505f;font-style:italic;overflow-wrap:anywhere}
.rp-entry-gap{height:${den.entryGap}px}
.rp-ul{list-style:${theme.bulletChar || 'disc'};margin:3px 0 3px 17px;color:#2a3140}
.rp-ul li{margin:${den.entryGap >= 8 ? 2.5 : 1.5}px 0;padding-left:2px;overflow-wrap:anywhere;orphans:2;widows:2}
.rp-skline{margin:2px 0;overflow-wrap:anywhere}
.rp-sklabel{font-weight:700;color:#10131c}
.rp-link{font-size:${fs - 1.6}px;color:${accent};overflow-wrap:anywhere;white-space:normal;max-width:46%;text-align:right}
.rp-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}
.rp-chip{background:${hexA(accent, 0.08)};color:${accent};border:1px solid ${hexA(accent, 0.3)};border-radius:9px;padding:1.5px 8px;font-size:${fs - 2}px;font-weight:600}
.rp-block{break-inside:avoid;page-break-inside:avoid}
@media print{
  .rp-page{margin:0 !important;box-shadow:none !important;page-break-after:always;break-after:page}
  .rp-page:last-child{page-break-after:auto;break-after:auto}
}`;
}

function hexA(hex, a) {
  const h = String(hex || '#000000').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16) || 0, g = parseInt(n.slice(2, 4), 16) || 0, b = parseInt(n.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}

/* ------------------------------------------------- pure page packer ------ */
/*
 * packBlocksIntoPages(measured, capacity, opts)
 *   measured: [{ id, h, keepWithNext, splittable, unitHeights?, unitOverhead? }]
 *     h            — full outer height of the block (px)
 *     unitHeights  — per-unit heights for splittable blocks
 *     unitOverhead — fixed wrapper overhead added to any chunk of units
 *   capacity: usable page height (px)
 * Returns: { pages: [[{ id, from?, to? }]], overflowBlocks: [id] }
 *   from/to (inclusive, 0-based unit indexes) present only for split chunks.
 * Rules:
 *   • never crop: a block taller than a whole empty page is placed alone and
 *     reported in overflowBlocks (the validator turns this into an error);
 *   • keepWithNext blocks are never left as the last item of a page;
 *   • splittable blocks keep ≥minLead units with their lead chunk and carry
 *     ≥minTail units onto the next page (orphan/widow control for bullets).
 */
export function packBlocksIntoPages(measured, capacity, opts = {}) {
  const minLead = opts.minLead ?? 2;
  const minTail = opts.minTail ?? 2;
  const pages = [];
  const overflowBlocks = [];
  let page = [];
  let used = 0;

  const newPage = () => { pages.push(page); page = []; used = 0; };
  const remaining = () => capacity - used;

  // What is the minimum amount of the NEXT block that must accompany a
  // keepWithNext block on the same page?
  const minNextChunk = (next) => {
    if (!next) return 0;
    if (next.splittable && next.unitHeights && next.unitHeights.length) {
      const lead = next.unitHeights.slice(0, Math.min(minLead, next.unitHeights.length));
      return (next.unitOverhead || 0) + lead.reduce((a, b) => a + b, 0);
    }
    return next.h;
  };

  for (let i = 0; i < measured.length; i++) {
    const b = measured[i];

    if (!b.splittable || !b.unitHeights || b.unitHeights.length < 2) {
      // atomic block
      let need = b.h;
      if (b.keepWithNext) need += minNextChunk(measured[i + 1]);
      if (need > remaining() && page.length) newPage();
      if (b.h > capacity) overflowBlocks.push(b.id); // taller than an empty page
      page.push({ id: b.id });
      used += b.h;
      continue;
    }

    // splittable block (bullet lists, skill group lines)
    let from = 0;
    const total = b.unitHeights.length;
    const overhead = b.unitOverhead || 0;
    const chunkH = (start, count) => overhead + b.unitHeights.slice(start, start + count).reduce((a, c) => a + c, 0);
    while (from < total) {
      const left = total - from;
      // how many units fit in the remaining space on this page?
      let fit = 0;
      let acc = overhead;
      for (let u = from; u < total; u++) {
        if (acc + b.unitHeights[u] <= remaining()) { acc += b.unitHeights[u]; fit++; }
        else break;
      }
      if (fit >= left) {
        // everything remaining fits on this page
        page.push(from === 0 && fit === total ? { id: b.id } : { id: b.id, from, to: total - 1 });
        used += acc;
        from = total;
        continue;
      }
      const requiredLead = from === 0 ? Math.min(minLead, left) : 1;
      if (fit < requiredLead) {
        if (page.length) { newPage(); continue; } // try a fresh page first
        // empty page and units still don't fit → force-place what we can
        const take = Math.max(1, fit);
        if (chunkH(from, take) > capacity && !overflowBlocks.includes(b.id)) overflowBlocks.push(b.id);
        page.push({ id: b.id, from, to: from + take - 1 });
        used += chunkH(from, take);
        from += take;
        if (from < total) newPage();
        continue;
      }
      // split here; widow control — leave at least minTail units for next page
      let take = fit;
      if (left - take < minTail) take = left - minTail;
      if (take < requiredLead) {
        if (page.length) { newPage(); continue; } // move the whole chunk instead
        take = requiredLead; // empty page edge case — honour lead minimum
      }
      page.push({ id: b.id, from, to: from + take - 1 });
      used += chunkH(from, take);
      from += take;
      newPage();
    }
  }
  if (page.length) pages.push(page);
  if (!pages.length) pages.push([]);
  return { pages, overflowBlocks };
}

/* ------------------------------------------------ DOM measure + paginate -- */

function chunkHTML(b, from, to) {
  if (from == null) return b.html;
  const units = b.units.slice(from, to + 1).join('');
  return `${b.wrapOpen}${units}${b.wrapClose}`;
}

function measureBlocksInDOM(blocks, css, contentWidth) {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-12000px;top:0;width:${contentWidth}px;background:#fff;z-index:-1;visibility:hidden;`;
  const style = document.createElement('style');
  style.textContent = css;
  host.appendChild(style);
  const root = document.createElement('div');
  root.className = 'rp-root';
  host.appendChild(root);

  const els = blocks.map((b) => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-block', b.id);
    wrap.innerHTML = b.html;
    root.appendChild(wrap);
    return wrap;
  });
  document.body.appendChild(host);

  const measured = blocks.map((b, i) => {
    const el = els[i];
    const cs = window.getComputedStyle(el.firstElementChild || el);
    const mb = parseFloat(cs.marginBottom) || 0;
    const mt = parseFloat(cs.marginTop) || 0;
    const h = el.getBoundingClientRect().height + mb + mt;
    let unitHeights = null;
    let unitOverhead = 0;
    if (b.splittable && b.units) {
      const items = el.querySelectorAll(':scope > * li');
      if (items.length === b.units.length) {
        unitHeights = Array.from(items).map((li) => {
          const lcs = window.getComputedStyle(li);
          return li.getBoundingClientRect().height + (parseFloat(lcs.marginTop) || 0) + (parseFloat(lcs.marginBottom) || 0);
        });
        unitOverhead = Math.max(0, h - unitHeights.reduce((a, c) => a + c, 0));
      } else {
        // skill-line style splittable (units are direct children)
        const kids = el.children;
        if (kids.length === b.units.length) {
          unitHeights = Array.from(kids).map((k) => {
            const kcs = window.getComputedStyle(k);
            return k.getBoundingClientRect().height + (parseFloat(kcs.marginTop) || 0) + (parseFloat(kcs.marginBottom) || 0);
          });
          unitOverhead = 0;
        }
      }
    }
    return { id: b.id, h, keepWithNext: b.keepWithNext, splittable: !!unitHeights, unitHeights, unitOverhead };
  });

  document.body.removeChild(host);
  return measured;
}

/**
 * paginateResume(data, templateId, opts) — browser only.
 * opts: { pageMode: 'auto'|'one-page'|'multi', size: 'a4'|'letter', density }
 * Returns {
 *   pages: [pageInnerHtml...], pageCount, css, size, density, template,
 *   fit: { requestedOnePage, fitsOnePage, message }, overflowBlocks
 * }
 * Auto-fit: in one-page mode the engine steps density comfortable→compact→
 * tight (font floor 9.5px). It NEVER crops — if content still doesn't fit it
 * returns multiple pages plus a clear warning message.
 */
export async function paginateResume(data, templateId, opts = {}) {
  const tpl = typeof templateId === 'string' ? getResumeTemplate(templateId) : templateId;
  const sizeId = opts.size || 'a4';
  const size = PAGE_SIZES[sizeId] || PAGE_SIZES.a4;
  const pageMode = opts.pageMode || (tpl.pageMode === 'one-page' ? 'one-page' : 'auto');

  const tryDensity = (densityId) => {
    const css = resumeCSS(tpl, densityId, sizeId);
    const den = DENSITIES[densityId];
    const contentWidth = size.width - (den.margin + 4) * 2;
    const { blocks } = buildResumeBlocks(data, tpl, opts);
    const measured = measureBlocksInDOM(blocks, css, contentWidth);
    const capacity = size.height - den.margin * 2;
    const packed = packBlocksIntoPages(measured, capacity);
    return { css, blocks, packed, densityId, capacity };
  };

  const startDensity = opts.density || tpl.theme?.density || 'compact';
  let attempt = tryDensity(startDensity);
  let fitsOnePage = attempt.packed.pages.length <= 1;
  if (pageMode === 'one-page' && !fitsOnePage) {
    const startIdx = DENSITY_STEPS.indexOf(attempt.densityId);
    for (let i = Math.max(0, startIdx + 1); i < DENSITY_STEPS.length && !fitsOnePage; i++) {
      const next = tryDensity(DENSITY_STEPS[i]);
      attempt = next;
      fitsOnePage = next.packed.pages.length <= 1;
    }
  }

  const blockById = new Map(attempt.blocks.map((b) => [b.id, b]));
  const pages = attempt.packed.pages.map((items) => items
    .map(({ id, from, to }) => {
      const b = blockById.get(id);
      return `<div class="rp-block" data-block="${id}" data-kind="${b.kind}"${b.keepWithNext ? ' data-keepnext="1"' : ''}>${chunkHTML(b, from, to)}</div>`;
    })
    .join(''));

  const requestedOnePage = pageMode === 'one-page';
  const message = requestedOnePage && !fitsOnePage
    ? 'Your resume has too much verified content for one page. Use two-page mode or remove lower-priority sections — content is never silently cut.'
    : '';

  return {
    pages,
    pageCount: pages.length,
    css: attempt.css,
    size: sizeId,
    density: attempt.densityId,
    template: tpl,
    overflowBlocks: attempt.packed.overflowBlocks,
    fit: { requestedOnePage, fitsOnePage, message },
  };
}

/* Compose a standalone HTML document from paginated pages (preview iframe,
   print export and the Template Lab all use this). */
export function composePagedDocumentHTML(paged, { forPrint = false, background = '#e9edf5' } = {}) {
  const size = PAGE_SIZES[paged.size] || PAGE_SIZES.a4;
  const pagesHtml = paged.pages
    .map((inner) => `<div class="rp-page"><div class="rp-root">${inner}</div></div>`)
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>resume</title>
<style>
@page{size:${size.css};margin:0}
html,body{margin:0;padding:0;background:${forPrint ? '#fff' : background}}
${paged.css}
${forPrint ? '' : `@media screen{.rp-page{box-shadow:0 6px 32px rgba(8,12,24,.28);margin:16px auto}}`}
</style></head><body>${pagesHtml}</body></html>`;
}

/* ----------------------------------------------------------- validation --- */

/* Paginate + mount hidden + run the layout validator. One call used by the
   preview modal, the editor and the Template Lab so export gating is uniform. */
export async function renderAndValidate(data, templateId, opts = {}) {
  const { validateResumeLayout } = await import('./resumeLayoutValidator.js');
  const paged = await paginateResume(data, templateId, opts);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-14000px;top:0;z-index:-1;visibility:hidden;background:#fff;';
  const style = document.createElement('style');
  style.textContent = paged.css;
  host.appendChild(style);
  const wrap = document.createElement('div');
  wrap.innerHTML = paged.pages.map((inner) => `<div class="rp-page"><div class="rp-root">${inner}</div></div>`).join('');
  host.appendChild(wrap);
  document.body.appendChild(host);
  let report;
  try {
    report = validateResumeLayout(wrap, {
      expectedPageMode: opts.pageMode || 'auto',
      overflowBlocks: paged.overflowBlocks,
      fit: paged.fit,
      template: paged.template,
    });
  } finally {
    document.body.removeChild(host);
  }
  return { paged, report };
}

/* ---------------------------------------------------------------- export -- */

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { downloadBlob as triggerDownload };

/**
 * PDF export (primary): print pipeline → selectable text, exact page margins,
 * identical rendering to the preview (same paginator + CSS). Opens the print
 * dialog where the user picks "Save as PDF".
 */
export async function exportResumePDF(data, templateId, opts = {}) {
  const paged = opts.paged || await paginateResume(data, templateId, opts);
  const html = composePagedDocumentHTML(paged, { forPrint: true });
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);
  await new Promise((resolve) => {
    frame.onload = resolve;
    frame.srcdoc = html;
  });
  await new Promise((r) => setTimeout(r, 120)); // fonts/layout settle
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => { try { document.body.removeChild(frame); } catch { /* noop */ } }, 60000);
  return paged;
}

/**
 * Snapshot PDF (fallback): renders each paginated page to canvas and writes a
 * one-image-per-page PDF (direct download, pixel-identical to preview, but
 * text is not selectable — the UI labels it honestly).
 */
export async function exportResumeSnapshotPDF(data, templateId, opts = {}) {
  const { default: jsPDF } = await import('jspdf');
  const html2canvas = (await import('html2canvas')).default;
  const paged = opts.paged || await paginateResume(data, templateId, opts);
  const size = PAGE_SIZES[paged.size] || PAGE_SIZES.a4;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-14000px;top:0;width:${size.width}px;background:#fff;z-index:-1;`;
  const style = document.createElement('style');
  style.textContent = paged.css;
  host.appendChild(style);
  const wrap = document.createElement('div');
  wrap.innerHTML = paged.pages.map((inner) => `<div class="rp-page"><div class="rp-root">${inner}</div></div>`).join('');
  host.appendChild(wrap);
  document.body.appendChild(host);

  try {
    await new Promise((r) => setTimeout(r, 80));
    const format = paged.size === 'letter' ? 'letter' : 'a4';
    const pdf = new jsPDF({ unit: 'pt', format, compress: true });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const pageEls = wrap.querySelectorAll('.rp-page');
    let first = true;
    for (const el of pageEls) {
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: size.width, width: size.width });
      if (!first) pdf.addPage();
      first = false;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pw, ph, undefined, 'FAST');
    }
    pdf.save(opts.fileName || 'resume.pdf');
  } finally {
    setTimeout(() => { try { document.body.removeChild(host); } catch { /* noop */ } }, 200);
  }
  return paged;
}

/* DOCX export — clean single-column section structure that Word/Google Docs
   open without broken tables or parser-breaking visual styling. */
export function exportResumeDOCX(data, templateId, { fileName = 'resume.doc' } = {}) {
  const tpl = typeof templateId === 'string' ? getResumeTemplate(templateId) : templateId;
  const { blocks } = buildResumeBlocks(data, tpl);
  const css = resumeCSS(tpl, tpl.theme?.density || 'compact', 'a4')
    // strip the fixed page sizing for Word — @page handles it there
    .replace(/\.rp-page\{[^}]*\}/, '.rp-page{background:#fff}');
  const body = blocks.map((b) => `<div class="rp-block">${b.html}</div>`).join('');
  const docHTML = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page{size:A4;margin:1.6cm}
${css}
body{font-family:${tpl.theme?.font || 'Arial, sans-serif'}}
</style></head>
<body><div class="rp-root">${body}</div></body></html>`;
  const blob = new Blob(['\ufeff', docHTML], { type: 'application/msword' });
  downloadBlob(blob, fileName.replace(/\.docx$/i, '.doc'));
}
