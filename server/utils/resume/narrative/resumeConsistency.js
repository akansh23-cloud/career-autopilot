/* ============================================================
   RESUME-LEVEL RERANKING + CONSISTENCY (stage 11b)
   ------------------------------------------------------------
   Bullets optimised independently produce a document that is
   locally excellent and globally awful: five sentences that each
   scored well and all start with "Built".

   This pass looks at the WHOLE resume and repairs:

     • lead-verb repetition
     • structural repetition (same syntactic shape)
     • duplicated / near-duplicate achievements
     • over-repeated technologies
     • keyword stuffing
     • excessive metric density
     • tense inconsistency (current role vs past roles)
     • seniority inconsistency
     • terminology inconsistency (K8s / k8s / Kubernetes)
     • length monotony (all short or all long)
     • JD-critical content buried at the bottom

   REPAIR PHILOSOPHY: substitute from the ALREADY-VALIDATED
   candidate pool for that same evidence unit. We never invent a
   replacement and never reach for a thesaurus — if no validated
   alternative exists, the repetition is reported rather than
   "fixed" with a worse sentence.
   ============================================================ */
import { bulletSimilarity, findDuplicateBullets } from '../textQualityEngines.js';
import { canonicalSkill } from '../skillOntology.js';
import { skillPresent } from '../skillMatcher.js';
import { shapeOf } from './bulletScoring.js';

export const RESUME_CONSISTENCY_VERSION = 'resume-consistency-v1';

