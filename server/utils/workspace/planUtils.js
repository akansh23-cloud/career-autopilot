/* ============================================================
   Guided Project Workspace — shared pure helpers.
   Deterministic only: no AI, DB, network or randomness. IDs are
   derived from stable strings so regenerating a plan keeps the
   same ids and user task progress can be merged back in.
   ============================================================ */

export const isArr = Array.isArray;
export const arr = (v) => (isArr(v) ? v.filter((x) => x != null) : []);
export const str = (v) => (v == null ? '' : String(v));
export const obj = (v) => (v && typeof v === 'object' && !isArr(v) ? v : {});

/* Stable slug for ids/paths. Never empty. */
export function slug(s = '', fallback = 'item') {
  const out = str(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return out || fallback;
}

/* Deterministic id: prefix + slug (NOT time/random based, so regeneration
   produces the same ids and merge-by-id works). */
export function did(prefix, ...parts) {
  return `${prefix}_${parts.map((p) => slug(p, 'x')).join('_')}`.slice(0, 120);
}

/* PascalCase an entity/screen name: "resume upload" -> "ResumeUpload". */
export function pascal(s = '') {
  return str(s).split(/[^a-zA-Z0-9]+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Item';
}

/* camelCase variant. */
export function camel(s = '') {
  const p = pascal(s);
  return p[0].toLowerCase() + p.slice(1);
}

export function uniqBy(list, keyFn) {
  const seen = new Set(); const out = [];
  for (const item of arr(list)) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k); out.push(item);
  }
  return out;
}

export function nowIso(now) { return (now ? new Date(now) : new Date()).toISOString(); }

export const TASK_STATUSES = ['backlog', 'ready', 'in_progress', 'blocked', 'done', 'verified'];
export const ITEM_STATUSES = ['planned', 'generated', 'done', 'verified'];

/* Honest status language used across the workspace (section 16 of the spec). */
export const STATUS_LANGUAGE = {
  planned: 'Planned — the workspace says this should exist.',
  generated: 'Generated — starter code or a starter ZIP was generated. Not verified work.',
  done: 'Done — the user marked it done. Not system-verified.',
  verified: 'Verified — the system verified evidence.',
};
