// Part 5 — Architecture visualization.
// We generate a Mermaid `graph TD` string for every project (portable: copy it
// into any Mermaid renderer / GitHub markdown). For the in-app diagram we do
// NOT add a heavy mermaid dependency — instead we parse the simple graph and
// render a clean dark-themed SVG fallback (see ArchitectureDiagram in
// ProofViews.jsx). Both share this one source of truth.

const esc = (s = '') => String(s).replace(/"/g, "'").replace(/[\[\]]/g, '');

/* Build a Mermaid graph string from a project, tailored to its type/stack. */
export function generateMermaid(project = {}) {
  const type = project.type || 'Full Stack';
  const stack = (project.techStack || []).join(' ').toLowerCase();
  const frontend = /react|next|vue|angular|svelte|tailwind|vite/.test(stack) ? 'React Frontend'
    : type === 'Frontend' || type === 'Full Stack' ? 'Web Frontend' : null;
  const backend = /express|node|fastapi|django|spring|flask|api/.test(stack) || ['Backend', 'Full Stack', 'AI/ML', 'Cloud'].includes(type) ? 'API Service' : null;
  const db = project.databaseSchema && project.databaseSchema.length
    ? (/mongo/.test(stack) ? 'MongoDB' : /dynamo/.test(stack) ? 'DynamoDB' : 'PostgreSQL')
    : (/mongo|postgres|mysql|dynamo|sql|prisma/.test(stack) ? 'Database' : null);
  const auth = /jwt|auth|oauth|clerk|cognito/.test(stack) ? 'Auth (JWT)' : null;
  const cloud = /aws|lambda|s3|gcp|azure|render|railway|vercel|netlify/.test(stack) || ['Cloud', 'DevOps'].includes(type) ? 'Cloud / Deploy' : null;
  const ci = /docker|kubernetes|terraform|github actions|ci\/cd|helm|jenkins/.test(stack) || ['DevOps', 'Cloud'].includes(type) ? 'CI/CD Pipeline' : null;
  const ext = /stripe|razorpay|openai|anthropic|api gateway|kafka|redis|external/.test(stack) ? 'External API' : null;

  const L = [];
  L.push('graph TD');
  L.push(`  User["User"]`);
  if (frontend) { L.push(`  Frontend["${esc(frontend)}"]`); L.push('  User --> Frontend'); }
  if (backend) {
    L.push(`  API["${esc(backend)}"]`);
    L.push(frontend ? '  Frontend --> API' : '  User --> API');
  }
  const hub = backend ? 'API' : frontend ? 'Frontend' : 'User';
  if (auth) { L.push(`  Auth["${esc(auth)}"]`); L.push(`  ${hub} --> Auth`); }
  if (db) { L.push(`  DB[("${esc(db)}")]`); L.push(`  ${hub} --> DB`); }
  if (ext) { L.push(`  Ext["${esc(ext)}"]`); L.push(`  ${hub} --> Ext`); }
  if (cloud) { L.push(`  Cloud["${esc(cloud)}"]`); L.push(`  ${backend ? 'API' : 'Frontend'} --> Cloud`); }
  if (ci) { L.push(`  CI["${esc(ci)}"]`); L.push(`  CI --> ${cloud ? 'Cloud' : hub}`); }
  if (L.length <= 2) { L.push(`  Core["${esc(project.title || 'Application')}"]`); L.push('  User --> Core'); }
  return L.join('\n');
}

/* Parse a simple Mermaid `graph TD` string into { nodes, edges } for the
   fallback SVG renderer. Supports node shapes ["..."], (("..")), [("..")]. */
export function parseGraph(mermaid = '') {
  const nodes = new Map();
  const edges = [];
  const addNode = (id, label, shape) => {
    const safeId = String(id || '').trim().replace(/[^A-Za-z0-9_]/g, '_');
    if (!safeId) return null;
    const safeLabel = String(label || safeId).replace(/<[^>]*>/g, '').trim() || safeId;
    if (!nodes.has(safeId)) nodes.set(safeId, { id: safeId, label: safeLabel, shape: shape || 'rect' });
    else if (label) { const n = nodes.get(safeId); n.label = safeLabel; if (shape) n.shape = shape; }
    return safeId;
  };

  const parseNode = (raw = '') => {
    let text = String(raw).trim();
    text = text.replace(/^[|].*?[|]/, '').replace(/[|].*?[|]$/, '').trim();
    const idMatch = text.match(/^([A-Za-z0-9_]+)/);
    if (!idMatch) return null;
    const id = idMatch[1];
    const rest = text.slice(id.length).trim();
    let label = null;
    let shape = 'rect';

    const quoted = rest.match(/^\[\("([^"]*)"\)\]/) || rest.match(/^\(\("([^"]*)"\)\)/) || rest.match(/^\["([^"]*)"\]/) || rest.match(/^\("([^"]*)"\)/);
    if (quoted) {
      label = quoted[1];
      if (rest.startsWith('[(')) shape = 'cyl';
      else if (rest.startsWith('((')) shape = 'circle';
      else if (rest.startsWith('(')) shape = 'round';
      return { id, label, shape };
    }

    const unquoted = rest.match(/^\[\(([^)]*)\)\]/) || rest.match(/^\(\(([^)]*)\)\)/) || rest.match(/^\[([^\]]*)\]/) || rest.match(/^\(([^)]*)\)/);
    if (unquoted) {
      label = unquoted[1];
      if (rest.startsWith('[(')) shape = 'cyl';
      else if (rest.startsWith('((')) shape = 'circle';
      else if (rest.startsWith('(')) shape = 'round';
    }
    return { id, label, shape };
  };

  mermaid.split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line || /^(graph|flowchart|sequenceDiagram|classDiagram|erDiagram)\s/i.test(line) || line.startsWith('%%')) return;
    const parts = line.split(/-->|---|-.->|==>/);
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
  return { nodes: Array.from(nodes.values()), edges };
}

/* Assign nodes to layers (BFS depth from roots) for a top-down layout. */
export function layoutGraph(mermaid = '') {
  const { nodes, edges } = parseGraph(mermaid);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const indeg = Object.fromEntries(nodes.map((n) => [n.id, 0]));
  edges.forEach(([, to]) => { if (indeg[to] != null) indeg[to] += 1; });
  const depth = {};
  const roots = nodes.filter((n) => indeg[n.id] === 0).map((n) => n.id);
  const queue = roots.map((id) => { depth[id] = 0; return id; });
  const adj = {};
  edges.forEach(([a, b]) => { (adj[a] = adj[a] || []).push(b); });
  while (queue.length) {
    const cur = queue.shift();
    (adj[cur] || []).forEach((nx) => {
      const d = (depth[cur] || 0) + 1;
      if (depth[nx] == null || d > depth[nx]) { depth[nx] = d; queue.push(nx); }
    });
  }
  nodes.forEach((n) => { if (depth[n.id] == null) depth[n.id] = 0; });
  const layers = {};
  nodes.forEach((n) => { (layers[depth[n.id]] = layers[depth[n.id]] || []).push(n); });
  return { nodes, edges, byId, layers, maxDepth: Math.max(0, ...Object.keys(layers).map(Number)) };
}
