/* ============================================================
   TEMPLATE OS — LAYOUT COMPILER
   ------------------------------------------------------------
   TemplateDefinition → validation → primitive resolution →
   LAYOUT TREE → HTML + CSS.

   THE READING-ORDER GUARANTEE: the DOM always follows canonical
   resume order (header → summary → skills → experience → …).
   Visual column placement is done with CSS grid areas, so text
   extraction from the markup yields the semantic order even when
   a section is *displayed* in a sidebar. This is what lets a
   sidebar template still measure HIGH on parse checks.

   The ResumeDocument never learns how a template renders; the
   compiler receives the already-selected structured content
   (toRendererStructured output) and only decides WHERE/HOW.
   ============================================================ */
import { PRIMITIVES, PRIMITIVES_VERSION } from './primitives.js';
import { validateTemplateDefinition, READABILITY_FLOORS, DENSITY_MODES } from './dsl.js';
import { resolveRenderDesign } from './renderDesign.js';

export const LAYOUT_COMPILER_VERSION = 'layout-compiler-v18-reference-premium-families';
export const DENSITY_ENGINE_VERSION = 'template-density-v1';
export const PAGE_COMPOSITION_VERSION = 'page-composition-v3-intentional-whitespace';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Accept both toRendererStructured output (skills as {group: [names]} map,
   projects.techStack, education.details[]) and plain fixture shapes
   (skills as [{group, items}], projects.tech, education.details string). */
const simpleText = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return String(value.text || value.name || '').trim();
  return '';
};
const simpleList = (value) => (Array.isArray(value) ? value : []).map(simpleText).filter(Boolean);

export function normalizeStructuredContent(input = {}) {
  const skills = Array.isArray(input.skills)
    ? input.skills
    : Object.entries(input.skills || {}).map(([group, items]) => ({ group, items: items || [] }));
  const projects = (input.projects || []).map((p) => ({ ...p, tech: p.tech || p.techStack || '' }));
  const education = (input.education || []).map((e) => ({ ...e, details: Array.isArray(e.details) ? e.details.join(' · ') : (e.details || '') }));
  const extra = Array.isArray(input.extraSections) ? input.extraSections : [];
  const directCustom = Array.isArray(input.customSections) ? input.customSections : [];
  const extraNamed = (title) => extra.filter((x) => String(x?.title || '').trim().toLowerCase() === title.toLowerCase()).flatMap((x) => x?.items || []);
  const reserved = new Set(['volunteer', 'volunteering', 'volunteer experience', 'languages', 'language']);
  const customSections = (directCustom.length ? directCustom : extra.filter((x) => !reserved.has(String(x?.title || '').trim().toLowerCase())))
    .map((x) => ({ title: String(x?.title || 'Additional').trim() || 'Additional', items: simpleList(x?.items) }))
    .filter((x) => x.items.length);
  const volunteer = simpleList(input.volunteer?.length ? input.volunteer : [...extraNamed('Volunteer'), ...extraNamed('Volunteering'), ...extraNamed('Volunteer Experience')]);
  const languages = simpleList(input.languages?.length ? input.languages : [...extraNamed('Languages'), ...extraNamed('Language')]);
  return {
    ...input,
    personalInfo: input.personalInfo || {},
    skills, projects, education,
    certifications: simpleList(input.certifications), achievements: simpleList(input.achievements),
    publications: simpleList(input.publications), patents: simpleList(input.patents),
    volunteer, languages, customSections,
  };
}

export const CANONICAL_ORDER = [
  'summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements',
  'publications', 'patents', 'volunteer', 'languages', 'customSections',
];

/* ------------------------------------------------------------------ */
/* 1. compileTemplate: definition → resolved layout tree               */
/* ------------------------------------------------------------------ */
export function normalizeTemplateDensity(value) {
  return DENSITY_MODES.includes(value) ? value : null;
}

export function normalizeResumeDensityToTemplateMode(value) {
  /* ResumeDocument persists the legacy renderer vocabulary. Keep that storage
     contract stable while Template OS exposes Compact / Balanced / Spacious. */
  if (value === 'comfortable') return 'spacious';
  if (value === 'compact') return 'balanced';
  if (value === 'tight') return 'compact';
  return normalizeTemplateDensity(value);
}

function resolveDensitySpacing(def, requestedDensity = null) {
  const basePresetId = DENSITY_MODES.includes(def.spacing?.preset) ? def.spacing.preset : 'balanced';
  const basePreset = PRIMITIVES.spacing[basePresetId] || PRIMITIVES.spacing.balanced;
  const base = { ...basePreset, ...(def.spacing || {}) };
  const targetMode = normalizeTemplateDensity(requestedDensity) || basePresetId;
  const targetPreset = PRIMITIVES.spacing[targetMode] || PRIMITIVES.spacing.balanced;

  /* Preserve each template's hand-tuned proportions while moving it between
     density modes. Ratios are derived from the common preset system rather
     than replacing template-specific values with generic numbers. */
  const scaled = { ...base };
  for (const key of ['marginMm', 'sectionGapPx', 'itemGapPx', 'bulletGapPx']) {
    const anchor = Number(basePreset[key]) || 1;
    const target = Number(targetPreset[key]) || anchor;
    scaled[key] = Number(((Number(base[key]) || anchor) * (target / anchor)).toFixed(3));
  }

  scaled.marginMm = Math.max(READABILITY_FLOORS.minMarginMm, scaled.marginMm);
  scaled.sectionGapPx = Math.max(7.5, scaled.sectionGapPx);
  scaled.itemGapPx = Math.max(3.5, scaled.itemGapPx);
  scaled.bulletGapPx = Math.max(2, scaled.bulletGapPx);
  scaled.preset = basePresetId;
  scaled.densityMode = targetMode;
  scaled.densityBasePreset = basePresetId;
  return scaled;
}

export function compileTemplate(def, { density = null } = {}) {
  const validation = validateTemplateDefinition(def, { primitives: PRIMITIVES });
  if (!validation.ok) return { ok: false, validation };

  const page = PRIMITIVES.pages[def.layout.type];
  const typography = { ...PRIMITIVES.typography[def.typography?.preset || 'system-sans'], ...def.typography };
  const spacing = resolveDensitySpacing(def, density);
  const colors = { ...PRIMITIVES.colors[def.colors?.preset || 'slate'], ...def.colors };
  const headerPrimitive = PRIMITIVES.headers[def.headerStyle?.primitive || 'minimal'];
  /* Header primitive supplies the safe renderer behavior; declarative numeric
     overrides (for example contactGridColumns) may tune one template without
     creating another bespoke component. */
  const header = { ...headerPrimitive, ...(def.headerStyle || {}), id: headerPrimitive.id };
  const skillPrimitive = PRIMITIVES.skills[def.skillStyle?.primitive || 'categorized'];
  const skills = { ...skillPrimitive, ...(def.skillStyle || {}), id: skillPrimitive.id };
  const experiencePrimitive = PRIMITIVES.experience[def.experienceStyle?.primitive || 'classic'];
  const experience = { ...experiencePrimitive, ...(def.experienceStyle || {}), id: experiencePrimitive.id };
  const projectPrimitive = PRIMITIVES.projects[def.projectStyle?.primitive || 'classic'];
  const projects = { ...projectPrimitive, ...(def.projectStyle || {}), id: projectPrimitive.id };
  const educationPrimitive = PRIMITIVES.education[def.educationStyle?.primitive || 'classic'];
  const education = { ...educationPrimitive, ...(def.educationStyle || {}), id: educationPrimitive.id };
  const divider = PRIMITIVES.dividers[def.sectionStyles?.divider || 'hairline'];
  const headerRuleId = def.visualStyle?.headerRule
    || (header.id === 'technical' ? 'hairline' : header.rule ? 'hairline' : 'none');
  const sidebarPanelId = def.visualStyle?.sidebarPanel
    || (def.layout.type === 'sidebar-left' || def.layout.type === 'sidebar-right' ? 'soft-accent-edge' : 'none');
  const certificationBlockId = def.visualStyle?.certificationBlock
    || (def.layout.type === 'sidebar-left' || def.layout.type === 'sidebar-right' ? 'accent' : 'plain');
  const projectMetaId = def.visualStyle?.projectMeta
    || (projects.badge || experience.stackLine ? 'accent' : 'plain');
  const verifiedBadgeId = def.visualStyle?.verifiedBadge || (projects.badge ? 'soft' : 'outline');
  const columnTreatmentId = def.visualStyle?.columnTreatment || 'none';
  const singleColumnTreatmentId = def.visualStyle?.singleColumnTreatment || 'none';
  const summaryTreatmentId = def.visualStyle?.summaryTreatment || 'none';
  const visual = {
    headerRule: PRIMITIVES.visual.headerRules[headerRuleId] || PRIMITIVES.visual.headerRules.none,
    sidebarPanel: PRIMITIVES.visual.sidebarPanels[sidebarPanelId] || PRIMITIVES.visual.sidebarPanels.none,
    certificationBlock: PRIMITIVES.visual.certificationBlocks[certificationBlockId] || PRIMITIVES.visual.certificationBlocks.plain,
    projectMeta: PRIMITIVES.visual.projectMeta[projectMetaId] || PRIMITIVES.visual.projectMeta.plain,
    verifiedBadge: PRIMITIVES.visual.verifiedBadges[verifiedBadgeId] || PRIMITIVES.visual.verifiedBadges.outline,
    columnTreatment: PRIMITIVES.visual.columnTreatments[columnTreatmentId] || PRIMITIVES.visual.columnTreatments.none,
    singleColumnTreatment: PRIMITIVES.visual.singleColumnTreatments[singleColumnTreatmentId] || PRIMITIVES.visual.singleColumnTreatments.none,
    summaryTreatment: PRIMITIVES.visual.summaryTreatments[summaryTreatmentId] || PRIMITIVES.visual.summaryTreatments.none,
  };

  const columns = def.layout.type === 'single-column'
    ? [{ id: 'main', width: 1 }]
    : (def.layout.columns || page.columns);

  /* region for each section: declared placement, else main, honoring order */
  /* A TemplateDefinition may prioritize core sections, but omitted canonical
     ResumeDocument sections must never silently disappear. Append the missing
     supported sections deterministically; empty ones cost no layout space. */
  const declaredOrder = (def.sectionOrder && def.sectionOrder.length ? def.sectionOrder : CANONICAL_ORDER)
    .filter((k) => CANONICAL_ORDER.includes(k));
  const order = [...new Set([...declaredOrder, ...CANONICAL_ORDER])];
  const regionOf = (sec) => {
    const p = def.sectionPlacement?.[sec];
    const target = typeof p === 'string' ? p : p?.region;
    return columns.some((c) => c.id === target) ? target : (columns.find((c) => c.id === 'main') ? 'main' : columns[0].id);
  };
  const fallbackOf = (sec) => {
    const p = def.sectionPlacement?.[sec];
    return (typeof p === 'object' && p?.fallback) || null;
  };

  const tree = {
    kind: 'page',
    layoutType: def.layout.type,
    columns,
    header: { kind: 'header', primitive: header },
    sections: order.map((key) => ({ kind: 'section', key, region: regionOf(key), fallback: fallbackOf(key) })),
  };

  return {
    ok: true, validation,
    version: LAYOUT_COMPILER_VERSION, primitivesVersion: PRIMITIVES_VERSION,
    def, tree, tokens: { typography, spacing, colors, header, skills, experience, projects, education, divider, visual },
  };
}

