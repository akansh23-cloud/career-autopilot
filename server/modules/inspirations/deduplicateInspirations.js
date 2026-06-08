/* Deterministic dedup: collapse by (source|sourceId) and by a normalized
   title signature so near-identical items across refreshes don't pile up. */
function sig(title = '') {
  return String(title).toLowerCase().replace(/^build:\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
}

export function deduplicateInspirations(items = []) {
  const seenId = new Set();
  const seenSig = new Set();
  const out = [];
  for (const it of items) {
    const idKey = `${it.source}|${it.sourceId}`;
    const sigKey = sig(it.title || it.sourceTitle);
    if (seenId.has(idKey) || (sigKey && seenSig.has(sigKey))) continue;
    seenId.add(idKey);
    if (sigKey) seenSig.add(sigKey);
    out.push(it);
  }
  return out;
}

export default { deduplicateInspirations };
