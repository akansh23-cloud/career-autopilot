/* ============================================================
   TEMPLATE OS — DSL (TemplateDefinition)
   ------------------------------------------------------------
   A template is DATA, not executable code. This module owns:
     • the canonical TemplateDefinition schema + validation
     • strict allowlist security for imported/untrusted definitions
     • inheritance (extendTemplate) for template families

   Security rule: values that can reach HTML/CSS/PDF geometry are
   accepted only when both the FIELD and VALUE are known-safe.
   ============================================================ */

export const TEMPLATE_DSL_VERSION = 'template-dsl-v2-strict';
export const TEMPLATE_SECURITY_VERSION = 'template-security-v2-allowlist';

export const TEMPLATE_STATUSES = Object.freeze([
  'DRAFT', 'GENERATED', 'VALIDATING', 'CERTIFIED', 'APPROVED', 'DISABLED', 'LICENSE_PENDING', 'PUBLISHED',
]);
export const ATS_LEVELS = Object.freeze(['VERY_HIGH', 'HIGH', 'BALANCED', 'DESIGN_FORWARD']);
export const LAYOUT_TYPES = Object.freeze(['single-column', 'sidebar-left', 'sidebar-right', 'two-column']);
export const REGION_IDS = Object.freeze(['header', 'main', 'sidebar', 'left', 'right', 'footer']);
export const SECTION_KEYS = Object.freeze([
  'summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements',
  'publications', 'patents', 'volunteer', 'languages', 'customSections', 'links',
]);
export const DENSITY_MODES = Object.freeze(['compact', 'balanced', 'spacious']);
export const TEMPLATE_LICENSE_STATES = Object.freeze(['INTERNAL_ORIGINAL', 'OWNED', 'OPEN_SOURCE', 'LICENSED', 'LICENSE_PENDING', 'DEVELOPMENT_REFERENCE']);

export const READABILITY_FLOORS = Object.freeze({
  minBodyFontPx: 9.5,
  minSmallFontPx: 8.5,
  minMarginMm: 10,
  minLineHeight: 1.18,
  maxCharsPerLine: 110,
  minSidebarRatio: 0.24,
  maxSidebarRatio: 0.42,
});

/* Imported definitions are intentionally small. These limits protect the
   browser/server from deep or oversized JSON even before layout compilation. */
export const TEMPLATE_SECURITY_LIMITS = Object.freeze({
  maxDepth: 9,
  maxNodes: 420,
  maxTotalStringChars: 24_000,
  maxStringChars: 4_000,
  maxArrayItems: 60,
});

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inList = (v, list) => list.includes(v);
const plainObject = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};
const safeText = (v, max) => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(v);
const safeHex = (v) => typeof v === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(v);
const nRange = (v, min, max) => isNum(v) && v >= min && v <= max;
const intRange = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

