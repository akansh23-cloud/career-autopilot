/* ============================================================
   TEXT QUALITY ENGINES — redundancy + readability (no AI)
   ------------------------------------------------------------
   REDUNDANCY: normalized token Jaccard + bigram overlap for
   exact / near-duplicate bullets, repeated tech, repeated
   project descriptions. Lightest reliable method — no
   embeddings, no TF-IDF matrix.
   READABILITY: length, clauses, first person, filler, weak
   phrases, passive markers, unexplained acronyms, punctuation.
   Both flag only — nothing is auto-rewritten.
   ============================================================ */

export const REDUNDANCY_VERSION = 'redundancy-v1';
export const READABILITY_VERSION = 'readability-v1';

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'by', 'using', 'across', 'via', 'at', 'as', 'from']);

export function normalizeForSimilarity(text) {
  return String(text || '').toLowerCase()
    .replace(/[^a-z0-9\s%./+#-]/g, ' ')
    .split(/\s+/).filter((w) => w && !STOP.has(w));
}

export function jaccard(aTokens, bTokens) {
  const A = new Set(aTokens), B = new Set(bTokens);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

function bigrams(tokens) {
  const out = new Set();
  for (let i = 0; i < tokens.length - 1; i++) out.add(tokens[i] + ' ' + tokens[i + 1]);
  return out;
}
export function bigramOverlap(aTokens, bTokens) {
  const A = bigrams(aTokens), B = bigrams(bTokens);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

/* similarity: max(jaccard, bigramOverlap) — bigram catches reordered clauses. */
export function bulletSimilarity(a, b) {
  const ta = normalizeForSimilarity(a), tb = normalizeForSimilarity(b);
  return Math.max(jaccard(ta, tb), bigramOverlap(ta, tb));
}

export function findDuplicateBullets(bullets = [], { near = 0.72 } = {}) {
  const exact = [];
  const nearDup = [];
  const byNorm = new Map();
  const items = bullets.map((b) => ({ b, norm: normalizeForSimilarity(b.text).join(' ') }));
  for (const it of items) {
    if (!it.norm) continue;
    if (byNorm.has(it.norm)) exact.push({ a: byNorm.get(it.norm).b, b: it.b });
    else byNorm.set(it.norm, it);
  }
  const uniq = [...byNorm.values()];
  for (let i = 0; i < uniq.length; i++) {
    for (let k = i + 1; k < uniq.length; k++) {
      const sim = bulletSimilarity(uniq[i].b.text, uniq[k].b.text);
      if (sim >= near) nearDup.push({ a: uniq[i].b, b: uniq[k].b, similarity: Number(sim.toFixed(2)) });
    }
  }
  return { version: REDUNDANCY_VERSION, exact, near: nearDup };
}

/* Tech terms repeated far more than peers (deterministic, threshold-based). */
export function techRepetition(bullets = [], { max = 6 } = {}) {
  const counts = new Map();
  const TECH_RE = /\b(aws|docker|kubernetes|k8s|python|java|react|node(?:\.js)?|terraform|jenkins|spark|sql|mongodb|postgres(?:ql)?|redis|kafka|airflow|snowflake)\b/gi;
  for (const b of bullets) {
    for (const m of String(b.text || '').matchAll(TECH_RE)) {
      const k = m[1].toLowerCase();
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, c]) => c > max).map(([tech, count]) => ({ tech, count }));
}

/* ------------------------------------------------ readability ---- */
const FILLER = ['various', 'numerous', 'several tasks', 'day to day', 'day-to-day', 'etc', 'and so on', 'stuff', 'things'];
const WEAK = ['responsible for', 'worked on', 'helped with', 'involved in', 'assisted with', 'participated in', 'tasked with', 'duties included', 'exposure to', 'familiar with'];
const FIRST_PERSON = /\b(i|my|me|we|our)\b/i;
const PASSIVE = /\b(was|were|been|being|is|are)\s+\w+ed\b/i;
const KNOWN_ACRONYMS = new Set(['API', 'REST', 'SQL', 'AWS', 'GCP', 'CI', 'CD', 'ETL', 'ML', 'AI', 'SDK', 'UI', 'UX', 'HTML', 'CSS', 'JSON', 'XML', 'HTTP', 'HTTPS', 'TCP', 'IP', 'DNS', 'SSH', 'VPN', 'IAM', 'S3', 'EC2', 'RDS', 'K8S', 'JVM', 'ORM', 'CRUD', 'SLA', 'KPI', 'SaaS', 'B2B', 'B2C', 'QA', 'PDF', 'CSV', 'CTC', 'GPA', 'BFSI', 'RBAC', 'JWT', 'OAuth'.toUpperCase()]);

export function readabilityIssuesForBullet(bullet) {
  const text = String(bullet?.text || bullet || '').trim();
  const issues = [];
  const words = text.split(/\s+/).filter(Boolean);
  if (!text) return issues;
  if (words.length > 34) issues.push({ code: 'bullet_too_long', detail: `${words.length} words — aim for under 30.` });
  if (words.length > 0 && words.length < 5) issues.push({ code: 'bullet_too_short', detail: 'Under 5 words carries no evidence — add what, how, and outcome.' });
  const commas = (text.match(/,/g) || []).length;
  if (commas >= 4) issues.push({ code: 'excessive_clauses', detail: `${commas} commas — split into two bullets.` });
  if (FIRST_PERSON.test(text)) issues.push({ code: 'first_person', detail: 'Resumes drop first-person pronouns ("I", "my", "we").' });
  const lower = text.toLowerCase();
  for (const w of WEAK) if (lower.startsWith(w)) { issues.push({ code: 'weak_opener', detail: `Opens with "${w}" — lead with an action verb.` }); break; }
  for (const f of FILLER) if (lower.includes(f)) { issues.push({ code: 'filler_phrase', detail: `Contains filler ("${f}").` }); break; }
  if (PASSIVE.test(text)) issues.push({ code: 'passive_voice', detail: 'Passive construction detected — prefer active voice.' });
  const acr = [...text.matchAll(/\b([A-Z]{2,6})\b/g)].map((m) => m[1]).filter((a) => !KNOWN_ACRONYMS.has(a) && !/^\d+$/.test(a));
  if (acr.length >= 2) issues.push({ code: 'unexplained_acronyms', detail: `Uncommon acronyms (${[...new Set(acr)].slice(0, 3).join(', ')}) — expand on first use.` });
  if (/!{1,}/.test(text)) issues.push({ code: 'exclamation', detail: 'Exclamation marks read unprofessional on a resume.' });
  return issues;
}

export function analyzeReadability(bullets = [], summary = '') {
  const perBullet = [];
  for (const b of bullets) {
    const issues = readabilityIssuesForBullet(b);
    if (issues.length) perBullet.push({ bulletId: b.id, itemId: b.itemId, section: b.section, text: String(b.text).slice(0, 90), issues });
  }
  const summaryIssues = [];
  const sw = String(summary || '').split(/\s+/).filter(Boolean).length;
  if (sw > 70) summaryIssues.push({ code: 'summary_too_long', detail: `${sw} words — keep the summary to 3–4 lines.` });
  if (FIRST_PERSON.test(summary)) summaryIssues.push({ code: 'summary_first_person', detail: 'Summary uses first person.' });
  return { version: READABILITY_VERSION, perBullet, summaryIssues };
}

export default {
  REDUNDANCY_VERSION, READABILITY_VERSION,
  normalizeForSimilarity, jaccard, bigramOverlap, bulletSimilarity,
  findDuplicateBullets, techRepetition, readabilityIssuesForBullet, analyzeReadability,
};
