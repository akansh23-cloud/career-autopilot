/* ============================================================
   ATS ENGINE V3 — explainable deterministic resume health
   ------------------------------------------------------------
   Ten dimensions, 100 points. EVERY point traces to a rule in
   this file; every dimension returns {points, max, reasons[]}.
   Deterministic: same document + same context + same
   ATS_ENGINE_VERSION => identical output (golden-tested).

     ATS Parsing ............ 12
     Structure .............. 10
     Target Role Alignment .. 14
     JD Match (when JD) ..... 10   (folded into Role Alignment when absent)
     Evidence Strength ...... 14
     Impact ................. 12
     Readability ............ 10
     Formatting Safety ......  8
     Content Completeness ... 12
     Consistency ............  8

   "Potential after fixes" = current + Σ scoreImpact of open
   checks, capped at 100 — mathematically derived, never vibes.
   ============================================================ */
import { normalizeResumeDocument, collectBullets, toPlainText } from './resumeDocument.js';
import { resolveDictionary } from './roleDictionaries.js';
import { skillPresent, presentSkills } from './skillMatcher.js';
import { canonicalSkill, toCanonicalSet } from './skillOntology.js';
import { detectExperienceLevel } from './sectionDetector.js';
import { runResumeChecks, groupChecksForFixCenter } from './resumeChecksV3.js';
import { analyzeChronology } from './dateEngine.js';
import { findDuplicateBullets } from './textQualityEngines.js';
import { detectVerbRepetition, detectTenseIssues } from './grammarLibrary.js';

export const ATS_ENGINE_VERSION = 'ats-engine-v3.0';

export const DIMENSIONS = Object.freeze({
  atsParsing: 12, structure: 10, roleAlignment: 14, jdMatch: 10, evidenceStrength: 14,
  impact: 12, readability: 10, formattingSafety: 8, completeness: 12, consistency: 8,
});

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n);
const dim = (max) => ({ points: 0, max, reasons: [] });
const add = (D, pts, why) => { const p = clamp(pts, 0, D.max - D.points); if (p > 0) { D.points += p; D.reasons.push(`+${Math.round(p * 10) / 10} ${why}`); } };
const miss = (D, why) => D.reasons.push(`0 ${why}`);

