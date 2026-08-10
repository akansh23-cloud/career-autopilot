/* Guided Project Workspace — roadmap + task planner (deterministic).

   v2 changes, all aimed at "can a second-year student actually finish this?":
   - No task is ever fileless. Every task points at real files it edits.
   - The old 7-file mega-task (CRUD + auth + scoring + health in one) is
     split into single-concern tasks a student can finish in one sitting.
   - Each MVP feature becomes a real task: a backend module that returns
     501, a screen, and an acceptance test that goes green when built.
   - Every task carries `checkCommand`, so "am I done?" has one answer
     you can run instead of a checkbox you can lie to.

   Done and Verified always stay separate. */
import { did, arr, obj, str, slug } from './planUtils.js';
import { deriveDependencies } from './dependencyPlanner.js';

const PHASES = [
  { id: 'setup', title: 'Phase 1 — Run it', description: 'Get the skeleton running on your machine and pushed to GitHub.' },
  { id: 'backend', title: 'Phase 2 — Own the data', description: 'Make the schema, storage and API yours.' },
  { id: 'frontend', title: 'Phase 3 — Own the screen', description: 'Wire the UI to the API you now control.' },
  { id: 'features', title: 'Phase 4 — Build the product', description: 'Turn each 501 into a working feature.' },
  { id: 'quality', title: 'Phase 5 — Make it trustworthy', description: 'Tests, validation, error handling.' },
  { id: 'launch', title: 'Phase 6 — Ship and prove it', description: 'Deploy, document, and gather verifiable proof.' },
];

