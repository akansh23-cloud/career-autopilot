/* Recruiter ↔ Campus bridge — client data layer.
   -----------------------------------------------------------------
   Thin, failure-safe wrappers over /api/recruiter/*. Every call
   resolves to a well-formed empty shape on ANY failure so the
   console renders its own empty state instead of throwing. A 401/403
   is re-thrown, because "you are not a verified recruiter" is a
   different situation from "there is nothing here yet" and the UI
   must be able to tell them apart.

   None of these endpoints return data on a real deployment yet —
   they serve the demo world. `demo` on each response says which it
   was, and the console surfaces that honestly rather than letting a
   viewer mistake seeded data for their own. */

import { api } from './api.js';

async function get(path, fallback) {
  try {
    const r = await api.get(path);
    if (r && r.ok) return r;
  } catch (e) {
    // Access problems must reach the caller; everything else degrades quietly.
    if (e?.status === 401 || e?.status === 403) throw e;
  }
  return { ok: false, demo: false, ...fallback };
}

export const fetchRecruiterSummary = () => get('/api/recruiter/summary', { summary: null });
export const fetchRequisitions = (status = '') =>
  get(`/api/recruiter/requisitions${status ? `?status=${encodeURIComponent(status)}` : ''}`, { requisitions: [] });
export const fetchRequisitionMatches = (id, limit = 25) =>
  get(`/api/recruiter/requisitions/${encodeURIComponent(id)}/matches?limit=${limit}`, { requisition: null, matches: [] });
export const fetchPipeline = (params = {}) => {
  const qs = new URLSearchParams();
  if (params.requisitionId) qs.set('requisitionId', params.requisitionId);
  if (params.stage) qs.set('stage', params.stage);
  const q = qs.toString();
  return get(`/api/recruiter/pipeline${q ? `?${q}` : ''}`, { pipeline: [], stages: [] });
};
export const fetchCampusPartners = () => get('/api/recruiter/campus-partners', { partners: [] });
export const fetchSkillGap = () => get('/api/recruiter/skill-gap', { gaps: [] });
export const fetchInterviews = () => get('/api/recruiter/interviews', { interviews: [] });

/* Load everything the console needs in one pass. Uses allSettled so a single
   failing endpoint cannot blank the whole dashboard. */
export async function fetchBridgeBundle() {
  const [summary, reqs, pipeline, partners, gaps, interviews] = await Promise.allSettled([
    fetchRecruiterSummary(), fetchRequisitions(), fetchPipeline(),
    fetchCampusPartners(), fetchSkillGap(), fetchInterviews(),
  ]);
  const val = (r, key, dflt) => (r.status === 'fulfilled' ? (r.value?.[key] ?? dflt) : dflt);
  // A 401/403 on any call means the whole console is gated, not just one panel.
  const denied = [summary, reqs, pipeline, partners, gaps, interviews]
    .find((r) => r.status === 'rejected' && (r.reason?.status === 401 || r.reason?.status === 403));
  if (denied) throw denied.reason;

  return {
    summary: val(summary, 'summary', null),
    requisitions: val(reqs, 'requisitions', []),
    pipeline: val(pipeline, 'pipeline', []),
    stages: val(pipeline, 'stages', []),
    partners: val(partners, 'partners', []),
    gaps: val(gaps, 'gaps', []),
    interviews: val(interviews, 'interviews', []),
    demo: summary.status === 'fulfilled' && !!summary.value?.demo,
  };
}

/* ---------------- presentation helpers ---------------- */

export const STAGE_TONE = {
  sourced: 'default', shortlisted: 'cyan', interviewed: 'violet',
  offered: 'amber', accepted: 'mint', rejected: 'rose',
};
export const PARTNER_TONE = {
  connected: 'mint', invited: 'cyan', pending_mou: 'amber', prospect: 'default',
};
export const PARTNER_LABEL = {
  connected: 'Connected', invited: 'Invited', pending_mou: 'MoU in review', prospect: 'Prospect',
};
export const REQ_TYPE_LABEL = {
  campus: 'Campus', internship: 'Internship', off_campus: 'Off campus',
};

export function daysUntil(iso) {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
}

export function relativeDay(iso) {
  const d = daysUntil(iso);
  if (d == null) return '—';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d}d` : `${Math.abs(d)}d ago`;
}

/** Group pipeline rows into the stage columns the board renders. */
export function groupByStage(pipeline = [], stages = []) {
  const map = Object.fromEntries(stages.map((s) => [s.id, []]));
  pipeline.forEach((p) => { (map[p.stage] = map[p.stage] || []).push(p); });
  Object.values(map).forEach((list) => list.sort((a, b) => b.matchScore - a.matchScore));
  return map;
}

/** Conversion between consecutive funnel stages, as percentages. */
export function funnelConversion(funnel = []) {
  // Rejected is a terminal branch, not a step, so it never appears as a rate.
  const flow = funnel.filter((s) => s.id !== 'rejected');
  const cum = [];
  let carried = 0;
  for (let i = flow.length - 1; i >= 0; i--) { carried += flow[i].count; cum[i] = carried; }
  return flow.map((s, i) => ({
    ...s,
    reached: cum[i],
    conversion: i === 0 || !cum[i - 1] ? 100 : Math.round((cum[i] / cum[i - 1]) * 100),
  }));
}