export function scoreResumeDocument(doc, {
  targetRole = '', jd = null, verifiedSkills = [], profileSkills = [], atsSimulation = null,
} = {}) {
  const d = normalizeResumeDocument(doc);
  const role = targetRole || d.targetRole || '';
  const { name: roleName, dict } = resolveDictionary(role);
  const text = toPlainText(d);
  const norm = text.toLowerCase();
  const bullets = collectBullets(d).filter((b) => b.enabled && b.text);
  const enabledSkills = d.skills.filter((s) => s.enabled);
  const { level } = detectExperienceLevel(norm);
  const vSet = toCanonicalSet(verifiedSkills);
  const hasJD = !!(jd && (jd.required?.length || jd.preferred?.length));

  /* ---- 1. ATS Parsing (12) — content is machine-recoverable ---- */
  const P = dim(DIMENSIONS.atsParsing);
  if (d.contact.name) add(P, 2, 'name present'); else miss(P, 'name missing');
  if (d.contact.email) add(P, 2, 'email present'); else miss(P, 'email missing');
  if (d.contact.phone) add(P, 1, 'phone present');
  const specials = (text.match(/[^\w\s.,@()/&%+#:'’\-•|]/g) || []).length;
  const specialRatio = text.length ? specials / text.length : 1;
  if (specialRatio <= 0.02) add(P, 2, 'clean character set');
  else if (specialRatio <= 0.06) add(P, 1, 'mostly clean character set');
  else miss(P, `unusual characters (${(specialRatio * 100).toFixed(1)}%) risk parser noise`);
  if (atsSimulation && Number.isFinite(atsSimulation.integrity)) {
    add(P, (atsSimulation.integrity / 100) * 5, `render round-trip integrity ${atsSimulation.integrity}%`);
  } else {
    // Structured source guarantees text-first output — partial credit without a simulation run.
    add(P, 3.5, 'structured text-first source (run ATS simulation for full credit)');
  }

  /* ---- 2. Structure (10) ---- */
  const S = dim(DIMENSIONS.structure);
  const isStudent = ['fresher', 'junior'].includes(level);
  if (enabledSkills.length) add(S, 2.5, 'skills section'); else miss(S, 'no skills section');
  if (d.education.some((e) => e.enabled)) add(S, 2, 'education section'); else miss(S, 'no education section');
  const hasExp = d.experience.some((e) => e.enabled);
  const hasProj = d.projects.some((p) => p.enabled);
  if (isStudent) {
    if (hasProj) add(S, 3, 'projects present (student profile)'); else miss(S, 'no projects — students are judged on projects');
    if (hasExp) add(S, 1.5, 'internship/experience present');
  } else {
    if (hasExp) add(S, 3, 'experience present'); else miss(S, 'no experience section');
    if (hasProj) add(S, 1.5, 'projects present');
  }
  if (d.summary) add(S, 1, 'summary present');

  /* ---- 3. Target Role Alignment (14, or 24 when no JD) ---- */
  const R = dim(hasJD ? DIMENSIONS.roleAlignment : DIMENSIONS.roleAlignment + DIMENSIONS.jdMatch);
  const pool = [...new Set([...(dict.mustHave || []), ...(dict.goodToHave || [])])];
  const matched = presentSkills(norm, pool);
  const mustMatched = presentSkills(norm, dict.mustHave || []);
  if (pool.length) {
    const cov = matched.length / pool.length;
    const mustCov = (dict.mustHave || []).length ? mustMatched.length / dict.mustHave.length : cov;
    add(R, (mustCov * 0.65 + cov * 0.35) / 0.8 * R.max, `${mustMatched.length}/${(dict.mustHave || []).length} must-have + ${matched.length}/${pool.length} overall ${roleName} keywords`);
  } else add(R, R.max * 0.5, 'no dictionary for role — neutral credit');

  /* ---- 4. JD Match (10, only when a JD is attached) ---- */
  const J = dim(hasJD ? DIMENSIONS.jdMatch : 0);
  if (hasJD) {
    const req = jd.required || [];
    const pref = jd.preferred || [];
    const reqHit = presentSkills(norm, req);
    const prefHit = presentSkills(norm, pref);
    const reqCov = req.length ? reqHit.length / req.length : 1;
    const prefCov = pref.length ? prefHit.length / pref.length : 1;
    add(J, (reqCov * 0.75 + prefCov * 0.25) * J.max, `${reqHit.length}/${req.length} required + ${prefHit.length}/${pref.length} preferred JD skills`);
  }

  /* ---- 5. Evidence Strength (14) ---- */
  const E = dim(DIMENSIONS.evidenceStrength);
  const verifiedOnDoc = enabledSkills.filter((s) => vSet.has(canonicalSkill(s.name)));
  if (enabledSkills.length) {
    add(E, clamp(verifiedOnDoc.length * 1.5, 0, 6), `${verifiedOnDoc.length} verified skill(s) on the resume`);
  }
  const verifiedProjects = d.projects.filter((p) => p.enabled && (p.verified || p.evidenceIds.length));
  add(E, clamp(verifiedProjects.length * 2, 0, 4), `${verifiedProjects.length} project(s) carry verified evidence`);
  const evidencedBullets = bullets.filter((b) => b.evidenceIds.length || b.verified);
  add(E, clamp(evidencedBullets.length * 0.8, 0, 2), `${evidencedBullets.length} bullet(s) trace to evidence`);
  const skillsInUse = enabledSkills.filter((s) => bullets.some((b) => skillPresent(b.text, s.name)));
  if (enabledSkills.length) {
    const useRatio = skillsInUse.length / enabledSkills.length;
    add(E, useRatio * 2, `${skillsInUse.length}/${enabledSkills.length} listed skills shown in use`);
  }

  /* ---- 6. Impact (12) ---- */
  const I = dim(DIMENSIONS.impact);
  const quantified = bullets.filter((b) => /\d/.test(b.text));
  const pct = bullets.filter((b) => /\d{1,3}(\.\d+)?\s*%/.test(b.text));
  const scale = bullets.filter((b) => /\b\d+\s*(k|m|tb|gb|users|records|requests|teams|hours|days|crore|lakh)\b|\b(?:\$|₹)\s?\d/i.test(b.text));
  if (bullets.length) {
    add(I, clamp((quantified.length / bullets.length) / 0.6 * 6, 0, 6), `${quantified.length}/${bullets.length} bullets quantified`);
    add(I, clamp(pct.length * 1.5, 0, 3), `${pct.length} percentage metric(s)`);
    add(I, clamp(scale.length, 0, 3), `${scale.length} scale metric(s)`);
  } else miss(I, 'no bullets to evaluate');

  /* ---- 7. Readability (10) ---- */
  const RD = dim(DIMENSIONS.readability);
  if (bullets.length) {
    const lens = bullets.map((b) => b.text.split(/\s+/).length);
    const good = lens.filter((n) => n >= 8 && n <= 30).length;
    add(RD, (good / bullets.length) * 5, `${good}/${bullets.length} bullets in the 8–30 word band`);
    const firstPerson = bullets.filter((b) => /\b(i|my|we|our)\b/i.test(b.text)).length;
    if (!firstPerson) add(RD, 2, 'no first-person pronouns'); else miss(RD, `${firstPerson} bullet(s) use first person`);
    const weak = bullets.filter((b) => /^(responsible for|worked on|helped|involved in)/i.test(b.text)).length;
    if (!weak) add(RD, 2, 'no weak openers'); else miss(RD, `${weak} weak opener(s)`);
    if (d.summary && d.summary.split(/\s+/).length <= 70) add(RD, 1, 'summary is tight');
    else if (!d.summary) add(RD, 0.5, 'no summary to bloat');
  }

  /* ---- 8. Formatting Safety (8) — structured source + template flags ---- */
  const FS = dim(DIMENSIONS.formattingSafety);
  add(FS, 3, 'single-flow structured rendering (no tables/text boxes/images)');
  if (d.atsStrict) add(FS, 2, 'ATS Strict mode on');
  else add(FS, 1, 'standard template set (ATS-checked)');
  if (['comfortable', 'compact'].includes(d.density)) add(FS, 2, `readable density (${d.density})`);
  else add(FS, 1, 'tight density within the readability floor');
  if (atsSimulation?.headingRecovery === 1) add(FS, 1, 'all section headings survive rendering');
  else if (!atsSimulation) add(FS, 0.5, 'headings from the canonical set');

  /* ---- 9. Content Completeness (12) ---- */
  const C = dim(DIMENSIONS.completeness);
  const expWithBullets = d.experience.filter((e) => e.enabled && e.bullets.some((b) => b.enabled && b.text));
  const projWithBullets = d.projects.filter((p) => p.enabled && p.bullets.some((b) => b.enabled && b.text));
  add(C, clamp((isStudent ? projWithBullets.length : expWithBullets.length) * 2, 0, 5), `${isStudent ? projWithBullets.length + ' project(s)' : expWithBullets.length + ' role(s)'} carry bullets`);
  add(C, clamp(enabledSkills.length >= 8 ? 3 : enabledSkills.length * 0.35, 0, 3), `${enabledSkills.length} skills listed`);
  if (d.education.some((e) => e.enabled && e.degree)) add(C, 2, 'education has degree detail');
  if (d.certifications.some((x) => x.enabled)) add(C, 1, 'certifications listed');
  if (d.contact.linkedin || d.contact.github) add(C, 1, 'professional links present');

  /* ---- 10. Consistency (8) ---- */
  const K = dim(DIMENSIONS.consistency);
  const chrono = analyzeChronology([
    ...d.experience.filter((e) => e.enabled).map((e) => ({ id: e.id, label: e.role || e.company, startDate: e.startDate, endDate: e.endDate, current: e.current })),
  ]);
  if (!chrono.issues.length) add(K, 3, 'dates valid and consistently formatted');
  else miss(K, `${chrono.issues.length} date issue(s)`);
  const dups = findDuplicateBullets(bullets);
  if (!dups.exact.length && !dups.near.length) add(K, 2, 'no duplicate bullets');
  else miss(K, `${dups.exact.length + dups.near.length} duplicate/near-duplicate bullet(s)`);
  if (!detectVerbRepetition(bullets, 3).repeated.length) add(K, 1.5, 'varied action verbs');
  if (!detectTenseIssues(bullets).length) add(K, 1.5, 'tense consistent with role status');

  /* ---- totals ---- */
  const dimensions = {
    atsParsing: P, structure: S, roleAlignment: R,
    ...(hasJD ? { jdMatch: J } : {}),
    evidenceStrength: E, impact: I, readability: RD, formattingSafety: FS, completeness: C, consistency: K,
  };
  for (const D of Object.values(dimensions)) D.points = round(clamp(D.points, 0, D.max) * 10) / 10;
  const score = clamp(round(Object.values(dimensions).reduce((s2, D) => s2 + D.points, 0)), 0, 100);

  /* ---- checks + explainable potential ---- */
  const { checks } = runResumeChecks(d, {
    targetRole: roleName, roleDict: dict, experienceLevel: level, verifiedSkills,
    jdRequirements: hasJD ? jd : null,
  });
  const fixCenter = groupChecksForFixCenter(checks);
  const recoverable = checks.reduce((s2, ch) => s2 + (ch.scoreImpact || 0), 0);
  const potential = clamp(score + recoverable, score, 100);
  const topImprovements = [...checks]
    .filter((ch) => ch.scoreImpact > 0)
    .sort((a, b) => b.scoreImpact - a.scoreImpact || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map((ch) => ({ id: ch.id, message: ch.message, action: ch.recommendedAction, scoreImpact: ch.scoreImpact }));

  return {
    engineVersion: ATS_ENGINE_VERSION,
    score, potential,
    dimensions: Object.fromEntries(Object.entries(dimensions).map(([k, D]) => [k, { points: D.points, max: D.max, reasons: D.reasons }])),
    checks, fixCenter,
    topImprovements,
    scoredRole: roleName, experienceLevel: level, hasJD,
    checksVersion: 'resume-checks-v3',
  };
}

export default { ATS_ENGINE_VERSION, DIMENSIONS, scoreResumeDocument };
