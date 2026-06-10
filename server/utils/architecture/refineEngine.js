/* ============================================================
   REFINE ENGINE  (deterministic)
   ------------------------------------------------------------
   Takes an existing architectureSpec + a natural-language
   instruction, parses it with keyword rules (no AI needed),
   adjusts the capability set, and rebuilds all views.
   Returns { architectureSpec, diffSummary }.
   ============================================================ */
import { CAPABILITY_CATALOG, ARCHITECTURE_PATTERNS } from './knowledgeBase.js';
import { matchPattern } from './patternMatcher.js';
import { buildSpec } from './specBuilder.js';

/* keyword → capability id(s). */
const ADD_RULES = [
  [/redis|elasticache|memorystore|\bcach(e|ing)\b/, ['cache']],
  [/dead.?letter|dlq/, ['dlq', 'queue']],
  [/\bsqs\b|rabbitmq|message queue|\bqueue\b|service bus/, ['queue', 'worker']],
  [/kafka|event bus|eventbridge|event.driven|event grid|pub\/?sub/, ['eventBus']],
  [/\bstream(ing)?\b|kinesis|dataflow|flink/, ['streamProcessor', 'eventBus']],
  [/\bworker(s)?\b|background job|background processing/, ['worker', 'queue']],
  [/monitor|cloudwatch|metrics|observab/, ['monitoring', 'alerting', 'dashboard']],
  [/\blog(s|ging)\b/, ['logging']],
  [/trac(e|ing)|x-ray|jaeger/, ['tracing']],
  [/\balert(s|ing)?\b/, ['alerting']],
  [/backup|restore|disaster recovery|\bdr\b/, ['backup']],
  [/ci\/?cd|github actions|deploy(ment)? pipeline|codepipeline|build pipeline|\bpipeline\b/, ['cicdPipeline', 'registry']],
  [/container registry|\becr\b|\bacr\b/, ['registry']],
  [/terraform|\biac\b|infrastructure as code|cloudformation|bicep|pulumi/, ['iac']],
  [/\bwaf\b|web application firewall|cloud armor/, ['waf']],
  [/rate limit/, ['rateLimiter']],
  [/secret|key vault|\bvault\b/, ['secrets']],
  [/audit/, ['auditLog']],
  [/\bcdn\b|cloudfront|front door/, ['cdn']],
  [/load balancer|\balb\b|\belb\b/, ['loadBalancer']],
  [/api gateway|api management/, ['apiGateway']],
  [/\bauth(entication)?\b|login|oauth|\bsso\b|identity/, ['authService']],
  [/rbac|authoriz|role.based/, ['rbac']],
  [/object storage|\bs3\b|blob storage|file upload/, ['objectStorage']],
  [/vector (db|store|database)|pinecone|pgvector|embedding/, ['vectorDb', 'embedding']],
  [/opensearch|elasticsearch|search index/, ['search']],
  [/postgres|mysql|relational|\brds\b|cloud sql|aurora/, ['relationalDb']],
  [/mongo|documentdb|document db|cosmos|firestore|dynamo/, ['documentDb']],
  [/warehouse|redshift|bigquery|snowflake|synapse/, ['dataWarehouse']],
  [/\bai\b|\bllm\b|inference|anthropic|openai|\brag\b/, ['ai']],
  [/payment|stripe|razorpay|billing/, ['payments']],
  [/notif|email service|\bsms\b|push notification/, ['notifications']],
  [/schedul|cron/, ['scheduler']],
  [/serverless|lambda|cloud function/, ['serverlessFn']],
  [/kubernetes|k8s|\becs\b|\beks\b|\bgke\b|\baks\b/, ['computeContainer']],
];

const lc = (s) => String(s || '').toLowerCase();
const label = (c) => CAPABILITY_CATALOG[c]?.label || c;

/* Parse an instruction into { add, remove, recognized }. */
export function parseInstruction(instruction = '') {
  const text = lc(instruction);
  const removeSegs = [];
  const addText = text.replace(/(?:remove|drop|delete|without|get rid of)\s+([^.;]+)/g, (_, seg) => {
    removeSegs.push(seg);
    return ' ';
  });
  const removeText = removeSegs.join(' ; ');
  const collect = (t) => {
    const out = new Set();
    for (const [rx, caps] of ADD_RULES) if (rx.test(t)) caps.forEach((c) => out.add(c));
    return [...out];
  };
  const add = collect(addText);
  const remove = collect(removeText).filter((c) => !add.includes(c));
  return { add, remove, recognized: add.length + remove.length > 0 };
}

/* Refine an existing spec: adjust capabilities, rebuild views deterministically,
   preserve identity (id / provider / level / pattern), bump version. */
export function refineSpec(spec = {}, instruction = '') {
  const parsed = parseInstruction(instruction);
  const before = new Set(spec.capabilities || []);
  const after = new Set(before);
  parsed.add.forEach((c) => after.add(c));
  parsed.remove.forEach((c) => after.delete(c));
  const finalCaps = [...after];

  const match = matchPattern({ title: spec.title, description: spec.description });
  const pinnedPattern = spec.pattern?.id && ARCHITECTURE_PATTERNS.find((p) => p.id === spec.pattern.id);
  if (pinnedPattern) {
    match.pattern = pinnedPattern;
    match.patternId = pinnedPattern.id;
    match.confidence = spec.pattern.confidence || match.confidence;
    match.reasons = spec.pattern.reasons || match.reasons;
  }

  const refined = buildSpec(
    { title: spec.title, description: spec.description, projectId: spec.projectId },
    match,
    {
      cloudProvider: spec.provider,
      targetLevel: spec.targetLevel,
      diagramTypes: (spec.views || []).map((v) => v.type),
      capabilities: finalCaps, // pin the user-refined set exactly
    }
  );
  refined.version = (Number(spec.version) || 1) + 1;
  refined.id = spec.id || refined.id;
  if (spec.pattern) refined.pattern = spec.pattern;

  const added = finalCaps.filter((c) => !before.has(c));
  const removed = [...before].filter((c) => !after.has(c));

  return {
    architectureSpec: refined,
    diffSummary: {
      instruction: String(instruction).slice(0, 500),
      recognized: parsed.recognized,
      added: added.map(label),
      removed: removed.map(label),
      addedCapabilities: added,
      removedCapabilities: removed,
      version: refined.version,
      notes: parsed.recognized
        ? `Applied ${added.length} addition(s) and ${removed.length} removal(s); all views regenerated deterministically.`
        : 'No known components recognized in the instruction — try naming concrete components (e.g. "Add Redis cache and SQS queue").',
    },
  };
}

export default { refineSpec, parseInstruction };
