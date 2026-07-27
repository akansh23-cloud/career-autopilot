/* ============================================================
   Guided Build Kit — guide planner (deterministic).
   ------------------------------------------------------------
   ONE generator, TWO surfaces:
   - structured entries embedded in the plan → rendered by the
     in-app Guided Path stepper
   - the same entries rendered to guide/NN-slug.md inside the
     starter pack → the student's in-editor journey
   Also produces: per-task AI Pair prompts (copy into any chatbot),
   a 3-level hints ladder, "what you learned" recaps, and the
   workspace/checks.json manifest that scripts/check.mjs executes.

   No AI anywhere in generation. Same plan in → same guide out.
   ============================================================ */
import { arr, str, obj, slug } from './planUtils.js';
import { generateForFile } from '../codegen/codegenEngine.js';

export const GUIDE_VERSION = 1;

/* ---------------- concept library (skills → plain-language) ----------------
   First sentence doubles as the "what you learned" recap line. */
const CONCEPTS = {
  'Node.js': 'Node.js runs JavaScript outside the browser — it is the engine your backend server runs on. When you run `npm run dev`, Node executes your server file and keeps it listening for requests.',
  npm: 'npm installs the libraries your project depends on (listed in package.json) into node_modules. `npm install` downloads them; `npm run <script>` runs a named command.',
  Git: 'Git records snapshots (commits) of your code so you can track history and prove your work. GitHub hosts those commits publicly — recruiters and verifiers read it as evidence.',
  MongoDB: 'MongoDB stores your data as JSON-like documents in collections instead of rows in tables. Your app talks to it through Mongoose.',
  Mongoose: 'Mongoose is the bridge between your Node code and MongoDB: a Schema declares what a valid document looks like, and a Model gives you methods like create() and find().',
  Express: 'Express maps URLs to functions: when a request hits a route like GET /api/items, Express runs your handler and sends back the response you build.',
  REST: 'REST is a naming convention for APIs: the URL names the thing (/api/tasks), and the HTTP method names the action — GET reads, POST creates, PATCH updates, DELETE removes.',
  React: 'React builds UI from components — functions that return HTML-like JSX. State (useState) holds data that changes; when state changes, React re-renders the component for you.',
  'express-session': 'A session is how the server remembers who you are between requests: it sets a signed cookie in your browser and keeps the matching user data server-side.',
  'Security basics': 'Never store plaintext passwords, never trust client input, and never commit .env files — three rules that prevent most beginner security disasters.',
  'multer/file handling': 'File uploads arrive as multipart form data; multer parses that stream into a file object you can size-check, sanitize, and store safely.',
  'node:test': 'Automated tests are code that calls your code and asserts the result. If `npm test` passes, you have machine-checked proof the behavior works — far stronger than "it looked fine".',
  Deployment: 'Deployment means running your app on a public server with a real URL. Env vars replace your local .env, and a health endpoint lets machines confirm it is alive.',
  Vite: 'Vite is the dev server for your React app: it serves your code with instant reload and proxies /api requests to the backend so both feel like one app.',
};

const conceptFor = (skill) => CONCEPTS[skill] || `${skill} — a core tool in this task; the guide steps show it in action.`;
const firstSentence = (s) => String(s).split(/(?<=\.)\s/)[0];

/* ---------------- worked-example library (hint level 3) ----------------
   Short, generic-but-concrete snippets keyed by task shape. */
