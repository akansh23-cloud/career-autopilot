/* ============================================================
   AI provider — deterministic fallback
   ------------------------------------------------------------
   Runs with NO API keys. Produces genuinely useful, source-aware
   output by reasoning over the supplied signals/keywords — but it
   NEVER claims high confidence and always labels itself as a
   fallback draft. This is what keeps the whole OS working in
   "limited mode" without crashing or faking quality.
   ============================================================ */
import { extractKeywords, sanitizeText, lc } from '../util.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const titleCase = (s) => String(s || '').split(/\s+/).map(cap).join(' ');

function topKeywords(signals, n = 8) {
  const text = signals.map((s) => `${s.title} ${s.contentSummary} ${(s.tags || []).join(' ')}`).join(' ');
  return extractKeywords(text, n);
}

export const fallbackProvider = {
  name: 'fallback',
  confidence: 'low',

  extractPainPoints({ signals = [] }) {
    const points = [];
    for (const s of signals.slice(0, 12)) {
      const kw = extractKeywords(`${s.title} ${s.contentSummary}`, 3);
      if (!kw.length) continue;
      points.push(sanitizeText(`${titleCase(kw.join(' '))}: users report friction around "${s.title}".`, 220));
    }
    return { painPoints: [...new Set(points)].slice(0, 10), _ai: { provider: 'fallback', confidence: 'low' } };
  },

  summarizeSignals({ signals = [] }) {
    const kw = topKeywords(signals, 6);
    return {
      summary: sanitizeText(`Across ${signals.length} source signal(s), recurring themes are ${kw.join(', ') || 'general workflow friction'}. (Fallback summary — enable an AI key for a sharper synthesis.)`, 600),
      _ai: { provider: 'fallback', confidence: 'low' },
    };
  },

  clusterProblems(input) {
    // Clustering itself is deterministic upstream; nothing to add here.
    return { clusters: input.clusters || [], _ai: { provider: 'fallback', confidence: 'low' } };
  },

  synthesizeProject({ cluster = {}, skills = [], purpose = 'portfolio' }) {
    const kw = (cluster.keywords && cluster.keywords.length ? cluster.keywords : extractKeywords(`${cluster.title} ${cluster.summary}`, 8));
    const WEAK = new Set(['fails', 'fail', 'error', 'errors', 'issue', 'issues', 'problem', 'problems', 'using', 'need', 'want', 'hard', 'broken', 'cannot', 'unable']);
    const strong = kw.filter((k) => !WEAK.has(k));
    const domain = cluster.domain || 'General';
    const target = cluster.targetUser || 'end users';
    const tech = cluster.technology || (strong[0] ? titleCase(strong[0]) : 'software');
    const focus = titleCase((strong[0] || strong[1] || domain).replace(/_/g, ' '));
    const skillList = (skills || []).slice(0, 4);
    const title = `${focus} ${/assist|tool|tracker|dashboard/.test(lc(focus)) ? '' : 'Assistant '}for ${titleCase(target)}`.replace(/\s+/g, ' ').trim();
    return {
      title: sanitizeText(title, 120),
      painPoint: sanitizeText(cluster.summary || `${titleCase(target)} repeatedly hit friction around ${kw.slice(0, 3).join(', ')}.`, 600),
      affectedUsers: sanitizeText(`${titleCase(target)} working in ${domain}.`, 200),
      currentWorkaround: 'People stitch the steps together manually across several tools and tabs, losing time and context.',
      whyExistingSolutionsFail: 'Existing tools each solve one slice; nothing correlates the signals end-to-end or explains the likely cause in plain language.',
      whyNow: `${tech} now makes it cheap to collect and correlate these signals automatically.`,
      proposedSolution: sanitizeText(`Build a tool that collects the ${kw.slice(0, 3).join(', ') || 'relevant'} signals, correlates them, and surfaces the most likely cause plus a concrete next step for ${target}.`, 800),
      noveltyAngle: sanitizeText(`The correlation + plain-language explanation layer across ${kw.slice(0, 2).join(' and ') || 'multiple sources'} — not any single data source.`, 400),
      mvpScope: ['Ingest 1–2 real signal sources', 'Correlate and rank likely causes', 'Show a clear explanation + suggested fix', 'Capture user feedback to improve ranking'],
      requiredSkills: skillList.length ? skillList : [tech, 'REST APIs', 'a frontend framework'],
      noveltyConfidence: 'low',
      purpose,
      _ai: { provider: 'fallback', confidence: 'low' },
    };
  },

  generateBuildBlueprint({ project = {} }) {
    const t = project.title || 'the tool';
    return {
      productDefinition: `A focused tool that turns scattered signals into a clear, actionable answer for the user. (Fallback blueprint.)`,
      mvpScope: project.mvpScope || ['Single happy-path flow', 'One real data source', 'A results screen', 'Feedback capture'],
      outOfScope: ['Multi-tenant org management', 'Billing', 'Advanced ML training', 'Mobile apps'],
      featureBreakdown: ['Ingest', 'Correlate / score', 'Explain', 'Feedback loop', 'History'],
      frontendScreens: ['Input / connect screen', 'Results dashboard with confidence', 'Detail / explanation view', 'Feedback capture'],
      backendApis: ['POST /ingest', 'POST /analyze', 'GET /result/:id', 'POST /feedback', 'GET /history'],
      databaseSchema: ['sources(id, type, reliability)', 'events(id, source_id, payload, ts)', 'results(id, subject, ranking, confidence, ts)', 'feedback(id, result_id, outcome, ts)'],
      systemArchitecture: 'Modular monolith: API layer + analysis service + datastore + feedback store. Stateless app; add a queue only if analysis is heavy.',
      dataFlow: 'ingest → normalize → correlate/score → explain → render → capture feedback → recalibrate',
      coreAlgorithm: `Reliability-weight each source, correlate overlapping signals, rank candidate causes, attach a confidence and a plain-language explanation for ${t}.`,
      githubRepoStructure: ['/server (api + services)', '/web (frontend)', '/lib (core algorithm)', '/tests', 'README.md', '.env.example'],
      weeklyRoadmap: [
        'Week 1 — scaffold repo, one real data source, basic ingest',
        'Week 2 — correlation/scoring core + results screen',
        'Week 3 — explanation layer + feedback capture',
        'Week 4 — polish, seed demo data, deploy, record walkthrough',
      ],
      testPlan: ['Unit tests for the scoring/correlation core', 'Integration test for ingest→analyze→feedback', 'A seeded demo dataset for reproducible runs'],
      demoScript: '1) Connect sample data → 2) Run analysis → 3) Show ranked cause + confidence + explanation → 4) Submit an outcome → 5) Show the ranking recalibrate.',
      deploymentPlan: 'Dockerized app, CI (lint+test+build), deploy to a managed host, health check, basic logging.',
      evidenceChecklist: ['Public GitHub repo', 'Live demo or recorded walkthrough', 'README with architecture + a measured result', 'One real outcome captured'],
      _ai: { provider: 'fallback', confidence: 'low' },
    };
  },

  estimateFeasibilityAndCost({ project = {} }) {
    // Deterministic difficulty heuristic from required skills / wording.
    const text = lc(`${project.title} ${project.proposedSolution} ${(project.requiredSkills || []).join(' ')}`);
    const heavy = /(train|model|vision|hardware|iot|robot|distributed|realtime|real-time|kubernetes|gpu)/.test(text);
    const difficulty = heavy ? 'advanced' : 'intermediate';
    return {
      difficulty,
      teamSize: heavy ? '3–4' : '2–3',
      rolesRequired: ['Full-stack dev', heavy ? 'ML/data engineer' : 'Backend dev', 'Designer (part-time)'],
      mustHaveSkills: (project.requiredSkills || ['JavaScript/TypeScript', 'REST APIs', 'a database']).slice(0, 5),
      goodToHaveSkills: ['Docker', 'basic CI/CD', heavy ? 'data pipelines' : 'cloud deploy'],
      resourcesRequired: ['A laptop', 'free-tier cloud', heavy ? 'occasional GPU / paid API credits' : 'a managed DB free tier'],
      cloudApiHardwareNotes: heavy ? 'Likely needs paid API credits or occasional GPU time.' : 'Free tiers are usually enough for an MVP.',
      indiaCostBands: {
        studentPrototype: '₹0–₹2,000',
        polishedDemo: '₹2,000–₹10,000',
        hardwareCloudHeavy: '₹10,000–₹50,000',
        startupGrade: '₹50,000+',
      },
      timeline: heavy ? '5–7 weeks' : '3–4 weeks',
      executionRisks: ['Scope creep beyond the MVP', 'Real source data being noisy/rate-limited', heavy ? 'Model/data quality' : 'Keeping the demo reproducible'],
      mvpVsAdvanced: 'MVP: one source + explanation. Advanced: multiple sources, learning loop, multi-user.',
      shouldYouBuildVerdict: `Reasonable ${difficulty} project. Strong as a ${project.purpose || 'portfolio'} piece if you ship a working demo with one measured result.`,
      _ai: { provider: 'fallback', confidence: 'low' },
    };
  },

  assessIPReadiness() {
    // Scoring is backend-owned (deterministic) — the provider only adds prose.
    return {
      narrative: 'Fallback IP note: scoring is computed deterministically by the system. Add prior-art records and prototype evidence to raise readiness. Enable an AI key for a richer technical-contribution narrative.',
      _ai: { provider: 'fallback', confidence: 'low' },
    };
  },

  generateDisclosure({ project = {} }) {
    const t = project.title || 'the invention';
    return {
      title: t,
      technicalField: `Software systems for ${project.affectedUsers || 'the target domain'}.`,
      background: project.painPoint || 'The problem context for which this invention is proposed.',
      problem: project.painPoint || '',
      existingLimitations: project.whyExistingSolutionsFail || 'Existing approaches address only parts of the problem.',
      proposedInvention: project.proposedSolution || '',
      systemComponents: (project.buildBlueprint?.featureBreakdown) || ['Ingest', 'Correlate/score', 'Explain', 'Feedback'],
      technicalWorkflow: project.buildBlueprint?.dataFlow || 'ingest → correlate → explain → feedback → recalibrate',
      novelTechnicalContribution: project.noveltyAngle || 'The correlation + explanation layer across multiple sources.',
      advantages: ['Reduces manual effort', 'Explains the likely cause, not just raw data', 'Improves over time via feedback'],
      alternativeEmbodiments: ['Different source mixes', 'On-device vs cloud processing', 'Batch vs streaming'],
      prototypeEvidence: '[To be added — link your repo, demo, and a measured result.]',
      priorArtComparison: '[To be completed in the Prior-Art Workspace — external prior-art risk is unknown until records are added.]',
      possibleClaimDirections: ['A method for correlating multi-source signals and generating an explained ranking', 'A system implementing the above with a feedback-driven recalibration loop'],
      drawingsChecklist: ['System architecture diagram', 'Data-flow diagram', 'Example UI of the explained result'],
      publicDisclosureWarning: 'Do NOT publicly disclose (blog, demo day, paper) before consulting your IP cell — public disclosure can jeopardise patentability.',
      attorneyReviewNotes: 'Fallback draft for faculty / IP-cell / patent-agent review. Verify novelty and Section 3(k) applicability with a professional.',
      _ai: { provider: 'fallback', confidence: 'low' },
    };
  },
};

export default fallbackProvider;
