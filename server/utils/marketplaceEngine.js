/* ============================================================
   MARKETPLACE RANKING ENGINE  (deterministic, backend-owned)
   ------------------------------------------------------------
   Computes a 0-100 Marketplace Score for a listing. Clients NEVER decide
   this. Weighted exactly per spec:
     verification / proof ........ 30
     role relevance .............. 20
     engagement .................. 15
     freshness ................... 10
     clone completion success .... 10
     owner credibility ........... 10
     moderation quality ..........  5
   Same inputs -> same score.
   ============================================================ */
export const LISTING_TYPES = [
  'published_project', 'project_idea', 'build_roadmap', 'collaboration_request',
  'mentor_reviewed', 'recruiter_ready', 'template_starter', 'hackathon_team', 'college_capstone',
];

/* CTA(s) shown for each listing type. */
export const LISTING_CTAS = {
  published_project: ['view_proof', 'clone_roadmap', 'save', 'report'],
  project_idea: ['build_this', 'save', 'report'],
  build_roadmap: ['clone_roadmap', 'save', 'report'],
  collaboration_request: ['apply_collaborate', 'save', 'report'],
  mentor_reviewed: ['view_proof', 'request_review', 'save', 'report'],
  recruiter_ready: ['view_proof', 'shortlist_candidate', 'contact_candidate', 'save', 'report'],
  template_starter: ['clone_roadmap', 'save', 'report'],
  hackathon_team: ['apply_collaborate', 'save', 'report'],
  college_capstone: ['view_proof', 'request_review', 'save', 'report'],
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n);

/* verification / proof (30) */
function proofPoints(listing) {
  const max = 30;
  let p = 0;
  if (listing.verificationStatus === 'verified') p += 18;
  else if (listing.verificationStatus === 'needs_review') p += 8;
  else if (listing.verificationStatus === 'pending') p += 4;
  if (listing.githubUrl) p += 4;
  if (listing.liveDemoUrl) p += 4;
  if (Array.isArray(listing.proofUrls) && listing.proofUrls.length) p += 2;
  if (Array.isArray(listing.verifiedSkills) && listing.verifiedSkills.length) p += 2;
  return clamp(p, 0, max);
}

/* role relevance (20) — overlap of listing skills/role with the viewer's
   target role + verified skills. Falls back to listing self-consistency. */
function rolePoints(listing, viewer = {}) {
  const max = 20;
  const want = String(viewer.targetRole || '').toLowerCase();
  const viewerSkills = (viewer.verifiedSkills || []).map((s) => String(s).toLowerCase());
  const listingSkills = [...(listing.tags || []), ...(listing.verifiedSkills || []), ...(listing.claimedSkills || [])].map((s) => String(s).toLowerCase());
  let p = 0;
  if (want && String(listing.targetRole || '').toLowerCase() === want) p += 8;
  else if (want && String(listing.targetRole || '').toLowerCase().includes(want.split(' ')[0])) p += 4;
  if (viewerSkills.length && listingSkills.length) {
    const overlap = listingSkills.filter((s) => viewerSkills.some((v) => v.includes(s) || s.includes(v))).length;
    p += clamp((overlap / Math.max(3, listingSkills.length)) * 12, 0, 12);
  } else if (listingSkills.length) {
    p += 6; // neutral baseline when we don't know the viewer
  }
  return clamp(round(p), 0, max);
}

/* engagement (15) — views, saves, clones, applications, shortlists. */
function engagementPoints(listing) {
  const max = 15;
  const e = (listing.viewCount || 0) * 0.1 + (listing.cloneCount || 0) * 1.5 +
    (listing.applicationCount || 0) * 1.2 + (listing.shortlistCount || 0) * 2 + (listing.saveCount || 0) * 0.8;
  return clamp(round(e), 0, max);
}

/* freshness (10) — decays over ~60 days. */
function freshnessPoints(listing, now = Date.now()) {
  const max = 10;
  const ts = listing.publishedAt ? new Date(listing.publishedAt).getTime() : (listing.createdAt ? new Date(listing.createdAt).getTime() : now);
  const days = Math.max(0, (now - ts) / (1000 * 60 * 60 * 24));
  return clamp(round(max * Math.max(0, 1 - days / 60)), 0, max);
}

/* clone completion success (10) — ratio of clones that reached verified. */
function clonePoints(listing) {
  const max = 10;
  const clones = listing.cloneCount || 0;
  const completed = listing.cloneCompletedCount || 0;
  if (!clones) return 3; // unproven but not penalised to zero
  return clamp(round((completed / clones) * max), 0, max);
}

/* owner credibility (10) — owner's verified XP + verified project count. */
function ownerPoints(listing) {
  const max = 10;
  const xp = listing.ownerVerifiedXp || 0;
  const projects = listing.ownerVerifiedProjects || 0;
  let p = clamp(xp / 200, 0, 6) + clamp(projects * 1, 0, 4);
  return clamp(round(p), 0, max);
}

/* moderation quality (5) */
function moderationPoints(listing) {
  const max = 5;
  if (listing.moderationStatus === 'approved') return max;
  if (listing.moderationStatus === 'flagged') return 1;
  if (listing.moderationStatus === 'hidden') return 0;
  return 3; // default 'pending' moderation
}

export function computeMarketplaceScore(listing = {}, viewer = {}, now = Date.now()) {
  const parts = {
    proof: proofPoints(listing),
    role: rolePoints(listing, viewer),
    engagement: engagementPoints(listing),
    freshness: freshnessPoints(listing, now),
    cloneSuccess: clonePoints(listing),
    owner: ownerPoints(listing),
    moderation: moderationPoints(listing),
  };
  const score = clamp(round(Object.values(parts).reduce((a, b) => a + b, 0)), 0, 100);
  return { score, parts };
}

/* Sort comparators for the documented sort modes. */
export function sortComparator(mode) {
  switch (mode) {
    case 'most_cloned': return (a, b) => (b.cloneCount || 0) - (a.cloneCount || 0);
    case 'recently_published': return (a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0);
    case 'highest_proof': return (a, b) => (b._proof || 0) - (a._proof || 0);
    case 'recruiter_interest': return (a, b) => (b.shortlistCount || 0) - (a.shortlistCount || 0);
    case 'best_for_role':
    case 'best_for_gaps':
    case 'trending':
    default: return (a, b) => (b.marketplaceScore || 0) - (a.marketplaceScore || 0);
  }
}

export default { computeMarketplaceScore, sortComparator, LISTING_TYPES, LISTING_CTAS };
