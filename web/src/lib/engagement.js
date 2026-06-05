// Recruiter engagement store (Part 7 / Part 3 XP).
// Records recruiter shortlist + contact-interest signals locally. These drive
// recruiter-engagement XP and the "Recruiter Ready" badge. Kept separate from
// project data so it survives independently and never mutates the project.

const KEY = 'careerAutopilot.engagement.v1';
export const ENGAGEMENT_EVENT = 'career-engagement-updated';

function read() {
  if (typeof window === 'undefined') return {};
  try { const r = window.localStorage.getItem(KEY); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function write(v) {
  if (typeof window === 'undefined') return v;
  try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
  window.dispatchEvent(new CustomEvent(ENGAGEMENT_EVENT, { detail: v }));
  return v;
}

/* engagement is keyed by projectId → { shortlisted, contacted, at } */
export function getEngagement() { return read(); }
export function engagementFor(projectId) { return read()[projectId] || { shortlisted: false, contacted: false }; }

export function setEngagement(projectId, changes) {
  const all = read();
  all[projectId] = { ...(all[projectId] || {}), ...changes, at: new Date().toISOString() };
  return write(all);
}
export function toggleShortlist(projectId) {
  const cur = engagementFor(projectId);
  return setEngagement(projectId, { shortlisted: !cur.shortlisted });
}
export function markContacted(projectId) { return setEngagement(projectId, { contacted: true }); }

/* total engagement signals (used for career XP) */
export function engagementSignals() {
  const all = read();
  return Object.values(all).reduce((n, e) => n + (e.shortlisted ? 1 : 0) + (e.contacted ? 1 : 0), 0);
}
