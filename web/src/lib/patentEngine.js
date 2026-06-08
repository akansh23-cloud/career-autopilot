// patentEngine.js — Career Autopilot's OWN patentability + filing system.
//
// Deterministic, transparent assessment against the real legal criteria
// (subject-matter/technical character, novelty, inventive step, industrial
// applicability, enablement) plus a full guided registration dossier:
// prior-art search plan, invention disclosure, provisional specification
// outline, a claims skeleton, an abstract, drawings checklist, and
// jurisdiction-aware filing guidance with a status pipeline.
//
// NOT legal advice. Educational drafting support only — see PATENT_DISCLAIMER.

export const PATENT_DISCLAIMER = 'Educational IP-readiness and draft-preparation support only. This is not legal advice and does not guarantee patentability or grant. A registered patent agent/attorney must review and file. Do not publicly disclose the invention before filing (it can destroy novelty).';

export const PATENT_STAGES = [
  { id: 'assessed', label: 'Assessed' },
  { id: 'priorart', label: 'Prior-art search' },
  { id: 'disclosure', label: 'Invention disclosure' },
  { id: 'provisional', label: 'Provisional draft' },
  { id: 'filed', label: 'Filed' },
  { id: 'pending', label: 'Examination' },
  { id: 'granted', label: 'Granted' },
];

const CRITERIA_WEIGHTS = {
  technicalCharacter: 30, // patentable subject matter (US §101 / EPO technical / IN §3(k))
  novelty: 22,
  inventiveStep: 22,
  industrialApplicability: 13,
  enablement: 13,
};
export const CRITERIA_LABELS = {
  technicalCharacter: 'Patentable subject matter (technical character)',
  novelty: 'Novelty',
  inventiveStep: 'Inventive step (non-obviousness)',
  industrialApplicability: 'Industrial applicability / utility',
  enablement: 'Enablement (can be fully described)',
};

const norm = (s) => String(s || '').toLowerCase();
const uniq = (a) => Array.from(new Set((a || []).map((x) => String(x).trim()).filter(Boolean)));
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

// Capabilities/skills that carry inherent technical character vs those that don't.
const HIGH_TECH = ['optimiz', 'algorith', 'model', 'ml', 'machine learning', 'vision', 'opencv', 'stream', 'real-time', 'realtime', 'signal', 'crypto', 'security', 'compression', 'distributed', 'edge', 'federated', 'recommend', 'inference', 'anomaly', 'solver'];
const LOW_TECH = ['crud', 'dashboard', 'marketplace', 'landing', 'blog', 'catalog', 'form', 'listing'];

function inferNovelty(project = {}) {
  const fromRec = project.creator?.fromRecommendation?.novelty;
  if (fromRec && typeof fromRec === 'object') return fromRec;
  const hay = norm([project.title, project.type, project.architecture, (project.skillsCovered || []).join(' '), (project.creator?.summary || project.problemStatement || '')].join(' '));
  const highHits = HIGH_TECH.filter((k) => hay.includes(k));
  const lowHits = LOW_TECH.filter((k) => hay.includes(k));
  const technicalCharacter = clamp(40 + highHits.length * 14 - lowHits.length * 12);
  return {
    technicalMechanism: project.architecture || `A system implementing ${project.title || 'the described functionality'}.`,
    technicalEffect: highHits.length ? 'an automated computation producing a concrete technical result' : 'primarily a business/presentation workflow',
    inventiveAngle: null,
    technicalCharacter,
    cpcHint: 'G06F / G06Q (verify with an examiner)',
    priorArtKeywords: uniq((project.skillsCovered || []).slice(0, 5)),
  };
}

function countTechnicalComponents(project, novelty) {
  const skills = (project.skillsCovered || []);
  const techComponents = skills.filter((s) => HIGH_TECH.some((k) => norm(s).includes(k)));
  let n = techComponents.length;
  if (novelty.inventiveAngle) n += 1;
  if (project.industry?.apiDesign?.length) n += 1;
  if (project.databaseSchema || project.industry?.dataModel?.length) n += 1;
  return n;
}

