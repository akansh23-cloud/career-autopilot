// Career Proof Network — proof-based career network data layer.
// Profiles, leaderboards, referral exchange and recruiter discovery are all
// built from REAL proof: verified projects, Skill XP, evidence-based badges,
// proof scores, readiness, mission streak and recruiter engagement. Nothing is
// fabricated — when there is no data the UI shows empty states.
//
// Backend-first: when MONGODB_URI is configured the server provides a true
// cross-user network (/api/network/*). Otherwise this degrades to user-scoped
// localStorage (the signed-in user only) so the product still works offline /
// single-device, with the same empty states.

import { getProjects, getPublishedProjects, proofScoreBreakdown } from './projectStore.js';
import { csrfHeaders } from './csrf.js';
import { deriveSkillXP, careerXP, projectXP } from './xp.js';
import { deriveBadges } from './badges.js';
import { engagementSignals } from './engagement.js';
import { getProfile } from './userProfile.js';
import { missionStreak, missionStats } from './missions.js';

const PROFILE_KEY = 'careerAutopilot.network.profile.v1';
const POSTS_KEY = 'careerAutopilot.network.posts.v1';
const REQUESTS_KEY = 'careerAutopilot.network.requests.v1';
const SHORTLIST_KEY = 'careerAutopilot.network.shortlists.v1';
export const NETWORK_EVENT = 'career-network-updated';

let currentUser = null;
let currentUserKey = 'guest';
function normKey(user) {
  const raw = user?.email || user?.id || 'guest';
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9@._-]+/g, '_') || 'guest';
}
export function setNetworkUser(user) { currentUser = user || null; currentUserKey = normKey(user); }
export function currentUserId() { return currentUser?.id || currentUser?.email || 'me'; }
function scoped(base) { return `${base}:${currentUserKey}`; }

