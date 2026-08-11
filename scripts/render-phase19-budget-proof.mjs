import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { toRegistryCard } from '../web/src/lib/templateOs/adapter.js';
import { normalizeResumeDocument, toRendererStructured } from '../server/utils/resume/resumeDocument.js';
import { rankContentForTarget } from '../server/utils/resume/jobMatchEngineV3.js';
import { planContentBudget } from '../server/utils/resume/contentBudget.js';
import { compileSummary } from '../server/utils/resume/summaryCompiler.js';
import { compileTemplate, adaptTreeToShape, normalizeResumeDensityToTemplateMode } from '../web/src/lib/templateOs/compiler.js';
import { analyzeResumeShape } from '../web/src/lib/templateOs/shape.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';

const outDir = '/mnt/data/templateos_phase19_outputs';
mkdirSync(outDir, { recursive: true });

const skillNames = ['AWS','Azure','Kubernetes','Docker','Terraform','Helm','GitLab CI','Jenkins','ArgoCD','Prometheus','Grafana','Linux','Python','Bash','Go','PostgreSQL','MongoDB','Redis','Kafka','Nginx','Vault','OpenShift','Ansible','CloudFormation'];
const doc = normalizeResumeDocument({
  id:'phase19-proof', title:'Senior DevOps Engineer — Template Budget Proof', targetRole:'Senior DevOps Engineer', density:'compact',
  contact:{name:'Rohan Iyer',title:'Senior DevOps Engineer',email:'rohan.iyer@example.com',phone:'+91 98000 00000',location:'Pune, India',linkedin:'linkedin.com/in/rohaniyer'},
  summary:'Senior DevOps engineer with broad responsibility for platform engineering, cloud infrastructure, CI/CD, release governance, container orchestration, observability, automation, reliability, security, mentoring and production support across complex enterprise environments, with a strong focus on dependable delivery, operational excellence and cross-team engineering collaboration.',
  experience:[
    {id:'xp1',company:'SkyLattice',role:'Senior DevOps Engineer',location:'Pune',startDate:'2023-01',current:true,bullets:[
      {id:'x1',text:'Automated Kubernetes deployment workflows across 12 applications using GitLab CI, Helm and OpenShift, reducing manual release effort by 80%.'},
      {id:'x2',text:'Standardized Terraform modules for AWS infrastructure across development and production environments.'},
      {id:'x3',text:'Instrumented production services with Prometheus and Grafana to improve deployment observability.'},
      {id:'x4',text:'Hardened secrets delivery using Vault-backed runtime configuration across containerized services.'},
      {id:'x5',text:'Guided engineering teams through release readiness and production change reviews.'},
      {id:'x6',text:'Maintained Linux and Kubernetes platform operations for business-critical services.'},
    ]},
    {id:'xp2',company:'CloudMint',role:'DevOps Engineer',location:'Bengaluru',startDate:'2020-01',endDate:'2022-12',bullets:[
      {id:'y1',text:'Built Jenkins pipelines for Dockerized services deployed to Kubernetes.'},
      {id:'y2',text:'Migrated application configuration into reusable Helm charts.'},
      {id:'y3',text:'Supported AWS infrastructure and production release automation.'},
      {id:'y4',text:'Tracked deployment failures and coordinated corrective actions with application teams.'},
      {id:'y5',text:'Documented CI/CD standards and environment promotion procedures.'},
    ]},
  ],
  projects:[
    {id:'p1',name:'Release Intelligence Platform',techStack:'GitLab CI, Kubernetes, OpenShift',link:'github.com/rohan/release-intel',verified:true,bullets:[{id:'p1b1',text:'Built release assurance workflows for Kubernetes deployments.'},{id:'p1b2',text:'Added evidence-based deployment checks and release reporting.'},{id:'p1b3',text:'Integrated environment readiness checks into CI/CD workflows.'}]},
    {id:'p2',name:'Cloud Migration Toolkit',techStack:'AWS, Terraform, Python',link:'github.com/rohan/migration-toolkit',bullets:[{id:'p2b1',text:'Automated infrastructure inventory and migration planning for AWS workloads.'},{id:'p2b2',text:'Generated Terraform migration scaffolding from structured environment inputs.'},{id:'p2b3',text:'Produced migration validation reports for engineering teams.'}]},
    {id:'p3',name:'Observability Sandbox',techStack:'Prometheus, Grafana, Docker',bullets:[{id:'p3b1',text:'Created local observability environments for application teams.'},{id:'p3b2',text:'Documented metrics and dashboard conventions.'}]},
    {id:'p4',name:'Developer Utilities',techStack:'Python, Bash',bullets:[{id:'p4b1',text:'Created command-line utilities for repetitive environment checks.'}]},
  ],
  skills:skillNames.map((name,i)=>({id:`s${i+1}`,name,group:i<6?'Cloud & Infrastructure':i<12?'Delivery & Observability':'Engineering',status:i<8?'VERIFIED':'DECLARED'})),
  certifications:[
    {id:'c1',text:'AWS Certified Solutions Architect – Professional'},
    {id:'c2',text:'Certified Kubernetes Administrator (CKA)'},
    {id:'c3',text:'HashiCorp Certified: Terraform Associate'},
    {id:'c4',text:'Microsoft Azure Administrator Associate'},
    {id:'c5',text:'ITIL Foundation'},
  ],
  achievements:[
    {id:'a1',text:'Reduced manual release effort by 80% across 12 applications.'},
    {id:'a2',text:'Improved deployment consistency across Kubernetes environments.'},
    {id:'a3',text:'Recognized for production release ownership.'},
    {id:'a4',text:'Mentored engineers on CI/CD and deployment practices.'},
    {id:'a5',text:'Contributed to platform engineering standards and runbooks.'},
  ],
  education:[{id:'e1',school:'UPES Dehradun',degree:'B.Tech Computer Science',endDate:'2020'}],
});

