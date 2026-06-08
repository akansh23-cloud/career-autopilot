import { fetchGitHubIssueSignals } from './connectors/githubIssuesConnector.js';
import { fetchStackExchangeSignals } from './connectors/stackExchangeConnector.js';
import { fetchArxivSignals } from './connectors/arxivConnector.js';
import { buildManualSignals } from './connectors/manualProblemConnector.js';
import { askJSON, configuredProviderName } from './ai/aiProvider.js';
import { clamp, round, lc, sanitizeText, stableHash, uniqueStrings, keywordTokens, dedupeByHash, confidenceLabel } from './utils.js';

const PURPOSE_ROUTES = ['portfolio', 'research', 'startup', 'patent-review'];
const SECTION3K_TERMS = ['business method', 'marketplace', 'booking', 'directory', 'listing', 'chatbot', 'recommendation app', 'dashboard only', 'algorithm only'];

export const PI_VERSION = 'problem-intelligence-v1';

export function problemIntelligenceConfig() {
  return {
    enabled: process.env.PROBLEM_INTELLIGENCE_ENABLED !== '0',
    aiProvider: configuredProviderName(),
    githubConfigured: !!process.env.GITHUB_TOKEN,
    stackExchangeConfigured: !!process.env.STACKEXCHANGE_KEY,
    arxivEnabled: true,
    maxSignals: Number(process.env.PROBLEM_DISCOVERY_MAX_SIGNALS || 30),
    timeoutMs: Number(process.env.PROBLEM_DISCOVERY_TIMEOUT_MS || 12000),
  };
}

function sourceLimit(limit, n) { return Math.max(2, Math.min(n, Math.ceil((Number(limit) || 24) / 3))); }

export async function fetchSignals(input = {}) {
  const cfg = problemIntelligenceConfig();
  const sources = Array.isArray(input.sources) && input.sources.length ? input.sources : ['github', 'stackexchange', 'arxiv', 'manual'];
  const limit = Math.min(Number(input.limit || cfg.maxSignals || 30), 50);
  const timeoutMs = Number(input.timeoutMs || cfg.timeoutMs || 12000);
  const tasks = [];
  if (sources.includes('github')) tasks.push(fetchGitHubIssueSignals(input, { limit: sourceLimit(limit, 12), timeoutMs }));
  if (sources.includes('stackexchange')) tasks.push(fetchStackExchangeSignals(input, { limit: sourceLimit(limit, 10), timeoutMs }));
  if (sources.includes('arxiv')) tasks.push(fetchArxivSignals(input, { limit: sourceLimit(limit, 8), timeoutMs }));

  const settled = await Promise.allSettled(tasks);
  const warnings = [];
  const fetched = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') fetched.push(...s.value);
    else warnings.push(`Source failed: ${s.reason?.message || 'unknown'}`);
  }
  if (sources.includes('manual') || fetched.length === 0) fetched.push(...buildManualSignals(input));
  const deduped = dedupeByHash(fetched, (x) => x.rawTextHash);
  return { signals: deduped.items.slice(0, limit), skippedDuplicates: deduped.skipped, warnings };
}

export function extractPainPoints(signals = [], input = {}) {
  return signals.map((s) => {
    const text = `${s.title}. ${s.contentSummary}`;
    const tokens = keywordTokens(text, 10);
    const user = input.targetUser || s.targetUser || inferAffectedUser(text) || 'builders and teams';
    const pain = sanitizeText(inferPainPoint(text, input), 420);
    const constraints = inferConstraints(text, input);
    return {
      ...s,
      extractedPainPoints: [{
        painPoint: pain,
        affectedUsers: [user],
        currentWorkaround: inferWorkaround(text),
        severity: inferSeverity(s),
        constraints,
        keywords: tokens,
      }],
    };
  });
}

