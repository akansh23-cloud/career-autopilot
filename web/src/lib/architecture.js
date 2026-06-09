// Part 5 — Architecture visualization.
// Generates and parses simple Mermaid-style diagrams for in-app rendering.
// This module is deliberately defensive because project data can come from
// static generators, AI providers, Patent OS conversions, or older localStore
// records with different shapes.

const esc = (s = '') => String(s ?? '')
  .replace(/"/g, "'")
  .replace(/[\[\]]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const toArray = (value) => {
  if (Array.isArray(value)) return value.filter((x) => x != null).map(String).filter(Boolean);
  if (value == null) return [];
  if (typeof value === 'string') return value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'object') return Object.values(value).flatMap(toArray).filter(Boolean);
  return [String(value)];
};

const words = (value, fallback = '') => esc(value || fallback).slice(0, 64) || fallback;
const nodeLabel = (label, fallback) => words(label, fallback).replace(/[^A-Za-z0-9 /_+.#:-]/g, '');

/* Build a Mermaid graph string from a project, tailored to its actual content.
   Safe for malformed/partial project objects. */
export function generateMermaid(project = {}) {
  const p = project && typeof project === 'object' ? project : {};
  const type = words(p.type, 'Full Stack');
  const stackItems = toArray(p.techStack || p.recommendedTechStack || p.skillsCovered || []);
  const stack = stackItems.join(' ').toLowerCase();
  const modules = toArray(p.mvpModules || p.modules || p.features?.mustHave || p.checklist?.map?.((c) => c?.label || c) || []);
  const title = nodeLabel(p.title || p.projectTitle || 'Project', 'Project');
  const problem = nodeLabel(p.problemStatement || p.problem || p.painPoint || 'User problem', 'User problem');
  const solution = nodeLabel(p.solution || p.proposedSolution || p.useCase || 'Project solution', 'Project solution');

  const has = (...patterns) => patterns.some((rx) => rx.test(stack));
  const frontend = has(/react|next|vue|angular|svelte|tailwind|vite|frontend|ui/) || /Frontend|Full Stack/i.test(type)
    ? nodeLabel(stackItems.find((s) => /react|next|vue|angular|svelte|frontend|ui/i.test(s)) || 'Frontend UI', 'Frontend UI')
    : null;
  const backend = has(/express|node|fastapi|django|spring|flask|api|backend/) || /Backend|Full Stack|AI\/ML|Cloud|DevOps/i.test(type)
    ? nodeLabel(stackItems.find((s) => /api|node|express|fastapi|backend|spring|django/i.test(s)) || 'Backend API', 'Backend API')
    : null;
  const db = toArray(p.databaseSchema || p.dataModel).length || has(/mongo|postgres|mysql|dynamo|sql|prisma|database/)
    ? nodeLabel(stackItems.find((s) => /mongo|postgres|mysql|dynamo|sql|database/i.test(s)) || 'Database', 'Database')
    : null;
  const external = toArray(p.externalApis || p.externalSources || p.sourceCitations).length || has(/openai|anthropic|gemini|stripe|razorpay|github|stack|arxiv|external/)
    ? nodeLabel(toArray(p.externalApis || p.externalSources || p.sourceCitations)[0] || 'External Sources', 'External Sources')
    : null;
  const deploy = has(/aws|lambda|s3|gcp|azure|render|railway|vercel|netlify|docker|kubernetes|terraform|github actions|ci\/cd|helm|jenkins/)
    ? nodeLabel(stackItems.find((s) => /aws|vercel|render|docker|kubernetes|terraform|github actions|ci\/cd|jenkins/i.test(s)) || 'Deployment / CI', 'Deployment / CI')
    : null;

  const L = ['graph TD'];
  L.push(`  User["Target User"]`);
  L.push(`  Problem["${problem}"]`);
  L.push(`  Core["${title}"]`);
  L.push('  User --> Problem');
  L.push('  Problem --> Core');

  if (frontend) { L.push(`  Frontend["${frontend}"]`); L.push('  Core --> Frontend'); }
  if (backend) { L.push(`  API["${backend}"]`); L.push(frontend ? '  Frontend --> API' : '  Core --> API'); }
  const hub = backend ? 'API' : frontend ? 'Frontend' : 'Core';
  const primaryModules = modules.slice(0, 3);
  primaryModules.forEach((m, i) => {
    const id = `Module${i + 1}`;
    L.push(`  ${id}["${nodeLabel(m, `Module ${i + 1}`)}"]`);
    L.push(`  ${hub} --> ${id}`);
  });
  if (db) { L.push(`  DB[("${db}")]`); L.push(`  ${hub} --> DB`); }
  if (external) { L.push(`  External["${external}"]`); L.push(`  ${hub} --> External`); }
  L.push(`  Result["${solution || 'Working MVP / proof'}"]`);
  if (primaryModules.length) L.push(`  Module${primaryModules.length} --> Result`);
  else L.push(`  ${hub} --> Result`);
  if (deploy) { L.push(`  Deploy["${deploy}"]`); L.push('  Result --> Deploy'); }
  return L.join('\n');
}


export function normalizeMermaidInput(value, fallbackProject = null) {
  const seen = new Set();
  const pick = (v, depth = 0) => {
    if (v == null || depth > 4) return '';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
      for (const item of v) {
        const out = pick(item, depth + 1);
        if (out && /\b(graph|flowchart)\s+(TD|LR|TB|BT|RL)\b/i.test(out)) return out;
      }
      return v.map((item) => pick(item, depth + 1)).filter(Boolean).join('\n');
    }
    if (typeof v === 'object') {
      if (seen.has(v)) return '';
      seen.add(v);
      const directKeys = ['mermaid', 'mermaidCode', 'chart', 'code', 'diagram', 'source', 'text'];
      for (const key of directKeys) {
        const out = pick(v[key], depth + 1);
        if (out) return out;
      }
      const arrayKeys = ['mermaidDiagrams', 'diagrams', 'figures', 'items'];
      for (const key of arrayKeys) {
        const out = pick(v[key], depth + 1);
        if (out) return out;
      }
      const vals = Object.values(v).map((item) => pick(item, depth + 1)).filter(Boolean);
      const graphLike = vals.find((out) => /\b(graph|flowchart)\s+(TD|LR|TB|BT|RL)\b/i.test(out));
      return graphLike || vals.join('\n');
    }
    return '';
  };
  const normalized = pick(value).trim();
  if (normalized) return normalized;
  return fallbackProject ? generateMermaid(fallbackProject) : '';
}

/* Parse a simple Mermaid `graph TD` or `flowchart TD` string into {nodes, edges}.
   Supports common node shapes and avoids throwing on unsupported Mermaid syntax. */
export function parseGraph(mermaid = '') {
  const nodes = new Map();
  const edges = [];
  const raw = normalizeMermaidInput(mermaid).slice(0, 12000);

  const addNode = (id, label, shape) => {
    const safeId = String(id || '').trim().replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
    if (!safeId) return null;
    const safeLabel = String(label || safeId).replace(/<[^>]*>/g, '').replace(/[{}]/g, '').trim().slice(0, 80) || safeId;
    if (!nodes.has(safeId)) nodes.set(safeId, { id: safeId, label: safeLabel, shape: shape || 'rect' });
    else if (label) {
      const n = nodes.get(safeId);
      n.label = safeLabel;
      if (shape) n.shape = shape;
    }
    return safeId;
  };

  const parseNode = (rawNode = '') => {
    let text = String(rawNode || '').trim();
    text = text.replace(/^[|].*?[|]/, '').replace(/[|].*?[|]$/, '').trim();
    text = text.replace(/^[\-\.=>\s]+|[\-\.=>\s]+$/g, '').trim();
    const idMatch = text.match(/^([A-Za-z0-9_]+)/);
    if (!idMatch) return null;
    const id = idMatch[1];
    const rest = text.slice(id.length).trim();
    let label = null;
    let shape = 'rect';

    const patterns = [
      [/^\[\("([^"]*)"\)\]/, 'cyl'],
      [/^\(\("([^"]*)"\)\)/, 'circle'],
      [/^\["([^"]*)"\]/, 'rect'],
      [/^\("([^"]*)"\)/, 'round'],
      [/^\[\(([^)]*)\)\]/, 'cyl'],
      [/^\(\(([^)]*)\)\)/, 'circle'],
      [/^\[([^\]]*)\]/, 'rect'],
      [/^\(([^)]*)\)/, 'round'],
    ];
    for (const [rx, sh] of patterns) {
      const m = rest.match(rx);
      if (m) { label = m[1]; shape = sh; break; }
    }
    return { id, label, shape };
  };

  raw.split('\n').slice(0, 200).forEach((lineRaw) => {
    const line = lineRaw.trim();
    if (!line || /^(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|stateDiagram)\s/i.test(line) || line.startsWith('%%') || line.startsWith('subgraph') || line === 'end') return;
    const parts = line.split(/-->|---|-.->|==>|--\s*[^-]*\s*-->/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const left = parseNode(parts[0]);
      const right = parseNode(parts[parts.length - 1]);
      const a = left ? addNode(left.id, left.label, left.shape) : null;
      const b = right ? addNode(right.id, right.label, right.shape) : null;
      if (a && b && a !== b) edges.push([a, b]);
    } else {
      const n = parseNode(line);
      if (n) addNode(n.id, n.label, n.shape);
    }
  });
  return { nodes: Array.from(nodes.values()).slice(0, 40), edges: edges.slice(0, 80) };
}

