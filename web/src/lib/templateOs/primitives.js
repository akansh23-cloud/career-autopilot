/* ============================================================
   TEMPLATE OS — APPROVED LAYOUT PRIMITIVES
   ------------------------------------------------------------
   Templates never invent rendering. They COMPOSE these approved,
   data-driven primitives; the layout compiler resolves them into
   a layout tree + style tokens. Adding a primitive here makes it
   available to every template and to the deterministic generator.
   ============================================================ */

export const PRIMITIVES_VERSION = 'template-primitives-v17-reference-premium-families';

export const PAGE_PRIMITIVES = {
  'single-column': { id: 'single-column', columns: null, describe: 'One continuous flow — the safest structure for every parser.' },
  'sidebar-left': { id: 'sidebar-left', columns: [{ id: 'sidebar', width: 0.3 }, { id: 'main', width: 0.7 }], describe: 'Narrow left rail for dense reference data; main column keeps experience dominant.' },
  'sidebar-right': { id: 'sidebar-right', columns: [{ id: 'main', width: 0.7 }, { id: 'sidebar', width: 0.3 }], describe: 'Right rail variant — main content leads visually and in reading order.' },
  'two-column': { id: 'two-column', columns: [{ id: 'left', width: 0.5 }, { id: 'right', width: 0.5 }], describe: 'Balanced editorial columns — design-forward, order-checked.' },
};

export const HEADER_PRIMITIVES = {
  /* Header primitives are geometry + tone contracts. They are deliberately
     distinct so template families do not become the same header with a new
     accent color. HTML and vector PDF resolve these fields through the same
     render-design contract. */
  minimal: {
    id: 'minimal', layout: 'stack', align: 'left', band: false, nameCase: 'none',
    contactLayout: 'inline', nameTone: 'text', titleTone: 'accent', contactTone: 'muted',
    describe: 'Name + one contact line. Zero decoration.'
  },
  centered: {
    id: 'centered', layout: 'stack', align: 'center', band: false, nameCase: 'none',
    contactLayout: 'inline', nameTone: 'text', titleTone: 'accent', contactTone: 'muted',
    describe: 'Legacy centered header for conservative screens.'
  },
  technical: {
    id: 'technical', layout: 'technical', align: 'left', band: false, nameCase: 'none',
    contactLayout: 'grid', mono: true, accentMark: 'vertical', nameTone: 'text',
    titleTone: 'accent', contactTone: 'muted', primaryInsetPx: 11, accentMarkWidthPx: 3,
    describe: 'Engineering header: vertical accent marker, role line and compact mono contact grid.'
  },
  editorial: {
    id: 'editorial', layout: 'editorial', align: 'left', band: false, nameCase: 'caps',
    contactLayout: 'inline', rule: true, nameTone: 'text', titleTone: 'muted', contactTone: 'muted',
    titleCase: 'upper', titleLetterSpacingPx: 0.75, contactSeparator: ' · ',
    describe: 'Editorial display name, restrained role line and a single quiet contact baseline.'
  },
  corporate: {
    id: 'corporate', layout: 'split', align: 'left', contactAlign: 'right', band: false, rule: true,
    nameCase: 'none', contactLayout: 'stacked', nameTone: 'text', titleTone: 'accent',
    contactTone: 'muted', splitPrimaryShare: 0.6, splitGapPx: 22,
    describe: 'Corporate split header: identity left, compact contact block right, clean horizontal rule.'
  },
  executive: {
    id: 'executive', layout: 'band', align: 'center', band: true, nameCase: 'caps',
    contactLayout: 'inline', nameTone: 'inverse', titleTone: 'inverse', contactTone: 'inverseMuted',
    bandBackgroundToken: 'accent', contactSeparator: ' · ',
    describe: 'Full-width executive band with reversed typography and a restrained single contact line.'
  },
  student: {
    id: 'student', layout: 'student', align: 'center', band: false, nameCase: 'none',
    contactLayout: 'inline', nameTone: 'text', titleTone: 'accent', contactTone: 'muted',
    accentMark: 'short-rule', accentMarkWidthPx: 34, contactSeparator: ' · ',
    describe: 'Friendly centered student header with a short accent signature and compact contact row.'
  },
  compact: {
    id: 'compact', layout: 'stack', align: 'left', band: false, nameCase: 'none',
    contactLayout: 'inline', tight: true, nameTone: 'text', titleTone: 'accent', contactTone: 'muted',
    describe: 'Minimum vertical cost — for dense one-pagers.'
  },
  'dark-executive-classic': {
    id: 'dark-executive-classic', layout: 'band', align: 'left', band: true, nameCase: 'caps',
    contactLayout: 'inline', nameTone: 'inverse', titleTone: 'inverseMuted', contactTone: 'inverseMuted',
    bandBackgroundToken: '#101827', contactSeparator: ' · ',
    describe: 'Left-aligned dark executive band with reversed serif identity and restrained contact line.'
  },
};