/* ------------------------------------------------------------------ */
/* 2. Region fallback adaptation driven by ResumeShape                 */
/*    (a sparse sidebar pulls fallback sections in; declared, never    */
/*     invented — only sections whose fallback IS the sidebar move)    */
/* ------------------------------------------------------------------ */
export function adaptTreeToShape(compiled, shape) {
  if (!compiled?.ok || !shape) return compiled;

  /* Phase 14: adapt the already-approved design rather than inventing a new
     template. The base TemplateDefinition stays immutable; only the compiled
     layout/tokens for this ResumeDocument are adjusted. Both HTML and PDF
     consume the same adapted object, so shape-aware behavior cannot drift. */
  const adaptedTree = {
    ...compiled.tree,
    columns: compiled.tree.columns.map((c) => ({ ...c })),
    sections: compiled.tree.sections.map((s) => ({ ...s })),
  };
  const adaptedTokens = {
    ...compiled.tokens,
    spacing: { ...compiled.tokens.spacing },
    skills: { ...compiled.tokens.skills },
    experience: { ...compiled.tokens.experience },
    projects: { ...compiled.tokens.projects },
    visual: {
      ...compiled.tokens.visual,
      sidebarPanel: { ...(compiled.tokens.visual?.sidebarPanel || {}) },
      columnTreatment: { ...(compiled.tokens.visual?.columnTreatment || {}) },
    },
  };
  const out = { ...compiled, tree: adaptedTree, tokens: adaptedTokens, shape };
  const moves = [];
  const adjustments = [];

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const section = (key) => adaptedTree.sections.find((s) => s.key === key);
  const sidebarCol = adaptedTree.columns.find((c) => c.id === 'sidebar');
  const narrativeRegion = section('experience')?.region || section('projects')?.region || (adaptedTree.columns.find((c) => c.id === 'main')?.id ?? adaptedTree.columns.at(-1)?.id);
  const narrativeCol = adaptedTree.columns.find((c) => c.id === narrativeRegion);
  const referenceCol = adaptedTree.columns.find((c) => c.id !== narrativeRegion);

  /* Sparse rails should not reserve premium page real estate for empty space.
     First honor explicitly-declared fallbacks; then narrow the rail slightly
     if it is still sparse. No undeclared section is moved. */
  if (sidebarCol) {
    const sparseRail = shape.railDensity === 'low' || ((shape.skillCount ?? 99) <= 8 && (shape.certificationCount ?? 0) <= 2);
    if (sparseRail) {
      for (const s of adaptedTree.sections) {
        if (s.region !== sidebarCol.id && s.fallback === sidebarCol.id) {
          moves.push({ section: s.key, from: s.region, to: sidebarCol.id, reason: 'sparse rail; declared fallback applied' });
          s.region = sidebarCol.id;
        }
      }
    }

    const baseRail = sidebarCol.width;
    let targetRail = baseRail;
    if (sparseRail) targetRail -= (shape.railLoadScore ?? 0) < 5 ? 0.035 : 0.025;
    if (shape.railDensity === 'high') targetRail += 0.015;
    if (shape.experiencePriority === 'high') targetRail -= 0.012;
    if (shape.projectDensity === 'high') targetRail -= 0.008;
    targetRail = clamp(targetRail, 0.25, 0.34);

    if (Math.abs(targetRail - baseRail) >= 0.004) {
      const other = adaptedTree.columns.find((c) => c.id !== sidebarCol.id);
      sidebarCol.width = Number(targetRail.toFixed(3));
      if (other) other.width = Number((1 - targetRail).toFixed(3));
      adjustments.push({ type: 'column-width', region: sidebarCol.id, from: baseRail, to: sidebarCol.width, reason: sparseRail ? 'rail content is sparse' : shape.experiencePriority === 'high' ? 'experience-heavy profile prioritizes narrative width' : 'rail content is dense' });
    }
  } else if (adaptedTree.layoutType === 'two-column' && narrativeCol && referenceCol && shape.experiencePriority === 'high') {
    /* A senior/multi-role profile benefits from a wider narrative column. Keep
       the editorial reference column useful rather than collapsing it. */
    const from = narrativeCol.width;
    const target = clamp(from + 0.035, 0.58, 0.67);
    if (target > from + 0.004) {
      narrativeCol.width = Number(target.toFixed(3));
      referenceCol.width = Number((1 - target).toFixed(3));
      adjustments.push({ type: 'column-width', region: narrativeCol.id, from, to: narrativeCol.width, reason: 'experience-heavy profile prioritizes narrative width' });
    }
  }

  /* Dense skills compact only the skill rhythm — never the body font or page
     margins. Readability floors remain enforced downstream by renderDesign. */
  if (shape.skillDensity === 'high' || shape.skillCount >= 24) {
    const before = {
      groupGapScale: adaptedTokens.skills.groupGapScale ?? 1,
      itemSizeScale: adaptedTokens.skills.itemSizeScale ?? 1,
      labelSizeScale: adaptedTokens.skills.labelSizeScale ?? 1,
    };
    adaptedTokens.skills.groupGapScale = Math.max(0.68, before.groupGapScale * 0.82);
    adaptedTokens.skills.itemSizeScale = Math.max(0.88, before.itemSizeScale * 0.96);
    adaptedTokens.skills.labelSizeScale = Math.max(0.9, before.labelSizeScale * 0.97);
    adjustments.push({ type: 'skill-density', from: before, to: { groupGapScale: adaptedTokens.skills.groupGapScale, itemSizeScale: adaptedTokens.skills.itemSizeScale, labelSizeScale: adaptedTokens.skills.labelSizeScale }, reason: 'high skill density uses compact grouped rhythm within readability floors' });
  }

  /* Project-heavy resumes switch to the approved compact presentation. Keep
     evidence/verification semantics from the selected template. */
  if (shape.projectCount >= 4) {
    const before = { id: adaptedTokens.projects.id, maxBullets: adaptedTokens.projects.maxBullets, itemGapScale: adaptedTokens.projects.itemGapScale };
    const compact = adaptedTokens.projects.badge ? (PRIMITIVES.projects['evidence-compact'] || PRIMITIVES.projects.compact) : PRIMITIVES.projects.compact;
    adaptedTokens.projects = {
      ...compact,
      badge: !!adaptedTokens.projects.badge,
      badgeLabel: adaptedTokens.projects.badgeLabel || compact.badgeLabel,
      techFont: adaptedTokens.projects.techFont || compact.techFont,
      id: `${adaptedTokens.projects.id || 'project'}-shape-compact`,
      maxBullets: Math.min(2, Number(adaptedTokens.projects.maxBullets) || 2),
      itemGapScale: Math.min(0.86, Number(adaptedTokens.projects.itemGapScale) || 0.86),
      tight: true,
    };
    adjustments.push({ type: 'project-density', from: before, to: { id: adaptedTokens.projects.id, maxBullets: adaptedTokens.projects.maxBullets, itemGapScale: adaptedTokens.projects.itemGapScale }, reason: 'project-heavy profile uses approved compact project geometry' });
  }

  /* Long/senior experience gets a small rhythm reduction after width priority.
     This is not content removal and never changes font size. */
  if (shape.experiencePriority === 'high') {
    const before = Number(adaptedTokens.experience.itemGapScale) || 1;
    adaptedTokens.experience.itemGapScale = Math.max(0.88, before * 0.94);
    adjustments.push({ type: 'experience-rhythm', from: before, to: adaptedTokens.experience.itemGapScale, reason: 'experience-heavy profile uses slightly tighter inter-role rhythm' });
  }

  return { ...out, adaptation: { version: 'shape-adaptation-v2', moves, adjustments } };
}


