// Centralized client-cache control for sign-in / sign-out.
//
// All app state in localStorage lives under the "careerAutopilot." namespace
// (some keys user-scoped, a few legacy unscoped). To guarantee one user's data
// can never bleed into another on a shared browser, we wipe the whole namespace
// when the authenticated user changes or signs out. Canonical data is rehydrated
// from the server on the next login, so nothing important is lost.

const NS = 'careerAutopilot.';

export function clearAppCache() {
  if (typeof window === 'undefined') return;
  try {
    const toRemove = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(NS)) toRemove.push(k);
    }
    toRemove.forEach((k) => {
      try { window.localStorage.removeItem(k); } catch { /* ignore */ }
    });
  } catch {
    /* storage blocked — nothing to clear */
  }
}

// Remove any legacy *unscoped* base keys left over from older builds, so a new
// sign-in can never read a previous user's pre-scoping data. Safe to call on
// every app load.
const LEGACY_UNSCOPED_KEYS = [
  'careerAutopilot.resume.v1',
  'careerAutopilot.pendingJobSearch.v1',
  'careerAutopilot.jobResults.v1',
  'careerAutopilot.selectedJob.v1',
  'careerAutopilot.selectedTemplate.v1',
  'careerAutopilot.customTemplate.v1',
  'careerAutopilot.projects.v1',
  'careerAutopilot.partnerRequests.v1',
  'careerAutopilot.projectSeed.v1',
  'careerAutopilot.profile.v1',
  'careerAutopilot.engagement.v1',
  'careerAutopilot.weeklyMissions.v1',
  'careerAutopilot.network.profile.v1',
  'careerAutopilot.network.posts.v1',
  'careerAutopilot.network.requests.v1',
  'careerAutopilot.network.shortlists.v1',
  'careerAutopilot.creator.v1',
];

export function purgeLegacyUnscopedKeys() {
  if (typeof window === 'undefined') return;
  LEGACY_UNSCOPED_KEYS.forEach((k) => {
    try { window.localStorage.removeItem(k); } catch { /* ignore */ }
  });
}