/* --------------------------- core assessment --------------------------- */
export function assessPatentability(project = {}, attest = {}) {
  const novelty = inferNovelty(project);
  const hasArchitecture = !!(String(project.architectureDiagram || '').trim() || String(project.architecture || '').trim());
  const hasMilestones = (project.industry?.milestones || []).length > 0;
  const components = countTechnicalComponents(project, novelty);

  // user attestation (defaults conservative). Without a prior-art search we
  // cannot claim novelty, so it is capped until the user confirms.
  const priorArtSearched = !!attest.priorArtSearched;
  const noCloseArtFound = !!attest.noCloseArtFound;
  const publiclyDisclosed = !!attest.publiclyDisclosed;

  const tc = clamp(novelty.technicalCharacter);
  const subjectMatterOk = tc >= 45;

  // each criterion: score + reasons + recommendation
  const criteria = {};
  const reasons = {};
  const recs = {};

  criteria.technicalCharacter = tc;
  reasons.technicalCharacter = subjectMatterOk
    ? `Has a concrete technical mechanism (${novelty.technicalEffect}).`
    : 'Reads as an abstract idea / business method or mere presentation of information.';
  recs.technicalCharacter = subjectMatterOk ? '' : 'Add a concrete technical mechanism (an algorithm, signal/data transformation, performance or hardware effect). Pure CRUD/dashboard/marketplace ideas are usually rejected under US §101 and India §3(k).';

  let noveltyScore = 45 + (novelty.inventiveAngle ? 12 : 0) + Math.min(15, components * 3);
  if (priorArtSearched && noCloseArtFound) noveltyScore += 30;
  else if (priorArtSearched) noveltyScore -= 5;
  else noveltyScore = Math.min(noveltyScore, 55); // cannot confirm novelty without a search
  criteria.novelty = clamp(noveltyScore);
  reasons.novelty = !priorArtSearched
    ? 'Novelty is unconfirmed — no prior-art search recorded yet.'
    : noCloseArtFound ? 'You found no close prior art in your search.' : 'Close prior art may exist — differentiate your claims.';
  recs.novelty = !priorArtSearched ? 'Run the prior-art search plan below and record the result to confirm novelty.' : (noCloseArtFound ? '' : 'Narrow your independent claim around the specific differentiator.');

  const inventive = clamp((novelty.inventiveAngle ? 60 : 42) + Math.min(28, components * 6) + (tc >= 70 ? 6 : 0));
  criteria.inventiveStep = inventive;
  reasons.inventiveStep = novelty.inventiveAngle
    ? `Non-obvious angle: ${novelty.inventiveAngle}, combined with ${components} integrated technical components.`
    : `Inventive step rests on the combination of ${components} technical components — may be seen as obvious.`;
  recs.inventiveStep = inventive >= 55 ? '' : 'Strengthen non-obviousness: add a novel technique or an unexpected technical advantage over the obvious approach.';

  const industrial = clamp((hasMilestones ? 88 : 78) + (hasArchitecture ? 6 : 0));
  criteria.industrialApplicability = industrial;
  reasons.industrialApplicability = 'It is a buildable, deployable system with a clear real-world use.';
  recs.industrialApplicability = '';

  const enablement = clamp((hasArchitecture ? 60 : 35) + (hasMilestones ? 25 : 0) + Math.min(15, (project.skillsCovered || []).length * 2));
  criteria.enablement = enablement;
  reasons.enablement = hasArchitecture ? 'Architecture + roadmap give enough detail to describe the invention.' : 'Not yet described in enough technical detail to enable a skilled person.';
  recs.enablement = enablement >= 60 ? '' : 'Complete the blueprint (architecture + data model + API + milestones) so the specification is enabling.';

  const composite = clamp(Object.keys(CRITERIA_WEIGHTS).reduce((s, k) => s + (criteria[k] / 100) * CRITERIA_WEIGHTS[k], 0));

  // verdict + gate
  let verdict;
  let classification;
  let eligible;
  if (!subjectMatterOk) {
    verdict = 'Likely not patentable as-is — no technical character';
    classification = 'Not patent-eligible as-is';
    eligible = false;
  } else if (composite >= 65 && inventive >= 55) {
    verdict = 'Strong candidate — proceed to a provisional filing';
    classification = 'Patent Review Recommended';
    eligible = true;
  } else if (composite >= 55) {
    verdict = 'Potentially patentable — strengthen novelty/inventive step first';
    classification = 'Patent Review Recommended';
    eligible = true;
  } else {
    verdict = 'Weak — strengthen the technical contribution before filing';
    classification = 'Strengthen before filing';
    eligible = false;
  }

  const gate = {
    eligible,
    subjectMatterOk,
    reasonsBlocking: [
      !subjectMatterOk ? 'No patentable subject matter (technical character < 45).' : null,
      subjectMatterOk && composite < 55 ? 'Overall readiness below the 55 threshold.' : null,
    ].filter(Boolean),
    nextActions: [
      !priorArtSearched ? 'Run the prior-art search and record findings.' : null,
      enablement < 60 ? 'Finish the blueprint so the spec is enabling.' : null,
      !subjectMatterOk ? 'Introduce a concrete technical mechanism.' : null,
    ].filter(Boolean),
  };

  const dossier = buildDossier(project, novelty, { criteria, composite, components });

  // legacy report fields consumed by the existing IP modal UI
  const legacy = legacyReport(project, novelty, { criteria, composite, classification, dossier, reasons });

  return {
    ...legacy,
    engine: 'deterministic',
    criteriaWeights: CRITERIA_WEIGHTS,
    criteria,
    criteriaReasons: reasons,
    criteriaRecommendations: recs,
    composite,
    verdict,
    classification,
    eligible,
    gate,
    attest: { priorArtSearched, noCloseArtFound, publiclyDisclosed },
    dossier,
  };
}