export const SECTION_DIVIDERS = {
  none: { id: 'none', css: '' },
  hairline: { id: 'hairline', css: 'border-bottom:0.6px solid var(--tpl-rule);padding-bottom:2px;' },
  'accent-rule': { id: 'accent-rule', css: 'border-bottom:1.6px solid var(--tpl-accent);padding-bottom:2px;' },
  'short-rule': { id: 'short-rule', css: 'position:relative;padding-bottom:4px;', after: 'content:"";position:absolute;left:0;bottom:0;width:34px;border-bottom:2px solid var(--tpl-accent);' },
  'editorial-line': { id: 'editorial-line', css: 'display:flex;align-items:center;gap:10px;', after: 'content:"";height:0;flex:1;border-top:0.8px solid var(--tpl-rule);' },
};

export const SKILLS_PRIMITIVES = {
  inline: {
    id: 'inline', mode: 'inline', delimiter: ' · ', labelLayout: 'inline', labelTone: 'text', labelCase: 'none',
    groupGapScale: 0.78, itemSizeScale: 1,
    describe: 'Inline category rows: a compact label followed by a middot-delimited skill run.'
  },
  categorized: {
    id: 'categorized', mode: 'categorized', delimiter: ' · ', labelLayout: 'block', labelTone: 'accent', labelCase: 'none',
    groupGapScale: 0.95, itemSizeScale: 0.98,
    describe: 'Categorized list: category label on its own line with a clean, wrapping skill row beneath it.'
  },
  /* Kept for backward compatibility with existing stored definitions. New
     premium rail templates should prefer sidebar-groups so a dense technical
     profile does not degrade into one database-like row per skill. */
  'sidebar-stack': {
    id: 'sidebar-stack', mode: 'stack', delimiter: ' · ', labelLayout: 'block', labelTone: 'accent', labelCase: 'none',
    groupGapScale: 0.9, itemSizeScale: 0.96,
    describe: 'Legacy one-skill-per-line rail treatment.'
  },
  'sidebar-groups': {
    id: 'sidebar-groups', mode: 'sidebar-groups', delimiter: ' · ', labelLayout: 'block', labelTone: 'accent', labelCase: 'upper',
    groupGapScale: 1.05, itemSizeScale: 0.93, labelSizeScale: 0.96,
    describe: 'Compact premium sidebar groups: small category label plus a wrapped, pill-free technical skill run.'
  },
  'compact-matrix': {
    id: 'compact-matrix', mode: 'matrix', delimiter: ' · ', labelLayout: 'inline', labelTone: 'accent', labelCase: 'upper',
    groupGapScale: 0.66, itemSizeScale: 0.94,
    describe: 'Technical matrix: compact category rows with middot-delimited tokens, preserving group meaning.'
  },
  plain: {
    id: 'plain', mode: 'plain', delimiter: ', ', labelLayout: 'none', labelTone: 'text', labelCase: 'none',
    groupGapScale: 0.7, itemSizeScale: 1,
    describe: 'Single plain paragraph — for strict-ATS templates.'
  },
  'soft-chips': {
    id: 'soft-chips', mode: 'chips', delimiter: ' · ', labelLayout: 'chip', labelTone: 'accent', labelCase: 'none',
    groupGapScale: 0.82, itemSizeScale: 0.9, labelSizeScale: 0.92,
    chipFillToken: 'sidebarBg', chipBorderToken: 'rule', chipTextToken: 'accent',
    chipPadXpx: 8, chipPadYpx: 3, chipGapXpx: 5, chipGapYpx: 4, chipRadiusPx: 999,
    describe: 'ATS-readable skill tokens rendered as restrained soft chips; category context is preserved in the first chip of each group.'
  },
};

