import fs from 'node:fs';
import path from 'node:path';
import { assembleMasterProfile, seedResumeDocument, PROJECT_BULLET_ENRICHMENT_VERSION } from '../server/utils/resume/masterProfileEngine.js';
import { toRendererStructured } from '../server/utils/resume/resumeDocument.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { compileTemplate, adaptTreeToShape, balancePageComposition, buildLayoutHTML, PAGE_COMPOSITION_VERSION } from '../web/src/lib/templateOs/compiler.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { analyzeResumeShape } from '../web/src/lib/templateOs/shape.js';
import { VERB_DICTIONARY, verbAlternatives } from '../server/utils/resume/grammarLibrary.js';
import { ROLE_ACTION_VERBS } from '../server/utils/resume/roleDictionaries.js';
import { sanitizeTemplateDefinition, TEMPLATE_DSL_VERSION, TEMPLATE_SECURITY_VERSION } from '../web/src/lib/templateOs/dsl.js';
import { PRIMITIVES, PRIMITIVES_VERSION } from '../web/src/lib/templateOs/primitives.js';
import { sanitizePackageCss, sanitizePackageMetadata, PACKAGE_SECURITY_VERSION } from '../server/utils/templateOs/packageSecurity.js';

const outDir = '/mnt/data/templateos_phase22_outputs';
const pdfDir = path.join(outDir, 'pdf');
fs.mkdirSync(pdfDir, { recursive: true });

const master = assembleMasterProfile({
  user: { email: 'aarav.mehta@example.com', targetRole: 'Senior DevOps Engineer' },
  profile: {
    name: 'Aarav Mehta',
    phone: '+91 98765 43210',
    location: 'Pune, India',
    linkedin: 'linkedin.com/in/aaravmehta',
    github: 'github.com/aarav-platform',
    headline: 'Senior DevOps Engineer',
    targetRole: 'Senior DevOps Engineer',
    summary: 'DevOps engineer focused on reliable delivery platforms, Kubernetes operations, infrastructure automation and measurable release improvements.',
    skills: ['AWS', 'Kubernetes', 'Terraform', 'GitLab CI', 'Helm', 'Docker', 'Prometheus', 'Grafana', 'Linux', 'Python', 'Bash', 'Argo CD'],
    experience: [
      {
        company: 'Northstar Systems', role: 'Senior DevOps Engineer', location: 'Pune', dates: '2022 - Present', current: true,
        bullets: [
          'Systematized deployment workflows across 28 services using GitLab CI, Helm and Kubernetes.',
          'Rightsized Kubernetes workloads using observed utilization baselines, reducing infrastructure spend by 18%.',
          'Baselined deployment health signals in Prometheus and Grafana to shorten release triage.',
          'Smoke-tested production releases through deterministic post-deployment validation gates.',
        ],
      },
      {
        company: 'Bluegrid Technologies', role: 'DevOps Engineer', location: 'Pune', dates: '2019 - 2022',
        bullets: [
          'Automated Terraform-based AWS environment provisioning for repeatable application releases.',
          'Hardened CI pipelines with dependency, container and infrastructure security checks.',
          'Standardized rollback runbooks and release evidence for operational reviews.',
        ],
      },
    ],
    education: [{ school: 'Institute of Engineering and Technology', degree: 'B.E. Computer Engineering', dates: '2015 - 2019', details: [] }],
    certifications: ['AWS Certified Solutions Architect - Associate', 'Certified Kubernetes Administrator'],
    achievements: ['Reduced infrastructure spend by 18% through measured workload rightsizing.'],
  },
  verifiedSkills: ['AWS', 'Kubernetes', 'Terraform', 'GitLab CI'],
  submissions: [
    {
      _id: 'project-release-evidence',
      title: 'Release Evidence Platform',
      technologies: ['Kubernetes', 'GitLab CI', 'Python', 'Prometheus'],
      githubUrl: 'https://github.com/aarav-platform/release-evidence',
      verificationStatus: 'verified',
      description: 'Automated release evidence collection across Kubernetes deployment workflows. Added deterministic rollback validation for failed releases. Instrumented deployment-state checks with Prometheus signals for operational review.',
      outcome: 'Reduced manual release review effort by 40%.',
    },
    {
      _id: 'project-cluster-readiness',
      title: 'Cluster Readiness Validator',
      technologies: ['Kubernetes', 'Python', 'Helm'],
      githubUrl: 'https://github.com/aarav-platform/cluster-readiness',
      verificationStatus: 'verified',
      description: 'Built reusable pre-deployment checks for namespace quotas, configuration prerequisites and workload dependencies. Added structured readiness reports for release teams.',
      outcome: 'Prevented repeated deployment failures caused by missing environment prerequisites.',
    },
  ],
});

const doc = seedResumeDocument(master, { targetRole: 'Senior DevOps Engineer', templateId: 'cloud-infrastructure-pro' });
const structured = toRendererStructured(doc);

const optionalKeys = ['publications', 'patents', 'volunteer', 'languages', 'customSections'];
const absentOptional = optionalKeys.filter((k) => !structured[k]?.length);

