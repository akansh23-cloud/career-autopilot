/* ============================================================
   DETERMINISTIC RESUME SCORING ENGINE — v2
   ------------------------------------------------------------
   Pure function of (resumeText, targetRole). No AI. Same inputs +
   same SCORING_VERSION always produce the same score.

   Breakdown (totals 100, minus anti-stuffing up to -10):
     ATS parseability ............ 15
     Contact info .................  8
     Section completeness ........ 12
     Role keyword match .......... 18
     Skills relevance ............ 15
     Experience/project evidence . 15
     Quantified impact ........... 10
     Readability ..................  5
     Anti-keyword-stuffing ....... up to -10
   ============================================================ */
import { normalizeResumeText } from './normalizeResumeText.js';
import { resolveDictionary, actionVerbsFor, ROLE_DICTIONARIES } from './roleDictionaries.js';
import { detectSections, sliceSections, detectExperienceLevel } from './sectionDetector.js';
import { extractContact } from './contactExtractor.js';
import { presentSkills, countPresent, skillEvidence, skillPresent } from './skillMatcher.js';

export const SCORING_VERSION = 'resume-score-v3';

export const WEIGHTS = {
  atsParseability: 15,
  contactInfo: 8,
  sectionCompleteness: 12,
  roleKeywordMatch: 18,
  skillsRelevance: 15,
  experienceRelevance: 15,
  quantifiedImpact: 10,
  readability: 5,
};
export const ANTI_STUFFING_MAX = 10;

const round = (n) => Math.round(n);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const count = (hay, needles) => needles.reduce((n, w) => (w && hay.includes(w) ? n + 1 : n), 0);

