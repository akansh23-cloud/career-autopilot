/* Codegen — patch planner. Describes WHERE generated starter files would go
   in the user's local project. v1 NEVER writes to any repo automatically —
   the plan is informational; the user copies/downloads files themselves. */
import { arr, obj, str } from '../workspace/planUtils.js';
import { generateForTask } from './codegenEngine.js';

export function planPatch(plan = {}, taskId = '') {
  const { generatedFiles, warnings, task } = generateForTask(plan, taskId);
  const fileTree = arr(obj(plan).fileTree);
  const patchPlan = generatedFiles.map((g) => {
    const entry = fileTree.find((f) => f.path === g.path);
    return {
      action: 'create',
      path: g.path,
      templateKey: g.templateKey,
      reason: str(obj(entry).purpose) || 'Starter file for this task.',
      note: 'Copy into your local project (or extract from the Starter Pack ZIP). Review every TODO before committing.',
    };
  });
  return {
    patchPlan,
    generatedFiles,
    warnings: [...warnings, 'v1 does not write to any repository automatically. A future GitHub connector will open a PR instead — never a direct push.'],
    task: task || null,
  };
}
