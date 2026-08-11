import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCareerStage, normalizeCareerStages, detectCareerStage, careerStageDistance, CAREER_STAGE_VERSION } from '../server/utils/resume/careerStage.js';
import { rankTemplates, TEMPLATE_RECOMMENDER_VERSION } from '../server/utils/resume/templateRecommender.js';
import { verbAlternatives } from '../server/utils/resume/grammarLibrary.js';
import { compileSummary, SUMMARY_COMPILER_VERSION } from '../server/utils/resume/summaryCompiler.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';
import { compileTemplate, adaptTreeToShape, balancePageComposition, estimateGeometry, PAGE_COMPOSITION_VERSION, LAYOUT_COMPILER_VERSION } from '../web/src/lib/templateOs/compiler.js';
import { analyzeResumeShape, RESUME_SHAPE_VERSION } from '../web/src/lib/templateOs/shape.js';
import { renderTemplatePdf, PDF_WRITER_VERSION } from '../web/src/lib/templateOs/pdfWriter.js';

const editorial = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional');

function canonicalDoc(overrides = {}) {
  return {
    id: 'stage-doc', title: 'Resume', targetRole: '', density: 'compact',
    contact: { name: 'Asha Rao', title: '', email: 'asha@example.com' },
    summary: '', experience: [], projects: [], skills: [], education: [], certifications: [], achievements: [],
    ...overrides,
  };
}

test('Phase 20 career stage normalizes historical vocabulary into one canonical ladder', () => {
  assert.equal(CAREER_STAGE_VERSION, 'career-stage-v1');
  assert.equal(normalizeCareerStage('fresher'), 'student');
  assert.equal(normalizeCareerStage('professional'), 'mid');
  assert.equal(normalizeCareerStage('Principal Engineer'), 'senior');
  assert.equal(normalizeCareerStage('VP'), 'executive');
  assert.deepEqual(normalizeCareerStages(['graduate', 'professional', 'director', 'mid']), ['student', 'mid', 'executive']);
  assert.equal(careerStageDistance('professional', 'senior'), 1);
});

test('career stage detection uses role intent first and tenure as deterministic fallback', () => {
  assert.equal(detectCareerStage(canonicalDoc({ targetRole: 'Graduate Software Engineer' })), 'student');
  assert.equal(detectCareerStage(canonicalDoc({ targetRole: 'Director of Platform Engineering' })), 'executive');
  assert.equal(detectCareerStage(canonicalDoc({ targetRole: 'Senior DevOps Engineer' })), 'senior');
  assert.equal(detectCareerStage(canonicalDoc({ experience: [{ id:'e1', enabled:true, role:'Engineer', company:'Acme' }, { id:'e2', enabled:true, role:'Engineer', company:'Beta' }] })), 'mid');
});

test('template recommendation scores historical professional metadata as an exact mid-career fit', () => {
  const doc = canonicalDoc({ targetRole: 'Business Analyst', experience:[{id:'e1',enabled:true,role:'Business Analyst',company:'Acme'},{id:'e2',enabled:true,role:'Analyst',company:'Beta'}] });
  const templates = [
    { id:'legacy-prof', name:'Legacy Professional', category:'professional', careerStages:['professional'], supportedRoles:['analyst'], license:{productionEnabled:true} },
    { id:'student-only', name:'Student', category:'student', careerStages:['student'], supportedRoles:[], license:{productionEnabled:true} },
  ];
  const out = rankTemplates(templates, doc, { targetRole:'Business Analyst' });
  assert.equal(TEMPLATE_RECOMMENDER_VERSION, 'template-recommender-v2-career-stage');
  assert.equal(out.stage, 'mid');
  assert.equal(out.best.id, 'legacy-prof');
  assert.ok(out.ranked[0].reasons.some((r) => /designed for mid candidates/.test(r)));
});

test('ResumeShape exposes the canonical career stage for layout adaptation', () => {
  const structured = structuredClone(getResumeFixture('devops-cloud').data);
  const shape = analyzeResumeShape(structured, { targetRole:'DevOps Engineer', atsPriority:'high' });
  assert.equal(RESUME_SHAPE_VERSION, 'resume-shape-v4-full-sections');
  assert.equal(shape.careerStage, 'mid');
});