export const EXPERIENCE_PRIMITIVES = {
  /* Experience primitives describe information hierarchy, not resume facts.
     The shared HTML/PDF render contract resolves these values so a job header
     keeps the same visual identity in preview and export. */
  classic: {
    id: 'classic', headerLayout: 'stacked', dateAlign: 'right', companyLine: true,
    companyTone: 'text', locationTone: 'muted', itemGapScale: 1.05,
    describe: 'Role and dates lead; company/location sit on a quieter second line.'
  },
  'impact-first': {
    id: 'impact-first', headerLayout: 'stacked', dateAlign: 'right', companyLine: true,
    companyTone: 'text', locationTone: 'muted', leadBullet: 'strong', itemGapScale: 1.12,
    describe: 'Premium stacked job header with the first outcome visually weighted.'
  },
  compact: {
    id: 'compact', headerLayout: 'inline', dateAlign: 'inline', tight: true,
    companyTone: 'text', locationTone: 'muted', itemGapScale: 0.82,
    describe: 'Role, company and dates share a compact header for space-constrained profiles.'
  },
  technical: {
    id: 'technical', headerLayout: 'stacked', dateAlign: 'right', companyLine: true,
    companyTone: 'accent', locationTone: 'muted', stackLine: true, stackFont: 'mono',
    itemGapScale: 1.08,
    describe: 'Role/date lead, accented company/location line, optional mono stack/context line.'
  },
  'cloud-platform': {
    id: 'cloud-platform', headerLayout: 'stacked', dateAlign: 'right', companyLine: true,
    companyTone: 'text', locationTone: 'muted', stackLine: true, stackFont: 'mono', stackLabel: 'STACK',
    itemGapScale: 1.02,
    describe: 'Cloud/platform hierarchy with a compact labelled infrastructure stack line beneath employer metadata.'
  },
  editorial: {
    id: 'editorial', headerLayout: 'stacked', dateAlign: 'right', companyLine: true,
    companyTone: 'muted', locationTone: 'muted', itemGapScale: 1.2,
    describe: 'Airy editorial experience hierarchy: strong role/date line, quiet employer metadata and deliberate inter-role rhythm.'
  },
  'executive-impact': {
    id: 'executive-impact', headerLayout: 'stacked', dateAlign: 'right', companyLine: true,
    companyTone: 'muted', locationTone: 'muted', leadBullet: 'strong', itemGapScale: 1.22,
    describe: 'Leadership-first hierarchy with a strong role/date line, restrained employer metadata and the first impact bullet visually weighted.'
  },
};

export const PROJECT_PRIMITIVES = {
  classic: {
    id: 'classic', headerLayout: 'stacked', metaLayout: 'split', techFont: 'body',
    itemGapScale: 1.02, maxBullets: 99,
    describe: 'Project name leads; technology and link share a quieter metadata row above impact bullets.'
  },
  compact: {
    id: 'compact', headerLayout: 'inline', metaLayout: 'inline', techFont: 'body',
    tight: true, itemGapScale: 0.82, maxBullets: 2,
    describe: 'Compact project header with restrained metadata and at most two bullets.'
  },
  evidence: {
    id: 'evidence', headerLayout: 'stacked', metaLayout: 'split', techFont: 'mono',
    badge: true, badgeLabel: 'VERIFIED', itemGapScale: 1.08, maxBullets: 99,
    describe: 'Evidence-forward project treatment with a subtle verified state, stack/link metadata and readable impact bullets.'
  },
  'evidence-compact': {
    id: 'evidence-compact', headerLayout: 'stacked', metaLayout: 'split', techFont: 'mono',
    badge: true, badgeLabel: 'VERIFIED', itemGapScale: 0.92, maxBullets: 4,
    describe: 'Tighter evidence-forward project treatment for infrastructure resumes, retaining stack/link context and up to four source-backed impact bullets when the ResumeDocument actually contains them.'
  },
  'student-portfolio': {
    id: 'student-portfolio', headerLayout: 'stacked', metaLayout: 'split', techFont: 'body',
    badge: true, badgeLabel: 'VERIFIED', itemGapScale: 1.08, maxBullets: 3,
    describe: 'Project-first student treatment with a strong project name, compact stack/link row, optional verified state and up to three evidence-rich bullets.'
  },
};

export const EDUCATION_PRIMITIVES = {
  classic: {
    id: 'classic', layout: 'inline', dateAlign: 'right', schoolTone: 'text', degreeTone: 'text', detailsTone: 'muted',
    schoolSizeScale: 1, degreeSizeScale: 1, itemGapScale: 1,
    describe: 'Conservative education row with institution, degree and dates.'
  },
  'campus-featured': {
    id: 'campus-featured', layout: 'featured', dateAlign: 'right', schoolTone: 'text', degreeTone: 'accent', detailsTone: 'muted',
    schoolSizeScale: 1.03, degreeSizeScale: 0.97, itemGapScale: 1.06,
    describe: 'Student-first education hierarchy: institution and dates lead, degree/CGPA sit on a distinct accent line, details remain quiet.'
  },
};