/* ------------------------------------------------------------------ */
/* 3. Premium one-page composition balancing                           */
/*    Use available vertical space deliberately instead of leaving a   */
/*    large accidental blank footer. This NEVER removes content or     */
/*    shrinks typography: under-filled one-page resumes receive modest */
/*    increases in reading measure, line-height and vertical rhythm.   */
/* ------------------------------------------------------------------ */
function treeIsNearFullSingleColumn(compiled, initial) {
  return compiled?.tree?.layoutType === 'single-column' && Number(initial?.utilization || 0) >= 0.7;
}

export function balancePageComposition(compiled, structuredInput, { sizeId = 'a4', enabled = true } = {}) {
  if (!compiled?.ok || !enabled) return compiled;
  const structured = normalizeStructuredContent(structuredInput);
  const initial = estimateGeometry(compiled, structured, { sizeId });
  const stage = compiled.shape?.careerStage || 'mid';
  const densityMode = compiled.tokens.spacing?.densityMode || 'balanced';

  /* Dense/two-page content must keep its existing rhythm. The balancing pass
     exists only for a genuine one-page under-fill, not as another auto-fit
     compression engine. */
  const threshold = densityMode === 'compact' ? 0.78 : 0.84;
  if (initial.pageCount !== 1 || initial.utilization >= threshold) {
    return { ...compiled, composition: { version: PAGE_COMPOSITION_VERSION, applied: false, reason: initial.pageCount !== 1 ? 'multi-page-or-overflow' : 'already-balanced', initial, final: initial, stage } };
  }

  const targetByStage = { student: 0.86, early: 0.88, mid: 0.9, senior: 0.91, executive: 0.92 };
  /* Very short resumes should look intentionally airy, not artificially
     stretched from 40% to 95% of a page. */
  const desired = initial.utilization < 0.45 ? 0.64
    : initial.utilization < 0.6 ? 0.76
      : (targetByStage[stage] || 0.9);
  const densityLimit = densityMode === 'compact' ? 0.72 : densityMode === 'spacious' ? 0.92 : 1;

  const base = {
    typography: { ...compiled.tokens.typography },
    spacing: { ...compiled.tokens.spacing },
    skills: { ...compiled.tokens.skills },
    experience: { ...compiled.tokens.experience },
    projects: { ...compiled.tokens.projects },
    visual: {
      ...compiled.tokens.visual,
      summaryTreatment: { ...(compiled.tokens.visual?.summaryTreatment || {}) },
      singleColumnTreatment: { ...(compiled.tokens.visual?.singleColumnTreatment || {}) },
    },
  };

  const apply = (amount) => {
    const a = Math.max(0, Math.min(1, amount * densityLimit));
    const tokens = {
      ...compiled.tokens,
      typography: { ...base.typography }, spacing: { ...base.spacing },
      skills: { ...base.skills }, experience: { ...base.experience }, projects: { ...base.projects },
      visual: {
        ...base.visual,
        summaryTreatment: { ...base.visual.summaryTreatment },
        singleColumnTreatment: { ...base.visual.singleColumnTreatment },
      },
    };
    const t = tokens.typography;
    const sp = tokens.spacing;
    const sparseBoost = treeIsNearFullSingleColumn(compiled, initial) ? 1
      : initial.utilization < 0.55 ? 1.34 : initial.utilization < 0.68 ? 1.22 : initial.utilization < 0.76 ? 1.08 : 1;
    /* A premium under-filled page benefits more from better breathing room and
       a slightly more confident text size than from pushing blocks to the foot
       with arbitrary spacers. Very sparse resumes get a stronger, still-capped
       editorial rhythm so the page feels composed rather than top-heavy. */
    t.bodyFontPx = Number(Math.min((base.typography.bodyFontPx || 13) + (initial.utilization < 0.68 ? 0.8 : 0.6), (base.typography.bodyFontPx || 13) * (1 + 0.05 * sparseBoost * a)).toFixed(3));
    t.lineHeight = Number(Math.min((base.typography.lineHeight || 1.32) + (initial.utilization < 0.68 ? 0.15 : 0.11), (base.typography.lineHeight || 1.32) * (1 + 0.08 * sparseBoost * a)).toFixed(3));
    if (Number.isFinite(Number(base.typography.headingSize))) t.headingSize = Number((Number(base.typography.headingSize) * (1 + 0.025 * sparseBoost * a)).toFixed(3));
    if (Number.isFinite(Number(base.typography.roleSize))) t.roleSize = Number((Number(base.typography.roleSize) * (1 + 0.018 * sparseBoost * a)).toFixed(3));

    sp.sectionGapPx = Number(Math.min(base.spacing.sectionGapPx + (initial.utilization < 0.68 ? 10 : 8), base.spacing.sectionGapPx * (1 + 0.6 * sparseBoost * a)).toFixed(3));
    sp.itemGapPx = Number(Math.min(base.spacing.itemGapPx + (initial.utilization < 0.68 ? 5 : 4), base.spacing.itemGapPx * (1 + 0.45 * sparseBoost * a)).toFixed(3));
    sp.bulletGapPx = Number(Math.min(base.spacing.bulletGapPx + (initial.utilization < 0.68 ? 2.5 : 2), base.spacing.bulletGapPx * (1 + 0.35 * sparseBoost * a)).toFixed(3));

    tokens.experience.itemGapScale = Number(((Number(base.experience.itemGapScale) || 1) * (1 + 0.2 * sparseBoost * a)).toFixed(3));
    tokens.projects.itemGapScale = Number(((Number(base.projects.itemGapScale) || 1) * (1 + 0.2 * sparseBoost * a)).toFixed(3));
    tokens.skills.groupGapScale = Number(((Number(base.skills.groupGapScale) || 1) * (1 + 0.25 * sparseBoost * a)).toFixed(3));
    tokens.visual.summaryTreatment.lineHeightScale = Number(((Number(base.visual.summaryTreatment.lineHeightScale) || 1) * (1 + 0.05 * sparseBoost * a)).toFixed(3));

    if (compiled.tree.layoutType === 'single-column' && initial.utilization < 0.76) {
      const width = Number(base.visual.singleColumnTreatment.contentWidthScale) || 1;
      tokens.visual.singleColumnTreatment.contentWidthScale = Number(Math.max(0.88, width * (1 - 0.06 * a)).toFixed(3));
    }
    return { ...compiled, tokens };
  };

  /* Find the strongest safe treatment that remains a one-page layout and does
     not overshoot into a cramped near-overflow composition. */
  /* Near-full single-column pages are especially sensitive to small line-wrap
     changes that a line-count estimator cannot perfectly predict. Cap their
     expansion so premium composition cannot create an avoidable orphan page.
     Sparse pages and multi-column layouts retain the full adaptation range. */
  const expansionLimit = treeIsNearFullSingleColumn(compiled, initial) ? 0.52 : 1;
  let lo = 0; let hi = expansionLimit; let best = compiled; let bestGeo = initial; let bestAmount = 0;
  for (let i = 0; i < 8; i += 1) {
    const mid = (lo + hi) / 2;
    const candidate = apply(mid);
    const geo = estimateGeometry(candidate, structured, { sizeId });
    const estimateSafetyCeiling = 0.865;
    const safe = geo.pageCount === 1 && geo.utilization <= Math.min(estimateSafetyCeiling, desired + 0.02);
    if (safe) { best = candidate; bestGeo = geo; bestAmount = mid; lo = mid; } else hi = mid;
  }

  /* If the estimate barely moves because the content itself is exceptionally
     short, still use the capped premium rhythm; the result remains one page. */
  if (bestAmount < 0.12) {
    const candidate = apply(Math.min(0.5, densityLimit));
    const geo = estimateGeometry(candidate, structured, { sizeId });
    if (geo.pageCount === 1 && geo.utilization <= 0.865) { best = candidate; bestGeo = geo; bestAmount = Math.min(0.5, densityLimit); }
  }

  const delta = {
    bodyFontPx: Number((best.tokens.typography.bodyFontPx - base.typography.bodyFontPx).toFixed(3)),
    lineHeight: Number((best.tokens.typography.lineHeight - base.typography.lineHeight).toFixed(3)),
    sectionGapPx: Number((best.tokens.spacing.sectionGapPx - base.spacing.sectionGapPx).toFixed(3)),
    itemGapPx: Number((best.tokens.spacing.itemGapPx - base.spacing.itemGapPx).toFixed(3)),
    bulletGapPx: Number((best.tokens.spacing.bulletGapPx - base.spacing.bulletGapPx).toFixed(3)),
  };
  return {
    ...best,
    composition: {
      version: PAGE_COMPOSITION_VERSION, applied: bestAmount > 0,
      reason: bestAmount > 0 ? 'one-page-underfill-balanced' : 'no-safe-expansion',
      stage, densityMode, amount: Number(bestAmount.toFixed(3)), desiredUtilization: desired,
      initial, final: bestGeo, delta,
      contentPolicy: 'spacing-only-no-synthetic-sections',
    },
  };
}

