/* ============================================================
   Service — Patent / IP readiness  (deterministic, backend-owned)
   ------------------------------------------------------------
   Scores 12 independent factors from the project text + evidence
   state, then applies MANDATORY hard caps so a fresh idea can
   never look like a strong patent. Uses safe, non-promissory
   labels and surfaces an India Section 3(k) warning where the
   idea looks like software/business-method/algorithm "per se".
   AI (if available) only adds a narrative — it never moves the
   number.
   ============================================================ */
import { getAIProvider } from './ai/aiProvider.js';
import { clamp, lc } from './util.js';

const TECH_EFFECT = /(latency|throughput|memory|hardware|sensor|signal|device|network|protocol|compression|encryption|scheduling|pipeline|real-?time|edge|embedded|fault|anomaly|calibrat|fusion|optimi[sz])/;
const BUSINESS_METHOD = /(marketplace|pricing|billing|subscription|payment flow|business model|matching users|recommendation feed|loyalty|discount|coupon|e-?commerce checkout)/;
const ALGO_ONLY = /(algorithm|mathematical|formula|model that predicts|ml model|neural net|classifier)/;

function len(s) { return String(s || '').trim().length; }
function has(s, re) { return re.test(lc(s || '')); }

export function computeIPReadiness({ project = {}, priorArtRecords = [], hasPrototypeEvidence = false }) {
  const text = `${project.title} ${project.painPoint} ${project.proposedSolution} ${project.noveltyAngle} ${project.technicalMechanism || ''} ${JSON.stringify(project.buildBlueprint || {})}`;
  const technicalEffect = has(text, TECH_EFFECT);
  const businessMethodOnly = has(text, BUSINESS_METHOD) && !technicalEffect;
  const algorithmOnly = has(text, ALGO_ONLY) && !technicalEffect;
  const sourcesUsed = Number(project.sourcesUsed || project.evidenceStrength ? project.sourcesUsed : 0) || Number(project.sourcesUsed || 0);
  const hasSourceEvidence = (Number(project.sourcesUsed) || 0) > 0 && (Number(project.evidenceStrength) || 0) >= 25;
  const priorArtCount = priorArtRecords.length;

  // ---- 12 factors (0–100) ----
  const factors = {
    ideaClarity: clamp(scaleLen(project.title, 12, 80) + scaleLen(project.proposedSolution, 80, 500), 0, 100),
    painClarity: clamp(scaleLen(project.painPoint, 60, 400) + (hasSourceEvidence ? 25 : 0), 0, 100),
    buildClarity: clamp(blueprintCompleteness(project.buildBlueprint), 0, 100),
    technicalContribution: technicalEffect ? 70 : (algorithmOnly ? 25 : 40),
    noveltyPotential: clamp(40 + scaleLen(project.noveltyAngle, 40, 300), 0, 80), // never high pre-prior-art
    inventiveStepPotential: technicalEffect ? 55 : 30,
    priorArtConfidence: priorArtCount === 0 ? 10 : clamp(35 + priorArtCount * 15 - blockingPenalty(priorArtRecords), 0, 90),
    section3kRisk: section3kRisk({ businessMethodOnly, algorithmOnly, technicalEffect }), // higher = riskier
    prototypeEvidence: hasPrototypeEvidence ? 70 : 0,
    disclosureReadiness: project.disclosureReady ? 70 : (len(project.proposedSolution) > 120 ? 35 : 15),
    commercialUtility: clamp(35 + (hasSourceEvidence ? 25 : 0) + scaleLen(project.affectedUsers, 20, 200), 0, 90),
    enforceability: technicalEffect ? 55 : 25,
  };

  // ---- weighted base (Section 3(k) risk is inverted: subtracts) ----
  const positive = (
    factors.ideaClarity * 0.08 + factors.painClarity * 0.08 + factors.buildClarity * 0.08 +
    factors.technicalContribution * 0.16 + factors.noveltyPotential * 0.12 +
    factors.inventiveStepPotential * 0.12 + factors.priorArtConfidence * 0.10 +
    factors.prototypeEvidence * 0.08 + factors.disclosureReadiness * 0.04 +
    factors.commercialUtility * 0.06 + factors.enforceability * 0.08
  );
  let overall = Math.round(positive - factors.section3kRisk * 0.18);
  overall = clamp(overall, 0, 100);

  // ---- MANDATORY HARD CAPS ----
  const caps = [];
  if (!hasSourceEvidence) caps.push(['No source evidence', 55]);
  if (priorArtCount === 0) caps.push(['No prior-art records', 65]);
  if (!hasPrototypeEvidence) caps.push(['No prototype evidence', 75]);
  if (businessMethodOnly) caps.push(['Generic software / business-method-only idea', 50]);
  if (algorithmOnly) caps.push(['Algorithm-only idea with no technical effect', 45]);
  let appliedCap = 100;
  for (const [, cap] of caps) appliedCap = Math.min(appliedCap, cap);
  if (overall > appliedCap) overall = appliedCap;

  const label = labelFor(overall);
  const recommendedIPRoute = recommendRoute({ overall, technicalEffect, businessMethodOnly, algorithmOnly, project });
  const section3kWarning = (businessMethodOnly || algorithmOnly)
    ? 'India Patents Act Section 3(k): computer programmes "per se", algorithms and business methods are not patentable. This idea currently reads that way — emphasise a concrete technical effect (hardware, performance, signal, device) or consider copyright/design/research routes.'
    : (technicalEffect ? '' : 'India Section 3(k) may apply unless a clear technical effect is demonstrated.');

  return {
    overall,
    label,
    factors,
    appliedCaps: caps.map(([reason, cap]) => ({ reason, cap })),
    capApplied: appliedCap < 100 ? appliedCap : null,
    recommendedIPRoute,
    section3kWarning,
    flags: { technicalEffect, businessMethodOnly, algorithmOnly, hasSourceEvidence, hasPrototypeEvidence, priorArtCount },
    priorArtStatus: priorArtCount === 0 ? 'External prior-art risk unknown.' : `${priorArtCount} prior-art record(s) reviewed.`,
    requiredEvidenceToImprove: requiredEvidence({ hasSourceEvidence, priorArtCount, hasPrototypeEvidence, technicalEffect, businessMethodOnly, algorithmOnly }),
    disclaimer: 'This is not legal advice. Scores are an internal triage signal for faculty/IP-cell/patent-agent review only.',
  };
}