export const TYPOGRAPHY_PRESETS = {
  /*
     Typography values are CSS px by definition. The PDF writer converts
     them to points at 96dpi (0.75pt/px), so the body sizes below resolve to
     a genuine ~9.5–10.1pt in exported PDFs instead of the previous ~7.5pt.
     Semantic role sizes keep HTML and PDF hierarchy aligned.
  */
  'system-sans': {
    id: 'system-sans', font: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    bodyFontPx: 13, nameSize: 28, titleSize: 13.5, headingSize: 12.4,
    roleSize: 13.1, companySize: 12.7, metaSize: 11.3, contactSize: 11.2, skillGroupSize: 11.8,
    nameWeight: 700, titleWeight: 600, headingWeight: 750, roleWeight: 700, companyWeight: 500,
    nameLetterSpacing: 0, headingLetterSpacing: 1.1, lineHeight: 1.36,
  },
  'classic-serif': {
    id: 'classic-serif', font: 'Georgia, "Times New Roman", serif',
    bodyFontPx: 13.1, nameSize: 29, titleSize: 13.6, headingSize: 12.2,
    roleSize: 13.2, companySize: 12.8, metaSize: 11.3, contactSize: 11.2, skillGroupSize: 11.8,
    nameWeight: 700, titleWeight: 600, headingWeight: 700, roleWeight: 700, companyWeight: 500,
    nameLetterSpacing: 1.1, headingLetterSpacing: 1.15, lineHeight: 1.39,
  },
  'strict-calibri': {
    id: 'strict-calibri', font: 'Calibri, "Segoe UI", Arial, sans-serif',
    bodyFontPx: 12.8, nameSize: 27, titleSize: 13.2, headingSize: 12,
    roleSize: 12.9, companySize: 12.5, metaSize: 11.1, contactSize: 11, skillGroupSize: 11.6,
    nameWeight: 700, titleWeight: 600, headingWeight: 700, roleWeight: 700, companyWeight: 500,
    nameLetterSpacing: 0, headingLetterSpacing: 0.95, lineHeight: 1.34,
  },
  'engineering-mix': {
    id: 'engineering-mix', font: '"Helvetica Neue", Arial, sans-serif', monoAccent: '"SF Mono", "Cascadia Code", Consolas, monospace',
    bodyFontPx: 12.7, nameSize: 28, titleSize: 13.4, headingSize: 12,
    roleSize: 12.9, companySize: 12.4, metaSize: 10.9, contactSize: 10.7, skillGroupSize: 11.6,
    nameWeight: 750, titleWeight: 650, headingWeight: 800, roleWeight: 750, companyWeight: 500,
    nameLetterSpacing: -0.15, headingLetterSpacing: 1.2, lineHeight: 1.36,
  },
  'cloud-engineering': {
    id: 'cloud-engineering', font: '"Helvetica Neue", Arial, sans-serif', monoAccent: '"SF Mono", "Cascadia Code", Consolas, monospace',
    bodyFontPx: 12.6, nameSize: 28.5, titleSize: 13.2, headingSize: 11.8,
    roleSize: 12.9, companySize: 12.2, metaSize: 10.7, contactSize: 10.6, skillGroupSize: 11.4,
    nameWeight: 760, titleWeight: 650, headingWeight: 800, roleWeight: 760, companyWeight: 550,
    nameLetterSpacing: -0.1, headingLetterSpacing: 1.05, lineHeight: 1.35,
  },
  'editorial-premium': {
    id: 'editorial-premium', font: 'Georgia, "Times New Roman", serif',
    bodyFontPx: 13.2, nameSize: 31, titleSize: 12.9, headingSize: 11.7,
    roleSize: 13.4, companySize: 12.4, metaSize: 10.9, contactSize: 10.8, skillGroupSize: 11.4,
    nameWeight: 700, titleWeight: 600, headingWeight: 700, roleWeight: 700, companyWeight: 500,
    nameLetterSpacing: 1.45, headingLetterSpacing: 1.35, lineHeight: 1.43,
  },
  'student-premium': {
    id: 'student-premium', font: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    bodyFontPx: 12.9, nameSize: 29.5, titleSize: 13.1, headingSize: 11.8,
    roleSize: 13.05, companySize: 12.3, metaSize: 10.8, contactSize: 10.7, skillGroupSize: 11.3,
    nameWeight: 760, titleWeight: 650, headingWeight: 800, roleWeight: 750, companyWeight: 550,
    nameLetterSpacing: -0.1, headingLetterSpacing: 1.05, lineHeight: 1.36,
  },
  'signature-sans': {
    id: 'signature-sans', font: '"Helvetica Neue", Helvetica, Arial, sans-serif', monoAccent: '"SF Mono", "Cascadia Code", Consolas, monospace',
    bodyFontPx: 13.05, nameSize: 30.5, titleSize: 13.25, headingSize: 11.9,
    roleSize: 13.2, companySize: 12.35, metaSize: 10.85, contactSize: 10.75, skillGroupSize: 11.45,
    nameWeight: 770, titleWeight: 650, headingWeight: 800, roleWeight: 760, companyWeight: 550,
    nameLetterSpacing: -0.2, headingLetterSpacing: 1.12, lineHeight: 1.39,
  },
  'corporate-modern': {
    id: 'corporate-modern', font: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    bodyFontPx: 13.05, nameSize: 29.5, titleSize: 13.1, headingSize: 11.75,
    roleSize: 13.15, companySize: 12.35, metaSize: 10.85, contactSize: 10.7, skillGroupSize: 11.4,
    nameWeight: 730, titleWeight: 620, headingWeight: 760, roleWeight: 730, companyWeight: 520,
    nameLetterSpacing: -0.05, headingLetterSpacing: 1.18, lineHeight: 1.4,
  },
  'precision-sans': {
    id: 'precision-sans', font: '"Helvetica Neue", Arial, sans-serif', monoAccent: 'Consolas, "SF Mono", monospace',
    bodyFontPx: 12.75, nameSize: 28.8, titleSize: 13, headingSize: 11.7,
    roleSize: 12.95, companySize: 12.2, metaSize: 10.65, contactSize: 10.55, skillGroupSize: 11.25,
    nameWeight: 760, titleWeight: 650, headingWeight: 820, roleWeight: 750, companyWeight: 540,
    nameLetterSpacing: -0.1, headingLetterSpacing: 1.28, lineHeight: 1.36,
  },
  'research-serif': {
    id: 'research-serif', font: 'Georgia, "Times New Roman", serif',
    bodyFontPx: 13.15, nameSize: 30, titleSize: 13, headingSize: 11.65,
    roleSize: 13.2, companySize: 12.4, metaSize: 10.9, contactSize: 10.7, skillGroupSize: 11.35,
    nameWeight: 700, titleWeight: 600, headingWeight: 700, roleWeight: 700, companyWeight: 500,
    nameLetterSpacing: 1.2, headingLetterSpacing: 1.25, lineHeight: 1.43,
  },
  'executive-serif': {
    id: 'executive-serif', font: 'Georgia, serif',
    bodyFontPx: 13.4, nameSize: 31, titleSize: 14.2, headingSize: 12.8,
    roleSize: 13.6, companySize: 13, metaSize: 11.5, contactSize: 11.3, skillGroupSize: 12,
    nameWeight: 700, titleWeight: 600, headingWeight: 700, roleWeight: 700, companyWeight: 500,
    nameLetterSpacing: 1.25, headingLetterSpacing: 1.1, lineHeight: 1.42,
  },
  'executive-premium': {
    id: 'executive-premium', font: 'Georgia, "Times New Roman", serif',
    bodyFontPx: 12.8, nameSize: 32, titleSize: 13, headingSize: 11.7,
    roleSize: 13.25, companySize: 12.05, metaSize: 10.7, contactSize: 10.45, skillGroupSize: 11.2,
    nameWeight: 700, titleWeight: 600, headingWeight: 700, roleWeight: 700, companyWeight: 500,
    nameLetterSpacing: 1.5, headingLetterSpacing: 1.3, lineHeight: 1.39,
  },
  'precision-classic-serif': {
    id: 'precision-classic-serif', font: 'Georgia, "Times New Roman", serif',
    bodyFontPx: 12.65, nameSize: 28.8, titleSize: 12.7, headingSize: 11.7,
    roleSize: 12.95, companySize: 12.25, metaSize: 10.65, contactSize: 10.45, skillGroupSize: 11.2,
    nameWeight: 700, titleWeight: 600, headingWeight: 700, roleWeight: 700, companyWeight: 600,
    nameLetterSpacing: 0.45, headingLetterSpacing: 0.9, lineHeight: 1.34,
  },
  'heritage-detailed-serif': {
    id: 'heritage-detailed-serif', font: 'Georgia, "Times New Roman", serif',
    bodyFontPx: 13.05, nameSize: 31.5, titleSize: 13.1, headingSize: 12.2,
    roleSize: 13.4, companySize: 12.7, metaSize: 11.1, contactSize: 10.9, skillGroupSize: 11.6,
    nameWeight: 700, titleWeight: 600, headingWeight: 700, roleWeight: 700, companyWeight: 600,
    nameLetterSpacing: 0.55, headingLetterSpacing: 1.05, lineHeight: 1.43,
  },
  'centered-ats-sans': {
    id: 'centered-ats-sans', font: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    bodyFontPx: 12.55, nameSize: 28.2, titleSize: 12.7, headingSize: 11.7,
    roleSize: 12.9, companySize: 12.25, metaSize: 10.55, contactSize: 10.4, skillGroupSize: 11.2,
    nameWeight: 760, titleWeight: 620, headingWeight: 800, roleWeight: 760, companyWeight: 600,
    nameLetterSpacing: -0.1, headingLetterSpacing: 0.85, lineHeight: 1.34,
  },
  'modern-chip-sans': {
    id: 'modern-chip-sans', font: 'Calibri, "Segoe UI", Arial, sans-serif',
    bodyFontPx: 12.7, nameSize: 29, titleSize: 12.8, headingSize: 11.75,
    roleSize: 13.0, companySize: 12.3, metaSize: 10.6, contactSize: 10.45, skillGroupSize: 11.25,
    nameWeight: 760, titleWeight: 620, headingWeight: 800, roleWeight: 750, companyWeight: 600,
    nameLetterSpacing: -0.12, headingLetterSpacing: 0.9, lineHeight: 1.35,
  },
  'midnight-rail-sans': {
    id: 'midnight-rail-sans', font: '"Segoe UI", Arial, sans-serif',
    bodyFontPx: 12.55, nameSize: 28.5, titleSize: 12.7, headingSize: 11.6,
    roleSize: 12.95, companySize: 12.25, metaSize: 10.5, contactSize: 10.25, skillGroupSize: 11.05,
    nameWeight: 780, titleWeight: 620, headingWeight: 820, roleWeight: 760, companyWeight: 620,
    nameLetterSpacing: -0.1, headingLetterSpacing: 0.85, lineHeight: 1.34,
  },
};

