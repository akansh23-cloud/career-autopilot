/* ============================================================
   MASTER CAREER PROFILE — one source of truth per user
   ------------------------------------------------------------
   Assembled (never duplicated) from what the platform already
   knows: saved profile, verified project submissions, verified
   skills, GitHub-proven skills. Resume documents are SEEDED
   from this — variants select from it instead of retyping.

   assembleMasterProfile() is pure shaping; the route feeds it
   real db reads. seedResumeDocument() turns it into a canonical
   ResumeDocument with honest provenance on every item.
   ============================================================ */
import { normalizeResumeDocument, PROVENANCE, makeId } from './resumeDocument.js';
import { canonicalSkill, toCanonicalSet } from './skillOntology.js';

export const MASTER_PROFILE_VERSION = 'master-profile-v1';

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, m = 400) => String(v == null ? '' : v).slice(0, m);

export function assembleMasterProfile({
  profile = {}, user = {}, submissions = [], verifiedSkills = [], provenSkills = [], resumeSnapshot = null,
} = {}) {
  const vSet = toCanonicalSet(verifiedSkills);
  const declared = arr(profile.skills).map((s) => str(s, 60)).filter(Boolean);

  const projects = arr(submissions).map((s) => {
    const status = String(s.verificationStatus || '').toLowerCase();
    const verified = status === 'verified';
    return {
      sourceProjectId: str(s._id || s.id || '', 60),
      name: str(s.title, 140),
      description: str(s.description, 800),
      technologies: arr(s.technologies).map((t) => str(t, 50)),
      githubUrl: str(s.githubUrl, 200),
      liveDemoUrl: str(s.liveDemoUrl, 200),
      startDate: str(s.startDate, 20),
      endDate: str(s.endDate, 20),
      outcome: str(s.outcome, 400),
      verified,
      verificationStatus: status || 'pending',
      verifiedSkills: arr(s.verifiedSkills).map((x) => str(x, 50)),
      evidenceIds: [
        ...(s.githubUrl ? [`evidence:github:${str(s._id || s.id, 40)}`] : []),
        ...(s.liveDemoUrl ? [`evidence:live:${str(s._id || s.id, 40)}`] : []),
        ...arr(s.proofUrls).slice(0, 5).map((_, i) => `evidence:proof:${str(s._id || s.id, 40)}:${i}`),
      ],
    };
  });

  const skills = [];
  const seen = new Set();
  const pushSkill = (name, status) => {
    const c = canonicalSkill(name);
    if (!c || seen.has(c)) return;
    seen.add(c);
    skills.push({ name: str(name, 60), canonical: c, status });
  };
  for (const s of verifiedSkills) pushSkill(s, 'VERIFIED');
  for (const s of declared) pushSkill(s, vSet.has(canonicalSkill(s)) ? 'VERIFIED' : 'DECLARED');
  for (const s of provenSkills) pushSkill(s, 'DECLARED'); // GitHub-detected: strong signal, still not verification

  return {
    version: MASTER_PROFILE_VERSION,
    identity: {
      name: str(profile.name || user.name, 90),
      email: str(user.email || profile.email, 120),
      phone: str(profile.phone, 40),
      location: str(profile.location, 90),
      linkedin: str(profile.linkedin, 160),
      github: str(profile.github, 160),
      portfolio: str(profile.portfolio || profile.website, 160),
      headline: str(profile.headline || profile.title, 120),
      targetRole: str(profile.targetRole || user.targetRole, 120),
    },
    summary: str(profile.summary || profile.about, 1200),
    education: arr(profile.education).map((e) => (typeof e === 'string' ? { school: e } : {
      school: str(e.school || e.institution, 160), degree: str(e.degree, 160),
      startDate: str(e.startDate, 20), endDate: str(e.endDate, 20), dates: str(e.dates, 60),
      details: arr(e.details).map((d) => str(d, 300)).slice(0, 6),
    })),
    experience: arr(profile.experience).map((e) => ({
      company: str(e.company, 120), role: str(e.role || e.title, 120), location: str(e.location, 80),
      startDate: str(e.startDate, 20), endDate: str(e.endDate, 20), dates: str(e.dates, 60),
      current: e.current === true || /present|current/i.test(str(e.endDate) + str(e.dates)),
      bullets: arr(e.bullets || e.highlights).map((b) => str(b, 500)).slice(0, 12),
    })),
    certifications: arr(profile.certifications).map((c) => str(typeof c === 'string' ? c : c.name, 200)),
    achievements: arr(profile.achievements).map((a) => str(typeof a === 'string' ? a : a.text, 300)),
    skills, projects,
    counts: {
      verifiedSkills: skills.filter((s) => s.status === 'VERIFIED').length,
      declaredSkills: skills.filter((s) => s.status === 'DECLARED').length,
      verifiedProjects: projects.filter((p) => p.verified).length,
      totalProjects: projects.length,
    },
    hasResumeSnapshot: !!(resumeSnapshot && resumeSnapshot.text),
  };
}