function read(key) {
  if (typeof window === 'undefined') return null;
  try { const r = window.localStorage.getItem(scoped(key)); return r ? JSON.parse(r) : null; } catch { return null; }
}
function write(key, v) {
  if (typeof window === 'undefined') return v;
  try { window.localStorage.setItem(scoped(key), JSON.stringify(v)); } catch {}
  window.dispatchEvent(new CustomEvent(NETWORK_EVENT, { detail: { key } }));
  return v;
}
export function uid(prefix = 'n') { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`; }

/* ---------------- Plan-aware weekly referral limits ---------------- */
export const REFERRAL_WEEKLY_LIMITS = { free: 3, pro: 15, premium: 60, admin: 1000 };

/* ---------------- Trust score (mirror of server, objective inputs) ---------------- */
export function computeTrust(metrics = {}, engagement = {}, completeness = 0) {
  let s = 0;
  if (completeness >= 70) s += 20; else if (completeness >= 40) s += 10;
  if (metrics.hasGithub) s += 20;
  if (metrics.hasLinkedinOrPortfolio) s += 10;
  if ((metrics.verifiedBadges || 0) > 0) s += Math.min(20, (metrics.verifiedBadges || 0) * 7);
  if ((engagement.referralSuccess || 0) > 0) s += Math.min(20, (engagement.referralSuccess || 0) * 10);
  if ((engagement.shortlistCount || 0) + (engagement.contactCount || 0) > 0) s += 10;
  s -= (engagement.spamReports || 0) * 8;
  s -= (engagement.fakeReports || 0) * 12;
  const score = Math.max(0, Math.min(100, Math.round(s)));
  const level = score >= 80 ? 'Highly Trusted' : score >= 55 ? 'Trusted' : score >= 25 ? 'Building Trust' : 'New';
  return { score, level };
}
export const TRUST_LEVELS = ['New', 'Building Trust', 'Trusted', 'Highly Trusted'];

/* ---------------- Track inference (leaderboard bucket) ---------------- */
export function inferTrack(targetRole = '', skillNames = []) {
  const hay = (String(targetRole) + ' ' + skillNames.join(' ')).toLowerCase();
  const any = (...k) => k.some((w) => hay.includes(w));
  if (any('devops', 'sre', 'platform', 'kubernetes', 'docker', 'terraform', 'cloud', 'ci/cd', 'cicd')) return 'DevOps';
  if (any('ai', 'ml', 'machine learning', 'deep learning', 'data scien', 'llm', 'pytorch', 'tensorflow', 'nlp')) return 'AI/ML';
  if (any('full stack', 'fullstack', 'mern', 'mean')) return 'Full Stack';
  if (any('backend', 'back end', 'api', 'node', 'express', 'spring', 'django', 'microservice')) return 'Backend';
  if (any('frontend', 'front end', 'react', 'vue', 'angular', 'ui', 'ux')) return 'Frontend';
  return 'General';
}

/* ---------------- Build the derived metrics snapshot from real proof ---------------- */
const has = (s) => typeof s === 'string' && s.trim().length > 0;
const daysSince = (iso) => { if (!iso) return 999; const d = (Date.now() - new Date(iso).getTime()) / 86400000; return Number.isFinite(d) ? d : 999; };

export function buildMetricsSnapshot() {
  const projects = getProjects();
  const published = getPublishedProjects();
  const skillXP = deriveSkillXP(projects);
  const badges = deriveBadges(projects);
  const career = careerXP(projects);
  const proofs = projects.map((p) => proofScoreBreakdown(p).score);
  const avgProof = proofs.length ? Math.round(proofs.reduce((a, b) => a + b, 0) / proofs.length) : 0;

  const hasGithub = projects.some((p) => has(p.githubUrl));
  const hasGithubVerified = projects.some((p) => p.github && p.github.success);
  const hasLive = projects.some((p) => has(p.liveDemoUrl));
  const hasLiveVerified = projects.some((p) => p.liveVerification && p.liveVerification.reachable);
  const hasInterview = projects.some((p) => (p.interviewQuestions || []).length);

  const prof = getProfile();
  const links = networkLinks();
  const hasLinkedinOrPortfolio = has(links.linkedin) || has(links.portfolio);

  // readiness (placement) and a job-switch variant
  const verifiedBadges = badges.filter((b) => b.rawLevel && b.rawLevel !== 'Practiced').length;
  const badgeConf = badges.length ? badges.reduce((s, b) => s + b.confidence, 0) / badges.length : 0;
  const readiness = projects.length
    ? Math.round(avgProof * 0.4 + Math.min(100, (career.total / 1500) * 100) * 0.25 + badgeConf * 0.2 + Math.min(100, published.length * 25) * 0.15)
    : 0;
  const jobSwitchReadiness = projects.length
    ? Math.round(avgProof * 0.35 + Math.min(100, (career.total / 1800) * 100) * 0.3 + badgeConf * 0.2 + (hasLiveVerified ? 100 : hasGithubVerified ? 60 : 30) * 0.15)
    : 0;

  // XP gained this week (projects updated in last 7 days + missions completed this week)
  const xpThisWeek = projects
    .filter((p) => daysSince(p.updatedAt || p.createdAt) <= 7)
    .reduce((s, p) => s + projectXP(p).xp, 0) + (missionStats().xpEarned || 0);

  const recentActiveDays = projects.length ? Math.min(...projects.map((p) => daysSince(p.updatedAt || p.createdAt))) : 999;

  const ranked = published.slice().sort((a, b) => proofScoreBreakdown(b).score - proofScoreBreakdown(a).score);
  const bestProjects = ranked.slice(0, 4).map((p) => ({
    id: p.id, title: p.title, proofScore: proofScoreBreakdown(p).score,
    github: p.githubUrl || '', live: p.liveDemoUrl || '',
    skills: (p.skillsCovered || []).slice(0, 5),
    updatedRecently: daysSince(p.updatedAt || p.createdAt) <= 7,
  }));
  const topProject = bestProjects[0] || null;

  const skillNames = skillXP.map((s) => s.skillName);
  const referralContributions = (getReferralPostsLocal().filter((p) => p.authorUserId === currentUserId() && (p.type === 'offering_referral' || p.type === 'mutual')).length);

  const recruiterSignals = engagementSignals();

  return {
    careerXP: career.total, level: career.level,
    topSkills: skillXP.slice(0, 6).map((s) => ({ name: s.skillName, xp: s.xp, level: s.level })),
    skillNames,
    verifiedBadges, badgeCount: badges.length, topBadgeLevel: badges[0]?.level || null,
    avgProofScore: avgProof, readiness, jobSwitchReadiness,
    publishedCount: published.length,
    hasGithub, hasGithubVerified, hasLive, hasLiveVerified, hasInterview, hasLinkedinOrPortfolio,
    missionStreak: missionStreak(), recentActiveDays, xpThisWeek,
    bestProjects, topProject, recruiterSignals, referralContributions,
  };
}

/* ---------------- Local network profile (visibility + links + availability) ---------------- */
const DEFAULT_PROFILE = {
  visibility: 'private',
  openToRecruiters: false, openToReferrals: false, openToCollaboration: false,
  openToInternships: false, openToJobs: false, showEmail: false,
  links: { github: '', linkedin: '', portfolio: '' },
  location: '',
};
export function getNetworkProfileLocal() {
  return { ...DEFAULT_PROFILE, ...(read(PROFILE_KEY) || {}) };
}
export function networkLinks() { return getNetworkProfileLocal().links || {}; }

export function saveNetworkProfileLocal(changes) {
  const next = { ...getNetworkProfileLocal(), ...changes, updatedAt: new Date().toISOString() };
  if (changes.links) next.links = { ...getNetworkProfileLocal().links, ...changes.links };
  write(PROFILE_KEY, next);
  syncProfileToServer(next);
  return next;
}

/* completeness from real signals */
export function profileCompleteness(metrics = buildMetricsSnapshot(), np = getNetworkProfileLocal()) {
  const prof = getProfile();
  const checks = [
    !!(currentUser?.name),
    !!(prof.targetRole || prof.hiringRole),
    !!(np.location || prof.college || prof.company),
    metrics.skillNames.length > 0,
    !!np.links.github,
    !!np.links.linkedin,
    !!np.links.portfolio,
    metrics.publishedCount > 0,
    np.visibility !== 'private',
    (np.openToRecruiters || np.openToReferrals || np.openToCollaboration || np.openToInternships || np.openToJobs),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

/* The full assembled "Career Proof Profile" for the current user. */
export function assembleMyProfile() {
  const prof = getProfile();
  const np = getNetworkProfileLocal();
  const metrics = buildMetricsSnapshot();
  const completeness = profileCompleteness(metrics, np);
  const engagement = { shortlistCount: metrics.recruiterSignals, contactCount: 0, referralSuccess: 0, spamReports: 0, fakeReports: 0 };
  const trust = computeTrust(metrics, engagement, completeness);
  const track = inferTrack(prof.targetRole || prof.hiringRole || '', metrics.skillNames);
  const recruiterSummary = metrics.publishedCount
    ? `Candidate targeting ${prof.targetRole || prof.hiringRole || 'their next role'} with ${metrics.publishedCount} published proof-of-work project(s), ${metrics.verifiedBadges} verified skill badge(s) and an average proof score of ${metrics.avgProofScore}/100.`
    : 'Publish a verified project to generate a recruiter-ready summary.';
  return {
    userId: currentUserId(),
    name: currentUser?.name || 'You',
    email: currentUser?.email || '',
    picture: currentUser?.picture || null,
    role: prof.role || 'student',
    targetRole: prof.targetRole || prof.hiringRole || '',
    track, yearSem: prof.yearSem || '', experience: prof.experience || '',
    location: np.location || '', college: prof.college || '', company: prof.company || '', currentCompany: prof.currentRole || prof.company || '',
    links: np.links, visibility: np.visibility,
    openToRecruiters: np.openToRecruiters, openToReferrals: np.openToReferrals,
    openToCollaboration: np.openToCollaboration, openToInternships: np.openToInternships,
    openToJobs: np.openToJobs, showEmail: np.showEmail,
    metrics, completeness, trustScore: trust.score, trustLevel: trust.level,
    recruiterSummary,
  };
}

/* ---------------- Server sync ---------------- */
async function syncProfileToServer(np = getNetworkProfileLocal()) {
  try {
    const assembled = assembleMyProfile();
    await fetch('/api/network/profile', {
      method: 'PUT', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ profile: assembled }),
    });
  } catch { /* local still works */ }
}
export async function hydrateNetworkFromServer() {
  // push our latest snapshot so leaderboards/recruiter discovery reflect real proof
  try { await syncProfileToServer(); } catch {}
}

/* ---------------- Leaderboards ---------------- */
function networkScore(p) {
  const m = p.metrics || {};
  const skill = Math.min(1, (m.careerXP || 0) / 2000) * 30;
  const proof = ((m.avgProofScore || 0) / 100) * 25;
  const badge = Math.min(1, (m.verifiedBadges || 0) / 5) * 15;
  const evidence = Math.min(10, ((m.hasGithubVerified ? 0.6 : m.hasGithub ? 0.3 : 0) + (m.hasLiveVerified ? 0.4 : m.hasLive ? 0.2 : 0)) * 10);
  const recent = (m.recentActiveDays <= 7 ? 1 : m.recentActiveDays <= 30 ? 0.5 : 0.1) * 5 + Math.min(1, (m.missionStreak || 0) / 4) * 5;
  const recruiter = Math.min(1, (m.recruiterSignals || 0) / 2) * 5;
  const trust = ((p.trustScore || 0) / 100) * 5;
  return Math.round(skill + proof + badge + evidence + recent + recruiter + trust);
}

export async function fetchLeaderboardProfiles() {
  try {
    const r = await fetch('/api/network/leaderboards', { credentials: 'include' });
    if (r.ok) {
      const d = await r.json();
      if (d?.db && Array.isArray(d.profiles)) return d.profiles;
    }
  } catch {}
  // local fallback: just me, if I'm eligible (not private)
  const me = assembleMyProfile();
  return me.visibility !== 'private' && me.metrics.publishedCount > 0 ? [me] : [];
}

export const LEADERBOARD_SEGMENTS = [
  { id: 'fullstack', title: 'Top Full Stack Builders', kind: 'track', track: 'Full Stack' },
  { id: 'devops', title: 'Top DevOps Builders', kind: 'track', track: 'DevOps' },
  { id: 'aiml', title: 'Top AI/ML Builders', kind: 'track', track: 'AI/ML' },
  { id: 'backend', title: 'Top Backend Builders', kind: 'track', track: 'Backend' },
  { id: 'frontend', title: 'Top Frontend Builders', kind: 'track', track: 'Frontend' },
  { id: 'firstyear', title: 'Top First-Year Builders', kind: 'firstyear' },
  { id: 'finalyear', title: 'Top Final-Year Placement Ready', kind: 'finalyear' },
  { id: 'projectweek', title: 'Top Project of the Week', kind: 'projectweek' },
  { id: 'github', title: 'Top GitHub Verified Projects', kind: 'github' },
  { id: 'improved', title: 'Most Improved This Week', kind: 'improved' },
  { id: 'referral', title: 'Top Referral Contributors', kind: 'referral' },
  { id: 'interview', title: 'Top Interview Ready Profiles', kind: 'interview' },
];

export function rankSegment(profiles, segment) {
  let list = profiles.map((p) => ({ ...p, score: networkScore(p) }));
  const yr = (p) => String(p.yearSem || '').toLowerCase();
  switch (segment.kind) {
    case 'track':
      list = list.filter((p) => (p.track || inferTrack(p.targetRole, (p.metrics?.skillNames) || [])) === segment.track);
      list.sort((a, b) => b.score - a.score); break;
    case 'firstyear':
      list = list.filter((p) => /(^|\D)1(st)?\b|first/.test(yr(p)));
      list.sort((a, b) => b.score - a.score); break;
    case 'finalyear':
      list = list.filter((p) => /final|4(th)?\b|iv|last/.test(yr(p)) && (p.metrics?.readiness || 0) >= 50);
      list.sort((a, b) => (b.metrics?.readiness || 0) - (a.metrics?.readiness || 0)); break;
    case 'projectweek':
      list = list.filter((p) => p.metrics?.topProject);
      list.sort((a, b) => (b.metrics.topProject?.proofScore || 0) - (a.metrics.topProject?.proofScore || 0)); break;
    case 'github':
      list = list.filter((p) => p.metrics?.hasGithubVerified);
      list.sort((a, b) => b.score - a.score); break;
    case 'improved':
      list = list.filter((p) => (p.metrics?.xpThisWeek || 0) > 0);
      list.sort((a, b) => (b.metrics.xpThisWeek || 0) - (a.metrics.xpThisWeek || 0)); break;
    case 'referral':
      list = list.filter((p) => (p.metrics?.referralContributions || 0) > 0);
      list.sort((a, b) => (b.metrics.referralContributions || 0) - (a.metrics.referralContributions || 0)); break;
    case 'interview':
      list = list.filter((p) => p.metrics?.hasInterview && (p.metrics?.readiness || 0) >= 50);
      list.sort((a, b) => (b.metrics.readiness || 0) - (a.metrics.readiness || 0)); break;
    default:
      list.sort((a, b) => b.score - a.score);
  }
  return list;
}

/* ---------------- Recruiter candidate discovery ---------------- */
export async function fetchCandidates() {
  try {
    const r = await fetch('/api/network/candidates', { credentials: 'include' });
    if (r.ok) {
      const d = await r.json();
      if (d?.db && Array.isArray(d.profiles)) return d.profiles;
    }
  } catch {}
  const me = assembleMyProfile();
  const eligible = me.openToRecruiters || me.visibility === 'public' || me.metrics.publishedCount > 0;
  return eligible && me.metrics.publishedCount > 0 ? [me] : [];
}

export function roleFitForProfile(p, query = {}) {
  const m = p.metrics || {};
  const wanted = (query.skills || []).map((s) => s.toLowerCase()).filter(Boolean);
  const owned = (m.skillNames || []).map((s) => s.toLowerCase());
  let skillPart = 30;
  if (wanted.length) {
    const matched = wanted.filter((w) => owned.some((o) => o.includes(w) || w.includes(o))).length;
    skillPart = 30 * (matched / wanted.length);
  } else skillPart = 30 * Math.min(1, (m.careerXP || 0) / 1500);
  const proofPart = 25 * ((m.avgProofScore || 0) / 100);
  const links = 15 * ((m.hasGithub ? 0.6 : 0) + (m.hasLive ? 0.4 : 0));
  const roleMatch = query.role && p.targetRole
    ? ((p.targetRole.toLowerCase().includes(query.role.toLowerCase()) || query.role.toLowerCase().includes(p.targetRole.toLowerCase())) ? 1 : 0.4)
    : 0.6;
  const resumePart = 10 * roleMatch;
  const interviewPart = 10 * (m.hasInterview ? 1 : 0);
  const recentPart = 5 * (m.recentActiveDays <= 14 ? 1 : m.recentActiveDays <= 45 ? 0.5 : 0.1);
  const trustPart = 5 * ((p.trustScore || 0) / 100);
  return Math.round(Math.max(0, Math.min(100, skillPart + proofPart + links + resumePart + interviewPart + recentPart + trustPart)));
}

/* ---------------- Referral posts (community feed) ---------------- */
export const POST_TYPES = [
  { id: 'need_referral', label: 'Need Referral' },
  { id: 'offering_referral', label: 'Offering Referral' },
  { id: 'mutual', label: 'Mutual Referral Exchange' },
  { id: 'interview_exp', label: 'Interview Experience' },
  { id: 'hiring_alert', label: 'Hiring / Internship Alert' },
  { id: 'collab', label: 'Project Collaboration' },
  { id: 'showcase', label: 'Project Showcase' },
  { id: 'startup_idea', label: 'Startup Idea Discussion' },
];
export const POST_TYPE_LABEL = Object.fromEntries(POST_TYPES.map((t) => [t.id, t.label]));

function getReferralPostsLocal() { const l = read(POSTS_KEY); return Array.isArray(l) ? l : []; }

export async function fetchPosts(type) {
  try {
    const r = await fetch('/api/network/posts' + (type ? `?type=${encodeURIComponent(type)}` : ''), { credentials: 'include' });
    if (r.ok) {
      const d = await r.json();
      if (d?.db && Array.isArray(d.posts)) return d.posts;
    }
  } catch {}
  let list = getReferralPostsLocal();
  if (type) list = list.filter((p) => p.type === type);
  return list;
}

export async function createPost(type, fields) {
  const me = assembleMyProfile();
  // optimistic local store (also the offline source of truth)
  const local = getReferralPostsLocal();
  const post = {
    id: uid('post'), authorUserId: currentUserId(), authorName: me.name, authorPicture: me.picture,
    authorTrust: me.trustScore, type, fields: fields || {}, reports: 0, status: 'open',
    createdAt: new Date().toISOString(),
  };
  write(POSTS_KEY, [post, ...local]);
  try {
    const r = await fetch('/api/network/posts', {
      method: 'POST', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ type, fields }),
    });
    if (r.ok) { const d = await r.json(); if (d?.post) return d.post; }
  } catch {}
  return post;
}

export async function deletePost(id) {
  write(POSTS_KEY, getReferralPostsLocal().filter((p) => p.id !== id));
  try { await fetch('/api/network/posts/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include', headers: csrfHeaders() }); } catch {}
}

export async function reportPost(id) {
  const list = getReferralPostsLocal().map((p) => p.id === id ? { ...p, reports: (p.reports || 0) + 1 } : p);
  write(POSTS_KEY, list);
  try { await fetch('/api/network/posts/' + encodeURIComponent(id) + '/report', { method: 'POST', credentials: 'include', headers: csrfHeaders() }); } catch {}
}

/* ---------------- Mutual referral matching ----------------
   A↔B match: A works/can refer at companyA and wants companyB; B works/can
   refer at companyB and wants companyA. Built from need_referral + mutual posts. */
export function findMutualMatches(posts, me) {
  const lc = (s) => String(s || '').trim().toLowerCase();
  const myPosts = posts.filter((p) => p.authorUserId === me.userId && (p.type === 'mutual' || p.type === 'need_referral'));
  const others = posts.filter((p) => p.authorUserId !== me.userId && (p.type === 'mutual' || p.type === 'need_referral' || p.type === 'offering_referral'));
  const matches = [];
  for (const mine of myPosts) {
    const myCompany = lc(mine.fields.currentCompany || mine.fields.companyA);
    const iWant = lc(mine.fields.targetCompany || mine.fields.companyB);
    for (const o of others) {
      const theirCompany = lc(o.fields.currentCompany || o.fields.company || o.fields.companyA);
      const theyWant = lc(o.fields.targetCompany || o.fields.companyB);
      if (!theirCompany) continue;
      const theyCanReferWhereIWant = !!(iWant && theirCompany.includes(iWant));
      const iCanReferWhereTheyWant = !!(theyWant && myCompany && myCompany.includes(theyWant));
      const score = (theyCanReferWhereIWant ? 60 : 0) + (iCanReferWhereTheyWant ? 40 : 0);
      if (score >= 40) matches.push({ mine, other: o, score, mutual: theyCanReferWhereIWant && iCanReferWhereTheyWant });
    }
  }
  return matches.sort((a, b) => b.score - a.score);
}

/* ---------------- Referral requests (anti-spam weekly limit) ---------------- */
function getRequestsLocal() { const l = read(REQUESTS_KEY); return Array.isArray(l) ? l : []; }
export function recentRequestCount() {
  const since = Date.now() - 7 * 86400000;
  return getRequestsLocal().filter((r) => new Date(r.createdAt).getTime() >= since).length;
}
export function referralLimitFor(effectivePlan) { return REFERRAL_WEEKLY_LIMITS[effectivePlan] ?? REFERRAL_WEEKLY_LIMITS.free; }

export async function sendReferralRequest({ toUserId, postId, kind, message, effectivePlan, isAdmin }) {
  const limit = referralLimitFor(effectivePlan);
  if (!isAdmin && recentRequestCount() >= limit) {
    return { ok: false, error: 'weekly_limit_reached', limit, used: recentRequestCount() };
  }
  const local = getRequestsLocal();
  const reqObj = { id: uid('req'), toUserId: toUserId || null, postId: postId || null, kind: kind || 'request', message: message || '', status: 'sent', createdAt: new Date().toISOString() };
  write(REQUESTS_KEY, [reqObj, ...local]);
  try {
    const r = await fetch('/api/network/requests', {
      method: 'POST', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ toUserId, postId, kind, message }),
    });
    if (r.status === 429) { const d = await r.json().catch(() => ({})); return { ok: false, error: 'weekly_limit_reached', limit: d.limit || limit, used: d.used }; }
  } catch {}
  return { ok: true, limit, used: recentRequestCount() };
}

/* ---------------- Shortlists ---------------- */
function getShortlistsLocal() { const l = read(SHORTLIST_KEY); return Array.isArray(l) ? l : []; }
export function isShortlisted(candidateUserId) { return getShortlistsLocal().some((s) => s.candidateUserId === candidateUserId); }
export async function toggleShortlistCandidate(candidateUserId, note = '') {
  const list = getShortlistsLocal();
  const exists = list.some((s) => s.candidateUserId === candidateUserId);
  const next = exists ? list.filter((s) => s.candidateUserId !== candidateUserId) : [{ candidateUserId, note, createdAt: new Date().toISOString() }, ...list];
  write(SHORTLIST_KEY, next);
  if (!exists) {
    try { await fetch('/api/network/shortlists', { method: 'POST', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ candidateUserId, note }) }); } catch {}
  }
  return !exists;
}
export function getShortlists() { return getShortlistsLocal(); }

/* ---------------- Public profile share link + fetch ---------------- */
export function shareLink() {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/#/profile/${encodeURIComponent(currentUserId())}`;
}
export async function fetchPublicProfile(userId) {
  try {
    const r = await fetch('/api/network/profile/' + encodeURIComponent(userId), { credentials: 'include' });
    if (r.ok) { const d = await r.json(); if (d?.ok) return d; }
  } catch {}
  // local fallback: only resolvable id is me
  if (String(userId) === String(currentUserId())) return { ok: true, profile: assembleMyProfile() };
  return { ok: false, reason: 'not_found' };
}

