import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';
import { compileTemplate, adaptTreeToShape, balancePageComposition, PAGE_COMPOSITION_VERSION, LAYOUT_COMPILER_VERSION } from '../web/src/lib/templateOs/compiler.js';
import { analyzeResumeShape, RESUME_SHAPE_VERSION } from '../web/src/lib/templateOs/shape.js';
import { renderTemplatePdf, PDF_WRITER_VERSION } from '../web/src/lib/templateOs/pdfWriter.js';
import { normalizeCareerStage, careerStageLabel, CAREER_STAGE_VERSION } from '../server/utils/resume/careerStage.js';
import { resolveDictionary } from '../server/utils/resume/roleDictionaries.js';
import { verbAlternatives } from '../server/utils/resume/grammarLibrary.js';
import { compileSummary, SUMMARY_COMPILER_VERSION } from '../server/utils/resume/summaryCompiler.js';

const outDir = '/mnt/data/templateos_phase20_outputs';
mkdirSync(outDir, { recursive: true });

const cases = [
  { key:'student-project', fixture:'student-project-heavy', template:'campus-portfolio', targetRole:'Graduate Software Engineer' },
  { key:'mid-balanced', fixture:'mid-developer', template:'balanced-two-column', targetRole:'Software Engineer' },
  { key:'mid-editorial', fixture:'devops-cloud', template:'editorial-professional', targetRole:'DevOps Engineer' },
];

function savePdf(path, pdf) {
  const bytes = Buffer.from(pdf.bytes);
  writeFileSync(path, bytes);
  return { bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex'), pageCount:pdf.pageCount, usage:pdf.geometry.pageUsage };
}

const renders=[];
for (const item of cases) {
  const structured = structuredClone(getResumeFixture(item.fixture).data);
  const def = TEMPLATE_OS_BUILTINS.find((d)=>d.id===item.template);
  const shape = analyzeResumeShape(structured,{targetRole:item.targetRole,atsPriority:'high'});
  const compiled = adaptTreeToShape(compileTemplate(def),shape);
  const before = renderTemplatePdf(compiled,structured,{sizeId:'a4'});
  const composed = balancePageComposition(compiled,structured,{sizeId:'a4'});
  const after = renderTemplatePdf(composed,structured,{sizeId:'a4'});
  const beforePath=`${outDir}/${item.key}-before.pdf`;
  const afterPath=`${outDir}/${item.key}-after.pdf`;
  const beforeMeta=savePdf(beforePath,before);
  const afterMeta=savePdf(afterPath,after);
  renders.push({
    ...item, stage:shape.careerStage, stageLabel:careerStageLabel(shape.careerStage),
    composition:composed.composition,
    before:{path:beforePath,...beforeMeta}, after:{path:afterPath,...afterMeta},
    bottomWhitespaceReductionPt:Number(((before.geometry.pageUsage[0]?.bottomWhitespacePt||0)-(after.geometry.pageUsage[0]?.bottomWhitespacePt||0)).toFixed(2)),
  });
}

const executiveStructured=structuredClone(getResumeFixture('senior-long').data);
const executiveDef=TEMPLATE_OS_BUILTINS.find((d)=>d.id==='executive-technology');
const executiveShape=analyzeResumeShape(executiveStructured,{targetRole:'Director of Engineering',atsPriority:'high'});
const executiveCompiled=adaptTreeToShape(compileTemplate(executiveDef),executiveShape);
const executiveComposed=balancePageComposition(executiveCompiled,executiveStructured,{sizeId:'a4'});
const executiveBeforePdf=renderTemplatePdf(executiveComposed,executiveStructured,{sizeId:'a4',rebalanceOrphans:false});
const executivePdf=renderTemplatePdf(executiveComposed,executiveStructured,{sizeId:'a4',rebalanceOrphans:true});
const executiveBeforeMeta=savePdf(`${outDir}/executive-orphan-before.pdf`,executiveBeforePdf);
const executiveMeta=savePdf(`${outDir}/executive-technology-stage-proof.pdf`,executivePdf);

const summaryDoc={
  id:'phase20-summary',targetRole:'Senior DevOps Engineer',contact:{name:'Asha Rao',title:'Senior DevOps Engineer',email:'asha@example.com'},
  experience:[{id:'e1',enabled:true,company:'Acme',role:'Senior DevOps Engineer',startDate:'2019-01',current:true,bullets:[{id:'b1',enabled:true,text:'Automated Kubernetes delivery using Terraform and AWS, reducing deployment time by 40%.'}]}],
  skills:[{id:'s1',enabled:true,name:'Kubernetes'},{id:'s2',enabled:true,name:'AWS'},{id:'s3',enabled:true,name:'Terraform'}],projects:[],education:[],certifications:[],achievements:[],
};
const summary=compileSummary(summaryDoc,{targetRole:'Senior DevOps Engineer'});

const proof={
  phase:20,
  engines:{careerStage:CAREER_STAGE_VERSION,resumeShape:RESUME_SHAPE_VERSION,pageComposition:PAGE_COMPOSITION_VERSION,layoutCompiler:LAYOUT_COMPILER_VERSION,pdfWriter:PDF_WRITER_VERSION,summaryCompiler:SUMMARY_COMPILER_VERSION},
  canonicalCareerStageAliases:{fresher:normalizeCareerStage('fresher'),professional:normalizeCareerStage('professional'),principal:normalizeCareerStage('principal'),director:normalizeCareerStage('director')},
  roleOntologyProof:{input:'Senior DevOps Engineer',resolvedFamily:resolveDictionary('Senior DevOps Engineer').name},
  vocabulary:{lead:verbAlternatives('lead',12),analyze:verbAlternatives('analyze',12),secure:verbAlternatives('secure',12),summaryCandidates:summary.candidates},
  renders,
  executive:{stage:executiveShape.careerStage,composition:executiveComposed.composition,before:{path:`${outDir}/executive-orphan-before.pdf`,...executiveBeforeMeta},after:{path:`${outDir}/executive-technology-stage-proof.pdf`,...executiveMeta},orphanRebalance:executivePdf.geometry.orphanRebalance},
};
writeFileSync(`${outDir}/phase20-proof.json`,JSON.stringify(proof,null,2));
console.log(JSON.stringify({engines:proof.engines,renders:renders.map(r=>({key:r.key,stage:r.stage,pages:[r.before.pageCount,r.after.pageCount],whiteBefore:r.before.usage[0]?.bottomWhitespacePt,whiteAfter:r.after.usage[0]?.bottomWhitespacePt,reduction:r.bottomWhitespaceReductionPt,amount:r.composition?.amount})),executive:{stage:executiveShape.careerStage,pages:executivePdf.pageCount,compositionApplied:executiveComposed.composition?.applied,orphanRebalance:executivePdf.geometry.orphanRebalance}},null,2));
