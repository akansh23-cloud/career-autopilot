// Project OS — Builder Mode v3: task type classifier.
//
// Maps any builder task to one of a fixed set of task types. The type drives
// which code-level guidance sections the generator produces. Pure + defensive:
// it reads only the task's own fields and never throws.

export const TASK_TYPES = [
  'setup', 'frontend', 'backend_api', 'backend_service', 'database',
  'integration', 'testing', 'deployment', 'devops', 'proof',
  'documentation', 'security',
];

const lc = (s) => String(s == null ? '' : s).toLowerCase();

export function classifyTaskType(task = {}) {
  const t = task || {};
  // 1) Explicit structured hints (attached by the architecture mapper).
  if (t._api) return 'backend_api';
  if (t._entity) return 'database';
  if (t._component) return t._componentBucket === 'frontend' ? 'frontend' : 'backend_service';

  const id = lc(t.id);
  const title = lc(t.title);
  const files = [...(Array.isArray(t.filesToCreate) ? t.filesToCreate : []), ...(Array.isArray(t.filesToEdit) ? t.filesToEdit : [])].map(lc).join(' ');
  const hay = `${title} ${files}`;

  // 2) Deterministic IDs (stable from the generator).
  if (id.startsWith('arch-api-')) return 'backend_api';
  if (id.startsWith('arch-model-')) return 'database';
  if (id.startsWith('arch-deploy-')) return 'deployment';
  if (id.startsWith('arch-comp-')) return /\b(ui|dashboard|screen|page|panel|view|form|chart)\b/.test(title) ? 'frontend' : 'backend_service';
  if (id.startsWith('stage-setup')) return 'setup';
  if (id.startsWith('stage-proof')) return 'proof';
  if (id.startsWith('stage-testing')) return 'testing';
  if (id.startsWith('stage-deploy')) return 'deployment';
  if (id.startsWith('stage-infra')) return 'devops';
  if (id.startsWith('stage-data')) return 'database';
  if (id.startsWith('stage-ml')) return 'backend_service';

  // 3) Content heuristics.
  if (/dockerfile|github actions|\bci\/cd\b|\bci\b|workflow|pipeline|\.github/.test(hay)) return 'devops';
  if (/\bdeploy\b|render|vercel|netlify|railway|fly\.io|heroku/.test(title)) return 'deployment';
  if (/\bmodel\b|schema|\bentity\b|migration/.test(title) || /models?\//.test(files)) return 'database';
  if (/\b(get|post|put|patch|delete)\b\s+\/|\/api\//.test(title) || /routes?\.js|controller\.js/.test(files)) return 'backend_api';
  if (/\b(service|engine|analyzer|parser|detector|processor|scorer|matcher|recommend)\b/.test(title) || /services?\//.test(files)) return 'backend_service';
  if (/\b(ui|dashboard|screen|page|component|panel|form|frontend|widget|chart|cards?)\b/.test(title) || /\.jsx|components?\//.test(files)) return 'frontend';
  if (/\btest|spec|coverage|jest|vitest\b/.test(title)) return 'testing';
  if (/readme|docs?\b|documentation|portfolio/.test(title)) return 'documentation';
  if (/\bauth\b|security|jwt|csrf|rate.?limit|bcrypt|password|secret/.test(title)) return 'security';
  if (/integrat|webhook|third.?party|external api|connect /.test(title)) return 'integration';
  if (/proof|evidence|verify|submission/.test(title)) return 'proof';

  return 'backend_service';
}

export default { TASK_TYPES, classifyTaskType };