/* ------------------------------------------------------------------ */
/* 4. Section renderers (semantic markup only)                         */
/* ------------------------------------------------------------------ */
function headerContactHTML(bits, h, extraClass = '') {
  if (!bits.length) return '';
  const klass = `t-contact${extraClass ? ` ${extraClass}` : ''}`;
  if (h.contactLayout === 'grid') return `<div class="${klass} t-contact-grid">${bits.map((b) => `<span>${esc(b)}</span>`).join('')}</div>`;
  if (h.contactLayout === 'stacked') return `<div class="${klass} t-contact-stacked">${bits.map((b) => `<div>${esc(b)}</div>`).join('')}</div>`;
  return `<div class="${klass}">${bits.map((b) => `<span>${esc(b)}</span>`).join('<span class="t-dot">·</span>')}</div>`;
}

function headerIdentityHTML(d, h) {
  const accentClass = h.accentMark === 'vertical' ? ' t-header-primary-accent' : '';
  return `<div class="t-header-primary${accentClass}">
    <h1 class="t-name">${esc(d.personalInfo.name || '')}</h1>
    ${d.personalInfo.title ? `<p class="t-title">${esc(d.personalInfo.title)}</p>` : ''}
  </div>`;
}

function headerHTML(d, tokens) {
  const h = tokens.header;
  const bits = [d.personalInfo.email, d.personalInfo.phone, d.personalInfo.location, d.personalInfo.linkedin, d.personalInfo.github, d.personalInfo.portfolio, ...(d.personalInfo.links || [])].filter(Boolean);
  const identity = headerIdentityHTML(d, h);
  if (h.layout === 'split') {
    return `<header class="t-header t-header-${h.id} t-header-layout-split">
      <div class="t-header-split">${identity}${headerContactHTML(bits, h, 't-contact-split')}</div>
    </header>`;
  }
  const accent = h.accentMark === 'short-rule' ? '<span class="t-header-short-accent" aria-hidden="true"></span>' : '';
  return `<header class="t-header t-header-${h.id} t-header-layout-${h.layout || 'stack'}">
    ${identity}
    ${accent}
    ${headerContactHTML(bits, h)}
  </header>`;
}

const SECTION_TITLES = {
  summary: 'Summary', skills: 'Skills', experience: 'Experience', projects: 'Projects', education: 'Education',
  certifications: 'Certifications', achievements: 'Achievements', publications: 'Publications', patents: 'Patents',
  volunteer: 'Volunteer Experience', languages: 'Languages', customSections: 'Additional',
};

/* "other" is the bucket a skill lands in when the candidate never grouped their
   skills — an internal default, not a heading anyone wrote. Printing it puts the
   word "other" on a resume above the candidate's actual skills. An ungrouped
   bucket renders with no label at all. */
const INTERNAL_SKILL_GROUPS = new Set(['other', 'ungrouped', 'default', 'misc', 'general']);

function skillDisplayGroup(group, hasSpokenLanguages = false) {
  const raw = String(group || '');
  if (INTERNAL_SKILL_GROUPS.has(raw.trim().toLowerCase())) return '';
  return hasSpokenLanguages && /^languages?$/i.test(raw.trim()) ? 'Programming Languages' : raw;
}
function skillLabel(group, skillToken, hasSpokenLanguages = false) {
  const raw = skillDisplayGroup(group, hasSpokenLanguages);
  return skillToken.labelCase === 'upper' ? raw.toUpperCase() : raw;
}

function skillTokensHTML(items = []) {
  return items.map((item, index) => `${index ? '<span class="t-skillsep">·</span>' : ''}<span class="t-skilltoken">${esc(item)}</span>`).join('');
}

function skillChipsHTML(groups = [], tokens, hasSpokenLanguages = false) {
  const chips = [];
  for (const g of groups) {
    const label = skillLabel(g.group, tokens.skills, hasSpokenLanguages);
    (g.items || []).forEach((item, index) => {
      const text = index === 0 && label ? `${label}: ${item}` : item;
      chips.push(`<span class="t-skillchip">${esc(text)}</span>`);
    });
  }
  return `<div class="t-skillchips">${chips.join('')}</div>`;
}

function skillsHTML(d, tokens) {
  const mode = tokens.skills.mode;
  const groups = (d.skills || []).filter((g) => (g.items || []).length);
  if (!groups.length) return '';
  if (mode === 'plain') return `<p class="t-p">${esc(groups.flatMap((g) => g.items).join(', '))}</p>`;
  if (mode === 'chips') return skillChipsHTML(groups, tokens, !!d.languages?.length);
  if (mode === 'inline') return groups.map((g) => { const l = skillLabel(g.group, tokens.skills, !!d.languages?.length); return `<div class="t-skill-inline-row">${l ? `<span class="t-skill-label">${esc(l)}</span>` : ''}<span class="t-skillitems">${skillTokensHTML(g.items)}</span></div>`; }).join('');
  if (mode === 'categorized') return groups.map((g) => { const l = skillLabel(g.group, tokens.skills, !!d.languages?.length); return `<div class="t-skillgroup t-skillgroup-categorized">${l ? `<p class="t-skillhead">${esc(l)}</p>` : ''}<div class="t-skilltokens">${skillTokensHTML(g.items)}</div></div>`; }).join('');
  if (mode === 'matrix') return `<div class="t-skillmatrix">${groups.map((g) => { const l = skillLabel(g.group, tokens.skills, !!d.languages?.length); return `<div class="t-skill-matrix-row">${l ? `<span class="t-skill-label">${esc(l)}</span>` : ''}<span class="t-skillitems">${skillTokensHTML(g.items)}</span></div>`; }).join('')}</div>`;
  if (mode === 'sidebar-groups') return groups.map((g) => { const l = skillLabel(g.group, tokens.skills, !!d.languages?.length); return `<div class="t-skillgroup t-skillgroup-sidebar">${l ? `<p class="t-skillhead">${esc(l)}</p>` : ''}<div class="t-skilltokens">${skillTokensHTML(g.items)}</div></div>`; }).join('');
  if (mode === 'stack') return groups.map((g) => { const l = skillDisplayGroup(g.group, !!d.languages?.length); return `<div class="t-skillgroup">${l ? `<p class="t-skillhead">${esc(l)}</p>` : ''}${g.items.map((i) => `<div class="t-skillrow">${esc(i)}</div>`).join('')}</div>`; }).join('');
  return groups.map((g) => `<div class="t-skill-inline-row"><span class="t-skill-label">${esc(skillLabel(g.group, tokens.skills, !!d.languages?.length))}</span><span class="t-skillitems">${skillTokensHTML(g.items)}</span></div>`).join('');
}

function experienceHTML(d, tokens) {
  const x = tokens.experience || {};
  return (d.experience || []).map((e2) => {
    const role = esc(e2.role || '');
    const company = esc(e2.company || '');
    const location = esc(e2.location || '');
    const dates = esc(e2.dates || '');
    const compact = x.headerLayout === 'inline';
    const header = compact
      ? `<div class="t-jobtop t-jobtop-inline"><span class="t-role">${role}</span>${company ? `<span class="t-company t-company-inline">${company}</span>` : ''}${location ? `<span class="t-location t-location-inline">${location}</span>` : ''}${dates ? `<span class="t-dates t-dates-inline">${dates}</span>` : ''}</div>`
      : `<div class="t-jobtop"><span class="t-role">${role}</span>${dates ? `<span class="t-dates">${dates}</span>` : ''}</div>${(company || location) ? `<div class="t-jobmeta">${company ? `<span class="t-company">${company}</span>` : ''}${company && location ? '<span class="t-meta-sep">·</span>' : ''}${location ? `<span class="t-location">${location}</span>` : ''}</div>` : ''}`;
    return `
  <div class="t-item t-exp-item">
    ${header}
    ${x.stackLine && e2.stack ? `<p class="t-stack t-exp-stack">${x.stackLabel ? `<span class="t-stack-label">${esc(x.stackLabel)}</span>` : ''}<span class="t-stack-value">${esc(e2.stack)}</span></p>` : ''}
    <ul class="t-ul t-exp-bullets${x.leadBullet === 'strong' ? ' t-lead-strong' : ''}">${(e2.bullets || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
  </div>`;
  }).join('');
}