/* Master profile -> canonical ResumeDocument seed with honest provenance. */
export function seedResumeDocument(master, { title = '', targetRole = '', templateId = 'atlas' } = {}) {
  const m = master || {};
  const id = m.identity || {};
  const doc = normalizeResumeDocument({
    title: title || (id.name ? `${id.name} — ${targetRole || id.targetRole || 'Resume'}` : 'My Resume'),
    targetRole: targetRole || id.targetRole || '',
    templateId,
    contact: {
      name: id.name, title: id.headline, email: id.email, phone: id.phone, location: id.location,
      linkedin: id.linkedin, github: id.github, portfolio: id.portfolio,
    },
    summary: m.summary || '',
    skills: arr(m.skills).map((s) => ({ name: s.name, status: s.status, id: makeId('sk', s.canonical) })),
    experience: arr(m.experience).map((e) => ({
      ...e,
      provenance: PROVENANCE.PROFILE_CONFIRMED,
      bullets: arr(e.bullets).map((t) => ({ text: t, sourceType: 'profile', provenance: PROVENANCE.PROFILE_CONFIRMED })),
    })),
    projects: arr(m.projects).map((p) => ({
      name: p.name, techStack: arr(p.technologies).join(', '), link: p.githubUrl || p.liveDemoUrl,
      startDate: p.startDate, endDate: p.endDate,
      sourceProjectId: p.sourceProjectId, verified: p.verified, evidenceIds: p.evidenceIds,
      provenance: p.verified ? PROVENANCE.VERIFIED : PROVENANCE.PROFILE_CONFIRMED,
      bullets: [
        ...(p.description ? [{ text: p.description.split(/(?<=\.)\s+/)[0].slice(0, 220), sourceType: 'project', sourceId: p.sourceProjectId, evidenceIds: p.evidenceIds.slice(0, 2), verified: p.verified, provenance: p.verified ? PROVENANCE.VERIFIED : PROVENANCE.PROFILE_CONFIRMED }] : []),
        ...(p.outcome ? [{ text: p.outcome.slice(0, 220), sourceType: 'project', sourceId: p.sourceProjectId, verified: p.verified, provenance: p.verified ? PROVENANCE.VERIFIED : PROVENANCE.PROFILE_CONFIRMED }] : []),
      ],
    })),
    education: arr(m.education),
    certifications: arr(m.certifications).map((t) => ({ text: t, provenance: PROVENANCE.PROFILE_CONFIRMED })),
    achievements: arr(m.achievements).map((t) => ({ text: t, provenance: PROVENANCE.PROFILE_CONFIRMED })),
    provenanceNote: 'Seeded from Master Career Profile — items carry their real verification state; nothing was invented.',
  });
  return doc;
}

/* Evidence index for the Truth Engine (evidenceId -> meta). */
export function buildEvidenceIndex(master) {
  const idx = new Map();
  for (const p of arr(master?.projects)) {
    for (const eid of arr(p.evidenceIds)) idx.set(eid, { projectId: p.sourceProjectId, projectName: p.name, verified: p.verified });
  }
  return idx;
}

/* Newly-verified opportunities: verified skills/projects absent from a doc. */
export function detectEvidenceOpportunities(doc, master) {
  const d = normalizeResumeDocument(doc);
  const docSkillSet = toCanonicalSet(d.skills.filter((s) => s.enabled).map((s) => s.name));
  const docProjectIds = new Set(d.projects.map((p) => p.sourceProjectId).filter(Boolean));
  const out = [];
  for (const s of arr(master?.skills)) {
    if (s.status === 'VERIFIED' && !docSkillSet.has(s.canonical)) {
      out.push({ type: 'verified_skill_absent', skill: s.name, label: `${s.name} is VERIFIED but not on this resume.`, cta: 'Add to skills' });
    }
  }
  for (const p of arr(master?.projects)) {
    if (p.verified && p.sourceProjectId && !docProjectIds.has(p.sourceProjectId)) {
      out.push({ type: 'verified_project_absent', projectId: p.sourceProjectId, projectName: p.name, skills: p.verifiedSkills, label: `Verified project "${p.name}" is not on this resume.`, cta: 'Add project' });
    }
  }
  return out;
}

export default { MASTER_PROFILE_VERSION, assembleMasterProfile, seedResumeDocument, buildEvidenceIndex, detectEvidenceOpportunities };
