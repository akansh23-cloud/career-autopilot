// ideaEngine.js — Career Autopilot's OWN project-idea generator.
//
// This is a deterministic, knowledge-base-driven engine — NOT an AI prompt.
// It composes concrete, varied, personalized project ideas from a curated
// graph of (domain x solution-capability x novelty-angle), ranks them against
// the user's real context, and attaches the technical-novelty signals the
// patent engine uses. It always works offline; the AI layer (if configured)
// only *augments* this output, never replaces it.
//
// Output shape is compatible with lib/projectCreator.discover()/RecCard.

/* ----------------------------- seeded RNG ----------------------------- */
function xfnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const norm = (s) => String(s || '').toLowerCase().trim();
const uniq = (arr) => Array.from(new Set((arr || []).map((s) => String(s).trim()).filter(Boolean)));

/* --------------------------- knowledge base --------------------------- */
// Domains: real problem spaces with concrete audiences, pains and patent hints.
const DOMAINS = [
  { id: 'edtech', name: 'Education', audience: 'coaching centres & colleges', noun: 'learning', pain: 'engagement and drop-off are tracked manually with no early-warning signal', hot: 72, cpc: 'G09B (educational/teaching)', kw: ['student', 'learning', 'engagement', 'attendance'] },
  { id: 'health', name: 'Healthcare', audience: 'small clinics & diagnostic labs', noun: 'patient care', pain: 'follow-ups, adherence and triage rely on memory and paper', hot: 80, cpc: 'G16H (healthcare informatics)', kw: ['patient', 'clinic', 'adherence', 'triage'] },
  { id: 'fintech', name: 'Finance', audience: 'freelancers & small businesses', noun: 'money flow', pain: 'cash-flow, invoices and reconciliation are spread across spreadsheets', hot: 78, cpc: 'G06Q 40 (finance)', kw: ['invoice', 'cashflow', 'reconciliation', 'expense'] },
  { id: 'logistics', name: 'Logistics', audience: 'local stores & delivery fleets', noun: 'delivery', pain: 'routes and dispatch are planned by hand, wasting time and fuel', hot: 74, cpc: 'G06Q 10 (logistics)', kw: ['route', 'dispatch', 'fleet', 'delivery'] },
  { id: 'devtools', name: 'Developer Tools', audience: 'engineering teams', noun: 'the dev workflow', pain: 'config errors, secret leaks and flaky pipelines slip through review', hot: 70, cpc: 'G06F 8 (software engineering)', kw: ['ci', 'config', 'secrets', 'pipeline'] },
  { id: 'climate', name: 'Climate & Energy', audience: 'households & facilities', noun: 'energy use', pain: 'consumption and emissions are invisible until the bill arrives', hot: 68, cpc: 'G06Q 50 (resources)', kw: ['energy', 'emissions', 'consumption', 'sustainability'] },
  { id: 'commerce', name: 'Commerce', audience: 'D2C brands & sellers', noun: 'selling online', pain: 'pricing, inventory and demand are guessed rather than measured', hot: 66, cpc: 'G06Q 30 (commerce)', kw: ['pricing', 'inventory', 'demand', 'catalog'] },
  { id: 'productivity', name: 'Productivity', audience: 'distributed teams', noun: 'team work', pain: 'context is scattered across tools and lost between meetings', hot: 64, cpc: 'G06Q 10 (admin)', kw: ['notes', 'tasks', 'meetings', 'knowledge'] },
  { id: 'civic', name: 'Civic & Public', audience: 'citizens & local bodies', noun: 'public services', pain: 'issues are reported through opaque channels with no visibility', hot: 58, cpc: 'G06Q 50 (society)', kw: ['civic', 'report', 'transit', 'public'] },
  { id: 'security', name: 'Security', audience: 'small IT teams', noun: 'app security', pain: 'vulnerabilities are found late and remediation is untracked', hot: 76, cpc: 'G06F 21 (security)', kw: ['security', 'vulnerability', 'owasp', 'audit'] },
  { id: 'agri', name: 'Agriculture', audience: 'farmers & FPOs', noun: 'crop decisions', pain: 'irrigation, pest and market timing are guesswork', hot: 60, cpc: 'A01 / G06Q 50', kw: ['crop', 'irrigation', 'yield', 'mandi'] },
  { id: 'media', name: 'Media & Creators', audience: 'independent creators', noun: 'content ops', pain: 'repurposing, scheduling and analytics are manual and time-consuming', hot: 62, cpc: 'G06Q 30 / H04N', kw: ['content', 'schedule', 'analytics', 'creator'] },
];

