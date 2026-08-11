/* ============================================================
   CONTENT BUDGET + AUTO-FIT — Resume OS V4
   ------------------------------------------------------------
   Every template carries a content capacity contract (budget).
   planContentBudget() turns a relevance ranking into a concrete,
   explainable selection plan that honors the contract.
   buildAutoFitPlan() resolves overflow in a FIXED deterministic
   order that removes the least valuable content first and only
   then touches layout — with hard readability floors. It NEVER
   silently deletes: every step is a decision with a reason that
   the UI shows and the user can reject.
   ============================================================ */
import { normalizeResumeDocument } from './resumeDocument.js';

export const CONTENT_BUDGET_VERSION = 'content-budget-v2-template-contract';
export const AUTO_FIT_VERSION = 'auto-fit-v1';

/* Hard floors — auto-fit may NEVER go below these. */
export const FIT_FLOORS = Object.freeze({
  bodyFontPx: 9.5,
  lineHeight: 1.18,
  marginMm: 10,
});

/* Category defaults; template descriptors may override any field. */
export const DEFAULT_BUDGETS = Object.freeze({
  'ats-strict':   { summary: { preferredLines: 3, maxLines: 4 }, currentExperience: { preferredBullets: 4, maxBullets: 5 }, previousExperience: { preferredBullets: 2, maxBullets: 3 }, projects: { preferredCount: 2, maxCount: 3, preferredBullets: 2, maxBullets: 3 }, skills: { preferredCount: 15, maxCount: 24 }, certifications: { preferredCount: 3, maxCount: 6 }, achievements: { preferredCount: 3, maxCount: 5 } },
  professional:   { summary: { preferredLines: 3, maxLines: 4 }, currentExperience: { preferredBullets: 4, maxBullets: 6 }, previousExperience: { preferredBullets: 3, maxBullets: 4 }, projects: { preferredCount: 2, maxCount: 3, preferredBullets: 2, maxBullets: 3 }, skills: { preferredCount: 16, maxCount: 26 }, certifications: { preferredCount: 4, maxCount: 8 }, achievements: { preferredCount: 3, maxCount: 6 } },
  tech:           { summary: { preferredLines: 2, maxLines: 3 }, currentExperience: { preferredBullets: 4, maxBullets: 6 }, previousExperience: { preferredBullets: 2, maxBullets: 4 }, projects: { preferredCount: 3, maxCount: 4, preferredBullets: 2, maxBullets: 3 }, skills: { preferredCount: 18, maxCount: 28 }, certifications: { preferredCount: 4, maxCount: 8 }, achievements: { preferredCount: 2, maxCount: 4 } },
  student:        { summary: { preferredLines: 2, maxLines: 3 }, currentExperience: { preferredBullets: 3, maxBullets: 4 }, previousExperience: { preferredBullets: 2, maxBullets: 3 }, projects: { preferredCount: 3, maxCount: 5, preferredBullets: 3, maxBullets: 4 }, skills: { preferredCount: 14, maxCount: 22 }, certifications: { preferredCount: 4, maxCount: 8 }, achievements: { preferredCount: 4, maxCount: 8 } },
  executive:      { summary: { preferredLines: 4, maxLines: 5 }, currentExperience: { preferredBullets: 5, maxBullets: 7 }, previousExperience: { preferredBullets: 3, maxBullets: 5 }, projects: { preferredCount: 1, maxCount: 2, preferredBullets: 2, maxBullets: 3 }, skills: { preferredCount: 12, maxCount: 18 }, certifications: { preferredCount: 3, maxCount: 6 }, achievements: { preferredCount: 4, maxBullets: 6, maxCount: 6 } },
});

const CATEGORY_ALIASES = Object.freeze({
  ats: 'ats-strict',
  'ats-strict': 'ats-strict',
  technical: 'tech',
  tech: 'tech',
  professional: 'professional',
  student: 'student',
  executive: 'executive',
});

