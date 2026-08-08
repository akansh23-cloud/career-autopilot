/* ============================================================
   Build Doctor — verifies a generated pack BEFORE it ships.
   ------------------------------------------------------------
   WHY THIS EXISTS
   The engine used to ship whatever it rendered. When a template
   drifted, the student downloaded a pack that could not start, and
   re-downloading produced the identical broken pack. There was no
   layer whose job was "is this thing actually buildable?".

   This is that layer. It is a static analyser over the rendered
   file set — no installs, no network, milliseconds to run — and it
   catches the failures that cost a student their first hour:

     E1  a relative import points at a file that is not in the pack
     E2  a JSON file does not parse
     E3  a template leaked undefined / [object Object] / NaN
     E4  a task references a file the pack does not contain
     E5  a check references a path or test file that does not exist
     E6  the entry point does not exist or does not export the app
     E7  package.json scripts point at scripts that were not shipped
     E8  a guide file references a task number that does not exist

   Errors block the download. Warnings ship with the pack so the
   student sees them instead of hitting them blind.
   ============================================================ */
import { arr, str, obj } from '../workspace/planUtils.js';

/* `undefined` and `NaN` are legitimate JavaScript — `headers: body ? {...} : undefined`
   is correct code, not a leak. Only flag them when they landed INSIDE a string
   literal, which is what a template leak actually looks like:
   `path: 'backend/undefined.js'`, `<h1>undefined</h1>`. */
const PLACEHOLDER_PATTERNS = [
  { re: /['"`][^'"`\n]*\b(undefined|NaN)\b[^'"`\n]*['"`]/, id: 'leaked-value', hint: 'a template interpolated a field the plan never set' },
  { re: /\[object Object\]/, id: 'object-object', hint: 'an object was interpolated where a string was expected' },
  { re: /\$\{[a-zA-Z_.]+\}/, id: 'unrendered-literal', hint: 'a template literal was emitted instead of evaluated' },
];

/* Files where the words above are legitimate content, not a leak. */
const PLACEHOLDER_EXEMPT = [
  /\.md$/, /workspace\/.*\.json$/, /scripts\/check\.mjs$/, /docs\//,
  /schemas\/.*\.schema\.js$/, /lib\/store\.js$/, /lib\/schema\.js$/,
  /tests\//, /components\/.*Form\.jsx$/, /components\/.*Table\.jsx$/,
];

/**
 * runBuildDoctor({ files, plan, root }) -> report
 *
 * `files` is the rendered pack: [{ path, content }] with paths already
 * prefixed by the pack root. `plan` is the workspace plan they came from.
 */
