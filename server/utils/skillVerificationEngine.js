/* ============================================================
   SKILL VERIFICATION + XP ENGINE  (deterministic, backend-owned)
   ------------------------------------------------------------
   Selecting/building a project NEVER grants verified skills or XP. This
   engine takes a project submission + whatever proof signals exist and
   decides, deterministically:
     - which claimed skills become VERIFIED vs PENDING vs REJECTED
     - the verification METHOD + CONFIDENCE behind each verified skill
     - a signed, tamper-evident CREDENTIAL for each countable skill
     - the overall project verification status
     - how much XP is awarded (verified) vs held (pending)

   Recruiter-trust rule (the important one): a claimed skill only becomes
   VERIFIED when there is medium-or-better evidence behind it — provably
   authored code, a verified live deployment, a detected stack in a verified
   repo, or a human review. A skill that appears only in the free-text
   description is NO LONGER auto-verified; it stays PENDING. A description is
   not proof, and presenting it as verified is exactly what makes a recruiter
   distrust the whole green checkmark.

   Verified skills/XP are the ONLY thing downstream features (resume strength,
   job match, recruiter shortlist, placement readiness) may count. Pending /
   rejected never count. AI is never involved and may never mint or upgrade a
   credential.

   No AI. Same inputs -> same decision.
   ============================================================ */
import { skillPresent } from './resume/skillMatcher.js';
import {
  issueCredential, isCountable, clampConfidence, methodCeiling, summarizeCredentials,
} from './verificationCredentialEngine.js';

export const SKILL_VERIFICATION_VERSION = 'skill-verify-v2';

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
  // Authorship comes from the GitHub App analysis when present.
  const authorship = sub.githubAnalysis?.authorship || null;
  const authorshipVerified = !!(authorship && authorship.authorshipVerified);
  return { hasGithub, githubVerified, hasLive, liveReachable, hasProofUrls, hasCert, descLen, authorship, authorshipVerified };
}

/* Overall project proof tier 0..3. Higher tier = stronger automatic evidence. */
function proofTier(sig) {
  let score = 0;
  if (sig.githubVerified) score += 2; else if (sig.hasGithub) score += 1;
  if (sig.liveReachable) score += 2; else if (sig.hasLive) score += 1;
  if (sig.hasProofUrls) score += 1;
  if (sig.hasCert) score += 1;
  if (sig.descLen >= 200) score += 1;
  if (sig.authorshipVerified) score += 1;
  if (score >= 5) return 3;
  if (score >= 3) return 2;
  if (score >= 1) return 1;
  return 0;
}

/* Decide the verification METHOD + CONFIDENCE for a single claimed skill from
   the available evidence. Returns null when there is no qualifying evidence
   (skill stays pending). This is where the "recruiter-trustable" bar lives.

   HONEST tiering: a passed proctored assessment / live comprehension viva is
   the ONLY automatic route to HIGH — because it tests understanding, not
   artifact possession. GitHub authorship is real but artifact-level, so it
   tops out at MEDIUM no matter how clean the commits look. (Admin review, also
   HIGH, is handled in the main loop.) */
