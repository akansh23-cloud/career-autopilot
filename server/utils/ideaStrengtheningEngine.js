/* ============================================================
   IDEA STRENGTHENING ENGINE  (deterministic)
   ------------------------------------------------------------
   Turns a weak/generic idea into a stronger patent-style invention by
   injecting the technical pieces the scorer rewards (mechanism, data fusion,
   feedback loop, measurable advantage), then re-scores. Returns the upgraded
   idea + a human-readable change explanation.
   ============================================================ */
import { scorePatentIdea } from './patentScoringEngine.js';

const lc = (s) => String(s || '').toLowerCase();
const has = (s) => lc(s).trim().length > 0;
const titleCase = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());

export function strengthenIdea(idea = {}, { feedback = [], priorArtRecords = [], projectPackage = null } = {}) {
  const before = scorePatentIdea(idea, { priorArtRecords, projectPackage });
  const changes = [];
  const out = { ...idea };
  const domain = idea.domain || 'the domain';
  const tu = idea.targetUser || 'users';

  // Optional synthesis input: prefer the package's domain-specific
  // mechanism/architecture over generic fusion boilerplate. Fully
  // backward compatible — without a package the path is unchanged.
  const synth = projectPackage && typeof projectPackage === 'object' ? projectPackage : null;
  const synthMech = String(synth?.buildBrief?.technicalMechanism || '');
  const synthArch = Array.isArray(synth?.projectBlueprint?.architecture) ? synth.projectBlueprint.architecture : [];
  const synthData = Array.isArray(synth?.buildBrief?.dataSources) ? synth.buildBrief.dataSources : [];
  const synthOutput = String(synth?.buildBrief?.expectedOutput || '');

  // 1) Force a concrete technical mechanism if missing/thin.
  if (lc(out.technicalMechanism).length < 60) {
    out.technicalMechanism = synthMech.length > 60
      ? synthMech
      : `${titleCase(out.title || 'The system')} works by fusing multiple ${domain} data sources, weighting each by reliability, processing them through an adaptive scoring pipeline, and emitting a calibrated output with a confidence value. It detects anomalies and re-weights sources from downstream outcomes.`;
    changes.push(synthMech.length > 60
      ? 'Adopted the domain-specific technical mechanism from the synthesis project package.'
      : 'Added a concrete technical mechanism (multi-source fusion + adaptive scoring + anomaly detection).');
  }
  // 2) Add explicit I/O + processing if missing.
  if (!has(out.inputData)) { out.inputData = synthData.length ? synthData.slice(0, 4).join('; ') : `Multiple ${domain} signals/records relevant to the problem.`; changes.push('Defined explicit inputs.'); }
  if (!has(out.processingLogic)) { out.processingLogic = synthArch.length ? synthArch.slice(0, 5).join(' → ') : 'Ingest → normalize → reliability-weight → fuse/score → calibrate → emit with confidence.'; changes.push('Added processing logic / algorithm steps.'); }
  if (!has(out.outputResult)) { out.outputResult = synthOutput.length > 20 ? synthOutput : 'A calibrated, real-time decision/score with a confidence value and explanation.'; changes.push('Defined the output and confidence signal.'); }
  // 3) Add a feedback loop.
  if (lc(out.feedbackLoop).length < 15) {
    out.feedbackLoop = 'Downstream outcomes are captured and used to recalibrate source weights and thresholds, so accuracy improves over time.';
    changes.push('Added an outcome-driven adaptive feedback loop.');
  }
  // 4) Strengthen novelty by combining signals + privacy/edge angle.
  if (lc(out.noveltyAngle).length < 30) {
    out.noveltyAngle = 'Combines signals existing tools treat in isolation, with outcome-driven adaptive weighting and privacy-preserving on-device processing.';
    changes.push('Sharpened the novelty angle (signal combination + adaptive weighting + privacy).');
  }
  // 5) Add a measurable advantage if absent.
  if (!/\b(reduce|increase|improve|accuracy|%|faster|fewer)\b/.test(lc(out.marketUseCase) + lc(out.proposedSolution))) {
    out.marketUseCase = `${has(out.marketUseCase) ? out.marketUseCase + ' ' : ''}Targets a measurable improvement (e.g. fewer errors / faster decisions) for ${tu}.`;
    changes.push('Added a measurable technical advantage.');
  }
  // 6) Strengthen the title if generic.
  if (/\bai (app|tool|platform) for\b/i.test(out.title || '')) {
    const core = (out.title || '').replace(/\bai (app|tool|platform) for\b/i, '').trim();
    out.title = `${titleCase(domain)} ${titleCase(core)} fusion engine with adaptive feedback`;
    changes.push('Replaced a generic title with a mechanism-specific one.');
  }

  out.tags = Array.from(new Set([...(out.tags || []), 'feedback-loop', 'data-fusion', 'adaptive']));
  const after = scorePatentIdea(out, { priorArtRecords, projectPackage });
  out.scoreSummary = { overall: after.overall, grade: after.grade, riskLevel: after.riskLevel };
  out.weak = after.overall < 55;

  return {
    idea: out,
    scoreBefore: before.overall,
    scoreAfter: after.overall,
    gradeBefore: before.grade,
    gradeAfter: after.grade,
    changes: changes.length ? changes : ['Idea already strong; reinforced tags and confidence wording.'],
    claimDirection: `A method/system for ${lc(domain)} comprising: (a) ingesting multiple source signals; (b) reliability-weighting and fusing them via an adaptive pipeline; (c) emitting a calibrated output; and (d) recalibrating weights from downstream outcomes.`,
  };
}

export default { strengthenIdea };
