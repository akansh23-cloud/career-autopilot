/* ============================================================
   Codegen v2 — BUILDABLE templates. Deterministic, no AI.
   ------------------------------------------------------------
   Design rules every template here obeys:

   1. ONE SCHEMA, MANY CONSUMERS. backend/schemas/<entity>.schema.js
      is the single source of truth. Model, validator, store, seed,
      React form and React table are all generated from it, so the
      student never has to keep six files in sync by hand.

   2. RUNS BEFORE IT IS FINISHED. Every file compiles and boots the
      moment the ZIP is extracted — with seeded demo data — so the
      first run is a working app, not an empty error page.

   3. RED BEFORE GREEN. Unbuilt features answer 501 with the guide
      task number. The matching acceptance test asserts the real
      contract, so it FAILS on day one and PASSES the moment the
      student implements it. That loop is what makes a project
      buildable.

   4. NO HIDDEN MAGIC. Zero extra dependencies beyond express +
      mongoose (backend) and react + vite (frontend). Scripts use
      Node built-ins only.
   ============================================================ */
import { pascal, camel, slug, arr, str, obj } from '../workspace/planUtils.js';

const HDR = (what) => `/* STARTER CODE — generated from your Career Autopilot workspace plan.
 * ${what}
 * Runs as-is. Every TODO(NN-k) below belongs to guide task NN. */\n`;

const j = (v) => JSON.stringify(v, null, 2);
const jl = (v) => JSON.stringify(v);

/* ---------- shared helpers over the domain model ---------- */
const entityOf = (ctx) => obj(ctx.entityDef) || {};
const fieldsOf = (ctx) => arr(entityOf(ctx).fields).filter((f) => f.name !== 'userId');
const primaryOf = (ctx) => obj(obj(ctx.domain).primary);

function mongooseType(f) {
  switch (f.type) {
    case 'number': return 'Number';
    case 'boolean': return 'Boolean';
    case 'date': return 'Date';
    case 'ref': return 'mongoose.Schema.Types.ObjectId';
    default: return 'String';
  }
}

function inputTypeOf(f) {
  switch (f.ui) {
    case 'number': return 'number';
    case 'date': return 'date';
    case 'checkbox': return 'checkbox';
    case 'email': return 'email';
    case 'tel': return 'tel';
    case 'url': return 'url';
    default: return 'text';
  }
}

