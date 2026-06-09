/* ============================================================
   Task 9 — Evidence-backed resume output service
   ------------------------------------------------------------
   Generates DRAFT bullets (allowed before proof) and VERIFIED
   bullets (only when real evidence exists). HARD RULE: an
   unverified project claim is NEVER returned as a verified
   achievement. Deterministic.
   ============================================================ */
import { asList, uniq } from './util.js';

/* What counts as real evidence for a verified bullet. Mirrors the proof
   signals the rest of the app already verifies server-side / via GitHub. */
function evidenceState(project = {}, evidence = {}) {
  const github = !!(project.github?.success || evidence.githubVerified || (project.githubUrl && evidence.githubAnalyzed));
  const live = !!(project.liveVerification?.reachable || evidence.liveVerified);
  const tests = !!(project.github?.files?.tests || evidence.testsVerified);
  const adminVerified = !!(evidence.adminVerified || evidence.facultyVerified);
  return { github, live, tests, adminVerified, any: github || live || tests || adminVerified };
}

export function resumeOutput({ project = {}, recommendation = {}, evidence = {} } = {}) {
  const title = recommendation.title || project.title || 'the project';
  const skills = uniq(asList(recommendation.skills).concat(asList(project.skillsCovered)).concat(asList(project.skills)));
  const role = recommendation.targetRole || project.targetRole || 'engineering';
  const topSkills = skills.slice(0, 4).join(', ') || 'modern web technologies';
  const ev = evidenceState(project, evidence);

  // Draft bullets — explicitly framed as planned/unverified until proof exists.
  const draftResumeBullets = [
    `Built ${title}, a ${role}-focused project using ${topSkills}.`,
    `Designed and implemented the core workflow end-to-end with ${skills[0] || 'a modern stack'}.`,
    `Planned automated tests, CI/CD and a deployed demo to make the work verifiable.`,
  ];

  // Verified bullets — ONLY emitted for evidence that actually exists.
  const verifiedResumeBullets = [];
  if (ev.github) verifiedResumeBullets.push(`Shipped ${title} as a public, analyzed GitHub repository demonstrating ${topSkills}.`);
  if (ev.live) verifiedResumeBullets.push(`Deployed ${title} to a verified live URL with a working end-to-end demo.`);
  if (ev.tests) verifiedResumeBullets.push(`Added an automated test suite to ${title}, validating the core workflow.`);
  if (ev.adminVerified) verifiedResumeBullets.push(`${title} independently verified by ${evidence.adminVerified ? 'a reviewer' : 'faculty'}.`);

  // What proof is still required to upgrade drafts into verified bullets.
  const verificationRequired = [];
  if (!ev.github) verificationRequired.push('Push code and run GitHub analysis (verifies the repo + stack)');
  if (!ev.live) verificationRequired.push('Deploy and verify a live demo URL');
  if (!ev.tests) verificationRequired.push('Add automated tests (a tests/ folder is detected automatically)');

  const unsupportedClaimsWarning = [];
  if (!ev.any) {
    unsupportedClaimsWarning.push('No verified evidence yet — only DRAFT bullets are available. Do not present these as achievements until proof exists.');
  }
  // Flag any skill that the project claims but has not proven via a built artifact.
  const provenSkills = uniq(asList(project.github?.detectedSkills).concat(asList(evidence.provenSkills)));
  const unprovenClaimed = skills.filter((s) => !provenSkills.some((p) => p.toLowerCase() === s.toLowerCase()));
  if (unprovenClaimed.length && !ev.github) {
    unsupportedClaimsWarning.push(`Skills not yet proven by a built artifact: ${unprovenClaimed.slice(0, 5).join(', ')}.`);
  }

  return {
    draftResumeBullets,
    verifiedResumeBullets,
    verificationRequired,
    unsupportedClaimsWarning,
    hardRule: 'Unverified project claims are never returned as verified achievements.',
    evidenceState: ev,
  };
}
