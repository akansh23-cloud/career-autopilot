import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { toRegistryCard } from '../web/src/lib/templateOs/adapter.js';
import { budgetForTemplate, planContentBudget, summaryCapacityForTemplate, CONTENT_BUDGET_VERSION } from '../server/utils/resume/contentBudget.js';
import { normalizeResumeDocument } from '../server/utils/resume/resumeDocument.js';
import { rankContentForTarget, SELECTION_VERSION } from '../server/utils/resume/jobMatchEngineV3.js';
import { compileSummary, SUMMARY_COMPILER_VERSION } from '../server/utils/resume/summaryCompiler.js';
import { compileBullet, COMPILER_VERSION } from '../server/utils/resume/bulletCompiler.js';
import { eligiblePatterns, verbAlternatives, VERB_DICTIONARY } from '../server/utils/resume/grammarLibrary.js';
import { DeterministicWritingProvider, WRITING_PROVIDERS_VERSION } from '../server/utils/resume/writingProviders.js';

function denseDoc() {
  const skills = ['AWS','Azure','Kubernetes','Docker','Terraform','Helm','GitLab CI','Jenkins','ArgoCD','Prometheus','Grafana','Linux','Python','Bash','Go','PostgreSQL','MongoDB','Redis','Kafka','Nginx','Vault','OpenShift','Ansible','CloudFormation'];
  return normalizeResumeDocument({
    id: 'phase19-doc', targetRole: 'Senior DevOps Engineer',
    summary: 'Senior DevOps engineer with broad responsibility for platform engineering, cloud infrastructure, CI/CD, release governance, container orchestration, observability, automation, reliability, security, mentoring and production support across complex enterprise environments, with a strong focus on dependable delivery and operational excellence.',
    experience: [
      { id:'xp1', company:'SkyLattice', role:'Senior DevOps Engineer', startDate:'2023-01', current:true, bullets: Array.from({length:6}, (_,i)=>({id:`x1b${i}`, text:`Automated Kubernetes deployment workflow ${i+1} using AWS and Terraform, reducing release effort by ${10+i}%.`})) },
      { id:'xp2', company:'CloudMint', role:'DevOps Engineer', startDate:'2020-01', endDate:'2022-12', bullets: Array.from({length:5}, (_,i)=>({id:`x2b${i}`, text:`Maintained CI/CD platform ${i+1} with Jenkins and Docker across production services.`})) },
    ],
    projects: Array.from({length:4}, (_,i)=>({ id:`pj${i}`, name:`Platform Project ${i+1}`, techStack:'AWS, Kubernetes, Terraform', bullets:Array.from({length:3},(_,j)=>({id:`p${i}b${j}`,text:`Built infrastructure automation ${i+1}.${j+1} using AWS and Terraform.`})) })),
    skills: skills.map((name,i)=>({id:`sk${i}`,name,status:i<8?'VERIFIED':'DECLARED'})),
    certifications: [
      {id:'ct1',text:'AWS Certified Solutions Architect – Professional'},
      {id:'ct2',text:'Certified Kubernetes Administrator (CKA)'},
      {id:'ct3',text:'HashiCorp Certified: Terraform Associate'},
      {id:'ct4',text:'Microsoft Azure Administrator Associate'},
      {id:'ct5',text:'ITIL Foundation'},
    ],
    achievements: [
      {id:'ac1',text:'Reduced release effort by 80% across 12 applications.'},
      {id:'ac2',text:'Improved deployment reliability for Kubernetes workloads.'},
      {id:'ac3',text:'Recognized for production release leadership.'},
      {id:'ac4',text:'Mentored engineering peers on CI/CD practices.'},
      {id:'ac5',text:'Contributed to platform documentation.'},
    ],
  });
}

test('TemplateDefinition contentBudget survives projection into Resume OS registry card', () => {
  const def = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'cloud-infrastructure-pro');
  const card = toRegistryCard(def);
  assert.deepEqual(card.contentBudget, def.contentBudget);
  assert.notEqual(card.contentBudget, def.contentBudget, 'registry card gets a detached budget copy');
  assert.equal(card.contentBudget.projects.preferredCount, 2);
  assert.equal(card.contentBudget.summary.preferredLines, 2);
});


test('all premium Template OS builtins expose a complete one/two-page capacity contract', () => {
  const required = ['summary','currentExperience','previousExperience','projects','skills','certifications','achievements'];
  for (const def of TEMPLATE_OS_BUILTINS) {
    for (const key of required) assert.ok(def.contentBudget?.[key], `${def.id} missing ${key} budget`);
    assert.ok(def.contentBudget.projects.preferredBullets >= 1, `${def.id} project bullet budget missing`);
  }
});

test('budgetForTemplate reads direct and nested TemplateDefinition contracts and normalizes ATS aliases', () => {
  const def = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'campus-portfolio');
  const nestedOnly = { category: 'student', definition: def };
  assert.equal(budgetForTemplate(nestedOnly).projects.preferredCount, def.contentBudget.projects.preferredCount);
  const ats = budgetForTemplate({ category:'ats' });
  assert.equal(ats.summary.preferredLines, 3);
  assert.equal(ats.skills.preferredCount, 15);
  assert.match(CONTENT_BUDGET_VERSION, /template-contract/);
});

