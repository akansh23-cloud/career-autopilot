/* ============================================================
   TRUST BOUNDARY (Truth Engine V2) — Resume OS V4
   ------------------------------------------------------------
   THE RULE: a client-side `verified: true`, a `status: 'VERIFIED'`,
   or a client-submitted evidenceId NEVER establishes verification.
   The server evidence store is the only source of trust.

   sanitizeDocumentTrust() re-stamps every trust-bearing field on a
   ResumeDocument from server context before the document is scored,
   matched, persisted, or rendered with badges:

     • skills.status   → VERIFIED only if the server says so
     • item.verified   → true only when backed by a verified project
                         or at least one evidenceId the server knows
     • bullet.verified → same rule
     • evidenceIds     → filtered to ids present in the server index
     • provenance      → downgraded from VERIFIED when unbacked

   The function is pure and returns { doc, changes } so callers can
   surface exactly what was stripped (auditable, never silent).
   With NO server context (db off) everything untrusted is stripped —
   fail closed, not open.
   ============================================================ */
import { normalizeResumeDocument, PROVENANCE } from './resumeDocument.js';
import { canonicalSkill, toCanonicalSet } from './skillOntology.js';

export const TRUST_BOUNDARY_VERSION = 'trust-boundary-v2';

function change(list, kind, where, detail) {
  list.push({ kind, where, detail });
}

export function sanitizeDocumentTrust(doc, {
  verifiedSkills = [],
  verifiedProjectIds = [],
  evidenceIndex = null,       // Map(evidenceId -> meta) — server-owned
} = {}) {
  const d = normalizeResumeDocument(doc);
  const vSet = toCanonicalSet(verifiedSkills);
  const vProjects = new Set(verifiedProjectIds.map(String));
  const knownEvidence = evidenceIndex instanceof Map ? evidenceIndex : new Map();
  const changes = [];

  const keepEvidence = (ids, where) => {
    const kept = (ids || []).filter((id) => knownEvidence.has(id));
    if (kept.length !== (ids || []).length) {
      change(changes, 'evidence_stripped', where, `${(ids || []).length - kept.length} unknown evidence reference(s) removed`);
    }
    return kept;
  };

  /* ---- skills: VERIFIED is earned, never claimed ---- */
  d.skills = d.skills.map((s) => {
    const isVerified = vSet.has(canonicalSkill(s.name));
    if (s.status === 'VERIFIED' && !isVerified) change(changes, 'skill_downgraded', { section: 'skills', itemId: s.id, name: s.name }, 'no server-side verification');
    return { ...s, status: isVerified ? 'VERIFIED' : 'DECLARED' };
  });

  const sanitizeBullet = (b, section, itemId, itemBacked) => {
    const evidenceIds = keepEvidence(b.evidenceIds, { section, itemId, bulletId: b.id });
    const backed = evidenceIds.length > 0 || itemBacked;
    if (b.verified && !backed) change(changes, 'bullet_unverified', { section, itemId, bulletId: b.id }, 'client verified flag without server evidence');
    const provenance = backed
      ? PROVENANCE.VERIFIED
      : (b.provenance === PROVENANCE.VERIFIED ? PROVENANCE.USER_ENTERED : b.provenance);
    if (b.provenance === PROVENANCE.VERIFIED && !backed) change(changes, 'provenance_downgraded', { section, itemId, bulletId: b.id }, 'VERIFIED provenance without backing');
    return { ...b, evidenceIds, verified: backed, provenance };
  };

  const sanitizeItem = (item, section, backers) => {
    const evidenceIds = keepEvidence(item.evidenceIds, { section, itemId: item.id });
    const backed = backers(item, evidenceIds);
    if (item.verified && !backed) change(changes, 'item_unverified', { section, itemId: item.id }, 'client verified flag without server evidence');
    const bullets = (item.bullets || []).map((b) => sanitizeBullet(b, section, item.id, backed));
    const provenance = backed
      ? PROVENANCE.VERIFIED
      : (item.provenance === PROVENANCE.VERIFIED ? PROVENANCE.USER_ENTERED : item.provenance);
    return { ...item, evidenceIds, verified: backed, provenance, bullets };
  };

  d.projects = d.projects.map((p) => sanitizeItem(p, 'projects',
    (item, ev) => vProjects.has(String(item.sourceProjectId || '')) || ev.length > 0));
  d.experience = d.experience.map((e) => sanitizeItem(e, 'experience', (item, ev) => ev.length > 0));
  d.education = d.education.map((e) => ({ ...e, verified: false }));
  d.certifications = d.certifications.map((c) => {
    const ev = keepEvidence(c.evidenceIds, { section: 'certifications', itemId: c.id });
    const backed = ev.length > 0;
    if (c.verified && !backed) change(changes, 'item_unverified', { section: 'certifications', itemId: c.id }, 'client verified flag without server evidence');
    return { ...c, evidenceIds: ev, verified: backed };
  });

  return { doc: normalizeResumeDocument(d), changes, version: TRUST_BOUNDARY_VERSION };
}

export default { TRUST_BOUNDARY_VERSION, sanitizeDocumentTrust };