function inferPainPoint(text, input) {
  const t = sanitizeText(text, 600);
  if (input.problem) return input.problem;
  const sentence = t.split(/[.!?]/).find((x) => /fail|error|slow|manual|hard|issue|problem|support|unable|missing|need|request|confus|detect|improve/i.test(x));
  return sentence || t || `Teams need a better way to solve recurring ${input.domain || 'technical'} problems.`;
}
function inferAffectedUser(text) {
  if (/kubernetes|jenkins|deploy|ci|cd|devops|terraform|container/i.test(text)) return 'DevOps and platform engineers';
  if (/student|college|course|exam|learn/i.test(text)) return 'students and faculty';
  if (/doctor|patient|health|medical/i.test(text)) return 'healthcare teams';
  if (/farmer|crop|soil|irrigation/i.test(text)) return 'farmers and agri operators';
  return '';
}
function inferWorkaround(text) {
  if (/manual|manually|workaround/i.test(text)) return 'Manual inspection, spreadsheets, scripts, or repeated trial-and-error.';
  if (/dashboard|monitor/i.test(text)) return 'Existing dashboards show raw symptoms but require human interpretation.';
  return 'Users rely on point tools, forum answers, and ad-hoc fixes instead of a guided workflow.';
}
function inferSeverity(s) {
  const e = s.engagement || {};
  const v = Number(e.comments || 0) + Number(e.answers || 0) + Math.min(10, Math.floor(Number(e.views || 0) / 1000)) + Number(e.reactions || 0);
  if (v >= 20) return 'high';
  if (v >= 6) return 'medium-high';
  return 'medium';
}
function inferConstraints(text, input) {
  const out = [];
  if (/real.?time|latency|fast/i.test(text)) out.push('low-latency or near-real-time feedback');
  if (/privacy|secret|token|credential/i.test(text)) out.push('privacy/security sensitive inputs');
  if (/scale|large|many|performance/i.test(text)) out.push('must handle production-scale data');
  if (/kubernetes|cloud|deploy|ci|cd/i.test(`${text} ${input.domain || ''}`)) out.push('must integrate with real DevOps/cloud tooling');
  if (/ai|ml|model|llm/i.test(`${text} ${input.technology || ''}`)) out.push('must avoid generic AI wrapper behavior and produce measurable technical output');
  return uniqueStrings(out, 6);
}

export function clusterProblems(signals = [], input = {}) {
  const buckets = new Map();
  for (const s of signals) {
    const pain = s.extractedPainPoints?.[0] || {};
    const tokens = keywordTokens(`${s.title} ${pain.painPoint} ${(s.tags || []).join(' ')}`, 8);
    const key = chooseClusterKey(tokens, input);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  }
  const clusters = [];
  for (const [key, list] of buckets.entries()) {
    const allText = list.map((s) => `${s.title} ${s.contentSummary}`).join(' ');
    const keywords = keywordTokens(allText, 10);
    const title = buildClusterTitle(key, keywords, input);
    const pain = list[0]?.extractedPainPoints?.[0]?.painPoint || input.problem || `Recurring ${input.domain || 'technical'} issue`;
    const scores = scoreCluster(list, input, keywords);
    const fingerprint = stableHash(`${input.domain}|${input.technology}|${input.targetUser}|${title}|${keywords.slice(0, 5).join(',')}`).slice(0, 32);
    clusters.push({
      id: fingerprint,
      title,
      summary: sanitizeText(pain, 500),
      domain: input.domain || list[0]?.domain || '',
      technology: input.technology || list[0]?.technology || '',
      targetUser: input.targetUser || list[0]?.targetUser || '',
      signalIds: list.map((s) => s.sourceId),
      signals: list.slice(0, 8),
      sourceCitations: list.slice(0, 6).map((s) => ({ source: s.source, title: s.title, url: s.sourceUrl })),
      keywords,
      ...scores,
      recommendedRoute: recommendedRoute(scores, input),
      confidence: confidenceLabel(scores.evidenceStrengthScore),
      dedupeFingerprint: fingerprint,
      sourceBacked: list.some((s) => s.source !== 'manual'),
    });
  }
  return clusters.sort((a, b) => (b.evidenceStrengthScore + b.severityScore + b.portfolioValueScore) - (a.evidenceStrengthScore + a.severityScore + a.portfolioValueScore)).slice(0, 8);
}

