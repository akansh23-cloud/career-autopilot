/* ============================================================
   TEMPLATE OS — DETERMINISTIC TEMPLATE SYNTHESIS
   ------------------------------------------------------------
   Phase 25: generator diversity.

   The generator no longer performs a shallow Cartesian product of the
   same geometry with new colors. It starts from structurally distinct
   archetypes, adapts each archetype to the requested role/stage, measures
   each candidate, then uses deterministic novelty-aware ranking.

   No AI, no generated code, no free-form CSS. Every output is still an
   allowlisted TemplateDefinition composed from approved primitives.
   ============================================================ */
import { certifyDefinition } from './certification.js';
import { validateTemplateDefinition, TEMPLATE_DSL_VERSION } from './dsl.js';
import { PRIMITIVES } from './primitives.js';
import { normalizeCareerStage } from '../../../../server/utils/resume/careerStage.js';

export const TEMPLATE_SYNTHESIS_VERSION = 'template-synthesis-v4-reference-premium-families';
export const TEMPLATE_GENERATOR_DIVERSITY_VERSION = 'template-generator-diversity-v1';

const FULL_SECTIONS = ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'];

const ROLE_FAMILY = [
  [/devops|sre|platform|cloud|infra/i, { id: 'cloud-platform', category: 'technical', archetypes: ['technical-right-rail', 'chip-cloud', 'midnight-rail', 'technical-left-rail', 'centered-ats', 'narrative-engineering', 'corporate-split', 'editorial-reference'] }],
  [/data engineer|analytics engineer|data platform|etl/i, { id: 'data-platform', category: 'technical', archetypes: ['data-right-rail', 'technical-left-rail', 'minimal-ats', 'narrative-engineering', 'corporate-split', 'editorial-reference'] }],
  [/data scientist|machine learning|\bml\b|analytics|data analyst/i, { id: 'analytics', category: 'technical', archetypes: ['data-right-rail', 'narrative-analytical', 'minimal-ats', 'corporate-split', 'editorial-reference', 'technical-right-rail'] }],
  [/security|cyber/i, { id: 'security', category: 'technical', archetypes: ['security-left-rail', 'technical-right-rail', 'minimal-ats', 'narrative-engineering', 'corporate-split', 'editorial-reference'] }],
  [/manager|director|executive|\bvp\b|head|chief|cto|cio/i, { id: 'executive', category: 'executive', archetypes: ['dark-executive', 'executive-impact', 'narrative-executive', 'heritage-detailed', 'minimal-ats', 'corporate-split', 'editorial-reference'] }],
  [/student|intern|fresher|graduate|campus/i, { id: 'student', category: 'student', archetypes: ['graduate-chips', 'student-portfolio', 'student-minimal', 'project-narrative', 'minimal-ats', 'centered-ats', 'editorial-reference'] }],
  [/research|scientist|academic|patent/i, { id: 'research', category: 'professional', archetypes: ['research-editorial', 'minimal-ats', 'narrative-analytical', 'editorial-reference', 'corporate-split', 'narrative-professional'] }],
  [/consult|finance|analyst|product|business|marketing/i, { id: 'business', category: 'professional', archetypes: ['corporate-split', 'narrative-professional', 'minimal-ats', 'editorial-reference', 'narrative-analytical', 'technical-right-rail'] }],
];

const DEFAULT_FAMILY = { id: 'professional', category: 'professional', archetypes: ['narrative-professional', 'minimal-ats', 'corporate-split', 'editorial-reference', 'narrative-analytical', 'technical-right-rail'] };
const familyFor = (roles = []) => ROLE_FAMILY.find(([re]) => re.test(roles.join(' ')))?.[1] || DEFAULT_FAMILY;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 46);

