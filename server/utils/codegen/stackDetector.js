/* ============================================================
   Codegen — deterministic stack/feature detector.
   Reads project metadata + Architecture OS spec capabilities and
   resolves the concrete stack the planners/templates target.
   v1 supports a MERN-style starter; anything else degrades to the
   same skeleton with a warning instead of failing.
   ============================================================ */
import { arr, str, obj } from '../workspace/planUtils.js';

const has = (hay, needles) => needles.some((n) => hay.includes(n));

export function detectStack(project = {}, architectureSpec = null) {
  const p = obj(project);
  const stackList = arr(p.techStack).map((t) => str(t).toLowerCase());
  const text = [p.title, p.problemStatement, p.useCase, p.summary, arr(p.mvpFeatures).join(' ')]
    .map((s) => str(s).toLowerCase()).join(' ');
  const caps = arr(obj(architectureSpec).capabilities).map((c) => str(c).toLowerCase());
  const all = stackList.join(' ') + ' ' + caps.join(' ');
  const flags = obj(p.flags);

  const frontend = has(all, ['vue']) ? 'vue' : has(all, ['angular']) ? 'angular' : 'react';
  const backend = has(all, ['fastapi', 'django', 'flask']) ? 'python' : has(all, ['spring']) ? 'java' : 'express';
  const database = has(all, ['postgres', 'mysql', 'sqlite']) ? 'sql' : 'mongodb';

  /* Explicit boolean flags (from the custom-project form) are authoritative;
     keyword hints only fill in when a flag was never set. */
  const flagOr = (key, hint) => (typeof flags[key] === 'boolean' ? flags[key] : hint);
  const features = {
    auth: flagOr('auth', has(all + text, ['auth', 'login', 'oauth', 'session', 'jwt'])),
    upload: flagOr('upload', has(all + text, ['upload', 'file', 's3', 'storage'])),
    ai: flagOr('ai', has(all + text, ['ai', 'ml', 'llm', 'scoring', 'embedding', 'model'])),
    payments: flagOr('payment', has(all + text, ['payment', 'razorpay', 'stripe', 'checkout', 'billing'])),
    admin: flagOr('admin', has(text, ['admin'])),
    recruiter: flagOr('recruiter', has(text, ['recruiter'])),
    queue: has(all + text, ['queue', 'worker', 'kafka', 'bull', 'job processing', 'background']),
    realtime: has(all + text, ['websocket', 'socket.io', 'realtime', 'real-time']),
  };

  const warnings = [];
  if (frontend !== 'react' || backend !== 'express' || database !== 'mongodb') {
    warnings.push(`Starter templates are MERN-first in v1 (detected ${frontend}/${backend}/${database}); generated starter files use React + Express + Mongoose and note where to adapt.`);
  }

  return {
    frontend, backend, database,
    isMern: frontend === 'react' && backend === 'express' && database === 'mongodb',
    cloudProvider: str(p.cloudProvider || p.deploymentPreference || obj(architectureSpec).provider || 'generic').toLowerCase() || 'generic',
    features, warnings,
    techStack: arr(p.techStack).map(str).filter(Boolean),
  };
}