function decideSkillProof(skill, { inCorpus, inGithub, sig, passedAssessment }) {
  // Strongest automatic signal: a passed assessment / viva for this skill.
  if (passedAssessment) {
    return {
      method: 'assessment_passed', confidence: 'high',
      evidence: { signal: 'assessment_passed', kind: passedAssessment.kind || 'viva', score: passedAssessment.score ?? null },
    };
  }
  // Authored or contributed code in a verified repo — medium (artifact-level).
  if (inGithub && sig.authorshipVerified) {
    const authored = sig.authorship?.classification === 'authored';
    return {
      method: authored ? 'github_commit_authored' : 'github_contributor',
      confidence: 'medium',
      evidence: { signal: 'github_authorship', classification: sig.authorship?.classification, share: sig.authorship?.authoredCommitShare },
    };
  }
  if (inGithub) {
    // Detected in a verified repo but authorship unattributed or flagged risky.
    return {
      method: 'github_repo_detected', confidence: 'medium',
      evidence: { signal: 'github_detected', riskFlags: sig.authorship?.riskFlags || [] },
    };
  }
  if (inCorpus && sig.liveReachable) {
    return { method: 'live_demo_verified', confidence: 'medium', evidence: { signal: 'live_demo' } };
  }
  // Description-only mention: NOT enough for a verified credential.
  return null;
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
  const subject = String(sub.subjectId || sub.userId || sub.email || '');
  const issuedAt = sub.submittedAt || sub.issuedAt || new Date().toISOString();

  const verifiedSkills = [];
  const pendingSkills = [];
  const rejectedSkills = [];
  const skillProof = {}; // skill -> { method, confidence, evidence }
  const credentials = [];

  // GitHub auto-detected skills count as strong evidence for a claimed skill.
  const ghDetected = new Set([
    ...((sub.githubAnalysis?.detectedSkills) || []),
    ...((sub.githubAnalysis?.detectedTechStack) || []),
  ].map(norm));

  // Passed assessments / live vivas, keyed by normalized skill. This is the
  // route to HIGH-confidence, recruiter-grade proof.
  const passedBySkill = {};
  for (const a of (sub.assessments || [])) {
    if (a && a.passed) passedBySkill[norm(a.skill)] = a;
  }

  for (const skill of claimed) {
    // Admin override wins — a human reviewer is the highest-trust signal.
    if (adminDecision?.skills && adminDecision.skills[skill]) {
      if (adminDecision.skills[skill] === 'verified') {
        verifiedSkills.push(skill);
        skillProof[skill] = { method: 'admin_reviewed', confidence: 'high', evidence: { signal: 'admin_reviewed', reviewer: adminDecision.reviewer || 'admin' } };
      } else rejectedSkills.push(skill);
      continue;
    }
    const inCorpus = skillPresent(corpus, skill);
    const inGithub = ghDetected.has(skill) || [...ghDetected].some((g) => g.includes(skill) || skill.includes(g));

    const proof = decideSkillProof(skill, { inCorpus, inGithub, sig, passedAssessment: passedBySkill[skill] });
    if (proof && isCountable(proof.confidence)) {
      verifiedSkills.push(skill);
      skillProof[skill] = proof;
    } else {
      // No qualifying proof -> pending (never auto-rejected). A description
      // mention alone lands here on purpose.
      pendingSkills.push(skill);
    }
  }

  // Mint a signed credential for every verified skill. These are what a
  // recruiter (or the public verify endpoint) can independently re-check.
  for (const skill of verifiedSkills) {
    const p = skillProof[skill] || { method: 'github_repo_detected', confidence: 'medium', evidence: {} };
    // Assessment/viva proof is time-bounded (skills decay); artifact and
    // human-review credentials don't auto-expire.
    const validityDays = p.method === 'assessment_passed' ? 365 : null;
    credentials.push(issueCredential({
      subject, claim: skill, claimType: 'skill',
      method: p.method, confidence: p.confidence,
      evidence: { ...p.evidence, projectId: sub.id || sub.projectId || null, repo: sub.githubAnalysis?.repoFullName || null },
      issuedAt, validityDays,
    }));
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
    verificationNotes.push('Claimed skills are held as PENDING until proof is verified. A description alone is not proof — connect the GitHub repo (so authorship can be checked), verify a live demo, or request review.');
  }
  if (pendingSkills.length && verifiedSkills.length) {
    verificationNotes.push(`${pendingSkills.length} skill(s) mentioned only in text are pending — add code/deploy proof to verify them.`);
  }
  if (sig.hasGithub && !sig.githubVerified) verificationNotes.push('GitHub URL provided but not yet analyzed — run repo analysis to strengthen verification.');
  if (sig.githubVerified && !sig.authorshipVerified) verificationNotes.push('Repository analyzed but authorship is unconfirmed — connect the GitHub identity that committed the code to attribute the work.');
  if ((sig.authorship?.riskFlags || []).length) verificationNotes.push(`Commit pattern looks risky (${sig.authorship.riskFlags.join(', ')}) — a copied or single-dump repo can't be attributed as authored work. Iterative history strengthens this.`);
  if (verifiedSkills.length && !verifiedSkills.some((s) => skillProof[s]?.confidence === 'high')) verificationNotes.push('All verified skills are MEDIUM (artifact-level) confidence. HIGH confidence — the tier recruiters trust most — requires passing a live comprehension viva / assessment or human review.');
  if (sig.hasLive && !sig.liveReachable) verificationNotes.push('Live demo URL provided but not yet confirmed reachable.');

  // XP: total pool by complexity, split only across VERIFIED skills (verified
  // XP) and PENDING skills (pending XP). Rejected earns nothing.
  const pool = COMPLEXITY_XP[complexity];
  const perVerified = verifiedSkills.length ? Math.round((pool * 0.7) / verifiedSkills.length) : 0;
  const perPending = pendingSkills.length ? Math.round((pool * 0.3) / pendingSkills.length) : 0;

  const skillXpBreakdown = [
    ...verifiedSkills.map((s) => ({
      skill: s, status: 'verified', xp: perVerified,
      method: skillProof[s]?.method || 'github_repo_detected',
      confidence: skillProof[s]?.confidence || 'medium',
      evidence: skillProof[s]?.method === 'admin_reviewed' ? 'admin'
        : skillProof[s]?.method === 'assessment_passed' ? 'assessment'
        : (skillProof[s]?.method?.startsWith('github') ? 'github' : 'submission'),
    })),
    ...pendingSkills.map((s) => ({ skill: s, status: 'pending', xp: perPending, method: 'self_claim', confidence: 'low', evidence: 'unverified-claim' })),
    ...rejectedSkills.map((s) => ({ skill: s, status: 'rejected', xp: 0, method: 'self_claim', confidence: 'none', evidence: 'rejected' })),
  ];

  const xpAwarded = perVerified * verifiedSkills.length;
  const xpPending = perPending * pendingSkills.length;

  return {
    projectVerificationStatus,
    verifiedSkills,
    pendingSkills,
    rejectedSkills,
    skillProof,
    credentials,
    verificationSummary: summarizeCredentials(credentials),
    xpAwarded,
    xpPending,
    skillXpBreakdown,
    verificationNotes,
    proofTier: tier,
    authorshipVerified: sig.authorshipVerified,
    complexity,
    verificationVersion: SKILL_VERIFICATION_VERSION,
  };
}

export default { verifyProjectSubmission, levelForXp, SKILL_LEVELS, SKILL_VERIFICATION_VERSION };