// Capabilities: solution archetypes. technicalCharacter (0-100) feeds patentability.
const CAPS = [
  {
    id: 'optimizer', name: 'optimization engine', engineType: 'Backend', productType: 'SaaS MVP',
    skills: ['Algorithms', 'Node.js', 'Optimization', 'APIs'], diff: 3, proof: 84, startup: 76, tech: 88,
    verb: (d) => `${d.noun} optimization engine`,
    mech: (d) => `a constraint-based solver that turns ${d.noun} data into an optimal schedule/plan under real-world limits`,
    effect: 'a measurable reduction in cost/time via an automated optimization algorithm — a concrete technical effect',
    outputs: ['Live demo', 'Benchmark vs baseline', 'GitHub repo', 'Architecture diagram'],
  },
  {
    id: 'predictor', name: 'predictive model service', engineType: 'AI/ML', productType: 'Portfolio Project',
    skills: ['Python', 'scikit-learn / PyTorch', 'FastAPI', 'Feature engineering', 'MLflow'], diff: 3, proof: 86, startup: 68, tech: 90,
    verb: (d) => `${d.name} risk/score predictor`,
    mech: (d) => `a trained model that scores ${d.noun} outcomes and serves explainable predictions behind an API`,
    effect: 'an inference pipeline that transforms raw signals into a calibrated, explainable prediction',
    outputs: ['Model card + metrics', 'Inference API', 'Demo UI', 'GitHub repo'],
  },
  {
    id: 'realtime', name: 'real-time monitoring system', engineType: 'Full Stack', productType: 'SaaS MVP',
    skills: ['WebSockets', 'Streaming', 'Time-series DB', 'React', 'Alerting'], diff: 3, proof: 82, startup: 70, tech: 84,
    verb: (d) => `real-time ${d.noun} monitoring & alerting`,
    mech: (d) => `a streaming pipeline that ingests ${d.noun} events and raises threshold/anomaly alerts within seconds`,
    effect: 'sub-second detection via an event-stream processing architecture with anomaly thresholds',
    outputs: ['Live dashboard', 'Alert demo', 'Load test', 'GitHub repo'],
  },
  {
    id: 'vision', name: 'computer-vision pipeline', engineType: 'AI/ML', productType: 'Portfolio Project',
    skills: ['Computer Vision', 'OpenCV / PyTorch', 'Python', 'Edge inference'], diff: 3, proof: 85, startup: 66, tech: 92,
    verb: (d) => `vision-based ${d.noun} analyzer`,
    mech: (d) => `an image/video pipeline that detects and classifies ${d.noun} conditions on-device`,
    effect: 'automated detection from raw imagery — image-processing with a tangible technical output',
    outputs: ['Annotated demo', 'Accuracy report', 'Edge build', 'GitHub repo'],
  },
  {
    id: 'recommender', name: 'recommendation engine', engineType: 'AI/ML', productType: 'SaaS MVP',
    skills: ['Recommenders', 'Python', 'Vector search', 'APIs'], diff: 2, proof: 80, startup: 72, tech: 82,
    verb: (d) => `${d.noun} recommendation engine`,
    mech: (d) => `a ranking model that personalizes ${d.noun} suggestions from behaviour + content signals`,
    effect: 'a ranking algorithm that improves relevance measurably over a popularity baseline',
    outputs: ['A/B vs baseline', 'Live demo', 'GitHub repo'],
  },
  {
    id: 'pipeline', name: 'data pipeline + quality dashboard', engineType: 'Data', productType: 'Career Project',
    skills: ['Python', 'Airflow', 'dbt', 'Postgres', 'Great Expectations'], diff: 3, proof: 83, startup: 44, tech: 70,
    verb: (d) => `${d.name} ELT pipeline with quality checks`,
    mech: (d) => `an orchestrated ELT pipeline that ingests, transforms and validates ${d.noun} data with automated quality gates`,
    effect: 'an automated data-quality gating mechanism in the pipeline',
    outputs: ['DAG demo', 'Data-quality dashboard', 'GitHub repo'],
  },
  {
    id: 'automation', name: 'workflow automation', engineType: 'Full Stack', productType: 'SaaS MVP',
    skills: ['Node.js', 'Queues', 'Integrations', 'React', 'Webhooks'], diff: 2, proof: 78, startup: 74, tech: 64,
    verb: (d) => `${d.noun} automation platform`,
    mech: (d) => `an event-driven workflow engine that automates repetitive ${d.noun} steps across tools`,
    effect: 'a rules/event engine that removes manual steps — modest technical character; lean on the inventive angle',
    outputs: ['Live demo', 'Integration walkthrough', 'GitHub repo'],
  },
  {
    id: 'analytics', name: 'analytics dashboard', engineType: 'Full Stack', productType: 'Portfolio Project',
    skills: ['React', 'Node.js', 'Postgres', 'Charts', 'Auth'], diff: 2, proof: 74, startup: 58, tech: 40,
    verb: (d) => `${d.name} analytics dashboard`,
    mech: (d) => `a multi-tenant dashboard that aggregates ${d.noun} metrics into decisions`,
    effect: 'mainly a presentation of information — weak on its own for patents; pair with a technical angle',
    outputs: ['Live dashboard', 'GitHub repo', 'README'],
  },
  {
    id: 'cli', name: 'developer CLI / scanner', engineType: 'Backend', productType: 'Open Source Tool',
    skills: ['Node.js / Python', 'CLI', 'Static analysis', 'Packaging', 'Testing'], diff: 1, proof: 72, startup: 34, tech: 66,
    verb: (d) => `${d.noun} static analyzer / scanner CLI`,
    mech: (d) => `a static-analysis tool that parses ${d.noun} artifacts and flags issues pre-commit`,
    effect: 'an analysis algorithm over source/config — has technical character if the detection method is non-trivial',
    outputs: ['npm/PyPI package', 'CI integration', 'GitHub repo'],
  },
  {
    id: 'marketplace', name: 'two-sided marketplace', engineType: 'Full Stack', productType: 'Startup Experiment',
    skills: ['Auth', 'Payments', 'Search', 'React', 'Postgres'], diff: 2, proof: 76, startup: 80, tech: 36,
    verb: (d) => `${d.name} matching marketplace`,
    mech: (d) => `a matching marketplace connecting two sides of the ${d.noun} problem`,
    effect: 'largely a business method — patent-weak unless the matching algorithm itself is novel',
    outputs: ['Live demo', 'GitHub repo', 'Demo accounts'],
  },
];

