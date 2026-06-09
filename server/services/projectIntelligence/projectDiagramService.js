/* ============================================================
   Task 4 — Project-specific Mermaid architecture diagrams
   ------------------------------------------------------------
   Generates SIX project-specific diagrams (not generic
   User→Frontend→API→DB) from the project's modules, tech stack,
   APIs, database, integrations, workflow and proof artifacts.
   Output is Mermaid TEXT compatible with the in-repo renderer
   (components/common/MermaidDiagram.jsx → graph + sequenceDiagram).
   Deterministic; AI never required.
   ============================================================ */
import { asList, uniq, slugId, mermaidLabel, lc } from './util.js';

/* Derive the building blocks the diagrams need from any project shape. */
export function deriveProjectModel({ project = {}, recommendation = {}, explainer = {} } = {}) {
  const title = recommendation.title || project.title || 'Project';
  const text = lc(`${title} ${recommendation.problemStatement || project.problemStatement || ''} ${(asList(recommendation.skills).concat(asList(project.skillsCovered))).join(' ')}`);
  const isAnalyzer = /analy|detect|diagnos|root.?cause|scan/.test(text);
  const isPipeline = /pipeline|etl|elt|stream|warehouse|lakehouse|kafka/.test(text);

  const modules = (explainer.mvpModules && explainer.mvpModules.length)
    ? explainer.mvpModules
    : isAnalyzer ? ['Upload UI', 'Parser API', 'Root Cause Engine', 'Recommendation Service', 'Dashboard', 'Export Report']
      : isPipeline ? ['Source Connector', 'Transform Layer', 'Quality Checks', 'Scheduler', 'Warehouse Load', 'Metrics Dashboard']
        : ['Web App', 'API Gateway', 'Core Service', 'Persistence', 'Dashboard'];

  const techStack = uniq(asList(project.techStack).concat(asList(recommendation.skills)));
  const db = techStack.find((t) => /postgres|mongo|mysql|snowflake|redis|sqlite|dynamo/i.test(t)) || (isPipeline ? 'Warehouse' : 'PostgreSQL');
  const integrations = uniq(asList(project.integrations).concat(
    /kafka/.test(text) ? ['Kafka'] : [],
    /llm|openai|gpt|rag/.test(text) ? ['LLM API'] : [],
    /github/.test(text) ? ['GitHub API'] : [],
  ));
  const apis = (explainer && explainer.apis) || deriveApis(modules, isAnalyzer, isPipeline);
  const proofArtifacts = uniq(asList(recommendation.evidenceNeeded).concat(asList(project.expectedProofArtifacts)));

  return { title, modules, techStack, db, integrations, apis, proofArtifacts, isAnalyzer, isPipeline };
}

function deriveApis(modules, isAnalyzer, isPipeline) {
  if (isAnalyzer) return ['POST /api/upload', 'POST /api/analyze', 'GET /api/results/:id', 'GET /api/report/:id'];
  if (isPipeline) return ['POST /api/jobs/run', 'GET /api/jobs/:id/status', 'GET /api/metrics'];
  return ['POST /api/auth/login', 'GET /api/items', 'POST /api/items', 'GET /api/dashboard'];
}

const node = (label) => `${slugId(label)}[${mermaidLabel(label)}]`;

/* 1) System architecture — modules wired front-to-back with stores + integrations. */
function systemArchitecture(m) {
  const lines = ['graph TD'];
  const ids = m.modules.map((x) => slugId(x));
  lines.push(`${node('User')} --> ${node(m.modules[0])}`);
  for (let i = 0; i < m.modules.length - 1; i++) lines.push(`${node(m.modules[i])} --> ${node(m.modules[i + 1])}`);
  // persistence + integrations hang off the core (middle) module
  const core = m.modules[Math.min(2, m.modules.length - 1)];
  lines.push(`${node(core)} --> ${node(m.db)}`);
  m.integrations.forEach((intg) => lines.push(`${node(core)} --> ${node(intg)}`));
  void ids;
  return lines.join('\n');
}