function projectsHTML(d, tokens) {
  const pStyle = tokens.projects || {};
  const maxBullets = Number.isFinite(Number(pStyle.maxBullets)) ? Number(pStyle.maxBullets) : (pStyle.tight ? 2 : 99);
  return (d.projects || []).map((p) => {
    const name = `<span class="t-project-name">${esc(p.name || '')}</span>`;
    const verified = pStyle.badge && p.verified
      ? `<span class="t-project-verified t-verified">${esc(pStyle.badgeLabel || 'VERIFIED')}</span>`
      : '';
    const tech = p.tech ? `<span class="t-project-tech">${esc(p.tech)}</span>` : '';
    const link = p.link ? `<span class="t-project-link">${esc(p.link)}</span>` : '';
    const meta = (tech || link)
      ? `<div class="t-project-meta">${tech}${tech && link ? '<span class="t-project-meta-sep">·</span>' : ''}${link}</div>`
      : '';
    const header = pStyle.headerLayout === 'inline'
      ? `<div class="t-project-head t-project-head-inline">${name}${tech ? `<span class="t-project-inline-tech">${esc(p.tech)}</span>` : ''}${verified}${link ? `<span class="t-project-inline-link">${esc(p.link)}</span>` : ''}</div>`
      : `<div class="t-project-head">${name}${verified}</div>${meta}`;
    return `
  <div class="t-item t-project-item">
    ${header}
    <ul class="t-ul t-project-bullets">${(p.bullets || []).slice(0, maxBullets).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
  </div>`;
  }).join('');
}

function educationHTML(d, tokens) {
  const ed = tokens.education || {};
  return (d.education || []).map((e2) => {
    const school = esc(e2.school || '');
    const degree = esc(e2.degree || '');
    const dates = esc(e2.dates || '');
    const details = esc(e2.details || '');
    if (ed.layout === 'featured') {
      return `<div class="t-item t-edu t-edu-featured"><div class="t-edu-top"><span class="t-edu-school">${school}</span>${dates ? `<span class="t-dates">${dates}</span>` : ''}</div>${degree ? `<div class="t-edu-degree">${degree}</div>` : ''}${details ? `<p class="t-p t-edu-details">${details}</p>` : ''}</div>`;
    }
    return `<div class="t-item t-edu"><span class="t-role">${school}</span><span class="t-co">${degree ? ` — ${degree}` : ''}</span>${dates ? `<span class="t-dates">${dates}</span>` : ''}${details ? `<p class="t-p">${details}</p>` : ''}</div>`;
  }).join('');
}

