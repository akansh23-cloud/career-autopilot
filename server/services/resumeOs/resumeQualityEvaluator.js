import { normalizeResumeDocument, collectBullets } from '../../utils/resume/resumeDocument.js';
import { auditResumeTruth } from '../../utils/resume/truthEngine.js';
import { scoreResumeDocument } from '../../utils/resume/atsEngineV3.js';
import { parseJDv2 } from '../../utils/resume/jdParserV2.js';
import { matchDocumentToJD } from '../../utils/resume/jobMatchEngineV3.js';
import { analyzeNaturalness } from '../../utils/resume/narrative/naturalness.js';
import { parseEvidenceText } from '../../utils/resume/narrative/evidenceGraph.js';

export const RESUME_QUALITY_VERSION = 'resume-quality-global-v1';

export const QUALITY_WEIGHTS = Object.freeze({
  contentStrength: 15,
  specificity: 15,
  jdRelevance: 15,
  domainAuthenticity: 12,
  naturalness: 12,
  ats: 10,
  evidenceUtilization: 8,
  redundancy: 5,
  informationHierarchy: 4,
  layout: 4,
});

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const pct = (n) => Math.round(clamp(Number(n) || 0));
const avg = (xs, fallback = 0) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;
const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9+#./-]+/g) || [];
const WEAK = /^(responsible for|worked on|worked with|helped (?:with|to|in)|assisted (?:with|in)|involved in|participated in|tasked with|duties included|exposure to|familiar with|part of)\b/i;
const CLICHE = /\b(delivering work end to end|results[- ]driven|proven track record|various projects|cutting[- ]edge|robust solutions?|seamlessly|leveraged|utilized industry best practices|dynamic professional)\b/i;
const ARTICLE_GAP = /\b(?:to|on|for|with)\s+(?:spring boot|java|python|react|kubernetes|docker)?\s*(?:service|application|platform|system|project)\b/i;

function similarity(a, b) {
  const A = new Set(words(a)); const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let shared = 0; for (const w of A) if (B.has(w)) shared += 1;
  return shared / (A.size + B.size - shared);
}

function bulletSignals(doc) {
  return collectBullets(doc).filter((b) => b.enabled && b.text).map((b) => {
    const p = parseEvidenceText(b.text);
    const wc = words(b.text).length;
    const metric = /(?<![\w.])\d[\d,.]*(?:%|ms|s|x|k|m|b|\+)?\b/i.test(b.text);
    const concrete = !!(p.object || p.method || p.scope || p.skills?.length || p.numericEvidence?.length);
    let strength = 42;
    if (p.action || p.weakOpener) strength += p.action ? 14 : 0;
    if (p.object) strength += 14;
    if (p.method) strength += 9;
    if (p.scope) strength += 6;
    if (p.outcome) strength += 8;
    if (metric) strength += 7;
    if (WEAK.test(b.text)) strength -= 18;
    if (wc > 34) strength -= Math.min(12, wc - 34);
    return { ...b, parsed: p, metric, concrete, strength: clamp(strength) };
  });
}

function naturalnessScore(doc, bullets) {
  const texts = [doc.summary, ...bullets.map((b) => b.text)].filter(Boolean);
  const base = analyzeNaturalness(texts);
  let score = base.score * 100;
  const robotic = texts.filter((t) => CLICHE.test(t)).length;
  const articleErrors = texts.filter((t) => ARTICLE_GAP.test(t) && /\b(?:to|on|for|with)\s+(?:spring boot|java|python|react|kubernetes|docker)?\s*(?:service|application|platform|system|project)\b/i.test(t)).length;
  const summarySkeleton = doc.summary && /\bworking on\b|\bworking across\b|\bdelivering work\b/i.test(doc.summary) ? 1 : 0;
  score -= robotic * 9 + articleErrors * 6 + summarySkeleton * 14;
  return { score: pct(score), analysis: base, penalties: { robotic, articleErrors, summarySkeleton } };
}

function redundancyScore(bullets) {
  if (bullets.length < 2) return 100;
  const sims = [];
  for (let i = 0; i < bullets.length; i++) for (let j = i + 1; j < bullets.length; j++) sims.push(similarity(bullets[i].text, bullets[j].text));
  const bad = sims.filter((s) => s >= 0.72);
  const moderate = sims.filter((s) => s >= 0.56 && s < 0.72);
  return pct(100 - bad.length * 15 - moderate.length * 5);
}

function hierarchyScore(doc) {
  let score = 0;
  if (doc.contact?.name) score += 18;
  if (doc.contact?.email) score += 12;
  if (doc.summary) score += 15;
  if (doc.skills?.some((s) => s.enabled)) score += 15;
  if (doc.experience?.some((e) => e.enabled)) score += 18;
  if (doc.education?.some((e) => e.enabled)) score += 10;
  const order = doc.sectionOrder || [];
  if (order.indexOf('experience') >= 0 && order.indexOf('education') >= 0 && order.indexOf('experience') < order.indexOf('education')) score += 6;
  if ((doc.summary || '').length <= 650) score += 6;
  return pct(score);
}

function domainScore(doc, bullets) {
  if (!bullets.length) return 35;
  const skillNames = new Set((doc.skills || []).filter((s) => s.enabled).map((s) => String(s.name || '').toLowerCase()));
  const values = bullets.map((b) => {
    let s = 38;
    const p = b.parsed;
    if (p.skills?.length) s += Math.min(28, p.skills.length * 9);
    if (p.object) s += 10;
    if (p.method) s += 8;
    const lower = b.text.toLowerCase();
    if ([...skillNames].some((x) => x && lower.includes(x))) s += 8;
    if (/\b(various|things|stuff|activities|tasks|deliverables|initiatives)\b/i.test(b.text)) s -= 16;
    return clamp(s);
  });
  return pct(avg(values, 45));
}

