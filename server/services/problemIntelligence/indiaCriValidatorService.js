/* ============================================================
   Service — India CRI / Section 3(k) validator
   ------------------------------------------------------------
   Deterministic analysis of software/AI patentability risk under
   India's Section 3(k) and the CRI guidelines. NEVER says
   "patentable". Produces a risk level + reasons + technical-effect
   analysis used to CAP the IP-readiness score when the technical
   effect is weak.
   ============================================================ */
import { lc } from './util.js';

const TECH_EFFECT = /(latency|throughput|memory|hardware|sensor|signal|device|network|protocol|compression|encryption|scheduling|pipeline|real-?time|edge|embedded|fault|anomaly|calibrat|fusion|optimi[sz]|power|bandwidth|accuracy improvement|measurable)/;
const BUSINESS_METHOD = /(marketplace|pricing|billing|subscription|payment flow|business model|matching users|recommendation feed|loyalty|discount|coupon|checkout|monet[is]z)/;
const ALGO_ONLY = /(algorithm|mathematical|formula|model that predicts|ml model|neural net|classifier|statistical method)/;
const PRESENTATION = /(dashboard|chart|visuali[sz]ation|ui layout|display of information|report view)/;
const AUTOMATION = /(automate|automation|digiti[sz]e|move to (the )?cloud|online version of)/;

const has = (text, re) => re.test(lc(text || ''));

export function validateIndiaCRI(project = {}) {
  const text = `${project.title} ${project.painPoint} ${project.proposedSolution} ${project.noveltyAngle} ${project.technicalMechanism || ''} ${JSON.stringify(project.buildBlueprint || {})}`;
  const technicalEffect = has(text, TECH_EFFECT);
  const businessMethod = has(text, BUSINESS_METHOD) && !technicalEffect;
  const algorithmOnly = has(text, ALGO_ONLY) && !technicalEffect;
  const presentationOnly = has(text, PRESENTATION) && !technicalEffect && !algorithmOnly;
  const mereAutomation = has(text, AUTOMATION) && !technicalEffect;

  const reasons = [];
  if (businessMethod) reasons.push('Reads as a business method (Section 3(k) excludes business methods).');
  if (algorithmOnly) reasons.push('Reads as an algorithm/mathematical method without a clear technical effect.');
  if (presentationOnly) reasons.push('Reads as a presentation of information (excluded subject matter).');
  if (mereAutomation) reasons.push('Reads as mere automation/digitisation of a known manual process.');
  if (!technicalEffect) reasons.push('No concrete technical effect (hardware, performance, signal, device) is articulated.');

  let risk = 'low';
  if (businessMethod || algorithmOnly || presentationOnly) risk = 'high';
  else if (!technicalEffect || mereAutomation) risk = 'medium';

  const verdict = risk === 'high'
    ? 'Low patent-readiness under Section 3(k) — pursue copyright/design/research/startup routes unless a strong technical effect is added.'
    : risk === 'medium'
      ? 'Worth structured review only after a concrete technical effect is demonstrated.'
      : 'A technical effect appears present — worth structured IP review (not a guarantee of patentability).';

  return {
    section3kRisk: risk,
    riskReasons: reasons,
    technicalEffect: technicalEffect ? extractEffect(text) : 'Not clearly articulated.',
    technicalProblem: project.painPoint ? String(project.painPoint).slice(0, 300) : 'State the underlying technical problem explicitly.',
    technicalMeans: project.noveltyAngle ? String(project.noveltyAngle).slice(0, 300) : 'Describe the specific technical means (architecture/method), not just the outcome.',
    improvementSuggestions: improvements({ technicalEffect, businessMethod, algorithmOnly, presentationOnly, mereAutomation }),
    patentRouteVerdict: verdict,
    flags: { technicalEffect, businessMethod, algorithmOnly, presentationOnly, mereAutomation },
  };
}

function extractEffect(text) {
  const m = lc(text).match(TECH_EFFECT);
  return m ? `Claimed effect relates to: ${m[0]} (verify it is concrete and measurable).` : 'Technical effect present.';
}

function improvements({ technicalEffect, businessMethod, algorithmOnly, presentationOnly, mereAutomation }) {
  const out = [];
  if (!technicalEffect) out.push('Show a concrete, measurable technical effect (e.g., reduced latency, lower memory, improved accuracy tied to a technical mechanism).');
  if (businessMethod) out.push('Move the inventive contribution from the business logic to a technical method or system architecture.');
  if (algorithmOnly) out.push('Tie the algorithm to a real-world technical effect or a specific hardware/system interaction.');
  if (presentationOnly) out.push('Anchor novelty in the underlying processing, not the display/visual layout.');
  if (mereAutomation) out.push('Demonstrate a technical advance beyond simply digitising a known manual process.');
  out.push('Describe system/hardware interaction and where computation happens (edge/server/device).');
  return out;
}

/* Map the validator result to a hard cap for the IP-readiness score. */
export function ipCapFromCRI(cri) {
  if (cri.section3kRisk === 'high') return cri.flags.algorithmOnly ? 45 : 50;
  if (cri.section3kRisk === 'medium') return 60;
  return 100;
}

export default { validateIndiaCRI, ipCapFromCRI };