export function runBuildDoctor({ files = [], plan = {}, root = '' } = {}) {
  const errors = [];
  const warnings = [];
  const p = obj(plan);

  const rel = (full) => (root && full.startsWith(`${root}/`) ? full.slice(root.length + 1) : full);
  const byPath = new Map(arr(files).map((f) => [rel(f.path), f]));
  const paths = new Set(byPath.keys());
  const err = (code, message, file = '') => errors.push({ code, message, file });
  const warn = (code, message, file = '') => warnings.push({ code, message, file });

  /* ---- E1: relative imports resolve inside the pack ---- */
  for (const [path, file] of byPath) {
    if (!/\.(js|jsx|mjs)$/.test(path)) continue;
    for (const spec of relativeImports(file.content)) {
      const target = resolveRelative(path, spec);
      if (!target) continue;
      if (!paths.has(target) && !paths.has(`${target}/index.js`)) {
        err('E1_MISSING_IMPORT', `imports "${spec}" which resolves to "${target}" — that file is not in the pack`, path);
      }
    }
  }

  /* ---- E2: every JSON parses ---- */
  for (const [path, file] of byPath) {
    if (!path.endsWith('.json')) continue;
    try { JSON.parse(file.content); }
    catch (e) { err('E2_BAD_JSON', `is not valid JSON (${e.message})`, path); }
  }

  /* ---- E3: no template leakage in shipped code ---- */
  for (const [path, file] of byPath) {
    if (PLACEHOLDER_EXEMPT.some((re) => re.test(path))) continue;
    for (const pat of PLACEHOLDER_PATTERNS) {
      if (pat.re.test(file.content)) {
        warn('W3_PLACEHOLDER', `contains "${pat.id}" — ${pat.hint}`, path);
      }
    }
  }

  /* ---- E4: every task points at files that exist ---- */
  const fileById = new Map(arr(p.fileTree).map((f) => [f.id, f]));
  for (const task of arr(p.tasks)) {
    const linked = arr(task.linkedFiles).map((id) => fileById.get(id)).filter(Boolean);
    for (const f of linked) {
      if (f.starterPackIncluded && !paths.has(f.path)) {
        err('E4_TASK_FILE_MISSING', `task ${task.order} "${task.title}" links "${f.path}" which is not in the pack`);
      }
    }
    if (!linked.length && !isProcessTask(task)) {
      warn('W4_TASK_NO_FILES', `task ${task.order} "${task.title}" has no linked files — a student cannot tell where to start`);
    }
  }

  /* ---- E5: checks reference real paths and real test files ---- */
  const manifestFile = byPath.get('workspace/checks.json');
  if (manifestFile) {
    let manifest = null;
    try { manifest = JSON.parse(manifestFile.content); } catch { /* E2 already reported */ }
    const taskNumbers = new Set(arr(obj(manifest).tasks).map((t) => str(t.no)));
    for (const t of arr(obj(manifest).tasks)) {
      const auto = arr(t.checks).filter((c) => c.kind !== 'manual');
      if (!auto.length && !/github|deploy|readme|screenshot|database/i.test(str(t.title))) {
        warn('W5_TASK_UNCHECKABLE', `task ${t.no} "${t.title}" has no machine-checkable criterion`);
      }
      for (const c of arr(t.checks)) {
        /* node_modules and .env are created by setup, not shipped — expected absent. */
        if (c.kind === 'fileExists' && c.path && !/node_modules|\.env$/.test(c.path) && !paths.has(c.path)) {
          err('E5_CHECK_PATH_MISSING', `check for task ${t.no} points at "${c.path}" which is not in the pack`);
        }
        if ((c.kind === 'todoCleared' || c.kind === 'fileChanged' || c.kind === 'fileContains')
            && c.path && !/\.env$/.test(c.path) && !paths.has(c.path)) {
          err('E5_CHECK_PATH_MISSING', `check for task ${t.no} reads "${c.path}" which is not in the pack`);
        }
      }
    }
    /* ---- E8: guide numbering lines up with the manifest ---- */
    for (const path of paths) {
      const m = path.match(/^guide\/(\d\d)-/);
      /* 00 is the start-here intro, not a task. */
      if (m && m[1] !== '00' && !taskNumbers.has(m[1])) {
        err('E8_GUIDE_ORPHAN', `guide file "${path}" has no matching task in workspace/checks.json`);
      }
    }
  } else {
    warn('W5_NO_MANIFEST', 'workspace/checks.json was not generated — `npm run check` will not work');
  }

  /* ---- E6: the app has an entry point that tests can import ---- */
  const server = byPath.get('backend/server.js');
  if (!server) err('E6_NO_ENTRY', 'backend/server.js is missing — nothing can start');
  else if (!/export default app/.test(server.content)) {
    err('E6_NO_APP_EXPORT', 'backend/server.js does not `export default app` — the test helper cannot boot it', 'backend/server.js');
  }

  /* ---- E7: root scripts point at files that shipped ---- */
  const rootPkg = byPath.get('package.json');
  if (rootPkg) {
    let pkg = null;
    try { pkg = JSON.parse(rootPkg.content); } catch { /* E2 */ }
    for (const [name, cmd] of Object.entries(obj(obj(pkg).scripts))) {
      const m = str(cmd).match(/node\s+(scripts\/[\w.-]+)/);
      if (m && !paths.has(m[1])) {
        err('E7_SCRIPT_MISSING', `root script "${name}" runs "${m[1]}" which is not in the pack`, 'package.json');
      }
    }
  }

  /* ---- E9: no two features may claim the same endpoint ---- */
  const claimed = new Map();
  for (const spec of arr(p.featureSpecs)) {
    if (spec.builtin) continue;
    const key = `${str(spec.method)} ${str(spec.path)}`;
    if (claimed.has(key)) {
      err('E9_DUPLICATE_ENDPOINT', `features "${claimed.get(key)}" and "${spec.name}" both claim ${key} — the second router would be dead code`);
    } else claimed.set(key, spec.name);
  }

  /* ---- E10: a feature path must not be shadowed by the entity :id route ----
     Express matches in registration order, so /api/things/:id will swallow
     /api/things/summary unless the feature router is mounted first. */
  const server2 = byPath.get('backend/server.js');
  if (server2 && arr(p.featureSpecs).some((s) => !s.builtin)) {
    const body = server2.content;
    const firstFeature = body.search(/Feature\)/);
    /* Resolve the entity router's local identifier from its own import line
       rather than guessing it from the entity name — the file is named for the
       PLURAL (issues.routes.js -> issuesRoutes), so guessing `issueRoutes`
       silently matched nothing and this check never fired. */
    const plural = str(obj(obj(p.domain).primary).slugPlural);
    const importLine = plural
      ? body.match(new RegExp(`import\\s+(\\w+)\\s+from\\s+'\\./routes/${plural}\\.routes\\.js'`))
      : null;
    const entityMount = importLine
      ? body.search(new RegExp(`app\\.use\\(${importLine[1]}\\)`))
      : -1;
    if (firstFeature !== -1 && entityMount !== -1 && firstFeature > entityMount) {
      err('E10_ROUTE_SHADOWED', 'feature routers mount after the entity CRUD routes — /:id will swallow every feature sub-path', 'backend/server.js');
    }
  }

  /* ---- Buildability signals worth surfacing even when everything passes ---- */
  const stats = {
    files: paths.size,
    tasks: arr(p.tasks).length,
    tasksWithFiles: arr(p.tasks).filter((t) => arr(t.linkedFiles).length).length,
    acceptanceTests: [...paths].filter((x) => /^backend\/tests\/acceptance\//.test(x)).length,
    featureModules: [...paths].filter((x) => /^backend\/features\//.test(x)).length,
    seededEntities: arr(obj(p.domain).entities).length,
    domainPack: str(obj(p.domain).packId) || 'generic',
  };

  if (stats.tasks && stats.tasksWithFiles / stats.tasks < 0.6) {
    warn('W9_THIN_ROADMAP', `only ${stats.tasksWithFiles} of ${stats.tasks} tasks point at code — the roadmap is thinner than it looks`);
  }
  if (!stats.acceptanceTests && stats.featureModules) {
    warn('W9_NO_ACCEPTANCE', 'feature modules shipped without acceptance tests — nothing proves when they are done');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats,
    summary: errors.length
      ? `${errors.length} blocking problem(s) found in the generated pack.`
      : `Pack verified: ${stats.files} files, ${stats.tasksWithFiles}/${stats.tasks} tasks wired to code, ${stats.acceptanceTests} acceptance test(s).`,
  };
}

/* ---------- helpers ---------- */

function isProcessTask(task) {
  return /github|deploy|readme|screenshot|proof|database/i.test(str(task.title));
}

export function relativeImports(content = '') {
  const out = [];
  const re = /(?:import\s[^'"]*from\s*|import\s*\(\s*|export\s[^'"]*from\s*)['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(String(content)))) out.push(m[1]);
  return out;
}

export function resolveRelative(fromPath, spec) {
  const fromDir = fromPath.split('/').slice(0, -1);
  const parts = String(spec).split('/');
  const stack = [...fromDir];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') { if (!stack.length) return null; stack.pop(); continue; }
    stack.push(part);
  }
  return stack.join('/');
}

/** Render the report as the markdown shipped inside the pack. */
export function buildReportMarkdown(report = {}, projectTitle = '') {
  const r = obj(report);
  const lines = [];
  lines.push(`# Build report — ${projectTitle || 'generated project'}`);
  lines.push('');
  lines.push('Generated automatically when this pack was built. It is the engine checking its own work.');
  lines.push('');
  lines.push(`**${str(r.summary)}**`);
  lines.push('');
  const s = obj(r.stats);
  lines.push('| Signal | Value |');
  lines.push('|---|---|');
  lines.push(`| Files shipped | ${s.files} |`);
  lines.push(`| Tasks wired to real code | ${s.tasksWithFiles} of ${s.tasks} |`);
  lines.push(`| Acceptance tests (red until you build) | ${s.acceptanceTests} |`);
  lines.push(`| Feature modules to implement | ${s.featureModules} |`);
  lines.push(`| Domain model | ${s.domainPack} (${s.seededEntities} seeded entit${s.seededEntities === 1 ? 'y' : 'ies'}) |`);
  lines.push('');
  if (arr(r.warnings).length) {
    lines.push('## Known rough edges');
    lines.push('');
    for (const w of arr(r.warnings)) lines.push(`- ${w.file ? `\`${w.file}\` — ` : ''}${w.message}`);
    lines.push('');
    lines.push('None of these stop you building. They are listed so you are not surprised.');
  } else {
    lines.push('No warnings. Everything referenced by a task, a check or an import is present in this pack.');
  }
  lines.push('');
  return lines.join('\n');
}
