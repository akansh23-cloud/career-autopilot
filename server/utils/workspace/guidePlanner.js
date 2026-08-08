/* ============================================================
   Guided Build Kit — guide planner (deterministic).
   ------------------------------------------------------------
   ONE generator, TWO surfaces:
   - structured entries embedded in the plan → in-app Guided Path
   - the same entries rendered to guide/NN-slug.md in the ZIP

   v2 rewrite. The v1 guide could say "No specific files — this task
   is about your environment or process" for the most important task
   in the project. Now every entry carries:
     - the exact files to open
     - the numbered TODOs inside them
     - the command that proves it works
     - a worked example in the student's own domain vocabulary

   No AI anywhere. Same plan in → same guide out.
   ============================================================ */
import { arr, str, obj, slug } from './planUtils.js';
import { generateForFile } from '../codegen/codegenEngine.js';

export const GUIDE_VERSION = 2;

/* ---------------- concept library (skills → plain language) ---------------- */
const CONCEPTS = {
  'Node.js': 'Node.js runs JavaScript outside the browser — it is the engine your backend runs on. `npm run dev` hands your server file to Node and keeps it listening.',
  npm: 'npm installs the libraries listed in package.json into node_modules. `npm install` downloads them; `npm run <script>` runs a named command.',
  Git: 'Git records snapshots (commits) of your code so you can prove what you built and when. GitHub hosts those commits — recruiters and verifiers read them as evidence.',
  'Data modelling': 'A schema is a promise about your data: which fields exist, which are required, what shape they take. Get this right and half your bugs never happen.',
  MongoDB: 'MongoDB stores data as JSON-like documents in collections instead of rows in tables. Your app talks to it through Mongoose.',
  Mongoose: 'Mongoose bridges Node and MongoDB: a Schema declares what a valid document looks like, a Model gives you create(), find() and friends.',
  Express: 'Express maps URLs to functions: a request hits a route, Express runs your handler, your handler sends the response.',
  REST: 'REST is a naming convention: the URL names the thing (/api/patients), the HTTP method names the action — GET reads, POST creates, PATCH updates, DELETE removes.',
  React: 'React builds UI from components — functions returning JSX. State (useState) holds data that changes; when state changes, React re-renders for you.',
  'express-session': 'A session is how the server remembers who you are between requests: a signed cookie in the browser, the matching user data server-side.',
  'Security basics': 'Never store plaintext passwords, never trust client input, never commit .env. Three rules that prevent most beginner disasters.',
  'multer/file handling': 'Uploads arrive as multipart form data; multer parses that stream into a file object you can size-check, sanitize and store.',
  'node:test': 'A test is code that calls your code and asserts the result. A passing test is machine-checked proof — far stronger than "it looked fine".',
  Deployment: 'Deployment means running your app on a public server with a real URL. Env vars replace your local .env; a health endpoint lets machines confirm it is alive.',
};
const conceptFor = (skill) => CONCEPTS[skill] || `${skill} — a core tool in this task; the steps below show it in action.`;
const firstSentence = (s) => String(s).split(/(?<=\.)\s/)[0];

export const taskNo = (task) => String(task.order || 0).padStart(2, '0');

