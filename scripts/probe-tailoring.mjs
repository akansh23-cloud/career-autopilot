/* Diagnostic probe — prints real BEFORE → AFTER sentences so quality can be
   inspected as prose rather than as a score. Not a test; a microscope. */
import { fixtureById, FIXTURES } from '../test/fixtures/resumeNarrativeFixtures.js';
import { AUDIT_FIXTURES } from '../test/fixtures/tailoringAuditFixtures.js';
import { runTailoring } from '../server/services/resumeTailoring/canonicalTailoringService.js';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['devops_engineer'];
const mode = process.env.MODE || 'balanced';
const depth = process.env.DEPTH || 'standard';

for (const id of ids) {
  const f = AUDIT_FIXTURES.find((x) => x.id === id) || FIXTURES.find((x) => x.id === id);
  if (!f) { console.log(`!! no fixture ${id}`); continue; }

  const res = await runTailoring({
    operation: f.jd ? 'job-tailor' : 'enhance',
    doc: f.doc,
    jobDescription: f.jd || '',
    job: f.job || {},
    userKey: `probe-${id}`,
    mode,
    depth,
    plan: 'premium',
    surface: 'probe',
  });

  console.log(`\n${'='.repeat(78)}\n${id}   mode=${mode} depth=${depth}   ok=${res.ok} status=${res.status}\n${'='.repeat(78)}`);
  console.log(`SUMMARY BEFORE: ${f.doc.summary || '(none)'}`);
  console.log(`SUMMARY AFTER : ${res.summary?.chosen || '(none)'}`);
  console.log(`\nrewriteStats: ${JSON.stringify(res.rewriteStats)}`);
  if (res.requirementGraph) {
    console.log(`requirements: ${JSON.stringify(res.requirementGraph.counts)}`);
    console.log(`forbidden   : ${res.requirementGraph.forbiddenTerms.slice(0, 14).join(', ')}`);
    console.log(`claimable   : ${res.requirementGraph.claimableTerms.slice(0, 14).join(', ')}`);
    for (const g of res.requirementGraph.groups.filter((x) => x.logic === 'OR').slice(0, 4)) {
      console.log(`  OR-group ${g.id}: [${g.members.map((m) => `${m.term}=${m.state}`).join(' | ')}] → ${g.status} via ${g.matchedAlternative}`);
    }
  }
  console.log('\nBULLETS:');
  for (const b of res.bullets || []) {
    const same = b.original.trim() === b.text.trim();
    console.log(`\n  ${same ? '[UNCHANGED]' : '[REWRITTEN]'} safe=${b.safe} strategy=${b.strategy}`);
    console.log(`    BEFORE: ${b.original}`);
    if (!same) console.log(`    AFTER : ${b.text}`);
    if (b.alternatives?.length) {
      for (const a of b.alternatives.slice(0, 2)) console.log(`      alt : ${a.text}`);
    }
  }
}
