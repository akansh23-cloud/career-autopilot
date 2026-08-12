import { runTailoring } from '../server/services/resumeTailoring/canonicalTailoringService.js';
import { auditFixtureById } from '../test/fixtures/tailoringAuditFixtures.js';
import { fixtureById } from '../test/fixtures/resumeNarrativeFixtures.js';

const cases = [
  ['audit_strong_devops', 'balanced', 'A — Strong DevOps'],
  ['audit_partial_devops', 'balanced', 'B — Partial DevOps'],
  ['audit_fresher', 'fresher', 'C — Fresher'],
  ['marketing_manager', 'balanced', 'D — Non-engineering (Marketing)'],
];
for (const [id, mode, label] of cases) {
  let f;
  try { f = auditFixtureById(id); } catch { f = fixtureById(id); }
  const r = await runTailoring({
    operation: f.jd ? 'job-tailor' : 'enhance',
    doc: f.doc, jobDescription: f.jd || '', job: f.job || {},
    userKey: `ba-${id}`, mode,
  });
  console.log(`\n### ${label}\n`);
  console.log(`SUMMARY BEFORE: ${f.doc.summary || '(none)'}`);
  console.log(`SUMMARY AFTER : ${r.summary?.chosen || '(none)'}`);
  console.log(`\nrewrite: ${r.rewriteStats.usefullyRewritten}/${r.rewriteStats.improvableBullets} improvable · thin-evidence ${r.rewriteStats.insufficientEvidenceBullets} · status ${r.status}`);
  let n = 0;
  for (const b of r.bullets || []) {
    if (b.original.trim() === b.text.trim()) continue;
    n += 1;
    console.log(`\n  BEFORE: ${b.original}`);
    console.log(`  AFTER : ${b.text}`);
  }
  if (!n) console.log('\n  (no bullet rewrites — evidence too thin to strengthen safely)');
}