const listHTML = (items, cls = '') => (items?.length ? `<ul class="t-ul${cls ? ` ${cls}` : ''}">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
const recordListHTML = (items, kind) => (items?.length ? `<div class="t-record-list t-record-${kind}">${items.map((x) => `<div class="t-record-item"><span class="t-record-mark" aria-hidden="true"></span><span>${esc(x)}</span></div>`).join('')}</div>` : '');
const languagesHTML = (items) => (items?.length ? `<div class="t-language-list">${items.map((x, i) => `${i ? '<span class="t-language-sep">·</span>' : ''}<span class="t-language-item">${esc(x)}</span>`).join('')}</div>` : '');

function customSectionsHTML(d) {
  return (d.customSections || []).filter((s) => s?.items?.length).map((s, index) => `
<section class="t-section t-custom-section" data-section="customSections" data-custom-index="${index}"><h2 class="t-h2">${esc(s.title || 'Additional')}</h2>${listHTML(s.items, 't-custom-list')}</section>`).join('');
}

function sectionHTML(key, d, tokens) {
  if (key === 'customSections') return customSectionsHTML(d);
  let body = '';
  if (key === 'summary') body = d.summary ? `<p class="t-p">${esc(d.summary)}</p>` : '';
  if (key === 'skills') body = skillsHTML(d, tokens);
  if (key === 'experience') body = experienceHTML(d, tokens);
  if (key === 'projects') body = projectsHTML(d, tokens);
  if (key === 'education') body = educationHTML(d, tokens);
  if (key === 'certifications') body = listHTML(d.certifications);
  if (key === 'achievements') body = listHTML(d.achievements);
  if (key === 'publications') body = recordListHTML(d.publications, 'publications');
  if (key === 'patents') body = recordListHTML(d.patents, 'patents');
  if (key === 'volunteer') body = listHTML(d.volunteer, 't-volunteer-list');
  if (key === 'languages') body = languagesHTML(d.languages);
  if (!body) return '';
  return `<section class="t-section" data-section="${key}"><h2 class="t-h2">${SECTION_TITLES[key]}</h2>${body}</section>`;
}

function sectionHasContent(key, d) {
  if (key === 'summary') return !!String(d.summary || '').trim();
  if (key === 'skills') return (d.skills || []).some((g) => (g.items || []).length);
  if (key === 'experience') return (d.experience || []).length > 0;
  if (key === 'projects') return (d.projects || []).length > 0;
  if (key === 'education') return (d.education || []).length > 0;
  if (key === 'customSections') return (d.customSections || []).some((x) => (x.items || []).length);
  return Array.isArray(d[key]) && d[key].length > 0;
}

/* ------------------------------------------------------------------ */
/* 4. CSS                                                              */
/* ------------------------------------------------------------------ */
export function layoutCSS(compiled, { sizeId = 'a4' } = {}) {
  const { tokens, tree } = compiled;
  const { typography: ty, spacing: sp, colors: co, header: hd, divider, visual } = tokens;
  const design = resolveRenderDesign(compiled, { sizeId });
  const pageW = design.page.css.w;
  const pageH = design.page.css.h;
  const colorVar = (token) => typeof token === 'string' && token.startsWith('#') ? token : token === 'accent' ? 'var(--tpl-accent)' : token === 'sidebarBg' ? 'var(--tpl-side)' : token === 'text' ? 'var(--tpl-text)' : token === 'muted' ? 'var(--tpl-muted)' : 'var(--tpl-rule)';
  const headerRule = visual?.headerRule || { thicknessPx: 0 };
  const sidePanel = visual?.sidebarPanel || { edgeWidthPx: 0, paddingXpx: 12, paddingYpx: 10, radiusPx: 4 };
  const certBlock = visual?.certificationBlock || { markerWidthPx: 0, markerGapPx: 0 };
  const projectMeta = visual?.projectMeta || { marker: false };
  const verifiedBadge = visual?.verifiedBadge || { fillToken: null, borderToken: 'accent', textToken: 'accent' };
  const singleColumn = design.singleColumn || { contentWidthScale: 1, align: 'left' };
  const summaryDesign = design.summary || { sizePx: bodyPx, lineHeight: design.typography.lineHeight, color: 'var(--tpl-text)' };
  const bodyPx = design.typography.bodyPx;
  const expDesign = design.experience;
  const projectDesign = design.projects;
  const educationDesign = design.education;
  const columnDesign = design.columns;
  const expCompanyColor = expDesign.companyTone === 'accent' ? 'var(--tpl-accent)' : expDesign.companyTone === 'muted' ? 'var(--tpl-muted)' : 'var(--tpl-text)';
  const expLocationColor = expDesign.locationTone === 'text' ? 'var(--tpl-text)' : expDesign.locationTone === 'accent' ? 'var(--tpl-accent)' : 'var(--tpl-muted)';
  const isMulti = tree.layoutType !== 'single-column';
  const sidebarFirst = tree.layoutType === 'sidebar-left';
  const colWidths = tree.columns.map((c) => `${Math.round(c.width * 100)}%`);
  /* grid areas map visual position; DOM stays semantic */
  const gridCols = tree.columns.map((c) => `${c.width}fr`).join(' ');
  const areaOf = Object.fromEntries(tree.columns.map((c) => [c.id, c.id]));
  const refRegion = columnDesign.referenceRegion && tree.columns.some((c) => c.id === columnDesign.referenceRegion)
    ? columnDesign.referenceRegion : null;
  const dividerCol = tree.layoutType === 'two-column' && tree.columns.length === 2 && columnDesign.dividerWidthPx > 0
    ? tree.columns[0] : null;
  const dividerLeft = dividerCol
    ? `calc((100% - ${design.spacing.columnGapPx}px) * ${dividerCol.width} + ${design.spacing.columnGapPx / 2}px)`
    : '50%';

  return `
:root{--tpl-accent:${co.accent};--tpl-rule:${co.rule};--tpl-side:${co.sidebarBg};--tpl-text:${co.text};--tpl-muted:${co.muted};}
.t-page{width:${pageW}px;min-height:${pageH}px;margin:0 auto;background:#fff;color:var(--tpl-text);font-family:${ty.font};font-size:${bodyPx}px;line-height:${design.typography.lineHeight};padding:${design.spacing.marginMm}mm;box-sizing:border-box;}
.t-header{margin-bottom:${design.header.marginBottomPx}px;${hd.band ? `background:${design.header.bandBackgroundColor};padding:${design.header.bandPaddingYPx}px ${design.header.bandPaddingXPx}px;margin:-${design.header.bandOutsetMm}mm -${design.header.bandOutsetMm}mm ${design.header.marginBottomPx}px;` : ''}${headerRule.thicknessPx > 0 ? `border-bottom:${headerRule.thicknessPx}px solid ${colorVar(headerRule.colorToken)};padding-bottom:${design.header.rulePaddingBottomPx}px;` : ''}text-align:${hd.align};}
.t-header-primary{min-width:0;${design.header.primaryInsetPx > 0 ? `padding-left:${design.header.primaryInsetPx}px;` : ''}}
.t-header-primary-accent{border-left:${Math.max(1.5, design.header.accentMarkWidthPx || 3)}px solid var(--tpl-accent);}
.t-name{font-size:${ty.nameSize}px;font-weight:${ty.nameWeight || 700};line-height:1.04;margin:0;color:${design.header.nameColor};letter-spacing:${hd.nameCase === 'caps' ? `${Math.max(1.1, ty.nameLetterSpacing || 0)}px` : `${ty.nameLetterSpacing || 0}px`};${hd.nameCase === 'caps' ? 'text-transform:uppercase;' : ''}}
.t-title{margin:${design.header.titleMarginTopPx}px 0 0;color:${design.header.titleColor};font-weight:${ty.titleWeight || 600};font-size:${ty.titleSize || (bodyPx + 0.5)}px;line-height:1.2;letter-spacing:${design.header.titleLetterSpacingPx}px;${design.header.titleCase === 'upper' ? 'text-transform:uppercase;' : ''}}
.t-contact{margin-top:${design.header.contactMarginTopPx}px;color:${design.header.contactColor};font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, ty.contactSize || (bodyPx - 1.2))}px;line-height:${design.header.contactLineHeight};}
.t-contact .t-dot{margin:0 5px;color:${hd.band ? design.header.contactColor : 'var(--tpl-rule)'};}
.t-contact-grid{display:grid;grid-template-columns:repeat(${design.header.contactGridColumns},minmax(0,1fr));gap:${design.header.contactGridRowGapPx}px ${design.header.contactGridColumnGapPx}px;justify-content:${design.header.contactAlign === 'center' ? 'center' : 'start'};${hd.mono && ty.monoAccent ? `font-family:${ty.monoAccent};font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, ty.contactSize || (bodyPx - 1.6))}px;` : ''}}
.t-header-split{display:grid;grid-template-columns:minmax(0,${design.header.splitPrimaryShare}fr) minmax(0,${1 - design.header.splitPrimaryShare}fr);gap:${design.header.splitGapPx}px;align-items:start;}
.t-header-layout-split .t-header-primary{padding-left:0;text-align:left;}
.t-contact-split{margin-top:1px;text-align:${design.header.contactAlign};}
.t-header-layout-editorial .t-contact{max-width:100%;white-space:normal;}
.t-header-short-accent{display:block;width:${Math.max(20, design.header.accentMarkWidthPx || 34)}px;border-top:2px solid var(--tpl-accent);margin:${Math.max(5, design.header.titleMarginTopPx + 3)}px auto 0;}
.t-columns{display:${isMulti ? 'grid' : 'block'};${isMulti ? `grid-template-columns:${gridCols};grid-template-areas:"${(sidebarFirst ? ['sidebar', 'main'] : tree.columns.map((c) => c.id)).join(' ')}";gap:0 ${design.spacing.columnGapPx}px;` : ''}${dividerCol ? 'position:relative;' : ''}}
${dividerCol ? `.t-columns::after{content:"";position:absolute;left:${dividerLeft};top:${columnDesign.dividerInsetTopPx}px;bottom:${columnDesign.dividerInsetBottomPx}px;border-left:${columnDesign.dividerWidthPx}px solid ${colorVar(columnDesign.dividerColorToken)};pointer-events:none;}` : ''}
${tree.columns.map((c) => `.t-col-${c.id}{grid-area:${areaOf[c.id]};min-width:0;}`).join('\n')}
${refRegion ? `.t-col-${refRegion} .t-section{margin-bottom:${sp.sectionGapPx * columnDesign.referenceSectionGapScale}px;}.t-col-${refRegion} .t-h2{font-size:${ty.headingSize * columnDesign.referenceHeadingScale}px;margin-bottom:${sp.itemGapPx * columnDesign.referenceHeadingGapScale}px;}` : ''}
${tree.columns.some((c) => c.id === 'sidebar') ? `.t-col-sidebar{${sidePanel.backgroundToken ? `background:${colorVar(sidePanel.backgroundToken)};` : ''}padding:${design.sidebar.paddingYpx || 0}px ${design.sidebar.paddingXpx || 0}px;border-radius:${sidePanel.radiusPx || 0}px;align-self:start;${sidePanel.edgeWidthPx > 0 ? `${tree.layoutType === 'sidebar-right' ? 'border-left' : 'border-right'}:${sidePanel.edgeWidthPx}px solid ${colorVar(sidePanel.edgeColorToken)};` : ''}}` : ''}
${tree.columns.some((c) => c.id === 'sidebar') && design.sidebar.textColor ? `.t-col-sidebar{color:${design.sidebar.textColor}}.t-col-sidebar .t-h2,.t-col-sidebar .t-skillhead,.t-col-sidebar .t-skill-label,.t-col-sidebar .t-role,.t-col-sidebar .t-company,.t-col-sidebar .t-edu-school,.t-col-sidebar .t-edu-degree{color:${design.sidebar.headingColor || design.sidebar.textColor}!important}.t-col-sidebar .t-skilltokens,.t-col-sidebar .t-skillitems,.t-col-sidebar .t-p,.t-col-sidebar .t-ul,.t-col-sidebar .t-edu-details{color:${design.sidebar.textColor}!important}.t-col-sidebar .t-dates,.t-col-sidebar .t-location,.t-col-sidebar .t-project-tech,.t-col-sidebar .t-stack-value,.t-col-sidebar .t-contact{color:${design.sidebar.mutedColor || design.sidebar.textColor}!important}` : ''}
${tree.layoutType === 'single-column' && singleColumn.contentWidthScale < 0.999 ? `.t-page > .t-section{width:${singleColumn.contentWidthScale * 100}%;margin-left:auto;margin-right:auto;}` : ''}
.t-section{margin-bottom:${sp.sectionGapPx}px;}
.t-h2{font-size:${ty.headingSize}px;font-weight:${ty.headingWeight || 700};text-transform:uppercase;letter-spacing:${ty.headingLetterSpacing || 1}px;color:var(--tpl-accent);line-height:1.15;margin:0 0 ${sp.itemGapPx}px;${divider.css}}
${divider.after ? `.t-h2::after{${divider.after}}` : ''}
.t-p{margin:0 0 ${sp.bulletGapPx}px;}
.t-section[data-section="summary"] .t-p{font-size:${summaryDesign.sizePx}px;line-height:${summaryDesign.lineHeight};color:${summaryDesign.color};}
.t-item{margin-bottom:${sp.itemGapPx}px;}
.t-itemhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px;}
.t-exp-item{margin-bottom:${expDesign.itemGapPx}px;break-inside:avoid-page;}
.t-exp-item+.t-exp-item{margin-top:${expDesign.metaGapPx}px;}
.t-jobtop{display:flex;align-items:baseline;gap:${expDesign.dateGapPx}px;min-width:0;}
.t-jobtop .t-role{flex:1;min-width:0;}
.t-jobtop-inline{flex-wrap:wrap;gap:3px 6px;}
.t-role{font-size:${ty.roleSize || bodyPx}px;font-weight:${ty.roleWeight || 700};line-height:1.24;}
.t-company{color:${expCompanyColor};font-size:${ty.companySize || bodyPx}px;font-weight:${expDesign.companyTone === 'accent' ? 650 : (ty.companyWeight || 500)};line-height:1.2;}
.t-company-inline::before{content:"·";color:var(--tpl-rule);margin-right:6px;font-weight:400;}
.t-location{color:${expLocationColor};font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, ty.metaSize || (bodyPx - 1.2))}px;font-weight:500;}
.t-location-inline::before{content:"·";color:var(--tpl-rule);margin-right:6px;}
.t-jobmeta{display:flex;align-items:baseline;gap:6px;margin-top:${expDesign.metaGapPx}px;line-height:1.2;}
.t-meta-sep{color:var(--tpl-rule);font-weight:600;}
.t-co{color:var(--tpl-text);font-size:${ty.companySize || bodyPx}px;font-weight:${ty.companyWeight || 500};}
.t-dates{margin-left:auto;white-space:nowrap;color:var(--tpl-muted);font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, ty.metaSize || (bodyPx - 1.2))}px;font-weight:600;letter-spacing:.1px;}
.t-dates-inline{margin-left:auto;}
.t-stack,.t-stack-inline{color:var(--tpl-muted);font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, ty.metaSize || (bodyPx - 1))}px;margin:2px 0 3px;line-height:1.25;}
.t-exp-stack{margin:${expDesign.stackGapPx}px 0 0;${expDesign.stackFont === 'mono' && ty.monoAccent ? `font-family:${ty.monoAccent};font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, (ty.metaSize || bodyPx - 1) - .2)}px;letter-spacing:-.1px;` : ''}}
.t-stack-label{display:inline-block;margin-right:${Math.max(5, expDesign.stackLabelGapPx || 6)}px;color:var(--tpl-accent);font-family:${ty.font};font-weight:800;font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, (ty.metaSize || bodyPx - 1) - .8)}px;letter-spacing:.6px;}
.t-stack-value{color:var(--tpl-muted);}
.t-ul{margin:3px 0 0;padding-left:16px;}
.t-ul li{margin-bottom:${sp.bulletGapPx}px;}
.t-exp-bullets{margin-top:${expDesign.bulletTopGapPx}px;padding-left:${expDesign.bulletIndentPx}px;}
.t-exp-bullets li{padding-left:1px;line-height:${Math.max(1.3, design.typography.lineHeight)};margin-bottom:${sp.bulletGapPx}px;}
.t-exp-bullets li:last-child{margin-bottom:0;}
.t-project-item{margin-bottom:${projectDesign.itemGapPx}px;break-inside:avoid-page;}
.t-project-item+.t-project-item{margin-top:${projectDesign.metaGapPx}px;}
.t-project-head{display:flex;align-items:baseline;gap:7px;min-width:0;}
.t-project-head-inline{flex-wrap:wrap;gap:3px 7px;}
.t-project-name{font-size:${Math.max(READABILITY_FLOORS.minBodyFontPx, (ty.roleSize || bodyPx) - .2)}px;font-weight:${ty.roleWeight || 700};line-height:1.22;min-width:0;}
.t-project-verified{margin-left:auto;flex:0 0 auto;font-size:${Math.max(8, (ty.metaSize || bodyPx - 1.2) - 1.2)}px;padding:1px 4px;border-width:.7px;letter-spacing:.45px;line-height:1.15;}
.t-project-meta{display:flex;align-items:baseline;gap:6px;margin-top:${projectDesign.metaGapPx}px;min-width:0;font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, ty.metaSize || (bodyPx - 1.2))}px;line-height:1.2;}
.t-project-tech{color:var(--tpl-muted);min-width:0;${projectDesign.techFont === 'mono' && ty.monoAccent ? `font-family:${ty.monoAccent};font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, (ty.metaSize || bodyPx - 1) - .2)}px;letter-spacing:-.1px;` : ''}}
.t-project-link{margin-left:auto;color:var(--tpl-accent);font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, (ty.metaSize || bodyPx - 1.2) - .1)}px;overflow-wrap:anywhere;text-align:right;}
.t-project-meta-sep{color:var(--tpl-rule);font-weight:650;}
.t-project-inline-tech{color:var(--tpl-muted);font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, ty.metaSize || (bodyPx - 1.2))}px;}
.t-project-inline-tech::before{content:"·";color:var(--tpl-rule);margin-right:6px;}
.t-project-inline-link{color:var(--tpl-accent);font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, ty.metaSize || (bodyPx - 1.2))}px;}
.t-project-inline-link::before{content:"·";color:var(--tpl-rule);margin-right:6px;}
.t-project-bullets{margin-top:${projectDesign.bulletTopGapPx}px;padding-left:${projectDesign.bulletIndentPx}px;}
.t-project-bullets li{padding-left:1px;line-height:${Math.max(1.3, design.typography.lineHeight)};margin-bottom:${sp.bulletGapPx}px;}
.t-project-bullets li:last-child{margin-bottom:0;}
.t-lead-strong li:first-child{font-weight:600;}
.t-skillgroup{margin-bottom:${design.skills.groupGapPx}px;break-inside:avoid-page;}
.t-skillhead{font-weight:750;margin:0 0 ${design.skills.labelGapPx}px;font-size:${design.skills.labelPx}px;line-height:1.16;letter-spacing:${design.skills.labelTrackingPx}px;color:${design.skills.labelColor};}
.t-skilltokens,.t-skillitems{font-size:${design.skills.itemPx}px;line-height:${design.skills.lineHeight};color:var(--tpl-text);overflow-wrap:anywhere;}
.t-skilltoken{display:inline;}
.t-skillsep{display:inline-block;color:var(--tpl-rule);font-weight:750;margin:0 ${design.skills.separatorGapPx}px;}
.t-skill-inline-row,.t-skill-matrix-row{margin:0 0 ${design.skills.rowGapPx}px;line-height:${design.skills.lineHeight};}
.t-skill-inline-row .t-skill-label,.t-skill-matrix-row .t-skill-label{font-size:${design.skills.labelPx}px;font-weight:750;color:${design.skills.labelColor};margin-right:${design.skills.inlineLabelGapPx}px;letter-spacing:${design.skills.inlineLabelTrackingPx}px;}
.t-skill-inline-row .t-skill-label::after,.t-skill-matrix-row .t-skill-label::after{content:":";}
.t-skillgroup-sidebar .t-skillhead{font-size:${design.skills.sidebarLabelPx}px;letter-spacing:${design.skills.sidebarLabelTrackingPx}px;text-transform:${design.skills.labelCase === 'upper' ? 'uppercase' : 'none'};}
.t-skillgroup-sidebar .t-skilltokens{font-size:${design.skills.sidebarItemPx}px;line-height:${design.skills.sidebarLineHeight};}
.t-skillmatrix{margin:0;}
.t-skillchips{display:flex;flex-wrap:wrap;gap:${design.skills.chipGapYpx}px ${design.skills.chipGapXpx}px;margin:0;align-items:flex-start;}
.t-skillchip{display:inline-block;font-size:${design.skills.itemPx}px;line-height:1.15;padding:${design.skills.chipPadYpx}px ${design.skills.chipPadXpx}px;border:1px solid ${colorVar(design.skills.chipBorderToken)};background:${colorVar(design.skills.chipFillToken)};color:${colorVar(design.skills.chipTextToken)};border-radius:${design.skills.chipRadiusPx}px;font-weight:650;break-inside:avoid;}
${tree.columns.some((c) => c.id === 'sidebar') && design.sidebar.chipFillColor ? `.t-col-sidebar .t-skillchip{background:${design.sidebar.chipFillColor};border-color:${design.sidebar.chipBorderColor || design.sidebar.ruleColor || '#475569'};color:${design.sidebar.chipTextColor || design.sidebar.textColor || '#f8fafc'};}` : ''}
.t-skillrow{padding:1px 0;border-bottom:0.5px solid var(--tpl-rule);}
.t-matrix{letter-spacing:0.1px;}
.t-verified{font-size:8.5px;font-weight:800;color:${colorVar(verifiedBadge.textToken)};border:1px solid ${colorVar(verifiedBadge.borderToken)};background:${verifiedBadge.fillToken ? colorVar(verifiedBadge.fillToken) : 'transparent'};border-radius:3px;padding:1px 4px;margin-left:5px;letter-spacing:.25px;}
.t-link{color:var(--tpl-accent);font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, ty.metaSize || (bodyPx - 1.2))}px;}
.t-edu .t-dates{font-size:${Math.max(READABILITY_FLOORS.minSmallFontPx, ty.metaSize || (bodyPx - 1.2))}px;}
.t-edu-featured{margin-bottom:${educationDesign.itemGapPx}px;break-inside:avoid-page;}
.t-edu-top{display:flex;align-items:baseline;gap:${educationDesign.dateGapPx}px;min-width:0;}
.t-edu-school{flex:1;min-width:0;font-size:${educationDesign.schoolPx}px;font-weight:${educationDesign.schoolWeight};color:${educationDesign.schoolColor};line-height:1.22;}
.t-edu-degree{margin-top:${educationDesign.degreeGapPx}px;font-size:${educationDesign.degreePx}px;font-weight:${educationDesign.degreeWeight};color:${educationDesign.degreeColor};line-height:1.24;}
.t-edu-details{margin-top:${educationDesign.detailsGapPx}px;color:${educationDesign.detailsColor};font-size:${educationDesign.detailsPx}px;line-height:1.3;}
${certBlock.markerWidthPx > 0 ? `.t-section[data-section="certifications"] .t-ul{list-style:none;padding-left:0;margin-top:4px}.t-section[data-section="certifications"] .t-ul li{position:relative;padding-left:${certBlock.markerGapPx + certBlock.markerWidthPx}px;margin-bottom:${certBlock.itemGapPx ?? sp.bulletGapPx}px;font-weight:${certBlock.fontWeight || 500};line-height:${Math.max(1.28, design.typography.lineHeight)}}.t-section[data-section="certifications"] .t-ul li::before{content:"";position:absolute;left:0;top:.2em;bottom:.18em;width:${certBlock.markerWidthPx}px;border-radius:2px;background:${colorVar(certBlock.markerColorToken)};}` : ''}
${projectMeta.marker ? `.t-section[data-section="projects"] .t-project-tech{display:inline-flex;align-items:center}.t-section[data-section="projects"] .t-project-tech::before{content:"";width:4px;height:4px;border-radius:50%;background:${colorVar(projectMeta.markerColorToken)};margin:0 5px 0 3px;}` : ''}
${sidePanel.headingRule === 'short-accent' ? `.t-col-sidebar .t-h2{border-bottom:0;position:relative;padding-bottom:4px}.t-col-sidebar .t-h2::after{content:"";position:absolute;left:0;bottom:0;width:${sidePanel.headingRuleWidthPx || 28}px;border-bottom:1.5px solid ${colorVar(sidePanel.edgeColorToken || 'accent')}}.t-col-sidebar .t-skillrow{border-bottom:0;padding:1.5px 0}.t-col-sidebar .t-skillgroup+ .t-skillgroup{margin-top:4px}` : ''}
${sidePanel.headingRule === 'subtle-inverse' ? `.t-col-sidebar .t-h2{border-bottom:1px solid ${design.sidebar.ruleColor || '#475569'};padding-bottom:5px}.t-col-sidebar .t-h2::after{content:none}` : ''}
.t-record-list{display:grid;gap:${Math.max(2.4, sp.bulletGapPx * 0.78)}px}.t-record-item{display:grid;grid-template-columns:7px minmax(0,1fr);align-items:start;line-height:${design.typography.lineHeight};overflow-wrap:anywhere}.t-record-mark{width:4px;border-top:1.5px solid var(--tpl-accent);margin-top:.62em}.t-language-list{font-size:${bodyPx}px;line-height:${design.typography.lineHeight};overflow-wrap:anywhere}.t-language-sep{color:var(--tpl-rule);font-weight:750;margin:0 6px}.t-custom-section .t-ul,.t-volunteer-list{margin-top:4px}.t-custom-section+.t-custom-section{margin-top:${Math.max(6, sp.sectionGapPx * 0.72)}px}
@media print{.t-page{margin:0;width:auto;}${tree.columns.some((c) => c.id === 'sidebar') ? ' .t-col-sidebar{-webkit-print-color-adjust:exact;print-color-adjust:exact;}' : ''}}
`;
}

/* ------------------------------------------------------------------ */
/* 5. Full HTML document — DOM ORDER IS SEMANTIC ORDER                 */
/* ------------------------------------------------------------------ */
export function buildLayoutHTML(compiledOrDef, structuredInput, { sizeId = 'a4', bare = false } = {}) {
  /* A FAILED compile result is not a definition. Re-validating one produces a
     second-order error about "unsupported field ok" that says nothing about the
     real problem, which is how a single missing DSL key stayed invisible across
     28 templates. Detect it and report the original errors. */
  if (compiledOrDef && compiledOrDef.ok === false) {
    throw new Error(
      `template failed validation: ${(compiledOrDef.validation?.errors || ['unknown validation failure']).join('; ')}`,
    );
  }
  const compiled = compiledOrDef.tree ? compiledOrDef : compileTemplate(compiledOrDef);
  if (!compiled.ok) throw new Error(`template failed validation: ${compiled.validation.errors.join('; ')}`);
  const structured = normalizeStructuredContent(structuredInput);
  const { tree, tokens } = compiled;

  /* semantic order: header first, then every section in canonical/declared order.
     Each section element is TAGGED with its visual column; CSS grid places the
     column wrappers. To keep DOM order strictly semantic while still using
     grid areas, sections are grouped per column but columns are emitted in
     SEMANTIC priority (main before sidebar) and the grid re-positions them. */
  const byRegion = new Map(tree.columns.map((c) => [c.id, []]));
  for (const s of tree.sections) {
    const html = sectionHTML(s.key, structured, tokens);
    if (html) byRegion.get(s.region)?.push(html);
  }
  /* DOM emission order: columns sorted by the earliest declared section they
     contain — narrative content precedes rail/reference data in extraction,
     whatever the visual arrangement. Grid areas handle the visual placement. */
  const orderIdx = new Map(tree.sections.map((s, i) => [s.key, i]));
  const firstIdx = (col) => Math.min(...tree.sections.filter((s) => s.region === col.id).map((s) => orderIdx.get(s.key)), Infinity);
  const emission = [...tree.columns].sort((a, b) => firstIdx(a) - firstIdx(b));
  const columnsHTML = tree.layoutType === 'single-column'
    ? byRegion.get('main').join('\n')
    : `<div class="t-columns">${emission.map((c) => `<div class="t-col-${c.id}">${byRegion.get(c.id).join('\n')}</div>`).join('')}</div>`;

  const inner = `${headerHTML(structured, tokens)}\n${columnsHTML}`;
  if (bare) return inner;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(structured.personalInfo.name || 'Resume')}</title><style>${layoutCSS(compiled, { sizeId })}</style></head><body style="margin:0;background:#e9edf5;"><div class="t-page">${inner}</div></body></html>`;
}

