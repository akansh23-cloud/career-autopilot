/* ============================================================
   Feature Compiler — deterministic (NO AI).
   ------------------------------------------------------------
   WHY THIS EXISTS
   In v1 an MVP feature ("Send reminder", "Patient list") became a
   task with NO files, NO code, NO checks — literally "this task is
   about your environment or process". Half the roadmap was vapor,
   and that is precisely where students stalled.

   This compiler turns each feature phrase into a concrete,
   buildable contract:
     verb + object  ->  endpoint + service function + screen + test

   Every feature therefore ships:
     - backend/features/<slug>.feature.js   (router, returns 501 until built)
     - frontend/src/views/features/<Comp>.jsx (screen calling that endpoint)
     - backend/tests/acceptance/<NN>-<slug>.test.js (RED until built)

   The 501 -> 200 transition is the red/green loop that makes the
   project buildable: the student always knows exactly what "done"
   means, and a command proves it.
   ============================================================ */
import { arr, str, obj, pascal, camel, slug, did } from './planUtils.js';

/* ---------- verb taxonomy ---------------------------------- */
const KINDS = [
  {
    id: 'auth',
    match: /\b(login|log in|sign ?in|sign ?up|register|authentication|auth)\b/,
    method: 'POST', pathOf: () => '/api/auth/login',
    summary: 'Authenticate a user and start a session.',
    successShape: '{ ok: true, user: { email } }',
  },
  {
    id: 'notify',
    match: /\b(send|notify|remind|alert|sms|whatsapp|email|message|push)\b/,
    method: 'POST', pathOf: (s) => `/api/${s}/send`,
    summary: 'Queue or send a notification and record the attempt.',
    successShape: '{ ok: true, sent: <number> }',
  },
  {
    id: 'upload',
    match: /\b(upload|import|attach|csv|bulk add|scan)\b/,
    method: 'POST', pathOf: (s) => `/api/${s}/import`,
    summary: 'Accept an upload/import payload and create records from it.',
    successShape: '{ ok: true, created: <number> }',
  },
  {
    id: 'export',
    match: /\b(export|download|pdf|invoice generation|receipt|print)\b/,
    method: 'GET', pathOf: (s) => `/api/${s}/export`,
    summary: 'Return the current data set in an exportable shape.',
    successShape: '{ ok: true, rows: [...] }',
  },
  {
    id: 'report',
    match: /\b(report|analytic|insight|summary|stats|statistic|chart|graph|heatmap|dashboard|score|risk|ranking|leaderboard)\b/,
    method: 'GET', pathOf: (s) => `/api/${s}/summary`,
    summary: 'Compute aggregate numbers from the stored records.',
    successShape: '{ ok: true, metrics: { total, byStatus } }',
  },
  {
    id: 'search',
    match: /\b(search|filter|find|lookup|query|browse|sort|match)\b/,
    method: 'GET', pathOf: (s) => `/api/${s}/search`,
    summary: 'Return records matching a query string.',
    successShape: '{ ok: true, items: [...] }',
  },
  {
    id: 'schedule',
    match: /\b(schedule|book|reserve|appointment|slot|assign|allot|plan)\b/,
    method: 'POST', pathOf: (s) => `/api/${s}/schedule`,
    summary: 'Create a scheduled entry with a date and status.',
    successShape: '{ ok: true, item: { ... } }',
  },
  {
    id: 'create',
    match: /\b(add|create|new|register a|entry|record a|log a|capture|submit)\b/,
    method: 'POST', pathOf: (s) => `/api/${s}`,
    summary: 'Create a record from validated input.',
    successShape: '{ item: { ... } }',
  },
  {
    id: 'list',
    match: /\b(list|view|show|display|feed|catalog|directory|table|history|timeline)\b/,
    method: 'GET', pathOf: (s) => `/api/${s}`,
    summary: 'Return the records the signed-in user can see.',
    successShape: '{ items: [...] }',
  },
];

const FALLBACK_KIND = {
  id: 'custom',
  method: 'GET',
  pathOf: (s, fs) => `/api/${s}/${fs}`,
  summary: 'Implement this feature end to end against the primary entity.',
  successShape: '{ ok: true }',
};

/* ---------- helpers ---------------------------------------- */
const compName = (name) => `${pascal(name).slice(0, 32)}Panel`;

/* "Report an issue" is a CREATE action; "Sales report" is analytics. The bare
   word is ambiguous, so resolve the verb-phrase reading first. */
