/* ============================================================
   Task 2 — "Why Build This?" panel service
   ------------------------------------------------------------
   Deterministic. Explains the career value of a single project
   relative to the user's target role + gaps. AI never required.
   ============================================================ */
import { asList, uniq, clamp, lc } from './util.js';
import { roleFamilyFor } from './config.js';

const HOT = ['ai', 'ml', 'llm', 'cloud', 'aws', 'kubernetes', 'docker', 'react', 'typescript', 'data', 'spark', 'kafka', 'analytics', 'security', 'devops', 'terraform', 'mlops'];

export function whyBuildThis({ project = {}, recommendation = {}, gapSummary = {} } = {}) {
  const targetRole = recommendation.targetRole || project.targetRole || gapSummary.targetRole || 'Software Engineer';
  const fam = roleFamilyFor(targetRole);
  const skills = uniq(asList(recommendation.skills).concat(asList(project.skillsCovered)).concat(asList(project.skills)));
  const skillGapsFixed = uniq(asList(recommendation.skillGapsFixed).concat(asList(gapSummary.roleSkillGaps).filter((g) => skills.some((s) => lc(s) === lc(g)))));
  const proofGapsFixed = uniq(asList(recommendation.proofGapsFixed));
  const expectedProofArtifacts = uniq(asList(recommendation.evidenceNeeded).concat(asList(project.expectedProofArtifacts)));

  const hotCount = skills.filter((s) => HOT.some((h) => lc(s).includes(h))).length;
  const jobReadinessImpact = clamp(recommendation.careerReadinessImpact || (skillGapsFixed.length * 12 + proofGapsFixed.length * 8 + hotCount * 5 + 20), 5, 100);

  // XP impact estimate uses the same building blocks the XP engine rewards.
  const xp = 25 /* repo + readme */ + (proofGapsFixed.length * 10) + (skillGapsFixed.length * 8) + (recommendation.isInnovationGrade ? 20 : 0);

  return {
    targetRoleSupported: targetRole,
    whyThisProject: recommendation.whyRecommended ||
      `For a ${targetRole}, this project turns ${skillGapsFixed.length ? skillGapsFixed.slice(0, 3).join(', ') : 'core role skills'} into recruiter-verifiable proof.`,
    skillGapsFixed,
    proofGapsFixed: proofGapsFixed.length ? proofGapsFixed : ['Creates a public GitHub repo', 'Produces a deployable live demo'],
    recruiterValue: `Recruiters screening for ${targetRole} can see a deployed, tested artifact that proves ${(skillGapsFixed[0] || skills[0] || 'the core skill')} instead of a resume claim.`,
    resumeValue: skillGapsFixed.length
      ? `Backs up ${skillGapsFixed.slice(0, 3).join(', ')} with evidence so they stop being unproven claims.`
      : `Strengthens your ${targetRole} resume with a concrete, defensible project.`,
    jobReadinessImpact,
    expectedProofArtifacts: expectedProofArtifacts.length ? expectedProofArtifacts : fam.proofSignals,
    expectedXPImpact: `+${xp} XP estimate (repo, proof artifacts and skill evidence)`,
    innovationPotential: recommendation.isInnovationGrade
      ? 'Innovation-grade: keeps a patent-readiness trail (dated log, prior-art notes, prototype evidence).'
      : 'Standard portfolio project — focus on a clean, deployed, tested build.',
    recommendationConfidence: recommendation.recommendationConfidence || (jobReadinessImpact >= 70 ? 'High' : jobReadinessImpact >= 45 ? 'Medium' : 'Low'),
  };
}