function templateCategory(template) {
  return CATEGORY_ALIASES[String(template?.category || template?.definition?.category || '').toLowerCase()] || 'professional';
}

function rawTemplateBudget(template) {
  const direct = template?.contentBudget;
  if (direct && typeof direct === 'object') return direct;
  const nested = template?.definition?.contentBudget;
  return nested && typeof nested === 'object' ? nested : {};
}

function positiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function normalizeBudgetPart(base = {}, override = {}) {
  const out = { ...base };
  for (const [k, raw] of Object.entries(override || {})) {
    const n = positiveNumber(raw);
    if (n !== undefined) out[k] = n;
  }
  /* An imported descriptor should never be able to make a preferred allowance
     larger than the corresponding hard max. Correct it deterministically rather
     than letting an inconsistent budget produce surprising selection. */
  if (Number.isFinite(out.preferredCount) && Number.isFinite(out.maxCount)) out.preferredCount = Math.min(out.preferredCount, out.maxCount);
  if (Number.isFinite(out.preferredBullets) && Number.isFinite(out.maxBullets)) out.preferredBullets = Math.min(out.preferredBullets, out.maxBullets);
  if (Number.isFinite(out.preferredLines) && Number.isFinite(out.maxLines)) out.preferredLines = Math.min(out.preferredLines, out.maxLines);
  return out;
}

export function budgetForTemplate(template) {
  const category = templateCategory(template);
  const base = DEFAULT_BUDGETS[category] || DEFAULT_BUDGETS.professional;
  const override = rawTemplateBudget(template);
  const merged = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(override)])) {
    merged[k] = normalizeBudgetPart(base[k] || {}, override[k] || {});
  }
  return merged;
}

function templateDefinition(template) { return template?.definition || template || {}; }

function regionWidthForSection(template, section = 'summary') {
  const def = templateDefinition(template);
  const layout = def.layout || {};
  if (!layout.type || layout.type === 'single-column') return 1;
  const placement = def.sectionPlacement?.[section];
  const region = typeof placement === 'string' ? placement : placement?.region;
  const col = (layout.columns || []).find((c) => c.id === region);
  return Number.isFinite(Number(col?.width)) ? Number(col.width) : 0.68;
}

/* Convert a line budget into a conservative deterministic character budget.
   This is not pagination; it only keeps generated summaries inside the visual
   capacity of the selected region before the real layout/auto-fit pass. */
export function summaryCapacityForTemplate(template, budget, { pageTarget = 1, currentText = '' } = {}) {
  const twoPage = Number(pageTarget) >= 2;
  const summary = budget?.summary || {};
  const lines = Number(twoPage ? summary.maxLines : summary.preferredLines) || 3;
  const explicit = Number(twoPage ? summary.maxChars : summary.preferredChars);
  const width = Math.max(0.45, Math.min(1, regionWidthForSection(template, 'summary')));
  const charsPerLine = Math.max(48, Math.round(108 * width));
  const maxChars = Number.isFinite(explicit) && explicit > 0
    ? Math.round(explicit)
    : Math.max(180, Math.round(lines * charsPerLine));
  const currentChars = String(currentText || '').trim().length;
  return { lines, maxChars, charsPerLine, regionWidth: Number(width.toFixed(3)), currentChars, overBudget: currentChars > maxChars };
}