const ROOT_KEYS = new Set([
  'dslVersion', 'id', 'name', 'version', 'status', 'description', 'category', 'tags', 'supportedRoles', 'careerStages',
  'atsLevel', 'layout', 'sectionPlacement', 'sectionOrder', 'headerStyle', 'skillStyle', 'experienceStyle', 'projectStyle',
  'educationStyle', 'sectionStyles', 'visualStyle', 'typography', 'spacing', 'colors', 'contentBudget', 'exports', 'license',
  'parentTemplateId', 'certification',
  /* Provenance written by fromLegacyTemplate(). It is real, load-bearing data —
     which legacy template a definition came from and which adapter produced it
     — and omitting it from this allowlist meant EVERY legacy-adapted template
     failed validation, so the renderer silently fell back to the legacy engine
     for 28 of 51 templates. */
  'migration',
]);
const LAYOUT_KEYS = new Set(['type', 'columns']);
const COLUMN_KEYS = new Set(['id', 'width']);
const PLACEMENT_KEYS = new Set(['region', 'fallback']);
const HEADER_KEYS = new Set(['primitive', 'contactGridColumns', 'accentMark', 'primaryInsetPx', 'splitPrimaryShare', 'align', 'contactSeparator', 'titleCase', 'titleLetterSpacingPx', 'accentMarkWidthPx']);
const SKILL_KEYS = new Set(['primitive', 'groupGapScale', 'itemSizeScale', 'labelSizeScale', 'labelCase', 'labelTone']);
const EXPERIENCE_KEYS = new Set(['primitive', 'itemGapScale']);
const PROJECT_KEYS = new Set(['primitive', 'itemGapScale']);
const EDUCATION_KEYS = new Set(['primitive', 'itemGapScale']);
const SECTION_STYLE_KEYS = new Set(['divider']);
const VISUAL_KEYS = new Set(['headerRule', 'sidebarPanel', 'certificationBlock', 'projectMeta', 'verifiedBadge', 'columnTreatment', 'singleColumnTreatment', 'summaryTreatment']);
const TYPOGRAPHY_KEYS = new Set([
  'preset', 'bodyFontPx', 'nameSize', 'titleSize', 'headingSize', 'roleSize', 'companySize', 'metaSize', 'contactSize', 'skillGroupSize',
  'nameWeight', 'titleWeight', 'headingWeight', 'roleWeight', 'companyWeight', 'nameLetterSpacing', 'headingLetterSpacing', 'lineHeight',
]);
const SPACING_KEYS = new Set(['preset', 'marginMm', 'sectionGapPx', 'itemGapPx', 'bulletGapPx']);
const COLOR_KEYS = new Set(['preset', 'accent', 'rule', 'sidebarBg', 'text', 'muted']);
const BUDGET_ROOT_KEYS = new Set(['summary', 'currentExperience', 'previousExperience', 'projects', 'skills', 'certifications', 'achievements']);
const BUDGET_PART_KEYS = new Set(['preferredLines', 'maxLines', 'preferredChars', 'maxChars', 'preferredBullets', 'maxBullets', 'preferredCount', 'maxCount']);
const EXPORT_KEYS = new Set(['pdf', 'html', 'txt', 'docx', 'docxProfile']);
const LICENSE_KEYS = new Set(['licenseStatus', 'source', 'licenseName', 'licenseNotice', 'productionEnabled']);
const CERT_KEYS = new Set(['certified', 'atsLevel', 'atsLevelMultiPage', 'minIntegrity', 'minOrderScore', 'label', 'evidence', 'maxPages']);
const MIGRATION_KEYS = new Set(['classification', 'sourceTemplateId', 'adapter']);

function unknownKeys(obj, allowed, path, errors) {
  if (obj == null) return;
  if (!plainObject(obj)) { errors.push(`${path} must be a plain object`); return; }
  for (const k of Object.keys(obj)) if (!allowed.has(k)) errors.push(`${path} contains unsupported field "${k}"`);
}

function inspectStructure(value) {
  const rejected = [];
  let nodes = 0; let chars = 0;
  const visit = (v, path, depth) => {
    nodes += 1;
    if (nodes > TEMPLATE_SECURITY_LIMITS.maxNodes) { rejected.push({ path, rule: 'definition exceeds node limit' }); return; }
    if (depth > TEMPLATE_SECURITY_LIMITS.maxDepth) { rejected.push({ path, rule: 'definition exceeds depth limit' }); return; }
    if (typeof v === 'string') {
      chars += v.length;
      if (v.length > TEMPLATE_SECURITY_LIMITS.maxStringChars) rejected.push({ path, rule: 'string exceeds length limit' });
      if (!safeText(v, TEMPLATE_SECURITY_LIMITS.maxStringChars)) rejected.push({ path, rule: 'string contains forbidden control/bidi characters' });
      return;
    }
    if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') { rejected.push({ path, rule: `unsupported value type ${typeof v}` }); return; }
    if (Array.isArray(v)) {
      if (v.length > TEMPLATE_SECURITY_LIMITS.maxArrayItems) rejected.push({ path, rule: 'array exceeds item limit' });
      v.forEach((x, i) => visit(x, `${path}[${i}]`, depth + 1));
      return;
    }
    if (v && typeof v === 'object') {
      if (!plainObject(v)) { rejected.push({ path, rule: 'non-plain object is not allowed' }); return; }
      for (const [k, x] of Object.entries(v)) {
        if (k === '__proto__' || k === 'prototype' || k === 'constructor') rejected.push({ path: path ? `${path}.${k}` : k, rule: 'prototype-manipulation key is forbidden' });
        else visit(x, path ? `${path}.${k}` : k, depth + 1);
      }
    }
  };
  visit(value, '', 0);
  if (chars > TEMPLATE_SECURITY_LIMITS.maxTotalStringChars) rejected.push({ path: '', rule: 'definition exceeds total string budget' });
  return rejected;
}