/* --------------------------- registration dossier --------------------------- */
function buildDossier(project, novelty, ctx) {
  const title = project.title || 'Untitled invention';
  const mechanism = novelty.technicalMechanism || project.architecture || '';
  const components = (project.skillsCovered || []).filter((s) => HIGH_TECH.some((k) => norm(s).includes(k)));
  const allComponents = (project.skillsCovered || []).slice(0, 6);
  const kw = uniq([...(novelty.priorArtKeywords || []), ...(project.skillsCovered || []).slice(0, 4), project.domain].filter(Boolean));

  const priorArt = {
    classification: novelty.cpcHint || 'G06F / G06Q (confirm with an examiner)',
    keywords: kw,
    databases: [
      { name: 'Google Patents', url: 'https://patents.google.com', note: 'Free full-text + non-patent literature.' },
      { name: 'Espacenet (EPO)', url: 'https://worldwide.espacenet.com', note: 'Worldwide coverage + CPC browsing.' },
      { name: 'USPTO Patent Public Search', url: 'https://ppubs.uspto.gov/pubwebapp', note: 'US grants & applications.' },
      { name: 'WIPO PatentScope', url: 'https://patentscope.wipo.int', note: 'PCT international applications.' },
      { name: 'India InPASS', url: 'https://iprsearch.ipindia.gov.in', note: 'Indian patent search.' },
    ],
    queries: buildQueries(kw, mechanism),
    checklist: [
      'Search each database with 3–5 keyword combinations and the classification.',
      'Record the 5 closest results (title, number, assignee, what it covers).',
      'For each, note how YOUR mechanism differs (the differentiator becomes your claim).',
      'Also search non-patent literature (papers, products, GitHub) — it counts as prior art.',
    ],
    findings: [], // user records results here
  };

  const disclosure = {
    title,
    fieldOfInvention: `The invention relates to ${project.domain || 'computer-implemented systems'}, and more particularly to ${lc(novelty.name || mechanism)}.`,
    background: `${project.creator?.summary || project.problemStatement || `In ${project.domain || 'the field'}, current approaches are manual or inefficient.`} Existing solutions do not ${shortEffect(novelty)}.`,
    summaryOfInvention: `A system and method comprising ${mechanism}. ${novelty.inventiveAngle ? `The system is ${novelty.inventiveAngle}, providing ${novelty.technicalEffect}.` : ''}`,
    technicalProblem: project.creator?.summary || project.problemStatement || `How to ${shortEffect(novelty)} reliably and at scale.`,
    technicalSolution: mechanism,
    advantages: uniq([
      novelty.technicalEffect,
      'Reduces manual effort and error',
      novelty.inventiveAngle ? `Enables ${novelty.inventiveAngle} operation` : 'Improves measurable outcomes over the baseline',
    ]),
    components: allComponents,
    inventors: [], // user fills
  };

  const provisionalSpecOutline = [
    '1. Title of the invention',
    '2. Field of the invention',
    '3. Background and problems with existing solutions',
    '4. Objects of the invention',
    '5. Summary of the invention',
    '6. Brief description of the drawings',
    '7. Detailed description of the preferred embodiment (the mechanism, step by step)',
    '8. Working example / data flow with inputs and outputs',
    '9. Alternative embodiments and variations',
    '10. Industrial applicability',
    '11. (For complete spec only) Claims',
    '12. Abstract',
  ];

  const claims = buildClaims(title, mechanism, components.length ? components : allComponents, novelty);

  const abstract = `A computer-implemented system and method for ${lc(stripTitle(title))}. The system ${lc(firstClause(mechanism))}${novelty.inventiveAngle ? `, wherein the system is ${novelty.inventiveAngle}` : ''}, thereby providing ${novelty.technicalEffect}. (Draft — keep under 150 words; finalize with your patent agent.)`;

  const drawings = [
    'FIG. 1 — System architecture (reuse the generated architecture diagram).',
    'FIG. 2 — Method flowchart of the inventive steps (inputs → processing → output).',
    'FIG. 3 — Data model / message flow between components.',
    novelty.inventiveAngle ? `FIG. 4 — Illustration of the ${novelty.inventiveAngle} aspect.` : 'FIG. 4 — A representative working example with sample data.',
  ];

  const filing = {
    routes: [
      { id: 'provisional', name: 'Provisional / priority application', when: 'File first to lock a priority date while you build & validate.', note: 'Cheapest way to secure a date; a complete specification must follow within 12 months.' },
      { id: 'complete', name: 'Complete / non-provisional application', when: 'When the invention and claims are finalized.', note: 'Includes full claims; starts examination.' },
      { id: 'pct', name: 'PCT (international)', when: 'If you want options in multiple countries.', note: 'One international filing; national-phase entry later (~30 months from priority).' },
    ],
    jurisdictions: [
      { id: 'in', name: 'India (IPO)', office: 'Indian Patent Office', forms: ['Form 1 (application)', 'Form 2 (provisional/complete spec)', 'Form 3 (foreign filing)', 'Form 5 (declaration of inventorship, with complete)', 'Form 28 (if startup/small entity)'], feeNote: 'Indicative: startup/individual provisional fees are low (a few thousand INR); verify current IPO fees.', timeline: 'Provisional → complete within 12 months; request examination within 31 months.' },
      { id: 'us', name: 'United States (USPTO)', office: 'USPTO', forms: ['Provisional cover sheet (SB/16)', 'Application Data Sheet', 'Micro/Small entity certification'], feeNote: 'Indicative: micro-entity provisional fees are modest; verify current USPTO fee schedule.', timeline: 'Provisional → non-provisional within 12 months.' },
      { id: 'wipo', name: 'International (WIPO/PCT)', office: 'WIPO', forms: ['PCT Request (RO/101)', 'International spec + claims'], feeNote: 'Higher; only if multi-country protection is the goal.', timeline: 'National phase typically by ~30 months from priority.' },
    ],
    steps: [
      'Do NOT publicly disclose before filing (no public repo/demo/post that reveals the invention).',
      'Complete the prior-art search and confirm a real differentiator.',
      'Fill the invention disclosure (inventors, dates, the mechanism).',
      'Draft the provisional specification using the outline + claims skeleton.',
      'Engage a registered patent agent/attorney to review and file.',
      'File the provisional to secure the priority date; record the application number + date.',
      'Within 12 months: file the complete specification (and/or PCT) with finalized claims.',
    ],
    costDisclaimer: 'All fees are indicative and change frequently; confirm on the official patent-office site. Attorney drafting fees are separate.',
  };

  return { priorArt, disclosure, provisionalSpecOutline, claims, abstract, drawings, filing };
}

