/* Guided Project Workspace — MVP scope builder (deterministic). */
import { arr, str } from './planUtils.js';

export function buildMvpScope(project = {}, stack = {}, features = []) {
  const f = stack.features || {};
  const mustHave = [
    'Project skeleton runs locally (frontend + backend + health check)',
    ...arr(features).map((x) => `MVP feature: ${x.name}`),
    'Primary data model persisted to the database',
    'Basic README + setup instructions',
  ];
  if (f.auth) mustHave.splice(1, 0, 'User sign-in (basic session auth)');
  if (f.upload) mustHave.push('File upload flow (store + list uploads)');

  const shouldHave = [];
  if (f.ai) shouldHave.push('AI/scoring service (placeholder interface first, real model later)');
  if (f.admin) shouldHave.push('Admin dashboard (read-only first)');
  if (f.recruiter) shouldHave.push('Recruiter/secondary-role dashboard');
  shouldHave.push('Basic automated tests (health + one model)', 'Deployed demo URL');

  const later = arr(project.advancedFeatures).map((x) => `Advanced: ${str(x)}`);
  if (f.payments) later.push('Payments integration (sandbox keys only; never commit secrets)');
  if (f.queue) later.push('Background queue/worker for slow jobs');
  if (f.realtime) later.push('Realtime updates (websockets)');
  later.push('Performance hardening, rate limiting, monitoring');

  const excluded = [
    'Production-grade security review (out of MVP scope)',
    'Mobile apps',
    f.payments ? 'Live payment processing (use sandbox mode only)' : 'Payments',
  ];
  return { mustHave: mustHave.slice(0, 12), shouldHave: shouldHave.slice(0, 8), later: later.slice(0, 10), excluded: excluded.slice(0, 6) };
}