function chooseClusterKey(tokens, input) {
  const domain = lc(input.domain);
  const tech = lc(input.technology);
  const priority = ['kubernetes', 'deployment', 'drift', 'security', 'resume', 'irrigation', 'diagnosis', 'monitoring', 'automation', 'scheduling', 'testing', 'cost', 'fraud', 'accessibility'];
  return tokens.find((t) => priority.includes(t)) || tokens.find((t) => ![domain, tech].includes(t)) || domain || tech || 'innovation';
}
function buildClusterTitle(key, keywords, input) {
  const domain = input.domain || keywords[1] || 'Technical';
  const user = input.targetUser || 'teams';
  const focus = key.replace(/-/g, ' ');
  if (/deploy|kubernetes|jenkins|ci|cd|devops/i.test(`${domain} ${focus}`)) return `${focus[0].toUpperCase() + focus.slice(1)} failure diagnosis for ${user}`;
  if (/drift|model|ml|ai/i.test(`${domain} ${focus}`)) return `Production ${focus} intelligence for ${user}`;
  return `${domain} ${focus} problem for ${user}`;
}
function scoreCluster(list, input, keywords) {
  const nonManual = list.filter((s) => s.source !== 'manual').length;
  const sourceKinds = new Set(list.map((s) => s.source)).size;
  const engagement = list.reduce((a, s) => a + Number(s.engagement?.comments || 0) + Number(s.engagement?.answers || 0) + Number(s.engagement?.reactions || 0) + Math.min(12, Math.floor(Number(s.engagement?.views || 0) / 1500)), 0);
  const evidenceStrengthScore = clamp(25 + nonManual * 10 + sourceKinds * 8 + Math.min(25, engagement));
  const severityScore = clamp(35 + Math.min(35, engagement * 2) + (lc(input.goal).includes('safety') ? 10 : 0));
  const trendScore = clamp(35 + nonManual * 7 + sourceKinds * 7);
  const buildFeasibilityScore = clamp(72 - (lc(input.difficulty).includes('advanced') ? 5 : 0) + (input.skills?.length ? 8 : 0));
  const portfolioValueScore = clamp(55 + (keywords.some((k) => ['kubernetes', 'cloud', 'ai', 'security', 'automation', 'devops', 'ml'].includes(k)) ? 22 : 10));
  const researchPotentialScore = clamp(35 + (list.some((s) => s.source === 'arxiv') ? 35 : 0) + (lc(input.technology).includes('ai') ? 10 : 0));
  const patentPotentialScore = clamp(28 + sourceKinds * 7 + (keywords.some((k) => ['protocol', 'edge', 'sensor', 'privacy', 'detection', 'optimization', 'fusion'].includes(k)) ? 24 : 8) - (lc(input.purpose).includes('portfolio') ? 5 : 0));
  return { evidenceStrengthScore, severityScore, trendScore, buildFeasibilityScore, portfolioValueScore, researchPotentialScore, patentPotentialScore };
}
function recommendedRoute(scores, input) {
  if (scores.patentPotentialScore >= 62 && lc(input.purpose).includes('patent')) return 'patent-review';
  if (scores.researchPotentialScore >= 65) return 'research';
  if (scores.portfolioValueScore >= 70 && scores.buildFeasibilityScore >= 60) return 'portfolio';
  if (scores.severityScore >= 70 && scores.buildFeasibilityScore >= 55) return 'startup';
  return PURPOSE_ROUTES.includes(input.purpose) ? input.purpose : 'portfolio';
}

export async function enrichClustersWithAI(clusters = [], input = {}) {
  if (!clusters.length || configuredProviderName() === 'fallback') return { clusters, provider: 'fallback' };
  const prompt = `Return ONLY JSON. Improve these source-backed problem clusters without inventing sources. Keep ids unchanged. For each cluster add concise fields: hook, refinedSummary, whyNow.\nINPUT=${JSON.stringify({ input, clusters: clusters.map((c) => ({ id: c.id, title: c.title, summary: c.summary, signals: c.signals?.slice(0,3).map((s)=>({title:s.title,source:s.source})) })) })}`;
  const out = await askJSON(prompt, { maxTokens: 1600 });
  const byId = new Map((out.json?.clusters || []).map((c) => [c.id, c]));
  return { provider: out.provider, clusters: clusters.map((c) => ({ ...c, ...(byId.get(c.id) || {}) })) };
}

