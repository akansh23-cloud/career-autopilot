/* Guided Project Workspace — roadmap + task planner (deterministic).
   Tasks link to files/apis/models/screens and carry acceptance criteria +
   verification rules. Done and Verified are always separate. */
import { did, arr, slug } from './planUtils.js';

const PHASES = [
  { id: 'setup', title: 'Phase 1 — Setup & skeleton', description: 'Get a runnable skeleton: repo, env, health check.' },
  { id: 'backend', title: 'Phase 2 — Backend foundation', description: 'Models, routes, services for the core entity.' },
  { id: 'frontend', title: 'Phase 3 — Frontend foundation', description: 'Views wired to the API.' },
  { id: 'features', title: 'Phase 4 — MVP features', description: 'Build each must-have feature end to end.' },
  { id: 'quality', title: 'Phase 5 — Quality & tests', description: 'Tests, validation, error handling.' },
  { id: 'launch', title: 'Phase 6 — Deploy & proof', description: 'Deploy, document, and gather verifiable proof.' },
];

export function planTasks(project = {}, stack = {}, ctx = {}) {
  const { screens = [], apis = [], models = [], fileTree = [], features = [], entity = 'Item' } = ctx;
  const f = stack.features || {};
  const filesBy = (re) => fileTree.filter((x) => re.test(x.path)).map((x) => x.id);
  const apiBy = (re) => apis.filter((a) => re.test(`${a.method} ${a.path}`)).map((a) => a.id);
  const modelBy = (name) => models.filter((m) => m.name === name).map((m) => m.id);
  const screenBy = (name) => screens.filter((s) => s.name === name).map((s) => s.id);
  const e = slug(entity);

  const tasks = [];
  let order = 0;
  const add = (phase, title, t = {}) => {
    order += 1;
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
      acceptanceCriteria: t.accept || [],
      verificationRules: t.verify || [{ type: 'manual', rule: 'Manual check in v1 — GitHub verification coming next.' }],
      proofRequired: t.proof || false,
      blockerReason: '',
      starterCodeAvailable: !!(t.files || []).length,
      createdAt: null, updatedAt: null,
    });
  };

  // Phase 1
  add('setup', 'Download the Starter Pack and run it locally', {
    status: 'ready', hours: 1, skills: ['Node.js', 'npm'],
    description: 'Extract the starter ZIP, install dependencies, start frontend + backend, and confirm the health check responds. The ZIP is a starter skeleton, not a completed project.',
    files: filesBy(/^(README\.md|SETUP\.md|package\.json)$/),
    accept: ['`npm install` succeeds in frontend/ and backend/', 'GET /api/health returns ok', 'Frontend dev server renders the Dashboard shell'],
  });
  add('setup', 'Create the GitHub repository and push the skeleton', {
    status: 'ready', hours: 1, proof: true, skills: ['Git'],
    accept: ['Repo exists with an initial commit', 'README.md present', '.env is git-ignored; only .env.example is committed'],
    verify: [{ type: 'github', rule: 'Repo connection — GitHub verification coming next.' }],
  });
  add('setup', 'Configure environment variables', {
    hours: 1, files: filesBy(/\.env\.example|config\/env\.js/),
    accept: ['Local .env created from .env.example', 'Backend refuses to start with missing required vars (clear error)'],
  });

  // Phase 2
  add('backend', `Implement the ${entity} Mongoose model`, {
    hours: 2, models: modelBy(entity), files: filesBy(new RegExp(`backend/models/`)),
    skills: ['MongoDB', 'Mongoose'],
    accept: [`${entity} schema matches the Database tab`, 'Timestamps enabled', f.auth ? 'userId is required + indexed' : 'Schema compiles'],
  });
  add('backend', `Build ${entity} CRUD routes + controller + service`, {
    hours: 4, apis: apiBy(new RegExp(`/api/${e}s`)), files: filesBy(new RegExp(`backend/(routes|controllers|services)/`)),
    skills: ['Express', 'REST'],
    accept: ['List/create/get/update/delete work via curl or REST client', 'Service layer owns DB access (controllers stay thin)', 'Invalid input returns 400 with a clear message'],
  });
  if (f.auth) add('backend', 'Add basic session auth', {
    hours: 4, apis: apiBy(/auth/), models: modelBy('User'), files: filesBy(/auth\.routes|models\/User/),
    skills: ['express-session', 'Security basics'],
    description: 'TODO in starter code: real credential check. Never store plaintext passwords.',
    accept: ['Login creates a session; /api/auth/me returns the user', 'Protected routes reject signed-out requests with 401'],
  });
  if (f.upload) add('backend', `Implement the ${entity.toLowerCase()} upload API`, {
    hours: 4, apis: apiBy(/upload/), files: filesBy(/uploadService/),
    skills: ['multer/file handling'],
    accept: ['Multipart upload stores the file and creates a record', 'File size/type limits enforced'],
  });
  if (f.ai) add('backend', 'Implement the scoring service (deterministic first)', {
    hours: 4, apis: apiBy(/score/), files: filesBy(/scoringService/),
    description: 'Backend owns the score numbers deterministically. If AI is added later it contributes prose only, never changes numbers.',
    accept: ['POST score endpoint returns a stable score + breakdown for the same input'],
  });

  // Phase 3
  add('frontend', 'Wire the Dashboard to the API', {
    hours: 3, screens: screenBy('Dashboard'), apis: apiBy(new RegExp(`GET /api/${e}s$`)), files: filesBy(/views\/Dashboard/),
    skills: ['React'],
    accept: ['Dashboard lists real records from the API', 'Empty state shown for a new user', 'Errors render a readable message, not a blank screen'],
  });
  add('frontend', `Build the ${entity} create/edit flow`, {
    hours: 4, screens: screenBy(`${entity} Detail`), files: filesBy(new RegExp(`views/.*Detail`)),
    accept: ['Create + edit round-trips through the API', 'Validation errors surface inline'],
  });
  if (f.upload) add('frontend', 'Build the upload screen', {
    hours: 3, screens: screenBy(`Upload ${entity}`), files: filesBy(/Upload|FileUploadBox/),
    accept: ['File picker + drop zone works', 'Upload progress/failure states handled'],
  });
  if (f.ai) add('frontend', 'Build the score result screen', {
    hours: 2, screens: screenBy('Score Result'), files: filesBy(/ScoreResult|ScoreCard/),
    accept: ['Score + breakdown render from the API response'],
  });

  // Phase 4 — one task per MVP feature beyond the built-ins
  for (const feat of arr(features).slice(0, 6)) {
    add('features', `Feature: ${feat.name}`, {
      hours: 5, screens: screens.filter((s) => s.name === feat.name).map((s) => s.id),
      description: 'End-to-end: screen → API → model. Use the inspector links to see what already exists.',
      accept: [`“${feat.name}” works end to end for a signed-in user`, 'No regressions in earlier tasks'],
    });
  }
  if (f.admin) add('features', 'Admin dashboard (read-only)', { hours: 3, screens: screenBy('Admin Dashboard'), apis: apiBy(/admin/), accept: ['Admin-only route guard works', 'Non-admin gets a friendly denial'] });
  if (f.recruiter) add('features', 'Recruiter console view', { hours: 3, screens: screenBy('Recruiter Console'), apis: apiBy(/recruiter/) });

  // Phase 5
  add('quality', 'Write backend tests', {
    hours: 3, files: filesBy(/tests\//), skills: ['node:test'],
    accept: ['Health test passes', `${entity} service test passes`, '`npm test` exits 0'],
    verify: [{ type: 'local_tests', rule: 'Test run output is local evidence; CI verification coming next.' }],
  });
  add('quality', 'Input validation + error handling pass', {
    hours: 3, files: filesBy(/validators\//),
    accept: ['Every write endpoint validates input', 'Unknown routes return 404 JSON', 'Server never crashes on bad input'],
  });

  // Phase 6
  add('launch', 'Deploy frontend + backend', {
    hours: 4, proof: true, skills: ['Deployment'],
    description: `Target: ${stack.cloudProvider || 'any provider'}. See the Deployment tab for env vars and steps.`,
    accept: ['Public URL serves the app', '/api/health reachable on the deployed backend'],
    verify: [{ type: 'deployment', rule: 'Deployed URL check — automated verification coming next.' }],
  });
  add('launch', 'Complete README + screenshots + demo proof', {
    hours: 2, proof: true,
    accept: ['README covers what/why/how-to-run', 'At least 2 screenshots committed', 'Proof tab items submitted'],
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

  return { tasks: tasks.slice(0, 40), roadmap };
}

export { PHASES };