/* Assign nodes to layers using cycle-safe BFS. Previous versions could hang on
   feedback-loop diagrams because depth kept increasing through cycles. */
export function layoutGraph(mermaid = '') {
  const { nodes, edges } = parseGraph(mermaid);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const indeg = Object.fromEntries(nodes.map((n) => [n.id, 0]));
  edges.forEach(([, to]) => { if (indeg[to] != null) indeg[to] += 1; });
  const adj = {};
  edges.forEach(([a, b]) => { if (byId[a] && byId[b]) (adj[a] = adj[a] || []).push(b); });

  const depth = {};
  const roots = nodes.filter((n) => indeg[n.id] === 0).map((n) => n.id);
  const start = roots.length ? roots : nodes.slice(0, 1).map((n) => n.id);
  const queue = [...start];
  start.forEach((id) => { depth[id] = 0; });
  const visitedEdges = new Set();
  let guard = 0;
  while (queue.length && guard < 500) {
    guard += 1;
    const cur = queue.shift();
    (adj[cur] || []).forEach((nx) => {
      const edgeKey = `${cur}->${nx}`;
      if (visitedEdges.has(edgeKey)) return;
      visitedEdges.add(edgeKey);
      if (depth[nx] == null) {
        depth[nx] = Math.min((depth[cur] || 0) + 1, 8);
        queue.push(nx);
      }
    });
  }
  nodes.forEach((n) => { if (depth[n.id] == null) depth[n.id] = 0; });
  const layers = {};
  nodes.forEach((n) => { (layers[depth[n.id]] = layers[depth[n.id]] || []).push(n); });
  return { nodes, edges, byId, layers, maxDepth: Math.max(0, ...Object.keys(layers).map(Number)) };
}