export const TEMPLATES_V2 = {
  /* ============================================================
     1. THE SCHEMA — single source of truth
     ============================================================ */
  domainSchema: {
    label: 'Domain schema (single source of truth)', language: 'js',
    render: (ctx) => {
      const e = entityOf(ctx);
      /* userId is assigned by the server from the session — never sent by the
         client, so it must not appear in the request schema. Leaving it in
         made every create fail validation with "Owner is required". */
      const fields = arr(e.fields).filter((f) => f.name !== 'userId').map((f) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        ui: f.ui,
        required: !!f.required,
        enumValues: arr(f.enumValues),
        ref: f.ref || null,
        default: f.default,
      }));
      return HDR(`${e.name} schema — model, validator, store, seed data, the React form and the React table all read THIS file.`)
+ `/* Change a field here and every layer picks it up. That is the point:
   one edit, not six. Add your own fields the same way. */

export const ENTITY = ${jl(e.name)};
export const COLLECTION = ${jl(e.camelPlural || 'items')};
export const DISPLAY_FIELD = ${jl(e.displayField || 'title')};

export const FIELDS = ${j(fields)};

/* TODO: add at least one field your problem needs that is not listed above,
   then delete this comment. Give it a name, label, type and ui. The API,
   the validator, the React form and the React table all pick it up with no
   other edit — that is what a single source of truth is for. */

/** Field lookup by name. */
export const fieldByName = Object.fromEntries(FIELDS.map((f) => [f.name, f]));

/** A blank record with every default filled in. */
export function emptyRecord() {
  const out = {};
  for (const f of FIELDS) out[f.name] = f.default ?? (f.type === 'number' ? 0 : f.type === 'boolean' ? false : '');
  return out;
}

/**
 * Validate + coerce an incoming body against FIELDS.
 * Returns { valid, errors: { field: message }, value }.
 * Used by the API before anything is written. Keep it strict —
 * every bug you prevent here is a bug you never debug later.
 */
export function validateRecord(body = {}, { partial = false } = {}) {
  const errors = {};
  const value = {};
  for (const f of FIELDS) {
    const raw = body[f.name];
    const missing = raw === undefined || raw === null || raw === '';
    if (missing) {
      if (f.required && !partial) errors[f.name] = f.label + ' is required';
      if (!partial) value[f.name] = f.default ?? '';
      continue;
    }
    if (f.type === 'number') {
      const n = Number(raw);
      if (Number.isNaN(n)) { errors[f.name] = f.label + ' must be a number'; continue; }
      value[f.name] = n;
    } else if (f.type === 'boolean') {
      value[f.name] = raw === true || raw === 'true' || raw === 1 || raw === '1';
    } else if (f.type === 'enum') {
      if (f.enumValues.length && !f.enumValues.includes(String(raw))) {
        errors[f.name] = f.label + ' must be one of: ' + f.enumValues.join(', ');
        continue;
      }
      value[f.name] = String(raw);
    } else if (f.type === 'email') {
      const s = String(raw).trim();
      if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(s)) { errors[f.name] = f.label + ' must be a valid email'; continue; }
      value[f.name] = s;
    } else {
      value[f.name] = String(raw).trim();
    }
  }
  return { valid: Object.keys(errors).length === 0, errors, value };
}
`;
    },
  },

  /* ============================================================
     2. STORAGE ADAPTER — memory and Mongo behave identically
     ============================================================ */
  storeAdapter: {
    label: 'backend/lib/store.js', language: 'js',
    render: (ctx) => HDR('Storage adapter. Memory mode and MongoDB mode expose the SAME methods, so nothing above this file cares which one is running.')
+ `import mongoose from 'mongoose';

/* In-memory collections. Data lives in RAM and resets on restart —
   perfect for the first run, useless for real users. Task "Connect
   MongoDB" swaps this out by simply setting MONGODB_URI. */
const memory = new Map();
let counter = 0;

export const usingDatabase = () => mongoose.connection && mongoose.connection.readyState === 1;

function bucket(name) {
  if (!memory.has(name)) memory.set(name, []);
  return memory.get(name);
}

/** Build a store for one collection. \`model\` is the Mongoose model (may be null). */
export function makeStore(name, model) {
  return {
    name,

    async list(filter = {}) {
      if (usingDatabase() && model) return (await model.find(filter).sort({ createdAt: -1 }).lean()).map(withId);
      return bucket(name)
        .filter((row) => Object.entries(filter).every(([k, v]) => v === undefined || String(row[k]) === String(v)))
        .slice()
        .reverse();
    },

    async get(id) {
      if (usingDatabase() && model) {
        if (!mongoose.isValidObjectId(id)) return null;   // never throw a CastError at the user
        const doc = await model.findById(id).lean();
        return doc ? withId(doc) : null;
      }
      return bucket(name).find((row) => row.id === String(id)) || null;
    },

    async create(data) {
      const now = new Date().toISOString();
      if (usingDatabase() && model) return withId((await model.create(data)).toObject());
      counter += 1;
      const row = { id: 'mem_' + counter, ...data, createdAt: now, updatedAt: now };
      bucket(name).push(row);
      return row;
    },

    async update(id, patch) {
      if (usingDatabase() && model) {
        if (!mongoose.isValidObjectId(id)) return null;
        const doc = await model.findByIdAndUpdate(id, patch, { new: true }).lean();
        return doc ? withId(doc) : null;
      }
      const row = bucket(name).find((r) => r.id === String(id));
      if (!row) return null;
      Object.assign(row, patch, { updatedAt: new Date().toISOString() });
      return row;
    },

    async remove(id) {
      if (usingDatabase() && model) {
        if (!mongoose.isValidObjectId(id)) return false;
        return Boolean(await model.findByIdAndDelete(id));
      }
      const list = bucket(name);
      const i = list.findIndex((r) => r.id === String(id));
      if (i === -1) return false;
      list.splice(i, 1);
      return true;
    },

    async count(filter = {}) { return (await this.list(filter)).length; },

    /** Replace everything — used by the seeder. */
    async replaceAll(rows) {
      if (usingDatabase() && model) {
        await model.deleteMany({});
        const docs = await model.insertMany(rows);
        return docs.length;
      }
      memory.set(name, []);
      for (const r of rows) await this.create(r);
      return rows.length;
    },

    async isEmpty() { return (await this.count()) === 0; },
  };
}

/* Mongo returns _id; the rest of the app only ever reads .id. */
function withId(doc) {
  const { _id, __v, ...rest } = doc;
  return { id: String(_id), ...rest };
}
`,
  },

  /* ============================================================
     3. MODEL — generated FROM the schema
     ============================================================ */
  domainModel: {
    label: 'Mongoose model (from schema)', language: 'js',
    render: (ctx) => {
      const e = entityOf(ctx);
      const lines = arr(e.fields).map((f) => {
        const bits = [`type: ${mongooseType(f)}`];
        if (f.required) bits.push('required: true');
        if (f.type === 'enum' && arr(f.enumValues).length) bits.push(`enum: ${jl(f.enumValues)}`);
        if (f.ref) bits.push(`ref: ${jl(f.ref)}`);
        if (f.index) bits.push('index: true');
        if (f.type === 'string' || f.type === 'email') bits.push('trim: true');
        if (f.default !== undefined && f.default !== '' && f.type !== 'ref') bits.push(`default: ${jl(f.default)}`);
        return `  ${f.name}: { ${bits.join(', ')} },`;
      }).join('\n');
      return HDR(`${e.name} model. Fields mirror schemas/${e.slug}.schema.js — keep them in step.`)
+ `import mongoose from 'mongoose';

const ${e.camel}Schema = new mongoose.Schema({
${lines}
}, { timestamps: true });

/* TODO: add a compound index once you know your hottest query,
   e.g. ${e.camel}Schema.index({ userId: 1, createdAt: -1 }); */

export default mongoose.models.${e.name} || mongoose.model('${e.name}', ${e.camel}Schema);
`;
    },
  },

  /* ============================================================
     4. SERVICE + CONTROLLER + ROUTES (working CRUD, day one)
     ============================================================ */
  domainService: {
    label: 'Entity service', language: 'js',
    render: (ctx) => {
      const e = entityOf(ctx);
      return HDR(`${e.name} business logic. Controllers stay thin; the rules live here.`)
+ `import { makeStore } from '../lib/store.js';
import ${e.name} from '../models/${e.name}.js';
import { validateRecord, COLLECTION } from '../schemas/${e.slug}.schema.js';

const store = makeStore(COLLECTION, ${e.name});

export async function list${e.plural}(query = {}) {
  const filter = {};
  // TODO: scope every query to the signed-in user once auth is wired: filter.userId = query.userId;
  return store.list(filter);
}

export async function get${e.name}(id) {
  return store.get(id);
}

export async function create${e.name}(body) {
  const { valid, errors, value } = validateRecord(body);
  if (!valid) { const err = new Error('Validation failed'); err.status = 400; err.errors = errors; throw err; }
  return store.create(value);
}

export async function update${e.name}(id, body) {
  const { valid, errors, value } = validateRecord(body, { partial: true });
  if (!valid) { const err = new Error('Validation failed'); err.status = 400; err.errors = errors; throw err; }
  return store.update(id, value);
}

export async function delete${e.name}(id) {
  return store.remove(id);
}

${obj(ctx.features).upload ? `
/* Upload. The starter accepts the request and records file metadata; picking
   real storage (disk, S3, Cloudinary) is yours — that decision is the task. */
export async function upload${e.name}(req) {
  const meta = storeUpload(req.file);
  const item = await store.create({ fileName: meta.fileName, fileSize: meta.fileSize });
  return { item, fileMeta: meta };
}

function storeUpload(file) {
  // TODO: write the file somewhere real and return its URL.
  if (!file) return { fileName: '', fileSize: 0, note: 'No file parsed yet — wire multer in the route first.' };
  return { fileName: file.originalname, fileSize: file.size, note: 'Metadata only — the bytes are not stored yet.' };
}
` : ''}${obj(ctx.features).ai ? `
/* Scoring. The BACKEND owns the number, deterministically, so the same input
   always produces the same score. If you add AI later it writes prose only —
   it never changes this number. */
export async function score${e.name}(id, req) {
  const item = await store.get(id);
  if (!item) return null;
  return runScore(item);
}

function runScore(item) {
  // TODO: replace with the real rules for your domain.
  const filled = Object.values(item || {}).filter((v) => v !== '' && v != null).length;
  const score = Math.min(100, filled * 10);
  return { score, breakdown: [{ label: 'Completeness', points: score }] };
}
` : ''}
/** Shared by the feature modules so they never re-open storage themselves. */
export function ${e.camel}Store() { return store; }
`;
    },
  },

  domainController: {
    label: 'Entity controller', language: 'js',
    render: (ctx) => {
      const e = entityOf(ctx);
      return HDR(`${e.name} request handlers — parse the request, call the service, shape the response.`)
+ `import * as service from '../services/${e.camel}Service.js';

export async function list(req, res, next) {
  try { res.json({ items: await service.list${e.plural}(req.query) }); }
  catch (err) { next(err); }
}

export async function getOne(req, res, next) {
  try {
    const item = await service.get${e.name}(req.params.id);
    if (!item) return res.status(404).json({ message: '${e.label} not found' });
    res.json({ item });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try { res.status(201).json({ item: await service.create${e.name}(req.body) }); }
  catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const item = await service.update${e.name}(req.params.id, req.body);
    if (!item) return res.status(404).json({ message: '${e.label} not found' });
    res.json({ item });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const ok = await service.delete${e.name}(req.params.id);
    if (!ok) return res.status(404).json({ message: '${e.label} not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}
${obj(ctx.features).upload ? `
export async function upload(req, res, next) {
  try { res.status(201).json(await service.upload${e.name}(req)); }
  catch (err) { next(err); }
}
` : ''}${obj(ctx.features).ai ? `
export async function score(req, res, next) {
  try {
    const out = await service.score${e.name}(req.params.id, req);
    if (!out) return res.status(404).json({ message: '${e.label} not found' });
    res.json(out);
  } catch (err) { next(err); }
}
` : ''}`;
    },
  },

  domainRoutes: {
    label: 'Entity routes', language: 'js',
    render: (ctx) => {
      const e = entityOf(ctx);
      return HDR(`${e.name} routes. Working CRUD from the first run — extend, don't rewrite.`)
+ `import { Router } from 'express';
import * as controller from '../controllers/${e.camel}Controller.js';

const router = Router();

// TODO: put requireAuth in front of these once the auth task is done.
router.get('/api/${e.slugPlural}', controller.list);
router.post('/api/${e.slugPlural}', controller.create);
router.get('/api/${e.slugPlural}/:id', controller.getOne);
router.patch('/api/${e.slugPlural}/:id', controller.update);
router.delete('/api/${e.slugPlural}/:id', controller.remove);
${obj(ctx.features).upload ? `router.post('/api/${e.slugPlural}/upload', controller.upload);   // storage choice is yours — see the service\n` : ''}${obj(ctx.features).ai ? `router.post('/api/${e.slugPlural}/:id/score', controller.score);   // deterministic scoring lives in the service\n` : ''}
export default router;
`;
    },
  },

  /* ============================================================
     5. SEED DATA — the app is never empty on first run
     ============================================================ */
  seedData: {
    label: 'backend/lib/seedData.js', language: 'js',
    render: (ctx) => {
      const d = obj(ctx.domain);
      const blocks = arr(d.entities).map((e) => `export const ${e.camelPlural}Seed = ${j(arr(e.seed))};`).join('\n\n');
      const map = arr(d.entities).map((e) => `  ${jl(e.camelPlural)}: ${e.camelPlural}Seed,`).join('\n');
      return HDR('Realistic demo rows so your first run shows a working app instead of an empty page. Delete or replace them once you have real data.')
+ `${blocks}

export const SEEDS = {
${map}
};
`;
    },
  },

  seedScript: {
    label: 'backend/scripts/seed.js', language: 'js',
    render: (ctx) => {
      const d = obj(ctx.domain);
      const primary = obj(d.primary);
      const imports = arr(d.entities).map((e) => `import ${e.name} from '../models/${e.name}.js';`).join('\n');
      const seeds = arr(d.entities).map((e) =>
        `  {
    name: ${jl(e.name)},
    collection: ${jl(e.camelPlural)},
    model: ${e.name},
    rows: SEEDS[${jl(e.camelPlural)}] || [],
  },`).join('\n');
      return HDR('Seeder. Fills the database with the demo rows in lib/seedData.js. Safe to run repeatedly.')
+ `import mongoose from 'mongoose';
import { MONGODB_URI } from '../config/env.js';
import { makeStore } from '../lib/store.js';
import { SEEDS } from '../lib/seedData.js';
${imports}

const targets = [
${seeds}
];

async function main() {
  if (!MONGODB_URI) {
    console.log('MEMORY MODE — no MONGODB_URI set.');
    console.log('Demo rows load automatically when the server starts, so there is nothing to seed.');
    console.log('Set MONGODB_URI in backend/.env and run this again to seed a real database.');
    return;
  }
  await mongoose.connect(MONGODB_URI);
  for (const t of targets) {
    const store = makeStore(t.collection, t.model);
    const n = await store.replaceAll(t.rows);
    console.log('seeded ' + n + ' ' + t.name + ' rows');
  }
  await mongoose.disconnect();
  console.log('Done. Start the server and open the dashboard.');
}

main().catch((err) => { console.error('Seed failed:', err.message); process.exit(1); });
`;
    },
  },

  /* ============================================================
     6. FEATURE MODULES — 501 today, 200 when the student builds it
     ============================================================ */
  featureModule: {
    label: 'Feature module', language: 'js',
    render: (ctx) => {
      const f = obj(ctx.feature);
      const e = primaryOf(ctx);
      const isGet = str(f.method).toUpperCase() === 'GET';
      const sketch = featureSketch(f, e);
      return HDR(`Feature: ${f.name}. Wired into the server already — the handler is yours to write.`)
+ `import { Router } from 'express';
import { ${e.camel}Store } from '../services/${e.camel}Service.js';

const router = Router();

/* ${f.summary}
 *
 * Contract this must satisfy (the acceptance test checks exactly this):
 *   ${f.method} ${f.path}  ->  200  ${f.successShape}
 *
 * Right now it answers 501 so you can SEE what is not built yet.
 * Delete the 501 block, implement the handler, and run:
 *   npm run check ${str(ctx.featureTaskNo || '')}
 */
router.${isGet ? 'get' : 'post'}(${jl(f.path)}, async (req, res, next) => {
  try {
    // TODO(${str(ctx.featureTaskNo || 'NN')}-1): implement "${f.name}". Remove the 501 below when you do.
    return res.status(501).json({
      error: 'not_implemented',
      feature: ${jl(f.name)},
      guide: ${jl(`guide/${str(ctx.featureTaskNo || 'NN')}-${f.slug}.md`)},
      hint: ${jl(f.summary)},
    });

${sketch}
  } catch (err) { next(err); }
});

export default router;
`;
    },
  },

  featureView: {
    label: 'Feature screen', language: 'jsx',
    render: (ctx) => {
      const f = obj(ctx.feature);
      const Comp = f.componentName || 'FeaturePanel';
      const isGet = str(f.method).toUpperCase() === 'GET';
      return HDR(`Feature screen: ${f.name}`)
+ `import { useState } from 'react';
import { api } from '../../lib/api.js';

export default function ${Comp}() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true); setError(''); setResult(null);
    try {
      const data = await api.${isGet ? 'get' : 'post'}(${jl(f.path)}${isGet ? '' : ', {}'});
      setResult(data);
    } catch (err) {
      // A 501 here is EXPECTED until you implement the backend handler.
      setError(err.status === 501
        ? 'Not built yet — implement ${f.method} ${f.path} (see the guide file for this task).'
        : (err.message || 'Request failed'));
    } finally { setBusy(false); }
  }

  return (
    <section className="panel">
      <h1>${f.name}</h1>
      <p className="muted">${f.summary}</p>
      <button onClick={run} disabled={busy}>{busy ? 'Working…' : 'Run ${f.name}'}</button>
      {error && <p className="error">{error}</p>}
      {result && <pre className="result">{JSON.stringify(result, null, 2)}</pre>}
      {/* TODO(${str(ctx.featureTaskNo || 'NN')}-2): replace this raw JSON dump with the real UI for "${f.name}". */}
    </section>
  );
}
`;
    },
  },

  /* ============================================================
     7. ACCEPTANCE TESTS — red until built, green after
     ============================================================ */
  testHelper: {
    label: 'backend/tests/helpers/server.js', language: 'js',
    render: () => HDR('Test helper: boots the real Express app on a free port and hands back a fetch helper. No extra dependencies.')
+ `import app from '../../server.js';

