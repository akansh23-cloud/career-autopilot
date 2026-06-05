// Centralized feature access (Part 2).
// One place that answers "what can THIS user do?". Combines the chosen persona
// role (userProfile) with the billing plan + admin flag (plan.js). Every
// feature gate in the UI should read from getAccessForUser() instead of
// scattering its own checks. The backend remains the source of truth for
// billing and admin — this only gates UI and drives upgrade prompts.

import { getPlan, LIMITS, isUnlimited } from './plan.js';
import { getUserRole } from './userProfile.js';
import { PLAN_BADGE_CAP } from './badges.js';

const U = Infinity;
const ADMIN_LIMITS = { tailoring: U, contacts: U, tracking: U, templates: U, customUpload: true, docx: true, outreach: U, workspaces: U, aiGen: U, sandboxPublish: U };

export function getAccessForUser(user) {
  const plan = getPlan();
  const isAdmin = !!plan.isAdmin;
  // Admin persona overrides the stored persona for routing/features.
  const role = isAdmin ? 'admin' : getUserRole();
  const effectivePlan = isAdmin ? 'admin' : (LIMITS[plan.planId] ? plan.planId : 'free');
  const limits = isAdmin ? ADMIN_LIMITS : (LIMITS[effectivePlan] || LIMITS.free);

  const pro = effectivePlan === 'pro';
  const premium = effectivePlan === 'premium';
  const paid = isAdmin || pro || premium;

  const features = {
    isAdmin,
    // export / templates
    customTemplateUpload: !!limits.customUpload,
    docxExport: !!limits.docx,
    allTemplates: isUnlimited(limits.templates),
    // project studio
    detailedProjectGuide: paid,
    projectEnhancer: paid,
    skillGapToProject: paid,
    progressTracker: paid,
    githubReadmeGenerator: paid,
    resumeBulletGenerator: paid,
    linkedinPostGenerator: paid,
    projectInterviewQuestions: paid,
    partnerMatching: paid,
    // XP + badges
    skillXp: paid,
    verifiedBadges: paid, // Project Verified+ require Pro
    badgeLevelCap: PLAN_BADGE_CAP[effectivePlan] || 'Project Verified',
    deploymentVerification: isAdmin || premium,
    recruiterReadyBadges: isAdmin || premium,
    // analyzers / scores
    githubAnalyzer: paid ? (premium || isAdmin ? 'advanced' : 'basic') : 'none',
    placementReadiness: paid,
    roleFitScore: paid ? (premium || isAdmin ? 'advanced' : 'basic') : 'none',
    // recruiter / premium discovery
    recruiterDiscovery: isAdmin || premium,
    boostedSandbox: isAdmin || premium,
    aiOutreachSequences: isAdmin || premium,
    fullAnalytics: isAdmin || premium,
    advancedReferralFinder: isAdmin || premium,
    advancedResumeTailoring: isAdmin || premium,
  };

  return { role, effectivePlan, isAdmin, limits, features, planId: plan.planId };
}

/* convenience: count helpers honoring unlimited */
export function withinLimit(used, limit) {
  return isUnlimited(limit) || used < limit;
}
