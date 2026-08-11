/* ============================================================
   TEMPLATE OS — VECTOR PDF WRITER
   ------------------------------------------------------------
   Emits a REAL PDF (selectable text layer, base-14 fonts) from a
   compiled layout tree — no browser, no canvas, no dependencies.
   Two things this buys that the print path cannot:

     1. TEXT-LAYER TRUTH. Certification can extract text from an
        actual PDF and measure field recovery + reading order on
        what an ATS would really see.
     2. OWNED PAGINATION. Sidebar and two-column layouts are
        paginated by this writer using real font metrics, instead
        of relying on the browser's print page breaks.

   Content-stream order is SEMANTIC (columns emitted by earliest
   declared section, exactly like the HTML compiler), so extracted
   order matches resume order even when a rail is visually left.
   ============================================================ */
import { normalizeStructuredContent } from './compiler.js';
import { resolveRenderDesign, CSS_PX_TO_PT, MM_TO_PT } from './renderDesign.js';

export const PDF_WRITER_VERSION = 'template-pdf-writer-v18-owned-pagination-reference-premium-families';
export const OWNED_PAGINATION_VERSION = 'owned-pagination-v2-semantic-groups';

/* ---------------- base-14 metrics (units/1000) ---------------- */
const W = (s) => { const o = {}; const parts = s.split(' '); for (let i = 0; i < parts.length; i += 2) o[parts[i]] = Number(parts[i + 1]); return o; };
const DIGIT = (v) => Object.fromEntries('0123456789'.split('').map((c) => [c, v]));
const HELV = { ...W('space 278 ! 278 " 355 # 556 $ 556 % 889 & 667 \' 191 ( 333 ) 333 * 389 + 584 , 278 - 333 . 278 / 278 : 278 ; 278 < 584 = 584 > 584 ? 556 @ 1015 A 667 B 667 C 722 D 722 E 667 F 611 G 778 H 722 I 278 J 500 K 667 L 556 M 833 N 722 O 778 P 667 Q 778 R 722 S 667 T 611 U 722 V 667 W 944 X 667 Y 667 Z 611 [ 278 \\ 278 ] 278 ^ 469 _ 556 ` 333 a 556 b 556 c 500 d 556 e 556 f 278 g 556 h 556 i 222 j 222 k 500 l 222 m 833 n 556 o 556 p 556 q 556 r 333 s 500 t 278 u 556 v 500 w 722 x 500 y 500 z 500 { 334 | 260 } 334 ~ 584'), ...DIGIT(556) };
const HELVB = { ...W('space 278 ! 333 " 474 # 556 $ 556 % 889 & 722 \' 238 ( 333 ) 333 * 389 + 584 , 278 - 333 . 278 / 278 : 333 ; 333 < 584 = 584 > 584 ? 611 @ 975 A 722 B 722 C 722 D 722 E 667 F 611 G 778 H 722 I 278 J 556 K 722 L 611 M 833 N 722 O 778 P 667 Q 778 R 722 S 667 T 611 U 722 V 667 W 944 X 667 Y 667 Z 611 [ 333 \\ 278 ] 333 ^ 584 _ 556 ` 333 a 556 b 611 c 556 d 611 e 556 f 333 g 611 h 611 i 278 j 278 k 556 l 278 m 889 n 611 o 611 p 611 q 611 r 389 s 556 t 333 u 611 v 556 w 778 x 556 y 556 z 500 { 389 | 280 } 389 ~ 584'), ...DIGIT(556) };
const TIMES = { ...W('space 250 ! 333 " 408 # 500 $ 500 % 833 & 778 \' 180 ( 333 ) 333 * 500 + 564 , 250 - 333 . 250 / 278 : 278 ; 278 < 564 = 564 > 564 ? 444 @ 921 A 722 B 667 C 667 D 722 E 611 F 556 G 722 H 722 I 333 J 389 K 722 L 611 M 889 N 722 O 722 P 556 Q 722 R 667 S 556 T 611 U 722 V 722 W 944 X 722 Y 722 Z 611 [ 333 \\ 278 ] 333 ^ 469 _ 500 ` 333 a 444 b 500 c 444 d 500 e 444 f 333 g 500 h 500 i 278 j 278 k 500 l 278 m 778 n 500 o 500 p 500 q 500 r 333 s 389 t 278 u 500 v 500 w 722 x 500 y 500 z 444 { 480 | 200 } 480 ~ 541'), ...DIGIT(500) };
const TIMESB = { ...W('space 250 ! 333 " 555 # 500 $ 500 % 1000 & 833 \' 278 ( 333 ) 333 * 500 + 570 , 250 - 333 . 250 / 278 : 333 ; 333 < 570 = 570 > 570 ? 500 @ 930 A 722 B 667 C 722 D 722 E 667 F 611 G 778 H 778 I 389 J 500 K 778 L 667 M 944 N 722 O 778 P 611 Q 778 R 722 S 556 T 667 U 722 V 722 W 1000 X 722 Y 722 Z 667 [ 333 \\ 278 ] 333 ^ 581 _ 500 ` 333 a 500 b 556 c 444 d 556 e 444 f 333 g 500 h 556 i 278 j 333 k 556 l 278 m 833 n 556 o 500 p 556 q 556 r 444 s 389 t 333 u 556 v 500 w 722 x 500 y 500 z 444 { 394 | 220 } 394 ~ 520'), ...DIGIT(500) };

const COURIER = Object.fromEntries(Array.from({ length: 224 }, (_, i) => [String.fromCharCode(i + 32), 600]));
COURIER.space = 600;
const COURIERB = { ...COURIER };

export const PDF_FONTS = {
  helv: { key: 'F1', base: 'Helvetica', widths: HELV },
  helvB: { key: 'F2', base: 'Helvetica-Bold', widths: HELVB },
  times: { key: 'F3', base: 'Times-Roman', widths: TIMES },
  timesB: { key: 'F4', base: 'Times-Bold', widths: TIMESB },
  courier: { key: 'F5', base: 'Courier', widths: COURIER },
  courierB: { key: 'F6', base: 'Courier-Bold', widths: COURIERB },
};

/* ---------------- WinAnsi text encoding ---------------- */
/* Base-14 fonts cover WinAnsi only. Characters outside it are
   transliterated deterministically; certification applies the SAME
   transform to its expectations so the comparison stays honest.
   Non-Latin scripts need embedded fonts — see TEMPLATE-OS-V1.md.  */
const WINANSI_EXTRA = { '\u20AC': 128, '\u201A': 130, '\u0192': 131, '\u201E': 132, '\u2026': 133, '\u2020': 134, '\u2021': 135, '\u02C6': 136, '\u2030': 137, '\u0160': 138, '\u2039': 139, '\u0152': 140, '\u017D': 142, '\u2018': 145, '\u2019': 146, '\u201C': 147, '\u201D': 148, '\u2022': 149, '\u2013': 150, '\u2014': 151, '\u02DC': 152, '\u2122': 153, '\u0161': 154, '\u203A': 155, '\u0153': 156, '\u017E': 158, '\u0178': 159 };

export function pdfEncodeText(input) {
  let out = '';
  for (const ch of String(input ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp >= 32 && cp <= 126) { out += ch; continue; }
    if (WINANSI_EXTRA[ch] !== undefined) { out += ch; continue; }
    if (cp >= 160 && cp <= 255) { out += ch; continue; }
    /* transliterate: strip diacritics, else drop */
    const folded = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    out += /^[\x20-\x7e\u00a0-\u00ff]+$/.test(folded) ? folded : '';
  }
  return out;
}

