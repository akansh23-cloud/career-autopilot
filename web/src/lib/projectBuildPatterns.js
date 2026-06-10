// Project OS — Builder Mode pattern library.
//
// A reusable, extensible catalogue of project "shapes". Each pattern declares
// the keywords that identify it plus the concrete components, APIs, entities,
// stages and proof items a real MVP of that shape needs. The Build Guide
// generator detects the best-matching pattern from the project context and
// turns the suggestions into specific, action-oriented tasks — so even a
// project with no explicit architecture still gets project-specific guidance.
//
// PURE module: no window/DOM/network/AI. Safe in React, the server, and node.

const lc = (s) => String(s == null ? '' : s).toLowerCase();

/* Each pattern:
   { id, label, matchKeywords[], suggestedComponents[],
     suggestedApis[{method,path,purpose}], suggestedEntities[{entity,fields[]}],
     suggestedStages[], commonProofItems[] } */
export const PROJECT_BUILD_PATTERNS = [
  {
    id: 'kubernetes_analyzer',
    label: 'Kubernetes Failure Analyzer',
    matchKeywords: ['kubernetes', 'k8s', 'pod', 'crashloopbackoff', 'imagepullbackoff', 'kubectl', 'cluster', 'deployment log', 'pod event', 'probe failure', 'helm'],
    suggestedComponents: ['Log Upload UI', 'Log Parser Service', 'Kubernetes Failure Detector', 'Root Cause Analyzer', 'Recommendation Engine', 'Findings Dashboard', 'Report Export'],
    suggestedApis: [
      { method: 'POST', path: '/api/logs/upload', purpose: 'Upload deployment / pod logs (.txt or .log) and return an uploadId' },
      { method: 'POST', path: '/api/deployments/analyze', purpose: 'Analyze an uploaded log and return ranked root-cause findings' },
      { method: 'GET', path: '/api/findings/:uploadId', purpose: 'List the findings produced for an upload' },
    ],
    suggestedEntities: [
      { entity: 'UploadedLog', fields: ['projectId', 'fileName', 'rawContent', 'createdAt'] },
      { entity: 'Finding', fields: ['uploadId', 'pattern', 'severity', 'rootCause', 'recommendation', 'createdAt'] },
    ],
    suggestedStages: ['Log ingestion', 'Failure detection', 'Root-cause analysis', 'Findings & reporting'],
    commonProofItems: ['Sample Kubernetes logs parsed end-to-end', 'CrashLoopBackOff / ImagePullBackOff / probe failures detected', 'Ranked root-cause findings with fix recommendations'],
  },
  {
    id: 'devops_monitoring',
    label: 'DevOps Monitoring',
    matchKeywords: ['devops', 'ci/cd', 'cicd', 'pipeline', 'monitoring', 'observability', 'prometheus', 'grafana', 'logs', 'alerting', 'incident', 'sre', 'metrics', 'uptime'],
    suggestedComponents: ['Metrics Ingestion Service', 'Alert Rule Engine', 'Incident Timeline UI', 'Monitoring Dashboard', 'Notification Service'],
    suggestedApis: [
      { method: 'POST', path: '/api/metrics/ingest', purpose: 'Ingest a metrics/log payload' },
      { method: 'GET', path: '/api/alerts', purpose: 'List active alerts' },
      { method: 'POST', path: '/api/alerts/rules', purpose: 'Create an alert rule' },
    ],
    suggestedEntities: [
      { entity: 'MetricSample', fields: ['service', 'name', 'value', 'timestamp'] },
      { entity: 'Alert', fields: ['ruleId', 'service', 'severity', 'status', 'firedAt'] },
    ],
    suggestedStages: ['Metrics ingestion', 'Alerting', 'Dashboards'],
    commonProofItems: ['Live metrics dashboard', 'An alert firing on a threshold breach', 'CI pipeline running on each push'],
  },
  {
    id: 'resume_ats',
    label: 'Resume / ATS Analyzer',
    matchKeywords: ['resume', 'ats', 'applicant tracking', 'job match', 'recruiter', 'cv', 'keyword gap', 'job description', 'cover letter'],
    suggestedComponents: ['Resume Upload UI', 'Resume Parser Service', 'ATS Scoring Service', 'Keyword Gap Analyzer', 'Job Description Matcher', 'Recommendation Panel', 'Resume Improvement Export'],
    suggestedApis: [
      { method: 'POST', path: '/api/resume/upload', purpose: 'Upload a resume (PDF/DOCX) and return a parsed structure' },
      { method: 'POST', path: '/api/resume/score', purpose: 'Score a resume against a job description and return an ATS score + gaps' },
      { method: 'POST', path: '/api/jobs/match', purpose: 'Match a resume to a job description and return matched/missing keywords' },
    ],
    suggestedEntities: [
      { entity: 'Resume', fields: ['userId', 'fileName', 'parsedText', 'skills', 'createdAt'] },
      { entity: 'ScoreReport', fields: ['resumeId', 'jobDescription', 'atsScore', 'missingKeywords', 'createdAt'] },
    ],
    suggestedStages: ['Resume ingestion', 'ATS scoring', 'Job matching', 'Recommendations'],
    commonProofItems: ['A resume parsed into structured fields', 'An ATS score with keyword gaps', 'Tailored improvement suggestions exported'],
  },
  {
    id: 'patent_innovation',
    label: 'Patent / Innovation',
    matchKeywords: ['patent', 'innovation', 'prior art', 'prior-art', ' ip ', 'intellectual property', 'disclosure', 'invention', 'novelty', 'claim'],
    suggestedComponents: ['Invention Disclosure Form', 'Prior-Art Search Workspace', 'IP-Readiness Scoring Service', 'Novelty Comparison Module', 'Claim Direction Summary', 'Evidence Checklist', 'Disclosure Export'],
    suggestedApis: [
      { method: 'POST', path: '/api/disclosures', purpose: 'Create an invention disclosure' },
      { method: 'POST', path: '/api/prior-art/search', purpose: 'Run a prior-art search and return candidate references' },
      { method: 'POST', path: '/api/ip-readiness/score', purpose: 'Score IP readiness from disclosure + evidence' },
    ],
    suggestedEntities: [
      { entity: 'Disclosure', fields: ['title', 'painPoint', 'noveltyAngle', 'inventors', 'createdAt'] },
      { entity: 'PriorArtResult', fields: ['disclosureId', 'source', 'reference', 'similarity', 'createdAt'] },
    ],
    suggestedStages: ['Disclosure capture', 'Prior-art research', 'IP-readiness scoring', 'Claim direction'],
    commonProofItems: ['A completed invention disclosure', 'Prior-art references with similarity notes', 'An IP-readiness score with evidence checklist'],
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    matchKeywords: ['marketplace', 'buyer', 'seller', 'listing', 'order', 'checkout', 'storefront', 'vendor', 'catalog', 'cart'],
    suggestedComponents: ['Product Listing UI', 'Seller Dashboard', 'Buyer Checkout Flow', 'Payment Placeholder', 'Review & Rating Module', 'Order History UI'],
    suggestedApis: [
      { method: 'POST', path: '/api/listings', purpose: 'Create a product listing' },
      { method: 'GET', path: '/api/listings', purpose: 'Browse / search listings' },
      { method: 'POST', path: '/api/orders', purpose: 'Place an order' },
      { method: 'POST', path: '/api/checkout', purpose: 'Start checkout (payment placeholder)' },
    ],
    suggestedEntities: [
      { entity: 'Listing', fields: ['sellerId', 'title', 'price', 'description', 'createdAt'] },
      { entity: 'Order', fields: ['buyerId', 'listingId', 'quantity', 'status', 'createdAt'] },
      { entity: 'Review', fields: ['listingId', 'buyerId', 'rating', 'comment', 'createdAt'] },
    ],
    suggestedStages: ['Listings', 'Ordering & checkout', 'Reviews'],
    commonProofItems: ['A listing created by a seller', 'A buyer order placed end-to-end', 'A rating/review on a listing'],
  },
  {
    id: 'job_platform',
    label: 'Job Platform',
    matchKeywords: ['job board', 'job platform', 'hiring', 'applicant', 'apply', 'employer', 'candidate', 'job posting', 'vacancy'],
    suggestedComponents: ['Job Listing UI', 'Employer Dashboard', 'Application Form', 'Candidate Tracker', 'Search & Filter Bar'],
    suggestedApis: [
      { method: 'POST', path: '/api/jobs', purpose: 'Create a job posting' },
      { method: 'GET', path: '/api/jobs', purpose: 'Search job postings' },
      { method: 'POST', path: '/api/applications', purpose: 'Submit an application' },
    ],
    suggestedEntities: [
      { entity: 'Job', fields: ['employerId', 'title', 'location', 'skills', 'createdAt'] },
      { entity: 'Application', fields: ['jobId', 'candidateId', 'status', 'createdAt'] },
    ],
    suggestedStages: ['Job postings', 'Applications', 'Tracking'],
    commonProofItems: ['A job posting created', 'An application submitted', 'A candidate tracked through stages'],
  },
  {
    id: 'document_analyzer',
    label: 'Document Analyzer',
    matchKeywords: ['document', 'pdf', 'parse', 'extract', 'ocr', 'contract', 'invoice', 'analyzer', 'text extraction'],
    suggestedComponents: ['Document Upload UI', 'Document Parser Service', 'Entity Extraction Service', 'Insights Dashboard', 'Export Report'],
    suggestedApis: [
      { method: 'POST', path: '/api/documents/upload', purpose: 'Upload a document and return a documentId' },
      { method: 'POST', path: '/api/documents/analyze', purpose: 'Extract structured fields/insights from a document' },
      { method: 'GET', path: '/api/documents/:id', purpose: 'Fetch a document and its extracted insights' },
    ],
    suggestedEntities: [
      { entity: 'Document', fields: ['userId', 'fileName', 'rawText', 'createdAt'] },
      { entity: 'Extraction', fields: ['documentId', 'field', 'value', 'confidence'] },
    ],
    suggestedStages: ['Document ingestion', 'Extraction', 'Insights & export'],
    commonProofItems: ['A document parsed to text', 'Structured fields extracted', 'An insights report exported'],
  },
  {
    id: 'recommendation_engine',
    label: 'Recommendation Engine',
    matchKeywords: ['recommendation', 'recommender', 'personalization', 'suggest', 'ranking', 'similarity', 'collaborative filtering'],
    suggestedComponents: ['Data Ingestion Service', 'Feature Builder', 'Ranking Service', 'Recommendation API', 'Recommendations UI'],
    suggestedApis: [
      { method: 'POST', path: '/api/events', purpose: 'Record a user interaction event' },
      { method: 'GET', path: '/api/recommendations/:userId', purpose: 'Return ranked recommendations for a user' },
    ],
    suggestedEntities: [
      { entity: 'InteractionEvent', fields: ['userId', 'itemId', 'action', 'timestamp'] },
      { entity: 'Recommendation', fields: ['userId', 'itemId', 'score', 'generatedAt'] },
    ],
    suggestedStages: ['Event ingestion', 'Ranking', 'Serving recommendations'],
    commonProofItems: ['Interaction events recorded', 'Ranked recommendations returned for a user', 'A recommendations UI rendering results'],
  },
  {
    id: 'workflow_automation',
    label: 'Workflow Automation',
    matchKeywords: ['workflow', 'automation', 'pipeline', 'trigger', 'scheduler', 'task queue', 'orchestration', 'cron', 'rule engine'],
    suggestedComponents: ['Workflow Builder UI', 'Trigger Service', 'Step Executor', 'Run History Dashboard', 'Notification Service'],
    suggestedApis: [
      { method: 'POST', path: '/api/workflows', purpose: 'Create a workflow definition' },
      { method: 'POST', path: '/api/workflows/:id/run', purpose: 'Trigger a workflow run' },
      { method: 'GET', path: '/api/runs', purpose: 'List workflow runs and their status' },
    ],
    suggestedEntities: [
      { entity: 'Workflow', fields: ['name', 'trigger', 'steps', 'createdAt'] },
      { entity: 'WorkflowRun', fields: ['workflowId', 'status', 'startedAt', 'finishedAt'] },
    ],
    suggestedStages: ['Workflow definition', 'Execution', 'Run history'],
    commonProofItems: ['A workflow defined', 'A run executed with step results', 'Run history with statuses'],
  },
  {
    id: 'ai_assistant',
    label: 'AI Assistant',
    matchKeywords: ['assistant', 'chatbot', 'chat', 'llm', 'rag', 'prompt', 'agent', 'copilot', 'conversation', 'gpt'],
    suggestedComponents: ['Chat UI', 'Prompt Builder', 'Retrieval Service', 'Assistant API', 'Conversation History UI'],
    suggestedApis: [
      { method: 'POST', path: '/api/chat', purpose: 'Send a message and return an assistant reply (provider-agnostic)' },
      { method: 'POST', path: '/api/documents/index', purpose: 'Index documents for retrieval (RAG)' },
      { method: 'GET', path: '/api/conversations/:id', purpose: 'Fetch a conversation transcript' },
    ],
    suggestedEntities: [
      { entity: 'Conversation', fields: ['userId', 'title', 'createdAt'] },
      { entity: 'Message', fields: ['conversationId', 'role', 'content', 'createdAt'] },
    ],
    suggestedStages: ['Chat API', 'Retrieval', 'Conversation UI'],
    commonProofItems: ['A working chat round-trip', 'Retrieval-augmented answers', 'Conversation history persisted'],
  },
  {
    id: 'college_placement_dashboard',
    label: 'College Placement Dashboard',
    matchKeywords: ['placement', 'college', 'campus', 'student', 'tpo', 'recruitment drive', 'university', 'training and placement'],
    suggestedComponents: ['Student Profile UI', 'Placement Drive Manager', 'Eligibility Filter Service', 'Offer Tracker', 'Placement Analytics Dashboard'],
    suggestedApis: [
      { method: 'POST', path: '/api/students', purpose: 'Register / update a student profile' },
      { method: 'POST', path: '/api/drives', purpose: 'Create a placement drive' },
      { method: 'GET', path: '/api/drives/:id/eligible', purpose: 'List students eligible for a drive' },
    ],
    suggestedEntities: [
      { entity: 'Student', fields: ['name', 'branch', 'cgpa', 'skills', 'createdAt'] },
      { entity: 'PlacementDrive', fields: ['company', 'role', 'minCgpa', 'date', 'createdAt'] },
    ],
    suggestedStages: ['Student profiles', 'Placement drives', 'Eligibility & offers', 'Analytics'],
    commonProofItems: ['Student profiles managed', 'A placement drive with eligibility filtering', 'A placement analytics dashboard'],
  },
  {
    id: 'dashboard_analytics',
    label: 'Analytics Dashboard',
    matchKeywords: ['dashboard', 'analytics', 'report', 'kpi', 'chart', 'visualization', 'insights', 'metrics view'],
    suggestedComponents: ['Data Source Connector', 'Aggregation Service', 'KPI Cards', 'Charts Panel', 'Analytics Dashboard'],
    suggestedApis: [
      { method: 'POST', path: '/api/data/ingest', purpose: 'Ingest a dataset / records' },
      { method: 'GET', path: '/api/metrics/summary', purpose: 'Return aggregated KPIs for the dashboard' },
      { method: 'GET', path: '/api/metrics/series', purpose: 'Return a time-series for charts' },
    ],
    suggestedEntities: [
      { entity: 'Record', fields: ['source', 'dimensions', 'value', 'timestamp'] },
      { entity: 'Metric', fields: ['name', 'value', 'period', 'computedAt'] },
    ],
    suggestedStages: ['Data ingestion', 'Aggregation', 'Dashboard'],
    commonProofItems: ['Data ingested from a source', 'KPI cards and charts rendering', 'A filterable analytics dashboard'],
  },
  {
    id: 'full_stack_crud',
    label: 'Full-Stack CRUD App',
    matchKeywords: ['crud', 'manage', 'tracker', 'todo', 'notes', 'inventory', 'records', 'directory', 'app'],
    suggestedComponents: ['List View UI', 'Create/Edit Form', 'Detail View', 'Auth Screens'],
    suggestedApis: [
      { method: 'POST', path: '/api/items', purpose: 'Create the primary record' },
      { method: 'GET', path: '/api/items', purpose: 'List / search records' },
      { method: 'PUT', path: '/api/items/:id', purpose: 'Update a record' },
      { method: 'DELETE', path: '/api/items/:id', purpose: 'Delete a record' },
    ],
    suggestedEntities: [
      { entity: 'Item', fields: ['userId', 'title', 'status', 'createdAt'] },
    ],
    suggestedStages: ['CRUD API', 'CRUD UI', 'Auth'],
    commonProofItems: ['Create + read + update + delete working', 'Per-user data with auth', 'Deployed and reachable'],
  },
];

