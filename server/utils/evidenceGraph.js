/* ============================================================
   EVIDENCE GRAPH  (deterministic; pure; service-level)
   ------------------------------------------------------------
   Traceability layer over EXISTING entities — no new storage, no
   graph database. Given a workspace plan (with its Verification
   V3 results) it emits typed nodes and edges so the platform can
   answer, from real ids:

     "Why is this skill considered verified?"
     "Which task/evidence produced this claim?"

   Node kinds: role, gap, project, milestone, task, criterion,
   evidence, skill. Edge kinds: addresses, contains, requires,
   evidencedBy, verifies, demonstrates.
   ============================================================ */

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' ? v : {});
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function buildEvidenceGraph(plan = {}, { project = null } = {}) {
  const p = obj(plan);
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const addNode = (id, kind, label, meta = {}) => {
    if (!id || seen.has(id)) return id;
    seen.add(id);
    nodes.push({ id, kind, label: str(label).slice(0, 160), ...meta });
    return id;
  };
  const addEdge = (from, to, kind) => { if (from && to) edges.push({ from, to, kind }); };

  const summary = obj(p.projectSummary);
  const intel = obj(obj(project).intelligence);
  const projectNode = addNode(`project:${p.projectId || p.id || 'current'}`, 'project', summary.title || p.title || 'Project');

  const role = str(summary.targetRole || intel.targetRole || obj(project).targetRole);
  if (role) {
    const roleNode = addNode(`role:${role.toLowerCase()}`, 'role', role);
    addEdge(projectNode, roleNode, 'addresses');
  }
  for (const gap of arr(intel.skillGapsFixed || obj(project).skillGapsFixed)) {
    const g = addNode(`gap:${str(gap).toLowerCase()}`, 'gap', gap);
    addEdge(projectNode, g, 'addresses');
  }

  const taskNodeId = (id) => `task:${id}`;
  for (const ph of arr(p.roadmap)) {
    const m = addNode(`milestone:${ph.id || ph.phase}`, 'milestone', ph.title || ph.phase, { status: ph.status || 'pending' });
    addEdge(projectNode, m, 'contains');
    for (const tid of arr(ph.tasks)) addEdge(m, taskNodeId(tid), 'contains');
  }

  const tv = obj(p.taskVerification);
  const resultByTask = new Map(arr(tv.results).map((r) => [r.taskId, r]));
  const evidenceNodes = new Map(); // evidenceRef -> node id

  const evidenceLabel = {
    github: `GitHub repository${p.proofEvidence?.repoUrl ? ` (${p.proofEvidence.repoUrl})` : ''}`,
    ci: 'Green CI workflow run',
    deployment: `Deployed URL${p.proofEvidence?.liveUrl ? ` (${p.proofEvidence.liveUrl})` : ''}`,
    'deployment+api': 'Deployed URL + API health',
    test_output: 'Pasted test output (self-reported)',
    architecture: 'Architecture OS spec',
    self: 'Student attestation on task completion',
  };
  const evidenceFor = (ref) => {
    if (!ref) return null;
    if (!evidenceNodes.has(ref)) evidenceNodes.set(ref, addNode(`evidence:${ref}`, 'evidence', evidenceLabel[ref] || ref));
    return evidenceNodes.get(ref);
  };

  for (const t of arr(p.tasks)) {
    const tNode = addNode(taskNodeId(t.id), 'task', t.title, { status: t.status });
    const r = resultByTask.get(t.id);
    if (!r) continue;
    for (const c of arr(r.criteria)) {
      const cNode = addNode(`criterion:${c.id}`, 'criterion', c.label, { result: c.result, kind: c.kind });
      addEdge(tNode, cNode, 'requires');
      const e = evidenceFor(c.evidenceRef);
      if (e && (c.result === 'verified' || c.result === 'self_reported')) addEdge(cNode, e, 'evidencedBy');
    }
  }

  for (const s of arr(tv.skillEvidence)) {
    const sNode = addNode(`skill:${str(s.skill).toLowerCase()}`, 'skill', s.skill, { confidence: s.confidence });
    for (const tid of arr(s.taskIds)) addEdge(taskNodeId(tid), sNode, 'demonstrates');
  }

  return {
    version: 'evidence-graph-v1',
    projectId: str(p.projectId || p.id),
    generatedAt: new Date().toISOString(),
    nodes, edges,
    counts: { nodes: nodes.length, edges: edges.length },
  };
}

/* Answer "why is this skill verified?" as a readable chain. */
export function traceSkill(graph = {}, skill = '') {
  const g = obj(graph);
  const target = `skill:${str(skill).toLowerCase()}`;
  const node = arr(g.nodes).find((n) => n.id === target);
  if (!node) return { skill, found: false, chain: [] };
  const tasks = arr(g.edges).filter((e) => e.to === target && e.kind === 'demonstrates').map((e) => e.from);
  const chain = tasks.map((tid) => {
    const t = arr(g.nodes).find((n) => n.id === tid);
    const criteria = arr(g.edges).filter((e) => e.from === tid && e.kind === 'requires').map((e) => e.to);
    const evidenced = criteria.flatMap((cid) =>
      arr(g.edges).filter((e) => e.from === cid && e.kind === 'evidencedBy').map((e) => {
        const c = arr(g.nodes).find((n) => n.id === cid);
        const ev = arr(g.nodes).find((n) => n.id === e.to);
        return { criterion: c?.label || cid, evidence: ev?.label || e.to };
      }));
    return { task: t?.label || tid, taskStatus: t?.status || '', evidence: evidenced };
  });
  return { skill: node.label, confidence: node.confidence || 'none', found: true, chain };
}

export default { buildEvidenceGraph, traceSkill };