const VERB_PHRASE_CREATE = /^(report|log|record|submit|file|raise|post|request|apply for|start|open)\s+(a|an|the|new)\b/;

function detectKind(name = '') {
  const n = str(name).toLowerCase().trim();
  if (VERB_PHRASE_CREATE.test(n)) return KINDS.find((k) => k.id === 'create') || FALLBACK_KIND;
  for (const k of KINDS) if (k.match.test(n)) return k;
  return FALLBACK_KIND;
}

/** Which domain fields this feature most plausibly touches. */
function relevantFields(entity, featureName) {
  const n = str(featureName).toLowerCase();
  const hits = arr(entity.fields).filter((f) => {
    const label = str(f.label).toLowerCase();
    return n.includes(f.name.toLowerCase()) || (label && n.includes(label));
  });
  if (hits.length) return hits.map((f) => f.name).slice(0, 4);
  return arr(entity.fields).filter((f) => f.required || f.type === 'enum' || f.type === 'date')
    .map((f) => f.name).slice(0, 4);
}

/**
 * compileFeatures(project, domain, stack) -> FeatureSpec[]
 *
 * One spec per MVP feature (deduped, capped at 6 so the roadmap stays
 * finishable). Built-in concerns already covered by CRUD/auth/upload
 * scaffolding are marked `builtin` so the task planner can fold them
 * into the existing task instead of duplicating work.
 */
export function compileFeatures(project = {}, domain = {}, stack = {}) {
  const primary = obj(domain.primary);
  const entitySlugPlural = primary.slugPlural || 'items';
  const raw = arr(obj(project).mvpFeatures).map((x) => str(x).trim()).filter(Boolean);
  const seen = new Set();
  const claimedPaths = new Set();
  const specs = [];

  for (const name of raw) {
    const key = slug(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (specs.length >= 6) break;

    const kind = detectKind(name);
    const featSlug = slug(name).slice(0, 32);
    let path = kind.pathOf(entitySlugPlural, featSlug);
    const isBuiltinCrud = (kind.id === 'list' || kind.id === 'create') && path === `/api/${entitySlugPlural}`;

    /* Two features landing on the same URL meant the second router was dead
       code: Express served the first, so the student's implemented handler
       never ran and its test never went green. Give the loser its own path. */
    if (!isBuiltinCrud) {
      const key = `${kind.method} ${path}`;
      if (claimedPaths.has(key)) path = `/api/${entitySlugPlural}/${featSlug}`;
      claimedPaths.add(`${kind.method} ${path}`);
    }

    specs.push({
      id: did('feat', name),
      name,
      slug: featSlug,
      kind: kind.id,
      builtin: isBuiltinCrud || kind.id === 'auth',
      entity: primary.name,
      method: kind.method,
      path,
      summary: kind.summary,
      successShape: kind.successShape,
      handlerName: camel(`handle ${featSlug}`),
      serviceFile: `backend/features/${featSlug}.feature.js`,
      viewFile: `frontend/src/views/features/${compName(name)}.jsx`,
      componentName: compName(name),
      route: `/${featSlug}`,
      fields: relevantFields(primary, name),
      acceptance: acceptanceFor(kind, name, path, primary),
    });
  }

  return specs;
}

function acceptanceFor(kind, name, path, entity) {
  const base = [
    `\`${kind.method} ${path}\` returns 200 (not 501) with ${kind.successShape}`,
    `The "${name}" screen calls that endpoint and renders the result — no blank screen on error`,
  ];
  switch (kind.id) {
    case 'notify':
      return [...base, 'Each send is recorded so the same record is not spammed twice'];
    case 'report':
      return [...base, `Numbers are computed from real ${entity.camelPlural || 'records'} in the store, not hardcoded`];
    case 'search':
      return [...base, 'An empty query returns everything; a non-matching query returns an empty list (not an error)'];
    case 'schedule':
      return [...base, 'A past date is rejected with 400 and a readable message'];
    case 'upload':
      return [...base, 'Malformed rows are skipped and reported instead of crashing the request'];
    case 'export':
      return [...base, 'The export contains the same number of rows the list screen shows'];
    default:
      return base;
  }
}

/** Features that need their own task (built-ins are folded into CRUD/auth). */
export function standaloneFeatures(specs = []) {
  return arr(specs).filter((s) => !s.builtin);
}
