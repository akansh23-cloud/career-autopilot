/* ============================================================
   TRUTH ENGINE — resume claim firewall (Resume OS V3)
   ------------------------------------------------------------
   Audits a ResumeDocument against known sources of truth:
     • verified skills (server verification engine)
     • verified projects + evidence ids
     • the user's saved profile (declared skills, employers)
   and assigns per-claim provenance:
     VERIFIED > PROFILE_CONFIRMED > USER_ENTERED > UNSUPPORTED

   RULES ENFORCED:
   1. A skill named inside an experience/project bullet with no
      supporting evidence AND absent from the profile is flagged
      UNSUPPORTED (skills-section listing of a declared skill is
      allowed; implied practical usage is not).
   2. Metrics inside compiled bullets must exist in their source
      facts (fabricated-number firewall).
   3. Verified markers on items require at least one evidenceId.
   Nothing here rewrites content — it flags; the user decides.
   ============================================================ */
import { normalizeResumeDocument, collectBullets, PROVENANCE } from './resumeDocument.js';
import { canonicalSkill, toCanonicalSet, isKnownSkill, allKnownSkills } from './skillOntology.js';
import { skillPresent } from './skillMatcher.js';
import { containsOnlyProvidedNumbers } from './bulletCompiler.js';

export const TRUTH_ENGINE_VERSION = 'truth-engine-v1';

/* Known skills mentioned in a text (word-boundary, alias-aware). */
export function skillsMentioned(text, candidateSkills) {
  const out = [];
  for (const s of candidateSkills) if (skillPresent(text, s)) out.push(s);
  return out;
}

export function auditResumeTruth(doc, {
  verifiedSkills = [],       // ['docker', ...]
  profileSkills = [],        // declared in profile
  verifiedProjectIds = [],   // Career Autopilot project ids with verified submissions
  evidenceIndex = null,      // optional Map(evidenceId -> {skill, projectId})
} = {}) {
  const d = normalizeResumeDocument(doc);
  const vSet = toCanonicalSet(verifiedSkills);
  const pSet = toCanonicalSet(profileSkills);
  const vProjects = new Set(verifiedProjectIds.map(String));
  const findings = [];
  const claims = [];

  const provenanceForSkill = (name) => {
    const c = canonicalSkill(name);
    if (vSet.has(c)) return PROVENANCE.VERIFIED;
    if (pSet.has(c)) return PROVENANCE.PROFILE_CONFIRMED;
    return PROVENANCE.USER_ENTERED;
  };

  /* ---- skills section ---- */
  for (const sk of d.skills) {
    const prov = provenanceForSkill(sk.name);
    const status = prov === PROVENANCE.VERIFIED ? 'VERIFIED' : 'DECLARED';
    claims.push({ kind: 'skill', id: sk.id, name: sk.name, provenance: prov, status });
    if (sk.status === 'VERIFIED' && prov !== PROVENANCE.VERIFIED) {
      findings.push({
        id: 'skill_marked_verified_without_verification', severity: 'critical',
        fieldReference: { section: 'skills', itemId: sk.id },
        message: `"${sk.name}" is marked VERIFIED but no server-side verification exists.`,
        recommendedAction: 'Set it to DECLARED, or complete a verified project that proves it.',
      });
    }
  }

  /* ---- verified flags need evidence ---- */
  for (const p of d.projects) {
    if (p.verified && !p.evidenceIds.length && !vProjects.has(p.sourceProjectId)) {
      findings.push({
        id: 'verified_without_evidence', severity: 'critical',
        fieldReference: { section: 'projects', itemId: p.id },
        message: `Project "${p.name}" is marked verified but carries no evidence reference.`,
        recommendedAction: 'Link the verified Career Autopilot project, or remove the verified flag.',
      });
    }
  }

  /* ---- bullets: implied practical usage + fabricated metrics ---- */
  /* Scan against the FULL ontology universe — a bullet claiming Kubernetes
     must be caught even when Kubernetes appears nowhere else on the doc. */
  const skillPool = [...new Set([
    ...verifiedSkills, ...profileSkills, ...d.skills.map((s) => s.name),
    ...allKnownSkills(),
  ])].filter(isKnownSkill);
  for (const b of collectBullets(d)) {
    if (!b.enabled || !b.text) continue;
    const mentioned = skillsMentioned(b.text, skillPool);
    let bulletProv = b.provenance || PROVENANCE.USER_ENTERED;
    const hasEvidence = b.evidenceIds.length > 0 || b.verified ||
      (b.section === 'projects' && b.projectVerified);
    for (const skillName of mentioned) {
      const prov = provenanceForSkill(skillName);
      if (prov === PROVENANCE.VERIFIED || hasEvidence) continue;
      if (prov === PROVENANCE.PROFILE_CONFIRMED) continue; // profile backs the usage claim
      findings.push({
        id: 'unsupported_skill_usage', severity: 'high',
        fieldReference: { section: b.section, itemId: b.itemId, bulletId: b.id },
        skill: skillName,
        message: `"${b.text.slice(0, 80)}" implies practical use of ${skillName}, which is neither verified nor in your profile.`,
        recommendedAction: `Add ${skillName} to your profile if you have used it, build verified evidence, or reword the bullet.`,
      });
      bulletProv = PROVENANCE.UNSUPPORTED;
    }
    if (b.generatedByRule && b.facts && !containsOnlyProvidedNumbers(b.text, b.facts)) {
      findings.push({
        id: 'compiled_metric_mismatch', severity: 'critical',
        fieldReference: { section: b.section, itemId: b.itemId, bulletId: b.id },
        message: 'A compiled bullet contains a number that is not present in its source facts.',
        recommendedAction: 'Recompile the bullet — metrics may only come from data you entered.',
      });
      bulletProv = PROVENANCE.UNSUPPORTED;
    }
    claims.push({
      kind: 'bullet', id: b.id, section: b.section, itemId: b.itemId,
      provenance: hasEvidence ? PROVENANCE.VERIFIED : bulletProv,
      evidenceIds: b.evidenceIds,
      mentionedSkills: mentioned,
    });
  }

  /* ---- evidence id sanity (when an index is provided) ---- */
  if (evidenceIndex instanceof Map) {
    for (const c of claims) {
      for (const eid of c.evidenceIds || []) {
        if (!evidenceIndex.has(eid)) {
          findings.push({
            id: 'unknown_evidence_reference', severity: 'medium',
            fieldReference: { section: c.section, itemId: c.itemId, bulletId: c.id },
            message: `Evidence reference "${eid}" was not found.`,
            recommendedAction: 'Re-link the claim to a real verified task or remove the stale reference.',
          });
        }
      }
    }
  }

  const counts = { VERIFIED: 0, PROFILE_CONFIRMED: 0, USER_ENTERED: 0, UNSUPPORTED: 0 };
  for (const c of claims) counts[c.provenance] = (counts[c.provenance] || 0) + 1;
  const total = claims.length || 1;
  return {
    version: TRUTH_ENGINE_VERSION,
    claims, findings,
    summary: {
      totalClaims: claims.length,
      counts,
      verifiedShare: Math.round((counts.VERIFIED / total) * 100),
      unsupported: counts.UNSUPPORTED,
      critical: findings.filter((f) => f.severity === 'critical').length,
    },
  };
}

export default { TRUTH_ENGINE_VERSION, auditResumeTruth, skillsMentioned };