/* 2) Data flow — left-to-right movement of the actual payload. */
function dataFlow(m) {
  const lines = ['graph LR'];
  const flow = m.isAnalyzer
    ? ['Raw Input', 'Parsed Records', 'Analysis Result', 'Recommendations', 'Report']
    : m.isPipeline
      ? ['Source Data', 'Cleaned Data', 'Validated Data', m.db, 'Metrics']
      : ['User Input', 'Validated Payload', 'Domain Model', m.db, 'View Model'];
  for (let i = 0; i < flow.length - 1; i++) lines.push(`${node(flow[i])} --> ${node(flow[i + 1])}`);
  return lines.join('\n');
}

/* 3) API flow — sequence diagram across the real endpoints. */
function apiFlow(m) {
  const lines = ['sequenceDiagram'];
  lines.push('participant U as User');
  lines.push('participant F as Frontend');
  lines.push('participant A as API');
  lines.push('participant S as Core Service');
  lines.push('participant D as ' + mermaidLabel(m.db, 16));
  const ep = m.apis;
  lines.push(`U->>F: Open ${mermaidLabel(m.title, 18)}`);
  lines.push(`F->>A: ${mermaidLabel(ep[0] || 'request', 22)}`);
  lines.push('A->>S: validate + route');
  lines.push('S->>D: read/write');
  lines.push('D->>S: result');
  lines.push(`A->>F: ${mermaidLabel(ep[2] || ep[1] || 'response', 22)}`);
  lines.push('F->>U: render result');
  return lines.join('\n');
}

/* 4) Database / entity relationships — rendered as a flowchart of entities. */
function databaseDiagram(m) {
  const lines = ['graph TD'];
  const entities = m.isAnalyzer ? ['users', 'uploads', 'analyses', 'recommendations']
    : m.isPipeline ? ['jobs', 'runs', 'quality_checks', 'metrics']
      : ['users', 'workspaces', 'items', 'events'];
  lines.push(`${node(entities[0])} --> ${node(entities[1])}`);
  lines.push(`${node(entities[1])} --> ${node(entities[2])}`);
  lines.push(`${node(entities[2])} --> ${node(entities[3])}`);
  lines.push(`${node(entities[0])} --> ${node(entities[2])}`);
  return lines.join('\n');
}

/* 5) Deployment — where each piece runs in production. */
function deploymentDiagram(m) {
  const lines = ['graph TD'];
  lines.push(`${node('Browser')} --> ${node('CDN / Static Host')}`);
  lines.push(`${node('CDN / Static Host')} --> ${node('Frontend Build')}`);
  lines.push(`${node('Frontend Build')} --> ${node('API Container')}`);
  lines.push(`${node('API Container')} --> ${node('Managed ' + m.db)}`);
  lines.push(`${node('GitHub Actions CI')} --> ${node('API Container')}`);
  lines.push(`${node('GitHub Actions CI')} --> ${node('Frontend Build')}`);
  m.integrations.forEach((intg) => lines.push(`${node('API Container')} --> ${node(intg)}`));
  return lines.join('\n');
}

/* 6) User journey — the happy path the demo will show. */
function userJourney(m) {
  const lines = ['graph LR'];
  const steps = m.isAnalyzer ? ['Land', 'Upload Input', 'See Root Cause', 'Apply Fix', 'Export Report']
    : m.isPipeline ? ['Open Dashboard', 'Trigger Job', 'Watch Run', 'See Quality Pass', 'View Metrics']
      : ['Sign Up', 'Set Up Workspace', 'Do Core Task', 'See Result', 'Return + Review'];
  for (let i = 0; i < steps.length - 1; i++) lines.push(`${node(steps[i])} --> ${node(steps[i + 1])}`);
  return lines.join('\n');
}

export function generateDiagrams(args = {}) {
  const m = deriveProjectModel(args);
  return {
    model: m,
    diagrams: [
      { id: 'system', title: 'System Architecture', type: 'flowchart', mermaid: systemArchitecture(m) },
      { id: 'dataflow', title: 'Data Flow', type: 'flowchart', mermaid: dataFlow(m) },
      { id: 'apiflow', title: 'API Flow', type: 'sequence', mermaid: apiFlow(m) },
      { id: 'database', title: 'Database / Entities', type: 'flowchart', mermaid: databaseDiagram(m) },
      { id: 'deployment', title: 'Deployment', type: 'flowchart', mermaid: deploymentDiagram(m) },
      { id: 'journey', title: 'User Journey', type: 'flowchart', mermaid: userJourney(m) },
    ],
  };
}
