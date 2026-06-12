/* ============================================================
   Synthesis Intelligence — deterministic variation engine (Phase 2)
   ------------------------------------------------------------
   Problem: a user's 2nd/3rd project in the SAME domain reads templated,
   because the domain profile is a fixed knowledge base.
   Fix: a stable seed from (userId + projectId + title) deterministically
   selects among ≥3 concrete variants per profile section — mechanism
   emphasis, milestone phrasing, architecture emphasis, proof-checklist
   items (pools live in domainProfiles.PROFILE_SECTION_VARIANTS).
   Guarantees:
   - Same seed → byte-identical output (tests rely on this).
   - No seedContext → applyBlueprintVariation is never called, so every
     existing caller stays byte-identical to before.
   - Every variant is concrete engineering content — no filler.
   ============================================================ */
import { PROFILE_SECTION_VARIANTS } from './domainProfiles.js';

/* FNV-1a 32-bit — stable across runs/platforms, dependency-free. */
export function stableHash(input = '') {
  let h = 0x811c9dc5;
  const s = String(input);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seedFromContext({ userId = '', projectId = '', title = '' } = {}) {
  return stableHash(`${userId}::${projectId}::${String(title).toLowerCase().trim()}`);
}

/* Pick index n for a section: salt keeps sections independently varied so
   two sections never lock to the same variant index by construction. */
export function pickIndex(seed, poolSize, salt = '') {
  if (!poolSize) return 0;
  return stableHash(`${seed}:${salt}`) % poolSize;
}

/**
 * applyBlueprintVariation({ blueprint, profile, mechanismName, seedContext })
 * Returns a NEW blueprint object with the seeded variants applied.
 * Mutates nothing; pure and deterministic.
 */
export function applyBlueprintVariation({ blueprint, profile, mechanismName, seedContext }) {
  if (!seedContext || !blueprint) return blueprint;
  const seed = seedFromContext(seedContext);
  const V = PROFILE_SECTION_VARIANTS;

  /* ---- 1. Mechanism emphasis: rotate which profile mechanism the
     blueprint centers (≥3 mechanisms per profile by construction). The
     brief may have pinned one; the variation chooses the EMPHASIZED one
     for architecture/proof wording without discarding the pinned name. */
  const mechs = Array.isArray(profile?.mechanisms) ? profile.mechanisms : [];
  const mechIdx = pickIndex(seed, Math.max(mechs.length, 1), 'mechanism');
  const emphasizedMech = (mechs[mechIdx] && mechs[mechIdx].name) || mechanismName || 'core engine';

  /* ---- 2. Milestone phrasing: ≥3 phrasing templates. ---- */
  const phrasing = V.milestonePhrasings[pickIndex(seed, V.milestonePhrasings.length, 'milestones')];
  const milestones = (blueprint.milestones || []).map((m, i) => {
    const text = String(m).replace(/^M\d+:\s*/, ''); // strip the default prefix before re-phrasing
    return phrasing(i + 1, text);
  });

  /* ---- 3. Architecture emphasis: append one of ≥3 concrete design
     rules, parameterized with the emphasized mechanism. ---- */
  const archLine = V.architectureEmphasis[pickIndex(seed, V.architectureEmphasis.length, 'architecture')](emphasizedMech);
  const architecture = [...(blueprint.architecture || []), archLine];

  /* ---- 4. Proof checklist: append one of ≥3 concrete proof items. ---- */
  const proofItem = V.proofChecklistExtras[pickIndex(seed, V.proofChecklistExtras.length, 'proof')](emphasizedMech);
  const proofChecklist = [...(blueprint.proofChecklist || []), proofItem].slice(0, 8);

  return {
    ...blueprint,
    architecture,
    milestones,
    proofChecklist,
    _meta: {
      ...(blueprint._meta || {}),
      variant: {
        seed,
        mechanismEmphasis: emphasizedMech,
        milestonePhrasing: pickIndex(seed, V.milestonePhrasings.length, 'milestones'),
        architectureEmphasis: pickIndex(seed, V.architectureEmphasis.length, 'architecture'),
        proofExtra: pickIndex(seed, V.proofChecklistExtras.length, 'proof'),
      },
    },
  };
}

export default { stableHash, seedFromContext, pickIndex, applyBlueprintVariation };