function specificityScore(bullets) {
  if (!bullets.length) return 30;
  const values = bullets.map((b) => {
    let s = 30;
    if (b.parsed.object) s += 22;
    if (b.parsed.skills?.length) s += Math.min(20, b.parsed.skills.length * 8);
    if (b.parsed.method) s += 10;
    if (b.parsed.scope) s += 8;
    if (b.parsed.outcome) s += 8;
    if (b.metric) s += 12;
    if (WEAK.test(b.text)) s -= 15;
    return clamp(s);
  });
  return pct(avg(values, 40));
}

function evidenceUtilizationScore(bullets) {
  if (!bullets.length) return 25;
  const values = bullets.map((b) => {
    let s = 35;
    if (b.concrete) s += 25;
    if (b.parsed.action) s += 15;
    if (b.parsed.outcome) s += 10;
    if (b.parsed.numericEvidence?.length) s += 10;
    if ((b.evidenceIds || []).length || b.verified) s += 10;
    if (b.parsed.weakOpener && !b.parsed.action) s -= 15;
    return clamp(s);
  });
  return pct(avg(values, 40));
}

function statusFor(score, hardFailures) {
  if (hardFailures.length) return 'BLOCKED';
  if (score >= 88) return 'EXCELLENT';
  if (score >= 78) return 'STRONG';
  if (score >= 66) return 'GOOD';
  if (score >= 52) return 'NEEDS_WORK';
  return 'WEAK';
}

export function evaluateResumeQuality(docInput, {
  jobDescription = '', targetRole = '', verifiedSkills = [], profileSkills = [],
  verifiedProjectIds = [], evidenceIndex = null, layout = null,
} = {}) {
  const doc = normalizeResumeDocument(docInput);
  const jdText = String(jobDescription || doc.targetJobDescription || '').trim();
  const jd = jdText.length >= 40 ? parseJDv2({ jobDescription: jdText, targetRole: targetRole || doc.targetRole }) : null;
  const truth = auditResumeTruth(doc, { verifiedSkills, profileSkills, verifiedProjectIds, evidenceIndex });
  const health = scoreResumeDocument(doc, { targetRole: targetRole || doc.targetRole, jd, verifiedSkills, profileSkills });
  const match = jd ? matchDocumentToJD(doc, jd, { verifiedSkills, targetRole: targetRole || doc.targetRole }) : null;
  const bullets = bulletSignals(doc);
  const natural = naturalnessScore(doc, bullets);

  const dimensions = {
    contentStrength: pct(avg(bullets.map((b) => b.strength), doc.summary ? 55 : 40)),
    specificity: specificityScore(bullets),
    jdRelevance: match ? pct(match.overall) : null,
    domainAuthenticity: domainScore(doc, bullets),
    naturalness: natural.score,
    ats: pct(health.score),
    evidenceUtilization: evidenceUtilizationScore(bullets),
    redundancy: redundancyScore(bullets),
    informationHierarchy: hierarchyScore(doc),
    layout: layout && Number.isFinite(layout.layoutScore) ? pct(layout.layoutScore) : null,
  };

  /* Only CRITICAL truth findings block optimization. High-severity profile/evidence
     gaps remain visible opportunities; otherwise a truthful user-entered resume
     that has not yet been separately verified could never be improved at all.
     Generated wording safety is still enforced by the canonical truth firewall. */
  const hardFailures = (truth.findings || []).filter((f) => String(f.severity || '').toLowerCase() === 'critical').map((f) => ({
    code: f.id || 'truth_failure', message: f.message || '', fieldReference: f.fieldReference || null,
  }));

  let weighted = 0; let weightTotal = 0;
  for (const [key, weight] of Object.entries(QUALITY_WEIGHTS)) {
    const value = dimensions[key];
    if (!Number.isFinite(value)) continue;
    weighted += value * weight; weightTotal += weight;
  }
  const overall = pct(weightTotal ? weighted / weightTotal : 0);
  const ordered = Object.entries(dimensions).filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1]);
  const strengths = ordered.slice(0, 3).map(([dimension, score]) => ({ dimension, score }));
  const opportunities = ordered.slice().sort((a, b) => a[1] - b[1]).slice(0, 4).map(([dimension, score]) => ({ dimension, score }));

  return {
    version: RESUME_QUALITY_VERSION,
    overall,
    status: statusFor(overall, hardFailures),
    dimensions,
    confidence: {
      jdRelevance: jd ? 'MEASURED' : 'N/A',
      layout: dimensions.layout == null ? 'N/A_PENDING_RENDER_FINALIZATION' : 'MEASURED',
      truth: 'DETERMINISTIC',
    },
    hardFailures,
    evidenceGaps: (truth.findings || []).filter((f) => String(f.severity || '').toLowerCase() === 'high').map((f) => ({ code: f.id || 'evidence_gap', message: f.message || '', fieldReference: f.fieldReference || null })),
    strengths,
    opportunities,
    truth,
    atsHealth: health,
    jobMatch: match,
    diagnostics: { naturalness: natural },
  };
}

export default { RESUME_QUALITY_VERSION, QUALITY_WEIGHTS, evaluateResumeQuality };
