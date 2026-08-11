import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, buildLayoutHTML, layoutCSS } from '../web/src/lib/templateOs/compiler.js';
import { resolveRenderDesign } from '../web/src/lib/templateOs/renderDesign.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';

const technical = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');
const campus = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'campus-portfolio');

function projectRichDevops() {
  const data = structuredClone(getResumeFixture('devops-cloud').data);
  data.experience[0].stack = 'AWS · EKS · Terraform · Helm · GitHub Actions';
  data.experience[1].stack = 'AWS · Ansible · Jenkins · Trivy';
  data.projects = [
    {
      name: 'kube-sentry',
      techStack: 'Go · Kubernetes Operators · Prometheus',
      link: 'github.com/rahulv/kube-sentry',
      verified: true,
      bullets: [
        'Built an operator that detects crash-looping workloads and applies policy-based remediation.',
        'Added Prometheus metrics and runbook links to shorten triage during repeated pod failures.',
      ],
    },
    {
      name: 'platform-release-lab',
      techStack: 'Terraform · Helm · GitHub Actions',
      link: 'github.com/rahulv/platform-release-lab',
      verified: false,
      bullets: ['Reference environment for repeatable infrastructure and application release workflows.'],
    },
  ];
  return data;
}

const fixture = projectRichDevops();

test('shared project contract defines metadata, verification and bullet geometry', () => {
  const c = compileTemplate(technical);
  const d = resolveRenderDesign(c);
  assert.equal(d.projects.headerLayout, 'stacked');
  assert.equal(d.projects.metaLayout, 'split');
  assert.equal(d.projects.techFont, 'mono');
  assert.equal(d.projects.badge, true);
  assert.equal(d.projects.badgeLabel, 'VERIFIED');
  assert.ok(d.projects.itemGapPx > c.tokens.spacing.itemGapPx);
  assert.ok(d.projects.bulletIndentPx >= 16);
});

test('HTML projects separate name, verification, stack, link and impact bullets', () => {
  const c = compileTemplate(technical);
  const html = buildLayoutHTML(c, fixture);
  const css = layoutCSS(c);
  assert.match(html, /t-project-head[^>]*><span class="t-project-name">kube-sentry<\/span><span class="t-project-verified t-verified">VERIFIED<\/span>/);
  assert.match(html, /t-project-meta[^>]*><span class="t-project-tech">Go · Kubernetes Operators · Prometheus<\/span><span class="t-project-meta-sep">·<\/span><span class="t-project-link">github\.com\/rahulv\/kube-sentry<\/span>/);
  assert.match(html, /t-project-bullets/);
  assert.match(css, /\.t-project-link\{margin-left:auto;color:var\(--tpl-accent\)/);
  assert.match(css, /\.t-project-bullets\{margin-top:/);
});

test('vector PDF keeps project name, verified state, stack, link and bullets in a clean semantic sequence', () => {
  const c = compileTemplate(technical);
  const pdf = renderTemplatePdf(c, fixture, { sizeId: 'a4' });
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  assert.equal(pdf.pageCount, 1);
  assert.equal(pdf.renderDesignVersion, 'template-render-design-v12-reference-premium-families');
  const name = raw.indexOf('kube-sentry');
  const verified = raw.indexOf('VERIFIED', name);
  const tech = raw.indexOf('Kubernetes Operators', verified);
  const link = raw.indexOf('github.com/rahulv/kube-sentry', tech);
  const bullet = raw.indexOf('Built an operator', link);
  assert.ok(name >= 0 && verified > name && tech > verified && link > tech && bullet > link, { name, verified, tech, link, bullet });
  assert.doesNotMatch(raw, /\[VERIFIED\]/);
});

test('compact project primitive preserves the two-bullet content budget', () => {
  const c = compileTemplate(campus);
  const d = resolveRenderDesign(c);
  assert.equal(d.projects.headerLayout, 'stacked'); // campus uses evidence, not compact
  const compactDef = structuredClone(campus);
  compactDef.id = 'campus-project-compact-test';
  compactDef.projectStyle = { primitive: 'compact' };
  const compact = compileTemplate(compactDef);
  const compactDesign = resolveRenderDesign(compact);
  assert.equal(compactDesign.projects.headerLayout, 'inline');
  assert.equal(compactDesign.projects.maxBullets, 2);
});