/* ---------------- Adoption suggestions (Part 10) ---------------- */
export function adoptionSuggestions(profile = assembleMyProfile()) {
  const m = profile.metrics; const out = [];
  if (!profile.links.github) out.push({ text: 'Add your GitHub to become eligible for Top GitHub Verified Projects.', cta: 'profile' });
  if (!m.hasLiveVerified && m.publishedCount > 0) out.push({ text: 'Verify a live demo to earn the Deployment Verified badge.', cta: 'sandbox' });
  if (profile.completeness < 100) {
    const missing = [];
    if (!profile.links.linkedin) missing.push('LinkedIn');
    if (!profile.links.github) missing.push('GitHub');
    if (profile.visibility === 'private') missing.push('a public visibility setting');
    out.push({ text: `Your profile is ${profile.completeness}% complete${missing.length ? `. Add ${missing.join(' + ')} to appear in recruiter search.` : '.'}`, cta: 'profile' });
  }
  if (m.publishedCount === 0) out.push({ text: 'Publish your first verified project to enter the leaderboards.', cta: 'sandbox' });
  if (!m.hasInterview && m.publishedCount > 0) out.push({ text: 'Add interview prep to a project to reach Top Interview Ready Profiles.', cta: 'projectstudio' });
  return out.slice(0, 4);
}