let server;
let base = '';

export async function startTestServer() {
  if (base) return base;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = 'http://127.0.0.1:' + server.address().port;
  return base;
}

export async function stopTestServer() {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null; base = '';
}

/** call('GET', '/api/health') -> { status, body } */
export async function call(method, path, body) {
  const url = (await startTestServer()) + path;
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}
`,
  },

  smokeTest: {
    label: 'backend/tests/smoke.test.js', language: 'js',
    render: (ctx) => {
      const e = primaryOf(ctx);
      const required = arr(e.fields).filter((f) => f.required && f.name !== 'userId');
      const payload = {};
      for (const f of required) payload[f.name] = f.type === 'number' ? 1 : f.type === 'boolean' ? true : `test-${f.name}`;
      if (!Object.keys(payload).length) payload[e.displayField || 'title'] = 'test';
      return HDR('Smoke tests. These pass from the first run — if they ever fail, something you changed broke the foundation.')
+ `import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, stopTestServer } from './helpers/server.js';

after(async () => { await stopTestServer(); });

test('health endpoint responds ok', async () => {
  const res = await call('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('${e.slugPlural} list returns an array', async () => {
  const res = await call('GET', '/api/${e.slugPlural}');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.items), 'expected { items: [] }');
});

test('creating a ${e.camel} round-trips', async () => {
  const created = await call('POST', '/api/${e.slugPlural}', ${jl(payload)});
  assert.equal(created.status, 201, 'expected 201 Created');
  const id = created.body.item && created.body.item.id;
  assert.ok(id, 'response must include item.id');

  const fetched = await call('GET', '/api/${e.slugPlural}/' + id);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.item.id, id);
});

