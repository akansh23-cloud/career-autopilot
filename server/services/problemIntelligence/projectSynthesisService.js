/* ============================================================
   Service — project synthesis
   ------------------------------------------------------------
   Turns a SCORED, source-backed cluster into one concrete,
   buildable project. Deterministic skeleton is always produced;
   the AI provider augments the prose when available. Output is
   tagged with provenance (source-backed vs fallback, #sources,
   evidence strength, confidence) so the UI never fakes quality.
   ============================================================ */
import { getAIProvider } from './ai/aiProvider.js';
import { projectFingerprint } from './dedupeService.js';
import { sanitizeText } from './util.js';
import { buildProjectPackage } from '../synthesisIntelligence/projectPackageService.js';

export async function synthesizeProject({ cluster, skills = [], difficulty = '', purpose = 'portfolio' }, cfg) {
  const ai = getAIProvider(cfg);
  const synth = await ai.synthesizeProject({ cluster, skills, purpose });

  const sourceCount = cluster.signalCount || (cluster.signals || []).length || 0;
  const evidenceStrength = cluster.evidenceStrengthScore ?? 0;
  const provider = synth._ai?.provider || 'fallback';
  const confidence = synth._ai?.confidence || 'low';
  // "Source-backed" requires real evidence AND a non-fallback synthesis.
  const sourceBacked = sourceCount > 0 && evidenceStrength >= 25;

  const project = {
    title: sanitizeText(synth.title, 140),
    painPoint: sanitizeText(synth.painPoint, 900),
    affectedUsers: sanitizeText(synth.affectedUsers, 300),
    currentWorkaround: sanitizeText(synth.currentWorkaround, 600),
    whyExistingSolutionsFail: sanitizeText(synth.whyExistingSolutionsFail, 600),
    whyNow: sanitizeText(synth.whyNow, 400),
    proposedSolution: sanitizeText(synth.proposedSolution, 1200),
    noveltyAngle: sanitizeText(synth.noveltyAngle, 500),
    mvpScope: (synth.mvpScope || []).map((x) => sanitizeText(x, 200)).slice(0, 8),
    requiredSkills: (synth.requiredSkills || []).map((x) => sanitizeText(x, 60)).slice(0, 10),
    domain: cluster.domain || '',
    technology: cluster.technology || '',
    targetUser: cluster.targetUser || '',
    purpose,
    difficulty: difficulty || '',
    // curiosity / framing block (student-friendly)
    framing: buildFraming(synth, cluster),
    // provenance
    sourceBacked,
    badge: sourceBacked ? 'Source-backed' : 'Fallback draft',
    sourcesUsed: sourceCount,
    evidenceStrength,
    confidence: sourceBacked ? confidence : 'low',
    aiProvider: provider,
    sourceCitations: (cluster.topSources || []).slice(0, 6).map((s) => ({
      source: s.source, title: sanitizeText(s.title, 200), url: s.url || '',
    })),
  };
  project.fingerprint = projectFingerprint(project);

  // --- Synthesis Intelligence layer (deterministic; never throws) ---
  // Produces the structured project package (build brief, blueprint,
  // evidence grounding, quality scores, Project OS payload) and a
  // mandatory technical mechanism. The legacy fields above remain
  // untouched so existing consumers keep working.
  try {
    const pkg = await buildProjectPackage({
      query: `${cluster.title || ''} ${(cluster.keywords || []).join(' ')}`.trim() || project.title,
      idea: project,
      cluster,
      evidence: cluster.topSources || cluster.signals || [],
      evidenceStrength,
      skills,
      domain: cluster.domain || '',
      technology: cluster.technology || '',
      targetUser: cluster.targetUser || '',
      difficulty,
      purpose,
      cfg,
      includeMemory: false, // routes layer applies memory with user context
    });
    project.projectPackage = pkg;
    project.technicalMechanism = pkg.buildBrief.technicalMechanism;
    // If the AI/fallback title was weak, prefer the package's specific title.
    if (pkg.title && (!project.title || project.title.length < 12)) project.title = pkg.title;
    if (pkg.quality.warnings.length) project.qualityWarnings = pkg.quality.warnings;
  } catch {
    project.technicalMechanism = project.technicalMechanism || sanitizeText(synth.noveltyAngle, 600);
  }
  return project;
}

function buildFraming(synth, cluster) {
  const kw = (cluster.keywords || []).slice(0, 3).join(', ');
  return {
    hook: sanitizeText(synth.title ? `${synth.title}` : 'A tool people actually need', 160),
    painPoint: sanitizeText(synth.painPoint, 600),
    whoFacesIt: sanitizeText(synth.affectedUsers, 300),
    realWorldScenario: sanitizeText(synth.currentWorkaround, 600),
    brokenWorkaround: sanitizeText(synth.currentWorkaround, 600),
    whyExistingNotEnough: sanitizeText(synth.whyExistingSolutionsFail, 600),
    whyItMattersNow: sanitizeText(synth.whyNow, 400),
    whatToBuild: sanitizeText(synth.proposedSolution, 900),
    whyInteresting: sanitizeText(`You get to design the correlation/explanation layer across ${kw || 'multiple signals'} — the interesting part is making the output trustworthy, not just collecting data.`, 400),
    technicalChallenge: sanitizeText(synth.noveltyAngle, 400),
    demoMoment: 'The moment the tool surfaces the likely cause + a concrete next step and the user goes "oh, that\'s exactly it".',
    ipAngle: sanitizeText(`Possible IP angle sits in the technical method (${synth.noveltyAngle || 'the correlation/explanation mechanism'}) — but treat that as "worth review", not guaranteed.`, 400),
  };
}

export default { synthesizeProject };