/* ------------------------------------------------------------------ */
/* Selection plan: ranking → per-item bullet selection + counts,       */
/* expressed as non-destructive overrides + reasons.                   */
/* ------------------------------------------------------------------ */
export function planContentBudget(doc, ranking, template, { pageTarget = 1 } = {}) {
  const d = normalizeResumeDocument(doc);
  const budget = budgetForTemplate(template);
  /* On a 2-page target everything gets the MAX allowance; on 1 page the
     preferred allowance. Deterministic, no measurement needed here —
     the layout engine + auto-fit close the loop afterwards. */
  const allowBullets = (b) => (pageTarget >= 2 ? b?.maxBullets : b?.preferredBullets);
  const allowCount = (b) => (pageTarget >= 2 ? b?.maxCount : b?.preferredCount);
  const twoPage = pageTarget >= 2;
  const decisions = [];
  const bulletIds = {};
  const disabledSet = new Set();
  const summary = summaryCapacityForTemplate(template, budget, { pageTarget, currentText: d.summary });

  if (summary.overBudget) {
    decisions.push({
      action: 'summary_over_budget', section: 'summary',
      reason: `Budget: ${template?.name || 'this template'} targets about ${summary.lines} summary line(s) (${summary.maxChars} characters in its ${Math.round(summary.regionWidth * 100)}% content region); the current summary is ${summary.currentChars} characters. Tailor for Job may propose a shorter deterministic summary from confirmed facts.`,
    });
  }

  const bulletValue = new Map((ranking?.bullets || []).map((b) => [b.bulletId, b]));
  const projectValue = new Map((ranking?.projects || []).map((p) => [p.itemId || p.projectId, p]));

  /* experience: newest/currently supplied role gets currentExperience budget,
     rest previous. ResumeDocument order is intentionally preserved. */
  d.experience.filter((e) => e.enabled).forEach((e, idx) => {
    const b = idx === 0 ? budget.currentExperience : budget.previousExperience;
    const cap = allowBullets(b) ?? 4;
    const ordered = [...e.bullets.filter((x) => x.enabled)]
      .sort((a, z) => (bulletValue.get(z.id)?.value ?? 0) - (bulletValue.get(a.id)?.value ?? 0));
    if (ordered.length > cap) {
      const keep = ordered.slice(0, cap).map((x) => x.id);
      bulletIds[e.id] = keep;
      for (const cut of ordered.slice(cap)) {
        decisions.push({
          action: 'trim_bullet', section: 'experience', itemId: e.id, bulletId: cut.id,
          reason: `Budget: ${idx === 0 ? 'current' : 'previous'} role allows ${cap} bullet(s) on a ${pageTarget}-page ${template?.name || 'template'}; this one ranked ${ordered.indexOf(cut) + 1}/${ordered.length} (${bulletValue.get(cut.id)?.reasons?.[0] || 'lower relevance'}).`,
        });
      }
    }
  });

  /* projects: keep the top N by ranked value */
  const projCap = allowCount(budget.projects) ?? 2;
  const enabledProjects = d.projects.filter((p) => p.enabled)
    .sort((a, z) => (projectValue.get(z.id)?.value ?? 0) - (projectValue.get(a.id)?.value ?? 0));
  enabledProjects.forEach((p, idx) => {
    if (idx >= projCap) {
      disabledSet.add(p.id);
      decisions.push({ action: 'hide_project', section: 'projects', itemId: p.id, reason: `Budget: ${template?.name || 'this template'} shows ${projCap} project(s) on ${pageTarget} page(s); "${p.name}" ranked ${idx + 1} (${projectValue.get(p.id)?.reasons?.[0] || projectValue.get(p.id)?.reason || 'lower relevance to target'}).` });
      return;
    }
    const cap = (twoPage ? budget.projects?.maxBullets : budget.projects?.preferredBullets) ?? 2;
    const ordered = [...p.bullets.filter((x) => x.enabled)]
      .sort((a, z) => (bulletValue.get(z.id)?.value ?? 0) - (bulletValue.get(a.id)?.value ?? 0));
    if (ordered.length > cap) {
      bulletIds[p.id] = ordered.slice(0, cap).map((x) => x.id);
      for (const cut of ordered.slice(cap)) decisions.push({ action: 'trim_bullet', section: 'projects', itemId: p.id, bulletId: cut.id, reason: `Budget: ${cap} project bullet(s) fit the selected ${template?.name || 'template'} at this page target.` });
    }
  });

  /* skills: cap by ranked target relevance */
  const skillCap = (twoPage ? budget.skills?.maxCount : budget.skills?.preferredCount) ?? 16;
  const skillValue = new Map((ranking?.skills || []).map((s) => [s.itemId || s.skillId, s]));
  const enabledSkills = d.skills.filter((s) => s.enabled)
    .sort((a, z) => (skillValue.get(z.id)?.value ?? 0) - (skillValue.get(a.id)?.value ?? 0));
  enabledSkills.forEach((s, idx) => {
    if (idx >= skillCap) {
      disabledSet.add(s.id);
      decisions.push({ action: 'hide_skill', section: 'skills', itemId: s.id, reason: `Budget: ${skillCap} skills fit ${template?.name || 'this layout'}; "${s.name}" ranked ${idx + 1} for the target.` });
    }
  });

  /* certifications: role-relevant credentials survive first. When the ranking
     engine does not provide credential scores (older clients/tests), preserve
     document order and trim only the tail. */
  const certCap = (twoPage ? budget.certifications?.maxCount : budget.certifications?.preferredCount) ?? d.certifications.length;
  const certValue = new Map((ranking?.certifications || []).map((x) => [x.itemId || x.certificationId, x]));
  const certOrder = new Map(d.certifications.map((x, i) => [x.id, i]));
  const enabledCerts = d.certifications.filter((x) => x.enabled)
    .sort((a, z) => (certValue.get(z.id)?.value ?? 0) - (certValue.get(a.id)?.value ?? 0) || (certOrder.get(a.id) ?? 0) - (certOrder.get(z.id) ?? 0));
  enabledCerts.forEach((item, idx) => {
    if (idx >= certCap) {
      disabledSet.add(item.id);
      decisions.push({ action: 'hide_certification', section: 'certifications', itemId: item.id, reason: `Budget: ${template?.name || 'this template'} allocates ${certCap} certification slot(s) on ${pageTarget} page(s); "${item.text}" ranked ${idx + 1}.` });
    }
  });

  /* achievements: quantified and target-relevant impact ranks ahead of generic
     awards/statements, but no new wording or claims are created. */
  const achievementCap = (twoPage ? budget.achievements?.maxCount : budget.achievements?.preferredCount) ?? d.achievements.length;
  const achievementValue = new Map((ranking?.achievements || []).map((x) => [x.itemId || x.achievementId, x]));
  const achievementOrder = new Map(d.achievements.map((x, i) => [x.id, i]));
  const enabledAchievements = d.achievements.filter((x) => x.enabled)
    .sort((a, z) => (achievementValue.get(z.id)?.value ?? 0) - (achievementValue.get(a.id)?.value ?? 0) || (achievementOrder.get(a.id) ?? 0) - (achievementOrder.get(z.id) ?? 0));
  enabledAchievements.forEach((item, idx) => {
    if (idx >= achievementCap) {
      disabledSet.add(item.id);
      decisions.push({ action: 'hide_achievement', section: 'achievements', itemId: item.id, reason: `Budget: ${template?.name || 'this template'} allocates ${achievementCap} achievement slot(s) on ${pageTarget} page(s); this item ranked ${idx + 1} for the target.` });
    }
  });

  return {
    version: CONTENT_BUDGET_VERSION,
    budget, pageTarget, summary,
    overrides: { bulletIds, disabled: [...disabledSet] },
    decisions,
    source: rawTemplateBudget(template) && Object.keys(rawTemplateBudget(template)).length ? 'template-contract' : `category:${templateCategory(template)}`,
  };
}

