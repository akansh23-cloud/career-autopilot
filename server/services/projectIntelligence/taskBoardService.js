/* ============================================================
   Task 7 — GitHub-ready task board
   ------------------------------------------------------------
   Generates GitHub issue-style build tasks with acceptance
   criteria, files to touch, labels, priority, estimate and
   dependencies. Deterministic; derived from the project model so
   tasks line up with the blueprint + diagrams.
   ============================================================ */
import { asList, lc } from './util.js';
import { deriveProjectModel } from './projectDiagramService.js';

let _seq = 0;
const tid = () => `T-${String(++_seq).padStart(3, '0')}`;

export function taskBoard({ project = {}, recommendation = {}, explainer = {} } = {}) {
  _seq = 0;
  const m = deriveProjectModel({ project, recommendation, explainer });
  const tasks = [];

  // Scaffolding (always first).
  const scaffold = {
    id: tid(), title: 'Scaffold repo (client, server, CI, README)',
    description: 'Create the base structure so every later task has a place to live and deployment is solvable early.',
    acceptanceCriteria: ['Client + server folders boot locally', 'README skeleton present', '.env.example committed (no secrets)', 'CI workflow runs lint on push'],
    filesToCreateOrModify: ['README.md', '.github/workflows/ci.yml', '.env.example', 'server/index.js', 'client/src/main.jsx'],
    labels: ['setup', 'P0'], priority: 'P0', estimatedTime: '0.5 day', dependencies: [],
  };
  tasks.push(scaffold);

  const dbTask = {
    id: tid(), title: 'Define data model + persistence layer',
    description: `Model the core entities for ${m.title} and wire up ${m.db}.`,
    acceptanceCriteria: ['Schema/migrations created', 'A repository/service can read + write the core entity', 'Seed script for local dev'],
    filesToCreateOrModify: ['server/db/schema.sql', 'server/services/store.js'],
    labels: ['backend', 'P0'], priority: 'P0', estimatedTime: '1 day', dependencies: [scaffold.id],
  };
  tasks.push(dbTask);

  // One task per backend API.
  const apiTasks = m.apis.map((ep) => {
    const isUpload = /upload/i.test(ep);
    return {
      id: tid(), title: `Build endpoint ${ep}`,
      description: `Implement ${ep} for ${m.title}.`,
      acceptanceCriteria: isUpload
        ? ['Accepts the expected input (e.g. .txt/.log/file)', 'Validates size + type', 'Stores the parsed result', 'Returns an analysis/record ID']
        : ['Validates the request body', 'Performs the operation', 'Returns a typed JSON response', 'Has an integration test'],
      filesToCreateOrModify: ['server/routes/api.js', 'server/services/core.js', 'tests/api.test.js'],
      labels: ['backend', 'api', 'P0'], priority: 'P0', estimatedTime: '0.5–1 day', dependencies: [dbTask.id],
    };
  });
  tasks.push(...apiTasks);

  // Core engine task (the hard, differentiating part).
  const engineTitle = m.isAnalyzer ? 'Root-cause analysis engine' : m.isPipeline ? 'Transform + data-quality engine' : 'Core domain service';
  const engine = {
    id: tid(), title: `Implement the ${engineTitle}`,
    description: 'This is the differentiating core — the part that proves real skill, not CRUD.',
    acceptanceCriteria: m.isAnalyzer
      ? ['Produces a ranked root-cause list', 'Each cause has a fix suggestion + confidence', 'Handles malformed input gracefully', 'Unit-tested on real-ish samples']
      : m.isPipeline
        ? ['Idempotent transforms', 'Quality assertions block bad rows', 'Emits run metrics', 'Unit-tested']
        : ['Core operation is correct + transactional', 'Edge cases handled', 'Unit-tested'],
    filesToCreateOrModify: ['server/services/engine.js', 'tests/engine.test.js'],
    labels: ['backend', 'core', 'P0'], priority: 'P0', estimatedTime: '2–3 days', dependencies: [dbTask.id],
  };
  tasks.push(engine);

  // Frontend happy path.
  const fe = {
    id: tid(), title: 'Build the core UI happy path',
    description: `Wire ${m.modules[0]} → results so the demo works end-to-end.`,
    acceptanceCriteria: ['User can complete the core task in the UI', 'Loading + error states handled', 'Results render from the real API'],
    filesToCreateOrModify: ['client/src/pages/Core.jsx', 'client/src/components/Results.jsx'],
    labels: ['frontend', 'P0'], priority: 'P0', estimatedTime: '2 days', dependencies: apiTasks.map((t) => t.id),
  };
  tasks.push(fe);

  // Proof / deployment tasks.
  tasks.push({
    id: tid(), title: 'Add tests + CI gate',
    description: 'Make the build verifiable.',
    acceptanceCriteria: ['Unit + integration tests pass in CI', 'CI fails on lint/test errors', 'Coverage of the core engine'],
    filesToCreateOrModify: ['.github/workflows/ci.yml', 'tests/'],
    labels: ['testing', 'P1'], priority: 'P1', estimatedTime: '1 day', dependencies: [engine.id, ...apiTasks.map((t) => t.id)],
  });
  tasks.push({
    id: tid(), title: 'Deploy + verify live demo',
    description: 'Deploy and confirm the live URL works in incognito.',
    acceptanceCriteria: ['Frontend + API deployed', 'Health check returns 200', 'Live URL completes the happy path'],
    filesToCreateOrModify: ['docker-compose.yml', 'README.md'],
    labels: ['devops', 'P1'], priority: 'P1', estimatedTime: '0.5 day', dependencies: [fe.id],
  });
  tasks.push({
    id: tid(), title: 'Write README + architecture diagram + screenshots',
    description: 'Recruiter-facing proof.',
    acceptanceCriteria: ['README has problem/solution/architecture', 'Architecture diagram embedded', 'Screenshots / demo clip linked'],
    filesToCreateOrModify: ['README.md', 'docs/architecture.md'],
    labels: ['docs', 'P1'], priority: 'P1', estimatedTime: '0.5 day', dependencies: [fe.id],
  });

  return {
    tasks,
    columns: { todo: tasks.map((t) => t.id), inProgress: [], done: [] },
    summary: { total: tasks.length, p0: tasks.filter((t) => t.priority === 'P0').length, p1: tasks.filter((t) => t.priority === 'P1').length },
    note: 'Paste each task as a GitHub issue. Order respects dependencies; do P0 first.',
  };
}