test('invalid input is rejected with 400, not a crash', async () => {
  const res = await call('POST', '/api/${e.slugPlural}', {});
  assert.ok(res.status === 400 || res.status === 201,
    'empty body must be either accepted or rejected with 400 — never 500');
});

test('unknown id returns 404, not 500', async () => {
  const res = await call('GET', '/api/${e.slugPlural}/does-not-exist');
  assert.equal(res.status, 404);
});
`;
    },
  },

  acceptanceTest: {
    label: 'Acceptance test for one task', language: 'js',
    render: (ctx) => {
      const f = obj(ctx.feature);
      const no = str(ctx.featureTaskNo || 'NN');
      const isGet = str(f.method).toUpperCase() === 'GET';
      const shapeAssert = acceptanceAssert(f);
      return HDR(`Acceptance test for task ${no} — "${f.name}". THIS FAILS UNTIL YOU BUILD IT. That is intentional.`)
+ `import { test, after } from 'node:test';
import assert from 'node:assert/strict';
/* ../helpers — this file lives in tests/acceptance/, one level deeper than
   the smoke tests. Getting this wrong makes every acceptance test die with a
   module-not-found instead of the message you actually need to read. */
import { call, stopTestServer } from '../helpers/server.js';

after(async () => { await stopTestServer(); });

/* Run just this one:
     npm run check ${no}
   Or all of them:
     npm test --prefix backend
   Red now, green when task ${no} is done. */

test('task ${no} — ${f.method} ${f.path} is implemented', async () => {
  const res = await call('${isGet ? 'GET' : 'POST'}', ${jl(f.path)}${isGet ? '' : ', {}'});
  assert.notEqual(res.status, 501,
    'Still returning 501 — open backend/features/${f.slug}.feature.js and implement the handler.');
  assert.equal(res.status, 200, 'expected HTTP 200, got ' + res.status);
});

test('task ${no} — response shape matches the contract ${f.successShape}', async () => {
  const res = await call('${isGet ? 'GET' : 'POST'}', ${jl(f.path)}${isGet ? '' : ', {}'});
  if (res.status === 501) return; // first test already reported this clearly
${shapeAssert}
});
`;
    },
  },

  /* ============================================================
     8. FRONTEND — schema-driven form + table, real dashboard
     ============================================================ */
  entityForm: {
    label: 'Entity form (schema-driven)', language: 'jsx',
    render: (ctx) => {
      const e = primaryOf(ctx);
      return HDR(`${e.name} form. Inputs are generated from the schema, so adding a field to the schema adds it here too.`)
+ `import { useState } from 'react';
import { FIELDS, emptyRecord } from '../lib/schema.js';

