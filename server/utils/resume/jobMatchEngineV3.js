/* ============================================================
   JOB MATCH V3 + CONTENT SELECTION — explainable tailoring
   ------------------------------------------------------------
   MATCH: per-dimension breakdown (Required / Verified Evidence /
   Experience Alignment / Preferred / Education) + a per-skill
   ledger: ✓ matched (VERIFIED|DECLARED) · ○ weak · ✕ missing —
   verification annotates strength, it NEVER moves a skill
   between matched and missing.

   SELECTION: rank every bullet / project / skill for a target:
     value = relevance × importance × evidenceStrength ×
             recency × impact × uniqueness ÷ spaceCost
   Deterministic, and every keep/cut carries a human reason.
   Selection proposes; the user disposes.
   ============================================================ */
import { normalizeResumeDocument, collectBullets, toPlainText } from './resumeDocument.js';
import { resolveDictionary } from './roleDictionaries.js';
import { skillPresent } from './skillMatcher.js';
import { canonicalSkill, toCanonicalSet } from './skillOntology.js';
import { parseResumeDate, dateOrdinal } from './dateEngine.js';
import { bulletSimilarity } from './textQualityEngines.js';

export const JOB_MATCH_VERSION = 'job-match-v3';
export const SELECTION_VERSION = 'content-selection-v2-budget-aware';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pct = (n) => clamp(Math.round(n), 0, 100);