// Novelty angles: technical modifiers that add inventive step / technical character.
const ANGLES = [
  { id: 'ondevice', label: 'fully on-device / offline-first', effect: 'runs inference locally with no server round-trip (privacy + latency advantage)', boost: 18, skills: ['Edge inference', 'Offline-first'] },
  { id: 'privacy', label: 'privacy-preserving', effect: 'processes data without exposing raw PII (e.g. on-device or anonymized features)', boost: 16, skills: ['Privacy engineering'] },
  { id: 'federated', label: 'federated / collaborative learning', effect: 'improves a shared model without centralizing user data', boost: 22, skills: ['Federated learning'] },
  { id: 'explainable', label: 'explainable decisions', effect: 'surfaces the reasons behind each automated decision', boost: 12, skills: ['Explainability'] },
  { id: 'lowbandwidth', label: 'low-bandwidth / SMS-first', effect: 'works over SMS/USSD for low-connectivity users', boost: 14, skills: ['SMS/USSD', 'Sync'] },
  { id: 'realtimeangle', label: 'real-time adaptive', effect: 'continuously re-optimizes as new events arrive', boost: 14, skills: ['Streaming'] },
  { id: 'multimodal', label: 'multimodal (text + image + signal)', effect: 'fuses multiple input types into one decision', boost: 16, skills: ['Multimodal ML'] },
];