function buildQueries(keywords, mechanism) {
  const k = keywords.slice(0, 4);
  const base = k.slice(0, 2).join(' ');
  const out = [];
  if (base) out.push(`("${base}") AND (system OR method OR apparatus)`);
  if (k[2]) out.push(`("${k[0]}" OR "${k[2]}") AND (automatic OR automated)`);
  out.push(`${k.slice(0, 3).join(' ')} ${/optim|predict|detect|recommend/i.test(mechanism) ? 'algorithm' : 'method'}`);
  out.push(`${base} ${/real-?time|stream/i.test(mechanism) ? 'real-time' : ''}`.trim());
  return uniq(out);
}

function buildClaims(title, mechanism, components, novelty) {
  const comps = (components.length ? components : ['a processor', 'a data store', 'an interface']).slice(0, 4);
  const independent = `1. A computer-implemented system for ${lc(stripTitle(title))}, the system comprising:\n   ${comps.map((c, i) => `   ${String.fromCharCode(97 + i)}) ${aOrAn(c)} configured to participate in ${lc(firstClause(mechanism))};`).join('\n')}\n      wherein the system is configured to ${lc(firstClause(mechanism))}${novelty.inventiveAngle ? `, the system being ${novelty.inventiveAngle}` : ''}, so as to produce ${novelty.technicalEffect}.`;
  const dependents = [
    `2. The system of claim 1, wherein ${novelty.inventiveAngle || 'the processing'} is performed ${novelty.inventiveAngle ? 'as described above' : 'using a trained model / configured ruleset'}.`,
    '3. The system of claim 1, further comprising a feedback loop that updates parameters from observed outcomes.',
    '4. A method comprising the steps performed by the system of claim 1.',
    '5. A non-transitory computer-readable medium storing instructions that, when executed, perform the method of claim 4.',
  ];
  return { independent, dependents, note: 'Skeleton only. The independent claim defines the protected scope — a registered agent must refine it around your confirmed differentiator.' };
}