export function synthesizeProject(cluster = {}, input = {}) {
  const domain = cluster.domain || input.domain || 'Technology';
  const tech = cluster.technology || input.technology || 'software';
  const target = cluster.targetUser || input.targetUser || 'teams';
  const keywords = cluster.keywords || [];
  const topic = cluster.title || `${domain} problem solver`;
  const baseTitle = makeProjectTitle(topic, domain, target, keywords);
  const pain = cluster.summary || input.problem || `A repeated ${domain} problem needs a practical, buildable solution.`;
  const sourceCount = cluster.signals?.length || cluster.signalIds?.length || 0;
  const sourceBacked = !!cluster.sourceBacked && sourceCount > 0;
  const project = {
    title: baseTitle,
    clusterId: cluster.id || cluster.dedupeFingerprint || '',
    sourceMode: sourceBacked ? 'source-backed' : 'fallback-draft',
    confidence: sourceBacked ? cluster.confidence || 'medium' : 'low',
    evidenceSourceCount: sourceCount,
    sourceCitations: cluster.sourceCitations || [],
    painPoint: pain,
    affectedUsers: [target],
    currentWorkaround: cluster.signals?.[0]?.extractedPainPoints?.[0]?.currentWorkaround || 'Manual research, dashboards, trial-and-error fixes, or disconnected tools.',
    whyExistingSolutionsFail: `Existing solutions usually expose raw information but do not convert repeated ${domain} pain into an explainable, actionable workflow for ${target}.`,
    whyNow: cluster.whyNow || `Recent public issues, questions, and research signals indicate this problem is active enough to become a useful student project or innovation direction.`,
    hook: cluster.hook || `What if ${target} could solve this recurring ${domain} problem with one guided workflow instead of scattered tools?`,
    proposedSolution: `Build a ${tech} system that ingests relevant signals, extracts the failure/problem context, ranks likely causes or opportunities, and gives a clear action plan with evidence-backed reasoning.`,
    noveltyAngle: `The innovation angle is not a generic dashboard; it is the source-backed correlation of multiple weak signals into a measurable technical decision or recommendation workflow.`,
    technicalChallenge: `Design a reliable signal-ingestion and scoring mechanism that works on noisy real-world inputs and produces explainable outputs rather than generic AI text.`,
    demoMoment: `Run the system on a realistic sample problem and show how it moves from raw signals to a ranked diagnosis/recommendation and concrete next steps.`,
    mvpScope: buildMvpScope(domain, tech, keywords),
    technicalArchitecture: buildArchitecture(domain, tech),
    requiredSkills: uniqueStrings([...(input.skills || []), tech, 'REST APIs', 'Data modeling', 'Frontend dashboard', 'Testing'].filter(Boolean), 14),
    buildRoadmap: buildRoadmap(),
    githubRepoStructure: buildRepoStructure(),
    testPlan: buildTestPlan(domain),
    demoScript: buildDemoScript(baseTitle),
    evidenceChecklist: buildEvidenceChecklist(),
  };
  project.costEstimate = estimateFeasibilityAndCost(project, input);
  project.ipReadiness = assessIPReadiness(project, cluster, input);
  project.disclosureOutline = generateDisclosureOutline(project);
  project.fingerprint = stableHash(`${project.title}|${project.painPoint}|${project.noveltyAngle}`).slice(0, 32);
  return project;
}