test('premium page composition fills accidental footer whitespace without shrinking typography or creating a second page', () => {
  const structured = structuredClone(getResumeFixture('devops-cloud').data);
  const compiled = adaptTreeToShape(compileTemplate(editorial), analyzeResumeShape(structured, { targetRole:'DevOps Engineer', atsPriority:'high' }));
  const beforeEstimate = estimateGeometry(compiled, structured, { sizeId:'a4' });
  const beforePdf = renderTemplatePdf(compiled, structured, { sizeId:'a4' });
  const balanced = balancePageComposition(compiled, structured, { sizeId:'a4' });
  const afterPdf = renderTemplatePdf(balanced, structured, { sizeId:'a4' });
  assert.equal(LAYOUT_COMPILER_VERSION, 'layout-compiler-v18-reference-premium-families');
  assert.equal(PAGE_COMPOSITION_VERSION, 'page-composition-v3-intentional-whitespace');
  assert.equal(PDF_WRITER_VERSION, 'template-pdf-writer-v18-owned-pagination-reference-premium-families');
  assert.equal(beforeEstimate.pageCount, 1);
  assert.equal(balanced.composition.applied, true);
  assert.equal(afterPdf.pageCount, 1);
  assert.ok(balanced.tokens.typography.bodyFontPx >= compiled.tokens.typography.bodyFontPx);
  assert.ok(balanced.tokens.typography.lineHeight >= compiled.tokens.typography.lineHeight);
  assert.ok(balanced.tokens.spacing.sectionGapPx > compiled.tokens.spacing.sectionGapPx);
  const beforeWhite = beforePdf.geometry.pageUsage[0].bottomWhitespacePt;
  const afterWhite = afterPdf.geometry.pageUsage[0].bottomWhitespacePt;
  assert.ok(afterWhite < beforeWhite - 30, `${beforeWhite} -> ${afterWhite}`);
  assert.ok(afterPdf.geometry.pageUsage[0].utilization <= 0.98);
});

test('composition pass leaves already dense or multi-page content alone rather than compressing it', () => {
  const structured = structuredClone(getResumeFixture('senior-long').data);
  const compiled = compileTemplate(editorial);
  const initial = estimateGeometry(compiled, structured, { sizeId:'a4' });
  const balanced = balancePageComposition(compiled, structured, { sizeId:'a4' });
  if (initial.pageCount !== 1 || initial.utilization >= 0.84) {
    assert.equal(balanced.composition.applied, false);
  }
  assert.ok(balanced.tokens.typography.bodyFontPx >= compiled.tokens.typography.bodyFontPx);
});

test('PDF writer reports exact per-page usage telemetry for composition verification', () => {
  const structured = structuredClone(getResumeFixture('mid-developer').data);
  const pdf = renderTemplatePdf(compileTemplate(editorial), structured, { sizeId:'a4' });
  assert.ok(pdf.geometry.pageUsage.length >= 1);
  for (const page of pdf.geometry.pageUsage) {
    assert.ok(page.bottomWhitespacePt >= 0);
    assert.ok(page.utilization >= 0 && page.utilization <= 1);
  }
});


test('owned PDF pagination rebalances an orphan second page by moving a whole late section', () => {
  const structured = structuredClone(getResumeFixture('senior-long').data);
  const executive = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'executive-technology');
  const compiled = adaptTreeToShape(compileTemplate(executive), analyzeResumeShape(structured, { targetRole:'Director of Engineering', atsPriority:'high' }));
  const pdf = renderTemplatePdf(balancePageComposition(compiled, structured, { sizeId:'a4' }), structured, { sizeId:'a4' });
  assert.equal(pdf.pageCount, 2);
  assert.equal(pdf.geometry.orphanRebalance?.applied, true);
  assert.equal(pdf.geometry.orphanRebalance?.sectionKey, 'skills');
  assert.ok(pdf.geometry.orphanRebalance.before[1] < 0.30);
  assert.ok(pdf.geometry.pageUsage[1].utilization >= 0.32);
});

test('Phase 20 deterministic vocabulary adds stronger same-meaning choices and stage-aware summary families', () => {
  const lead = verbAlternatives('lead', 20);
  const analyze = verbAlternatives('analyze', 20);
  const secure = verbAlternatives('secure', 20);
  assert.ok(lead.includes('spearhead') && lead.includes('champion'));
  assert.ok(analyze.includes('examine') && analyze.includes('quantify'));
  assert.ok(secure.includes('safeguard') && secure.includes('fortify'));
  const doc = canonicalDoc({
    targetRole:'Senior DevOps Engineer',
    contact:{name:'Asha Rao',title:'Senior DevOps Engineer',email:'asha@example.com'},
    experience:[{id:'e1',enabled:true,company:'Acme',role:'Senior DevOps Engineer',startDate:'2014-01',current:true,bullets:[{id:'b1',enabled:true,text:'Led Kubernetes platform modernization across 20 services, reducing deployment time by 40%.'}]}],
    skills:[{id:'s1',enabled:true,name:'Kubernetes',status:'VERIFIED'},{id:'s2',enabled:true,name:'AWS',status:'VERIFIED'}],
  });
  const out = compileSummary(doc, { targetRole:'Senior DevOps Engineer', verifiedSkills:['Kubernetes','AWS'] });
  assert.equal(SUMMARY_COMPILER_VERSION, 'summary-compiler-v4-career-stage-vocabulary');
  assert.equal(out.facts.stage, 'senior');
  assert.ok(out.candidates.some((c) => c.patternId === 'leadership-technology'));
});
