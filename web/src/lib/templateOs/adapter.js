/* ============================================================
   TEMPLATE OS — LEGACY ADAPTER (TemplateAdapterV1)
   ------------------------------------------------------------
   Every existing registry template (8 legacy + 12 V3 + 8 V4) is
   MIGRATABLE: theme-driven single column. fromLegacyTemplate()
   projects them into the DSL non-destructively — the original
   registry rendering path keeps working untouched, so nothing
   breaks while Template OS grows underneath.

   toRegistryCard() does the reverse: projects a TemplateDefinition
   into the shape the existing gallery/Studio expect, flagged with
   engine:'template-os' so callers can branch to the new compiler.
   ============================================================ */
import { TEMPLATE_DSL_VERSION } from './dsl.js';
import { COLOR_PRESETS } from './primitives.js';
import { normalizeCareerStages } from '../../../../server/utils/resume/careerStage.js';

export const TEMPLATE_ADAPTER_VERSION = 'template-adapter-v1';

const FONT_TO_PRESET = [
  [/georgia|times/i, 'classic-serif'],
  [/calibri|segoe/i, 'strict-calibri'],
  [/helvetica|arial/i, 'system-sans'],
];

export function classifyLegacyTemplate(tpl) {
  if (!tpl) return 'BROKEN';
  if (tpl.previewType === 'structural' || tpl.set === undefined) return 'MIGRATABLE';
  return 'MIGRATABLE';
}

export function fromLegacyTemplate(tpl) {
  const typoPreset = FONT_TO_PRESET.find(([re]) => re.test(tpl.theme?.font || ''))?.[1] || 'system-sans';
  return {
    dslVersion: TEMPLATE_DSL_VERSION,
    id: `legacy-${tpl.id}`,
    name: tpl.name,
    version: 1,
    status: 'PUBLISHED',
    category: tpl.category || 'professional',
    tags: tpl.badges || [],
    supportedRoles: tpl.supportedRoles || [],
    careerStages: normalizeCareerStages(tpl.careerStages || []),
    layout: { type: 'single-column' },
    sectionPlacement: {},
    sectionOrder: tpl.theme?.sectionOrder || undefined,
    headerStyle: { primitive: tpl.theme?.headerBand ? 'executive' : tpl.theme?.headerAlign === 'center' ? 'centered' : 'minimal' },
    skillStyle: { primitive: tpl.theme?.skillsStyle === 'inline-lines' ? 'inline' : 'categorized' },
    experienceStyle: { primitive: 'classic' },
    projectStyle: { primitive: 'evidence' },
    sectionStyles: { divider: tpl.theme?.sectionStyle === 'rule' ? 'accent-rule' : tpl.theme?.sectionStyle === 'plain' ? 'none' : 'hairline' },
    typography: { preset: typoPreset },
    spacing: { preset: tpl.theme?.density === 'tight' ? 'compact' : tpl.theme?.density === 'comfortable' ? 'spacious' : 'balanced' },
    colors: { preset: 'slate', accent: tpl.theme?.accent },
    exports: { pdf: true, html: true, txt: true, docx: true, docxProfile: 'native' },
    license: tpl.license || { licenseStatus: 'INTERNAL_ORIGINAL', productionEnabled: true },
    migration: { classification: classifyLegacyTemplate(tpl), sourceTemplateId: tpl.id, adapter: TEMPLATE_ADAPTER_VERSION },
  };
}

/* Definition → gallery card compatible with the existing registry shape. */
export function toRegistryCard(def, cert = null) {
  const multi = def.layout.type !== 'single-column';
  const atsLevel = cert?.atsLevel || def.atsLevel || (multi ? 'BALANCED' : 'HIGH');
  return {
    engine: 'template-os',
    set: 'tos',
    id: def.id,
    name: def.name,
    category: def.category === 'technical' ? 'tech' : def.category,
    definition: def,
    templateVersion: Number(def.version || 1),
    atsSafe: atsLevel === 'VERY_HIGH' || atsLevel === 'HIGH',
    strictAts: atsLevel === 'VERY_HIGH',
    atsLevel,
    layoutType: def.layout.type,
    riskLevel: atsLevel === 'VERY_HIGH' || atsLevel === 'HIGH' ? 'low' : atsLevel === 'BALANCED' ? 'medium' : 'high',
    pageMode: 'auto',
    supportsOnePage: true,
    supportsMultiPage: true,
    previewType: 'template-os',
    bestFor: def.supportedRoles?.length ? def.supportedRoles : ['General'],
    badges: [
      multi ? (def.layout.type === 'two-column' ? 'Two column' : 'Sidebar') : 'Single column',
      ...(cert?.certified || def.certification?.certified ? [cert?.evidence === 'real-pdf-text-layer' || def.certification?.evidence === 'real-pdf-text-layer' ? 'PDF parse checks passed' : 'Parse checks passed'] : []),
      atsLevel.replace('_', ' '),
    ],
    description: def.description || `${def.name} — ${def.layout.type} layout compiled by Template OS.`,
    sections: ['Header', 'Summary', 'Skills', 'Experience', 'Projects', 'Education', 'Certifications', 'Achievements', 'Publications', 'Patents', 'Volunteer', 'Languages', 'Custom sections'],
    supportedRoles: def.supportedRoles || [],
    careerStages: normalizeCareerStages(def.careerStages || []),
    /* Phase 19: preserve the TemplateDefinition's real capacity contract all
       the way into Resume OS. Tailor for Job and auto-fit operate on registry
       cards, so dropping this field silently replaced premium template budgets
       with broad category defaults. Keep a detached JSON-safe copy so runtime
       cards cannot mutate the source definition by accident. */
    contentBudget: def.contentBudget && typeof def.contentBudget === 'object'
      ? JSON.parse(JSON.stringify(def.contentBudget))
      : undefined,
    theme: {
      /* enough theme surface for the DOCX writer + accent chips */
      accent: def.colors?.accent || COLOR_PRESETS[def.colors?.preset]?.accent || null,
      sectionOrder: def.sectionOrder || undefined,
    },
    license: def.license,
    atsLevelMultiPage: cert?.atsLevelMultiPage || def.certification?.atsLevelMultiPage || null,
    certification: cert || def.certification || undefined,
  };
}

export default { TEMPLATE_ADAPTER_VERSION, fromLegacyTemplate, toRegistryCard, classifyLegacyTemplate };
