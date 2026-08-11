/* ============================================================
   TEMPLATE OS — SHARED RENDER DESIGN METRICS
   ------------------------------------------------------------
   One resolved design contract consumed by BOTH the HTML/CSS
   compiler and the vector PDF writer. This keeps the preview and
   exported document aligned on geometry, spacing, typography,
   header behavior, and sidebar treatment without coupling either
   renderer to the other.
   ============================================================ */
import { READABILITY_FLOORS } from './dsl.js';

export const RENDER_DESIGN_VERSION = 'template-render-design-v12-reference-premium-families';
export const CSS_PX_TO_PT = 0.75;
export const MM_TO_PT = 2.83465;

export const PAGE_DIMENSIONS = Object.freeze({
  a4: { css: { w: 794, h: 1123 }, pdf: { w: 595.28, h: 841.89 } },
  letter: { css: { w: 816, h: 1056 }, pdf: { w: 612, h: 792 } },
});

const pxToPt = (v) => Number(v || 0) * CSS_PX_TO_PT;
const mmToPt = (v) => Number(v || 0) * MM_TO_PT;

export function resolveRenderDesign(compiled, { sizeId = 'a4' } = {}) {
  if (!compiled?.ok) throw new Error('resolveRenderDesign needs a successfully compiled template');
  const { tokens, tree } = compiled;
  const { typography: ty, spacing: sp, header: hd, skills: skill = {}, experience: exp = {}, projects: proj = {}, education: edu = {}, visual = {} } = tokens;
  const page = PAGE_DIMENSIONS[sizeId] || PAGE_DIMENSIONS.a4;

  const bodyPx = Math.max(READABILITY_FLOORS.minBodyFontPx, ty.bodyFontPx);
  const smallPx = Math.max(READABILITY_FLOORS.minSmallFontPx, ty.metaSize || (bodyPx - 1.2));
  const contactPx = Math.max(READABILITY_FLOORS.minSmallFontPx, ty.contactSize || (bodyPx - 1.2));
  const skillGroupPx = Math.max(READABILITY_FLOORS.minSmallFontPx, ty.skillGroupSize || (bodyPx - 0.5));
  const lineHeight = Math.max(READABILITY_FLOORS.minLineHeight, ty.lineHeight);
  const marginMm = Math.max(READABILITY_FLOORS.minMarginMm, sp.marginMm);
  const densityMode = ['compact', 'balanced', 'spacious'].includes(sp.densityMode) ? sp.densityMode : 'balanced';
  const density = {
    mode: densityMode,
    basePreset: sp.densityBasePreset || sp.preset || 'balanced',
    metaGapScale: densityMode === 'compact' ? 0.82 : densityMode === 'spacious' ? 1.16 : 1,
    headerMicroGapScale: densityMode === 'compact' ? 0.86 : densityMode === 'spacious' ? 1.12 : 1,
    metadataLayout: densityMode === 'compact' ? 'condensed' : densityMode === 'spacious' ? 'open' : 'standard',
  };
  const columnGapPx = sp.sectionGapPx + 6;

  const headerRule = visual.headerRule || { thicknessPx: 0, insetPx: 0, colorToken: 'rule' };
  const sidebarPanel = visual.sidebarPanel || {
    backgroundToken: null, edgeWidthPx: 0, edgeColorToken: 'accent',
    paddingXpx: 0, paddingYpx: 0, radiusPx: 0,
  };

  /* Header geometry intentionally lives here rather than in either renderer.
     Phase 8 makes headers real design primitives: layout, tone and accent
     behavior are resolved once, then consumed by both HTML and vector PDF. */
  const toneColor = (tone, fallback = tokens.colors.text) => {
    if (typeof tone === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(tone)) return tone;
    if (tone === 'accent') return tokens.colors.accent;
    if (tone === 'muted') return tokens.colors.muted;
    if (tone === 'inverse') return '#ffffff';
    if (tone === 'inverseMuted') return '#e5e7eb';
    if (tone === 'rule') return tokens.colors.rule;
    return fallback;
  };
  const header = {
    id: hd.id,
    layout: hd.layout || (hd.band ? 'band' : 'stack'),
    align: hd.align,
    contactAlign: hd.contactAlign || hd.align,
    band: !!hd.band,
    mono: !!hd.mono,
    nameCase: hd.nameCase,
    titleCase: hd.titleCase || 'none',
    contactLayout: hd.contactLayout,
    contactSeparator: hd.contactSeparator || ' · ',
    nameColor: toneColor(hd.nameTone, tokens.colors.text),
    titleColor: toneColor(hd.titleTone, tokens.colors.accent),
    contactColor: toneColor(hd.contactTone, tokens.colors.muted),
    bandBackgroundColor: toneColor(hd.bandBackgroundToken, tokens.colors.sidebarBg),
    marginBottomPx: hd.tight ? sp.sectionGapPx : sp.sectionGapPx + 4,
    titleMarginTopPx: (hd.layout === 'editorial' ? 4 : 3) * density.headerMicroGapScale,
    contactMarginTopPx: (hd.layout === 'student' ? 7 : 6) * density.headerMicroGapScale,
    contactLineHeight: hd.layout === 'split' ? 1.24 : 1.3,
    contactGridColumns: Math.max(1, Math.min(3, Number(hd.contactGridColumns) || 3)),
    contactGridColumnGapPx: hd.layout === 'technical' ? 18 : 14,
    contactGridRowGapPx: hd.layout === 'technical' ? 3 : 2,
    splitPrimaryShare: Math.max(0.45, Math.min(0.72, Number(hd.splitPrimaryShare) || 0.6)),
    splitGapPx: Math.max(12, Number(hd.splitGapPx) || 20),
    primaryInsetPx: Math.max(0, Number(hd.primaryInsetPx) || 0),
    accentMark: hd.accentMark || 'none',
    accentMarkWidthPx: Math.max(0, Number(hd.accentMarkWidthPx) || 0),
    titleLetterSpacingPx: Number(hd.titleLetterSpacingPx) || 0,
    bandPaddingYPx: hd.layout === 'band' ? 15 : 14,
    bandPaddingXPx: hd.layout === 'band' ? 18 : 16,
    bandOutsetMm: 6,
    rule: headerRule,
    rulePaddingBottomPx: headerRule.thicknessPx > 0 ? Math.max(7, Math.round(sp.itemGapPx + 2)) : 0,
  };

  const typography = {
    bodyPx,
    smallPx,
    metaPx: smallPx,
    contactPx,
    skillGroupPx,
    titlePx: ty.titleSize || (bodyPx + 0.5),
    rolePx: ty.roleSize || bodyPx,
    companyPx: ty.companySize || bodyPx,
    headingPx: ty.headingSize,
    namePx: ty.nameSize,
    lineHeight,
    bodyPt: pxToPt(bodyPx),
    smallPt: pxToPt(smallPx),
    metaPt: pxToPt(smallPx),
    contactPt: pxToPt(contactPx),
    skillGroupPt: pxToPt(skillGroupPx),
    titlePt: pxToPt(ty.titleSize || (bodyPx + 0.5)),
    rolePt: pxToPt(ty.roleSize || bodyPx),
    companyPt: pxToPt(ty.companySize || bodyPx),
    headingPt: pxToPt(ty.headingSize),
    namePt: pxToPt(ty.nameSize),
  };

  const spacing = {
    marginMm,
    marginPt: mmToPt(marginMm),
    sectionGapPx: sp.sectionGapPx,
    sectionGapPt: pxToPt(sp.sectionGapPx),
    itemGapPx: sp.itemGapPx,
    itemGapPt: pxToPt(sp.itemGapPx),
    bulletGapPx: sp.bulletGapPx,
    bulletGapPt: pxToPt(sp.bulletGapPx),
    columnGapPx,
    columnGapPt: pxToPt(columnGapPx),
  };

  const sidebar = {
    ...sidebarPanel,
    heightMode: sidebarPanel.heightMode || 'full',
    paddingXPt: pxToPt(sidebarPanel.paddingXpx || 0),
    paddingYPt: pxToPt(sidebarPanel.paddingYpx || 0),
    contentBottomPaddingPt: pxToPt(sidebarPanel.contentBottomPaddingPx ?? sidebarPanel.paddingYpx ?? 0),
    edgeWidthPt: pxToPt(sidebarPanel.edgeWidthPx || 0),
    radiusPt: pxToPt(sidebarPanel.radiusPx || 0),
    textColor: sidebarPanel.textColor || null,
    mutedColor: sidebarPanel.mutedColor || null,
    headingColor: sidebarPanel.headingColor || null,
    ruleColor: sidebarPanel.ruleColor || null,
    chipFillColor: sidebarPanel.chipFillColor || null,
    chipBorderColor: sidebarPanel.chipBorderColor || null,
    chipTextColor: sidebarPanel.chipTextColor || null,
  };

  const columnTreatment = visual.columnTreatment || {
    id: 'none', dividerWidthPx: 0, dividerColorToken: 'rule', dividerInsetTopPx: 0, dividerInsetBottomPx: 0,
    referenceRegion: null, referenceSectionGapScale: 1, referenceHeadingScale: 1, referenceHeadingGapScale: 1,
  };
  const columns = {
    ...columnTreatment,
    heightMode: columnTreatment.heightMode || 'full',
    dividerWidthPt: pxToPt(columnTreatment.dividerWidthPx || 0),
    dividerInsetTopPt: pxToPt(columnTreatment.dividerInsetTopPx || 0),
    dividerInsetBottomPt: pxToPt(columnTreatment.dividerInsetBottomPx || 0),
    contentBottomPaddingPt: pxToPt(columnTreatment.contentBottomPaddingPx || 0),
  };

  const singleColumnBase = visual.singleColumnTreatment || { id: 'none', contentWidthScale: 1, align: 'left' };
  const singleColumn = {
    ...singleColumnBase,
    contentWidthScale: Math.max(0.82, Math.min(1, Number(singleColumnBase.contentWidthScale) || 1)),
  };

  const summaryBase = visual.summaryTreatment || { id: 'none', sizeScale: 1, lineHeightScale: 1, colorToken: 'text' };
  const summaryColor = summaryBase.colorToken === 'muted' ? tokens.colors.muted
    : summaryBase.colorToken === 'accent' ? tokens.colors.accent : tokens.colors.text;
  const summary = {
    ...summaryBase,
    sizePx: bodyPx * (Number(summaryBase.sizeScale) || 1),
    sizePt: pxToPt(bodyPx * (Number(summaryBase.sizeScale) || 1)),
    lineHeight: lineHeight * (Number(summaryBase.lineHeightScale) || 1),
    color: summaryColor,
  };

  /* Skill presentation is a first-class shared render contract. Technical
     resumes frequently carry 20-30 skills; treating each as an independent
     row creates a database-list feel and wastes rail height. These metrics
     let HTML and vector PDF render the same grouped, pill-free hierarchy. */
  const skillItemPx = Math.max(READABILITY_FLOORS.minSmallFontPx, bodyPx * (Number(skill.itemSizeScale) || 1));
  const skillLabelPx = Math.max(READABILITY_FLOORS.minSmallFontPx, skillGroupPx * (Number(skill.labelSizeScale) || 1));
  const sidebarItemPx = Math.max(READABILITY_FLOORS.minSmallFontPx, bodyPx * Math.min(0.96, Number(skill.itemSizeScale) || 0.94));
  const sidebarLabelPx = Math.max(READABILITY_FLOORS.minSmallFontPx, skillGroupPx * Math.min(0.98, Number(skill.labelSizeScale) || 0.96));
  const labelColor = skill.labelTone === 'accent' ? tokens.colors.accent
    : skill.labelTone === 'muted' ? tokens.colors.muted : tokens.colors.text;
  const skills = {
    id: skill.id || 'categorized',
    mode: skill.mode || 'categorized',
    delimiter: skill.delimiter || ' · ',
    labelCase: skill.labelCase || 'none',
    labelLayout: skill.labelLayout || 'inline',
    labelColor,
    itemPx: skillItemPx,
    itemPt: pxToPt(skillItemPx),
    labelPx: skillLabelPx,
    labelPt: pxToPt(skillLabelPx),
    sidebarItemPx,
    sidebarItemPt: pxToPt(sidebarItemPx),
    sidebarLabelPx,
    sidebarLabelPt: pxToPt(sidebarLabelPx),
    groupGapPx: Math.max(3.5, sp.itemGapPx * (Number(skill.groupGapScale) || 0.9)),
    groupGapPt: pxToPt(Math.max(3.5, sp.itemGapPx * (Number(skill.groupGapScale) || 0.9))),
    labelGapPx: skill.mode === 'sidebar-groups' ? 2.2 : 2.6,
    labelGapPt: pxToPt(skill.mode === 'sidebar-groups' ? 2.2 : 2.6),
    rowGapPx: Math.max(2.4, sp.itemGapPx * 0.55),
    rowGapPt: pxToPt(Math.max(2.4, sp.itemGapPx * 0.55)),
    separatorGapPx: skill.mode === 'sidebar-groups' ? 2.3 : 3,
    separatorGapPt: pxToPt(skill.mode === 'sidebar-groups' ? 2.3 : 3),
    inlineLabelGapPx: 5,
    inlineLabelGapPt: pxToPt(5),
    labelTrackingPx: skill.mode === 'sidebar-groups' ? 0.45 : 0.12,
    inlineLabelTrackingPx: 0.08,
    sidebarLabelTrackingPx: 0.72,
    lineHeight: Math.max(1.28, lineHeight),
    sidebarLineHeight: Math.max(1.3, lineHeight),
    chipFillToken: skill.chipFillToken || 'sidebarBg',
    chipBorderToken: skill.chipBorderToken || 'rule',
    chipTextToken: skill.chipTextToken || 'accent',
    chipPadXpx: Math.max(4, Number(skill.chipPadXpx) || 8),
    chipPadXPt: pxToPt(Math.max(4, Number(skill.chipPadXpx) || 8)),
    chipPadYpx: Math.max(1.5, Number(skill.chipPadYpx) || 3),
    chipPadYPt: pxToPt(Math.max(1.5, Number(skill.chipPadYpx) || 3)),
    chipGapXpx: Math.max(2, Number(skill.chipGapXpx) || 5),
    chipGapXPt: pxToPt(Math.max(2, Number(skill.chipGapXpx) || 5)),
    chipGapYpx: Math.max(2, Number(skill.chipGapYpx) || 4),
    chipGapYPt: pxToPt(Math.max(2, Number(skill.chipGapYpx) || 4)),
    chipRadiusPx: Math.max(0, Number(skill.chipRadiusPx) || 999),
  };

  /* Experience geometry belongs in the shared contract so role/company/date
     hierarchy does not drift between Resume Studio preview and vector PDF. */
  const experience = {
    id: exp.id || 'classic',
    headerLayout: exp.headerLayout || (exp.dateAlign === 'inline' ? 'inline' : 'stacked'),
    dateAlign: exp.dateAlign || 'right',
    companyLine: exp.companyLine !== false,
    companyTone: exp.companyTone || 'text',
    locationTone: exp.locationTone || 'muted',
    stackLine: !!exp.stackLine,
    stackFont: exp.stackFont || 'body',
    stackLabel: exp.stackLabel || '',
    stackLabelGapPx: Math.max(4, Number(exp.stackLabelGapPx) || 6),
    stackLabelGapPt: pxToPt(Math.max(4, Number(exp.stackLabelGapPx) || 6)),
    leadBullet: exp.leadBullet || null,
    tight: !!exp.tight,
    itemGapPx: Math.max(3, sp.itemGapPx * (Number(exp.itemGapScale) || 1)),
    itemGapPt: pxToPt(Math.max(3, sp.itemGapPx * (Number(exp.itemGapScale) || 1))),
    metaGapPx: (exp.tight ? 1 : 2) * density.metaGapScale,
    metaGapPt: pxToPt((exp.tight ? 1 : 2) * density.metaGapScale),
    stackGapPx: (exp.tight ? 1 : 2.5) * density.metaGapScale,
    stackGapPt: pxToPt((exp.tight ? 1 : 2.5) * density.metaGapScale),
    bulletTopGapPx: (exp.tight ? 2 : 3.5) * density.metaGapScale,
    bulletTopGapPt: pxToPt((exp.tight ? 2 : 3.5) * density.metaGapScale),
    bulletIndentPx: exp.tight ? 14 : 17,
    bulletIndentPt: pxToPt(exp.tight ? 14 : 17),
    dateGapPx: 10,
    dateGapPt: pxToPt(10),
  };

  /* Project geometry is shared by preview and vector PDF. Projects remain
     visually distinct from employment: the name leads, technology/link data
     sits on a restrained metadata line, and verification is a small state
     marker rather than a dominant badge. */
  const projects = {
    id: proj.id || 'classic',
    headerLayout: proj.headerLayout || 'stacked',
    metaLayout: proj.metaLayout || 'split',
    techFont: proj.techFont || 'body',
    badge: !!proj.badge,
    badgeLabel: proj.badgeLabel || 'VERIFIED',
    tight: !!proj.tight,
    maxBullets: Number.isFinite(Number(proj.maxBullets)) ? Math.max(1, Number(proj.maxBullets)) : (proj.tight ? 2 : 99),
    itemGapPx: Math.max(3, sp.itemGapPx * (Number(proj.itemGapScale) || 1)),
    itemGapPt: pxToPt(Math.max(3, sp.itemGapPx * (Number(proj.itemGapScale) || 1))),
    metaGapPx: (proj.tight ? 1 : 2.5) * density.metaGapScale,
    metaGapPt: pxToPt((proj.tight ? 1 : 2.5) * density.metaGapScale),
    bulletTopGapPx: (proj.tight ? 2 : 3.5) * density.metaGapScale,
    bulletTopGapPt: pxToPt((proj.tight ? 2 : 3.5) * density.metaGapScale),
    bulletIndentPx: proj.tight ? 14 : 17,
    bulletIndentPt: pxToPt(proj.tight ? 14 : 17),
    linkMaxShare: 0.46,
  };

  const educationSchoolColor = edu.schoolTone === 'accent' ? tokens.colors.accent
    : edu.schoolTone === 'muted' ? tokens.colors.muted : tokens.colors.text;
  const educationDegreeColor = edu.degreeTone === 'accent' ? tokens.colors.accent
    : edu.degreeTone === 'muted' ? tokens.colors.muted : tokens.colors.text;
  const educationDetailsColor = edu.detailsTone === 'text' ? tokens.colors.text
    : edu.detailsTone === 'accent' ? tokens.colors.accent : tokens.colors.muted;
  const education = {
    id: edu.id || 'classic',
    layout: edu.layout || 'inline',
    dateAlign: edu.dateAlign || 'right',
    schoolColor: educationSchoolColor,
    degreeColor: educationDegreeColor,
    detailsColor: educationDetailsColor,
    schoolPx: Math.max(READABILITY_FLOORS.minBodyFontPx, (ty.roleSize || bodyPx) * (Number(edu.schoolSizeScale) || 1)),
    degreePx: Math.max(READABILITY_FLOORS.minSmallFontPx, (ty.companySize || bodyPx) * (Number(edu.degreeSizeScale) || 1)),
    detailsPx: Math.max(READABILITY_FLOORS.minSmallFontPx, ty.metaSize || (bodyPx - 1.2)),
    schoolPt: pxToPt(Math.max(READABILITY_FLOORS.minBodyFontPx, (ty.roleSize || bodyPx) * (Number(edu.schoolSizeScale) || 1))),
    degreePt: pxToPt(Math.max(READABILITY_FLOORS.minSmallFontPx, (ty.companySize || bodyPx) * (Number(edu.degreeSizeScale) || 1))),
    detailsPt: pxToPt(Math.max(READABILITY_FLOORS.minSmallFontPx, ty.metaSize || (bodyPx - 1.2))),
    schoolWeight: Number(edu.schoolWeight) || 750,
    degreeWeight: Number(edu.degreeWeight) || 600,
    itemGapPx: Math.max(3, sp.itemGapPx * (Number(edu.itemGapScale) || 1)),
    itemGapPt: pxToPt(Math.max(3, sp.itemGapPx * (Number(edu.itemGapScale) || 1))),
    degreeGapPx: (edu.layout === 'featured' ? 2.2 : 1) * density.metaGapScale,
    degreeGapPt: pxToPt((edu.layout === 'featured' ? 2.2 : 1) * density.metaGapScale),
    detailsGapPx: 2.2 * density.metaGapScale,
    detailsGapPt: pxToPt(2.2 * density.metaGapScale),
    dateGapPx: 10,
    dateGapPt: pxToPt(10),
  };

  return {
    version: RENDER_DESIGN_VERSION,
    sizeId,
    page,
    tree,
    typography,
    spacing,
    density,
    header,
    sidebar,
    columns,
    singleColumn,
    summary,
    skills,
    experience,
    projects,
    education,
    visual,
    colors: tokens.colors,
  };
}

export default { RENDER_DESIGN_VERSION, CSS_PX_TO_PT, MM_TO_PT, PAGE_DIMENSIONS, resolveRenderDesign };
