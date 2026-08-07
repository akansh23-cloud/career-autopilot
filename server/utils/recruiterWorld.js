/* ============================================================
   RECRUITER WORLD — the persistable projection
   ------------------------------------------------------------
   server/utils/demoTalentData.js generates the recruiter side of
   the demo in memory, keyed by synthetic student ids (`demo_007`).
   That is fine locally, where the college cohort is also in memory
   and the two agree by construction.

   On a real deployment the cohort lives in MongoDB and every student
   has an ObjectId. If the recruiter world were written out with its
   synthetic ids, the bridge would break at exactly the moment it
   matters: a recruiter clicks a candidate and the profile does not
   resolve, because no user has that id.

   This module takes the in-memory world and REPROJECTS it onto real
   user ids, producing documents that are safe to write:

     buildRecruiterWorld({ idFor })   idFor: demo id -> ObjectId

   Candidates whose id is not in the map are dropped rather than left
   dangling — a smaller cohort must never leave a pipeline row
   pointing at a student who does not exist.

   Everything here stays obviously synthetic: the org domain ends in
   the IANA-reserved `.test` TLD, every record carries `demo: true`,
   and the scope key is its own, so a wipe can find all of it.
   ============================================================ */

import demoTalent, {
  DEMO_ORG_ID, DEMO_ORG_NAME, DEMO_ORG_DOMAIN, DEMO_RECRUITER_EMAIL,
} from './demoTalentData.js';

export { DEMO_ORG_ID, DEMO_ORG_NAME, DEMO_ORG_DOMAIN, DEMO_RECRUITER_EMAIL };

/** Scope key for every recruiter-side document (mirrors DEMO_COLLEGE_KEY). */
export const DEMO_ORG_KEY = DEMO_ORG_ID;

/** GenericDoc kinds written by the recruiter seed — also the wipe list. */
export const RECRUITER_KINDS = [
  'recruiter_org',
  'recruiter_requisition',
  'recruiter_pipeline',
  'recruiter_interview',
  'recruiter_campus_partner',
];

export function demoOrgRecord() {
  return {
    id: DEMO_ORG_ID,
    key: DEMO_ORG_KEY,
    name: DEMO_ORG_NAME,
    domain: DEMO_ORG_DOMAIN,
    recruiterEmail: DEMO_RECRUITER_EMAIL,
    demo: true,
  };
}

/* Build every recruiter-side record, with candidate ids rewritten.

   `idFor`      Map<demo student id, ObjectId>  — from the college seed
   `collegeKey` scope key the cohort was written under
   `cohortSize` actual number of students seeded (the in-memory world
                hard-codes 200; a resized seed must not report it)      */
export function buildRecruiterWorld({ idFor = new Map(), collegeKey = '', cohortSize = 0 } = {}) {
  const mapped = (id) => (idFor.has(id) ? String(idFor.get(id)) : null);
  const keep = new Set([...idFor.keys()]);

  /* ---- profiles (the consent-gated talent pool) ---- */
  const profiles = demoTalent.demoTalentProfiles()
    .filter((p) => keep.has(p.userId))
    .map((p) => ({
      ...p,
      userId: mapped(p.userId),
      demoUserId: p.userId,
      collegeId: collegeKey || p.collegeId,
      campus: { ...(p.campus || {}), collegeId: collegeKey || p.campus?.collegeId },
    }));

  /* ---- requisitions ---- */
  const requisitions = demoTalent.demoRequisitions().map((r) => ({
    ...r,
    collegeId: r.collegeId ? (collegeKey || r.collegeId) : null,
  }));

  /* ---- pipeline ---- */
  const pipeline = demoTalent.demoPipeline()
    .filter((row) => keep.has(row.candidateId))
    .map((row) => ({
      ...row,
      candidateId: mapped(row.candidateId),
      demoCandidateId: row.candidateId,
      collegeId: row.collegeId ? (collegeKey || row.collegeId) : null,
    }));

  const livePipelineIds = new Set(pipeline.map((p) => p.id));

  /* ---- interviews (only for pipeline rows that survived) ---- */
  const interviews = demoTalent.demoInterviews()
    .filter((iv) => livePipelineIds.has(iv.pipelineId) && keep.has(iv.candidateId))
    .map((iv) => ({
      ...iv,
      candidateId: mapped(iv.candidateId),
      demoCandidateId: iv.candidateId,
    }));

  /* ---- campus partners ---- */
  const partners = demoTalent.demoCampusPartners().map((c) => {
    if (c.status !== 'connected') return c;
    return {
      ...c,
      id: collegeKey || c.id,
      cohortSize: cohortSize || c.cohortSize,
      inPipeline: pipeline.filter((p) => p.collegeId === (collegeKey || c.id)).length,
    };
  });

  return { org: demoOrgRecord(), profiles, requisitions, pipeline, interviews, partners };
}

export default { DEMO_ORG_KEY, RECRUITER_KINDS, demoOrgRecord, buildRecruiterWorld };