function exampleFor(task, ctx) {
  const t = str(task.title).toLowerCase();
  const E = ctx.entity;
  if (/mongoose model/.test(t)) {
    return `A finished field block looks like:\n\n\`\`\`js\nconst ${E.toLowerCase()}Schema = new mongoose.Schema({\n  title: { type: String, required: true, trim: true },\n  status: { type: String, enum: ['open', 'done'], default: 'open' },\n}, { timestamps: true });\n\`\`\`\n\nMatch each field in the Database tab, then restart the backend and re-run the check.`;
  }
  if (/crud routes/.test(t)) {
    return `The create path, end to end: the route receives the request → the controller calls the service → the service talks to the data layer:\n\n\`\`\`js\n// service\nexport async function create${E}(body) {\n  if (!body?.title) throw new Error('title is required');\n  return store.create({ title: String(body.title).trim() });\n}\n\`\`\`\n\nTest it without the frontend: \`curl -X POST http://localhost:5050/api/${E.toLowerCase()}s -H "content-type: application/json" -d '{"title":"first one"}'\``;
  }
  if (/dashboard to the api|wire the dashboard/.test(t)) {
    return `Fetching on mount, the React way:\n\n\`\`\`jsx\nconst [items, setItems] = useState([]);\nuseEffect(() => {\n  fetch('/api/${E.toLowerCase()}s').then(r => r.json())\n    .then(d => setItems(d.items || []));\n}, []);\n\`\`\`\n\nIf the list is empty, create one record with curl first — an empty state is not a bug.`;
  }
  if (/environment variables/.test(t)) {
    return `.env.example lists NAMES; your local .env holds VALUES:\n\n\`\`\`\nPORT=5050\nMONGODB_URI=            # leave empty for memory mode, paste an Atlas URI for real persistence\n\`\`\`\n\nThe backend prints which mode it booted in — read its first log lines.`;
  }
  if (/session auth/.test(t)) {
    return `The shape of a protected route:\n\n\`\`\`js\nfunction requireAuth(req, res, next) {\n  if (!req.session?.userId) return res.status(401).json({ message: 'Sign in first' });\n  next();\n}\nrouter.get('/api/auth/me', requireAuth, handler);\n\`\`\`\n\nSign-in sets \`req.session.userId\`; sign-out destroys the session.`;
  }
  if (/backend tests/.test(t)) {
    return `A complete test is three lines of intent:\n\n\`\`\`js\ntest('health responds ok', async () => {\n  const res = await request(app).get('/api/health');\n  assert.equal(res.body.ok, true);\n});\n\`\`\`\n\nRun \`npm test --prefix backend\` — read the FIRST failure top to bottom; the rest are usually the same cause.`;
  }
  if (/deploy/.test(t)) {
    return `Deploys fail on env vars 90% of the time. Checklist: build command runs clean locally → every name in docs/deployment-guide.md is set in the provider dashboard → the deployed /api/health URL returns ok in your browser. Fix in that order.`;
  }
  if (/github repository/.test(t)) {
    return `The exact commands, from the project folder:\n\n\`\`\`bash\ngit init && git add . && git commit -m "starter skeleton"\ngit branch -M main\ngit remote add origin https://github.com/<you>/<repo>.git\ngit push -u origin main\n\`\`\`\n\nIf push asks for a password, create a Personal Access Token (GitHub → Settings → Developer settings).`;
  }
  return `Open “Preview starter code” for the first related file — your finished version keeps its structure and replaces each numbered TODO with 2–10 lines of real logic. Do them in order; run the check after each one.`;
}

/* ---------------- run commands per task shape ---------------- */
function runFor(task, ctx) {
  const t = str(task.title).toLowerCase();
  const e = ctx.entity.toLowerCase();
  if (/starter pack and run it locally/.test(t)) {
    return ['npm install --prefix backend && npm run dev --prefix backend', 'npm install --prefix frontend && npm run dev --prefix frontend', 'curl http://localhost:5050/api/health'];
  }
  if (/github repository/.test(t)) return ['git init && git add . && git commit -m "starter skeleton"', 'git push -u origin main'];
  if (/environment variables/.test(t)) return ['cp .env.example backend/.env', 'npm run dev --prefix backend   # read the boot log: which DB mode?'];
  if (/mongoose model|crud routes|session auth|upload api|scoring service/.test(t)) {
    const probe = /crud/.test(t) ? [`curl http://localhost:5050/api/${e}s`] : [];
    return ['npm run dev --prefix backend', ...probe];
  }
  if (/dashboard|create\/edit|upload screen|score result|feature:/.test(t)) return ['npm run dev --prefix frontend   # keep the backend running in another terminal'];
  if (/backend tests|validation/.test(t)) return ['npm test --prefix backend'];
  if (/deploy/.test(t)) return ['npm run build --prefix frontend   # then follow docs/deployment-guide.md'];
  return ['npm run dev --prefix backend', 'npm run dev --prefix frontend'];
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
        let text = m[2].trim().replace(/\*\/\s*$/, '').trim() // strip trailing */
          .replace(/[,;]\s*$/, '') // trailing comma/semicolon from a wrapped comment line
          .replace(/\.\.$/, '.'); // collapse an accidental double period
        tags.push({ tag: m[1], file: f.path, text });
      }
    }
  }
  // Only this task's tags (prefix = its own number).
  const no = taskNo(task);
  return tags.filter((t) => t.tag.startsWith(`${no}-`));
}