const DANGEROUS = [
  /<\s*script/i, /javascript\s*:/i, /\beval\s*\(/i, /\bexpression\s*\(/i, /on\w+\s*=/i, /@import/i,
  /url\s*\(\s*['"]?(?!#|data:image\/(png|jpe?g|webp);)/i, /<\s*iframe/i, /\bdocument\s*\./i, /\bwindow\s*\./i,
  /<\s*style/i, /@font-face/i,
];

/* ------------------------------------------------------------------ */
/* Strict validation                                                   */
/* ------------------------------------------------------------------ */
export function validateTemplateDefinition(def, { primitives = null } = {}) {
  const errors = [];
  const warn = [];
  const e = (m) => errors.push(m);
  if (!plainObject(def)) return { ok: false, errors: ['definition must be a plain object'], warnings: [], dslVersion: TEMPLATE_DSL_VERSION, securityVersion: TEMPLATE_SECURITY_VERSION };

  for (const r of inspectStructure(def)) e(`${r.path || 'definition'}: ${r.rule}`);
  unknownKeys(def, ROOT_KEYS, 'definition', errors);

  if (!isStr(def.id) || !/^[a-z0-9][a-z0-9-]{1,60}$/.test(def.id)) e('id must be a kebab-case slug');
  if (!safeText(def.name, 120) || !def.name.trim()) e('name is required and must be <= 120 safe characters');
  if (!Number.isInteger(def.version) || def.version < 1 || def.version > 100000) e('version must be an integer between 1 and 100000');
  if (!safeText(String(def.category || ''), 40) || !isStr(def.category)) e('category is required');
  if (def.description != null && !safeText(def.description, 800)) e('description must be <= 800 safe characters');
  if (def.parentTemplateId != null && (!safeText(def.parentTemplateId, 80) || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(def.parentTemplateId))) e('parentTemplateId must be a safe template slug');
  if (def.dslVersion && def.dslVersion !== TEMPLATE_DSL_VERSION) warn.push(`dslVersion ${def.dslVersion} differs from engine ${TEMPLATE_DSL_VERSION}`);

  const stringArray = (field, maxItems, maxLen) => {
    if (def[field] == null) return;
    if (!Array.isArray(def[field]) || def[field].length > maxItems || def[field].some((x) => !safeText(x, maxLen) || !x.trim())) e(`${field} must be an array of at most ${maxItems} safe strings`);
  };
  stringArray('tags', 20, 50);
  stringArray('supportedRoles', 20, 80);
  if (def.careerStages != null) {
    if (!Array.isArray(def.careerStages) || def.careerStages.length > 5 || def.careerStages.some((x) => !['student', 'early', 'mid', 'senior', 'executive'].includes(x))) e('careerStages contains unsupported values');
  }

  /* layout */
  const layout = def.layout || {};
  unknownKeys(layout, LAYOUT_KEYS, 'layout', errors);
  if (!inList(layout.type, LAYOUT_TYPES)) e(`layout.type must be one of ${LAYOUT_TYPES.join(', ')}`);
  const cols = Array.isArray(layout.columns) ? layout.columns : [];
  if (layout.columns != null && !Array.isArray(layout.columns)) e('layout.columns must be an array');
  cols.forEach((c, i) => unknownKeys(c, COLUMN_KEYS, `layout.columns[${i}]`, errors));
  if (layout.type === 'single-column') {
    if (cols.length) e('single-column layout cannot declare columns');
  } else {
    if (cols.length !== 2) e('multi-column layouts need exactly 2 columns');
    const total = cols.reduce((s, c) => s + (isNum(c?.width) ? c.width : 0), 0);
    if (Math.abs(total - 1) > 0.02) e('column widths must sum to 1');
    for (const c of cols) if (!c || !REGION_IDS.includes(c.id) || !nRange(c.width, 0.18, 0.82)) e('every column needs an approved region id and width between 0.18 and 0.82');
    const ids = cols.map((c) => c?.id);
    if (new Set(ids).size !== ids.length) e('column ids must be unique');
    if (layout.type === 'two-column' && !(ids.includes('left') && ids.includes('right'))) e('two-column layout must use left/right regions');
    if (layout.type?.startsWith('sidebar') && !(ids.includes('sidebar') && ids.includes('main'))) e('sidebar layout must use sidebar/main regions');
    const side = cols.find((c) => c?.id === 'sidebar' || c?.id === 'left');
    if (side && (side.width < READABILITY_FLOORS.minSidebarRatio || side.width > READABILITY_FLOORS.maxSidebarRatio)) e(`sidebar/reference width ${side.width} outside readable range ${READABILITY_FLOORS.minSidebarRatio}-${READABILITY_FLOORS.maxSidebarRatio}`);
  }

  /* placement + order */
  const regionIds = layout.type === 'single-column' ? ['main'] : cols.map((c) => c.id);
  const placement = def.sectionPlacement || {};
  if (!plainObject(placement)) e('sectionPlacement must be a plain object');
  else for (const [sec, reg] of Object.entries(placement)) {
    if (!SECTION_KEYS.includes(sec)) e(`sectionPlacement has unknown section "${sec}"`);
    if (plainObject(reg)) unknownKeys(reg, PLACEMENT_KEYS, `sectionPlacement.${sec}`, errors);
    else if (typeof reg !== 'string') e(`section "${sec}" placement must be a region string or {region,fallback}`);
    const target = typeof reg === 'string' ? reg : reg?.region;
    if (!regionIds.includes(target)) e(`section "${sec}" placed in unknown region "${target}"`);
    const fb = plainObject(reg) ? reg.fallback : null;
    if (fb && !regionIds.includes(fb)) e(`section "${sec}" fallback region "${fb}" unknown`);
  }
  if (def.sectionOrder != null) {
    if (!Array.isArray(def.sectionOrder) || def.sectionOrder.length > SECTION_KEYS.length || def.sectionOrder.some((x) => !SECTION_KEYS.includes(x))) e('sectionOrder may contain only known section keys');
    else if (new Set(def.sectionOrder).size !== def.sectionOrder.length) e('sectionOrder cannot contain duplicate sections');
  }

  unknownKeys(def.headerStyle || {}, HEADER_KEYS, 'headerStyle', errors);
  unknownKeys(def.skillStyle || {}, SKILL_KEYS, 'skillStyle', errors);
  unknownKeys(def.experienceStyle || {}, EXPERIENCE_KEYS, 'experienceStyle', errors);
  unknownKeys(def.projectStyle || {}, PROJECT_KEYS, 'projectStyle', errors);
  unknownKeys(def.educationStyle || {}, EDUCATION_KEYS, 'educationStyle', errors);
  unknownKeys(def.sectionStyles || {}, SECTION_STYLE_KEYS, 'sectionStyles', errors);
  unknownKeys(def.visualStyle || {}, VISUAL_KEYS, 'visualStyle', errors);
  unknownKeys(def.typography || {}, TYPOGRAPHY_KEYS, 'typography', errors);
  unknownKeys(def.spacing || {}, SPACING_KEYS, 'spacing', errors);
  unknownKeys(def.colors || {}, COLOR_KEYS, 'colors', errors);
  unknownKeys(def.contentBudget || {}, BUDGET_ROOT_KEYS, 'contentBudget', errors);
  unknownKeys(def.exports || {}, EXPORT_KEYS, 'exports', errors);
  unknownKeys(def.license || {}, LICENSE_KEYS, 'license', errors);
  unknownKeys(def.certification || {}, CERT_KEYS, 'certification', errors);
  /* Validated, not merely tolerated: provenance that can hold arbitrary keys is
     provenance nobody can trust. */
  unknownKeys(def.migration || {}, MIGRATION_KEYS, 'migration', errors);

  for (const [k, part] of Object.entries(def.contentBudget || {})) {
    unknownKeys(part, BUDGET_PART_KEYS, `contentBudget.${k}`, errors);
    for (const [f, v] of Object.entries(part || {})) {
      const max = /Chars$/.test(f) ? 4000 : /Lines$/.test(f) ? 12 : /Bullets$/.test(f) ? 12 : 60;
      if (!intRange(v, 0, max)) e(`contentBudget.${k}.${f} must be an integer between 0 and ${max}`);
    }
    if (isNum(part?.preferredCount) && isNum(part?.maxCount) && part.preferredCount > part.maxCount) e(`contentBudget.${k}.preferredCount cannot exceed maxCount`);
    if (isNum(part?.preferredBullets) && isNum(part?.maxBullets) && part.preferredBullets > part.maxBullets) e(`contentBudget.${k}.preferredBullets cannot exceed maxBullets`);
    if (isNum(part?.preferredLines) && isNum(part?.maxLines) && part.preferredLines > part.maxLines) e(`contentBudget.${k}.preferredLines cannot exceed maxLines`);
    if (isNum(part?.preferredChars) && isNum(part?.maxChars) && part.preferredChars > part.maxChars) e(`contentBudget.${k}.preferredChars cannot exceed maxChars`);
  }

  /* only primitive ids can alter renderer behavior */
  if (primitives) {
    const check = (kind, id, path = kind) => { if (id && !primitives[kind]?.[id]) e(`unknown ${path} primitive "${id}"`); };
    check('headers', def.headerStyle?.primitive, 'headers');
    check('skills', def.skillStyle?.primitive, 'skills');
    check('experience', def.experienceStyle?.primitive, 'experience');
    check('projects', def.projectStyle?.primitive, 'projects');
    check('education', def.educationStyle?.primitive, 'education');
    check('dividers', def.sectionStyles?.divider, 'dividers');
    check('typography', def.typography?.preset, 'typography');
    check('spacing', def.spacing?.preset, 'spacing');
    check('colors', def.colors?.preset, 'colors');
    const visualChecks = [
      ['headerRules', def.visualStyle?.headerRule], ['sidebarPanels', def.visualStyle?.sidebarPanel],
      ['certificationBlocks', def.visualStyle?.certificationBlock], ['projectMeta', def.visualStyle?.projectMeta],
      ['verifiedBadges', def.visualStyle?.verifiedBadge], ['columnTreatments', def.visualStyle?.columnTreatment],
      ['singleColumnTreatments', def.visualStyle?.singleColumnTreatment], ['summaryTreatments', def.visualStyle?.summaryTreatment],
    ];
    for (const [kind, id] of visualChecks) if (id && !primitives.visual?.[kind]?.[id]) e(`unknown visual.${kind} primitive "${id}"`);
  }

  /* safe tunable ranges. Custom font/CSS strings are deliberately absent. */
  const h = def.headerStyle || {};
  if (h.contactGridColumns != null && !intRange(h.contactGridColumns, 1, 3)) e('headerStyle.contactGridColumns must be 1-3');
  if (h.primaryInsetPx != null && !nRange(h.primaryInsetPx, 0, 40)) e('headerStyle.primaryInsetPx must be 0-40');
  if (h.accentMarkWidthPx != null && !nRange(h.accentMarkWidthPx, 0, 80)) e('headerStyle.accentMarkWidthPx must be 0-80');
  if (h.splitPrimaryShare != null && !nRange(h.splitPrimaryShare, 0.45, 0.75)) e('headerStyle.splitPrimaryShare must be 0.45-0.75');
  if (h.titleLetterSpacingPx != null && !nRange(h.titleLetterSpacingPx, -0.5, 4)) e('headerStyle.titleLetterSpacingPx must be -0.5-4');
  if (h.align != null && !['left', 'center', 'right'].includes(h.align)) e('headerStyle.align unsupported');
  if (h.accentMark != null && !['none', 'vertical', 'short-rule'].includes(h.accentMark)) e('headerStyle.accentMark unsupported');
  if (h.titleCase != null && !['none', 'upper', 'title'].includes(h.titleCase)) e('headerStyle.titleCase unsupported');
  if (h.contactSeparator != null && !['  ·  ', ' · ', ' | ', ' ', 'dot', 'pipe', 'space'].includes(h.contactSeparator)) e('headerStyle.contactSeparator unsupported');

  const scaleFields = [
    ['skillStyle.groupGapScale', def.skillStyle?.groupGapScale, 0.5, 1.8], ['skillStyle.itemSizeScale', def.skillStyle?.itemSizeScale, 0.75, 1.3],
    ['skillStyle.labelSizeScale', def.skillStyle?.labelSizeScale, 0.75, 1.35], ['experienceStyle.itemGapScale', def.experienceStyle?.itemGapScale, 0.6, 1.8],
    ['projectStyle.itemGapScale', def.projectStyle?.itemGapScale, 0.6, 1.8], ['educationStyle.itemGapScale', def.educationStyle?.itemGapScale, 0.6, 1.8],
  ];
  for (const [path, v, min, max] of scaleFields) if (v != null && !nRange(v, min, max)) e(`${path} must be ${min}-${max}`);
  if (def.skillStyle?.labelCase != null && !['none', 'upper', 'title'].includes(def.skillStyle.labelCase)) e('skillStyle.labelCase unsupported');
  if (def.skillStyle?.labelTone != null && !['text', 'muted', 'accent'].includes(def.skillStyle.labelTone)) e('skillStyle.labelTone unsupported');

  const t = def.typography || {};
  if (t.bodyFontPx != null && !nRange(t.bodyFontPx, READABILITY_FLOORS.minBodyFontPx, 18)) e(`bodyFontPx must be ${READABILITY_FLOORS.minBodyFontPx}-18`);
  if (t.lineHeight != null && !nRange(t.lineHeight, READABILITY_FLOORS.minLineHeight, 1.8)) e(`lineHeight must be ${READABILITY_FLOORS.minLineHeight}-1.8`);
  for (const k of ['nameSize', 'titleSize', 'headingSize', 'roleSize', 'companySize', 'metaSize', 'contactSize', 'skillGroupSize']) if (t[k] != null && !nRange(t[k], 8.5, 48)) e(`typography.${k} must be 8.5-48`);
  for (const k of ['nameWeight', 'titleWeight', 'headingWeight', 'roleWeight', 'companyWeight']) if (t[k] != null && !nRange(t[k], 300, 900)) e(`typography.${k} must be 300-900`);
  for (const k of ['nameLetterSpacing', 'headingLetterSpacing']) if (t[k] != null && !nRange(t[k], -1, 5)) e(`typography.${k} must be -1-5`);

  const sp = def.spacing || {};
  if (sp.marginMm != null && !nRange(sp.marginMm, READABILITY_FLOORS.minMarginMm, 30)) e(`spacing.marginMm must be ${READABILITY_FLOORS.minMarginMm}-30`);
  if (sp.sectionGapPx != null && !nRange(sp.sectionGapPx, 6, 32)) e('spacing.sectionGapPx must be 6-32');
  if (sp.itemGapPx != null && !nRange(sp.itemGapPx, 2, 20)) e('spacing.itemGapPx must be 2-20');
  if (sp.bulletGapPx != null && !nRange(sp.bulletGapPx, 1, 12)) e('spacing.bulletGapPx must be 1-12');

  for (const k of ['accent', 'rule', 'sidebarBg', 'text', 'muted']) if (def.colors?.[k] != null && !safeHex(def.colors[k])) e(`colors.${k} must be a 3- or 6-digit hex color`);

  if (def.status && !TEMPLATE_STATUSES.includes(def.status)) e(`unknown status ${def.status}`);
  if (def.atsLevel && !ATS_LEVELS.includes(def.atsLevel)) e(`unknown atsLevel ${def.atsLevel}`);
  if (def.exports) {
    for (const k of ['pdf', 'html', 'txt', 'docx']) if (def.exports[k] != null && typeof def.exports[k] !== 'boolean') e(`exports.${k} must be boolean`);
    if (def.exports.docxProfile != null && !['native', 'simplified-single-column'].includes(def.exports.docxProfile)) e('exports.docxProfile unsupported');
  }
  if (def.license) {
    if (typeof def.license.productionEnabled !== 'boolean') e('license.productionEnabled must be boolean');
    if (def.license.licenseStatus != null && !TEMPLATE_LICENSE_STATES.includes(def.license.licenseStatus)) e('license.licenseStatus unsupported');
    if (def.license.source != null && !safeText(def.license.source, 240)) e('license.source too long/unsafe');
    if (def.license.licenseName != null && !safeText(def.license.licenseName, 120)) e('license.licenseName too long/unsafe');
    if (def.license.licenseNotice != null && !safeText(def.license.licenseNotice, 4000)) e('license.licenseNotice too long/unsafe');
  }
  if (def.certification) {
    if (def.certification.certified != null && typeof def.certification.certified !== 'boolean') e('certification.certified must be boolean');
    for (const k of ['minIntegrity', 'minOrderScore']) if (def.certification[k] != null && !nRange(def.certification[k], 0, 100)) e(`certification.${k} must be 0-100`);
    if (def.certification.maxPages != null && !intRange(def.certification.maxPages, 1, 4)) e('certification.maxPages must be 1-4');
    if (def.certification.atsLevel != null && !ATS_LEVELS.includes(def.certification.atsLevel)) e('certification.atsLevel unsupported');
    if (def.certification.atsLevelMultiPage != null && !ATS_LEVELS.includes(def.certification.atsLevelMultiPage)) e('certification.atsLevelMultiPage unsupported');
    if (def.certification.label != null && !safeText(def.certification.label, 160)) e('certification.label too long/unsafe');
    if (def.certification.evidence != null && !safeText(def.certification.evidence, 120)) e('certification.evidence too long/unsafe');
  }

  return { ok: errors.length === 0, errors, warnings: warn, dslVersion: TEMPLATE_DSL_VERSION, securityVersion: TEMPLATE_SECURITY_VERSION };
}

/* ------------------------------------------------------------------ */
/* Security sanitization for imported/untrusted definitions            */
/* ------------------------------------------------------------------ */
export function sanitizeTemplateDefinition(input, { primitives = null } = {}) {
  const rejected = [...inspectStructure(input)];
  const scan = (val, path) => {
    if (typeof val === 'string') {
      for (const re of DANGEROUS) if (re.test(val)) rejected.push({ path, rule: String(re) });
    } else if (Array.isArray(val)) val.forEach((v, i) => scan(v, `${path}[${i}]`));
    else if (plainObject(val)) for (const [k, v] of Object.entries(val)) scan(v, path ? `${path}.${k}` : k);
  };
  scan(input, '');
  if (rejected.length) return { ok: false, rejected, def: null, securityVersion: TEMPLATE_SECURITY_VERSION };

  let def;
  try { def = JSON.parse(JSON.stringify(input)); }
  catch { return { ok: false, rejected: [{ path: '', rule: 'not JSON-serializable' }], def: null, securityVersion: TEMPLATE_SECURITY_VERSION }; }

  /* Validation is part of sanitization: unknown fields and CSS-reachable
     values are rejected instead of silently stripped. This fail-closed rule
     prevents a future compiler spread from becoming a style injection path. */
  const validation = validateTemplateDefinition(def, { primitives });
  if (!validation.ok) {
    return {
      ok: false,
      rejected: validation.errors.map((rule) => ({ path: '', rule })),
      def: null,
      validation,
      securityVersion: TEMPLATE_SECURITY_VERSION,
    };
  }
  return { ok: true, rejected: [], def, validation, securityVersion: TEMPLATE_SECURITY_VERSION };
}

/* ------------------------------------------------------------------ */
/* Inheritance — shallow-by-section merge, deep for style objects      */
/* ------------------------------------------------------------------ */
export function extendTemplate(base, overrides) {
  const merge = (a, b) => {
    if (b === undefined) return a;
    if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return b;
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = merge(a[k], b[k]);
    return out;
  };
  const child = merge(base, overrides);
  child.parentTemplateId = base.id;
  child.version = overrides.version ?? 1;
  return child;
}

export default {
  TEMPLATE_DSL_VERSION, TEMPLATE_SECURITY_VERSION, TEMPLATE_SECURITY_LIMITS, TEMPLATE_STATUSES, ATS_LEVELS, LAYOUT_TYPES,
  SECTION_KEYS, DENSITY_MODES, READABILITY_FLOORS, validateTemplateDefinition, sanitizeTemplateDefinition, extendTemplate,
};