export const SPACING_PRESETS = {
  compact: { id: 'compact', marginMm: 12, sectionGapPx: 10, itemGapPx: 5, bulletGapPx: 2.5 },
  balanced: { id: 'balanced', marginMm: 15, sectionGapPx: 14, itemGapPx: 7, bulletGapPx: 3.5 },
  spacious: { id: 'spacious', marginMm: 18, sectionGapPx: 18, itemGapPx: 9, bulletGapPx: 5 },
};


export const VISUAL_PRIMITIVES = {
  headerRules: {
    none: { id: 'none', thicknessPx: 0, colorToken: 'rule', insetPx: 0 },
    hairline: { id: 'hairline', thicknessPx: 0.8, colorToken: 'rule', insetPx: 0 },
    accent: { id: 'accent', thicknessPx: 1.5, colorToken: 'accent', insetPx: 0 },
  },
  sidebarPanels: {
    none: { id: 'none', backgroundToken: null, edgeWidthPx: 0, edgeColorToken: 'accent', paddingXpx: 0, paddingYpx: 0, radiusPx: 0, heightMode: 'full' },
    soft: { id: 'soft', backgroundToken: 'sidebarBg', edgeWidthPx: 0, edgeColorToken: 'accent', paddingXpx: 12, paddingYpx: 10, radiusPx: 4, heightMode: 'full' },
    'soft-accent-edge': { id: 'soft-accent-edge', backgroundToken: 'sidebarBg', edgeWidthPx: 2, edgeColorToken: 'accent', paddingXpx: 12, paddingYpx: 10, radiusPx: 4, heightMode: 'full' },
    /* Premium rail: content-aware height prevents a mostly-empty tinted column
       on one-page technical resumes. The panel remains deterministic and
       uses the same geometry contract in HTML and PDF. */
    'premium-content': {
      id: 'premium-content', backgroundToken: 'sidebarBg', edgeWidthPx: 1.5, edgeColorToken: 'accent',
      paddingXpx: 13, paddingYpx: 12, radiusPx: 3, heightMode: 'content', contentBottomPaddingPx: 12,
      headingRule: 'short-accent', headingRuleWidthPx: 28,
    },
    'cloud-rail': {
      id: 'cloud-rail', backgroundToken: 'sidebarBg', edgeWidthPx: 2.4, edgeColorToken: 'accent',
      paddingXpx: 13, paddingYpx: 12, radiusPx: 2, heightMode: 'content', contentBottomPaddingPx: 10,
      headingRule: 'short-accent', headingRuleWidthPx: 22,
    },
    'student-rail': {
      id: 'student-rail', backgroundToken: 'sidebarBg', edgeWidthPx: 1.4, edgeColorToken: 'accent',
      paddingXpx: 12, paddingYpx: 11, radiusPx: 3, heightMode: 'content', contentBottomPaddingPx: 11,
      headingRule: 'short-accent', headingRuleWidthPx: 24,
    },
    'midnight-solid': {
      id: 'midnight-solid', backgroundToken: '#111827', edgeWidthPx: 0, edgeColorToken: '#111827',
      paddingXpx: 14, paddingYpx: 14, radiusPx: 0, heightMode: 'full', contentBottomPaddingPx: 0,
      headingRule: 'subtle-inverse', headingRuleWidthPx: 0,
      textColor: '#f8fafc', mutedColor: '#cbd5e1', headingColor: '#f8fafc', ruleColor: '#475569',
      chipFillColor: '#273244', chipBorderColor: '#465267', chipTextColor: '#f1f5f9',
    },
  },
  certificationBlocks: {
    plain: { id: 'plain', markerWidthPx: 0, markerColorToken: 'accent', markerGapPx: 0, itemGapPx: 0, fontWeight: 400 },
    accent: { id: 'accent', markerWidthPx: 2, markerColorToken: 'accent', markerGapPx: 7, itemGapPx: 2.5, fontWeight: 500 },
    featured: { id: 'featured', markerWidthPx: 2.6, markerColorToken: 'accent', markerGapPx: 8, itemGapPx: 4.5, fontWeight: 650 },
  },
  projectMeta: {
    plain: { id: 'plain', marker: false, markerColorToken: 'accent' },
    accent: { id: 'accent', marker: true, markerColorToken: 'accent' },
  },
  verifiedBadges: {
    outline: { id: 'outline', fillToken: null, borderToken: 'accent', textToken: 'accent' },
    soft: { id: 'soft', fillToken: 'sidebarBg', borderToken: 'rule', textToken: 'accent' },
  },
  /* Two-column composition is a visual primitive rather than a bespoke
     template hack. The rule sits in the gutter so neither column loses
     usable width; reference-column metrics can tighten only the supporting
     column while leaving the narrative column untouched. */
  columnTreatments: {
    none: {
      id: 'none', dividerWidthPx: 0, dividerColorToken: 'rule', dividerInsetTopPx: 0, dividerInsetBottomPx: 0,
      referenceRegion: null, referenceSectionGapScale: 1, referenceHeadingScale: 1, referenceHeadingGapScale: 1,
    },
    'editorial-split': {
      id: 'editorial-split', dividerWidthPx: 0.8, dividerColorToken: 'rule', dividerInsetTopPx: 1, dividerInsetBottomPx: 2,
      referenceRegion: 'left', referenceSectionGapScale: 0.82, referenceHeadingScale: 0.92, referenceHeadingGapScale: 0.82,
      heightMode: 'content', contentBottomPaddingPx: 6,
    },
  },
  singleColumnTreatments: {
    none: { id: 'none', contentWidthScale: 1, align: 'left' },
    'editorial-flow': {
      id: 'editorial-flow', contentWidthScale: 0.94, align: 'center',
      describe: 'Slightly narrower centered narrative measure beneath a full-width editorial identity header.'
    },
    'signature-flow': {
      id: 'signature-flow', contentWidthScale: 0.965, align: 'center',
      describe: 'Premium near-full-width measure for evidence-rich technical resumes with controlled line length.'
    },
    'corporate-flow': {
      id: 'corporate-flow', contentWidthScale: 0.97, align: 'center',
      describe: 'Quiet corporate reading measure with enough width for quantified impact bullets.'
    },
    'research-flow': {
      id: 'research-flow', contentWidthScale: 0.94, align: 'center',
      describe: 'Editorial research measure designed for publications, patents and long technical titles.'
    },
    'executive-flow': {
      id: 'executive-flow', contentWidthScale: 0.955, align: 'center',
      describe: 'Leadership-focused reading measure that keeps long impact bullets controlled beneath the full-width executive identity band.'
    },
  },
  summaryTreatments: {
    none: { id: 'none', sizeScale: 1, lineHeightScale: 1, colorToken: 'text' },
    'editorial-lead': {
      id: 'editorial-lead', sizeScale: 1.035, lineHeightScale: 1.045, colorToken: 'muted',
      describe: 'Quiet lead paragraph with a slightly larger measure and softer tone.'
    },
    'executive-lead': {
      id: 'executive-lead', sizeScale: 1.055, lineHeightScale: 1.055, colorToken: 'text',
      describe: 'Impact-forward executive profile paragraph with slightly larger type and deliberate reading rhythm.'
    },
    'student-intro': {
      id: 'student-intro', sizeScale: 1.015, lineHeightScale: 1.025, colorToken: 'muted',
      describe: 'Compact student profile lead that establishes direction without consuming project or education space.'
    },
  },
};