test('summary capacity follows the selected template region width and declared line budget', () => {
  const cloud = toRegistryCard(TEMPLATE_OS_BUILTINS.find((d) => d.id === 'cloud-infrastructure-pro'));
  const editorial = toRegistryCard(TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional'));
  const c1 = summaryCapacityForTemplate(cloud, budgetForTemplate(cloud), {pageTarget:1});
  const c2 = summaryCapacityForTemplate(editorial, budgetForTemplate(editorial), {pageTarget:1});
  assert.equal(c1.lines, 2);
  assert.ok(c1.regionWidth < c2.regionWidth);
  assert.ok(c1.maxChars < c2.maxChars);
});

test('content plan enforces template-specific experience, project, skill, certification and achievement capacity', () => {
  const doc = denseDoc();
  const def = structuredClone(TEMPLATE_OS_BUILTINS.find((d) => d.id === 'cloud-infrastructure-pro'));
  def.contentBudget = {
    ...def.contentBudget,
    currentExperience:{preferredBullets:3,maxBullets:5},
    previousExperience:{preferredBullets:2,maxBullets:3},
    projects:{preferredCount:1,maxCount:2,preferredBullets:2,maxBullets:3},
    skills:{preferredCount:10,maxCount:16},
    certifications:{preferredCount:2,maxCount:4},
    achievements:{preferredCount:2,maxCount:4},
    summary:{preferredLines:2,maxLines:3},
  };
  const card = toRegistryCard(def);
  const ranking = rankContentForTarget(doc,{targetRole:'Senior DevOps Engineer',verifiedSkills:['AWS','Kubernetes','Terraform']});
  const plan = planContentBudget(doc, ranking, card, {pageTarget:1});
  assert.match(SELECTION_VERSION, /budget-aware/);
  assert.equal(plan.source,'template-contract');
  assert.equal(plan.overrides.bulletIds.xp1.length,3);
  assert.equal(plan.overrides.bulletIds.xp2.length,2);
  assert.equal(plan.overrides.bulletIds.pj0?.length ?? 2,2);
  assert.equal(doc.projects.filter((p)=>!plan.overrides.disabled.includes(p.id)).length,1);
  assert.equal(doc.skills.filter((x)=>!plan.overrides.disabled.includes(x.id)).length,10);
  assert.equal(doc.certifications.filter((x)=>!plan.overrides.disabled.includes(x.id)).length,2);
  assert.equal(doc.achievements.filter((x)=>!plan.overrides.disabled.includes(x.id)).length,2);
  assert.ok(plan.summary.overBudget);
  assert.ok(plan.decisions.some((d)=>d.action==='hide_certification'));
  assert.ok(plan.decisions.some((d)=>d.action==='hide_achievement'));
});

test('ranking now provides deterministic certification and achievement value for budget selection', () => {
  const ranking = rankContentForTarget(denseDoc(), {targetRole:'Senior DevOps Engineer',verifiedSkills:['AWS','Kubernetes','Terraform']});
  assert.equal(ranking.certifications.length,5);
  assert.equal(ranking.achievements.length,5);
  assert.ok(ranking.certifications[0].value >= ranking.certifications.at(-1).value);
  assert.ok(ranking.achievements[0].value >= ranking.achievements.at(-1).value);
  assert.ok(ranking.achievements.some((x)=>x.reasons.includes('quantified impact')));
});

test('Tailor for Job passes selected template summary capacity into deterministic compiler', async () => {
  const routes = await readFile(new URL('../server/routes/resumeOsRoutes.js', import.meta.url), 'utf8');
  assert.match(routes, /maxChars:\s*budgetPlan\.summary\?\.maxChars/);
  assert.match(routes, /replace_summary_for_fit/);
  assert.match(routes, /summary:\s*variantSummary/);
});

test('vocabulary library expands precise deterministic alternatives without adding facts', async () => {
  assert.ok(VERB_DICTIONARY.diagnose);
  assert.ok(VERB_DICTIONARY.standardize);
  assert.ok(VERB_DICTIONARY.remediate);
  assert.ok(verbAlternatives('analyze', 10).includes('assess'));
  const eligible = eligiblePatterns({ action:'automate', process:'deployment workflow', tech:['GitLab CI'], outcome:'reducing manual effort', outcomeValue:'80%' }, 'DEVOPS');
  assert.ok(eligible.some((p)=>p.id==='act-process-tech-outcome'));
  const bullet = compileBullet({ action:'automate', process:'deployment workflow', tech:['GitLab CI'], outcome:'reducing manual effort', outcomeValue:'80%', category:'DEVOPS' });
  assert.equal(bullet.ok,true);
  assert.match(COMPILER_VERSION,/vocabulary/);
  assert.match(bullet.text,/GitLab CI/);
  assert.match(bullet.text,/80%/);
  const summary = compileSummary(denseDoc(), {targetRole:'Senior DevOps Engineer'});
  assert.match(SUMMARY_COMPILER_VERSION,/vocabulary/);
  assert.ok(summary.candidates.some((c)=>['experience-stack','practical-profile'].includes(c.patternId)));
  const clipped = compileSummary(denseDoc(), {targetRole:'Senior DevOps Engineer', maxChars:120});
  assert.ok(clipped.candidates.every((c)=>c.text.length <= 121 && /[.!?]$/.test(c.text)), 'budget clipping should end cleanly, never mid-word');
  assert.ok(clipped.candidates.every((c)=>!/independently verified/i.test(c.text)), 'verification wording must not overclaim independence');
  const rewrite = await DeterministicWritingProvider.rewrite({kind:'bullet',text:'Worked closely with platform engineers and made use of Terraform.'});
  assert.match(WRITING_PROVIDERS_VERSION,/vocabulary/);
  assert.ok(rewrite.candidates.some((c)=>/collaborated with platform engineers and used Terraform/i.test(c.text)));
});