/* 1. ATS PARSEABILITY (15) */
function scoreAts(raw, norm) {
  const max = WEIGHTS.atsParseability;
  const len = raw.trim().length;
  const words = norm.split(/\s+/).filter(Boolean);
  const lines = raw.split('\n').filter((l) => l.trim().length);
  let pts = 0;
  if (len >= 1500) pts += 6; else if (len >= 800) pts += 4.5; else if (len >= 400) pts += 3; else if (len >= 150) pts += 1.5;
  if (lines.length >= 8) pts += 3; else if (lines.length >= 4) pts += 2; else if (lines.length >= 2) pts += 1;
  const avgWordLen = words.length ? norm.replace(/\s+/g, '').length / words.length : 0;
  if (avgWordLen >= 3 && avgWordLen <= 9) pts += 3; else if (avgWordLen >= 2 && avgWordLen <= 12) pts += 1.5;
  const specials = (raw.match(/[^\w\s.,@()/&%+#:'\-•|]/g) || []).length;
  const specialRatio = len ? specials / len : 1;
  if (specialRatio <= 0.03) pts += 3; else if (specialRatio <= 0.08) pts += 1.5;
  return { points: round(clamp(pts, 0, max)), max, chars: len, words: words.length, lines: lines.length, specialRatio: Number(specialRatio.toFixed(3)) };
}

/* 2. CONTACT (8) */
function scoreContact(raw) {
  const max = WEIGHTS.contactInfo;
  const d = extractContact(raw);
  const weights = { email: 2.5, phone: 2, linkedin: 1.5, githubOrPortfolio: 1.5, location: 0.5 };
  let pts = 0; for (const k of Object.keys(d)) if (d[k]) pts += weights[k];
  return { points: round(clamp(pts, 0, max)), max, detected: d };
}

/* 3. SECTION COMPLETENESS (12) */
function scoreSections(norm, level) {
  const max = WEIGHTS.sectionCompleteness;
  const sections = detectSections(norm);
  const base = { summary: 1.5, skills: 2.5, education: 2, certifications: 1, achievements: 1 };
  if (level === 'fresher' || level === 'junior') { base.projects = 3; base.experience = 1.5; }
  else { base.experience = 3; base.projects = 1.5; }
  let pts = 0; for (const k of Object.keys(sections)) if (sections[k]) pts += base[k] || 0;
  return { points: round(clamp(pts, 0, max)), max, detected: sections, level };
}

/* 4. ROLE KEYWORD MATCH (18) — word-boundary + alias aware */
function scoreKeywords(norm, dict) {
  const max = WEIGHTS.roleKeywordMatch;
  const pool = Array.from(new Set([...(dict.mustHave || []), ...(dict.goodToHave || [])]));
  const matched = presentSkills(norm, pool);
  const missing = pool.filter((k) => !skillPresent(norm, k));
  const ratio = pool.length ? matched.length / pool.length : 0;
  const pts = clamp((ratio / 0.7) * max, 0, max);
  return { points: round(pts), max, matched, missing, poolSize: pool.length };
}

/* 5. SKILLS RELEVANCE (15) — bucketed, must-have heaviest, evidence-weighted */
function scoreSkills(norm, sections, dict) {
  const max = WEIGHTS.skillsRelevance;
  const buckets = [
    { key: 'mustHave', weight: 0.40 },
    { key: 'goodToHave', weight: 0.15 },
    { key: 'languages', weight: 0.15 },
    { key: 'tools', weight: 0.12 },
    { key: 'cloud', weight: 0.10 },
    { key: 'databases', weight: 0.05 },
    { key: 'testing', weight: 0.03 },
  ];
  const expText = sections.experienceProjects || '';
  let score = 0; const detail = {};
  for (const b of buckets) {
    const list = dict[b.key] || [];
    if (!list.length) { detail[b.key] = { matched: 0, total: 0, evidenced: 0 }; continue; }
    const present = presentSkills(norm, list);
    const evidenced = present.filter((s) => skillPresent(expText, s));
    // Evidenced skills count full; skills-only listing counts 0.6.
    const effective = evidenced.length + (present.length - evidenced.length) * 0.6;
    const cov = effective / list.length;
    score += cov * b.weight;
    detail[b.key] = { matched: present.length, total: list.length, evidenced: evidenced.length };
  }
  const pts = clamp((score / 0.7) * max, 0, max);
  return { points: round(pts), max, buckets: detail };
}

/* 6. EXPERIENCE / PROJECT EVIDENCE (15) */
function scoreExperience(norm, sections, roleName) {
  const max = WEIGHTS.experienceRelevance;
  const verbs = actionVerbsFor(roleName);
  const distinctVerbs = verbs.filter((v) => skillPresent(norm, v)).length;
  const bullets = (norm.match(/(^|\n)[\s]*[•\-*]/g) || []).length;
  const hasExp = (sections.experienceProjects || '').length > 40;
  let pts = 0;
  pts += clamp((distinctVerbs / 8) * 9, 0, 9);
  pts += clamp((bullets / 8) * 5, 0, 5);
  if (hasExp) pts += 1;
  return { points: round(clamp(pts, 0, max)), max, actionVerbs: distinctVerbs, bullets };
}

/* 7. QUANTIFIED IMPACT (10) */
function scoreImpact(norm) {
  const max = WEIGHTS.quantifiedImpact;
  const percentages = (norm.match(/\b\d{1,3}(\.\d+)?\s*%/g) || []).length;
  const moneyOrScale = (norm.match(/\b(?:\$|₹|rs\.?|usd|inr)\s?\d|\b\d{1,3}(,\d{3})+\b|\b\d+\s*(k|m|million|lakh|crore|users|records|requests|transactions|hours|days)\b/g) || []).length;
  const impactPhrases = count(norm, ['reduced', 'increased', 'improved', 'saved', 'cut', 'boosted', 'accelerated', 'decreased', 'grew', 'automated', 'optimized']);
  const numbers = (norm.match(/\b\d+\b/g) || []).length;
  let pts = 0;
  pts += clamp(percentages * 2, 0, 4);
  pts += clamp(moneyOrScale * 1.2, 0, 3);
  if (impactPhrases > 0 && numbers > 0) pts += clamp(impactPhrases, 0, 3); else if (numbers >= 3) pts += 1;
  return { points: round(clamp(pts, 0, max)), max, percentages, scaleMetrics: moneyOrScale, impactVerbs: impactPhrases };
}

/* 8. READABILITY (5) */
function scoreReadability(raw, norm) {
  const max = WEIGHTS.readability;
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const bulletLines = lines.filter((l) => /^[•\-*]/.test(l));
  const words = norm.split(/\s+/).filter(Boolean);
  let pts = 0;
  if (bulletLines.length >= 4) pts += 1.5; else if (bulletLines.length >= 1) pts += 0.75;
  if (bulletLines.length) {
    const avg = bulletLines.reduce((s, l) => s + l.split(/\s+/).length, 0) / bulletLines.length;
    if (avg >= 4 && avg <= 30) pts += 1; else if (avg < 45) pts += 0.5;
  }
  const longParas = lines.filter((l) => l.split(/\s+/).length > 60).length;
  if (longParas === 0) pts += 1; else if (longParas <= 2) pts += 0.5;
  const buzz = count(norm, ['team player', 'hardworking', 'go-getter', 'synergy', 'think outside the box', 'detail-oriented', 'self-starter', 'results-driven', 'dynamic professional']);
  const freq = {}; for (const w of words) if (w.length > 4) freq[w] = (freq[w] || 0) + 1;
  const overused = Object.values(freq).filter((c) => c > 12).length;
  if (buzz === 0 && overused === 0) pts += 1.5; else if (buzz <= 1 && overused <= 1) pts += 0.75;
  return { points: round(clamp(pts, 0, max)), max, bulletLines: bulletLines.length, buzzwords: buzz };
}

/* ANTI-KEYWORD-STUFFING (up to -10)
   Penalizes resumes that list many role keywords with little supporting
   evidence (keywords appear but rarely inside experience/projects), plus
   single-token repetition spam and skills-section keyword dumps. */
function scoreAntiStuffing(norm, sections, dict, keywordMatch) {
  const expText = sections.experienceProjects || '';
  const matched = keywordMatch.matched || [];
  if (!matched.length) return { penalty: 0, max: ANTI_STUFFING_MAX, evidencedRatio: 1 };
  const evidenced = matched.filter((k) => skillPresent(expText, k)).length;
  const evidencedRatio = evidenced / matched.length;
  let penalty = 0;
  // Many keywords but almost none evidenced -> stuffing.
  if (matched.length >= 6 && evidencedRatio < 0.2) penalty += 6;
  else if (matched.length >= 6 && evidencedRatio < 0.4) penalty += 3;
  // Token repetition spam (same long word many times).
  const words = norm.split(/\s+/).filter(Boolean);
  const freq = {}; for (const w of words) if (w.length > 3) freq[w] = (freq[w] || 0) + 1;
  const spam = Object.values(freq).filter((c) => c > 15).length;
  penalty += clamp(spam * 1.5, 0, 3);
  // Comma-soup skills section (huge undifferentiated keyword dump).
  const skillsCommas = ((sections.skills || '').match(/,/g) || []).length;
  if (skillsCommas > 40) penalty += 1;
  return { penalty: round(clamp(penalty, 0, ANTI_STUFFING_MAX)), max: ANTI_STUFFING_MAX, evidencedRatio: Number(evidencedRatio.toFixed(2)) };
}

/* ============================================================
   DETERMINISTIC QUALITY CHECKS (no AI)
   ------------------------------------------------------------
   Concrete, actionable findings rendered by the UI as
   [{ type, severity: 'high'|'medium'|'info', detail }].
   Pure function of already-computed deterministic sub-results —
   same resume + same SCORING_VERSION always produce identical
   checks. JD-specific missing keywords are intentionally NOT
   produced here; /api/resume/tailor already returns
   keywordsMissing against an actual job description.
   ============================================================ */

export const WEAK_BULLET_OPENERS = [
  'responsible for', 'worked on', 'involved in', 'participated',
  'helped', 'assisted', 'handled', 'supported',
];

/* Bullet lines from the normalized (lowercased, trimmed) text. */
function extractBullets(norm) {
  return norm.split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[•\-*▪◦‣]\s*/.test(l))
    .map((l) => l.replace(/^[•\-*▪◦‣]\s*/, '').trim())
    .filter(Boolean);
}

function findWeakBullets(norm) {
  const weak = [];
  for (const b of extractBullets(norm)) {
    if (WEAK_BULLET_OPENERS.some((p) => b.startsWith(p))) weak.push(b);
  }
  return weak;
}

const MISSING_SECTION_RULES = {
  // [severity for fresher/junior, severity for mid/senior, label]
  skills: ['high', 'high', 'a Skills section'],
  education: ['high', 'medium', 'an Education section'],
  experience: [null, 'high', 'a Work Experience section'], // freshers may legitimately have none
  projects: ['high', null, 'a Projects section'],          // experienced folks may skip it
  summary: ['info', 'info', 'a Summary/Profile section'],
  certifications: [null, 'info', 'a Certifications section'],
};

export function buildQualityChecks({ norm, level, sections, impactDetail, antiStuffing, words }) {
  const checks = [];
  const junior = level === 'fresher' || level === 'junior';

  // 1) Missing sections — role/level aware.
  for (const [key, [freshSev, seniorSev, label]] of Object.entries(MISSING_SECTION_RULES)) {
    const sev = junior ? freshSev : seniorSev;
    if (!sev || sections[key]) continue;
    checks.push({
      type: 'missing_section',
      severity: sev,
      detail: `Add ${label} — recruiters and ATS parsers expect it for ${junior ? 'fresher/junior' : 'experienced'} resumes.`,
    });
  }

  // 2) Weak bullet openers instead of action verbs.
  const weak = findWeakBullets(norm);
  if (weak.length) {
    const examples = weak.slice(0, 3).map((b) => `"${b.slice(0, 70)}${b.length > 70 ? '…' : ''}"`).join('; ');
    checks.push({
      type: 'weak_bullets',
      severity: weak.length >= 3 ? 'high' : 'medium',
      detail: `${weak.length} bullet${weak.length > 1 ? 's start' : ' starts'} with a passive phrase (e.g. ${examples}). Rewrite to start with an action verb like Built, Migrated, Automated, Reduced.`,
    });
  }

  // 3) Bullets / experience lacking metrics.
  const bulletCount = extractBullets(norm).length;
  const metricSignals = (impactDetail?.percentages || 0) + (impactDetail?.scaleMetrics || 0);
  if (bulletCount >= 3 && metricSignals === 0) {
    checks.push({
      type: 'no_metrics',
      severity: 'high',
      detail: 'No quantified results found in your bullets. Add numbers — %, time saved, cost, data volume, users — to at least 3–4 bullets to prove impact.',
    });
  } else if (bulletCount >= 5 && metricSignals < 2) {
    checks.push({
      type: 'few_metrics',
      severity: 'medium',
      detail: 'Very few quantified results. Aim for a number (%, scale, money, time) in roughly half of your experience bullets.',
    });
  }

  // 4) Keyword stuffing — reuses the scoreAntiStuffing penalty verbatim.
  if ((antiStuffing?.penalty || 0) >= 4) {
    checks.push({
      type: 'keyword_stuffing',
      severity: 'high',
      detail: `Keyword-stuffing penalty applied (−${antiStuffing.penalty} pts): many role keywords appear without supporting evidence in Experience/Projects. Back each skill with a bullet, or remove it.`,
    });
  } else if ((antiStuffing?.penalty || 0) > 0) {
    checks.push({
      type: 'keyword_stuffing',
      severity: 'medium',
      detail: `Mild keyword-stuffing penalty (−${antiStuffing.penalty} pts). Skills listed in the Skills section score more when also evidenced inside Experience/Projects bullets.`,
    });
  }

  // 5) Length risk vs detected experience level (word-count proxy:
  //    ~450–550 words ≈ one dense page).
  if (junior && words > 900) {
    checks.push({
      type: 'length_risk',
      severity: 'medium',
      detail: `At ~${words} words this fresher/junior resume very likely runs past one page. Trim to the strongest projects and bullets — one page is the expectation at this level.`,
    });
  } else if ((level === 'senior' || level === 'mid') && words < 350) {
    checks.push({
      type: 'length_risk',
      severity: level === 'senior' ? 'high' : 'medium',
      detail: `At ~${words} words this resume looks too thin for a ${level}-level candidate. Expand recent roles with scope, ownership and measurable outcomes.`,
    });
  }

  return checks;
}

/* Deterministic best-fit role across all dictionaries (suggestion only). */
function pickRecommendedRole(norm, currentRole) {
  let best = { role: currentRole, cov: -1 };
  for (const [role, dict] of Object.entries(ROLE_DICTIONARIES)) {
    const pool = Array.from(new Set([...(dict.mustHave || []), ...(dict.goodToHave || [])]));
    if (!pool.length) continue;
    const cov = countPresent(norm, pool) / pool.length;
    if (cov > best.cov) best = { role, cov };
  }
  return best.role || currentRole;
}

export function scoreResume({ resumeText = '', targetRole = '' } = {}) {
  const raw = String(resumeText || '');
  const norm = normalizeResumeText(raw);
  const { name: roleName, dict, known } = resolveDictionary(targetRole);
  const sections = sliceSections(norm);
  const { level } = detectExperienceLevel(norm);

  const ats = scoreAts(raw, norm);
  const contact = scoreContact(raw);
  const sect = scoreSections(norm, level);
  const keywords = scoreKeywords(norm, dict);
  const skills = scoreSkills(norm, sections, dict);
  const experience = scoreExperience(norm, sections, roleName);
  const impact = scoreImpact(norm);
  const readability = scoreReadability(raw, norm);
  const antiStuffing = scoreAntiStuffing(norm, sections, dict, keywords);

  const breakdown = {
    atsParseability: ats.points,
    contactInfo: contact.points,
    sectionCompleteness: sect.points,
    roleKeywordMatch: keywords.points,
    skillsRelevance: skills.points,
    experienceRelevance: experience.points,
    quantifiedImpact: impact.points,
    readability: readability.points,
    antiKeywordStuffing: -antiStuffing.penalty,
  };

  const positive = ats.points + contact.points + sect.points + keywords.points +
    skills.points + experience.points + impact.points + readability.points;
  const score = clamp(round(positive - antiStuffing.penalty), 0, 100);

  const atsPct = round(((ats.points + contact.points + sect.points) /
    (WEIGHTS.atsParseability + WEIGHTS.contactInfo + WEIGHTS.sectionCompleteness)) * 100);
  const impactPct = round((clamp(keywords.points + skills.points + experience.points + impact.points - antiStuffing.penalty, 0, 1000) /
    (WEIGHTS.roleKeywordMatch + WEIGHTS.skillsRelevance + WEIGHTS.experienceRelevance + WEIGHTS.quantifiedImpact)) * 100);
  const clarityPct = round(((readability.points + sect.points) /
    (WEIGHTS.readability + WEIGHTS.sectionCompleteness)) * 100);

  // Evidence list for the most important role skills.
  const evidencePool = Array.from(new Set([...(dict.mustHave || []), ...(dict.goodToHave || []), ...(dict.languages || []), ...(dict.tools || [])]));
  const evidence = skillEvidence(presentSkills(norm, evidencePool), {
    experienceText: sections.experienceProjects, skillsText: sections.skills, fullText: norm,
  });

  const qualityChecks = buildQualityChecks({
    norm, level, sections: sect.detected,
    impactDetail: impact, antiStuffing, words: ats.words,
  });

  return {
    score,
    ats: clamp(atsPct, 0, 100),
    impact: clamp(impactPct, 0, 100),
    clarity: clamp(clarityPct, 0, 100),
    breakdown,
    qualityChecks,
    matchedKeywords: keywords.matched,
    missingKeywords: keywords.missing.slice(0, 25),
    skillEvidence: evidence,
    recommendedRole: pickRecommendedRole(norm, roleName),
    scoredRole: roleName,
    roleKnown: known,
    experienceLevel: level,
    details: { ats, contact, sections: sect, keywords, skills, experience, impact, readability, antiStuffing },
    scoringVersion: SCORING_VERSION,
  };
}

export default { SCORING_VERSION, WEIGHTS, scoreResume };
