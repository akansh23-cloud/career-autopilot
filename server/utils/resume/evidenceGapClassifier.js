/* ============================================================
   RESUME EVIDENCE-GAP CLASSIFIER  (Resume OS V2; deterministic)
   ------------------------------------------------------------
   Classifies resume recommendations into the three types the
   product acts on, each with a concrete CTA and — critically —
   provenance. Nothing here invents metrics, impact or
   technologies; every suggestion traces to evidence the platform
   actually holds, or honestly says the evidence is missing.

   TYPE 1  evidence_exists   verified skill absent from the resume
                             → "Add verified evidence" (with the
                             project/task ids that produced it)
   TYPE 2  weak_wording      the deterministic scorer's own
                             weak-bullet / no-metrics findings
                             → "Improve wording using known
                             evidence only"
   TYPE 3  evidence_missing  role-critical skill with no verified
                             or artifact proof → "Build evidence"
                             (routes into the canonical project
                             recommender with the real gap list)
   ============================================================ */
import { resolveDictionary, SKILL_ALIASES } from './roleDictionaries.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const lc = (s) => String(s || '').toLowerCase().trim();

function matches(skill, list) {
  const t = lc(skill);
  const aliases = [t, ...(SKILL_ALIASES[t] || [])];
  return arr(list).some((c) => {
    const x = lc(c);
    return aliases.some((a) => x === a || (a.length > 2 && (x.includes(a) || a.includes(x))));
  });
}

/**
 * classifyResumeEvidenceGaps(input)
 * @param input.targetRole        role the resume targets
 * @param input.verifiedSkills    platform-verified skills (ledger)
 * @param input.resumeSkills      keywords actually present on the resume
 * @param input.provenSkills      GitHub-analysis detected skills
 * @param input.qualityChecks     scoring engine buildQualityChecks output
 * @param input.skillEvidence     workspace skillEvidence entries
 *                                [{skill, taskIds, evidence, confidence}]
 * @param input.verifiedProjects  [{id,title,skills}] for provenance
 */
export function classifyResumeEvidenceGaps({
  targetRole = '',
  verifiedSkills = [],
  resumeSkills = [],
  provenSkills = [],
  qualityChecks = [],
  skillEvidence = [],
  verifiedProjects = [],
} = {}) {
  const resolved = resolveDictionary(targetRole);
  const roleSkills = [...new Set([...(resolved.dict.mustHave || []), ...(resolved.dict.goodToHave || [])])];
  const mustHave = resolved.dict.mustHave || [];
  const recommendations = [];

  /* ---- TYPE 1: verified but not on the resume ---- */
  for (const skill of arr(verifiedSkills)) {
    if (matches(skill, resumeSkills)) continue;
    const ev = arr(skillEvidence).find((s) => lc(s.skill) === lc(skill)) || null;
    const proj = arr(verifiedProjects).find((p) => matches(skill, p.skills)) || null;
    recommendations.push({
      type: 'evidence_exists',
      skill,
      title: `Your verified ${skill} experience is not represented on your resume`,
      explanation: `The platform holds verified evidence for ${skill}${proj ? ` (project "${proj.title}")` : ''}${ev ? ` from ${ev.taskIds.length} verified task(s)` : ''}, but the resume never mentions it. Adding it is evidence-backed, not embellishment.`,
      cta: { view: 'resume', label: 'Add verified evidence' },
      provenance: {
        source: ev ? 'workspace_verification' : proj ? 'verified_project' : 'skill_ledger',
        projectId: proj?.id || null,
        projectTitle: proj?.title || null,
        taskIds: ev?.taskIds || [],
        evidence: ev?.evidence || [],
        confidence: ev?.confidence || 'medium',
      },
      priority: matches(skill, mustHave) ? 'high' : 'medium',
    });
  }

  /* ---- TYPE 2: wording is weak (from the deterministic scorer) ---- */
  for (const check of arr(qualityChecks)) {
    if (!['weak_bullets', 'no_metrics', 'few_metrics'].includes(check.type)) continue;
    recommendations.push({
      type: 'weak_wording',
      skill: null,
      title: check.type === 'weak_bullets' ? 'Bullets open with passive phrasing' : 'Impact is not quantified',
      explanation: `${check.detail} Improve the wording using only outcomes and technologies you can already evidence — never invent metrics.`,
      cta: { view: 'resume', label: 'Improve wording' },
      provenance: { source: 'deterministic_scorer', checkType: check.type, severity: check.severity },
      priority: check.severity === 'high' ? 'high' : 'medium',
    });
  }

  /* ---- TYPE 3: role-critical evidence is missing ---- */
  const evidenced = [...arr(verifiedSkills), ...arr(provenSkills)];
  for (const skill of roleSkills) {
    if (matches(skill, evidenced)) continue;
    const critical = mustHave.includes(skill);
    if (!critical && !matches(skill, resumeSkills)) continue; // non-core + not even claimed → recommender territory, not resume noise
    recommendations.push({
      type: 'evidence_missing',
      skill,
      title: `${skill} matters for ${resolved.name}, but you have no verified ${skill} evidence`,
      explanation: matches(skill, resumeSkills)
        ? `The resume claims ${skill}, but no verified or repository evidence backs it. Recruiters increasingly check; build proof before an interview does it for you.`
        : `${resolved.name} roles screen for ${skill} and your profile has no evidence for it yet.`,
      cta: { view: 'projectstudio', label: 'Build evidence', payload: { skills: [skill], targetRole: resolved.name } },
      provenance: { source: 'role_dictionary', role: resolved.name, bucket: critical ? 'mustHave' : 'goodToHave' },
      priority: critical ? 'high' : 'low',
    });
  }

  /* Claimed on the resume, in no role bucket, and with zero evidence:
     still TYPE 3 — an interviewer will probe the claim either way. */
  for (const skill of arr(resumeSkills)) {
    if (matches(skill, evidenced)) continue;
    if (matches(skill, roleSkills)) continue; // already handled above
    if (recommendations.some((r) => r.type === 'evidence_missing' && lc(r.skill) === lc(skill))) continue;
    recommendations.push({
      type: 'evidence_missing',
      skill,
      title: `Your resume claims ${skill}, but no verified evidence backs it`,
      explanation: `${skill} appears on the resume with no verified or repository proof behind it. Build evidence before an interview probes the claim.`,
      cta: { view: 'projectstudio', label: 'Build evidence', payload: { skills: [skill], targetRole: resolved.name } },
      provenance: { source: 'resume_claim', role: resolved.name, bucket: 'claimed' },
      priority: 'medium',
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => (rank[a.priority] - rank[b.priority]) || a.type.localeCompare(b.type));

  return {
    version: 'resume-evidence-gaps-v1',
    targetRole: resolved.name,
    knownRole: resolved.known,
    counts: {
      evidenceExists: recommendations.filter((r) => r.type === 'evidence_exists').length,
      weakWording: recommendations.filter((r) => r.type === 'weak_wording').length,
      evidenceMissing: recommendations.filter((r) => r.type === 'evidence_missing').length,
    },
    recommendations: recommendations.slice(0, 20),
  };
}

export default { classifyResumeEvidenceGaps };
