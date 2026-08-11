#!/usr/bin/env node
/* ============================================================
   node scripts/generate-template-candidates.mjs \
     --role devops --layout sidebar --stage senior \
     --density balanced --ats high --limit 6 [--json out.json]
   Deterministic: same goal → same ranked candidates. No AI.
   ============================================================ */
import { writeFileSync } from 'node:fs';
import { generateTemplateCandidates } from '../web/src/lib/templateOs/synthesis.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));

const goal = {
  targetRoles: String(args.role || 'devops').split(',').map((s) => s.trim()),
  visualStyle: args.style || 'modern technical',
  atsPriority: args.ats || 'high',
  layoutPreference: args.layout || null,
  careerStage: args.stage || 'mid',
  density: args.density || 'balanced',
};

const out = generateTemplateCandidates(goal, { limit: Number(args.limit || 6) });
console.log(`goal: ${JSON.stringify(goal)}`);
console.log(`generated ${out.generated} candidates, kept ${out.kept}\n`);
console.log('SCORE  ATS            INTEG  ORDER  ID');
for (const c of out.candidates) {
  console.log(`${String(c.score).padStart(5)}  ${c.cert.atsLevel.padEnd(13)}  ${String(c.cert.minIntegrity).padStart(5)}  ${String(c.cert.minOrderScore).padStart(5)}  ${c.def.id}`);
}
if (args.json) {
  writeFileSync(String(args.json), JSON.stringify(out.candidates.map((c) => c.def), null, 2));
  console.log(`\nwrote ${out.candidates.length} definitions → ${args.json}`);
}