function makeProjectTitle(topic, domain, target, keywords) {
  const t = lc(`${topic} ${keywords.join(' ')}`);
  if (/kubernetes|pod|deploy|ci|jenkins|devops/.test(t)) return 'Deployment Failure Root-Cause Assistant';
  if (/drift|model|ml|prediction/.test(t)) return 'Production Model Drift Early-Warning System';
  if (/security|secret|credential|vulnerability/.test(t)) return 'Security Risk Evidence Correlator';
  if (/agri|soil|crop|irrigation|farmer/.test(t)) return 'Adaptive Farm Resource Decision Assistant';
  if (/health|patient|doctor|medical/.test(t)) return 'Clinical Workflow Triage Support System';
  return `${domain} Problem Intelligence Assistant for ${target}`.replace(/\s+/g, ' ').trim();
}
function buildMvpScope(domain, tech, keywords) {
  return [
    'Problem intake form and source/evidence viewer',
    'Signal ingestion service for sample/public data',
    'Rule-based + AI-assisted pain-point extraction',
    'Scoring engine for severity, feasibility, and evidence strength',
    'Dashboard showing diagnosis/recommendation with source links',
    'Exportable report for faculty/recruiter review',
  ];
}
function buildArchitecture(domain, tech) {
  return [
    { layer: 'Frontend', components: ['Problem discovery UI', 'Evidence panel', 'Recommendation dashboard', 'Report/export view'] },
    { layer: 'Backend', components: ['Signal ingestion API', 'Extraction service', 'Scoring service', 'Project/report service'] },
    { layer: 'Data', components: ['ProblemSignal collection', 'ProblemCluster collection', 'GeneratedProject collection'] },
    { layer: 'AI/Rules', components: ['Provider-agnostic AI adapter', 'Deterministic fallback', 'Safety/cap scoring rules'] },
  ];
}
function buildRoadmap() {
  return [
    { phase: 'Week 1', tasks: ['Finalize problem scope', 'Create repo structure', 'Build frontend shell', 'Add backend models/APIs'] },
    { phase: 'Week 2', tasks: ['Implement ingestion and sample data', 'Build extraction/scoring logic', 'Add evidence viewer'] },
    { phase: 'Week 3', tasks: ['Build recommendation engine', 'Add report/dashboard', 'Create test cases'] },
    { phase: 'Week 4', tasks: ['Deploy MVP', 'Record demo', 'Collect benchmark/evidence', 'Prepare disclosure-ready documentation'] },
  ];
}
function buildRepoStructure() {
  return ['client/src/pages', 'client/src/components/evidence', 'server/routes', 'server/services/ingestion', 'server/services/scoring', 'server/models', 'docs/architecture.md', 'docs/demo-script.md', 'docs/ip-disclosure-notes.md'];
}
function buildTestPlan(domain) {
  return ['Unit test signal normalization and dedupe', 'Test empty/invalid source responses', 'Test scoring caps and low-confidence fallback', 'Test at least 3 realistic scenarios', 'Demo test with source links and exported report'];
}
function buildDemoScript(title) {
  return [`Open ${title}`, 'Load a real/sample problem signal set', 'Show extracted pain points and evidence links', 'Generate recommendation/blueprint', 'Show cost/team/IP-readiness estimate', 'Export report or convert to project workspace'];
}
function buildEvidenceChecklist() {
  return ['Source links used', 'Before/after workflow comparison', 'Architecture diagram', 'Core algorithm notes', 'Test results/screenshots', 'GitHub commits', 'Demo video/live link', 'Prior-art notes before patent review'];
}

export function estimateFeasibilityAndCost(project = {}, input = {}) {
  const hardware = /iot|sensor|edge|robot|farm|agri|health/i.test(`${project.title} ${project.painPoint} ${input.technology || ''}`);
  const aiHeavy = /ai|ml|llm|model|prediction|classification/i.test(`${project.title} ${input.technology || ''}`);
  const difficulty = hardware ? 'advanced' : aiHeavy ? 'intermediate-advanced' : 'intermediate';
  const costBand = hardware ? '₹10,000–₹50,000' : aiHeavy ? '₹2,000–₹10,000' : '₹0–₹5,000';
  return {
    difficulty,
    teamSize: hardware ? '3–4 people' : '2–3 people',
    rolesRequired: hardware ? ['Frontend/backend developer', 'Embedded/IoT developer', 'Domain tester', 'Documentation/IP lead'] : ['Full-stack developer', 'Domain/problem researcher', 'AI/data integration contributor'],
    mustHaveSkills: project.requiredSkills || [],
    goodToHaveSkills: ['Docker', 'Cloud deployment', 'System design documentation', 'Basic IP/prior-art research'],
    resourcesRequired: hardware ? ['Laptop', 'GitHub', 'Cloud backend', 'ESP32/Arduino or sensors', 'Testing environment'] : ['Laptop', 'GitHub', 'MongoDB Atlas/free DB', 'Vercel/Render/Railway', 'Optional AI API key', 'Sample data'],
    indiaMvpCostBand: costBand,
    monthlyRunCost: aiHeavy ? '₹500–₹3,000 during MVP testing if AI APIs are used' : '₹0–₹1,000 using free tiers',
    timeline: hardware ? '5–8 weeks for a credible MVP' : '3–5 weeks for a credible MVP',
    executionRisks: ['Problem scope may become too broad', 'Realistic data may be hard to collect', 'Generic AI output can weaken credibility', 'Patent angle needs prior-art review before claims'],
    mvpVersion: 'Narrow, source-backed workflow with 3–5 demo scenarios and a clear report.',
    advancedVersion: 'Production integrations, richer scoring, benchmarking, collaboration, and IP-cell review workflow.',
    verdict: `Build this if the team can demonstrate a real problem with evidence and keep the MVP narrow. Portfolio value is high; patent route requires prototype + prior-art review.`,
  };
}