/* ---------------- run commands per task shape ---------------- */
function runFor(task, ctx) {
  const t = str(task.title).toLowerCase();
  const p = ctx.entityPathPlural;
  if (task.featureId) {
    const f = ctx.featureById[task.featureId];
    return [
      'npm run dev            # keep this running in one terminal',
      f ? `curl -X ${f.method} http://localhost:${ctx.port}${f.path}   # 501 now, 200 when you are done` : '',
      `npm test               # the acceptance test for this task turns green`,
    ].filter(Boolean);
  }
  if (/run the project/.test(t)) return ['npm run setup', 'npm run dev', 'npm test'];
  if (/github/.test(t)) return ['git init && git add . && git commit -m "starter skeleton"', 'git branch -M main', 'git remote add origin https://github.com/<you>/<repo>.git', 'git push -u origin main'];
  if (/schema|persist/.test(t)) return ['npm run dev', `curl http://localhost:${ctx.port}/api/${p}`];
  if (/api \(validation|harden/.test(t)) return [`curl -X POST http://localhost:${ctx.port}/api/${p} -H "content-type: application/json" -d '{}'   # expect 400 with field messages`, 'npm test'];
  if (/dashboard|search and sort/.test(t)) return ['npm run dev   # the web URL is printed by [web]'];
  if (/test green|harden/.test(t)) return ['npm test'];
  if (/real database/.test(t)) return ['# put your Atlas URI in backend/.env, then:', 'npm run seed --prefix backend', 'npm run dev'];
  if (/deploy/.test(t)) return ['npm run build', '# then follow docs/deployment-guide.md'];
  if (/auth/.test(t)) return ['npm run dev', `curl -X POST http://localhost:${ctx.port}/api/auth/login -H "content-type: application/json" -d '{"email":"a@b.com","password":"secret"}'`];
  return ['npm run dev'];
}

/* ---------------- TODO tag extraction from generated starter code ---------- */
function todoTagsFor(plan, task, files) {
  const tags = [];
  for (const f of files) {
    if (!f.templateKey) continue;
    let content = '';
    try { content = (generateForFile(plan, f.path).generatedFiles[0] || {}).content || ''; } catch { continue; }
    for (const line of content.split('\n')) {
      const m = line.match(/TODO\((\d{2}-\d+)\):?\s*(.*)/);
      if (m) {
        const text = m[2].trim().replace(/\*\/\s*$/, '').trim().replace(/[,;]\s*$/, '').replace(/\.\.$/, '.');
        tags.push({ tag: m[1], file: f.path, text });
      }
    }
  }
  const no = taskNo(task);
  return tags.filter((t) => t.tag.startsWith(`${no}-`));
}

/* ---------------- per-task step composer ---------------- */
function stepsFor(task, files, todoTags, ctx) {
  const t = str(task.title).toLowerCase();
  const steps = [];

  if (/run the project/.test(t)) {
    return [
      'Run `npm run setup`. It installs both halves of the app and writes `backend/.env` for you.',
      'Run `npm run dev`. Two servers start; open the web URL printed by `[web]`.',
      `You should see real demo ${ctx.entitiesLower} already in the list — the app ships with seeded data so your first run is never a blank page.`,
      'Run `npm test`. The smoke tests pass; the acceptance tests FAIL. That is correct — each failing test is a feature you are about to build.',
      'Run `npm run check` to see your progress board. Everything you finish from here turns a line green.',
    ];
  }
  if (/github/.test(t)) {
    return [
      'Create an empty repository on github.com — no README, the project already has one.',
      'Run the git commands below from the project folder.',
      'Refresh the repo page: your code, README and `guide/` folder should all be there.',
      'From now on every task ends with a commit. This repo is the proof recruiters and your college will actually look at.',
    ];
  }

  if (task.featureId) {
    const f = ctx.featureById[task.featureId] || {};
    return [
      `Read the contract first: \`${f.method} ${f.path}\` must return **200** with \`${f.successShape}\`. Right now it returns 501.`,
      `Open \`${f.serviceFile}\`. The commented sketch below the 501 shows the shape of a working implementation — adapt it, do not paste it blindly.`,
      'Delete the `return res.status(501)...` block once your handler actually does the work.',
      `Run \`npm test\` — \`backend/tests/acceptance/${f.slug}.test.js\` turns from red to green when you get it right.`,
      `Then open \`${f.viewFile}\` and replace the raw JSON dump with a real UI for this feature.`,
    ];
  }

  const editFiles = files.filter((f) => f.templateKey);
  const manualFiles = files.filter((f) => !f.templateKey);
  if (/schema/.test(t)) {
    steps.push(`Open \`${editFiles[0]?.path || 'backend/schemas/'}\`. This one file defines every ${ctx.entity} field.`);
    steps.push('Read the field list out loud against your problem statement. What does a real user need that is missing?');
    steps.push('Add at least one field of your own: name, type, whether it is required, and a label.');
    steps.push('Mirror the same change in `frontend/src/lib/schema.js` so the form and table pick it up.');
    steps.push('Restart the app — your new field appears in the form and the table with no other edit. That is what a single source of truth buys you.');
    return steps;
  }
  if (editFiles.length) steps.push(`Open ${editFiles.slice(0, 4).map((f) => `\`${f.path}\``).join(', ')} — working starter code is already there; your job is the marked work.`);
  for (const tag of todoTags) steps.push(`In \`${tag.file}\`, find \`TODO(${tag.tag})\` — ${tag.text ? tag.text.replace(/\.\s*$/, '') : 'implement it as described in the comment'}.`);
  if (!todoTags.length && editFiles.length) steps.push('Work through each `TODO` in those files top to bottom — each one is a few lines of real logic, not a rewrite.');
  for (const f of manualFiles) steps.push(`Create \`${f.path}\` yourself — ${f.purpose || 'see the Blueprint tab for its shape'}. No template on purpose: this one is yours.`);
  steps.push('Run the command below and see the change for yourself before you check it.');
  return steps;
}