const CREATOR_TYPE_SET = ['Career Project', 'Portfolio Project', 'Startup Experiment', 'SaaS MVP', 'Hackathon Project', 'Open Source Tool'];
function diffFromN(n) { return n <= 1 ? 'Beginner' : n === 2 ? 'Intermediate' : 'Advanced'; }
function durationFor(diff) { return diff === 'Beginner' ? '1 week' : diff === 'Intermediate' ? '2 weeks' : '1 month'; }
const titleCase = (s = '') => s.replace(/\b\w/g, (c) => c.toUpperCase());

function skillOverlap(capSkills, ctxSkills) {
  const c = (ctxSkills || []).map(norm);
  return (capSkills || []).filter((s) => c.some((x) => x.includes(norm(s)) || norm(s).includes(x))).length;
}

/* -------------------- the generator -------------------- */
export function generateIdeas(ctx = {}, opts = {}) {
  const count = opts.count || 9;
  const salt = opts.salt != null ? String(opts.salt) : '0';
  const ctxSkills = uniq([...(ctx.missingSkills || []), ...(ctx.currentSkills || [])]);
  const wantType = norm(ctx.preferredType);
  const level = norm(ctx.difficulty) || 'intermediate';
  const levelN = level.includes('begin') ? 1 : level.includes('adv') ? 3 : 2;
  const seedStr = [ctx.role, ctx.targetRole, level, ctx.duration, wantType, (ctx.missingSkills || []).join(','), salt].join('|');
  const rand = mulberry32(xfnv1a(seedStr));

  // score + order capabilities by skill fit, type preference, with deterministic jitter
  const capScore = (c) => {
    let s = skillOverlap(c.skills, ctxSkills) * 10;
    if (wantType && (norm(c.productType).includes(wantType) || norm(c.engineType).includes(wantType))) s += 14;
    s += (c.proof + c.startup) / 20;
    return s + rand() * 12;
  };
  const caps = [...CAPS].sort((a, b) => capScore(b) - capScore(a));

  // score + order domains by hotness + context hints
  const hintHay = norm([ctx.targetRole, ctx.branch, ctx.role, (ctx.missingSkills || []).join(' ')].join(' '));
  const domScore = (d) => d.hot / 10 + (d.kw.some((k) => hintHay.includes(k)) ? 8 : 0) + rand() * 10;
  const domains = [...DOMAINS].sort((a, b) => domScore(b) - domScore(a));

  const ideas = [];
  const seenTitles = new Set();
  let di = 0;
  for (let i = 0; i < caps.length && ideas.length < count; i += 1) {
    const cap = caps[i % caps.length];
    // pair each capability with a fresh domain to maximise variety
    const dom = domains[di % domains.length]; di += 1;

    // attach an angle probabilistically — more likely for advanced users / high-tech caps
    const wantAngle = rand() < (0.35 + (levelN - 1) * 0.18 + (cap.tech > 75 ? 0.15 : 0));
    const angle = wantAngle ? ANGLES[Math.floor(rand() * ANGLES.length)] : null;

    const title = titleCase(cap.verb(dom)) + (angle ? ` (${angle.label})` : '');
    if (seenTitles.has(title)) { continue; }
    seenTitles.add(title);

    let dN = cap.diff + (angle ? 1 : 0);
    dN = Math.max(1, Math.min(3, dN));
    if (levelN === 1) dN = Math.min(dN, 2); // keep beginners from advanced-only ideas
    const difficulty = diffFromN(dN);

    const skillsCovered = uniq([...cap.skills, ...(angle ? angle.skills : []), ...(ctx.missingSkills || []).slice(0, 3)]).slice(0, 9);
    const missingSkillsCovered = uniq((ctx.missingSkills || []).filter((m) => skillsCovered.some((s) => norm(s).includes(norm(m)) || norm(m).includes(norm(s)))));

    const technicalCharacter = Math.max(0, Math.min(100, Math.round(cap.tech + (angle ? angle.boost : 0) - 4 + rand() * 8)));
    const startupPotential = Math.max(0, Math.min(100, Math.round((cap.startup + dom.hot) / 2 + (angle ? 6 : 0))));
    const proofPotential = Math.max(0, Math.min(100, Math.round(cap.proof + (angle ? 4 : 0))));

    const mechanism = cap.mech(dom);
    const summary = `For ${dom.audience}, where ${dom.pain}. This project builds ${mechanism}${angle ? `, and is ${angle.label} — ${angle.effect}` : ''}.`;

    ideas.push({
      id: `idea_${cap.id}_${dom.id}_${salt}_${i}`,
      title,
      type: CREATOR_TYPE_SET.includes(cap.productType) ? cap.productType : 'Portfolio Project',
      engineType: cap.engineType,
      category: 'Best Portfolio Impact', // re-bucketed by the orchestrator below
      summary,
      problem: dom.pain,
      domain: dom.name,
      targetUsers: dom.audience,
      targetRoleFit: ctx.targetRole || 'Software Engineer',
      difficulty,
      estimatedDuration: durationFor(difficulty),
      weeklyTime: ctx.weeklyTime || '6–10 hrs',
      skills: skillsCovered,
      skillsCovered,
      missingSkillsCovered,
      stillMissingSkills: uniq((ctx.missingSkills || []).filter((m) => !missingSkillsCovered.includes(m))),
      startupPotential,
      proofPotential,
      whyRecommended: `Covers ${missingSkillsCovered.slice(0, 3).join(', ') || skillsCovered.slice(0, 3).join(', ')} with a deployable, recruiter-visible build in a hot domain (${dom.name}).`,
      sourceSignals: ['Career Autopilot idea engine', `${dom.name} domain`, `${cap.name} archetype`].concat(angle ? [angle.label] : []),
      expectedProofOutputs: cap.outputs,
      resumeImpactPreview: `Built ${title} — ${mechanism}.`,
      recruiterImpactPreview: `Demonstrates a real, deployed ${cap.name} in ${dom.name}.`,
      // technical-novelty signals consumed by the patent engine
      novelty: {
        capabilityId: cap.id,
        technicalMechanism: titleCase(mechanism.charAt(0)) + mechanism.slice(1),
        technicalEffect: angle ? angle.effect : cap.effect,
        inventiveAngle: angle ? angle.label : null,
        technicalCharacter,
        cpcHint: dom.cpc,
        priorArtKeywords: uniq([...dom.kw, cap.id, ...(angle ? [angle.id] : [])]),
      },
    });
  }

  return ideas.slice(0, count);
}

