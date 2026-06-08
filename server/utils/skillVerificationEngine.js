/* ============================================================
   SKILL VERIFICATION + XP ENGINE  (deterministic, backend-owned)
   ------------------------------------------------------------
   Selecting/building a project NEVER grants verified skills or XP. This
   engine takes a project submission + whatever proof signals exist and
   decides, deterministically:
     - which claimed skills become VERIFIED vs PENDING vs REJECTED
     - the overall project verification status
     - how much XP is awarded (verified) vs held (pending)

   Verified skills/XP are the ONLY thing that downstream features
   (resume strength, job match, recruiter shortlist, placement readiness)
   are allowed to count. Pending/rejected never count — enforced here and
   in the routes that read these records.

   No AI. Same inputs -> same decision.
   ============================================================ */
import { skillPresent } from './resume/skillMatcher.js';

export const SKILL_VERIFICATION_VERSION = 'skill-verify-v1';

/* XP per project by complexity, then split across the verified skills. */
const COMPLEXITY_XP = { beginner: 60, basic: 100, intermediate: 180, advanced: 300, expert: 450 };

/* Verified-XP -> level thresholds (verified XP only). */
export const SKILL_LEVELS = [
  { min: 1500, level: 'Expert' },
  { min: 700, level: 'Advanced' },
  { min: 300, level: 'Intermediate' },
  { min: 100, level: 'Basic' },
  { min: 0, level: 'Beginner' },
];

export function levelForXp(verifiedXp = 0) {
  for (const t of SKILL_LEVELS) if (verifiedXp >= t.min) return t.level;
  return 'Beginner';
}

function norm(s) { return String(s || '').toLowerCase().trim(); }
function clampComplexity(c) {
  const v = norm(c);
  return COMPLEXITY_XP[v] != null ? v : 'intermediate';
}

/* Build the searchable evidence text from a submission's proof fields. */
function evidenceCorpus(sub = {}) {
  return [
    sub.description, sub.outcome, sub.roleInProject, sub.contributionType,
    (sub.technologies || []).join(' '),
    sub.githubAnalysis ? JSON.stringify(sub.githubAnalysis) : '',
    sub.readmeText || '',
  ].filter(Boolean).join('\n').toLowerCase();
}

/* Proof strength signals (deterministic booleans/counts). */
function proofSignals(sub = {}) {
  const hasGithub = !!norm(sub.githubUrl) && /github\.com\//.test(norm(sub.githubUrl));
  const githubVerified = !!(sub.githubAnalysis && (sub.githubAnalysis.exists || sub.githubAnalysis.detectedSkills?.length || sub.githubAnalysis.detectedTechStack?.length));
  const hasLive = !!norm(sub.liveDemoUrl);
  const liveReachable = !!(sub.liveLinkCheck && sub.liveLinkCheck.reachable);
  const hasProofUrls = Array.isArray(sub.proofUrls) && sub.proofUrls.filter(Boolean).length > 0;
  const hasCert = !!norm(sub.certificateUrl);
  const descLen = norm(sub.description).length + norm(sub.outcome).length;
  return { hasGithub, githubVerified, hasLive, liveReachable, hasProofUrls, hasCert, descLen };
}

/* Overall project proof tier 0..3. Higher tier = stronger automatic evidence. */
function proofTier(sig) {
  let score = 0;
  if (sig.githubVerified) score += 2; else if (sig.hasGithub) score += 1;
  if (sig.liveReachable) score += 2; else if (sig.hasLive) score += 1;
  if (sig.hasProofUrls) score += 1;
  if (sig.hasCert) score += 1;
  if (sig.descLen >= 200) score += 1;
  if (score >= 5) return 3;
  if (score >= 3) return 2;
  if (score >= 1) return 1;
  return 0;
}

/* ------------------------------------------------------------------
   MAIN: verify a project submission.
   `adminDecision` (optional) lets a manual reviewer force an outcome:
   { status: 'verified'|'rejected'|'needs_review', skills: { skillName: 'verified'|'rejected' } }
   ------------------------------------------------------------------ */