const PATTERN_BY_ID = Object.fromEntries(PROJECT_BUILD_PATTERNS.map((p) => [p.id, p]));
export function getPattern(id) { return PATTERN_BY_ID[id] || null; }

/* Build a single searchable haystack from everything we know about a project. */
function projectHaystack(project = {}) {
  const p = project || {};
  const parts = [
    p.title, p.problemStatement, p.summary, p.useCase, p.domain, p.type, p.targetRole, p.mvpScope,
    Array.isArray(p.skillsCovered) ? p.skillsCovered.join(' ') : p.skillsCovered,
    Array.isArray(p.techStack) ? p.techStack.join(' ') : p.techStack,
    Array.isArray(p.features) ? p.features.join(' ') : (p.features && typeof p.features === 'object' ? JSON.stringify(p.features) : p.features),
    p.innovationGrade ? 'patent innovation' : '',
  ];
  // Pad with spaces so " ip " style boundary keywords can match.
  return ' ' + parts.map(lc).filter(Boolean).join('  ') + ' ';
}

/* Detect the best-matching pattern. Returns { pattern, score, matched[] } or
   { pattern: null, score: 0, matched: [] } when nothing matches. */
export function detectPattern(project = {}) {
  const hay = projectHaystack(project);
  let best = null;
  let bestScore = 0;
  let bestMatched = [];
  for (const pat of PROJECT_BUILD_PATTERNS) {
    const matched = pat.matchKeywords.filter((k) => hay.includes(lc(k)));
    // Weight: full_stack_crud is a soft default — only wins if nothing else does.
    const weight = pat.id === 'full_stack_crud' ? 0.4 : 1;
    const score = matched.length * weight;
    if (score > bestScore) { best = pat; bestScore = score; bestMatched = matched; }
  }
  if (!best) return { pattern: null, score: 0, matched: [] };
  return { pattern: best, score: bestScore, matched: bestMatched };
}

export default { PROJECT_BUILD_PATTERNS, detectPattern, getPattern };
