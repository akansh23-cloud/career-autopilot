/* Stable, formatting-noise-free representation used for BOTH scoring and
   hashing, so the hash faithfully keys the score. Deterministic. */
export function normalizeResumeText(text = '') {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim()
    .toLowerCase();
}

export function normalizeRole(role = '') {
  return String(role || '').trim() || 'General';
}

export default { normalizeResumeText, normalizeRole };