export function verifyProjectSubmission(sub = {}, adminDecision = null) {
  const claimed = Array.from(new Set((sub.claimedSkills || []).map(norm).filter(Boolean)));
  const corpus = evidenceCorpus(sub);
  const sig = proofSignals(sub);
  const tier = proofTier(sig);
  const complexity = clampComplexity(sub.complexityLevel);
  const verificationNotes = [];

  const verifiedSkills = [];
  const pendingSkills = [];
  const rejectedSkills = [];

  // GitHub auto-detected skills count as strong evidence for a claimed skill.
  const ghDetected = new Set([
    ...((sub.githubAnalysis?.detectedSkills) || []),
    ...((sub.githubAnalysis?.detectedTechStack) || []),
  ].map(norm));

  for (const skill of claimed) {
    // Admin override wins.
    if (adminDecision?.skills && adminDecision.skills[skill]) {
      if (adminDecision.skills[skill] === 'verified') verifiedSkills.push(skill);
      else rejectedSkills.push(skill);
      continue;
    }
    const inCorpus = skillPresent(corpus, skill);
    const inGithub = ghDetected.has(skill) || [...ghDetected].some((g) => g.includes(skill) || skill.includes(g));

    // Verified when there's real evidence: detected in repo, OR mentioned in a
    // well-proven (tier>=2) submission. Otherwise it stays pending. We never
    // auto-reject a claimed skill (a human/admin can reject); absence of proof
    // simply means "pending".
    if (inGithub || (inCorpus && tier >= 2)) verifiedSkills.push(skill);
    else pendingSkills.push(skill);
  }

  // Overall project status.
  let projectVerificationStatus;
  if (adminDecision?.status) projectVerificationStatus = adminDecision.status;
  else if (tier >= 2 && verifiedSkills.length) projectVerificationStatus = 'verified';
  else if (tier === 0 && !sig.hasGithub && !sig.hasLive && !sig.hasProofUrls) {
    projectVerificationStatus = 'needs_review';
    verificationNotes.push('No verifiable proof (GitHub, live demo, or proof links) was provided — submit proof to earn verified XP.');
  } else projectVerificationStatus = 'pending';

  if (!verifiedSkills.length && claimed.length) {
    verificationNotes.push('Claimed skills are held as PENDING until proof is verified. Pending skills do not count toward resume, job match, or recruiter scoring.');
  }
  if (sig.hasGithub && !sig.githubVerified) verificationNotes.push('GitHub URL provided but not yet analyzed — run repo analysis to strengthen verification.');
  if (sig.hasLive && !sig.liveReachable) verificationNotes.push('Live demo URL provided but not yet confirmed reachable.');

  // XP: total pool by complexity, split only across VERIFIED skills (verified
  // XP) and PENDING skills (pending XP). Rejected earns nothing.
  const pool = COMPLEXITY_XP[complexity];
  const perVerified = verifiedSkills.length ? Math.round((pool * 0.7) / verifiedSkills.length) : 0;
  const perPending = pendingSkills.length ? Math.round((pool * 0.3) / pendingSkills.length) : 0;

  const skillXpBreakdown = [
    ...verifiedSkills.map((s) => ({ skill: s, status: 'verified', xp: perVerified, evidence: ghDetected.has(s) ? 'github' : 'submission' })),
    ...pendingSkills.map((s) => ({ skill: s, status: 'pending', xp: perPending, evidence: 'unverified-claim' })),
    ...rejectedSkills.map((s) => ({ skill: s, status: 'rejected', xp: 0, evidence: 'rejected' })),
  ];

  const xpAwarded = perVerified * verifiedSkills.length;
  const xpPending = perPending * pendingSkills.length;

  return {
    projectVerificationStatus,
    verifiedSkills,
    pendingSkills,
    rejectedSkills,
    xpAwarded,
    xpPending,
    skillXpBreakdown,
    verificationNotes,
    proofTier: tier,
    complexity,
    verificationVersion: SKILL_VERIFICATION_VERSION,
  };
}

export default { verifyProjectSubmission, levelForXp, SKILL_LEVELS, SKILL_VERIFICATION_VERSION };