export const taskNo = (task) => String(task.order || 0).padStart(2, '0');

/* ---------------- per-task step composer ---------------- */
function stepsFor(task, files, todoTags, ctx) {
  const t = str(task.title).toLowerCase();
  const steps = [];
  if (/starter pack and run it locally/.test(t)) {
    steps.push('Pick your lane in `guide/00-start-here.md` — Browser (fastest), Codespaces (recommended), or Local. All three end at the same running app.');
    steps.push('Install and start the backend, then the frontend, with the commands below (two terminals for Local).');
    steps.push('Open the frontend URL Vite prints. You should see the Dashboard shell with an empty state — empty is correct; you haven\'t created data yet.');
    steps.push('Hit the health endpoint (last command below). `{ ok: true }` means the skeleton works end to end.');
    return steps;
  }
  if (/github repository/.test(t)) {
    steps.push('Create an empty repository on github.com (no README — the project already has one).');
    steps.push('Run the git commands below from the project folder to make your first commit and push it.');
    steps.push('Refresh the repo page: your code, README and guide/ folder should all be visible. This repo IS your proof — every task ends with a commit from now on.');
    return steps;
  }
  const editFiles = files.filter((f) => f.templateKey);
  const manualFiles = files.filter((f) => !f.templateKey);
  if (editFiles.length) steps.push(`Open ${editFiles.map((f) => `\`${f.path}\``).join(', ')} — starter code is already there; your job is the numbered TODOs.`);
  for (const tag of todoTags) steps.push(`In \`${tag.file}\`, find \`TODO(${tag.tag})\` — ${tag.text ? tag.text.replace(/\.\s*$/, '') : 'implement it as described in the comment'}.`);
  if (!todoTags.length && editFiles.length) steps.push('Work through each `TODO` comment in those files top to bottom — each one is 2–10 lines of real logic.');
  for (const f of manualFiles) steps.push(`Create \`${f.path}\` yourself — ${f.purpose || 'see the Blueprint tab for its shape'}. No template on purpose: this one is yours.`);
  steps.push('Start the app with the run command below and exercise what you changed before checking yourself.');
  return steps;
}

/* ---------------- AI Pair prompt ---------------- */
function aiPromptFor(plan, task, files, todoTags, ctx) {
  const s = obj(plan.projectSummary);
  const stackLine = arr(s.techStack).slice(0, 5).join(', ') || 'React, Node.js, Express, MongoDB';
  const fileLines = files.map((f) => `- ${f.path}${f.templateKey ? ' (has starter code with numbered TODOs)' : ' (I create this from scratch)'}`).join('\n');
  const todoLines = todoTags.map((t) => `- TODO(${t.tag}) in ${t.file}: ${t.text}`).join('\n');
  const criteria = arr(task.acceptanceCriteria).map((c) => `- ${c}`).join('\n');
  return `You are my coding tutor. I am a college student building "${s.title || 'my project'}" (${stackLine}) to learn full-stack development. Primary entity: ${ctx.entity}.

I am on Task ${taskNo(task)}: "${task.title}".
${task.description ? `Context: ${task.description}\n` : ''}
MY FILES FOR THIS TASK:
${fileLines || '- (no starter files — I implement this task from scratch)'}
${todoLines ? `\nTHE NUMBERED TODOs I MUST IMPLEMENT:\n${todoLines}\n` : ''}
DONE MEANS (acceptance criteria):
${criteria || '- The task works end to end.'}

I verify locally with: node scripts/check.mjs ${taskNo(task)}

RULES FOR YOU:
1. Teach, don't solve. Explain the concept in simple words BEFORE any code.
2. Give me ONE small step at a time, then wait for me to try it and reply.
3. If I paste an error, first explain what the error MEANS, then guide the fix.
4. Never write a whole file for me. Snippets of a few lines only, and make me type them.
5. When the task is done, quiz me with 2 short questions about what I built — my platform verifies my understanding with a viva, so make sure I can explain this without you.`;
}

