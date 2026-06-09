/* ============================================================
   Task 8 — Proof checklist service
   ------------------------------------------------------------
   Generates minimum / strong / recruiter-ready proof tiers for a
   project and (optionally) reconciles with a passed-in proof
   score breakdown (lib/proofScore.js shape) so the UI can show
   which items are already satisfied. Deterministic.
   ============================================================ */
import { asList, uniq } from './util.js';

/* Map a proof item to a key in the existing proofScore breakdown, so the
   client can mark satisfied items using its REAL evidence (no fake ticks). */
const SATISFIED_BY = {
  'Public GitHub repo': (b) => has(b, 'githubAdded'),
  'README with problem / solution': (b) => has(b, 'readme'),
  'Screenshots of the working app': (b) => has(b, 'screenshots'),
  'Live, deployed demo URL': (b) => has(b, 'liveDemo'),
  'Automated tests': (b) => has(b, 'tests'),
  'CI/CD workflow': (b) => has(b, 'deployment'),
  'Architecture diagram': (b) => has(b, 'architecture'),
  'Verified GitHub analysis': (b) => has(b, 'githubAnalysis'),
  'Recruiter summary': (b) => has(b, 'recruiterSummary'),
  'Interview explanation prepared': (b) => has(b, 'interview'),
};
function has(breakdown, key) {
  if (!breakdown || !Array.isArray(breakdown.rows)) return false;
  const row = breakdown.rows.find((r) => r.key === key);
  return !!(row && row.score >= row.max);
}

export function proofChecklist({ project = {}, recommendation = {}, proofBreakdown = null } = {}) {
  const evidence = uniq(asList(recommendation.evidenceNeeded).concat(asList(project.expectedProofArtifacts)));
  const benchmarkLine = evidence.find((e) => /benchmark|throughput|latency|recall/i.test(e)) || 'A benchmark / measurable result';

  const tiers = {
    minimum: ['Public GitHub repo', 'README with problem / solution', 'Screenshots of the working app'],
    strong: ['Live, deployed demo URL', 'Automated tests', 'CI/CD workflow', 'Architecture diagram'],
    recruiterReady: ['Verified GitHub analysis', 'Demo video', benchmarkLine, 'Deployment URL', 'Clean README with problem / solution / architecture', 'Recruiter summary'],
  };

  const decorate = (items) => items.map((label) => {
    const checker = SATISFIED_BY[label];
    return { label, satisfied: checker ? checker(proofBreakdown) : false, tracked: !!checker };
  });

  const out = { minimum: decorate(tiers.minimum), strong: decorate(tiers.strong), recruiterReady: decorate(tiers.recruiterReady) };
  const flat = [...out.minimum, ...out.strong, ...out.recruiterReady];
  const trackedDone = flat.filter((i) => i.tracked && i.satisfied).length;
  const trackedTotal = flat.filter((i) => i.tracked).length;

  let tier = 'Not started';
  if (out.minimum.every((i) => i.satisfied)) tier = 'Minimum met';
  if (out.minimum.every((i) => i.satisfied) && out.strong.every((i) => i.satisfied)) tier = 'Strong proof';
  if (flat.filter((i) => i.tracked).every((i) => i.satisfied) && trackedTotal) tier = 'Recruiter-ready';

  return {
    ...out,
    currentTier: tier,
    proofScore: proofBreakdown && typeof proofBreakdown.score === 'number' ? proofBreakdown.score : null,
    trackedProgress: trackedTotal ? Math.round((trackedDone / trackedTotal) * 100) : 0,
    note: 'Items marked satisfied use your real verified evidence only — nothing is auto-ticked.',
  };
}