/* ------------------------------------------------------------------ */
/* 6. Deterministic geometry estimate (lines → page count)             */
/* ------------------------------------------------------------------ */
export function estimateGeometry(compiled, structuredInput, { sizeId = 'a4' } = {}) {
  const structured = normalizeStructuredContent(structuredInput);
  const { tokens, tree } = compiled;
  const bodyPx = Math.max(READABILITY_FLOORS.minBodyFontPx, tokens.typography.bodyFontPx);
  const lineH = bodyPx * Math.max(READABILITY_FLOORS.minLineHeight, tokens.typography.lineHeight);
  const pageHpx = (sizeId === 'letter' ? 1056 : 1123) - tokens.spacing.marginMm * 2 * 3.78;
  const mainCol = tree.columns.find((c) => c.id === 'main') || tree.columns[0];
  const colWidthPx = ((sizeId === 'letter' ? 816 : 794) - tokens.spacing.marginMm * 2 * 3.78) * mainCol.width;
  const charsPerLine = Math.max(38, Math.floor(colWidthPx / (bodyPx * 0.52)));

  const linesOf = (text, width = charsPerLine) => Math.max(1, Math.ceil(String(text || '').length / width));
  const per = { header: 3.4 };
  let mainLines = 0; let railLines = 0;
  const railCol = tree.columns.find((c) => c.id !== mainCol.id);
  const railChars = railCol ? Math.max(20, Math.floor(charsPerLine * (railCol.width / mainCol.width))) : charsPerLine;
  for (const s of tree.sections) {
    const d = structured;
    if (!sectionHasContent(s.key, d)) continue;
    let lines = 1.6; // heading
    if (s.key === 'summary') lines += linesOf(d.summary);
    if (s.key === 'skills') lines += (d.skills || []).reduce((n, g) => n + linesOf(`${g.group}: ${g.items.join(', ')}`, s.region === 'sidebar' ? railChars : charsPerLine), 0);
    if (s.key === 'experience') lines += (d.experience || []).reduce((n, e2) => n + 1.4 + (e2.bullets || []).reduce((m, b) => m + linesOf(b), 0), 0);
    if (s.key === 'projects') lines += (d.projects || []).reduce((n, p) => n + 1.2 + (p.bullets || []).reduce((m, b) => m + linesOf(b), 0), 0);
    if (s.key === 'education') lines += (d.education || []).length * 1.4;
    if (s.key === 'certifications') lines += (d.certifications || []).reduce((n, c) => n + linesOf(c, s.region === 'sidebar' ? railChars : charsPerLine), 0);
    if (s.key === 'achievements') lines += (d.achievements || []).reduce((n, x) => n + linesOf(x, s.region === 'sidebar' ? railChars : charsPerLine), 0);
    if (s.key === 'publications') lines += (d.publications || []).reduce((n, x) => n + linesOf(x, s.region === 'sidebar' ? railChars : charsPerLine), 0);
    if (s.key === 'patents') lines += (d.patents || []).reduce((n, x) => n + linesOf(x, s.region === 'sidebar' ? railChars : charsPerLine), 0);
    if (s.key === 'volunteer') lines += (d.volunteer || []).reduce((n, x) => n + linesOf(x, s.region === 'sidebar' ? railChars : charsPerLine), 0);
    if (s.key === 'languages') lines += linesOf((d.languages || []).join(' · '), s.region === 'sidebar' ? railChars : charsPerLine);
    if (s.key === 'customSections') lines += (d.customSections || []).reduce((n, cs) => n + 1.2 + (cs.items || []).reduce((m, x) => m + linesOf(x, s.region === 'sidebar' ? railChars : charsPerLine), 0), 0);
    if (s.region === mainCol.id) mainLines += lines; else railLines += lines;
  }
  const headerPx = per.header * lineH + tokens.spacing.sectionGapPx;
  const bodyAvail = pageHpx - headerPx;
  const tallest = Math.max(mainLines, railLines * (tree.layoutType === 'single-column' ? 0 : 1)) * lineH
    + tree.sections.filter((s) => sectionHasContent(s.key, structured)).length * (tokens.spacing.sectionGapPx * 0.6);
  const totalLines = tree.layoutType === 'single-column' ? mainLines + railLines : Math.max(mainLines, railLines);
  return {
    version: LAYOUT_COMPILER_VERSION,
    charsPerLine, lineHeightPx: Number(lineH.toFixed(1)),
    mainLines: Math.round(mainLines), railLines: Math.round(railLines),
    pageCount: Math.max(1, Math.ceil(tallest / bodyAvail)),
    overflowLines: Math.max(0, Math.round((tallest - bodyAvail) / lineH)),
    utilization: Number(Math.min(1.5, tallest / bodyAvail).toFixed(2)),
    totalLines: Math.round(totalLines),
  };
}

export default { LAYOUT_COMPILER_VERSION, PAGE_COMPOSITION_VERSION, compileTemplate, adaptTreeToShape, balancePageComposition, buildLayoutHTML, layoutCSS, estimateGeometry, normalizeStructuredContent, CANONICAL_ORDER };