export function assessIPReadiness(project = {}, cluster = {}, input = {}, { priorArtRecords = [], prototypeEvidence = [] } = {}) {
  const text = lc(`${project.title} ${project.proposedSolution} ${project.noveltyAngle} ${project.technicalChallenge}`);
  const section3kRisk = SECTION3K_TERMS.some((x) => text.includes(x)) || (/software|ai|llm|algorithm/.test(text) && !/sensor|edge|latency|security|protocol|resource|deployment|infrastructure/.test(text)) ? 'Medium' : 'Low';
  const technicalContribution = clamp(45 + (text.includes('correlat') ? 12 : 0) + (text.includes('measurable') ? 10 : 0) + (text.includes('signal') ? 10 : 0));
  const noveltyPotential = clamp(35 + Number(cluster.patentPotentialScore || 35) * 0.45 + (cluster.sourceBacked ? 10 : 0));
  const priorArtConfidence = priorArtRecords.length ? clamp(35 + priorArtRecords.length * 12) : 10;
  const prototypeEvidenceScore = prototypeEvidence.length ? clamp(35 + prototypeEvidence.length * 15) : 15;
  let overall = round((technicalContribution * 0.25) + (noveltyPotential * 0.2) + (Number(cluster.evidenceStrengthScore || 30) * 0.15) + (priorArtConfidence * 0.15) + (prototypeEvidenceScore * 0.15) + 10);
  const caps = [];
  if (!cluster.sourceBacked) { overall = Math.min(overall, 55); caps.push('No external source evidence: capped at 55.'); }
  if (!priorArtRecords.length) { overall = Math.min(overall, 65); caps.push('No prior-art records: capped at 65.'); }
  if (!prototypeEvidence.length) { overall = Math.min(overall, 75); caps.push('No prototype evidence: capped at 75.'); }
  if (section3kRisk !== 'Low') { overall = Math.min(overall, 65); caps.push('Software/algorithm-heavy idea: India Section 3(k) review required.'); }
  return {
    overall,
    label: overall >= 75 ? 'High priority for IP review' : overall >= 60 ? 'Worth structured review' : overall >= 45 ? 'Needs technical strengthening' : 'Low patent-readiness',
    recommendedIPRoute: overall >= 65 ? 'patent-review' : cluster.recommendedRoute === 'research' ? 'research paper' : 'portfolio/project proof first',
    section3kRisk,
    technicalContribution,
    noveltyPotential,
    priorArtConfidence,
    prototypeEvidenceScore,
    externalPriorArtRisk: priorArtRecords.length ? 'Needs review' : 'Unknown',
    capsApplied: caps,
    requiredEvidence: ['Prototype/demo evidence', 'Prior-art records', 'Measurable technical benchmark', 'Architecture/workflow diagram', 'Clear differentiator vs existing tools'],
    disclaimer: 'Not legal advice. This is an internal IP-review priority score only.',
  };
}

export function generateDisclosureOutline(project = {}) {
  return {
    title: project.title,
    technicalField: project.requiredSkills?.slice(0, 4).join(', ') || 'Applied software/engineering system',
    background: project.painPoint,
    problem: project.painPoint,
    existingLimitations: project.whyExistingSolutionsFail,
    proposedInvention: project.proposedSolution,
    novelTechnicalContribution: project.noveltyAngle,
    systemComponents: project.technicalArchitecture,
    advantages: ['Source-backed problem framing', 'Measurable workflow improvement', 'Demo-ready implementation plan'],
    drawingsChecklist: ['System architecture', 'Data flow', 'Core scoring/decision workflow', 'User dashboard screenshot'],
    publicDisclosureWarning: 'Do not publicly disclose unpublished invention details before faculty/IP-cell/patent-agent review if filing is planned.',
  };
}

export async function discover(input = {}) {
  const fetched = await fetchSignals(input);
  const extracted = extractPainPoints(fetched.signals, input);
  let clusters = clusterProblems(extracted, input);
  const ai = await enrichClustersWithAI(clusters, input);
  clusters = ai.clusters;
  return {
    ok: true,
    mode: clusters.some((c) => c.sourceBacked) ? 'source-backed' : 'fallback-draft',
    aiProvider: ai.provider,
    signals: extracted,
    signalsCount: extracted.length,
    skippedDuplicates: fetched.skippedDuplicates,
    clusters,
    warnings: fetched.warnings,
    version: PI_VERSION,
  };
}