const base = structuredClone(TEMPLATE_OS_BUILTINS.find((d)=>d.id==='balanced-two-column'));
const strictDef = {
  ...base,
  id:'phase19-budget-aware-market-pro', name:'Budget-Aware Market Pro', version:1, status:'PUBLISHED',
  supportedRoles:['devops','cloud','platform','sre'],
  contentBudget:{
    summary:{preferredLines:2,maxLines:3},
    currentExperience:{preferredBullets:4,maxBullets:5},
    previousExperience:{preferredBullets:2,maxBullets:3},
    projects:{preferredCount:1,maxCount:2,preferredBullets:2,maxBullets:3},
    skills:{preferredCount:10,maxCount:16},
    certifications:{preferredCount:2,maxCount:4},
    achievements:{preferredCount:2,maxCount:4},
  },
};
const card = toRegistryCard(strictDef, {certified:true,atsLevel:'HIGH'});
const legacyCard = {...card, contentBudget:undefined, definition:{...strictDef,contentBudget:undefined}};
const ranking = rankContentForTarget(doc,{targetRole:'Senior DevOps Engineer',verifiedSkills:['AWS','Kubernetes','Terraform','GitLab CI']});

function buildVariant(templateCard, label) {
  const plan = planContentBudget(doc,ranking,templateCard,{pageTarget:1});
  const summary = compileSummary(doc,{targetRole:'Senior DevOps Engineer',verifiedSkills:['AWS','Kubernetes','Terraform','GitLab CI'],maxChars:plan.summary.maxChars});
  const summaryText = plan.summary.overBudget && summary.ok && summary.candidates[0]?.text ? summary.candidates[0].text : doc.summary;
  const variant = normalizeResumeDocument({...doc,id:`${doc.id}-${label}`,title:label,templateId:templateCard.id,templateVersion:1,summary:summaryText,overrides:plan.overrides});
  const structured = toRendererStructured(variant);
  const compiled = adaptTreeToShape(
    compileTemplate(strictDef,{density:normalizeResumeDensityToTemplateMode(variant.density)}),
    analyzeResumeShape(structured,{targetRole:'Senior DevOps Engineer',atsPriority:'high'}),
  );
  const pdf = renderTemplatePdf(compiled,structured,{sizeId:'a4'});
  const bytes = Buffer.from(pdf.bytes);
  const path=`${outDir}/${label}.pdf`;
  writeFileSync(path,bytes);
  const counts={
    projects:structured.projects.length,
    skills:Object.values(structured.skills).flat().length,
    certifications:structured.certifications.length,
    achievements:structured.achievements.length,
    currentRoleBullets:structured.experience[0]?.bullets.length||0,
    previousRoleBullets:structured.experience[1]?.bullets.length||0,
    summaryChars:structured.summary.length,
  };
  return {plan,counts,pageCount:pdf.pageCount,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),path};
}

const generic=buildVariant(legacyCard,'generic-category-budget');
const contract=buildVariant(card,'template-contract-budget');
writeFileSync(`${outDir}/phase19-budget-proof.json`,JSON.stringify({
  template:{id:card.id,name:card.name,contentBudget:card.contentBudget},
  genericFallback:{source:generic.plan.source,summary:generic.plan.summary,counts:generic.counts,pageCount:generic.pageCount,decisions:generic.plan.decisions.length},
  templateContract:{source:contract.plan.source,summary:contract.plan.summary,counts:contract.counts,pageCount:contract.pageCount,decisions:contract.plan.decisions.length},
  vocabulary:{selectionVersion:ranking.version,topCertification:ranking.certifications[0],topAchievement:ranking.achievements[0]},
  pdfsDiffer:generic.sha256!==contract.sha256,
},null,2));
console.log('Phase 19 proof generated', {generic:generic.counts, contract:contract.counts, pages:[generic.pageCount,contract.pageCount]});