function scaleLen(s, lo, hi) {
  const l = len(s);
  if (l <= 0) return 0;
  if (l >= hi) return 50;
  if (l < lo) return Math.round((l / lo) * 15);
  return Math.round(15 + ((l - lo) / (hi - lo)) * 35);
}

function blueprintCompleteness(bp) {
  if (!bp || typeof bp !== 'object') return 20;
  let filled = 0; const keys = ['systemArchitecture', 'coreAlgorithm', 'backendApis', 'databaseSchema', 'testPlan', 'mvpScope'];
  for (const k of keys) if ((Array.isArray(bp[k]) && bp[k].length) || len(bp[k]) > 20) filled++;
  return Math.round((filled / keys.length) * 100);
}

function blockingPenalty(records) {
  let p = 0;
  for (const r of records) {
    const risk = lc(r.blockingRisk || r.similarityRisk || r.riskLevel || '');
    if (/high/.test(risk)) p += 25; else if (/med/.test(risk)) p += 10;
  }
  return p;
}

function section3kRisk({ businessMethodOnly, algorithmOnly, technicalEffect }) {
  if (businessMethodOnly) return 80;
  if (algorithmOnly) return 70;
  if (!technicalEffect) return 45;
  return 20;
}

function labelFor(overall) {
  if (overall >= 75) return 'High priority for IP review';
  if (overall >= 60) return 'Worth structured review';
  if (overall >= 45) return 'Needs technical strengthening';
  if (overall >= 30) return 'Low patent-readiness';
  return 'Not suitable for patent route';
}

function recommendRoute({ overall, technicalEffect, businessMethodOnly, algorithmOnly, project }) {
  if (technicalEffect && overall >= 60) return 'patent';
  if (algorithmOnly || (project.purpose === 'research')) return 'research paper';
  if (businessMethodOnly) return 'startup MVP';
  if (/ui|interface|design|layout|visual/.test(lc(`${project.title} ${project.proposedSolution}`))) return 'design';
  if (overall < 45) return 'portfolio';
  return 'copyright';
}

function requiredEvidence({ hasSourceEvidence, priorArtCount, hasPrototypeEvidence, technicalEffect, businessMethodOnly, algorithmOnly }) {
  const out = [];
  if (!hasSourceEvidence) out.push('Run source-backed discovery so the problem is evidenced (lifts the 55 cap).');
  if (priorArtCount === 0) out.push('Add prior-art records in the workspace (lifts the 65 cap and resolves "prior-art unknown").');
  if (!hasPrototypeEvidence) out.push('Link a working prototype / public repo / demo (lifts the 75 cap).');
  if (!technicalEffect) out.push('Articulate a concrete technical effect (performance, hardware, signal, device) to reduce Section 3(k) risk.');
  if (businessMethodOnly) out.push('Reframe away from a pure business method, or pursue copyright/design/startup routes.');
  if (algorithmOnly) out.push('Tie the algorithm to a real-world technical effect, or pursue a research-paper route.');
  return out;
}

/* Optional AI narrative (never changes the number). */
export async function ipNarrative(project, cfg) {
  const ai = getAIProvider(cfg);
  const out = await ai.assessIPReadiness({ project });
  return { narrative: out.narrative || '', aiProvider: out._ai?.provider || 'fallback', confidence: out._ai?.confidence || 'low' };
}

export default { computeIPReadiness, ipNarrative };