/* ------------------------------------------------------------------ */
/* Auto-fit: given a measured overflow (from the layout engine), emit  */
/* the next deterministic step. Content value first, layout last.      */
/* ------------------------------------------------------------------ */
export const AUTO_FIT_ORDER = Object.freeze([
  'remove_exact_duplicates',
  'drop_lowest_value_optional_skills',
  'drop_lowest_value_optional_project',
  'trim_low_value_project_bullets',
  'trim_older_role_bullets',
  'compact_density',          // comfortable → compact → tight (existing engine)
  'reduce_margins_safely',
  'reduce_line_height_safely',
  'reduce_font_within_floor',
  'allow_second_page',
]);

export function buildAutoFitPlan({ overflowLines = 0, density = 'comfortable', pageTarget = 1, duplicates = [], ranking = null, doc = null, budgetPlan = null }) {
  const steps = [];
  if (overflowLines <= 0) return { version: AUTO_FIT_VERSION, fits: true, steps };

  if (duplicates.length) {
    steps.push({ step: 'remove_exact_duplicates', detail: `${duplicates.length} duplicate bullet(s) found — removing repeats costs nothing.`, targets: duplicates.map((x) => x.b?.id).filter(Boolean) });
  }
  if (doc && ranking) {
    const d = normalizeResumeDocument(doc);
    const already = new Set(budgetPlan?.overrides?.disabled || []);
    const skillValue = new Map((ranking.skills || []).map((s) => [s.itemId, s.value]));
    const cutSkills = d.skills.filter((s) => s.enabled && !already.has(s.id))
      .sort((a, b) => (skillValue.get(a.id) ?? 0) - (skillValue.get(b.id) ?? 0)).slice(0, 4);
    if (cutSkills.length) steps.push({ step: 'drop_lowest_value_optional_skills', detail: `Lowest-relevance skills for this target: ${cutSkills.map((s) => s.name).join(', ')}.`, targets: cutSkills.map((s) => s.id) });
    const projValue = new Map((ranking.projects || []).map((p) => [p.itemId, p.value]));
    const cutProj = d.projects.filter((p) => p.enabled && !already.has(p.id) && !p.verified)
      .sort((a, b) => (projValue.get(a.id) ?? 0) - (projValue.get(b.id) ?? 0))[0];
    if (cutProj) steps.push({ step: 'drop_lowest_value_optional_project', detail: `"${cutProj.name}" is the least relevant unverified project.`, targets: [cutProj.id] });
    const bulletValue = new Map((ranking.bullets || []).map((b) => [b.bulletId, b.value]));
    const olderCuts = d.experience.filter((e) => e.enabled).slice(1)
      .flatMap((e) => e.bullets.filter((b) => b.enabled).map((b) => ({ e, b, v: bulletValue.get(b.id) ?? 0 })))
      .sort((a, b) => a.v - b.v).slice(0, 3);
    if (olderCuts.length) steps.push({ step: 'trim_older_role_bullets', detail: 'Oldest roles carry the least screening weight — trim there first.', targets: olderCuts.map((x) => x.b.id) });
  }
  if (density === 'comfortable') steps.push({ step: 'compact_density', detail: 'Step density comfortable → compact (no font change).', to: 'compact' });
  else if (density === 'compact') steps.push({ step: 'compact_density', detail: 'Step density compact → tight (still above readability floors).', to: 'tight' });
  steps.push({ step: 'reduce_margins_safely', detail: `Margins may shrink to ${FIT_FLOORS.marginMm}mm, never below.`, floor: FIT_FLOORS.marginMm });
  steps.push({ step: 'reduce_line_height_safely', detail: `Line-height floor ${FIT_FLOORS.lineHeight}.`, floor: FIT_FLOORS.lineHeight });
  steps.push({ step: 'reduce_font_within_floor', detail: `Body font floor ${FIT_FLOORS.bodyFontPx}px — auto-fit never crosses it.`, floor: FIT_FLOORS.bodyFontPx });
  if (pageTarget === 1) steps.push({ step: 'allow_second_page', detail: 'Remaining content is high-value — a clean second page beats an unreadable single page.' });

  return { version: AUTO_FIT_VERSION, fits: false, order: AUTO_FIT_ORDER, steps };
}

export default { CONTENT_BUDGET_VERSION, AUTO_FIT_VERSION, FIT_FLOORS, DEFAULT_BUDGETS, budgetForTemplate, summaryCapacityForTemplate, planContentBudget, buildAutoFitPlan, AUTO_FIT_ORDER };