const ARCHETYPES = Object.freeze({
  'technical-right-rail': { layout: 'sidebar-right', ratio: 0.28, header: 'technical', skills: 'sidebar-groups', experience: 'cloud-platform', projects: 'evidence-compact', divider: 'hairline', typo: 'cloud-engineering', colors: ['teal', 'slate'], visual: { sidebarPanel: 'cloud-rail', headerRule: 'accent', certificationBlock: 'featured', projectMeta: 'accent', verifiedBadge: 'soft' }, rail: ['certifications', 'skills', 'education', 'languages'], order: ['summary', 'experience', 'projects', 'certifications', 'skills', 'education', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'technical-left-rail': { layout: 'sidebar-left', ratio: 0.31, header: 'technical', skills: 'sidebar-groups', experience: 'technical', projects: 'evidence', divider: 'accent-rule', typo: 'engineering-mix', colors: ['slate', 'navy'], visual: { sidebarPanel: 'premium-content', certificationBlock: 'accent', projectMeta: 'accent', verifiedBadge: 'soft' }, rail: ['skills', 'certifications', 'education', 'languages'], order: ['summary', 'experience', 'projects', 'skills', 'certifications', 'education', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'data-right-rail': { layout: 'sidebar-right', ratio: 0.3, header: 'minimal', skills: 'compact-matrix', experience: 'impact-first', projects: 'evidence', divider: 'short-rule', typo: 'system-sans', colors: ['indigo', 'teal'], visual: { sidebarPanel: 'premium-content', projectMeta: 'accent', verifiedBadge: 'soft' }, rail: ['skills', 'certifications', 'education'], order: ['summary', 'experience', 'projects', 'skills', 'certifications', 'education', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'security-left-rail': { layout: 'sidebar-left', ratio: 0.29, header: 'technical', skills: 'sidebar-groups', experience: 'technical', projects: 'evidence-compact', divider: 'hairline', typo: 'engineering-mix', colors: ['monochrome', 'slate'], visual: { sidebarPanel: 'soft-accent-edge', certificationBlock: 'featured', verifiedBadge: 'outline' }, rail: ['certifications', 'skills', 'education'], order: ['summary', 'experience', 'projects', 'certifications', 'skills', 'education', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'corporate-split': { layout: 'two-column', ratio: 0.38, header: 'corporate', skills: 'compact-matrix', experience: 'classic', projects: 'classic', divider: 'short-rule', typo: 'classic-serif', colors: ['burgundy', 'navy'], visual: { columnTreatment: 'editorial-split' }, rail: ['skills', 'education', 'certifications', 'achievements', 'languages'], order: ['summary', 'experience', 'projects', 'skills', 'education', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'editorial-reference': { layout: 'two-column', ratio: 0.34, header: 'editorial', skills: 'inline', experience: 'editorial', projects: 'classic', divider: 'editorial-line', typo: 'editorial-premium', colors: ['ink', 'burgundy'], visual: { columnTreatment: 'editorial-split' }, rail: ['skills', 'education', 'certifications', 'languages'], order: ['summary', 'experience', 'projects', 'skills', 'education', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'narrative-engineering': { layout: 'single-column', header: 'technical', skills: 'inline', experience: 'technical', projects: 'evidence', divider: 'hairline', typo: 'engineering-mix', colors: ['slate', 'teal'], visual: { headerRule: 'accent', projectMeta: 'accent', verifiedBadge: 'soft' }, order: ['summary', 'skills', 'experience', 'projects', 'certifications', 'education', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'narrative-analytical': { layout: 'single-column', header: 'editorial', skills: 'categorized', experience: 'impact-first', projects: 'classic', divider: 'editorial-line', typo: 'editorial-premium', colors: ['ink', 'indigo'], visual: { singleColumnTreatment: 'editorial-flow', summaryTreatment: 'editorial-lead' }, order: ['summary', 'experience', 'skills', 'projects', 'education', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'narrative-professional': { layout: 'single-column', header: 'editorial', skills: 'inline', experience: 'editorial', projects: 'classic', divider: 'editorial-line', typo: 'editorial-premium', colors: ['ink', 'burgundy'], visual: { singleColumnTreatment: 'editorial-flow', summaryTreatment: 'editorial-lead' }, order: ['summary', 'experience', 'skills', 'projects', 'education', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'narrative-executive': { layout: 'single-column', header: 'executive', skills: 'inline', experience: 'executive-impact', projects: 'compact', divider: 'editorial-line', typo: 'executive-premium', colors: ['executive-navy', 'monochrome'], visual: { singleColumnTreatment: 'executive-flow', summaryTreatment: 'executive-lead' }, order: ['summary', 'achievements', 'experience', 'skills', 'projects', 'education', 'certifications', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'executive-impact': { layout: 'single-column', header: 'executive', skills: 'plain', experience: 'executive-impact', projects: 'compact', divider: 'editorial-line', typo: 'executive-serif', colors: ['executive-navy', 'burgundy'], visual: { singleColumnTreatment: 'executive-flow', summaryTreatment: 'executive-lead' }, order: ['summary', 'achievements', 'experience', 'projects', 'skills', 'education', 'certifications', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'minimal-ats': { layout: 'single-column', header: 'minimal', skills: 'plain', experience: 'classic', projects: 'compact', divider: 'hairline', typo: 'strict-calibri', colors: ['monochrome', 'slate'], visual: {}, order: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'centered-ats': { layout: 'single-column', header: 'centered', skills: 'inline', experience: 'classic', projects: 'classic', divider: 'hairline', typo: 'centered-ats-sans', colors: ['slate', 'monochrome'], visual: {}, order: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'chip-cloud': { layout: 'single-column', header: 'minimal', skills: 'soft-chips', experience: 'cloud-platform', projects: 'evidence-compact', divider: 'accent-rule', typo: 'modern-chip-sans', colors: ['reference-sky', 'reference-violet'], visual: { projectMeta: 'accent', verifiedBadge: 'soft' }, order: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'midnight-rail': { layout: 'sidebar-left', ratio: 0.32, header: 'compact', skills: 'soft-chips', experience: 'classic', projects: 'classic', divider: 'accent-rule', typo: 'midnight-rail-sans', colors: ['reference-midnight'], visual: { sidebarPanel: 'midnight-solid', projectMeta: 'accent' }, rail: ['skills', 'education', 'certifications', 'languages'], order: ['summary', 'experience', 'projects', 'skills', 'education', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'graduate-chips': { layout: 'single-column', header: 'student', skills: 'soft-chips', experience: 'compact', projects: 'student-portfolio', education: 'campus-featured', divider: 'accent-rule', typo: 'modern-chip-sans', colors: ['reference-violet'], visual: { summaryTreatment: 'student-intro', projectMeta: 'accent' }, order: ['summary', 'education', 'projects', 'skills', 'experience', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'heritage-detailed': { layout: 'single-column', header: 'editorial', skills: 'inline', experience: 'classic', projects: 'classic', divider: 'accent-rule', typo: 'heritage-detailed-serif', colors: ['reference-rust'], visual: { singleColumnTreatment: 'editorial-flow', summaryTreatment: 'editorial-lead' }, order: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'dark-executive': { layout: 'single-column', header: 'dark-executive-classic', skills: 'inline', experience: 'executive-impact', projects: 'classic', divider: 'accent-rule', typo: 'heritage-detailed-serif', colors: ['reference-amber'], visual: { summaryTreatment: 'executive-lead' }, order: ['summary', 'achievements', 'skills', 'experience', 'projects', 'education', 'certifications', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'student-portfolio': { layout: 'sidebar-right', ratio: 0.3, header: 'student', skills: 'sidebar-groups', experience: 'compact', projects: 'student-portfolio', education: 'campus-featured', divider: 'short-rule', typo: 'student-premium', colors: ['campus-blue', 'indigo'], visual: { sidebarPanel: 'student-rail', projectMeta: 'accent', verifiedBadge: 'soft', summaryTreatment: 'student-intro' }, rail: ['skills', 'certifications', 'achievements', 'languages'], order: ['summary', 'education', 'projects', 'experience', 'skills', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'student-minimal': { layout: 'single-column', header: 'student', skills: 'categorized', experience: 'compact', projects: 'student-portfolio', education: 'campus-featured', divider: 'short-rule', typo: 'student-premium', colors: ['campus-blue', 'navy'], visual: { summaryTreatment: 'student-intro', projectMeta: 'accent', verifiedBadge: 'soft' }, order: ['summary', 'education', 'projects', 'skills', 'experience', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'project-narrative': { layout: 'single-column', header: 'minimal', skills: 'inline', experience: 'compact', projects: 'evidence', education: 'campus-featured', divider: 'hairline', typo: 'system-sans', colors: ['navy', 'teal'], visual: { projectMeta: 'accent', verifiedBadge: 'soft' }, order: ['summary', 'projects', 'education', 'skills', 'experience', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'] },
  'research-editorial': { layout: 'single-column', header: 'editorial', skills: 'categorized', experience: 'classic', projects: 'evidence', divider: 'editorial-line', typo: 'classic-serif', colors: ['ink', 'navy'], visual: { singleColumnTreatment: 'editorial-flow', summaryTreatment: 'editorial-lead', projectMeta: 'accent' }, order: ['summary', 'experience', 'publications', 'patents', 'projects', 'skills', 'education', 'certifications', 'achievements', 'volunteer', 'languages', 'customSections'] },
});

const BUDGETS = Object.freeze({
  student: { summary: { preferredLines: 2, maxLines: 3 }, currentExperience: { preferredBullets: 3, maxBullets: 4 }, previousExperience: { preferredBullets: 2, maxBullets: 3 }, projects: { preferredCount: 3, maxCount: 4, preferredBullets: 3, maxBullets: 4 }, skills: { preferredCount: 12, maxCount: 18 }, certifications: { preferredCount: 2, maxCount: 4 }, achievements: { preferredCount: 2, maxCount: 4 } },
  executive: { summary: { preferredLines: 4, maxLines: 5 }, currentExperience: { preferredBullets: 5, maxBullets: 7 }, previousExperience: { preferredBullets: 3, maxBullets: 5 }, projects: { preferredCount: 1, maxCount: 2, preferredBullets: 2, maxBullets: 3 }, skills: { preferredCount: 12, maxCount: 18 }, certifications: { preferredCount: 2, maxCount: 4 }, achievements: { preferredCount: 3, maxCount: 5 } },
  default: { summary: { preferredLines: 3, maxLines: 4 }, currentExperience: { preferredBullets: 4, maxBullets: 6 }, previousExperience: { preferredBullets: 2, maxBullets: 4 }, projects: { preferredCount: 2, maxCount: 3, preferredBullets: 3, maxBullets: 4 }, skills: { preferredCount: 16, maxCount: 24 }, certifications: { preferredCount: 3, maxCount: 5 }, achievements: { preferredCount: 2, maxCount: 4 } },
});

function layoutFor(recipe, atsPriority) {
  if (recipe.layout === 'single-column') return { type: 'single-column' };
  const ratio = atsPriority === 'high' ? Math.min(recipe.ratio || 0.3, 0.31) : (recipe.ratio || 0.32);
  if (recipe.layout === 'two-column') return { type: 'two-column', columns: [{ id: 'left', width: ratio }, { id: 'right', width: Number((1 - ratio).toFixed(2)) }] };
  return recipe.layout === 'sidebar-left'
    ? { type: 'sidebar-left', columns: [{ id: 'sidebar', width: ratio }, { id: 'main', width: Number((1 - ratio).toFixed(2)) }] }
    : { type: 'sidebar-right', columns: [{ id: 'main', width: Number((1 - ratio).toFixed(2)) }, { id: 'sidebar', width: ratio }] };
}

function placementFor(recipe) {
  if (recipe.layout === 'single-column') return {};
  const railId = recipe.layout === 'two-column' ? 'left' : 'sidebar';
  const mainId = recipe.layout === 'two-column' ? 'right' : 'main';
  const rail = new Set(recipe.rail || ['skills', 'certifications', 'education']);
  return Object.fromEntries(FULL_SECTIONS.map((key) => [key, rail.has(key) ? { region: railId, fallback: mainId } : { region: mainId, fallback: railId }]));
}

function stylePreferenceBoost(goal, recipe) {
  const style = String(goal.visualStyle || '').toLowerCase();
  let boost = 0;
  if (/minimal|clean|ats/.test(style) && recipe.layout === 'single-column') boost += 5;
  if (/editorial|classic|serif/.test(style) && /editorial|classic|executive/.test(`${recipe.header} ${recipe.typo}`)) boost += 5;
  if (/technical|engineering|cloud/.test(style) && /technical|cloud/.test(`${recipe.header} ${recipe.experience}`)) boost += 5;
  if (/corporate|business/.test(style) && /corporate|professional/.test(`${recipe.header} ${recipe.layout}`)) boost += 4;
  return boost;
}

function definitionFor({ goal, family, archetypeId, variant = 0 }) {
  const recipe = ARCHETYPES[archetypeId];
  const stage = normalizeCareerStage(goal.careerStage || 'mid');
  const colors = recipe.colors || ['slate'];
  const color = colors[variant % colors.length];
  const role = (goal.targetRoles || ['professional'])[0];
  const layout = layoutFor(recipe, goal.atsPriority || 'high');
  const density = goal.density || 'balanced';
  const id = `gen-${slug(role)}-${archetypeId}-${variant + 1}`;
  const nameStem = archetypeId.split('-').map((x) => x[0].toUpperCase() + x.slice(1)).join(' ');
  const budget = stage === 'student' || stage === 'early' ? BUDGETS.student : stage === 'executive' ? BUDGETS.executive : BUDGETS.default;
  const studentOrder = ['summary', 'education', 'projects', 'skills', 'experience', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages', 'customSections'];
  const sectionOrder = stage === 'student' || stage === 'early' ? (archetypeId.startsWith('student-') || archetypeId === 'project-narrative' ? recipe.order : studentOrder) : (recipe.order || FULL_SECTIONS);
  return {
    dslVersion: TEMPLATE_DSL_VERSION,
    id,
    name: `${nameStem} ${variant + 1}`,
    version: 1,
    status: 'GENERATED',
    category: family.category,
    description: `Deterministic ${nameStem.toLowerCase()} candidate for ${role}; structurally generated from approved Template OS primitives.`,
    tags: [...(goal.targetRoles || []), family.id, archetypeId, goal.visualStyle || ''].filter(Boolean),
    supportedRoles: goal.targetRoles || [],
    careerStages: [stage],
    layout,
    sectionPlacement: placementFor(recipe),
    sectionOrder,
    headerStyle: { primitive: recipe.header },
    skillStyle: { primitive: recipe.skills },
    experienceStyle: { primitive: recipe.experience },
    projectStyle: { primitive: recipe.projects },
    ...(recipe.education ? { educationStyle: { primitive: recipe.education } } : {}),
    sectionStyles: { divider: goal.atsPriority === 'high' && recipe.divider === 'accent-rule' ? 'hairline' : recipe.divider },
    visualStyle: { ...(recipe.visual || {}) },
    typography: { preset: recipe.typo },
    spacing: { preset: density },
    colors: { preset: color },
    contentBudget: JSON.parse(JSON.stringify(budget)),
    exports: { pdf: true, html: true, txt: true, docx: true, docxProfile: layout.type === 'single-column' ? 'native' : 'simplified-single-column' },
    license: { licenseStatus: 'INTERNAL_ORIGINAL', source: 'Template OS deterministic generator', licenseName: '', licenseNotice: '', productionEnabled: false },
  };
}

export function templateStructuralSignature(def = {}) {
  const columns = (def.layout?.columns || []).map((c) => `${c.id}:${Number(c.width || 0).toFixed(2)}`).join('|');
  const placement = Object.entries(def.sectionPlacement || {}).map(([k, v]) => `${k}:${typeof v === 'string' ? v : v?.region || ''}`).sort().join('|');
  return [
    def.layout?.type || '', columns, def.headerStyle?.primitive || '', def.skillStyle?.primitive || '',
    def.experienceStyle?.primitive || '', def.projectStyle?.primitive || '', def.educationStyle?.primitive || '',
    def.sectionStyles?.divider || '', def.typography?.preset || '', def.colors?.preset || '',
    (def.sectionOrder || []).slice(0, 7).join('>'), placement,
    def.visualStyle?.sidebarPanel || '', def.visualStyle?.columnTreatment || '', def.visualStyle?.singleColumnTreatment || '',
  ].join('::');
}

export function templateStructuralDistance(a, b) {
  const A = templateStructuralSignature(a).split('::');
  const B = templateStructuralSignature(b).split('::');
  const n = Math.max(A.length, B.length);
  let different = 0;
  for (let i = 0; i < n; i += 1) if ((A[i] || '') !== (B[i] || '')) different += 1;
  return Number((different / Math.max(1, n)).toFixed(3));
}

function qualityScore(def, cert, goal) {
  let score = cert.minIntegrity * 0.34 + cert.minOrderScore * 0.28 + cert.scorecard.fitReliability * 0.18 + (cert.certified ? 10 : 0);
  if (goal.atsPriority === 'high' && ['VERY_HIGH', 'HIGH'].includes(cert.atsLevel)) score += 6;
  if (goal.layoutPreference === 'sidebar' && def.layout.type.startsWith('sidebar')) score += 6;
  if (goal.layoutPreference === 'single-column' && def.layout.type === 'single-column') score += 6;
  if (goal.layoutPreference === 'two-column' && def.layout.type === 'two-column') score += 6;
  return score;
}

function noveltySelect(scored, limit) {
  const pool = [...scored].sort((a, b) => b.quality - a.quality || a.def.id.localeCompare(b.def.id));
  const picked = [];
  while (pool.length && picked.length < limit) {
    let bestIdx = 0;
    let bestRank = -Infinity;
    const usedArchetypes = new Set(picked.map((p) => p.archetype));
    const hasUnseenArchetype = pool.some((c) => !usedArchetypes.has(c.archetype));
    for (let i = 0; i < pool.length; i += 1) {
      const c = pool[i];
      /* Prefer a new structural archetype before generating a second cosmetic
         variant of an archetype already represented in this result set. */
      if (hasUnseenArchetype && usedArchetypes.has(c.archetype)) continue;
      const nearest = picked.length ? Math.min(...picked.map((p) => templateStructuralDistance(c.def, p.def))) : 1;
      /* Maximum-marginal-relevance style scoring. Quality remains dominant,
         but near-duplicate candidates pay a visible penalty. */
      const rank = c.quality * 0.78 + nearest * 22 + c.styleBoost;
      if (rank > bestRank || (rank === bestRank && c.def.id < pool[bestIdx].def.id)) { bestRank = rank; bestIdx = i; }
    }
    const [chosen] = pool.splice(bestIdx, 1);
    const nearest = picked.length ? Math.min(...picked.map((p) => templateStructuralDistance(chosen.def, p.def))) : 1;
    picked.push({ ...chosen, diversityScore: Math.round(nearest * 100), score: Math.min(100, Math.round(bestRank)) });
  }
  return picked;
}

export function generateTemplateCandidates(goal = {}, { limit = 12 } = {}) {
  const normalizedGoal = {
    targetRoles: Array.isArray(goal.targetRoles) ? goal.targetRoles.filter(Boolean).slice(0, 6) : [],
    visualStyle: goal.visualStyle || '',
    atsPriority: goal.atsPriority || 'high',
    layoutPreference: goal.layoutPreference || null,
    careerStage: normalizeCareerStage(goal.careerStage || 'mid'),
    density: goal.density || 'balanced',
  };
  const family = familyFor(normalizedGoal.targetRoles);
  let archetypes = [...family.archetypes];
  if (normalizedGoal.layoutPreference) {
    const wanted = normalizedGoal.layoutPreference === 'sidebar' ? 'sidebar' : normalizedGoal.layoutPreference;
    archetypes = [...archetypes.filter((id) => wanted === 'sidebar' ? ARCHETYPES[id].layout.startsWith('sidebar') : ARCHETYPES[id].layout === wanted), ...archetypes];
  }
  archetypes = [...new Set(archetypes)];

  const candidates = [];
  for (const archetypeId of archetypes) {
    for (let variant = 0; variant < 2; variant += 1) {
      const def = definitionFor({ goal: normalizedGoal, family, archetypeId, variant });
      const validation = validateTemplateDefinition(def, { primitives: PRIMITIVES });
      if (!validation.ok) continue;
      const cert = certifyDefinition(def, { sizeIds: ['a4'] });
      if (!cert.ok || cert.minIntegrity < 80) continue;
      candidates.push({
        def: { ...def, atsLevel: cert.atsLevel, certification: { certified: cert.certified, minIntegrity: cert.minIntegrity, minOrderScore: cert.minOrderScore, label: cert.label } },
        cert,
        archetype: archetypeId,
        quality: qualityScore(def, cert, normalizedGoal),
        styleBoost: stylePreferenceBoost(normalizedGoal, ARCHETYPES[archetypeId]),
      });
    }
  }

  const ranked = noveltySelect(candidates, Math.max(1, Math.min(12, Number(limit) || 6)))
    .map((c) => ({
      ...c,
      rationale: `${c.archetype.replace(/-/g, ' ')} · ${c.def.layout.type} · ${c.def.headerStyle.primitive} header · ${c.def.skillStyle.primitive} skills`,
      signature: templateStructuralSignature(c.def),
    }));

  const pairDistances = [];
  for (let i = 0; i < ranked.length; i += 1) for (let j = i + 1; j < ranked.length; j += 1) pairDistances.push(templateStructuralDistance(ranked[i].def, ranked[j].def));
  const diversity = {
    version: TEMPLATE_GENERATOR_DIVERSITY_VERSION,
    uniqueArchetypes: new Set(ranked.map((c) => c.archetype)).size,
    uniqueLayouts: new Set(ranked.map((c) => c.def.layout.type)).size,
    minPairDistance: pairDistances.length ? Number(Math.min(...pairDistances).toFixed(3)) : 1,
    avgPairDistance: pairDistances.length ? Number((pairDistances.reduce((a, b) => a + b, 0) / pairDistances.length).toFixed(3)) : 1,
  };

  return { version: TEMPLATE_SYNTHESIS_VERSION, goal: normalizedGoal, family: family.id, generated: candidates.length, kept: ranked.length, diversity, candidates: ranked };
}

export default { TEMPLATE_SYNTHESIS_VERSION, TEMPLATE_GENERATOR_DIVERSITY_VERSION, generateTemplateCandidates, templateStructuralSignature, templateStructuralDistance };
