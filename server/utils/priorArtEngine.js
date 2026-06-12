/* ============================================================
   PRIOR-ART SEARCH PLAN ENGINE  (deterministic; suggestions only)
   ------------------------------------------------------------
   Generates a *suggested* prior-art research plan: queries across patent
   and academic/product sources, keywords, synonyms, technical phrases,
   likely classification hints, differentiation angles, and risk areas.
   Does NOT claim the search is complete (no live APIs).
   ============================================================ */
const lc = (s) => String(s || '').toLowerCase();
const STOP = new Set(['the', 'a', 'an', 'for', 'and', 'of', 'to', 'with', 'in', 'on', 'by', 'that', 'using', 'system', 'method', 'app']);

function keyTerms(idea) {
  const text = `${idea.title} ${idea.problem} ${idea.technicalMechanism} ${idea.noveltyAngle} ${(idea.tags || []).join(' ')}`;
  const words = lc(text).replace(/[^a-z0-9\s/+.-]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 10);
}

const SYNONYMS = {
  detection: ['identification', 'recognition'], scoring: ['ranking', 'rating', 'weighting'],
  fusion: ['aggregation', 'combination', 'integration'], feedback: ['adaptive', 'closed-loop'],
  pipeline: ['workflow', 'processing chain'], anomaly: ['outlier', 'deviation'],
  credibility: ['trust', 'reliability'], verification: ['validation', 'authentication'],
};

const SOFTWARE = ['software', 'ml', 'ai', 'api', 'algorithm', 'pipeline', 'app', 'system'];

export function priorArtPlan(idea = {}, { projectPackage = null } = {}) {
  // Optional synthesis input: fold the package's technical mechanism and
  // domain into term extraction so the plan reflects the actual project,
  // not just the saved idea text. Fully backward compatible without it.
  const synth = projectPackage && typeof projectPackage === 'object' ? projectPackage : null;
  const synthMech = String(synth?.buildBrief?.technicalMechanism || '');
  const synthDomain = String(synth?.classification?.domain || '');
  const synthMeta = synth?.evidenceSummary?._meta || null;
  const enriched = synth
    ? { ...idea, technicalMechanism: `${idea.technicalMechanism || ''} ${synthMech}`.trim(), domain: idea.domain || synthDomain, tags: [...(idea.tags || []), ...(synth.projectOsPayload?.requiredSkills || []).slice(0, 4)] }
    : idea;

  const terms = keyTerms(enriched);
  const phrase = terms.slice(0, 4).join(' ');
  const isSoftware = SOFTWARE.some((s) => lc(`${enriched.technicalMechanism} ${enriched.tags?.join(' ')} ${enriched.proposedSolution}`).includes(s));

  const synonyms = terms.flatMap((t) => (SYNONYMS[t] || [])).slice(0, 8);
  const technicalPhrases = [
    `${phrase} method`, `${phrase} system`, `${terms.slice(0, 3).join(' ')} apparatus`,
    `${terms[0] || 'system'} ${terms[1] || 'method'} ${terms[2] || ''}`.trim(),
  ];

  const googlePatents = [`${phrase} method system`, `${terms.slice(0, 3).join(' ')} apparatus`, `${terms[0]} ${terms[1]} feedback`].filter((q) => q.trim().length > 4);
  const uspto = googlePatents.map((q) => q);
  const wipoEspacenet = [`${phrase}`, `${terms.slice(0, 2).join(' ')} ${enriched.domain || ''}`.trim()];
  const scholar = [`${phrase} algorithm`, `${terms.slice(0, 3).join(' ')} evaluation`];
  const product = [`${enriched.domain || ''} ${terms[0] || ''} tool`.trim(), `${terms.slice(0, 2).join(' ')} startup`, `best ${enriched.domain || ''} ${terms[0] || ''} software`.trim()];
  const github = isSoftware ? [`${terms.slice(0, 2).join(' ')}`, `${terms[0] || ''} ${enriched.tags?.[0] || ''}`.trim()] : [];

  // Rough CPC/IPC classification hints by domain/tech.
  const t = lc(`${enriched.domain} ${enriched.technicalMechanism} ${enriched.tags?.join(' ')}`);
  const classHints = [];
  if (/ml|ai|model|learning|neural/.test(t)) classHints.push('G06N (computing arrangements based on specific computational models)');
  if (/data|database|record|fusion|pipeline/.test(t)) classHints.push('G06F 16 (information retrieval / data structures)');
  if (/image|vision|camera/.test(t)) classHints.push('G06V (image/video recognition)');
  if (/security|fraud|anomaly|encrypt/.test(t)) classHints.push('H04L 9 / G06F 21 (security)');
  if (/iot|sensor|edge/.test(t)) classHints.push('G16Y / H04W (IoT / wireless)');
  if (/health|medical|patient/.test(t)) classHints.push('G16H (healthcare informatics)');
  if (/finance|payment|tax/.test(t)) classHints.push('G06Q 40 (finance)');
  if (!classHints.length) classHints.push('G06Q (data processing for business/administration) — verify with an examiner.');

  return {
    note: 'Suggested prior-art research plan. This is not a completed search — run these queries and record findings.',
    keywords: terms,
    synonyms,
    technicalPhrases,
    queries: { googlePatents, uspto, wipoEspacenet, scholar, product, github },
    sources: [
      { name: 'Google Patents', url: 'https://patents.google.com/' },
      { name: 'USPTO Patent Full-Text Search', url: 'https://ppubs.uspto.gov/pubwebapp/' },
      { name: 'Espacenet (EPO)', url: 'https://worldwide.espacenet.com/' },
      { name: 'WIPO PATENTSCOPE', url: 'https://patentscope.wipo.int/' },
      { name: 'Google Scholar', url: 'https://scholar.google.com/' },
      ...(isSoftware ? [{ name: 'GitHub', url: 'https://github.com/search' }] : []),
    ],
    classificationHints: classHints,
    similarCategories: [`${enriched.domain || 'General'} ${terms[0] || 'tools'}`, `${terms[0] || ''} ${terms[1] || ''} platforms`.trim()],
    riskAreas: [
      'Crowded space if the core idea is a common workflow without a unique mechanism.',
      'Business-method framing may face stricter examination — lead with the technical mechanism.',
      ...(synth && synth.classification?.ipAnalysisAppropriate === false
        ? ['Synthesis classification flags this domain as weak ground for IP (generic workflow/marketplace pattern) — a specific technical mechanism with technical effect is required before any filing discussion.'] : []),
      ...(synthMeta && (synthMeta.communityOnly || !synthMeta.total)
        ? ['Source evidence is weak or community-only — prior-art risk is effectively unknown until verified technical/research sources are reviewed.'] : []),
    ],
    differentiationAngles: [
      ...(synthMech.length > 40
        ? [`Lead with the project's actual technical mechanism: ${synthMech.slice(0, 180)}`] : []),
      'Emphasize the specific multi-source fusion + adaptive feedback combination.',
      'Highlight the measurable technical improvement over isolated tools.',
      'Stress any privacy-preserving / on-device / real-time aspect.',
    ],
    disclaimer: 'Patent OS provides invention research and drafting assistance only. It is not legal advice. Patentability and filing decisions should be reviewed by a qualified patent attorney.',
  };
}

export default { priorArtPlan };