function render(templateId, fileName) {
  const def = TEMPLATE_OS_BUILTINS.find((x) => x.id === templateId);
  const compiled = compileTemplate(def, { density: 'balanced' });
  if (!compiled.ok) throw new Error(`${templateId} did not compile: ${compiled.validation.errors.join('; ')}`);
  const shape = analyzeResumeShape(structured, { targetRole: doc.targetRole, preferredPageCount: 1 });
  const adapted = adaptTreeToShape(compiled, shape);
  const composed = balancePageComposition(adapted, structured, { sizeId: 'a4' });
  const html = buildLayoutHTML(composed, structured, { sizeId: 'a4' });
  for (const key of absentOptional) {
    if (html.includes(`data-section="${key}"`)) throw new Error(`${templateId} invented empty section ${key}`);
  }
  const pdf = renderTemplatePdf(composed, structured, { sizeId: 'a4' });
  const target = path.join(pdfDir, fileName);
  fs.writeFileSync(target, Buffer.from(pdf.bytes));
  return {
    templateId,
    file: target,
    pageCount: pdf.pageCount,
    composition: composed.composition || null,
    shape,
    geometry: {
      pageUsage: pdf.geometry?.pageUsage || [],
      columns: pdf.geometry?.columns || [],
      sidebarPanels: pdf.geometry?.sidebarPanels || [],
    },
  };
}

const renders = [
  render('cloud-infrastructure-pro', 'cloud-project-depth.pdf'),
  render('editorial-professional', 'editorial-project-depth.pdf'),
];

// Deliberately sparse resume: no fake sections are allowed to appear just to fill space.
const sparse = structuredClone(structured);
sparse.experience = sparse.experience.slice(0, 1).map((e) => ({ ...e, bullets: e.bullets.slice(0, 2) }));
sparse.projects = sparse.projects.slice(0, 1);
sparse.skills = { cloud: ['AWS', 'Kubernetes', 'Terraform'], devops: ['GitLab CI', 'Helm'] };
sparse.certifications = ['AWS Certified Solutions Architect - Associate'];
sparse.achievements = [];
for (const k of optionalKeys) sparse[k] = [];
const sparseDef = TEMPLATE_OS_BUILTINS.find((x) => x.id === 'editorial-professional');
const sparseCompiled = compileTemplate(sparseDef, { density: 'balanced' });
const sparseShape = analyzeResumeShape(sparse, { targetRole: 'Senior DevOps Engineer', preferredPageCount: 1 });
const sparseComposed = balancePageComposition(adaptTreeToShape(sparseCompiled, sparseShape), sparse, { sizeId: 'a4' });
const sparseHtml = buildLayoutHTML(sparseComposed, sparse, { sizeId: 'a4' });
for (const key of optionalKeys) if (sparseHtml.includes(`data-section="${key}"`)) throw new Error(`sparse proof invented ${key}`);
const sparsePdf = renderTemplatePdf(sparseComposed, sparse, { sizeId: 'a4' });
const sparsePath = path.join(pdfDir, 'intentional-whitespace-no-fake-sections.pdf');
fs.writeFileSync(sparsePath, Buffer.from(sparsePdf.bytes));
renders.push({ templateId: 'editorial-professional-sparse', file: sparsePath, pageCount: sparsePdf.pageCount, composition: sparseComposed.composition || null, shape: sparseShape, geometry: { pageUsage: sparsePdf.geometry?.pageUsage || [] } });

const attack = structuredClone(TEMPLATE_OS_BUILTINS.find((x) => x.id === 'technical-sidebar'));
attack.colors.accent = '#fff;position:fixed';
const definitionAttack = sanitizeTemplateDefinition(attack, { primitives: PRIMITIVES });
const cssAttack = sanitizePackageCss(':root{--tpl-accent:#fff;} body{display:none}');
const metadataAttack = sanitizePackageMetadata({ source: '<img src=x onerror=alert(1)>' });

const projectBullets = doc.projects.map((p) => ({
  name: p.name,
  verified: p.verified,
  bullets: p.bullets.map((b) => ({ text: b.text, sourceType: b.sourceType, sourceId: b.sourceId, verified: b.verified, generatedByRule: b.generatedByRule })),
}));

const configuredRoleVerbCount = Object.values(ROLE_ACTION_VERBS).reduce((n, x) => n + x.length, 0);
const proof = {
  phase: 22,
  dslVersion: TEMPLATE_DSL_VERSION,
  templateSecurityVersion: TEMPLATE_SECURITY_VERSION,
  packageSecurityVersion: PACKAGE_SECURITY_VERSION,
  primitivesVersion: PRIMITIVES_VERSION,
  pageCompositionVersion: PAGE_COMPOSITION_VERSION,
  projectBulletEnrichmentVersion: PROJECT_BULLET_ENRICHMENT_VERSION,
  contentPolicy: 'spacing-only-no-synthetic-sections',
  absentOptionalSectionsRemainAbsent: absentOptional,
  projectBullets,
  vocabulary: {
    recognizedVerbCount: Object.keys(VERB_DICTIONARY).length,
    configuredRoleVerbCount,
    optimizeAlternatives: verbAlternatives('optimize', 12),
    testAlternatives: verbAlternatives('test', 14),
    communicateAlternatives: verbAlternatives('communicate', 12),
  },
  securityProof: {
    definitionInjectionRejected: !definitionAttack.ok,
    definitionRejections: definitionAttack.rejected,
    cssSelectorInjectionRejected: !cssAttack.ok,
    metadataMarkupRejected: !metadataAttack.ok,
  },
  renders,
};
fs.writeFileSync(path.join(outDir, 'phase22-proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ projectBullets: projectBullets.map((p) => [p.name, p.bullets.length]), vocabulary: proof.vocabulary.recognizedVerbCount, renders: renders.map((r) => [r.templateId, r.pageCount]), proof: path.join(outDir, 'phase22-proof.json') }, null, 2));