/* ---------------- checks manifest (consumed by scripts/check.mjs) ---------- */
function checksFor(task, files, todoTags, ctx) {
  const t = str(task.title).toLowerCase();
  const checks = [];
  const no = taskNo(task);
  for (const f of files.filter((x) => !x.templateKey)) checks.push({ kind: 'fileExists', path: f.path, label: `${f.path} exists` });
  for (const f of [...new Set(todoTags.map((x) => x.file))]) checks.push({ kind: 'todoCleared', path: f, prefix: `${no}-`, label: `No TODO(${no}-…) left in ${f}` });
  if (/starter pack and run it locally|crud routes|session auth/.test(t)) {
    checks.push({ kind: 'httpOk', url: 'http://localhost:5050/api/health', label: 'GET /api/health returns ok (backend must be running)' });
  }
  if (/crud routes/.test(t)) checks.push({ kind: 'httpOk', url: `http://localhost:5050/api/${ctx.entity.toLowerCase()}s`, label: `GET /api/${ctx.entity.toLowerCase()}s responds (backend running)` });
  if (/backend tests|validation/.test(t)) checks.push({ kind: 'testCmd', cmd: 'npm test --prefix backend', label: '`npm test --prefix backend` exits 0' });
  for (const c of arr(task.acceptanceCriteria)) checks.push({ kind: 'manual', label: c });
  return checks;
}