/* ------------------------------------------------ match ---- */
export function matchDocumentToJD(doc, jd, { verifiedSkills = [], targetRole = '' } = {}) {
  const d = normalizeResumeDocument(doc);
  const text = toPlainText(d).toLowerCase();
  const bullets = collectBullets(d).filter((b) => b.enabled && b.text);
  const expText = bullets.map((b) => b.text).join('\n').toLowerCase();
  const vSet = toCanonicalSet(verifiedSkills);

  const ledger = [];
  const judge = (skill) => {
    const inDoc = skillPresent(text, skill);
    const inUse = skillPresent(expText, skill);
    const verified = vSet.has(canonicalSkill(skill));
    if (!inDoc && !verified) return { state: 'missing', verified: false, inUse: false };
    if (!inDoc && verified) return { state: 'missing', verified: true, inUse: false }; // provable but absent — the moat case
    if (inUse) return { state: 'matched', verified, inUse: true };
    return { state: 'weak', verified, inUse: false }; // listed only
  };

  const weightFor = new Map((jd.weighted || []).map((w) => [w.canonical, w.weight]));
  const requiredList = jd.required || [];
  const preferredList = [...(jd.preferred || []), ...(jd.nice || [])];
  const respList = jd.responsibilities || [];

  let reqScore = 0, reqMax = 0;
  for (const skill of requiredList) {
    const w = weightFor.get(canonicalSkill(skill)) || 3;
    reqMax += w;
    const j = judge(skill);
    reqScore += j.state === 'matched' ? w : j.state === 'weak' ? w * 0.55 : 0;
    ledger.push({ skill, tier: 'required', weight: w, ...j });
  }
  let prefScore = 0, prefMax = 0;
  for (const skill of preferredList) {
    const w = weightFor.get(canonicalSkill(skill)) || 1;
    prefMax += w;
    const j = judge(skill);
    prefScore += j.state === 'matched' ? w : j.state === 'weak' ? w * 0.55 : 0;
    ledger.push({ skill, tier: 'preferred', weight: w, ...j });
  }
  let respScore = 0, respMax = 0;
  for (const skill of respList) {
    const w = weightFor.get(canonicalSkill(skill)) || 2;
    respMax += w;
    const j = judge(skill);
    respScore += j.state === 'matched' ? w : j.state === 'weak' ? w * 0.5 : 0;
    if (!requiredList.includes(skill)) ledger.push({ skill, tier: 'responsibilities', weight: w, ...j });
  }

  const matchedLedger = ledger.filter((l) => l.state === 'matched');
  const verifiedMatched = matchedLedger.filter((l) => l.verified);
  const evidencePct = matchedLedger.length ? pct((verifiedMatched.length / matchedLedger.length) * 100) : 0;

  let eduPct = 100;
  if (jd.education) {
    const eduText = d.education.map((e) => `${e.degree} ${e.school}`).join(' ').toLowerCase();
    const need = jd.education.toLowerCase();
    const have = /phd|doctor/.test(eduText) ? 3 : /master|m\.tech|mba|m\.s|msc/.test(eduText) ? 2 : /bachelor|b\.tech|b\.e|bsc|undergrad/.test(eduText) ? 1 : 0;
    const want = /phd/.test(need) ? 3 : /master/.test(need) ? 2 : 1;
    eduPct = have >= want ? 100 : have > 0 ? 60 : 0;
  }

  const requiredPct = reqMax ? pct((reqScore / reqMax) * 100) : 100;
  const preferredPct = prefMax ? pct((prefScore / prefMax) * 100) : 100;
  const experiencePct = respMax ? pct((respScore / respMax) * 100) : 100;
  const overall = pct(requiredPct * 0.45 + experiencePct * 0.2 + evidencePct * 0.15 + preferredPct * 0.1 + eduPct * 0.1);

  const strong = ledger.filter((l) => l.state === 'matched').map((l) => ({ skill: l.skill, status: l.verified ? 'VERIFIED' : 'DECLARED', tier: l.tier }));
  const weak = ledger.filter((l) => l.state === 'weak').map((l) => ({ skill: l.skill, status: l.verified ? 'VERIFIED' : 'DECLARED', tier: l.tier, note: 'listed but never shown in use' }));
  const missing = ledger.filter((l) => l.state === 'missing').map((l) => ({ skill: l.skill, tier: l.tier, provable: l.verified }));

  /* Deterministic next best actions from the ledger. */
  const actions = [];
  for (const m of missing.filter((x) => x.provable).slice(0, 3)) {
    actions.push({ type: 'add_verified_evidence', skill: m.skill, priority: 'high', label: `Add ${m.skill} — you already hold verified evidence`, cta: { view: 'studio', panel: 'evidence' } });
  }
  for (const w of weak.filter((x) => x.tier === 'required').slice(0, 2)) {
    actions.push({ type: 'strengthen_usage', skill: w.skill, priority: 'high', label: `Show ${w.skill} in use inside a bullet — it is required but only listed`, cta: { view: 'studio', panel: 'content' } });
  }
  for (const m of missing.filter((x) => !x.provable && x.tier === 'required').slice(0, 3)) {
    actions.push({
      type: 'build_evidence', skill: m.skill, priority: 'high',
      label: `Build ${m.skill} evidence — required by this job, no evidence yet`,
      cta: { view: 'projectstudio', context: { targetRole: targetRole || jd.jobTitle || '', targetSkill: canonicalSkill(m.skill), reason: 'resume_gap' } },
    });
  }

  return {
    version: JOB_MATCH_VERSION,
    overall,
    breakdown: {
      requiredSkills: requiredPct, verifiedEvidence: evidencePct,
      experienceAlignment: experiencePct, preferredSkills: preferredPct, education: eduPct,
    },
    strong, weak, missing,
    actions,
    jobTitle: jd.jobTitle || '',
  };
}

/* ------------------------------------------------ selection ---- */
function recencyFactor(item) {
  const end = parseResumeDate(item.current ? 'Present' : item.endDate || item.dates || '');
  if (!end.ok) return 0.85;
  const nowOrd = new Date().getFullYear() * 12 + new Date().getMonth();
  const age = Math.max(0, nowOrd - dateOrdinal(end));
  if (end.present || age <= 12) return 1.0;
  if (age <= 36) return 0.9;
  if (age <= 72) return 0.75;
  return 0.6;
}