export const COLOR_PRESETS = {
  slate: { id: 'slate', accent: '#0f172a', rule: '#cbd5e1', sidebarBg: '#f1f5f9', text: '#111827', muted: '#4b5563' },
  navy: { id: 'navy', accent: '#1e3a5f', rule: '#c7d2e2', sidebarBg: '#eef2f7', text: '#111827', muted: '#475569' },
  indigo: { id: 'indigo', accent: '#4338ca', rule: '#d5d3f0', sidebarBg: '#f2f1fb', text: '#111827', muted: '#4b5563' },
  teal: { id: 'teal', accent: '#0f766e', rule: '#c8e2df', sidebarBg: '#eef7f6', text: '#111827', muted: '#44615e' },
  burgundy: { id: 'burgundy', accent: '#7f1d1d', rule: '#e4cfcf', sidebarBg: '#f8f1f1', text: '#1c1917', muted: '#57534e' },
  monochrome: { id: 'monochrome', accent: '#111827', rule: '#d1d5db', sidebarBg: '#f4f4f5', text: '#111827', muted: '#52525b' },
  ink: { id: 'ink', accent: '#23262d', rule: '#d6d3d1', sidebarBg: '#f7f6f4', text: '#18181b', muted: '#6b6b70' },
  'graphite-blue': { id: 'graphite-blue', accent: '#23364d', rule: '#d3dbe4', sidebarBg: '#f3f6f9', text: '#17202b', muted: '#65717f' },
  'security-steel': { id: 'security-steel', accent: '#334155', rule: '#d4dbe3', sidebarBg: '#f2f5f7', text: '#111827', muted: '#5b6675' },
  'research-maroon': { id: 'research-maroon', accent: '#6f263d', rule: '#e4d4da', sidebarBg: '#faf5f7', text: '#211a1d', muted: '#66575d' },
  'product-blue': { id: 'product-blue', accent: '#25518a', rule: '#d2ddea', sidebarBg: '#f3f7fb', text: '#172236', muted: '#607083' },
  'executive-navy': { id: 'executive-navy', accent: '#18283d', rule: '#d3d9e1', sidebarBg: '#f3f5f7', text: '#1b2430', muted: '#687383' },
  'campus-blue': { id: 'campus-blue', accent: '#1f4b7a', rule: '#cfdae7', sidebarBg: '#f3f7fb', text: '#172235', muted: '#627186' },
  'reference-rust': { id: 'reference-rust', accent: '#9a4f1e', rule: '#d9c0ad', sidebarBg: '#faf5f1', text: '#26272b', muted: '#667085' },
  'reference-violet': { id: 'reference-violet', accent: '#7c3aed', rule: '#d9c7f6', sidebarBg: '#f2eafd', text: '#202636', muted: '#687387' },
  'reference-sky': { id: 'reference-sky', accent: '#0284c7', rule: '#b9ddec', sidebarBg: '#e7f4fa', text: '#202636', muted: '#64748b' },
  'reference-midnight': { id: 'reference-midnight', accent: '#0e7490', rule: '#c8d8df', sidebarBg: '#eef6f8', text: '#202636', muted: '#667085' },
  'reference-amber': { id: 'reference-amber', accent: '#b45309', rule: '#dcc3a8', sidebarBg: '#faf5ef', text: '#2c2d31', muted: '#6b7280' },
};

/* The registry object the DSL validator + compiler consume. */
export const PRIMITIVES = Object.freeze({
  pages: PAGE_PRIMITIVES,
  headers: HEADER_PRIMITIVES,
  dividers: SECTION_DIVIDERS,
  skills: SKILLS_PRIMITIVES,
  experience: EXPERIENCE_PRIMITIVES,
  projects: PROJECT_PRIMITIVES,
  education: EDUCATION_PRIMITIVES,
  typography: TYPOGRAPHY_PRESETS,
  spacing: SPACING_PRESETS,
  colors: COLOR_PRESETS,
  visual: VISUAL_PRIMITIVES,
});

export default { PRIMITIVES_VERSION, PRIMITIVES, PAGE_PRIMITIVES, HEADER_PRIMITIVES, SECTION_DIVIDERS, SKILLS_PRIMITIVES, EXPERIENCE_PRIMITIVES, PROJECT_PRIMITIVES, EDUCATION_PRIMITIVES, TYPOGRAPHY_PRESETS, SPACING_PRESETS, COLOR_PRESETS, VISUAL_PRIMITIVES };