export default function ${e.name}Form({ onSubmit, initial }) {
  const [values, setValues] = useState(initial || emptyRecord());
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  function set(name, value) { setValues((v) => ({ ...v, [name]: value })); }

  async function submit(ev) {
    ev.preventDefault();
    setBusy(true); setErrors({});
    try {
      await onSubmit(values);
      setValues(emptyRecord());
    } catch (err) {
      setErrors(err.data?.errors || { _: err.message || 'Could not save' });
    } finally { setBusy(false); }
  }

  return (
    <form className="entity-form" onSubmit={submit}>
      {FIELDS.filter((f) => f.name !== 'userId').map((f) => (
        <label key={f.name} className="field">
          <span>{f.label}{f.required ? ' *' : ''}</span>
          {f.type === 'enum' ? (
            <select value={values[f.name] ?? ''} onChange={(ev) => set(f.name, ev.target.value)}>
              {f.enumValues.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          ) : f.ui === 'textarea' ? (
            <textarea rows={3} value={values[f.name] ?? ''} onChange={(ev) => set(f.name, ev.target.value)} />
          ) : f.ui === 'checkbox' ? (
            <input type="checkbox" checked={!!values[f.name]} onChange={(ev) => set(f.name, ev.target.checked)} />
          ) : (
            <input
              type={f.ui === 'number' ? 'number' : f.ui === 'date' ? 'date' : f.ui}
              value={values[f.name] ?? ''}
              onChange={(ev) => set(f.name, ev.target.value)}
            />
          )}
          {errors[f.name] && <em className="error">{errors[f.name]}</em>}
        </label>
      ))}
      {errors._ && <p className="error">{errors._}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save ${e.label}'}</button>
    </form>
  );
}
`;
    },
  },

  entityTable: {
    label: 'Entity table (schema-driven)', language: 'jsx',
    render: (ctx) => {
      const e = primaryOf(ctx);
      return HDR(`${e.name} table. Columns come from the schema — no column list to maintain by hand.`)
+ `import { FIELDS } from '../lib/schema.js';

const COLUMNS = FIELDS.filter((f) => f.name !== 'userId' && f.ui !== 'textarea').slice(0, 6);

export default function ${e.name}Table({ items, onDelete }) {
  if (!items.length) {
    return <p className="empty">No ${e.camelPlural} yet — add the first one with the form above.</p>;
  }
  return (
    <table className="entity-table">
      <thead>
        <tr>
          {COLUMNS.map((f) => <th key={f.name}>{f.label}</th>)}
          <th aria-label="actions" />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            {COLUMNS.map((f) => (
              <td key={f.name}>{format(item[f.name], f)}</td>
            ))}
            <td>
              <button onClick={() => onDelete(item.id)} className="link-danger">Delete</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function format(value, field) {
  if (value === null || value === undefined || value === '') return '—';
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'date') return String(value).slice(0, 10);
  return String(value);
}
`;
    },
  },

  schemaClient: {
    label: 'frontend/src/lib/schema.js', language: 'js',
    render: (ctx) => {
      const e = primaryOf(ctx);
      const fields = arr(e.fields).map((f) => ({
        name: f.name, label: f.label, type: f.type, ui: f.ui,
        required: !!f.required, enumValues: arr(f.enumValues), default: f.default,
      }));
      return HDR('Frontend copy of the domain schema. Keep it identical to backend/schemas/ — the form and table read this one.')
+ `export const ENTITY = ${jl(e.name)};
export const ENTITY_PLURAL = ${jl(e.plural)};
export const API_PATH = ${jl(`/api/${e.slugPlural}`)};
export const DISPLAY_FIELD = ${jl(e.displayField || 'title')};

export const FIELDS = ${j(fields)};

export function emptyRecord() {
  const out = {};
  for (const f of FIELDS) out[f.name] = f.default ?? (f.type === 'number' ? 0 : f.type === 'boolean' ? false : '');
  return out;
}
`;
    },
  },

  dashboardView: {
    label: 'Dashboard (working CRUD screen)', language: 'jsx',
    render: (ctx) => {
      const e = primaryOf(ctx);
      return HDR(`Dashboard: list + create + delete ${e.camelPlural}. Working end to end on the first run.`)
+ `import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { API_PATH, ENTITY_PLURAL } from '../lib/schema.js';
import ${e.name}Form from '../components/${e.name}Form.jsx';
import ${e.name}Table from '../components/${e.name}Table.jsx';

export default function Dashboard() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  async function load() {
    setStatus('loading');
    try {
      const data = await api.get(API_PATH);
      setItems(data.items || []);
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Could not reach the API');
      setStatus('error');
    }
  }

  useEffect(() => { load(); }, []);

  async function create(values) {
    const data = await api.post(API_PATH, values);
    setItems((prev) => [data.item, ...prev]);
  }

  async function remove(id) {
    await api.del(API_PATH + '/' + id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <section>
      <header className="page-head">
        <h1>{ENTITY_PLURAL}</h1>
        <p className="muted">{items.length} total</p>
      </header>

      {status === 'error' && (
        <p className="error">
          {error} — is the backend running? Try <code>npm run dev</code> from the project root.
        </p>
      )}

      <${e.name}Form onSubmit={create} />

      {status === 'loading' ? <p>Loading…</p> : <${e.name}Table items={items} onDelete={remove} />}

      {/* TODO: add search, filtering and pagination once the list grows. */}
    </section>
  );
}
`;
    },
  },

  appShell: {
    label: 'frontend/src/App.jsx', language: 'jsx',
    render: (ctx) => {
      const feats = arr(ctx.featureSpecs).filter((f) => !f.builtin);
      const imports = feats.map((f) => `import ${f.componentName} from './views/features/${f.componentName}.jsx';`).join('\n');
      const tabs = [`  { id: 'dashboard', label: 'Dashboard', Component: Dashboard },`,
        ...feats.map((f) => `  { id: ${jl(f.slug)}, label: ${jl(f.name)}, Component: ${f.componentName} },`)].join('\n');
      return HDR('App shell with simple tab navigation. Swap in react-router when you need real URLs.')
+ `import { useState } from 'react';
import Dashboard from './views/Dashboard.jsx';
${imports}
import './styles.css';

const TABS = [
${tabs}
];

export default function App() {
  const [active, setActive] = useState(TABS[0].id);
  const Current = (TABS.find((t) => t.id === active) || TABS[0]).Component;

  return (
    <div className="app">
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={t.id === active ? 'tab active' : 'tab'}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="content">
        <Current />
      </main>
    </div>
  );
}
`;
    },
  },

  appStyles: {
    label: 'frontend/src/styles.css', language: 'css',
    render: () => `/* STARTER STYLES — plain CSS, no framework. Make it yours. */
:root { --bg:#0f1115; --panel:#171a21; --line:#272b35; --text:#e7e9ee; --muted:#98a0b3; --accent:#4f8cff; --danger:#ff6b6b; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
.app { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
.tabs { display:flex; gap:8px; flex-wrap:wrap; border-bottom:1px solid var(--line); padding-bottom:12px; margin-bottom:24px; }
.tab { background:transparent; color:var(--muted); border:1px solid transparent; padding:8px 14px; border-radius:8px; cursor:pointer; font:inherit; }
.tab:hover { color:var(--text); }
.tab.active { background:var(--panel); color:var(--text); border-color:var(--line); }
.page-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
h1 { font-size:20px; margin:0 0 4px; }
.muted { color:var(--muted); font-size:13px; }
.entity-form { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; margin:16px 0 24px; }
.field { display:flex; flex-direction:column; gap:6px; font-size:13px; color:var(--muted); }
.field input, .field select, .field textarea { background:#0d0f14; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:9px 10px; font:inherit; }
.field input[type=checkbox] { width:18px; height:18px; }
button { background:var(--accent); color:#fff; border:0; border-radius:8px; padding:10px 16px; font:inherit; cursor:pointer; }
button:disabled { opacity:.6; cursor:default; }
.entity-table { width:100%; border-collapse:collapse; font-size:14px; }
.entity-table th { text-align:left; color:var(--muted); font-weight:500; padding:8px; border-bottom:1px solid var(--line); }
.entity-table td { padding:10px 8px; border-bottom:1px solid var(--line); }
.link-danger { background:transparent; color:var(--danger); padding:2px 6px; }
.error { color:var(--danger); }
.empty { color:var(--muted); padding:24px 0; }
.result { background:#0d0f14; border:1px solid var(--line); border-radius:8px; padding:12px; overflow:auto; font-size:12px; }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:20px; }
code { background:#0d0f14; padding:1px 5px; border-radius:4px; }
`,
  },

  /* ============================================================
     9. SERVER ENTRY — mounts everything, seeds memory, real errors
     ============================================================ */
  serverEntryV2: {
    label: 'backend/server.js', language: 'js',
    render: (ctx) => {
      const e = primaryOf(ctx);
      const d = obj(ctx.domain);
      const feats = arr(ctx.featureSpecs).filter((f) => !f.builtin);
      const featImports = feats.map((f) => `import ${camel(f.slug)}Feature from './features/${f.slug}.feature.js';`).join('\n');
      const featMounts = feats.map((f) => `app.use(${camel(f.slug)}Feature);`).join('\n');
      /* Every planned route file, not a hardcoded list. Admin and recruiter
         routes were being generated and then never mounted — dead files the
         student could not find a use for. */
      const routeFiles = arr(ctx.routeFiles);
      const routeImports = routeFiles.map((r) => `import ${r.importName} from './routes/${r.file}';`).join('\n');
      const routeMounts = routeFiles.map((r) => `app.use(${r.importName});`).join('\n');
      const seedCalls = arr(d.entities).map((en) =>
        `    await seedIfEmpty(${jl(en.camelPlural)}, ${en.name}, SEEDS[${jl(en.camelPlural)}]);`).join('\n');
      const modelImports = arr(d.entities).map((en) => `import ${en.name} from './models/${en.name}.js';`).join('\n');
      return HDR('Express entry. Boots in MEMORY MODE with demo data when no database is configured, so the very first run shows a working app.')
+ `import express from 'express';
import mongoose from 'mongoose';
import { PORT, MONGODB_URI } from './config/env.js';
import { makeStore } from './lib/store.js';
import { SEEDS } from './lib/seedData.js';
${modelImports}
${routeImports}
${featImports}

const app = express();
app.use(express.json({ limit: '2mb' }));

/* ORDER MATTERS. Feature routes mount FIRST, because Express matches in
   registration order and the CRUD route '/api/${e.slugPlural}/:id' would
   otherwise swallow '/api/${e.slugPlural}/summary' — your handler would never
   run and you would debug the wrong file for an hour. */
${featMounts}

${routeMounts}

/* Anything not matched above is a 404 in JSON — never an HTML error page
   that confuses your frontend's .json() call. */
app.use((req, res) => res.status(404).json({ message: 'No route for ' + req.method + ' ' + req.path }));

/* One error handler for the whole app. Services throw, this responds.
   Validation errors carry .status = 400 and .errors. */
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err.message);
  res.status(status).json({ message: err.message || 'Server error', errors: err.errors || undefined });
});

export default app;

async function seedIfEmpty(collection, model, rows) {
  if (!rows || !rows.length) return;
  const store = makeStore(collection, model);
  if (await store.isEmpty()) {
    for (const row of rows) await store.create(row);
    console.log('[seed] loaded ' + rows.length + ' demo ' + collection);
  }
}

async function start() {
  if (MONGODB_URI) {
    try {
      await mongoose.connect(MONGODB_URI);
      console.log('[db] connected to MongoDB');
    } catch (err) {
      console.error('[db] connection failed: ' + err.message);
      console.error('[db] falling back to MEMORY MODE so you can keep building.');
    }
  } else {
    console.log('[db] MEMORY MODE — no MONGODB_URI set. Data resets when you restart.');
  }

  try {
${seedCalls}
  } catch (err) { console.warn('[seed] skipped: ' + err.message); }

  app.listen(PORT, () => {
    console.log('API ready on http://localhost:' + PORT);
    console.log('Try: curl http://localhost:' + PORT + '/api/${e.slugPlural}');
  });
}

if (import.meta.url === 'file://' + process.argv[1]) start();
`;
    },
  },

  /* ============================================================
     10. ONE-COMMAND SCRIPTS — setup, dev, doctor, check
     ============================================================ */
  rootPackageV2: {
    label: 'root package.json', language: 'json',
    render: (ctx) => j({
      name: slug(ctx.projectName || 'my-project'),
      version: '0.1.0',
      private: true,
      type: 'module',
      description: `${str(ctx.projectTitle || 'Project')} — generated by Career Autopilot. Starter skeleton, not a finished product.`,
      engines: { node: '>=18' },
      scripts: {
        setup: 'node scripts/setup.mjs',
        dev: 'node scripts/dev.mjs',
        'dev:api': 'npm run dev --prefix backend',
        'dev:web': 'npm run dev --prefix frontend',
        test: 'npm test --prefix backend',
        check: 'node scripts/check.mjs',
        doctor: 'node scripts/doctor.mjs',
        seed: 'npm run seed --prefix backend',
        build: 'npm run build --prefix frontend',
      },
    }) + '\n',
  },

  setupScript: {
    label: 'scripts/setup.mjs', language: 'js',
    render: () => `#!/usr/bin/env node
/* One command to get from ZIP to running app.
     npm run setup
   Installs both workspaces, creates backend/.env, and tells you what to do next.
   Node built-ins only — nothing to install before you can install. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const step = (m) => console.log('\\n\\u2192 ' + m);
const ok = (m) => console.log('  \\u2705 ' + m);
const warn = (m) => console.log('  \\u26a0\\ufe0f  ' + m);

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error('Node ' + process.versions.node + ' is too old. Install Node 18 or newer from nodejs.org, then run this again.');
  process.exit(1);
}
ok('Node ' + process.versions.node);

for (const workspace of ['backend', 'frontend']) {
  step('Installing ' + workspace + ' dependencies (this takes a minute the first time)');
  try {
    execSync('npm install --no-audit --no-fund', { cwd: path.join(ROOT, workspace), stdio: 'inherit' });
    ok(workspace + ' ready');
  } catch {
    warn(workspace + ' install failed. Check your internet connection, then run: npm install --prefix ' + workspace);
    process.exit(1);
  }
}

step('Creating backend/.env');
const envPath = path.join(ROOT, 'backend', '.env');
if (fs.existsSync(envPath)) {
  ok('.env already exists — leaving it alone');
} else {
  const example = path.join(ROOT, '.env.example');
  fs.writeFileSync(envPath, fs.existsSync(example) ? fs.readFileSync(example, 'utf8') : 'PORT=5050\\nMONGODB_URI=\\n');
  ok('.env created (MONGODB_URI is empty on purpose — memory mode needs no database)');
}

console.log('\\n\\u2705 Setup done.\\n');
console.log('Next:');
console.log('  npm run dev      start the API and the app together');
console.log('  npm test         run the tests (some FAIL on purpose — those are your tasks)');
console.log('  npm run check    see which task checks pass right now');
console.log('\\nThen open guide/00-start-here.md.\\n');
`,
  },

  devScript: {
    label: 'scripts/dev.mjs', language: 'js',
    render: () => `#!/usr/bin/env node
/* Runs the backend and the frontend together with prefixed output.
     npm run dev
   No 'concurrently' dependency — just Node's child_process, so this
   works even if the frontend install failed. Ctrl-C stops both. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

for (const ws of ['backend', 'frontend']) {
  if (!fs.existsSync(path.join(ROOT, ws, 'node_modules'))) {
    console.error('Dependencies missing in ' + ws + '/. Run:  npm run setup');
    process.exit(1);
  }
}

const procs = [];
function run(label, cwd, color) {
  const child = spawn(npm, ['run', 'dev'], { cwd: path.join(ROOT, cwd), shell: process.platform === 'win32' });
  const tag = '\\u001b[' + color + 'm[' + label + ']\\u001b[0m ';
  const pipe = (stream) => stream.on('data', (buf) => {
    for (const line of buf.toString().split('\\n')) if (line.trim()) console.log(tag + line);
  });
  pipe(child.stdout); pipe(child.stderr);
  child.on('exit', (code) => { if (code) console.log(tag + 'exited with code ' + code); });
  procs.push(child);
}

run('api', 'backend', '36');
run('web', 'frontend', '35');

console.log('\\nBoth servers starting. The app URL is printed by [web] in a moment.');
console.log('Stop everything with Ctrl-C.\\n');

const stop = () => { for (const p of procs) p.kill('SIGINT'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
`,
  },

  doctorScript: {
    label: 'scripts/doctor.mjs', language: 'js',
    render: (ctx) => `#!/usr/bin/env node
/* Diagnoses the four things that break a student's first hour.
     npm run doctor
   Every failure prints the exact command that fixes it. */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ok = (m) => console.log('  \\u2705 ' + m);
const bad = (m, fix) => { console.log('  \\u274c ' + m + (fix ? '\\n     fix: ' + fix : '')); return 1; };
let problems = 0;

console.log('\\nChecking your setup\\n');

const [major] = process.versions.node.split('.').map(Number);
if (major >= 18) ok('Node ' + process.versions.node);
else problems += bad('Node ' + process.versions.node + ' is too old', 'install Node 18+ from nodejs.org');

for (const ws of ['backend', 'frontend']) {
  if (fs.existsSync(path.join(ROOT, ws, 'node_modules'))) ok(ws + ' dependencies installed');
  else problems += bad(ws + ' dependencies missing', 'npm run setup');
}

if (fs.existsSync(path.join(ROOT, 'backend', '.env'))) ok('backend/.env exists');
else problems += bad('backend/.env missing', 'npm run setup  (memory mode works with an empty MONGODB_URI)');

const port = Number(process.env.PORT || ${Number(obj(ctx.deploymentPlan).port) || 5050});
const free = await new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.once('listening', () => srv.close(() => resolve(true)));
  srv.listen(port, '127.0.0.1');
});
if (free) ok('port ' + port + ' is free');
else console.log('  \\u2611\\ufe0f  port ' + port + ' is in use — that is fine if your API is already running, otherwise stop the old terminal');

console.log(problems ? '\\n' + problems + ' problem(s) found. Fix them top to bottom, then run this again.\\n'
  : '\\nAll clear. Run:  npm run dev\\n');
process.exit(problems ? 1 : 0);
`,
  },

  /* ============================================================
     11. DOCS the student actually needs
     ============================================================ */
  readmeV2: {
    label: 'README.md', language: 'markdown',
    render: (ctx) => {
      const e = primaryOf(ctx);
      const d = obj(ctx.domain);
      const feats = arr(ctx.featureSpecs);
      const fieldRows = arr(e.fields).map((f) =>
        `| \`${f.name}\` | ${f.type}${arr(f.enumValues).length ? ` (${f.enumValues.join(' \\| ')})` : ''} | ${f.required ? 'yes' : 'no'} | ${f.label} |`).join('\n');
      const featRows = feats.map((f) =>
        `| ${f.name} | \`${f.method} ${f.path}\` | ${f.builtin ? 'built into the CRUD scaffold' : '**you build this** — returns 501 until you do'} |`).join('\n');
      return `# ${str(ctx.projectTitle) || 'My project'}

${str(ctx.shortDescription) || ''}

> Generated by Career Autopilot as a **starter skeleton with a guided build path**.
> It runs immediately. It is not finished — finishing it is the point.

## Run it in three commands

\`\`\`bash
npm run setup     # installs both workspaces, creates backend/.env
npm run dev       # starts the API and the web app together
npm test          # some tests FAIL on purpose — those are your tasks
\`\`\`

No database needed to start: the API boots in **memory mode** with demo data
already loaded, so your first run shows a working app. Connect MongoDB later by
putting a URI in \`backend/.env\`.

Something not working? \`npm run doctor\` names the problem and the fix.

## What you are building

**Domain:** ${str(d.packLabel) || 'web app'} · **Primary entity:** \`${e.name}\`

| Field | Type | Required | Label |
|---|---|---|---|
${fieldRows}

## Features and their contracts

| Feature | Endpoint | Status |
|---|---|---|
${featRows}

A feature returning **501** is not a bug — it is the next thing you build.
Each one has a guide file, a starter module, and an acceptance test that turns
green when you get it right.

## The loop

1. Open the next \`guide/NN-*.md\`.
2. Implement the \`TODO(NN-k)\` markers it points at.
3. \`npm run check NN\` until it passes.
4. Commit. Move on.

## Layout

\`\`\`
backend/
  schemas/      ONE source of truth for fields — model, validator, form and table read it
  models/       Mongoose models
  services/     business logic (the interesting part)
  controllers/  request in, response out
  routes/       URL wiring
  features/     one file per feature you build
  tests/        smoke tests (green) + acceptance tests (red until you build)
frontend/
  src/lib/schema.js   frontend copy of the field definitions
  src/components/     form + table generated from that schema
  src/views/          screens
guide/          your build path, one file per task
scripts/        setup, dev, doctor, check
\`\`\`

## Honest status

Downloading this does not make anything Done or Verified. Verification comes
from your repository, your passing tests, your deployed URL and a short viva
where you explain what you built.
`;
    },
  },

  packageBackendV2: {
    label: 'backend/package.json', language: 'json',
    render: (ctx) => j({
      name: slug(ctx.projectName || 'my-project') + '-backend',
      version: '0.1.0', private: true, type: 'module',
      scripts: {
        dev: 'node --watch server.js',
        start: 'node server.js',
        /* Bare `node --test` walks the whole workspace recursively.
           The old `tests/*.test.js` glob missed tests/acceptance/, so every
           acceptance test silently never ran — the checks looked green while
           nothing was actually proven. */
        test: 'node --test',
        seed: 'node scripts/seed.js',
      },
      dependencies: { dotenv: '^16.4.5', express: '^4.19.2', mongoose: '^8.24.0' },
    }) + '\n',
  },

  envConfigV2: {
    label: 'backend/config/env.js', language: 'js',
    render: (ctx) => HDR('Env loading with safe defaults. Missing values are normal while you build — nothing here blocks startup.')
+ `import dotenv from 'dotenv';
dotenv.config();

export const PORT = Number(process.env.PORT || ${Number(obj(ctx.deploymentPlan).port) || 5050});

/* Empty on purpose: no URI means MEMORY MODE, which is a valid way to run
   this app. Paste an Atlas URI into backend/.env when you want persistence. */
export const MONGODB_URI = process.env.MONGODB_URI || '';

export const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-not-secret';

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/* Only shout about missing config where it actually matters: production. */
export function assertEnv() {
  if (!IS_PRODUCTION) return;
  const missing = [];
  if (!MONGODB_URI) missing.push('MONGODB_URI');
  if (SESSION_SECRET === 'dev-only-not-secret') missing.push('SESSION_SECRET');
  if (missing.length) console.warn('[env] Production is missing: ' + missing.join(', '));
}
`,
  },

  viteConfigV2: {
    label: 'frontend/vite.config.js', language: 'js',
    render: (ctx) => HDR('Vite config. The /api proxy is why the frontend can call /api/... with no CORS setup.')
+ `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.API_ORIGIN || 'http://localhost:${Number(obj(ctx.deploymentPlan).port) || 5050}';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
});
`,
  },

  ciWorkflowV2: {
    label: '.github/workflows/ci.yml', language: 'yaml',
    render: () => `# CI — installs and tests the backend on every push.
# Acceptance tests fail until you build those features, so this workflow is
# RED at first and turns green as you finish tasks. That is the point: your
# repository shows real progress instead of a checkbox.
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      # npm install, not npm ci — a generated starter has no lockfile yet.
      - run: npm install --prefix backend
      - run: npm test --prefix backend
`,
  },

  envExampleV2: {
    label: '.env.example', language: 'bash',
    render: (ctx) => `# Copy to backend/.env (npm run setup does this for you).
# NAMES ONLY — never commit real values.

# Port the API listens on.
PORT=${Number(obj(ctx.deploymentPlan).port) || 5050}

# Leave EMPTY to run in memory mode (no database needed).
# Paste a MongoDB Atlas connection string here when you are ready to persist.
MONGODB_URI=

# Used to sign sessions once you build the auth task.
SESSION_SECRET=

# Frontend dev server proxies /api to this. Change only if you change PORT.
API_ORIGIN=http://localhost:${Number(obj(ctx.deploymentPlan).port) || 5050}
`,
  },
};

