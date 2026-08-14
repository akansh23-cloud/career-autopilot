export const WEAKNESS_DETECTOR_VERSION = 'resume-weakness-detector-v1';

export const WEAKNESS = Object.freeze({
  WEAK_LANGUAGE: 'WEAK_LANGUAGE',
  LOW_SPECIFICITY: 'LOW_SPECIFICITY',
  UNDERUSED_EVIDENCE: 'UNDERUSED_EVIDENCE',
  WEAK_SUMMARY: 'WEAK_SUMMARY',
  LOW_JD_ALIGNMENT: 'LOW_JD_ALIGNMENT',
  ATS_TERMINOLOGY: 'ATS_TERMINOLOGY',
  DOMAIN_AUTHENTICITY: 'DOMAIN_AUTHENTICITY',
  NATURALNESS: 'NATURALNESS',
  REDUNDANCY: 'REDUNDANCY',
  OVERLONG_CONTENT: 'OVERLONG_CONTENT',
  INFORMATION_HIERARCHY: 'INFORMATION_HIERARCHY',
});

const OBJECTIVE = Object.freeze({
  [WEAKNESS.WEAK_LANGUAGE]: 'weak_language',
  [WEAKNESS.LOW_SPECIFICITY]: 'specificity',
  [WEAKNESS.UNDERUSED_EVIDENCE]: 'evidence_utilization',
  [WEAKNESS.WEAK_SUMMARY]: 'summary_quality',
  [WEAKNESS.LOW_JD_ALIGNMENT]: 'jd_alignment',
  [WEAKNESS.ATS_TERMINOLOGY]: 'ats_supported_terminology',
  [WEAKNESS.DOMAIN_AUTHENTICITY]: 'domain_authenticity',
  [WEAKNESS.NATURALNESS]: 'naturalness',
  [WEAKNESS.REDUNDANCY]: 'redundancy',
  [WEAKNESS.OVERLONG_CONTENT]: 'concision',
  [WEAKNESS.INFORMATION_HIERARCHY]: 'information_hierarchy',
});

function push(list, type, score, threshold, priority, reason, actionable = true) {
  if (!Number.isFinite(score) || score >= threshold || !actionable) return;
  list.push({ type, objective: OBJECTIVE[type], score, threshold, priority: Math.round(priority + (threshold - score)), reason, actionable: true });
}

export function detectResumeWeaknesses(doc, quality, { hasJob = false } = {}) {
  const d = quality?.dimensions || {};
  const list = [];
  push(list, WEAKNESS.WEAK_LANGUAGE, d.naturalness, 78, 72, 'Wording still contains mechanical or weak constructions.');
  push(list, WEAKNESS.LOW_SPECIFICITY, d.specificity, 76, 78, 'Bullets can use more of the concrete evidence already present.');
  push(list, WEAKNESS.UNDERUSED_EVIDENCE, d.evidenceUtilization, 78, 80, 'Available evidence is not fully represented in the strongest bullets.');
  push(list, WEAKNESS.WEAK_SUMMARY, d.contentStrength, 74, 64, 'Summary/content framing is weaker than the underlying evidence.');
  if (hasJob) {
    push(list, WEAKNESS.LOW_JD_ALIGNMENT, d.jdRelevance, 72, 88, 'Supported experience is not aligned strongly enough to this job.');
    push(list, WEAKNESS.ATS_TERMINOLOGY, d.ats, 76, 74, 'Supported canonical terminology or ATS structure can improve.');
  }
  push(list, WEAKNESS.DOMAIN_AUTHENTICITY, d.domainAuthenticity, 74, 70, 'Language is not yet as practitioner-specific as the evidence allows.');
  push(list, WEAKNESS.NATURALNESS, d.naturalness, 82, 68, 'Sentence variety and human editorial quality can improve.');
  push(list, WEAKNESS.REDUNDANCY, d.redundancy, 88, 58, 'Some bullets are semantically repetitive.');
  push(list, WEAKNESS.INFORMATION_HIERARCHY, d.informationHierarchy, 78, 45, 'Section hierarchy can be clearer.');

  const longBullets = [...(doc?.experience || []), ...(doc?.projects || [])]
    .flatMap((x) => x.bullets || []).filter((b) => String(b.text || '').trim().split(/\s+/).length > 30).length;
  if (longBullets) list.push({ type: WEAKNESS.OVERLONG_CONTENT, objective: OBJECTIVE[WEAKNESS.OVERLONG_CONTENT], score: Math.max(0, 100 - longBullets * 12), threshold: 90, priority: 60 + longBullets * 3, reason: `${longBullets} bullet(s) exceed the preferred information-density range.`, actionable: true });

  return { version: WEAKNESS_DETECTOR_VERSION, weaknesses: list.sort((a, b) => b.priority - a.priority) };
}

export default { WEAKNESS_DETECTOR_VERSION, WEAKNESS, detectResumeWeaknesses };