export function rankContentForTarget(doc, { jd = null, targetRole = '', verifiedSkills = [] } = {}) {
  const d = normalizeResumeDocument(doc);
  const role = targetRole || d.targetRole || jd?.jobTitle || '';
  const { dict } = resolveDictionary(role);
  const vSet = toCanonicalSet(verifiedSkills);
  const weighted = new Map((jd?.weighted || []).map((w) => [w.canonical, w.weight]));
  const rolePool = [...new Set([...(dict.mustHave || []).map((s) => [s, 3]), ...(dict.goodToHave || []).map((s) => [s, 1.5])])];
  const importanceOf = (skill) => weighted.get(canonicalSkill(skill))
    || (rolePool.find(([s]) => canonicalSkill(s) === canonicalSkill(skill))?.[1] ?? 0.5);

  const allSkillTerms = [...new Set([
    ...(jd?.weighted || []).map((w) => w.skill),
    ...(dict.mustHave || []), ...(dict.goodToHave || []), ...(dict.tools || []), ...(dict.cloud || []),
  ])];

  const scoreBullet = (b, item) => {
    const hits = allSkillTerms.filter((s) => skillPresent(b.text, s));
    const relevance = hits.length ? clamp(hits.reduce((s2, h) => s2 + importanceOf(h), 0) / 4, 0.2, 3) : 0.2;
    const evidence = b.evidenceIds?.length || b.verified ? 1.4 : vSet.size && hits.some((h) => vSet.has(canonicalSkill(h))) ? 1.2 : 1.0;
    const impact = /\d/.test(b.text) ? 1.3 : 1.0;
    const recency = recencyFactor(item);
    const spaceCost = clamp(b.text.split(/\s+/).length / 22, 0.6, 1.8);
    const value = (relevance * evidence * impact * recency) / spaceCost;
    return {
      value: Number(value.toFixed(3)),
      reasons: [
        hits.length ? `covers ${hits.slice(0, 3).join(', ')}` : 'no target skills mentioned',
        evidence > 1 ? 'evidence-backed' : null,
        impact > 1 ? 'quantified' : 'unquantified',
        recency < 0.8 ? 'older content' : null,
      ].filter(Boolean),
      skills: hits,
    };
  };

  const rankedBullets = [];
  const uniqSeen = [];
  for (const section of ['experience', 'projects']) {
    for (const item of d[section]) {
      if (!item.enabled) continue;
      for (const b of item.bullets) {
        if (!b.enabled || !b.text) continue;
        const s = scoreBullet(b, item);
        // uniqueness: penalise a bullet very similar to an already-ranked stronger one
        const twin = uniqSeen.find((u) => bulletSimilarity(u.text, b.text) >= 0.8);
        const value = twin ? s.value * 0.55 : s.value;
        if (twin) s.reasons.push('overlaps a stronger bullet');
        uniqSeen.push({ text: b.text });
        rankedBullets.push({ section, itemId: item.id, itemLabel: item.name || item.role || item.company, bulletId: b.id, text: b.text, value: Number(value.toFixed(3)), reasons: s.reasons, skills: s.skills });
      }
    }
  }
  rankedBullets.sort((a, b) => b.value - a.value || a.bulletId.localeCompare(b.bulletId));

  const rankedProjects = d.projects.filter((p) => p.enabled).map((p) => {
    const own = rankedBullets.filter((r) => r.itemId === p.id);
    const best = own.reduce((s2, r) => s2 + r.value, 0);
    const verifiedBonus = p.verified || p.evidenceIds.length ? 1.3 : 1.0;
    const value = Number(((best || 0.2) * verifiedBonus).toFixed(3));
    const covered = [...new Set(own.flatMap((r) => r.skills))];
    return {
      projectId: p.id, name: p.name, value,
      verified: !!(p.verified || p.evidenceIds.length),
      reason: covered.length
        ? `provides ${p.verified ? 'verified ' : ''}evidence for ${covered.slice(0, 4).join(', ')}`
        : 'low relevance to this target — no required skills covered',
      coveredSkills: covered,
    };
  }).sort((a, b) => b.value - a.value || a.projectId.localeCompare(b.projectId));

  const rankedSkills = d.skills.filter((s) => s.enabled).map((s) => {
    const imp = importanceOf(s.name);
    const verified = vSet.has(canonicalSkill(s.name)) || s.status === 'VERIFIED';
    return { skillId: s.id, itemId: s.id, name: s.name, value: Number((imp * (verified ? 1.3 : 1)).toFixed(2)), verified, importance: imp };
  }).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  const scoreSimpleItem = (item, kind) => {
    const text = String(item.text || '');
    const hits = allSkillTerms.filter((skill) => skillPresent(text, skill));
    const targetWeight = hits.reduce((sum, hit) => sum + importanceOf(hit), 0);
    const evidence = item.evidenceIds?.length || item.provenance === 'VERIFIED' ? 1.2 : 1;
    const quantified = /\d/.test(text) ? 1.2 : 1;
    const base = kind === 'certification' ? 0.8 : 0.65;
    const value = Number(((base + targetWeight) * evidence * (kind === 'achievement' ? quantified : 1)).toFixed(3));
    return {
      itemId: item.id, text, value, skills: hits,
      reasons: [
        hits.length ? `aligns with ${hits.slice(0, 3).join(', ')}` : 'general credential/achievement',
        evidence > 1 ? 'evidence-backed' : null,
        kind === 'achievement' && quantified > 1 ? 'quantified impact' : null,
      ].filter(Boolean),
    };
  };

  const rankedCertifications = d.certifications.filter((x) => x.enabled)
    .map((x) => scoreSimpleItem(x, 'certification'))
    .sort((a, b) => b.value - a.value || a.itemId.localeCompare(b.itemId));
  const rankedAchievements = d.achievements.filter((x) => x.enabled)
    .map((x) => scoreSimpleItem(x, 'achievement'))
    .sort((a, b) => b.value - a.value || a.itemId.localeCompare(b.itemId));

  return {
    version: SELECTION_VERSION, targetRole: role, bullets: rankedBullets, projects: rankedProjects, skills: rankedSkills,
    certifications: rankedCertifications, achievements: rankedAchievements,
  };
}