export function planTasks(project = {}, stack = {}, ctx = {}) {
  const { screens = [], apis = [], models = [], fileTree = [], entity = 'Item', domain = null, featureSpecs = [] } = ctx;
  const f = stack.features || {};
  const d = obj(domain);
  const primary = obj(d.primary);
  const E = primary.name || entity;
  const ePlural = primary.slugPlural || `${slug(entity)}s`;
  const eLabel = primary.label || E;
  const eCamel = primary.camel || 'item';
  const standalone = arr(featureSpecs).filter((x) => !x.builtin);

  const filesBy = (re) => fileTree.filter((x) => re.test(x.path)).map((x) => x.id);
  const fileAt = (path) => fileTree.filter((x) => x.path === path).map((x) => x.id);
  const filesForFeature = (id) => fileTree.filter((x) => x.featureId === id).map((x) => x.id);
  const apiBy = (re) => apis.filter((a) => re.test(`${a.method} ${a.path}`)).map((a) => a.id);
  const modelBy = (name) => models.filter((m) => m.name === name).map((m) => m.id);
  const screenBy = (name) => screens.filter((s) => s.name === name).map((s) => s.id);

  const tasks = [];
  let order = 0;
  const add = (phase, title, t = {}) => {
    order += 1;
    const no = String(order).padStart(2, '0');
    tasks.push({
      id: did('task', phase, title),
      title, description: t.description || '',
      phase, order,
      status: t.status || 'backlog',
      priority: t.priority || 'normal',
      difficulty: t.difficulty || project.difficulty || 'Intermediate',
      estimatedHours: t.hours || 3,
      skills: t.skills || [],
      linkedArchitectureNodes: [],
      linkedScreens: t.screens || [],
      linkedApis: t.apis || [],
      linkedModels: t.models || [],
      linkedFiles: t.files || [],
      featureId: t.featureId || null,
      acceptanceCriteria: t.accept || [],
      checkCommand: t.check || `npm run check ${no}`,
      testCommand: t.testCmd || '',
      verificationRules: t.verify || [{ type: 'manual', rule: 'Manual check in v1 — GitHub verification coming next.' }],
      proofRequired: t.proof || false,
      blockerReason: '',
      starterCodeAvailable: !!(t.files || []).length,
      createdAt: null, updatedAt: null,
    });
  };

  /* ============ Phase 1 — Run it ============ */
  add('setup', 'Run the project and see it working', {
    status: 'ready', hours: 1, skills: ['Node.js', 'npm'],
    description: 'Three commands: setup, dev, test. The app boots with demo data already loaded, so you should see a working screen before you write a single line.',
    files: [...fileAt('README.md'), ...fileAt('scripts/setup.mjs'), ...fileAt('package.json')],
    accept: [
      '`npm run setup` finishes without errors',
      '`npm run dev` starts both servers and the app opens in the browser',
      'The dashboard shows the seeded demo rows (not an empty list)',
      '`npm test` runs — smoke tests pass, acceptance tests fail (that is correct)',
    ],
    testCmd: 'npm run doctor',
  });
  add('setup', 'Push it to GitHub', {
    status: 'ready', hours: 1, proof: true, skills: ['Git'],
    description: 'This repository is your proof of work. Every task from here ends with a commit.',
    files: fileAt('README.md'),
    accept: ['Repo exists with an initial commit', 'README.md is visible on the repo page', '.env is git-ignored; only .env.example is committed'],
    verify: [{ type: 'github', rule: 'Repo connection — GitHub verification coming next.' }],
  });

  /* ============ Phase 2 — Own the data ============ */
  add('backend', `Shape the ${eLabel} schema for YOUR problem`, {
    hours: 2, skills: ['Data modelling'],
    description: `backend/schemas/ is the one file that defines ${E} fields. The model, the validator, the API, the form and the table all read it. Change a field here and every layer follows.`,
    models: modelBy(E),
    files: [...filesBy(/backend\/schemas\//), ...fileAt('frontend/src/lib/schema.js')],
    accept: [
      `Every field a real ${eLabel.toLowerCase()} needs exists in the schema (add at least one field of your own)`,
      'The frontend copy in frontend/src/lib/schema.js matches the backend one',
      'The dashboard form shows your new field without any other edit',
    ],
    testCmd: 'npm test --prefix backend',
  });
  add('backend', `Make ${E} persist properly`, {
    hours: 3, skills: ['MongoDB', 'Mongoose'],
    description: 'The model mirrors the schema. Add the indexes and constraints that match how you will actually query the data.',
    models: modelBy(E), files: filesBy(/backend\/models\//),
    accept: [`${E} model fields match the schema`, 'Timestamps enabled', f.auth ? 'userId is required and indexed' : 'At least one index reflects your main query'],
  });
  add('backend', `Own the ${E} API (validation + errors)`, {
    hours: 3, skills: ['Express', 'REST'],
    description: 'CRUD already works. Your job is to make it trustworthy: real validation messages, correct status codes, no 500s on bad input.',
    apis: apiBy(new RegExp(`/api/${ePlural}`)),
    files: [...filesBy(new RegExp(`backend/(routes|controllers|services)/${ePlural}|backend/(controllers|services)/${eCamel}`)), ...filesBy(/backend\/lib\/store\.js/)],
    accept: [
      'Create with a missing required field returns 400 with a field-level message',
      'Unknown id returns 404, never 500',
      'Service layer owns data access — controllers stay thin',
    ],
    testCmd: 'npm test --prefix backend',
  });
  if (f.auth) add('backend', 'Add real session auth', {
    hours: 4, apis: apiBy(/auth/), models: modelBy('User'), files: filesBy(/auth\.routes|models\/User/),
    skills: ['express-session', 'Security basics'],
    description: 'The starter routes accept anything. Hash passwords, create a session, and add requireAuth in front of the API.',
    accept: ['Login creates a session; /api/auth/me returns the user', 'Protected routes reject signed-out requests with 401', 'Passwords are hashed, never stored in plain text'],
  });
  if (f.upload) add('backend', `Implement the ${eLabel.toLowerCase()} upload API`, {
    hours: 4, apis: apiBy(/upload/), files: filesBy(/uploadService/),
    skills: ['multer/file handling'],
    accept: ['Multipart upload stores the file and creates a record', 'File size and type limits enforced'],
  });

  /* ============ Phase 3 — Own the screen ============ */
  add('frontend', 'Make the dashboard yours', {
    hours: 3, screens: screenBy('Dashboard'), apis: apiBy(new RegExp(`GET /api/${ePlural}$`)),
    files: [...fileAt('frontend/src/views/Dashboard.jsx'), ...filesBy(/frontend\/src\/components\//)],
    skills: ['React'],
    description: 'The list, form and delete already work. Now make it read like YOUR product: real labels, a useful empty state, readable errors.',
    accept: [
      'The screen uses your domain language, not generic placeholders',
      'Empty state explains what to do next',
      'A failed request shows a readable message, never a blank screen',
    ],
  });
  add('frontend', 'Add search and sort to the list', {
    hours: 2, screens: screenBy('Dashboard'), files: fileAt('frontend/src/views/Dashboard.jsx'),
    description: 'Any real list needs to be searchable. Filter client-side first; move it to the API when the list gets big.',
    accept: ['Typing in the search box filters the visible rows', 'At least one column can be sorted', 'Clearing the search restores everything'],
  });

  /* ============ Phase 4 — Build the product ============ */
  for (const spec of standalone) {
    add('features', `Build: ${spec.name}`, {
      hours: 4,
      featureId: spec.id,
      description: `${spec.summary} Right now \`${spec.method} ${spec.path}\` answers 501 and its acceptance test is red. Implement the handler, then the screen, until the test passes.`,
      files: filesForFeature(spec.id),
      screens: screens.filter((s) => s.name === spec.name).map((s) => s.id),
      accept: spec.acceptance,
      testCmd: `npm test --prefix backend -- tests/acceptance/${spec.slug}.test.js`,
      skills: ['Express', 'React'],
    });
  }
  if (f.admin) add('features', 'Admin view (read-only first)', {
    hours: 3, screens: screenBy('Admin Dashboard'), apis: apiBy(/admin/), files: filesBy(/admin\.routes/),
    accept: ['Admin-only route guard works', 'Non-admin gets a friendly denial, not a crash'],
  });

  /* ============ Phase 5 — Make it trustworthy ============ */
  add('quality', 'Get every test green', {
    hours: 3, files: filesBy(/backend\/tests\//), skills: ['node:test'],
    description: 'Acceptance tests were red on purpose. By now they should all pass. Then add one test of your own for a rule only you know about.',
    accept: ['`npm test` exits 0 with zero failures', 'You added at least one test of your own', 'A deliberately broken change makes a test fail (try it, then undo it)'],
    testCmd: 'npm test',
    verify: [{ type: 'local_tests', rule: 'Test run output is local evidence; CI verification coming next.' }],
  });
  add('quality', 'Harden the edges', {
    hours: 2, files: [...filesBy(/backend\/server\.js/), ...filesBy(/backend\/schemas\//)],
    description: 'Send it garbage on purpose: empty bodies, huge strings, wrong types, unknown routes. Nothing should return 500.',
    accept: ['Every write endpoint validates input', 'Unknown routes return 404 JSON', 'The server never crashes on bad input'],
  });

  /* ============ Phase 6 — Ship and prove it ============ */
  add('launch', 'Connect a real database', {
    hours: 2, files: [...fileAt('backend/scripts/seed.js'), ...fileAt('.env.example')],
    description: 'Memory mode got you this far. Create a free MongoDB Atlas cluster, put the URI in backend/.env, and run the seeder.',
    accept: ['Backend logs "connected to MongoDB" on start', '`npm run seed` loads the demo rows', 'Data survives a server restart'],
  });
  add('launch', 'Deploy frontend + backend', {
    hours: 4, proof: true, skills: ['Deployment'],
    description: `Target: ${stack.cloudProvider || 'any provider'}. Every name in docs/deployment-guide.md must be set in the provider dashboard.`,
    files: filesBy(/docs\/deployment-guide/),
    accept: ['Public URL serves the app', '/api/health reachable on the deployed backend', 'The deployed app talks to the real database'],
    verify: [{ type: 'deployment', rule: 'Deployed URL check — automated verification coming next.' }],
  });
  add('launch', 'README, screenshots, proof', {
    hours: 2, proof: true, files: fileAt('README.md'),
    accept: ['README covers what, why and how to run it', 'At least 2 screenshots committed under docs/screenshots', 'Test output pasted into the proof tab'],
    verify: [{ type: 'github', rule: 'README/screenshot detection — GitHub verification coming next.' }],
  });

  const counts = {};
  for (const t of tasks) counts[t.phase] = (counts[t.phase] || 0) + 1;
  const roadmap = PHASES.filter((p) => counts[p.id]).map((p, i) => ({
    id: did('phase', p.id),
    phase: p.id, title: p.title, description: p.description, order: i + 1,
    status: 'pending',
    tasks: tasks.filter((t) => t.phase === p.id).map((t) => t.id),
  }));

  return { tasks: deriveDependencies(tasks.slice(0, 40)), roadmap };
}

export { PHASES };