/* ----- helpers ----- */
function lc(s = '') { s = String(s).trim(); return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
function stripTitle(t = '') { return String(t).replace(/\s*\([^)]*\)\s*$/, '').trim(); }
function firstClause(s = '') { return String(s).split(/[.;]/)[0].replace(/^a\s+|^an\s+/i, '').trim(); }
function shortEffect(n = {}) { return lc(firstClause(n.technicalEffect || 'solve the problem automatically')); }
function aOrAn(s = '') { return /^[aeiou]/i.test(s.trim()) ? `an ${s}` : `a ${s}`; }

/* ----- legacy report shape for the existing IP modal ----- */
function legacyReport(project, novelty, { criteria, composite, classification, dossier, reasons }) {
  const noveltyPoints = uniq([
    novelty.inventiveAngle ? `Inventive angle: ${novelty.inventiveAngle}` : null,
    `Technical mechanism: ${novelty.technicalMechanism}`,
    novelty.technicalEffect,
  ]);
  return {
    patentReadinessScore: composite,
    classification,
    inventionSummary: dossier.disclosure.summaryOfInvention,
    technicalProblem: dossier.disclosure.technicalProblem,
    technicalSolution: dossier.disclosure.technicalSolution,
    noveltyPoints,
    inventiveStepHypothesis: reasons.inventiveStep,
    industrialUse: reasons.industrialApplicability,
    priorArtKeywords: dossier.priorArt.keywords,
    comparableSolutions: dossier.priorArt.queries.map((q) => `Search: ${q}`),
    systemDiagramsChecklist: dossier.drawings,
    provisionalSpecOutline: dossier.provisionalSpecOutline,
    claimPreparationNotes: [dossier.claims.independent, ...dossier.claims.dependents, dossier.claims.note],
    documentationChecklist: dossier.filing.steps,
    risks: [
      PATENT_DISCLAIMER,
      criteria.technicalCharacter < 45 ? 'Subject-matter risk: may be rejected as an abstract idea / business method.' : null,
      criteria.novelty <= 55 ? 'Novelty unconfirmed until a prior-art search is completed.' : null,
      'Public disclosure before filing can destroy novelty in most jurisdictions.',
    ].filter(Boolean),
  };
}

/* ----- gate used by the UI to enable "Register for patent" ----- */
export function canRegisterPatent(report = {}) {
  if (!report) return false;
  if (report.gate) return !!report.gate.eligible;
  return (report.patentReadinessScore || 0) >= 55 && report.classification !== 'Not patent-eligible as-is';
}