/* Propose a variant selection (explainable, non-destructive). */
export function proposeTailoredSelection(doc, ranking, { maxBulletsPerItem = 4, maxProjects = 4 } = {}) {
  const d = normalizeResumeDocument(doc);
  const keepProjects = new Set(ranking.projects.slice(0, maxProjects).map((p) => p.projectId));
  const bulletIds = {};
  const decisions = [];
  for (const section of ['experience', 'projects']) {
    for (const item of d[section]) {
      if (!item.enabled) continue;
      const ranked = ranking.bullets.filter((r) => r.itemId === item.id);
      const keep = ranked.slice(0, maxBulletsPerItem);
      bulletIds[item.id] = keep.map((r) => r.bulletId);
      for (const cut of ranked.slice(maxBulletsPerItem)) {
        decisions.push({ action: 'trim_bullet', itemId: item.id, bulletId: cut.bulletId, reason: `Lower value (${cut.value}) than the ${maxBulletsPerItem} kept bullets: ${cut.reasons.join('; ')}.` });
      }
    }
  }
  const disabled = [];
  for (const p of ranking.projects.slice(maxProjects)) {
    disabled.push(p.projectId);
    const better = ranking.projects.slice(0, 2).map((x) => `"${x.name}"`).join(' and ');
    decisions.push({ action: 'hide_project', itemId: p.projectId, reason: `Lower relevance to this target than ${better}. ${p.reason}.` });
  }
  for (const p of ranking.projects.slice(0, maxProjects)) {
    decisions.push({ action: 'keep_project', itemId: p.projectId, reason: p.reason.charAt(0).toUpperCase() + p.reason.slice(1) + '.' });
  }
  return { version: SELECTION_VERSION, overrides: { bulletIds, disabled }, decisions, keptProjects: [...keepProjects] };
}

export default { JOB_MATCH_VERSION, SELECTION_VERSION, matchDocumentToJD, rankContentForTarget, proposeTailoredSelection };
