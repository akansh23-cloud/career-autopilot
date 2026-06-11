/* ============================================================
   Codegen — deterministic starter templates. NO AI involved.
   Every template renders from plain string interpolation of the
   workspace plan context and is clearly labelled STARTER CODE
   with TODOs where real business logic belongs. Templates never
   pretend complex auth/AI/payment logic is implemented.
   ============================================================ */
import { pascal, camel, slug, arr, str, obj } from '../workspace/planUtils.js';

const HDR = (what) => `/* STARTER CODE — generated from your Career Autopilot workspace plan.
 * ${what}
 * This is a starting skeleton, not verified or completed work. Replace the
 * TODOs with real logic, then commit your own changes on top. */\n`;
const HDRHASH = (what) => `# STARTER FILE — generated from your Career Autopilot workspace plan.\n# ${what}\n# This is a starter skeleton, not a completed project.\n`;

const name = (ctx) => str(ctx.projectName || 'my-project');
const E = (ctx) => pascal(ctx.entity || 'Item');
const e = (ctx) => slug(ctx.entity || 'item');
const c = (ctx) => camel(ctx.entity || 'item');

export const TEMPLATES = {
  /* ---------- React ---------- */
  reactPage: {
    label: 'React page/view', language: 'jsx',
    render: (ctx) => {
      const Comp = pascal(ctx.componentName || ctx.screenName || `${E(ctx)}Page`);
      return HDR(`React page: ${Comp}`) + `import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function ${Comp}() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let live = true;
    api.get('/api/${e(ctx)}s')
      .then((d) => { if (live) { setItems(d.items || []); setStatus('ready'); } })
      .catch(() => { if (live) setStatus('error'); });
    return () => { live = false; };
  }, []);

  if (status === 'loading') return <p>Loading…</p>;
  if (status === 'error') return <p>Could not load data. Is the backend running?</p>;
  return (
    <section>
      <h1>${Comp.replace(/([a-z])([A-Z])/g, '$1 $2')}</h1>
      {/* TODO: replace this list with the real UI for this screen */}
      {items.length === 0 && <p>No ${e(ctx)}s yet — create your first one.</p>}
      <ul>{items.map((it) => <li key={it._id || it.id}>{it.title}</li>)}</ul>
    </section>
  );
}
`;
    },
  },
  reactComponent: {
    label: 'React component', language: 'jsx',
    render: (ctx) => {
      const Comp = pascal(ctx.componentName || 'Widget');
      return HDR(`React component: ${Comp}`) + `export default function ${Comp}({ children, ...props }) {
  /* TODO: implement the real ${Comp} UI and props. */
  return <div data-component="${Comp}" {...props}>{children || '${Comp} (starter)'}</div>;
}
`;
    },
  },
  apiClient: {
    label: 'Frontend API client', language: 'js',
    render: () => HDR('Tiny fetch wrapper — same-origin /api with JSON + error handling.') + `async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || res.statusText), { status: res.status, data });
  return data;
}
export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
  patch: (p, b) => req('PATCH', p, b),
  del: (p) => req('DELETE', p),
};
`,
  },

  /* ---------- Express ---------- */
  expressRoute: {
    label: 'Express route', language: 'js',
    render: (ctx) => {
      if ((ctx.routeKind || '') === 'health') {
        return HDR('Health check route.') + `import { Router } from 'express';
const router = Router();
router.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), db: Boolean(process.env.MONGODB_URI) });
});
export default router;
`;
      }
      return HDR(`${E(ctx)} routes — thin layer over the controller.`) + `import { Router } from 'express';
import * as controller from '../controllers/${c(ctx)}Controller.js';
import { validate${E(ctx)} } from '../validators/${c(ctx)}Validator.js';

const router = Router();
// TODO: add your auth middleware here (e.g. requireAuth) before these handlers.
router.get('/api/${e(ctx)}s', controller.list);
router.post('/api/${e(ctx)}s', validate${E(ctx)}, controller.create);
router.get('/api/${e(ctx)}s/:id', controller.getOne);
router.patch('/api/${e(ctx)}s/:id', controller.update);
router.delete('/api/${e(ctx)}s/:id', controller.remove);
export default router;
`;
    },
  },
  expressController: {
    label: 'Express controller', language: 'js',
    render: (ctx) => HDR(`${E(ctx)} controller — request/response only; logic lives in the service.`) + `import * as service from '../services/${c(ctx)}Service.js';

export async function list(req, res) {
  try { res.json({ items: await service.list${E(ctx)}s(req) }); }
  catch (err) { res.status(500).json({ message: err.message }); }
}
export async function create(req, res) {
  try { res.status(201).json({ item: await service.create${E(ctx)}(req.body, req) }); }
  catch (err) { res.status(400).json({ message: err.message }); }
}
export async function getOne(req, res) {
  try {
    const item = await service.get${E(ctx)}(req.params.id, req);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ item });
  } catch (err) { res.status(400).json({ message: err.message }); }
}
export async function update(req, res) {
  try { res.json({ item: await service.update${E(ctx)}(req.params.id, req.body, req) }); }
  catch (err) { res.status(400).json({ message: err.message }); }
}
export async function remove(req, res) {
  try { await service.delete${E(ctx)}(req.params.id, req); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ message: err.message }); }
}
`,
  },
  expressService: {
    label: 'Express service', language: 'js',
    render: (ctx) => {
      const kind = ctx.serviceKind || 'crud';
      if (kind === 'scoring') {
        return HDR('Deterministic scoring service — the backend owns the numbers. If you add AI later, it may add prose explanations only and must never change the numeric score.') + `export function score${E(ctx)}(record = {}) {
  /* TODO: replace with your real deterministic rules. */
  let score = 40;
  const breakdown = [];
  if (record.title) { score += 20; breakdown.push({ rule: 'has title', points: 20 }); }
  if ((record.description || '').length > 80) { score += 20; breakdown.push({ rule: 'meaningful description', points: 20 }); }
  if (record.fileUrl) { score += 20; breakdown.push({ rule: 'file attached', points: 20 }); }
  return { score: Math.min(100, score), breakdown };
}
`;
      }
      if (kind === 'upload') {
        return HDR('Upload service — TODO: choose disk storage (dev) or S3-compatible storage (prod).') + `import path from 'path';
import fs from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const MAX_BYTES = 5 * 1024 * 1024; // 5MB — adjust deliberately

export async function storeUpload(file) {
  if (!file) throw new Error('No file provided');
  if (file.size > MAX_BYTES) throw new Error('File too large');
  /* TODO: integrate multer (or busboy) in the route, then persist here.
     Never trust the client filename — sanitize before writing. */
  const safeName = String(file.originalname || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
  const dest = path.join(UPLOAD_DIR, Date.now() + '_' + safeName);
  await fs.promises.writeFile(dest, file.buffer);
  return { fileName: safeName, fileUrl: dest, fileSize: file.size };
}
`;
      }
      return HDR(`${E(ctx)} service — all DB access for ${E(ctx)} lives here.`) + `import ${E(ctx)} from '../models/${E(ctx)}.js';

/* TODO: scope every query to the signed-in user once auth is wired
   (e.g. { userId: req.session.userId }). */
export async function list${E(ctx)}s() {
  return ${E(ctx)}.find({}).sort({ createdAt: -1 }).limit(100).lean();
}
export async function create${E(ctx)}(data = {}) {
  return ${E(ctx)}.create({ title: data.title, description: data.description || '', status: data.status || 'draft' });
}
export async function get${E(ctx)}(id) { return ${E(ctx)}.findById(id).lean(); }
export async function update${E(ctx)}(id, patch = {}) {
  return ${E(ctx)}.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
}
export async function delete${E(ctx)}(id) { return ${E(ctx)}.findByIdAndDelete(id); }
`;
    },
  },
  mongooseModel: {
    label: 'Mongoose model', language: 'js',
    render: (ctx) => {
      const fields = arr(ctx.fields);
      const lines = fields.length
        ? fields.map((f) => {
            const t = /objectid/i.test(str(f.type)) ? "{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }"
              : /number/i.test(str(f.type)) ? '{ type: Number }'
              : /date/i.test(str(f.type)) ? '{ type: Date }'
              : /mixed/i.test(str(f.type)) ? '{ type: mongoose.Schema.Types.Mixed }'
              : `{ type: String${f.required ? ', required: true' : ''}, trim: true }`;
            return `    ${camel(f.name)}: ${t},${f.note ? ` // ${f.note}` : ''}`;
          }).join('\n')
        : `    title: { type: String, required: true, trim: true },\n    description: { type: String, default: '' },\n    status: { type: String, default: 'draft' },`;
      const modelName = pascal(ctx.modelName || ctx.entity || 'Item');
      return HDR(`Mongoose model: ${modelName}`) + `import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
${lines}
  },
  { timestamps: true }
);

export default mongoose.models.${modelName} || mongoose.model('${modelName}', schema);
`;
    },
  },
  validatorFile: {
    label: 'Validation file', language: 'js',
    render: (ctx) => HDR(`${E(ctx)} request validation — plain JS so the starter has zero extra deps. TODO: swap in zod/joi when ready.`) + `export function validate${E(ctx)}(req, res, next) {
  const { title } = req.body || {};
  const errors = [];
  if (!title || String(title).trim().length < 2) errors.push('title is required (min 2 chars)');
  if (errors.length) return res.status(400).json({ message: 'Validation failed', errors });
  next();
}
`,
  },
  testFile: {
    label: 'Test file', language: 'js',
    render: (ctx) => {
      if ((ctx.testKind || '') === 'health') {
        return HDR('Health endpoint test — run with `npm test` (node --test).') + `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('health payload shape', () => {
  // TODO: boot the app with supertest or fetch against a running server.
  const payload = { ok: true, uptime: 1 };
  assert.equal(payload.ok, true);
});
`;
      }
      return HDR(`${E(ctx)} service unit test — run with \`npm test\` (node --test).`) + `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('create${E(ctx)} requires a title (placeholder)', () => {
  /* TODO: point this at the real service with a test DB or in-memory mongo.
     This placeholder only proves the test harness runs. */
  const input = { title: '' };
  assert.equal(Boolean(input.title), false);
});
`;
    },
  },

  /* ---------- Config / infra ---------- */
  envExample: {
    label: '.env.example', language: 'bash',
    render: (ctx) => HDRHASH('Copy to .env and fill in real values. NEVER commit .env.') + `PORT=5050
MONGODB_URI=mongodb://localhost:27017/${slug(name(ctx))}
SESSION_SECRET=change-me-to-a-long-random-string
${obj(ctx.features).upload ? 'UPLOAD_DIR=./uploads\n' : ''}${obj(ctx.features).payments ? '# Payment gateway — SANDBOX keys only while building\nPAYMENT_KEY_ID=\nPAYMENT_KEY_SECRET=\n' : ''}${obj(ctx.features).ai ? '# Optional — scoring works deterministically without it\nAI_API_KEY=\n' : ''}`,
  },
  envConfig: {
    label: 'backend/config/env.js', language: 'js',
    render: () => HDR('Env loading + minimal validation.') + `import dotenv from 'dotenv';
dotenv.config();

export const PORT = Number(process.env.PORT || 5050);
export const MONGODB_URI = process.env.MONGODB_URI || '';
export const SESSION_SECRET = process.env.SESSION_SECRET || '';

export function assertEnv() {
  const missing = [];
  if (!MONGODB_URI) missing.push('MONGODB_URI');
  if (!SESSION_SECRET) missing.push('SESSION_SECRET');
  if (missing.length) console.warn('[env] Missing: ' + missing.join(', ') + ' — some features will not work.');
}
`,
  },
  serverEntry: {
    label: 'backend/server.js', language: 'js',
    render: (ctx) => HDR('Express entry point — wire new route files here.') + `import express from 'express';
import mongoose from 'mongoose';
import { PORT, MONGODB_URI, assertEnv } from './config/env.js';
import healthRoutes from './routes/health.routes.js';
import ${c(ctx)}Routes from './routes/${e(ctx)}s.routes.js';

assertEnv();
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(healthRoutes);
app.use(${c(ctx)}Routes);
// TODO: add auth routes/middleware, error handler, CORS if frontend runs on another origin.

async function start() {
  if (MONGODB_URI) {
    try { await mongoose.connect(MONGODB_URI); console.log('[db] connected'); }
    catch (err) { console.error('[db] connection failed:', err.message); }
  } else {
    console.warn('[db] MONGODB_URI not set — API routes that touch the DB will fail.');
  }
  app.listen(PORT, () => console.log('API listening on http://localhost:' + PORT));
}
start();
`,
  },
  viteConfig: {
    label: 'frontend/vite.config.js', language: 'js',
    render: () => HDR('Vite config — proxies /api to the backend during dev.') + `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:5050' } },
});
`,
  },
  indexHtml: {
    label: 'frontend/index.html', language: 'html',
    render: (ctx) => `<!doctype html>
<!-- STARTER FILE — generated skeleton, not a completed project. -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name(ctx)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
  },
  mainJsx: {
    label: 'frontend/src/main.jsx', language: 'jsx',
    render: () => HDR('React entry.') + `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
`,
  },
  appJsx: {
    label: 'frontend/src/App.jsx', language: 'jsx',
    render: (ctx) => {
      const views = arr(ctx.views).length ? ctx.views : [{ name: 'Dashboard', file: 'Dashboard' }];
      const imports = views.map((v) => `import ${pascal(v.file)} from './views/${pascal(v.file)}.jsx';`).join('\n');
      const buttons = views.map((v) => `        <button onClick={() => setView('${pascal(v.file)}')}>${v.name}</button>`).join('\n');
      const cases = views.map((v) => `      {view === '${pascal(v.file)}' && <${pascal(v.file)} />}`).join('\n');
      return HDR('Top-level app — simple state-based view switcher. TODO: swap in a real router when needed.') + `import { useState } from 'react';
${imports}

export default function App() {
  const [view, setView] = useState('${pascal(views[0].file)}');
  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 860, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
${buttons}
      </header>
${cases}
      <footer style={{ marginTop: 40, fontSize: 12, opacity: 0.6 }}>
        Starter skeleton generated by Career Autopilot — not a completed project.
      </footer>
    </main>
  );
}
`;
    },
  },

  /* ---------- package.json / infra ---------- */
  packageRoot: {
    label: 'root package.json', language: 'json',
    render: (ctx) => JSON.stringify({
      name: slug(name(ctx)), version: '0.1.0', private: true, type: 'module',
      description: 'Starter skeleton generated by Career Autopilot — not a completed project.',
      scripts: {
        dev: 'echo "Run frontend and backend in two terminals: npm run dev --prefix frontend / npm run dev --prefix backend"',
        test: 'npm test --prefix backend',
      },
    }, null, 2) + '\n',
  },
  packageFrontend: {
    label: 'frontend/package.json', language: 'json',
    render: (ctx) => JSON.stringify({
      name: slug(name(ctx)) + '-frontend', version: '0.1.0', private: true, type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: { '@vitejs/plugin-react': '^4.3.4', vite: '^6.0.7' },
    }, null, 2) + '\n',
  },
  packageBackend: {
    label: 'backend/package.json', language: 'json',
    render: (ctx) => JSON.stringify({
      name: slug(name(ctx)) + '-backend', version: '0.1.0', private: true, type: 'module',
      scripts: { dev: 'node --watch server.js', start: 'node server.js', test: 'node --test tests/*.test.js' },
      dependencies: { dotenv: '^16.4.5', express: '^4.19.2', mongoose: '^8.24.0' },
    }, null, 2) + '\n',
  },
  dockerCompose: {
    label: 'docker-compose.yml', language: 'yaml',
    render: (ctx) => HDRHASH('Optional: local MongoDB. Run `docker compose up -d` then use mongodb://localhost:27017.') + `services:
  mongo:
    image: mongo:7
    restart: unless-stopped
    ports:
      - "27017:27017"
    volumes:
      - ${slug(name(ctx))}_mongo:/data/db
volumes:
  ${slug(name(ctx))}_mongo:
`,
  },
  dockerfile: {
    label: 'Dockerfile', language: 'docker',
    render: () => HDRHASH('Backend Dockerfile placeholder — adapt before production use.') + `FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
EXPOSE 5050
CMD ["node", "server.js"]
`,
  },
  ghActions: {
    label: 'GitHub Actions workflow', language: 'yaml',
    render: () => HDRHASH('CI placeholder — runs backend tests on push. Extend deliberately.') + `name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci --prefix backend
      - run: npm test --prefix backend
`,
  },

  /* ---------- Docs ---------- */
  readme: {
    label: 'README.md', language: 'markdown',
    render: (ctx) => `# ${str(ctx.projectTitle || name(ctx))}

> **This is a starter skeleton, not a completed project.** It was generated
> deterministically from a Career Autopilot workspace plan. Every file marked
> STARTER CODE contains TODOs you are expected to implement yourself.

${str(ctx.shortDescription || '')}

## What this skeleton includes
- React + Vite frontend (\`frontend/\`)
- Node + Express backend with a health check (\`backend/\`)
- Mongoose model + CRUD routes for the primary entity
- Setup, task and proof checklists (\`SETUP.md\`, \`TASKS.md\`, \`docs/\`)

## Quick start
\`\`\`bash
cp .env.example backend/.env   # fill in values
npm install --prefix backend && npm run dev --prefix backend
npm install --prefix frontend && npm run dev --prefix frontend
\`\`\`
Then open the Vite URL and check \`GET http://localhost:5050/api/health\`.

## Honest status
Generated starter code is **not** verified work. Marking tasks Done in the
workspace is **not** the same as Verified — verification requires evidence
(repo, tests, deployment). See \`docs/proof-requirements.md\`.
`,
  },
  readmeSection: {
    label: 'README section', language: 'markdown',
    render: (ctx) => `## ${str(ctx.sectionTitle || 'Feature')}

> STARTER DOC — describe what you actually built here once it works.

- Purpose: ${str(ctx.purpose || 'TODO')}
- Endpoints: ${arr(ctx.endpoints).join(', ') || 'TODO'}
- How to test: TODO
`,
  },
  setupMd: {
    label: 'SETUP.md', language: 'markdown',
    render: (ctx) => `# Setup — ${str(ctx.projectTitle || name(ctx))}

1. **Prereqs**: Node 18+, npm, and MongoDB (local install or \`docker compose up -d\`).
2. **Env**: \`cp .env.example backend/.env\` and fill in values. Never commit \`.env\`.
3. **Backend**: \`npm install --prefix backend\` then \`npm run dev --prefix backend\` → http://localhost:5050/api/health
4. **Frontend**: \`npm install --prefix frontend\` then \`npm run dev --prefix frontend\` → open the printed URL.
5. **Tests**: \`npm test --prefix backend\`

If the health check returns ok and the Dashboard renders, the skeleton works —
now open \`TASKS.md\` and build the real project.
`,
  },
  tasksMd: {
    label: 'TASKS.md', language: 'markdown',
    render: (ctx) => {
      const tasks = arr(ctx.tasks);
      const byPhase = {};
      for (const t of tasks) (byPhase[t.phase] = byPhase[t.phase] || []).push(t);
      let out = `# Task checklist — exported from your workspace plan\n\nTrack the live board in Career Autopilot → Project Workspace. Done ≠ Verified.\n`;
      for (const [phase, list] of Object.entries(byPhase)) {
        out += `\n## ${phase}\n` + list.map((t) => `- [ ] ${t.title}${t.estimatedHours ? ` (~${t.estimatedHours}h)` : ''}`).join('\n') + '\n';
      }
      return out;
    },
  },
  docArchitecture: {
    label: 'docs/architecture.md', language: 'markdown',
    render: (ctx) => {
      const spec = obj(ctx.architectureSpec);
      const views = arr(spec.views);
      return `# Architecture (from Architecture OS)\n\n${spec.title ? `**${spec.title}**\n\n` : ''}${views.length
        ? 'Views included in `workspace/architecture-spec.json`:\n' + views.map((v) => `- ${v.title || v.type}`).join('\n')
        : '_No Architecture OS spec was attached when this pack was generated. Generate one in the workspace Architecture tab and regenerate the pack._'}\n\nThe architecture **design score** reflects proposed design quality only — it is not implementation proof.\n`;
    },
  },
  docApiPlan: {
    label: 'docs/api-plan.md', language: 'markdown',
    render: (ctx) => `# API plan\n\n| Method | Path | Auth | Purpose |\n|---|---|---|---|\n` +
      arr(ctx.apis).map((a) => `| ${a.method} | \`${a.path}\` | ${a.authRequired ? 'yes' : 'no'} | ${str(a.purpose).replace(/\|/g, '/')} |`).join('\n') + '\n',
  },
  docModels: {
    label: 'docs/database-models.md', language: 'markdown',
    render: (ctx) => arr(ctx.models).map((m) => `## ${m.name} (${m.type})\n\n` +
      arr(m.fields).map((f) => `- \`${f.name}\`: ${f.type}${f.required ? ' (required)' : ''}${f.note ? ` — ${f.note}` : ''}`).join('\n')).join('\n\n') + '\n',
  },
  docDeployment: {
    label: 'docs/deployment-guide.md', language: 'markdown',
    render: (ctx) => {
      const d = obj(ctx.deploymentPlan);
      return `# Deployment guide\n\n- Provider: ${str(d.provider) || 'generic'}\n- Build: \`${str(d.buildCommand)}\`\n- Start: \`${str(d.startCommand)}\`\n- Health check: \`${str(d.healthCheckUrl)}\`\n\n## Required env vars (names only — set real values in the provider dashboard)\n` +
        arr(d.requiredEnvVars).map((v) => `- ${v}`).join('\n') + '\n\n## Steps\n' +
        arr(d.deploySteps).map((s, i) => `${i + 1}. ${s}`).join('\n') + '\n';
    },
  },
  docProof: {
    label: 'docs/proof-requirements.md', language: 'markdown',
    render: (ctx) => `# Proof requirements\n\nRecruiters trust evidence, not claims. Downloading this starter pack proves nothing yet.\n\n` +
      arr(ctx.proofRequirements).map((p) => `- [ ] **${p.title}**${p.required ? ' (required)' : ' (optional)'} — ${p.description}`).join('\n') + '\n',
  },

  /* ---------- Workspace JSON exports ---------- */
  workspaceJson: { label: 'workspace-plan.json', language: 'json', render: (ctx) => JSON.stringify(obj(ctx.workspacePlanExport), null, 2) + '\n' },
  architectureJson: { label: 'architecture-spec.json', language: 'json', render: (ctx) => JSON.stringify(ctx.architectureSpec || { note: 'No architecture spec attached yet.' }, null, 2) + '\n' },
  checklistJson: { label: 'verification-checklist.json', language: 'json', render: (ctx) => JSON.stringify({ note: 'Done is not Verified. Each item lists how it will be verified.', items: arr(ctx.proofRequirements) }, null, 2) + '\n' },
};