/* ---------------- worked examples, in the student's domain ---------------- */
function exampleFor(task, ctx) {
  const t = str(task.title).toLowerCase();
  const E = ctx.entity;
  const p = ctx.entityPathPlural;
  const sample = ctx.sampleField;

  if (task.featureId) {
    const f = ctx.featureById[task.featureId] || {};
    return `Read the sketch inside \`${f.serviceFile}\` — it is commented out directly under the 501 so you can see the shape without copying it blindly.

The order that works:
1. Make the endpoint return the right shape with fake data. Test goes green.
2. Replace the fake data with a real store query. Test stays green.
3. Only then touch the UI.

Going the other way — UI first — is why features feel impossible.`;
  }
  if (/schema/.test(t)) {
    return `A field is five keys:

\`\`\`js
{ name: 'followUpAt', label: 'Follow-up due', type: 'date', ui: 'date', required: false }
\`\`\`

Types the generated code understands: \`string\`, \`number\`, \`boolean\`, \`date\`, \`enum\` (add \`enumValues\`), \`email\`, \`phone\`, \`ref\`.
Add one, restart, and watch it appear in the form AND the table without touching either file.`;
  }
  if (/persist/.test(t)) {
    return `An index makes a query fast. Add the one that matches how you actually read data:

\`\`\`js
${ctx.entityCamel}Schema.index({ ${sample}: 1, createdAt: -1 });
\`\`\`

Rule of thumb: index what you filter or sort by, not everything.`;
  }
  if (/api \(validation/.test(t)) {
    return `Good errors name the field. Try it:

\`\`\`bash
curl -X POST http://localhost:${ctx.port}/api/${p} -H "content-type: application/json" -d '{}'
\`\`\`

You should get \`400\` and \`{ "errors": { "${sample}": "… is required" } }\` — not a 500, and not a silent success.`;
  }
  if (/dashboard/.test(t)) {
    return `Fetching on mount, the React way:

\`\`\`jsx
useEffect(() => {
  api.get('/api/${p}')
    .then((d) => setItems(d.items || []))
    .catch((e) => setError(e.message));
}, []);
\`\`\`

An empty list is not a bug — it is an empty state, and it should tell the user what to do next.`;
  }
  if (/search and sort/.test(t)) {
    return `Client-side filtering is three lines:

\`\`\`jsx
const visible = items.filter((it) =>
  JSON.stringify(it).toLowerCase().includes(query.toLowerCase()));
\`\`\`

Move it to the API when the list gets past a few hundred rows — not before.`;
  }
  if (/auth/.test(t)) {
    return `The shape of a protected route:

\`\`\`js
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ message: 'Sign in first' });
  next();
}
router.get('/api/${p}', requireAuth, controller.list);
\`\`\`

Hash with bcrypt before you store anything. Never compare plaintext.`;
  }
  if (/test green/.test(t)) {
    return `Read the FIRST failure top to bottom; the rest are usually the same cause. A useful test of your own asserts a rule only you know:

\`\`\`js
test('a ${ctx.entityCamel} cannot be scheduled in the past', async () => {
  const res = await call('POST', '/api/${p}', { ${sample}: 'x', scheduledFor: '2020-01-01' });
  assert.equal(res.status, 400);
});
\`\`\``;
  }
  if (/real database/.test(t)) {
    return `Atlas free tier, then:

\`\`\`bash
# backend/.env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/${p}
\`\`\`

Restart. The log line changes from \`MEMORY MODE\` to \`connected to MongoDB\`. Then \`npm run seed --prefix backend\` and your data survives restarts.`;
  }
  if (/deploy/.test(t)) {
    return `Deploys fail on env vars 90% of the time. In order: build runs clean locally → every name in \`docs/deployment-guide.md\` is set in the provider dashboard → the deployed \`/api/health\` returns ok in your browser.`;
  }
  if (/github/.test(t)) {
    return `If push asks for a password, GitHub wants a Personal Access Token instead: Settings → Developer settings → Personal access tokens → generate, then paste it as the password.`;
  }
  return `Open the first file listed above. Your finished version keeps its structure and replaces each marked spot with real logic. Do them in order and run the check after each one.`;
}

/* ---------------- AI Pair prompt ---------------- */
function aiPromptFor(plan, task, files, todoTags, ctx) {
  const s = obj(plan.projectSummary);
  const stackLine = arr(s.techStack).slice(0, 5).join(', ') || 'React, Node.js, Express, MongoDB';
  const fileLines = files.map((f) => `- ${f.path}${f.templateKey ? ' (has starter code)' : ' (I create this from scratch)'}`).join('\n');
  const todoLines = todoTags.map((t) => `- TODO(${t.tag}) in ${t.file}: ${t.text}`).join('\n');
  const criteria = arr(task.acceptanceCriteria).map((c) => `- ${c}`).join('\n');
  const feature = task.featureId ? ctx.featureById[task.featureId] : null;
  const contract = feature
    ? `\nTHE EXACT CONTRACT I MUST SATISFY:\n${feature.method} ${feature.path} must return HTTP 200 with ${feature.successShape}.\nIt currently returns 501. The test at backend/tests/acceptance/${feature.slug}.test.js checks this.\n`
    : '';
  return `You are my coding tutor. I am a college student building "${s.title || 'my project'}" (${stackLine}). The app's main entity is ${ctx.entity} with these fields: ${ctx.fieldSummary}.

I am on Task ${taskNo(task)}: "${task.title}".
${task.description ? `Context: ${task.description}\n` : ''}${contract}
MY FILES FOR THIS TASK:
${fileLines || '- (no starter files — I implement this task from scratch)'}
${todoLines ? `\nTHE MARKED WORK IN THOSE FILES:\n${todoLines}\n` : ''}
DONE MEANS (acceptance criteria):
${criteria || '- The task works end to end.'}

I prove it locally with: ${task.checkCommand || `npm run check ${taskNo(task)}`}

RULES FOR YOU:
1. Teach, don't solve. Explain the concept in simple words BEFORE any code.
2. Give me ONE small step at a time, then wait for me to try it and reply.
3. If I paste an error, first explain what the error MEANS, then guide the fix.
4. Never write a whole file for me. Snippets of a few lines only, and make me type them.
5. When the task is done, quiz me with 2 short questions about what I built — my platform verifies understanding with a viva, so make sure I can explain this without you.`;
}

/* ---------------- checks manifest (consumed by scripts/check.mjs) ---------- */
function checksFor(task, files, todoTags, ctx) {
  const t = str(task.title).toLowerCase();
  const checks = [];
  const no = taskNo(task);

  /* Feature tasks: the endpoint contract IS the check. */
  if (task.featureId) {
    const f = ctx.featureById[task.featureId];
    if (f) {
      checks.push({
        kind: 'httpNot501',
        url: `http://localhost:${ctx.port}${f.path}`,
        method: f.method,
        file: f.serviceFile,
        label: `${f.method} ${f.path} returns 200, not 501 (app must be running)`,
      });
      /* Only THIS feature's test. Running the whole suite made a task look
         failed because a different, untouched task was still red — and the
         "first failing line" pointed at the wrong file. */
      checks.push({
        kind: 'testCmd',
        cmd: `node --test backend/tests/acceptance/${f.slug}.test.js`,
        label: `acceptance test for "${f.name}" passes`,
      });
    }
  }

  if (/run the project/.test(t)) {
    checks.push({ kind: 'fileExists', path: 'backend/node_modules', label: 'backend dependencies installed (npm run setup)' });
    checks.push({ kind: 'fileExists', path: 'frontend/node_modules', label: 'frontend dependencies installed' });
    checks.push({ kind: 'fileExists', path: 'backend/.env', label: 'backend/.env created' });
    checks.push({ kind: 'httpOk', url: `http://localhost:${ctx.port}/api/health`, label: 'GET /api/health returns ok (app must be running)' });
  }
  if (/schema/.test(t)) {
    checks.push({
      kind: 'todoCleared', path: `backend/schemas/${ctx.entitySlug}.schema.js`, prefix: `${no}-`,
      label: 'you added at least one field of your own to the schema',
    });
    checks.push({ kind: 'testCmd', cmd: 'node --test backend/tests/smoke.test.js', label: 'your schema change did not break the foundation' });
  }
  if (/api \(validation/.test(t)) {
    checks.push({ kind: 'testCmd', cmd: 'node --test backend/tests/smoke.test.js', label: 'validation and error-handling tests pass' });
  }
  /* "Harden the edges" is deliberately check-yourself only: the scaffold's own
     400/404 tests already pass, so any automated tick here would be green
     before the student touched anything. Sending them garbage on purpose is
     judgement work, and the board says so honestly (check-yourself icon). */
  if (/test green/.test(t)) {
    /* The ONE task that legitimately runs everything — by then nothing
       should be red, including every feature you built. */
    checks.push({ kind: 'testCmd', cmd: 'npm test --prefix backend', label: 'the ENTIRE suite exits 0 — no red left anywhere' });
  }
  if (/search and sort/.test(t)) {
    /* Name-agnostic signal: the shipped Dashboard renders a form component and
       a table, with no raw input of its own. Adding search means adding one.
       (The earlier pattern matched the word "search" inside a TODO comment and
       "filter" inside the delete handler — a green tick for doing nothing.) */
    checks.push({
      kind: 'fileContains', path: 'frontend/src/views/Dashboard.jsx',
      pattern: '<input',
      hint: 'Dashboard.jsx has no input of its own yet — add the search box there, then filter the rows you render.',
      label: 'the dashboard has a search input of its own',
    });
  }
  if (/persist|dashboard|auth/.test(t)) {
    checks.push({ kind: 'httpOk', url: `http://localhost:${ctx.port}/api/health`, label: 'app is running' });
  }
  if (/real database/.test(t)) {
    checks.push({ kind: 'fileContains', path: 'backend/.env', pattern: 'MONGODB_URI=.+', hint: 'MONGODB_URI is still empty — paste your Atlas connection string into backend/.env.', label: 'MONGODB_URI is set in backend/.env' });
  }

  for (const f of files.filter((x) => !x.templateKey)) {
    checks.push({ kind: 'fileExists', path: f.path, label: `${f.path} exists` });
  }
  for (const f of [...new Set(todoTags.map((x) => x.file))]) {
    checks.push({ kind: 'todoCleared', path: f, prefix: `${no}-`, label: `No TODO(${no}-…) left in ${f}` });
  }
  for (const c of arr(task.acceptanceCriteria)) checks.push({ kind: 'manual', label: c });
  return checks;
}

/* ---------------- shared render context ---------------- */
function guideCtx(plan) {
  const p = obj(plan);
  const d = obj(p.domain);
  const primary = obj(d.primary);
  const fields = arr(primary.fields).filter((f) => f.name !== 'userId');
  return {
    entity: primary.name || str(p.primaryEntity) || 'Item',
    entityCamel: primary.camel || 'item',
    entitySlug: primary.slug || 'item',
    entityPathPlural: primary.slugPlural || 'items',
    entitiesLower: primary.camelPlural || 'items',
    sampleField: (fields[0] || {}).name || 'title',
    fieldSummary: fields.slice(0, 8).map((f) => `${f.name} (${f.type})`).join(', ') || 'title, description, status',
    port: Number(obj(p.deploymentPlan).port) || 5050,
    featureById: Object.fromEntries(arr(p.featureSpecs).map((f) => [f.id, f])),
  };
}

/* ================= main planner ================= */
export function planGuide(plan = {}) {
  const p = obj(plan);
  const ctx = guideCtx(p);
  const fileById = new Map(arr(p.fileTree).map((f) => [f.id, f]));
  const phaseTitles = Object.fromEntries(arr(p.roadmap).map((r) => [r.phase, r.title]));
  const tasks = [...arr(p.tasks)].sort((a, b) => (a.order || 0) - (b.order || 0));

  const entries = tasks.map((task) => {
    const files = arr(task.linkedFiles).map((id) => fileById.get(id)).filter(Boolean)
      .map((f) => ({ path: f.path, purpose: f.purpose || '', templateKey: f.templateKey || '', action: f.templateKey ? 'edit' : 'create' }));
    const todoTags = todoTagsFor(p, task, files);
    const skills = arr(task.skills);
    const no = taskNo(task);
    const feature = task.featureId ? ctx.featureById[task.featureId] : null;
    return {
      taskId: task.id,
      no,
      slug: slug(task.title).slice(0, 48),
      title: task.title,
      phase: task.phase,
      phaseTitle: phaseTitles[task.phase] || task.phase,
      estimatedHours: task.estimatedHours || null,
      why: task.description || `This step moves "${str(obj(p.projectSummary).title) || 'your project'}" forward: ${arr(task.acceptanceCriteria)[0] || task.title}.`,
      contract: feature ? { method: feature.method, path: feature.path, shape: feature.successShape, testFile: `backend/tests/acceptance/${feature.slug}.test.js` } : null,
      files,
      steps: stepsFor(task, files, todoTags, ctx),
      todoTags,
      run: runFor(task, ctx),
      check: { command: task.checkCommand || `npm run check ${no}`, criteria: arr(task.acceptanceCriteria) },
      hints: {
        concept: skills.length ? conceptFor(skills[0]) : 'Break the task into the numbered steps above and do exactly one at a time — momentum beats understanding everything upfront.',
        nudge: arr(task.acceptanceCriteria)[0]
          ? `Work backwards from the first acceptance criterion: “${arr(task.acceptanceCriteria)[0]}”. ${files[0] ? `The place to make that true is \`${files[0].path}\`.` : ''}`
          : 'Re-read step 1 and do only that — nothing else — then run the app.',
        example: exampleFor(task, ctx),
      },
      aiPrompt: aiPromptFor(p, task, files, todoTags, ctx),
      learn: [...skills.map((s) => firstSentence(conceptFor(s))),
        'You practiced the loop that professional work runs on: change → run → prove → commit.'].slice(0, 4),
      proofRequired: !!task.proofRequired,
    };
  });

  return { version: GUIDE_VERSION, entries };
}

export function planChecks(plan = {}) {
  const p = obj(plan);
  const ctx = guideCtx(p);
  const fileById = new Map(arr(p.fileTree).map((f) => [f.id, f]));
  const tasks = [...arr(p.tasks)].sort((a, b) => (a.order || 0) - (b.order || 0));
  return {
    version: GUIDE_VERSION,
    note: 'Consumed by scripts/check.mjs. Local checks are feedback, not verification — Verified status always comes from evidence reviewed by the platform.',
    tasks: tasks.map((task) => {
      const files = arr(task.linkedFiles).map((id) => fileById.get(id)).filter(Boolean)
        .map((f) => ({ path: f.path, templateKey: f.templateKey || '' }));
      const todoTags = todoTagsFor(p, task, files);
      return { no: taskNo(task), title: task.title, checks: checksFor(task, files, todoTags, ctx) };
    }),
  };
}

/* ================= markdown rendering (for the starter pack) ================= */
export function guideEntryToMarkdown(entry, { total = 0 } = {}) {
  const e = entry;
  const fileList = e.files.length
    ? e.files.map((f) => `- \`${f.path}\` — **${f.action === 'edit' ? 'edit (starter code inside)' : 'create yourself'}**${f.purpose ? ` — ${f.purpose}` : ''}`).join('\n')
    : '_No files for this one — it is a process step (git, deployment, or a decision you make outside the code)._';
  const contract = e.contract
    ? `\n## The contract you must satisfy\n\n\`\`\`\n${e.contract.method} ${e.contract.path}  ->  200  ${e.contract.shape}\n\`\`\`\n\nRight now it answers **501 Not Implemented**. The test in \`${e.contract.testFile}\` is red until you fix that. Nothing else counts as done.\n`
    : '';
  return `# Task ${e.no} of ${String(total).padStart(2, '0')} — ${e.title}

**Phase:** ${e.phaseTitle}${e.estimatedHours ? ` · **Estimated:** ~${e.estimatedHours}h` : ''}${e.proofRequired ? ' · **Proof required**' : ''}

## Why this matters
${e.why}
${contract}
## Open these files
${fileList}

## Do this
${e.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Run this
\`\`\`bash
${e.run.join('\n')}
\`\`\`

## Prove it
\`\`\`bash
${e.check.command}
\`\`\`
${e.check.criteria.map((c) => `- [ ] ${c}`).join('\n')}

## Stuck? Open hints one at a time
<details><summary>💡 Hint 1 — the concept</summary>

${e.hints.concept}
</details>

<details><summary>🧭 Hint 2 — a nudge</summary>

${e.hints.nudge}
</details>

<details><summary>🛠 Hint 3 — a worked example</summary>

${e.hints.example}
</details>

## 🤖 Your AI pair for this task
Copy everything in the block below into ChatGPT, Claude, or Gemini — it turns any chatbot into a tutor that knows exactly where you are.

\`\`\`text
${e.aiPrompt}
\`\`\`

## What you just learned
${e.learn.map((l) => `- ${l}`).join('\n')}

---
✅ Proved it? Commit your work (\`git add . && git commit -m "task ${e.no}: ${e.title.toLowerCase()}"\`), mark the task **Done** in Career Autopilot, and open \`guide/${nextGuideName(e)}\`.
`;
}

const nextGuideName = (e) => `${String(Number(e.no) + 1).padStart(2, '0')}-….md (the next file in this folder)`;

export function guideFileName(entry) { return `guide/${entry.no}-${entry.slug}.md`; }
export function promptFileName(entry) { return `prompts/${entry.no}-${entry.slug}.md`; }

export function startHereMarkdown(plan = {}, guide = null) {
  const p = obj(plan);
  const s = obj(p.projectSummary);
  const ctx = guideCtx(p);
  const g = guide || planGuide(p);
  const total = g.entries.length;
  const features = arr(p.featureSpecs).filter((f) => !f.builtin);
  const phases = [];
  for (const e of g.entries) {
    const last = phases[phases.length - 1];
    if (!last || last.title !== e.phaseTitle) phases.push({ title: e.phaseTitle, from: e.no, to: e.no });
    else last.to = e.no;
  }
  return `# 🚀 Start here — ${s.title || 'your project'}

## Three commands, then you are running

\`\`\`bash
npm run setup     # installs everything, creates backend/.env
npm run dev       # starts the API and the app together
npm test          # some tests FAIL on purpose — those are your tasks
\`\`\`

No database needed. The API boots in **memory mode with demo ${ctx.entitiesLower} already loaded**, so your first run shows a working app, not an empty screen.

Something broken? \`npm run doctor\` names the problem and the exact fix.

## What is already built vs what is yours

| Already working | Yours to build |
|---|---|
| ${ctx.entity} list, create, delete — end to end | ${features.length ? features.map((f) => f.name).join(', ') : 'the features in your roadmap'} |
| Schema-driven form and table | Real validation rules for your domain |
| Validation, 404s, one error handler | ${features.length ? `${features.length} endpoint${features.length === 1 ? '' : 's'} currently answering 501` : 'deployment and proof'} |
| Smoke tests (green) | Acceptance tests (red until you build) |

**A 501 response is not a bug.** It is the engine telling you exactly what is not built yet. Each one has a guide file, a starter module, and a test that turns green when you get it right.

## The loop you will repeat ${total} times

1. Open the next \`guide/NN-….md\`.
2. Do the marked work in the files it lists.
3. Run \`npm run check NN\` until it passes.
4. Commit, mark it Done in Career Autopilot, move on.

Run \`npm run check\` with no number any time to see the whole board.

**Done ≠ Verified.** You mark Done; the platform marks Verified from evidence — your repo, your passing tests, your deployed URL — plus a short viva. AI may help you build; the viva proves *you* understand it.

## Your route
${phases.map((ph) => `- **${ph.title}** — tasks ${ph.from}–${ph.to}`).join('\n')}

## Working in the cloud instead

| Lane | How |
|---|---|
| ☁️ **Codespaces** *(recommended)* | Push to GitHub (task 02), then **Code → Codespaces → Create codespace**. \`.devcontainer/\` runs \`npm run setup\` for you |
| 💻 **Local** | Node 18+ from nodejs.org, then the three commands above |

## When something breaks (it will — that is the job)
- Read the error's **first line** out loud. It usually names the file and the line.
- \`npm run doctor\` — dependencies, .env, port conflicts.
- Backend unreachable from the browser? Is the \`[api]\` terminal still running?
- Still stuck: Hint 3 in the current guide, then the AI pair prompt with your exact error pasted in.

Now open **\`guide/01-….md\`**. Build something real.
`;
}