/* Re-bucket a scored list of recs into the UI's CATEGORY_ORDER, one primary
   bucket each, guaranteeing variety. `recs` must already carry rec.fit.score. */
export function bucketIdeas(recs = []) {
  const list = recs.map((r) => ({ ...r }));
  const taken = new Set();
  const assign = (cat, picker) => {
    const pool = list.filter((r) => !taken.has(r.id));
    if (!pool.length) return;
    const best = pool.slice().sort(picker)[0];
    if (best) { best.category = cat; taken.add(best.id); }
  };
  assign('Best Career Fit', (a, b) => (b.fit?.score || 0) - (a.fit?.score || 0));
  assign('Best Quick Win', (a, b) => (durRank(a) - durRank(b)) || ((b.fit?.score || 0) - (a.fit?.score || 0)));
  assign('Best Portfolio Impact', (a, b) => (b.proofPotential || 0) - (a.proofPotential || 0));
  assign('Best Startup Potential', (a, b) => (b.startupPotential || 0) - (a.startupPotential || 0));
  assign('Best Beginner-Friendly', (a, b) => (begRank(a) - begRank(b)) || ((b.fit?.score || 0) - (a.fit?.score || 0)));
  // leftovers keep a marketplace-style category so they show under "More ideas"
  list.forEach((r) => { if (!taken.has(r.id)) r.category = r.domain ? `${r.domain} Ideas` : 'More Ideas'; });
  return list;
}
function durRank(r) { const d = norm(r.estimatedDuration); return d.includes('weekend') ? 0 : d.includes('1 week') ? 1 : d.includes('2 week') ? 2 : 3; }
function begRank(r) { const d = norm(r.difficulty); return d.includes('begin') ? 0 : d.includes('inter') ? 1 : 2; }