/* ---------- feature-specific code sketches ------------------ */
function featureSketch(f, e) {
  const store = `${e.camel}Store()`;
  const pad = '    ';
  const lines = (a) => a.map((l) => (l ? pad + l : '')).join('\n');
  switch (f.kind) {
    case 'report':
      return lines([
        '/* Shape of a working implementation — delete the 501 above and adapt:',
        `const items = await ${store}.list();`,
        'const byStatus = {};',
        "for (const it of items) { const k = it.status || 'unknown'; byStatus[k] = (byStatus[k] || 0) + 1; }",
        'res.json({ ok: true, metrics: { total: items.length, byStatus } }); */',
      ]);
    case 'search':
      return lines([
        '/* Shape of a working implementation:',
        "const q = String(req.query.q || '').toLowerCase();",
        `const items = await ${store}.list();`,
        'const hits = q ? items.filter((it) => JSON.stringify(it).toLowerCase().includes(q)) : items;',
        'res.json({ ok: true, items: hits }); */',
      ]);
    case 'notify':
      return lines([
        '/* Shape of a working implementation:',
        `const due = (await ${store}.list()).filter((it) => needsReminder(it));`,
        'for (const it of due) {',
        '  // real sending goes here (SMS/WhatsApp/email provider)',
        `  await ${store}.update(it.id, { lastNotifiedAt: new Date().toISOString() });`,
        '}',
        'res.json({ ok: true, sent: due.length }); */',
      ]);
    case 'schedule':
      return lines([
        '/* Shape of a working implementation:',
        'const { id, date } = req.body || {};',
        "if (!date) return res.status(400).json({ message: 'date is required' });",
        "if (new Date(date) < new Date()) return res.status(400).json({ message: 'date must be in the future' });",
        `const item = await ${store}.update(id, { scheduledFor: date, status: 'scheduled' });`,
        "if (!item) return res.status(404).json({ message: 'not found' });",
        'res.json({ ok: true, item }); */',
      ]);
    case 'upload':
      return lines([
        '/* Shape of a working implementation:',
        'const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];',
        'let created = 0; const skipped = [];',
        `for (const row of rows) { try { await ${store}.create(row); created++; } catch (e) { skipped.push(e.message); } }`,
        'res.json({ ok: true, created, skipped }); */',
      ]);
    case 'export':
      return lines([
        '/* Shape of a working implementation:',
        `const rows = await ${store}.list();`,
        'res.json({ ok: true, rows }); */',
      ]);
    default:
      return lines([
        '/* Shape of a working implementation:',
        `const items = await ${store}.list();`,
        'res.json({ ok: true, items }); */',
      ]);
  }
}

function acceptanceAssert(f) {
  const pad = '  ';
  switch (f.kind) {
    case 'report':
      return `${pad}assert.equal(res.body.ok, true);\n${pad}assert.ok(res.body.metrics && typeof res.body.metrics.total === 'number', 'expected metrics.total to be a number computed from stored records');`;
    case 'search':
      return `${pad}assert.equal(res.body.ok, true);\n${pad}assert.ok(Array.isArray(res.body.items), 'expected items to be an array');`;
    case 'notify':
      return `${pad}assert.equal(res.body.ok, true);\n${pad}assert.equal(typeof res.body.sent, 'number', 'expected sent to be how many notifications went out');`;
    case 'upload':
      return `${pad}assert.equal(res.body.ok, true);\n${pad}assert.equal(typeof res.body.created, 'number', 'expected created to be how many rows were imported');`;
    case 'export':
      return `${pad}assert.equal(res.body.ok, true);\n${pad}assert.ok(Array.isArray(res.body.rows), 'expected rows to be an array');`;
    case 'schedule':
      return `${pad}assert.ok(res.body.ok === true || res.body.item, 'expected the scheduled item back');`;
    default:
      return `${pad}assert.equal(res.body.ok, true);`;
  }
}