/* ================= main planner ================= */
export function planGuide(plan = {}) {
  const p = obj(plan);
  const ctx = { entity: str(p.primaryEntity) || 'Item' };
  const fileById = new Map(arr(p.fileTree).map((f) => [f.id, f]));
  const phaseTitles = Object.fromEntries(arr(p.roadmap).map((r) => [r.phase, r.title]));
  const tasks = [...arr(p.tasks)].sort((a, b) => (a.order || 0) - (b.order || 0));

  const entries = tasks.map((task) => {
    const files = arr(task.linkedFiles).map((id) => fileById.get(id)).filter(Boolean)
      .map((f) => ({ path: f.path, purpose: f.purpose || '', templateKey: f.templateKey || '', action: f.templateKey ? 'edit' : 'create' }));
    const todoTags = todoTagsFor(p, task, files);
    const skills = arr(task.skills);
    const no = taskNo(task);
    return {
      taskId: task.id,
      no,
      slug: slug(task.title).slice(0, 48),
      title: task.title,
      phase: task.phase,
      phaseTitle: phaseTitles[task.phase] || task.phase,
      estimatedHours: task.estimatedHours || null,
      why: task.description || `This step moves "${str(obj(p.projectSummary).title) || 'your project'}" forward: ${arr(task.acceptanceCriteria)[0] || task.title}.`,
      files,
      steps: stepsFor(task, files, todoTags, ctx),
      todoTags,
      run: runFor(task, ctx),
      check: { command: `node scripts/check.mjs ${no}`, criteria: arr(task.acceptanceCriteria) },
      hints: {
        concept: skills.length ? conceptFor(skills[0]) : 'Break the task into the numbered steps above and do exactly one at a time — momentum beats understanding everything upfront.',
        nudge: arr(task.acceptanceCriteria)[0]
          ? `Work backwards from the first acceptance criterion: “${arr(task.acceptanceCriteria)[0]}”. ${files[0] ? `The place to make that true is \`${files[0].path}\`.` : ''}`
          : 'Re-read step 1 and do only that — nothing else — then run the app.',
        example: exampleFor(task, ctx),
      },
      aiPrompt: aiPromptFor(p, task, files, todoTags, ctx),
      learn: [...skills.map((s) => firstSentence(conceptFor(s))),
        `You practiced the loop that professional work runs on: change → run → check → commit.`].slice(0, 4),
      proofRequired: !!task.proofRequired,
    };
  });

  return { version: GUIDE_VERSION, entries };
}

export function planChecks(plan = {}) {
  const p = obj(plan);
  const ctx = { entity: str(p.primaryEntity) || 'Item' };
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
    : '_No specific files — this task is about your environment or process._';
  return `# Task ${e.no} of ${String(total).padStart(2, '0')} — ${e.title}

**Phase:** ${e.phaseTitle}${e.estimatedHours ? ` · **Estimated:** ~${e.estimatedHours}h` : ''}${e.proofRequired ? ' · **Proof required**' : ''}

## Why this matters
${e.why}

## Open these files
${fileList}

## Do this
${e.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Run this
\`\`\`bash
${e.run.join('\n')}
\`\`\`

## Check yourself
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
✅ Done and checked? Mark the task **Done** in Career Autopilot, commit your work (\`git add . && git commit -m "task ${e.no}: ${e.title.toLowerCase()}"\`), and open \`guide/${nextGuideName(e)}\`.
`;
}

const nextGuideName = (e) => `${String(Number(e.no) + 1).padStart(2, '0')}-….md (the next file in this folder)`;

export function guideFileName(entry) { return `guide/${entry.no}-${entry.slug}.md`; }
export function promptFileName(entry) { return `prompts/${entry.no}-${entry.slug}.md`; }

export function startHereMarkdown(plan = {}, guide = null) {
  const p = obj(plan);
  const s = obj(p.projectSummary);
  const g = guide || planGuide(p);
  const total = g.entries.length;
  const phases = [];
  for (const e of g.entries) {
    const last = phases[phases.length - 1];
    if (!last || last.title !== e.phaseTitle) phases.push({ title: e.phaseTitle, from: e.no, to: e.no });
    else last.to = e.no;
  }
  return `# 🚀 Start here — ${s.title || 'your project'}

You are about to build this project **yourself, end to end** — ${total} tasks, one guide file per task, in order. The starter code compiles and runs from minute one; every task replaces a few numbered TODOs with real logic you write and understand.

## Step 1 — pick your lane (all three end at the same running app)

| Lane | Best for | How |
|---|---|---|
| ⚡ **Browser** | Seeing it run in ~2 minutes, no installs | Push this folder to GitHub (Task 02 shows how), then open \`https://stackblitz.com/github/<you>/<repo>\` |
| ☁️ **Codespaces** *(recommended)* | A full VS Code + database in the cloud, one click | On your GitHub repo page: **Code → Codespaces → Create codespace**. Everything in \`.devcontainer/\` sets itself up |
| 💻 **Local** | Your own machine, works offline | Install Node 18+ from nodejs.org, then follow \`SETUP.md\` |

No MongoDB yet? No problem — **the backend boots in memory mode automatically** (data resets on restart). Connecting a real database is its own task later.

## Step 2 — the loop you'll repeat ${total} times

1. Open the next \`guide/NN-….md\` file (start with \`guide/01\`).
2. Read **Why**, open the listed files, do the numbered TODOs.
3. Run it. Then run \`node scripts/check.mjs NN\` until everything passes.
4. Stuck ≥15 minutes? Open the hints one at a time, or copy the **AI pair prompt** into ChatGPT/Claude — it's pre-loaded with your exact task.
5. Commit, mark the task Done in Career Autopilot, move on.

**Done ≠ Verified.** You mark Done; the platform marks Verified from evidence (your repo, tests, deployment) and a short viva. AI may help you build — the viva proves *you* understand it. That's the whole point.

## Your route
${phases.map((ph) => `- **${ph.title}** — tasks ${ph.from}–${ph.to}`).join('\n')}

## When something breaks (it will — that's the job)
- Read the error's **first line** out loud. It usually names the file and line.
- Backend won't start? Another process may hold the port — stop old terminals first.
- \`fetch\` fails in the frontend? Is the backend terminal actually running?
- Still stuck: Hint 3 in the current guide, then the AI pair prompt with your exact error pasted in.

Now open **\`guide/01-….md\`**. Build something real.
`;
}