const leadVerbOf = (t) => String(t || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z-]/g, '');

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */
export function detectDocumentIssues(selections, { jobIntel = null, seniority = 'mid' } = {}) {
  const issues = [];
  const texts = selections.map((s) => s.chosen.text);

  /* ---- lead verb repetition ---- */
  const verbCounts = new Map();
  selections.forEach((s, i) => {
    const v = leadVerbOf(s.chosen.text);
    if (!v) return;
    if (!verbCounts.has(v)) verbCounts.set(v, []);
    verbCounts.get(v).push(i);
  });
  for (const [verb, idxs] of verbCounts.entries()) {
    if (idxs.length >= 3) {
      issues.push({
        code: 'lead_verb_repetition', severity: idxs.length >= 4 ? 'high' : 'medium',
        detail: `"${verb}" opens ${idxs.length} bullets.`,
        indices: idxs.slice(1), verb,
      });
    }
  }

  /* ---- structural repetition ---- */
  const shapes = new Map();
  selections.forEach((s, i) => {
    const sh = shapeOf(s.chosen.text);
    if (!shapes.has(sh)) shapes.set(sh, []);
    shapes.get(sh).push(i);
  });
  for (const [shape, idxs] of shapes.entries()) {
    if (idxs.length >= 3) {
      issues.push({
        code: 'structural_repetition', severity: 'medium',
        detail: `${idxs.length} bullets share the same sentence structure.`,
        indices: idxs.slice(1), shape,
      });
    }
  }

  /* ---- duplicate / near-duplicate achievements ---- */
  const dup = findDuplicateBullets(selections.map((s, i) => ({ id: String(i), text: s.chosen.text })), { near: 0.7 });
  for (const d of dup.exact) {
    issues.push({ code: 'duplicate_bullet', severity: 'high', detail: 'Two bullets say the same thing.', indices: [Number(d.b.id)] });
  }
  for (const d of dup.near) {
    issues.push({ code: 'near_duplicate_bullet', severity: 'medium', detail: `Two bullets overlap ${Math.round(d.similarity * 100)}%.`, indices: [Number(d.b.id)], similarity: d.similarity });
  }

  /* ---- technology over-repetition ---- */
  const techCounts = new Map();
  for (const s of selections) {
    for (const t of s.evidence?.skillsDisplay || []) {
      if (skillPresent(s.chosen.text, t)) {
        const c = canonicalSkill(t);
        techCounts.set(c, (techCounts.get(c) || 0) + 1);
      }
    }
  }
  const bulletCount = selections.length || 1;
  for (const [tech, count] of techCounts.entries()) {
    if (count >= Math.max(5, Math.ceil(bulletCount * 0.6))) {
      issues.push({ code: 'technology_over_repetition', severity: 'medium', detail: `"${tech}" appears in ${count} of ${bulletCount} bullets.`, tech });
    }
  }

  /* ---- keyword stuffing against the JD ---- */
  if (jobIntel) {
    for (const p of (jobIntel.prioritySkills || []).slice(0, 15)) {
      const esc = p.skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'gi');
      const total = texts.join(' ').match(re)?.length || 0;
      if (total >= Math.max(6, bulletCount)) {
        issues.push({ code: 'keyword_stuffing', severity: 'high', detail: `"${p.skill}" appears ${total} times — a reader will notice before an ATS rewards it.`, skill: p.skill });
      }
    }
  }

  /* ---- metric density ---- */
  const withMetrics = selections.filter((s) => /\d/.test(s.chosen.text)).length;
  if (bulletCount >= 5 && withMetrics / bulletCount > 0.85) {
    issues.push({ code: 'excessive_metrics', severity: 'low', detail: 'Almost every bullet carries a number — the strong ones stop standing out.' });
  }

  /* ---- tense consistency ---- */
  const pastRe = /^(\w+ed|built|led|ran|wrote|made|drove|set|took|brought|kept|held|sent|met|dealt|grew|shipped|spent|left|paid)\b/i;
  const presentRe = /^(\w+s|manage|build|lead|run|own|maintain|support|develop|design|deliver)\b/i;
  for (const [i, s] of selections.entries()) {
    const isCurrent = !!s.evidence?.current;
    const t = s.chosen.text;
    if (!isCurrent && presentRe.test(t) && !pastRe.test(t)) {
      issues.push({ code: 'tense_inconsistency', severity: 'medium', detail: 'Past role written in present tense.', indices: [i] });
    }
  }

  /* ---- length monotony ---- */
  const lengths = selections.map((s) => s.chosen.text.split(/\s+/).length);
  if (lengths.length >= 4) {
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const sd = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length);
    if (sd < 2.2) {
      issues.push({ code: 'uniform_sentence_length', severity: 'low', detail: `Every bullet is ~${Math.round(mean)} words — real writing varies.` });
    }
    const long = lengths.filter((l) => l > 30).length;
    if (long >= Math.ceil(lengths.length * 0.5)) {
      issues.push({ code: 'too_many_long_bullets', severity: 'medium', detail: `${long} bullets exceed 30 words.` });
    }
    const short = lengths.filter((l) => l < 9).length;
    if (short >= Math.ceil(lengths.length * 0.5)) {
      issues.push({ code: 'too_many_short_bullets', severity: 'medium', detail: `${short} bullets are under 9 words and carry little evidence.` });
    }
  }

  /* ---- JD-critical content buried ---- */
  if (jobIntel) {
    const mandatory = (jobIntel.prioritySkills || []).filter((p) => p.tier === 'mandatory').slice(0, 6);
    for (const m of mandatory) {
      const firstAt = selections.findIndex((s) => skillPresent(s.chosen.text, m.skill));
      if (firstAt >= 0 && firstAt >= Math.max(5, Math.floor(bulletCount * 0.65))) {
        issues.push({
          code: 'critical_requirement_buried', severity: 'medium',
          detail: `"${m.skill}" is a mandatory requirement but first appears at bullet ${firstAt + 1}.`,
          skill: m.skill, index: firstAt,
        });
      }
    }
  }

  /* ---- seniority consistency ---- */
  const authority = /\b(architected|established|defined the|set the direction|led a team)\b/i;
  const junior = /\b(assisted|helped|shadowed|supported the team)\b/i;
  const authorityHits = texts.filter((t) => authority.test(t)).length;
  const juniorHits = texts.filter((t) => junior.test(t)).length;
  if (authorityHits && juniorHits && (seniority === 'senior' || seniority === 'executive')) {
    issues.push({ code: 'seniority_inconsistency', severity: 'low', detail: 'Mixes senior-authority and assistive language.' });
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* Terminology normalisation                                           */
/* ------------------------------------------------------------------ */
/**
 * Make one technology read the same way everywhere. The preferred form is the
 * candidate's own most frequent spelling — we normalise, we do not rename.
 */
export function normalizeTerminology(selections) {
  const forms = new Map(); // canonical -> Map(display -> count)
  const SURFACE_RE = /\b([A-Za-z][A-Za-z0-9.+#/-]{1,24})\b/g;

  for (const s of selections) {
    for (const display of s.evidence?.skillsDisplay || []) {
      const c = canonicalSkill(display);
      if (!forms.has(c)) forms.set(c, new Map());
      const m = forms.get(c);
      for (const match of String(s.chosen.text).matchAll(SURFACE_RE)) {
        if (canonicalSkill(match[1]) === c) m.set(match[1], (m.get(match[1]) || 0) + 1);
      }
    }
  }

  const preferred = new Map();
  for (const [c, m] of forms.entries()) {
    if (m.size <= 1) continue;
    const best = [...m.entries()].sort((a, b) => b[1] - a[1]
      || (/[A-Z]/.test(a[0]) ? -1 : 1)     // prefer the capitalised proper form
      || a[0].localeCompare(b[0]))[0];
    if (best) preferred.set(c, best[0]);
  }

  const changes = [];
  const next = selections.map((s) => {
    let text = s.chosen.text;
    for (const [c, pref] of preferred.entries()) {
      for (const match of [...String(text).matchAll(SURFACE_RE)]) {
        const surface = match[1];
        if (surface !== pref && canonicalSkill(surface) === c) {
          text = text.replace(new RegExp(`(?<![\\w-])${surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g'), pref);
          changes.push({ from: surface, to: pref, evidenceId: s.evidence?.id });
        }
      }
    }
    return text === s.chosen.text ? s : { ...s, chosen: { ...s.chosen, text } };
  });

  return { selections: next, changes };
}

/* ------------------------------------------------------------------ */
/* Repair                                                              */
/* ------------------------------------------------------------------ */
/**
 * Repair repetition by swapping in the next-best VALIDATED candidate for the
 * offending unit. Never fabricates a replacement.
 *
 * @param {Array} selections  [{ evidence, chosen, ranked:[...] }]
 */
export function repairDocument(selections, { jobIntel = null, seniority = 'mid', maxPasses = 3 } = {}) {
  let current = selections.map((s) => ({ ...s }));
  const applied = [];
  let issues = detectDocumentIssues(current, { jobIntel, seniority });

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const repairable = issues.filter((i) => ['lead_verb_repetition', 'structural_repetition', 'near_duplicate_bullet', 'duplicate_bullet', 'tense_inconsistency'].includes(i.code));
    if (!repairable.length) break;
    let changed = false;

    for (const issue of repairable) {
      for (const idx of issue.indices || []) {
        const sel = current[idx];
        if (!sel || !Array.isArray(sel.ranked) || sel.ranked.length < 2) continue;
        const currentText = sel.chosen.text;
        const currentVerb = leadVerbOf(currentText);
        const currentShape = shapeOf(currentText);

        const usedVerbs = new Set(current.map((s, i) => (i === idx ? '' : leadVerbOf(s.chosen.text))).filter(Boolean));
        const usedShapes = new Set(current.map((s, i) => (i === idx ? '' : shapeOf(s.chosen.text))).filter(Boolean));

        /* Best alternative that fixes the specific problem without creating a
           new one, and without losing more than a modest amount of score. */
        const alt = sel.ranked.find((c) => {
          if (c.text === currentText) return false;
          if (c.finalScore <= 0) return false;
          if (c.finalScore < sel.chosen.finalScore - 14) return false;
          if (issue.code === 'lead_verb_repetition') {
            const v = leadVerbOf(c.text);
            return v && v !== currentVerb && !usedVerbs.has(v);
          }
          if (issue.code === 'structural_repetition') {
            const sh = shapeOf(c.text);
            return sh !== currentShape && !usedShapes.has(sh);
          }
          if (issue.code === 'tense_inconsistency') {
            return /^(\w+ed|built|led|ran|wrote|made|drove|set|took|shipped)\b/i.test(c.text);
          }
          /* duplicates: anything sufficiently different */
          return current.every((s, i) => i === idx || bulletSimilarity(c.text, s.chosen.text) < 0.6);
        });

        if (alt) {
          applied.push({
            index: idx, code: issue.code,
            from: currentText, to: alt.text,
            scoreDelta: Number((alt.finalScore - sel.chosen.finalScore).toFixed(2)),
            reason: repairReason(issue.code, issue),
          });
          current[idx] = { ...sel, chosen: alt, repaired: true };
          changed = true;
        }
      }
    }
    if (!changed) break;
    issues = detectDocumentIssues(current, { jobIntel, seniority });
  }

  const term = normalizeTerminology(current);
  current = term.selections;
  const finalIssues = detectDocumentIssues(current, { jobIntel, seniority });

  /* Redundancy score per bullet — max similarity to any other chosen bullet. */
  current = current.map((s, i) => {
    let maxSim = 0;
    for (const [k, other] of current.entries()) {
      if (k === i) continue;
      maxSim = Math.max(maxSim, bulletSimilarity(s.chosen.text, other.chosen.text));
    }
    return {
      ...s,
      chosen: {
        ...s.chosen,
        metadata: { ...(s.chosen.metadata || {}), redundancyScore: Number(maxSim.toFixed(3)) },
      },
    };
  });

  return {
    version: RESUME_CONSISTENCY_VERSION,
    selections: current,
    repairs: applied,
    terminologyChanges: term.changes,
    issuesBefore: issues.length,
    remainingIssues: finalIssues,
    resolved: applied.length,
  };
}

function repairReason(code, issue) {
  switch (code) {
    case 'lead_verb_repetition':
      return `Several bullets opened with "${issue.verb}". Swapped to a different validated phrasing of the same evidence so the section does not read as a template.`;
    case 'structural_repetition':
      return 'Multiple bullets shared one sentence shape. Used a differently-structured version of the same facts.';
    case 'near_duplicate_bullet':
    case 'duplicate_bullet':
      return 'Two bullets overlapped heavily. Selected a version that adds distinct information.';
    case 'tense_inconsistency':
      return 'A past role was written in present tense. Selected the past-tense version.';
    default:
      return 'Document-level consistency repair.';
  }
}

export default {
  RESUME_CONSISTENCY_VERSION, detectDocumentIssues, repairDocument, normalizeTerminology,
};
