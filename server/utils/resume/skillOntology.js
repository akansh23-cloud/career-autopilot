/* ============================================================
   SKILL ONTOLOGY — one normalization layer for Resume OS V3
   ------------------------------------------------------------
   Built ON the existing SKILL_ALIASES + ROLE_DICTIONARIES so the
   product keeps a single taxonomy (no competing skill lists).
   Adds: canonicalization (alias -> canonical), reverse index,
   extra aliases the matcher needs, and category lookup.
   ============================================================ */
import { SKILL_ALIASES, ROLE_DICTIONARIES } from './roleDictionaries.js';
import { skillPresent, presentSkills, termsForSkill } from './skillMatcher.js';

/* Additional aliases (merged, never replacing the base map). */
export const EXTRA_ALIASES = {
  'amazon web services': ['aws cloud'],
  kubernetes: ['kubernetes engine'],
  docker: ['docker containers'],
  jenkins: ['jenkins pipelines'],
  prometheus: ['prom'],
  grafana: [],
  ansible: ['ansible playbooks'],
  'spring boot': ['springboot'],
  'c#': ['csharp', 'c sharp'],
  'c++': ['cpp'],
  sql: ['structured query language'],
  snowflake: [],
  pyspark: ['py-spark'],
  'apache spark': ['spark'],
  airflow: ['apache airflow'],
  kafka: ['apache kafka'],
  tableau: [],
  excel: ['ms excel', 'microsoft excel'],
  git: ['version control'],
  linux: ['unix'],
  redis: [],
  elasticsearch: ['elastic search', 'elastic'],
};

const CANON = new Map();       // alias/canonical (lower) -> canonical
const ALL_CANONICAL = new Set();

function register(canonical, aliases = []) {
  const c = canonical.toLowerCase().trim();
  if (!c) return;
  ALL_CANONICAL.add(c);
  if (!CANON.has(c)) CANON.set(c, c);
  for (const a of aliases) {
    const k = String(a).toLowerCase().trim();
    if (k && !CANON.has(k)) CANON.set(k, c);
  }
}
for (const [c, al] of Object.entries(SKILL_ALIASES)) register(c, al);
for (const [c, al] of Object.entries(EXTRA_ALIASES)) register(c, al);
for (const dict of Object.values(ROLE_DICTIONARIES)) {
  for (const bucket of ['mustHave', 'goodToHave', 'tools', 'cloud', 'languages', 'databases', 'testing']) {
    for (const s of dict[bucket] || []) register(String(s));
  }
}

/* Canonical form of any skill string ("K8s" -> "kubernetes"). Unknown skills
   normalize to their own lowercase trimmed form — they stay usable. */
export function canonicalSkill(name) {
  const k = String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!k) return '';
  if (CANON.has(k)) return CANON.get(k);
  const noJs = k.replace(/\.js$/, '');
  if (CANON.has(noJs)) return CANON.get(noJs);
  return k;
}

export function isKnownSkill(name) { return ALL_CANONICAL.has(canonicalSkill(name)); }

/* Full canonical skill universe — used by the Truth Engine to scan bullets
   for implied usage of ANY known skill, not just ones already on the doc. */
export function allKnownSkills() { return [...ALL_CANONICAL]; }

/* Dedupe + canonicalize a list, preserving first-seen display names. */
export function canonicalizeSkillList(list = []) {
  const seen = new Map();
  for (const raw of list) {
    const display = String(raw || '').trim();
    if (!display) continue;
    const c = canonicalSkill(display);
    if (!seen.has(c)) seen.set(c, display);
  }
  return [...seen.entries()].map(([canonical, display]) => ({ canonical, display }));
}

/* Category of a canonical skill from the role dictionaries (first bucket hit). */
const CATEGORY_ORDER = ['languages', 'cloud', 'databases', 'testing', 'tools'];
export function skillCategory(name) {
  const c = canonicalSkill(name);
  for (const dict of Object.values(ROLE_DICTIONARIES)) {
    for (const bucket of CATEGORY_ORDER) {
      if ((dict[bucket] || []).some((s) => canonicalSkill(s) === c)) return bucket;
    }
  }
  return 'other';
}

/* Set-membership check that respects aliases both ways. */
export function skillInSet(name, set) {
  return set instanceof Set ? set.has(canonicalSkill(name)) : false;
}
export function toCanonicalSet(list = []) {
  return new Set(list.map(canonicalSkill).filter(Boolean));
}

export { skillPresent, presentSkills, termsForSkill };
export default {
  canonicalSkill, canonicalizeSkillList, isKnownSkill, skillCategory,
  skillInSet, toCanonicalSet, skillPresent, presentSkills, termsForSkill,
};