const byteOf = (ch) => (WINANSI_EXTRA[ch] !== undefined ? WINANSI_EXTRA[ch] : ch.codePointAt(0));

function pdfString(text) {
  let out = '';
  for (const ch of pdfEncodeText(text)) {
    const b = byteOf(ch);
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (b < 32 || b > 126) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += ch;
  }
  return out;
}

export function textWidth(text, font, size) {
  let w = 0;
  for (const ch of pdfEncodeText(text)) {
    const name = ch === ' ' ? 'space' : ch;
    w += font.widths[name] ?? 500;
  }
  return (w / 1000) * size;
}

export function wrapText(text, font, size, maxWidth) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = []; let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, font, size) <= maxWidth || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

/* ---------------- page + block model ---------------- */
const MM = MM_TO_PT;
const PX = CSS_PX_TO_PT; // shared css px (96dpi) → pt

const hexRgb = (hex) => {
  const h = String(hex || '#111827').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const tokenColor = (tokens, token, fallback = '#111827') => {
  if (!token) return fallback;
  if (token === 'accent') return tokens.colors.accent;
  if (token === 'rule') return tokens.colors.rule;
  if (token === 'sidebarBg') return tokens.colors.sidebarBg;
  if (token === 'muted') return tokens.colors.muted;
  if (token === 'text') return tokens.colors.text;
  return String(token).startsWith('#') ? token : fallback;
};

const SECTION_TITLES = { summary: 'Summary', skills: 'Skills', experience: 'Experience', projects: 'Projects', education: 'Education', certifications: 'Certifications', achievements: 'Achievements', publications: 'Publications', patents: 'Patents', volunteer: 'Volunteer Experience', languages: 'Languages', customSections: 'Additional' };

function fontsFor(tokens) {
  const serif = /georgia|times|serif/i.test(tokens.typography.font || '');
  const body = serif ? PDF_FONTS.times : PDF_FONTS.helv;
  const bold = serif ? PDF_FONTS.timesB : PDF_FONTS.helvB;
  const mono = tokens.typography.monoAccent ? PDF_FONTS.courier : body;
  const monoBold = tokens.typography.monoAccent ? PDF_FONTS.courierB : bold;
  return { body, bold, mono, monoBold };
}

/* Turn one section into atomic blocks for a given column width. */
function sectionBlocks(key, d, tokens, width, f, sizes, { region = 'main', isFirstInRegion = false, sidebar = null, columns = null, summary = null, skills = null, experience = null, projects = null, education = null } = {}) {
  const out = [];
  const push = (text, opts = {}) => out.push({
    text, font: opts.font || (opts.bold ? f.bold : f.body), size: opts.size || sizes.body, indent: opts.indent || 0,
    color: opts.color || null, gapBefore: opts.gapBefore || 0, keepWithNext: !!opts.keepWithNext, keepWithNextLines: Math.max(0, Number(opts.keepWithNextLines || 0)),
    ruleAfter: opts.ruleAfter || null, accentMarker: opts.accentMarker || null, metaMarker: opts.metaMarker || null,
    rightText: opts.rightText || null, rightFont: opts.rightFont || f.body,
    rightSize: opts.rightSize || sizes.meta, rightColor: opts.rightColor || tokens.colors.muted,
    segments: opts.segments || null,
    chips: opts.chips || null,
    chipStyle: opts.chipStyle || null,
    sectionKey: key, sectionStart: !!opts.sectionStart,
  });
  const para = (text, opts = {}) => {
    const font = opts.font || (opts.bold ? f.bold : f.body);
    const w = width - (opts.indent || 0);
    const lines = wrapText(text, font, opts.size || sizes.body, w);
    lines.forEach((line, i) => push(line, {
      ...opts,
      font,
      gapBefore: i === 0 ? (opts.gapBefore || 0) : 0,
      accentMarker: i === 0 ? (opts.accentMarker || null) : null,
      metaMarker: i === 0 ? (opts.metaMarker || null) : null,
      keepWithNext: i === 0 ? !!opts.keepWithNext : false,
    }));
  };
  const pairedLine = (left, right, opts = {}) => {
    const leftFont = opts.font || (opts.bold ? f.bold : f.body);
    const leftSize = opts.size || sizes.body;
    const rightFont = opts.rightFont || f.body;
    const rightSize = opts.rightSize || sizes.meta;
    const rightW = right ? textWidth(right, rightFont, rightSize) : 0;
    const reserve = right ? rightW + (opts.rightGap || 8) : 0;
    const lines = wrapText(left, leftFont, leftSize, Math.max(48, width - (opts.indent || 0) - reserve));
    if (!lines.length && right) lines.push('');
    lines.forEach((line, i) => push(line, {
      ...opts,
      font: leftFont,
      rightText: i === 0 ? right : null,
      rightFont,
      rightSize,
      gapBefore: i === 0 ? (opts.gapBefore || 0) : 0,
      keepWithNext: i === 0 ? !!opts.keepWithNext : false,
    }));
  };
  const bullets = (list, indent = 8, opts = {}) => {
    let bulletIndex = 0;
    for (const b of list || []) {
      const lines = wrapText(b, f.body, sizes.body, width - indent - 8);
      const topGap = bulletIndex === 0 ? (opts.topGap || 0) : (opts.betweenGap || 0);
      lines.forEach((line, i) => push(i === 0 ? `\u2022  ${line}` : `   ${line}`, {
        indent,
        gapBefore: i === 0 ? topGap : 0,
        keepWithNext: i === 0 && lines.length > 1,
      }));
      bulletIndex += 1;
    }
  };
  const headingRule = () => {
    let ruleAfter = null;
    if (tokens.divider?.id === 'hairline') ruleAfter = { width: 'full', thickness: 0.6 * PX, color: tokens.colors.rule };
    if (tokens.divider?.id === 'accent-rule') ruleAfter = { width: 'full', thickness: 1.6 * PX, color: tokens.colors.accent };
    if (tokens.divider?.id === 'short-rule') ruleAfter = { width: 34 * PX, thickness: 2 * PX, color: tokens.colors.accent };
    if (tokens.divider?.id === 'editorial-line') ruleAfter = { width: 'remaining', startAfterText: true, gap: 10 * PX, thickness: 0.8 * PX, color: tokens.colors.rule };
    if (region === 'sidebar' && sidebar?.headingRule === 'short-accent') ruleAfter = { width: (sidebar.headingRuleWidthPx || 28) * PX, thickness: 1.5 * PX, color: tokens.colors.accent };
    if (region === 'sidebar' && sidebar?.headingRule === 'subtle-inverse') ruleAfter = { width: 'full', thickness: 0.7, color: sidebar.ruleColor || '#475569' };
    return ruleAfter;
  };
  const pushSectionHeading = (title, { first = isFirstInRegion, sectionStart = true } = {}) => {
    const isReferenceRegion = columns?.referenceRegion && region === columns.referenceRegion;
    const headingSize = isReferenceRegion ? sizes.heading * (columns.referenceHeadingScale || 1) : sizes.heading;
    const sectionGap = isReferenceRegion ? sizes.sectionGap * (columns.referenceSectionGapScale || 1) : sizes.sectionGap;
    push(String(title || 'Additional').toUpperCase(), {
      bold: true, size: headingSize, color: tokens.colors.accent,
      gapBefore: first && (region === 'sidebar' || isReferenceRegion) ? 0 : sectionGap,
      keepWithNext: true, keepWithNextLines: 2, ruleAfter: headingRule(), sectionStart,
    });
  };

  const body = [];
  if (key === 'summary' && d.summary) body.push(() => para(d.summary, {
    size: summary?.sizePt || sizes.body,
    color: summary?.color || tokens.colors.text,
  }));
  if (key === 'skills' && d.skills?.length) {
    body.push(() => {
      const sd = skills || {};
      const mode = sd.mode || tokens.skills.mode || 'categorized';
      const delimiter = sd.delimiter || tokens.skills.delimiter || ' · ';
      const labelFor = (value) => {
        const raw = d.languages?.length && /^languages?$/i.test(String(value || '').trim()) ? 'Programming Languages' : String(value || '');
        return sd.labelCase === 'upper' ? raw.toUpperCase() : raw;
      };
      const labelColor = sd.labelColor || tokens.colors.text;
      const itemSize = region === 'sidebar' ? (sd.sidebarItemPt || sizes.small) : (sd.itemPt || sizes.body);
      const labelSize = region === 'sidebar' ? (sd.sidebarLabelPt || sizes.skillGroup) : (sd.labelPt || sizes.skillGroup);
      let groupIndex = 0;
      for (const g of d.skills) {
        if (!(g.items || []).length) continue;
        const groupGap = groupIndex > 0 ? (sd.groupGapPt || 3.2) : 0;
        const label = labelFor(g.group);
        const items = g.items.join(delimiter);
        if (mode === 'chips') {
          const chipTexts = (g.items || []).map((item, index) => `${index === 0 && label ? `${label}: ` : ''}${item}`);
          const padX = sd.chipPadXPt || 6;
          const gapX = sd.chipGapXPt || 3.75;
          const rows = [];
          let row = []; let used = 0;
          for (const text of chipTexts) {
            const chipWidth = Math.min(width, textWidth(text, f.bold, itemSize) + padX * 2);
            if (row.length && used + gapX + chipWidth > width) { rows.push(row); row = []; used = 0; }
            row.push({ text, width: chipWidth });
            used += (row.length > 1 ? gapX : 0) + chipWidth;
          }
          if (row.length) rows.push(row);
          rows.forEach((chips, rowIndex) => push('', {
            size: itemSize,
            gapBefore: rowIndex === 0 ? groupGap : (sd.chipGapYPt || 3),
            chips,
            chipStyle: {
              padX, padY: sd.chipPadYPt || 2.25, gapX,
              fillColor: tokenColor(tokens, sd.chipFillToken, tokens.colors.sidebarBg),
              borderColor: tokenColor(tokens, sd.chipBorderToken, tokens.colors.rule),
              textColor: tokenColor(tokens, sd.chipTextToken, tokens.colors.accent),
            },
          }));
        } else if (mode === 'sidebar-groups') {
          para(label, { bold: true, size: labelSize, color: labelColor, gapBefore: groupGap, keepWithNext: true });
          para(items, { size: itemSize, gapBefore: sd.labelGapPt || 1.6 });
        } else if (mode === 'stack') {
          para(label, { bold: true, size: labelSize, color: labelColor, gapBefore: groupGap });
          for (const item of g.items) para(item, { size: sizes.small, indent: 4 });
        } else if (mode === 'plain') {
          para(g.items.join(', '), { size: itemSize, gapBefore: groupGap });
        } else if (mode === 'categorized') {
          para(label, { bold: true, size: labelSize, color: labelColor, gapBefore: groupGap, keepWithNext: true });
          para(items, { size: itemSize, gapBefore: sd.labelGapPt || 1.7 });
        } else if (mode === 'inline' || mode === 'matrix') {
          const prefix = `${label}: `;
          const prefixW = textWidth(prefix, f.bold, labelSize);
          const itemsW = textWidth(items, f.body, itemSize);
          if (prefixW + itemsW <= width) {
            push('', {
              size: Math.max(labelSize, itemSize), gapBefore: groupGap,
              segments: [
                { text: prefix, font: f.bold, size: labelSize, color: labelColor },
                { text: items, font: f.body, size: itemSize, color: tokens.colors.text },
              ],
            });
          } else {
            para(label, { bold: true, size: labelSize, color: labelColor, gapBefore: groupGap, keepWithNext: true });
            para(items, { size: itemSize, gapBefore: sd.labelGapPt || 1.5 });
          }
        } else {
          para(`${label}: ${items}`, { size: itemSize, gapBefore: groupGap });
        }
        groupIndex += 1;
      }
    });
  }
  if (key === 'experience' && d.experience?.length) {
    body.push(() => {
      const xd = experience || {};
      let itemIndex = 0;
      for (const e of d.experience) {
        const itemGap = itemIndex > 0 ? (xd.itemGapPt || 0) : 0;
        const companyColor = xd.companyTone === 'accent' ? tokens.colors.accent
          : xd.companyTone === 'muted' ? tokens.colors.muted : tokens.colors.text;
        const locationColor = xd.locationTone === 'accent' ? tokens.colors.accent
          : xd.locationTone === 'text' ? tokens.colors.text : tokens.colors.muted;
        if (xd.headerLayout === 'inline') {
          const left = [e.role, e.company, e.location].filter(Boolean).join('  \u00b7  ');
          pairedLine(left, e.dates || '', {
            bold: true, size: sizes.role, rightSize: sizes.meta, rightFont: f.body,
            rightColor: tokens.colors.muted, rightGap: xd.dateGapPt || 8,
            gapBefore: itemGap, keepWithNext: true, keepWithNextLines: 2,
          });
        } else {
          pairedLine(e.role || '', e.dates || '', {
            bold: true, size: sizes.role, rightSize: sizes.meta, rightFont: f.body,
            rightColor: tokens.colors.muted, rightGap: xd.dateGapPt || 8,
            gapBefore: itemGap, keepWithNext: true, keepWithNextLines: 2,
          });
          if (e.company && e.location) {
            const sep = '  \u00b7  ';
            const companyW = textWidth(e.company, f.body, sizes.company);
            const sepW = textWidth(sep, f.body, sizes.meta);
            const locationW = textWidth(e.location, f.body, sizes.meta);
            if (companyW + sepW + locationW <= width) {
              push('', {
                size: sizes.company, gapBefore: xd.metaGapPt || 0, keepWithNext: true,
                segments: [
                  { text: e.company, font: f.body, size: sizes.company, color: companyColor },
                  { text: sep, font: f.body, size: sizes.meta, color: tokens.colors.rule },
                  { text: e.location, font: f.body, size: sizes.meta, color: locationColor },
                ],
              });
            } else {
              para(e.company, { size: sizes.company, color: companyColor, gapBefore: xd.metaGapPt || 0, keepWithNext: true });
              para(e.location, { size: sizes.meta, color: locationColor, keepWithNext: true });
            }
          } else if (e.company) {
            para(e.company, { size: sizes.company, color: companyColor, gapBefore: xd.metaGapPt || 0, keepWithNext: true });
          } else if (e.location) {
            para(e.location, { size: sizes.meta, color: locationColor, gapBefore: xd.metaGapPt || 0, keepWithNext: true });
          }
        }
        if (xd.stackLine && e.stack) {
          if (xd.stackLabel) {
            push('', {
              size: sizes.meta, gapBefore: xd.stackGapPt || 0,
              segments: [
                { text: `${xd.stackLabel}  `, font: f.bold, size: Math.max(sizes.small, sizes.meta - 0.55), color: tokens.colors.accent },
                { text: e.stack, font: xd.stackFont === 'mono' ? f.mono : f.body, size: sizes.meta, color: tokens.colors.muted },
              ],
            });
          } else {
            para(e.stack, {
              font: xd.stackFont === 'mono' ? f.mono : f.body,
              size: sizes.meta, color: tokens.colors.muted, gapBefore: xd.stackGapPt || 0,
            });
          }
        }
        bullets(e.bullets, xd.bulletIndentPt || 8, {
          topGap: xd.bulletTopGapPt || 0,
          betweenGap: Math.min(2.2, (tokens.spacing?.bulletGapPx || 0) * PX * 0.45),
        });
        itemIndex += 1;
      }
    });
  }
  if (key === 'projects' && d.projects?.length) {
    body.push(() => {
      const pd = projects || {};
      const maxBullets = Number.isFinite(Number(pd.maxBullets)) ? Number(pd.maxBullets) : (tokens.projects.tight ? 2 : 99);
      let projectIndex = 0;
      for (const p of d.projects) {
        const itemGap = projectIndex === 0 ? 0 : (pd.itemGapPt || sizes.meta * 0.55);
        const showBadge = !!(pd.badge && p.verified);
        if (pd.headerLayout === 'inline') {
          const parts = [p.name || '', p.tech || '', showBadge ? (pd.badgeLabel || 'VERIFIED') : '', p.link || ''].filter(Boolean);
          para(parts.join('  ·  '), { bold: true, size: sizes.role, gapBefore: itemGap, keepWithNext: true, keepWithNextLines: 2 });
        } else if (showBadge) {
          pairedLine(p.name || '', pd.badgeLabel || 'VERIFIED', {
            bold: true, size: Math.max(sizes.body, sizes.role - 0.15),
            rightFont: f.bold, rightSize: Math.max(sizes.small - 0.25, sizes.body * 0.72),
            rightColor: tokens.colors.accent, rightGap: 8,
            gapBefore: itemGap, keepWithNext: true, keepWithNextLines: 2,
          });
        } else {
          para(p.name || '', { bold: true, size: Math.max(sizes.body, sizes.role - 0.15), gapBefore: itemGap, keepWithNext: true, keepWithNextLines: 2 });
        }

        if (pd.headerLayout !== 'inline' && (p.tech || p.link)) {
          const techFont = pd.techFont === 'mono' ? f.mono : f.body;
          const techMarker = tokens.visual?.projectMeta?.marker
            ? { color: tokenColor(tokens, tokens.visual.projectMeta.markerColorToken, tokens.colors.accent) }
            : null;
          const linkW = p.link ? textWidth(p.link, f.body, sizes.meta) : 0;
          const canSplit = p.tech && p.link && linkW <= width * (pd.linkMaxShare || 0.46);
          if (canSplit) {
            pairedLine(p.tech, p.link, {
              font: techFont, size: sizes.meta, color: tokens.colors.muted,
              rightFont: f.body, rightSize: Math.max(sizes.small - 0.1, sizes.meta - 0.1), rightColor: tokens.colors.accent,
              rightGap: 9, gapBefore: pd.metaGapPt || 0, keepWithNext: true,
              metaMarker: techMarker, indent: techMarker ? 7 : 0,
            });
          } else {
            if (p.tech) para(p.tech, {
              font: techFont, size: sizes.meta, color: tokens.colors.muted,
              gapBefore: pd.metaGapPt || 0, keepWithNext: !!p.link,
              metaMarker: techMarker, indent: techMarker ? 7 : 0,
            });
            if (p.link) para(p.link, {
              size: Math.max(sizes.small - 0.1, sizes.meta - 0.1), color: tokens.colors.accent,
              gapBefore: p.tech ? 0.4 : (pd.metaGapPt || 0), keepWithNext: true,
            });
          }
        }
        bullets((p.bullets || []).slice(0, maxBullets), pd.bulletIndentPt || 8, {
          topGap: pd.bulletTopGapPt || 0,
          betweenGap: Math.min(2.2, (tokens.spacing?.bulletGapPx || 0) * PX * 0.45),
        });
        projectIndex += 1;
      }
    });
  }
  if (key === 'education' && d.education?.length) {
    body.push(() => {
      const ed = education || {};
      let index = 0;
      for (const e of d.education) {
        const gapBefore = index === 0 ? 0 : (ed.itemGapPt || sizes.meta * 0.55);
        if (ed.layout === 'featured') {
          pairedLine(e.school || '', e.dates || '', {
            bold: true, size: ed.schoolPt || sizes.role, color: ed.schoolColor || tokens.colors.text,
            rightFont: f.bold, rightSize: sizes.meta, rightColor: tokens.colors.muted,
            rightGap: ed.dateGapPt || 8, gapBefore, keepWithNext: true,
          });
          if (e.degree) para(e.degree, {
            bold: (ed.degreeWeight || 600) >= 600, size: ed.degreePt || sizes.meta,
            color: ed.degreeColor || tokens.colors.accent, gapBefore: ed.degreeGapPt || 0, keepWithNext: !!e.details,
          });
          if (e.details) para(e.details, {
            size: ed.detailsPt || sizes.meta, color: ed.detailsColor || tokens.colors.muted,
            gapBefore: ed.detailsGapPt || 0,
          });
        } else {
          para(`${e.school || ''}${e.degree ? ` \u2014 ${e.degree}` : ''}`, { bold: true, size: sizes.role, gapBefore, keepWithNext: true });
          if (e.dates) para(e.dates, { size: sizes.meta, color: tokens.colors.muted });
          if (e.details) para(e.details, { size: sizes.meta });
        }
        index += 1;
      }
    });
  }
  if (key === 'certifications' && d.certifications?.length) body.push(() => {
    const cb = tokens.visual?.certificationBlock || {};
    let certIndex = 0;
    for (const cert of d.certifications) {
      const accent = cb.markerWidthPx > 0
        ? { width: cb.markerWidthPx * PX, color: tokenColor(tokens, cb.markerColorToken, tokens.colors.accent) }
        : null;
      para(cert, {
        indent: accent ? Math.max(8, (cb.markerGapPx + cb.markerWidthPx) * PX) : 0,
        accentMarker: accent,
        bold: (cb.fontWeight || 400) >= 600,
        gapBefore: certIndex > 0 ? (cb.itemGapPx || 0) * PX : 0,
      });
      certIndex += 1;
    }
  });
  if (key === 'achievements' && d.achievements?.length) body.push(() => bullets(d.achievements, 6));
  if (key === 'publications' && d.publications?.length) body.push(() => {
    let i = 0;
    for (const item of d.publications) {
      para(item, { indent: 8, metaMarker: { color: tokens.colors.accent }, gapBefore: i > 0 ? Math.max(1.2, sizes.body * 0.22) : 0 });
      i += 1;
    }
  });
  if (key === 'patents' && d.patents?.length) body.push(() => {
    let i = 0;
    for (const item of d.patents) {
      para(item, { indent: 8, metaMarker: { color: tokens.colors.accent }, gapBefore: i > 0 ? Math.max(1.2, sizes.body * 0.22) : 0 });
      i += 1;
    }
  });
  if (key === 'volunteer' && d.volunteer?.length) body.push(() => bullets(d.volunteer, 6));
  if (key === 'languages' && d.languages?.length) body.push(() => para(d.languages.join('  ·  ')));
  if (key === 'customSections' && d.customSections?.length) {
    let rendered = 0;
    for (const custom of d.customSections) {
      if (!(custom?.items || []).length) continue;
      pushSectionHeading(custom.title || 'Additional', { first: rendered === 0 ? isFirstInRegion : false, sectionStart: rendered === 0 });
      bullets(custom.items, 6);
      rendered += 1;
    }
    return rendered ? out : [];
  }

  if (!body.length) return [];
  pushSectionHeading(SECTION_TITLES[key]);
  body[0]();
  return out;
}

/**
 * Render a compiled Template OS layout to a real PDF.
 * @returns {{ bytes: Uint8Array, pageCount: number, lineCount: number, columns: object[] }}
 */
export function renderTemplatePdf(compiled, structuredInput, { sizeId = 'a4', rebalanceOrphans = true } = {}) {
  if (!compiled?.ok) throw new Error('renderTemplatePdf needs a successfully compiled template');
  const d = normalizeStructuredContent(structuredInput);
  const { tree, tokens } = compiled;
  const design = resolveRenderDesign(compiled, { sizeId });
  const page = design.page.pdf;
  const f = fontsFor(tokens);
  const margin = design.spacing.marginPt;
  const sizes = {
    body: design.typography.bodyPt,
    small: design.typography.smallPt,
    meta: design.typography.metaPt,
    contact: design.typography.contactPt,
    skillGroup: design.typography.skillGroupPt,
    title: design.typography.titlePt,
    role: design.typography.rolePt,
    company: design.typography.companyPt,
    heading: design.typography.headingPt,
    name: design.typography.namePt,
    sectionGap: design.spacing.sectionGapPt,
  };
  const leading = design.typography.lineHeight;
  const lineH = (s) => s * leading;
  const contentW = page.w - margin * 2;
  const gutter = design.spacing.columnGapPt;

  /* column geometry */
  const isMulti = tree.layoutType !== 'single-column';
  const cols = isMulti ? tree.columns : [{ id: 'main', width: 1 }];
  const singleScale = isMulti ? 1 : (design.singleColumn?.contentWidthScale || 1);
  const singleInset = isMulti ? 0 : (contentW * (1 - singleScale)) / 2;
  const usableW = (contentW - (isMulti ? gutter : 0)) * singleScale;
  let cursorX = margin + singleInset;
  const geom = new Map();
  for (const c of cols) {
    const w = usableW * c.width;
    geom.set(c.id, { x: cursorX, w, pad: c.id === 'sidebar' ? design.sidebar.paddingXPt : 0 });
    cursorX += w + gutter;
  }

  /* ---- header (page 1, full width) ---- */
  const headerItems = [];
  const headerDecorLines = [];
  const nameText = design.header.nameCase === 'caps' ? (d.personalInfo.name || '').toUpperCase() : (d.personalInfo.name || '');
  const rawTitle = d.personalInfo.title || '';
  const titleText = design.header.titleCase === 'upper' ? rawTitle.toUpperCase() : rawTitle;
  const contactBits = [d.personalInfo.email, d.personalInfo.phone, d.personalInfo.location, d.personalInfo.linkedin, d.personalInfo.github, d.personalInfo.portfolio, ...(d.personalInfo.links || [])].filter(Boolean);
  const contactFont = design.header.mono ? f.mono : f.body;
  const contentLeft = margin;
  const contentRight = page.w - margin;
  const contentWidth = contentRight - contentLeft;
  const bandOutset = design.header.band ? design.header.bandOutsetMm * MM : 0;
  const headerPaddingX = design.header.band ? design.header.bandPaddingXPx * PX : 0;
  const headerPaddingY = design.header.band ? design.header.bandPaddingYPx * PX : 0;
  const headerLeft = contentLeft - bandOutset;
  const headerRight = contentRight + bandOutset;
  const innerLeft = contentLeft + headerPaddingX;
  const innerWidth = Math.max(40, contentWidth - headerPaddingX * 2);
  const headerTopY = page.h - margin - headerPaddingY;

  const lineInArea = (state, text, font, size, color, align = 'left') => {
    state.y -= lineH(size);
    const w = textWidth(text, font, size);
    let x = state.left;
    if (align === 'center') x = state.left + Math.max(0, (state.width - w) / 2);
    else if (align === 'right') x = state.left + Math.max(0, state.width - w);
    headerItems.push({ x, y: state.y, text, font, size, color });
  };

  const addContact = (state, { layout = design.header.contactLayout, align = design.header.contactAlign } = {}) => {
    if (!contactBits.length) return;
    if (layout === 'stacked') {
      for (const bit of contactBits) {
        const lines = wrapText(bit, contactFont, sizes.contact, state.width);
        for (const text of lines.slice(0, 2)) lineInArea(state, text, contactFont, sizes.contact, design.header.contactColor, align);
      }
      return;
    }
    if (layout === 'grid') {
      const n = Math.max(1, design.header.contactGridColumns);
      const gap = design.header.contactGridColumnGapPx * PX;
      const cellW = Math.max(28, (state.width - gap * (n - 1)) / n);
      for (let row = 0; row < Math.ceil(contactBits.length / n); row += 1) {
        state.y -= lineH(sizes.contact);
        for (let col = 0; col < n; col += 1) {
          const bit = contactBits[row * n + col];
          if (!bit) continue;
          const text = wrapText(bit, contactFont, sizes.contact, cellW)[0] || bit;
          const w = textWidth(text, contactFont, sizes.contact);
          let x = state.left + col * (cellW + gap);
          if (align === 'center') x += Math.max(0, (cellW - w) / 2);
          else if (align === 'right') x += Math.max(0, cellW - w);
          headerItems.push({ x, y: state.y, text, font: contactFont, size: sizes.contact, color: design.header.contactColor });
        }
        state.y -= design.header.contactGridRowGapPx * PX;
      }
      return;
    }
    const joined = contactBits.join(design.header.contactSeparator || '  ·  ');
    for (const text of wrapText(joined, contactFont, sizes.contact, state.width)) lineInArea(state, text, contactFont, sizes.contact, design.header.contactColor, align);
  };

  let headerCursorY = headerTopY;
  if (design.header.layout === 'split') {
    const gap = design.header.splitGapPx * PX;
    const primaryW = Math.max(80, (innerWidth - gap) * design.header.splitPrimaryShare);
    const contactW = Math.max(70, innerWidth - primaryW - gap);
    const primary = { left: innerLeft, width: primaryW, y: headerTopY };
    const contact = { left: innerLeft + primaryW + gap, width: contactW, y: headerTopY };
    if (nameText) lineInArea(primary, nameText, f.bold, sizes.name, design.header.nameColor, 'left');
    if (titleText) {
      primary.y -= design.header.titleMarginTopPx * PX;
      lineInArea(primary, titleText, f.bold, sizes.title, design.header.titleColor, 'left');
    }
    addContact(contact, { align: design.header.contactAlign || 'right' });
    headerCursorY = Math.min(primary.y, contact.y);
  } else {
    const primaryInset = design.header.primaryInsetPx * PX;
    const primary = { left: innerLeft + primaryInset, width: Math.max(30, innerWidth - primaryInset), y: headerTopY };
    if (nameText) lineInArea(primary, nameText, f.bold, sizes.name, design.header.nameColor, design.header.align);
    if (titleText) {
      primary.y -= design.header.titleMarginTopPx * PX;
      lineInArea(primary, titleText, f.bold, sizes.title, design.header.titleColor, design.header.align);
    }
    const identityBottom = primary.y;
    if (design.header.accentMark === 'vertical' && design.header.accentMarkWidthPx > 0) {
      const x = innerLeft + Math.max(1, design.header.accentMarkWidthPx * PX * 0.5);
      headerDecorLines.push({ x1: x, y1: identityBottom - 1, x2: x, y2: headerTopY, width: Math.max(1, design.header.accentMarkWidthPx * PX), color: tokens.colors.accent });
    }
    if (design.header.accentMark === 'short-rule' && design.header.accentMarkWidthPx > 0) {
      primary.y -= 6 * PX;
      const w = design.header.accentMarkWidthPx * PX;
      const x1 = innerLeft + Math.max(0, (innerWidth - w) / 2);
      headerDecorLines.push({ x1, y1: primary.y, x2: x1 + w, y2: primary.y, width: 1.5, color: tokens.colors.accent });
      primary.y -= 2 * PX;
    }
    if (contactBits.length) {
      primary.y -= design.header.contactMarginTopPx * PX;
      const contact = { left: innerLeft, width: innerWidth, y: primary.y };
      addContact(contact, { align: design.header.contactAlign });
      primary.y = contact.y;
    }
    headerCursorY = primary.y;
  }

  const headerContentBottom = headerCursorY - (design.header.rule.thicknessPx > 0 ? design.header.rulePaddingBottomPx * PX : 0);
  const headerH = (page.h - margin) - headerContentBottom + design.header.marginBottomPx * PX + headerPaddingY;
  /* ---- blocks per column ---- */
  const blocks = new Map(cols.map((c) => [c.id, []]));
  const seenRegion = new Set();
  for (const s of tree.sections) {
    const g = geom.get(s.region) || geom.get(cols[0].id);
    const isFirstInRegion = !seenRegion.has(s.region);
    const list = sectionBlocks(s.key, d, tokens, g.w - g.pad * 2, f, sizes, {
      region: s.region,
      isFirstInRegion,
      sidebar: design.sidebar,
      columns: design.columns,
      summary: design.summary,
      skills: design.skills,
      experience: design.experience,
      projects: design.projects,
      education: design.education,
    });
    if (list.length) {
      blocks.get(s.region)?.push(...list);
      seenRegion.add(s.region);
    }
  }

  /* ---- pagination (owned, not the browser's) ---- */
  const topY = page.h - margin;
  const bottomY = margin;
  const pages = [];
  const ensurePage = (i) => { while (pages.length <= i) pages.push({ header: pages.length === 0, items: [], rects: [], lines: [] }); return pages[i]; };
  ensurePage(0);

  const flowStats = new Map();
  const recordFlow = (pageIdx, colId, top, bottom) => {
    const key = `${pageIdx}:${colId}`;
    const prev = flowStats.get(key);
    flowStats.set(key, {
      top: prev ? Math.max(prev.top, top) : top,
      bottom: prev ? Math.min(prev.bottom, bottom) : bottom,
    });
  };

  const blockNeed = (list, i) => {
    const b = list[i];
    let need = lineH(b.size) + b.gapBefore;
    const keep = Math.max(b.keepWithNext ? 1 : 0, Number(b.keepWithNextLines || 0));
    for (let j = 1; j <= keep && list[i + j]; j += 1) {
      const n = list[i + j];
      need += lineH(n.size) + (j === 1 ? Math.max(0, n.gapBefore || 0) : 0);
    }
    return need;
  };

  /* A two-page single-column resume should not leave an orphan page containing
     only one or two tiny tail sections. Before emission, dry-run the owned
     paginator and, when safe, move a whole late section to page 2. This keeps
     typography/content untouched while producing a deliberately balanced
     two-page document. */
  const dryPaginate = (list, { forceSection = '' } = {}) => {
    let pageIdx = 0;
    let pageTop = topY - headerH;
    let y = pageTop;
    const stats = [{ top: pageTop, bottom: pageTop, blockCount: 0 }];
    const sectionPages = new Map();
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      if (forceSection && b.sectionStart && b.sectionKey === forceSection && pageIdx === 0 && stats[0].blockCount > 0) {
        pageIdx += 1; pageTop = topY; y = pageTop;
        if (!stats[pageIdx]) stats[pageIdx] = { top: pageTop, bottom: pageTop, blockCount: 0 };
      }
      const need = blockNeed(list, i);
      if (y - need < bottomY) {
        pageIdx += 1; pageTop = topY; y = pageTop;
        if (!stats[pageIdx]) stats[pageIdx] = { top: pageTop, bottom: pageTop, blockCount: 0 };
      }
      if (b.sectionStart && !sectionPages.has(b.sectionKey)) sectionPages.set(b.sectionKey, pageIdx);
      y -= b.gapBefore; y -= lineH(b.size);
      stats[pageIdx].bottom = Math.min(stats[pageIdx].bottom, y - Math.max(1.5, b.size * 0.22));
      stats[pageIdx].blockCount += 1;
    }
    const pagesUsed = pageIdx + 1;
    return {
      pagesUsed, sectionPages,
      pages: stats.slice(0, pagesUsed).map((x, i) => {
        const contentTop = i === 0 ? topY - headerH : topY;
        const available = Math.max(1, contentTop - bottomY);
        const used = Math.max(0, contentTop - x.bottom);
        return { ...x, utilization: Math.min(1, used / available) };
      }),
    };
  };

  let orphanRebalance = null;
  if (rebalanceOrphans && tree.layoutType === 'single-column') {
    const mainList = blocks.get('main') || [];
    const baseline = dryPaginate(mainList);
    if (baseline.pagesUsed === 2 && (baseline.pages[1]?.utilization || 0) < 0.30 && (baseline.pages[0]?.utilization || 0) > 0.78) {
      const lateSections = tree.sections.map((x) => x.key)
        .filter((key) => baseline.sectionPages.get(key) === 0 && !['summary', 'experience'].includes(key));
      let best = null;
      for (const key of lateSections) {
        const trial = dryPaginate(mainList, { forceSection: key });
        if (trial.pagesUsed !== 2) continue;
        const first = trial.pages[0]?.utilization || 0;
        const second = trial.pages[1]?.utilization || 0;
        if (first < 0.58 || second < 0.24) continue;
        /* Prefer a healthy continuation page without making page 1 look
           prematurely cut. Around 70/45 is intentionally more natural for a
           resume than mechanically forcing 50/50. */
        const score = Math.abs(first - 0.72) + Math.abs(second - 0.46) + (second < 0.32 ? 0.3 : 0);
        if (!best || score < best.score) best = { key, score, first, second, trial };
      }
      if (best) orphanRebalance = {
        applied: true, sectionKey: best.key,
        before: baseline.pages.map((x) => Number(x.utilization.toFixed(3))),
        after: best.trial.pages.map((x) => Number(x.utilization.toFixed(3))),
      };
    }
  }

  let preventedGroupOrphans = 0;
  const flow = (colId, list) => {
    const g = geom.get(colId);
    const sidebarInset = colId === 'sidebar' ? design.sidebar.paddingYPt : 0;
    let pageIdx = 0;
    let pageTop = topY - (pages[0].header ? headerH : 0);
    let y = pageTop - sidebarInset;
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      if (orphanRebalance?.applied && colId === 'main' && b.sectionStart && b.sectionKey === orphanRebalance.sectionKey && pageIdx === 0 && i > 0) {
        pageIdx += 1;
        ensurePage(pageIdx);
        pageTop = topY;
        y = pageTop - sidebarInset;
      }
      const need = blockNeed(list, i);
      const immediateNeed = lineH(b.size) + b.gapBefore;
      if (y - need < bottomY) {
        if (y - immediateNeed >= bottomY && need > immediateNeed) preventedGroupOrphans += 1;
        pageIdx += 1;
        ensurePage(pageIdx);
        pageTop = topY;
        y = pageTop - sidebarInset;
      }
      y -= b.gapBefore;
      y -= lineH(b.size);
      const pageRef = ensurePage(pageIdx);
      const itemX = g.x + g.pad + b.indent;
      const mapSidebarColor = (input) => {
        if (colId !== 'sidebar' || !design.sidebar?.textColor) return input;
        const c = input || tokens.colors.text;
        if (c === tokens.colors.accent) return design.sidebar.headingColor || design.sidebar.textColor;
        if (c === tokens.colors.muted) return design.sidebar.mutedColor || design.sidebar.textColor;
        if (c === tokens.colors.rule) return design.sidebar.ruleColor || design.sidebar.mutedColor || design.sidebar.textColor;
        return design.sidebar.textColor;
      };
      if (b.chips?.length) {
        const st = b.chipStyle || {};
        let chipX = itemX;
        const chipTextColor = colId === 'sidebar' && design.sidebar?.chipTextColor ? design.sidebar.chipTextColor : (st.textColor || tokens.colors.accent);
        const chipFill = colId === 'sidebar' && design.sidebar?.chipFillColor ? design.sidebar.chipFillColor : (st.fillColor || tokens.colors.sidebarBg);
        const chipBorder = colId === 'sidebar' && design.sidebar?.chipBorderColor ? design.sidebar.chipBorderColor : (st.borderColor || tokens.colors.rule);
        const rectH = b.size * 1.22 + (st.padY || 2.25) * 2;
        const rectY = y - b.size * 0.28 - (st.padY || 2.25);
        for (const chip of b.chips) {
          pageRef.rects.push({ x: chipX, y: rectY, w: chip.width, h: rectH, color: chipFill });
          pageRef.lines.push({ x1: chipX, y1: rectY, x2: chipX + chip.width, y2: rectY, width: 0.45, color: chipBorder });
          pageRef.lines.push({ x1: chipX, y1: rectY + rectH, x2: chipX + chip.width, y2: rectY + rectH, width: 0.45, color: chipBorder });
          pageRef.lines.push({ x1: chipX, y1: rectY, x2: chipX, y2: rectY + rectH, width: 0.45, color: chipBorder });
          pageRef.lines.push({ x1: chipX + chip.width, y1: rectY, x2: chipX + chip.width, y2: rectY + rectH, width: 0.45, color: chipBorder });
          pageRef.items.push({ colId, x: chipX + (st.padX || 6), y, text: chip.text, font: f.bold, size: b.size, color: chipTextColor, centered: false });
          chipX += chip.width + (st.gapX || 3.75);
        }
      } else if (b.segments?.length) {
        let segmentX = itemX;
        for (const seg of b.segments) {
          pageRef.items.push({ colId, x: segmentX, y, text: seg.text, font: seg.font || b.font, size: seg.size || b.size, color: mapSidebarColor(seg.color || b.color), centered: false });
          segmentX += textWidth(seg.text, seg.font || b.font, seg.size || b.size);
        }
      } else {
        pageRef.items.push({ colId, x: itemX, y, text: b.text, font: b.font, size: b.size, color: mapSidebarColor(b.color), centered: false });
      }
      if (b.rightText) {
        const rightW = textWidth(b.rightText, b.rightFont, b.rightSize);
        const rightX = g.x + g.w - g.pad - rightW;
        pageRef.items.push({ colId, x: Math.max(itemX, rightX), y, text: b.rightText, font: b.rightFont, size: b.rightSize, color: mapSidebarColor(b.rightColor), centered: false });
      }
      recordFlow(pageIdx, colId, pageTop, y - Math.max(1.5, b.size * 0.22));
      if (b.ruleAfter) {
        const maxRule = Math.max(10, g.w - g.pad * 2);
        const textW = textWidth(b.text || '', b.font, b.size);
        const startX = b.ruleAfter.startAfterText ? Math.min(g.x + g.w - g.pad - 8, g.x + g.pad + textW + (b.ruleAfter.gap || 0)) : g.x + g.pad;
        const remaining = Math.max(8, g.x + g.w - g.pad - startX);
        const ruleW = b.ruleAfter.width === 'remaining' ? remaining : (b.ruleAfter.width === 'full' ? maxRule : Math.min(maxRule, Number(b.ruleAfter.width) || maxRule));
        pageRef.lines.push({ x1: startX, y1: y + (b.ruleAfter.startAfterText ? b.size * 0.28 : -2.2), x2: startX + ruleW, y2: y + (b.ruleAfter.startAfterText ? b.size * 0.28 : -2.2), width: Math.max(0.45, b.ruleAfter.thickness || 0.6), color: b.ruleAfter.color || tokens.colors.rule });
      }
      if (b.accentMarker) {
        const mx = Math.max(g.x + g.pad + 1, itemX - 6);
        pageRef.lines.push({ x1: mx, y1: y - 1, x2: mx, y2: y + Math.max(5, b.size * 0.9), width: Math.max(0.8, b.accentMarker.width || 1.2), color: b.accentMarker.color || tokens.colors.accent });
      }
      if (b.metaMarker) {
        const mx = Math.max(g.x + g.pad + 1, itemX - 6);
        pageRef.lines.push({ x1: mx, y1: y + b.size * 0.28, x2: mx + 3.5, y2: y + b.size * 0.28, width: 1.4, color: b.metaMarker.color || tokens.colors.accent });
      }
    }
    return pageIdx + 1;
  };

  /* semantic emission order — same rule as the HTML compiler */
  const orderIdx = new Map(tree.sections.map((s, i) => [s.key, i]));
  const firstIdx = (col) => Math.min(...tree.sections.filter((s) => s.region === col.id).map((s) => orderIdx.get(s.key)), Infinity);
  const emission = [...cols].sort((a, b) => firstIdx(a) - firstIdx(b));
  let pageCount = 1;
  for (const c of emission) pageCount = Math.max(pageCount, flow(c.id, blocks.get(c.id) || []));

  /* header items on page 1 — positioned using the same resolved design metrics as HTML */
  if (headerItems.length) {
    pages[0].items = [...headerItems, ...pages[0].items]; // header leads the content stream
    if (design.header.band) {
      const bandTop = page.h - margin + bandOutset;
      const bandBottom = headerContentBottom - design.header.marginBottomPx * PX * 0.45;
      pages[0].rects.push({ x: headerLeft, y: bandBottom, w: headerRight - headerLeft, h: bandTop - bandBottom, color: design.header.bandBackgroundColor });
    }
    if (headerDecorLines.length) pages[0].lines.push(...headerDecorLines);
    const hr = design.header.rule;
    if (hr?.thicknessPx > 0) {
      const ruleY = headerContentBottom + design.header.rulePaddingBottomPx * PX * 0.35;
      pages[0].lines.push({
        x1: contentLeft + (hr.insetPx || 0) * PX,
        y1: ruleY,
        x2: contentRight - (hr.insetPx || 0) * PX,
        y2: ruleY,
        width: Math.max(0.45, hr.thicknessPx * PX),
        color: tokenColor(tokens, hr.colorToken, tokens.colors.rule),
      });
    }
  }
  /* Two-column composition rule. It lives in the gutter rather than inside
     either track, so premium separation does not steal line length from the
     supporting reference column or the narrative column. */
  const columnDividers = [];
  if (tree.layoutType === 'two-column' && cols.length === 2 && design.columns?.dividerWidthPt > 0) {
    const first = geom.get(cols[0].id);
    const dividerX = first.x + first.w + gutter / 2;
    const dividerColor = tokenColor(tokens, design.columns.dividerColorToken, tokens.colors.rule);
    for (let i = 0; i < pageCount; i += 1) {
      const top = topY - (i === 0 ? headerH : 0) - (design.columns.dividerInsetTopPt || 0);
      let bottom = bottomY + (design.columns.dividerInsetBottomPt || 0);
      if (design.columns.heightMode === 'content') {
        const stats = cols.map((c) => flowStats.get(`${i}:${c.id}`)).filter(Boolean);
        if (stats.length) bottom = Math.max(bottom, Math.min(...stats.map((x) => x.bottom)) - (design.columns.contentBottomPaddingPt || 0));
      }
      const line = {
        x1: dividerX, y1: bottom, x2: dividerX, y2: top,
        width: Math.max(0.35, design.columns.dividerWidthPt), color: dividerColor,
      };
      ensurePage(i).lines.push(line);
      columnDividers.push({ page: i + 1, x: dividerX, top, bottom, width: line.width, color: dividerColor });
    }
  }

  /* Sidebar surface. Premium content-height panels stop at the end of the
     actual rail content instead of painting an empty column to the page foot. */
  const sideCol = cols.find((c) => c.id === 'sidebar');
  const sidebarPanels = [];
  if (sideCol) {
    const g = geom.get('sidebar');
    const panel = design.sidebar || {};
    const panelColor = panel.backgroundToken ? tokenColor(tokens, panel.backgroundToken, tokens.colors.sidebarBg) : null;
    for (let i = 0; i < pageCount; i += 1) {
      const top = topY - (i === 0 ? headerH : 0);
      const stat = flowStats.get(`${i}:sidebar`);
      if (panel.heightMode === 'content' && !stat) continue;
      let panelBottom = bottomY;
      if (panel.heightMode === 'content' && stat) {
        panelBottom = Math.max(bottomY, stat.bottom - panel.contentBottomPaddingPt);
      }
      const panelHeight = Math.max(0, top - panelBottom);
      if (panelColor && panelHeight > 0) ensurePage(i).rects.push({ x: g.x - 4, y: panelBottom, w: g.w + 8, h: panelHeight, color: panelColor });
      if (panel.edgeWidthPx > 0 && panelHeight > 0) {
        const leftSidebar = tree.layoutType === 'sidebar-left';
        const edgeX = leftSidebar ? g.x + g.w + 4 : g.x - 4;
        ensurePage(i).lines.push({ x1: edgeX, y1: panelBottom, x2: edgeX, y2: top, width: panel.edgeWidthPt, color: tokenColor(tokens, panel.edgeColorToken, tokens.colors.accent) });
      }
      sidebarPanels.push({ page: i + 1, top, bottom: panelBottom, height: panelHeight, mode: panel.heightMode || 'full' });
    }
  }

  /* ---- serialize ---- */
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; }; // 1-indexed

  const fontIds = {};
  for (const key of Object.keys(PDF_FONTS)) {
    const font = PDF_FONTS[key];
    fontIds[font.key] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${font.base} /Encoding /WinAnsiEncoding >>`);
  }
  const fontRes = Object.entries(fontIds).map(([k, id]) => `/${k} ${id} 0 R`).join(' ');

  const pagesObjId = objects.length + 1 + pageCount * 2; // reserve
  const pageObjIds = [];
  const contentIds = [];
  for (let i = 0; i < pageCount; i += 1) {
    const p = ensurePage(i);
    let stream = '';
    for (const r of p.rects) {
      const [cr, cg, cb] = hexRgb(r.color);
      stream += `q ${cr.toFixed(3)} ${cg.toFixed(3)} ${cb.toFixed(3)} rg ${r.x.toFixed(2)} ${r.y.toFixed(2)} ${r.w.toFixed(2)} ${r.h.toFixed(2)} re f Q\n`;
    }
    for (const l of p.lines || []) {
      const [cr, cg, cb] = hexRgb(l.color);
      stream += `q ${cr.toFixed(3)} ${cg.toFixed(3)} ${cb.toFixed(3)} RG ${Math.max(0.35, l.width || 0.6).toFixed(2)} w ${l.x1.toFixed(2)} ${l.y1.toFixed(2)} m ${l.x2.toFixed(2)} ${l.y2.toFixed(2)} l S Q\n`;
    }
    let lastColor = null;
    for (const it of p.items) {
      const [cr, cg, cb] = hexRgb(it.color || tokens.colors.text);
      const colorKey = `${cr},${cg},${cb}`;
      if (colorKey !== lastColor) { stream += `${cr.toFixed(3)} ${cg.toFixed(3)} ${cb.toFixed(3)} rg\n`; lastColor = colorKey; }
      stream += `BT /${it.font.key} ${it.size.toFixed(2)} Tf ${it.x.toFixed(2)} ${it.y.toFixed(2)} Td (${pdfString(it.text)}) Tj ET\n`;
    }
    const cid = add(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    contentIds.push(cid);
    pageObjIds.push(add(`<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 ${page.w.toFixed(2)} ${page.h.toFixed(2)}] /Resources << /Font << ${fontRes} >> >> /Contents ${cid} 0 R >>`));
  }
  const realPagesId = add(`<< /Type /Pages /Count ${pageCount} /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${realPagesId} 0 R >>`);
  /* fix parent references if the reservation drifted */
  for (const id of pageObjIds) objects[id - 1] = objects[id - 1].replace(/\/Parent \d+ 0 R/, `/Parent ${realPagesId} 0 R`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;

  /* Exact page-usage telemetry from the owned PDF paginator. This gives the
     composition engine/tests a truthful bottom-whitespace measurement rather
     than relying only on line-count estimates. Coordinates remain internal;
     no visible footer text or parser noise is introduced. */
  const pageUsage = [];
  for (let i = 0; i < pageCount; i += 1) {
    const stats = cols.map((c) => flowStats.get(`${i}:${c.id}`)).filter(Boolean);
    const contentTop = topY - (i === 0 ? headerH : 0);
    const lowestBottom = stats.length ? Math.min(...stats.map((x) => x.bottom)) : contentTop;
    const availableHeight = Math.max(1, contentTop - bottomY);
    const usedHeight = Math.max(0, contentTop - lowestBottom);
    const bottomWhitespacePt = Math.max(0, lowestBottom - bottomY);
    pageUsage.push({
      page: i + 1, contentTop, contentBottom: lowestBottom, availableBottom: bottomY,
      usedHeight: Number(usedHeight.toFixed(2)),
      bottomWhitespacePt: Number(bottomWhitespacePt.toFixed(2)),
      utilization: Number(Math.min(1, usedHeight / availableHeight).toFixed(3)),
    });
  }
  return {
    version: PDF_WRITER_VERSION,
    renderDesignVersion: design.version,
    bytes,
    pageCount,
    lineCount: pages.reduce((s, p) => s + p.items.length, 0),
    geometry: {
      pageCount, sizeId, marginPt: margin,
      columns: [...geom.entries()].map(([id, g]) => ({ id, x: g.x, w: g.w })),
      columnDividers,
      sidebarPanels,
      orphanRebalance,
      pagination: { version: OWNED_PAGINATION_VERSION, preventedGroupOrphans, semanticSectionGroups: true, noBrowserPageBreaks: true },
      pageUsage,
    },
  };
}

export default { PDF_WRITER_VERSION, OWNED_PAGINATION_VERSION, renderTemplatePdf, wrapText, textWidth, pdfEncodeText, PDF_FONTS };
