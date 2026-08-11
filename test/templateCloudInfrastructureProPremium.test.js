import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, buildLayoutHTML, layoutCSS } from '../web/src/lib/templateOs/compiler.js';
import { resolveRenderDesign } from '../web/src/lib/templateOs/renderDesign.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';

const cloud = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'cloud-infrastructure-pro');
const technical = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');
const devops = structuredClone(getResumeFixture('devops-cloud').data);
devops.experience[0].stack = 'AWS · EKS · Terraform · Helm · GitHub Actions · Prometheus/Grafana';
devops.experience[1].stack = 'AWS · Ansible · Jenkins · Trivy · Linux';
devops.projects[0].verified = true;

test('Phase 11 Cloud Infrastructure Pro is structurally distinct from Technical Sidebar', () => {
  const c = compileTemplate(cloud);
  const t = compileTemplate(technical);
  assert.equal(c.ok, true, c.validation?.errors?.join('; '));
  assert.equal(c.tree.layoutType, 'sidebar-right');
  assert.deepEqual(c.tree.columns.map((x) => [x.id, x.width]), [['main', 0.72], ['sidebar', 0.28]]);
  assert.equal(t.tree.layoutType, 'sidebar-left');
  assert.equal(c.tokens.visual.sidebarPanel.id, 'cloud-rail');
  assert.equal(c.tokens.visual.headerRule.id, 'accent');
  assert.equal(c.tokens.visual.certificationBlock.id, 'featured');
  assert.equal(c.tokens.experience.id, 'cloud-platform');
  assert.equal(c.tokens.projects.id, 'evidence-compact');
  assert.equal(c.tokens.typography.id, 'cloud-engineering');
});

test('Cloud HTML uses certification-first right rail and labelled stack context', () => {
  const c = compileTemplate(cloud);
  const html = buildLayoutHTML(c, devops);
  const css = layoutCSS(c);
  const design = resolveRenderDesign(c);
  assert.equal(design.version, 'template-render-design-v12-reference-premium-families');
  assert.equal(design.experience.stackLabel, 'STACK');
  assert.match(html, /t-col-main/);
  assert.match(html, /t-col-sidebar/);
  assert.match(html, /<span class="t-stack-label">STACK<\/span>/);
  assert.match(css, /grid-template-columns:0\.72fr 0\.28fr/);
  assert.match(css, /border-left:2\.4px solid var\(--tpl-accent\)/);
  assert.match(css, /font-weight:650/);
});

test('Cloud vector PDF keeps main narrative wide and content-sized right rail', () => {
  const c = compileTemplate(cloud);
  const pdf = renderTemplatePdf(c, devops, { sizeId: 'a4' });
  assert.equal(pdf.pageCount, 1);
  assert.equal(pdf.version, 'template-pdf-writer-v18-owned-pagination-reference-premium-families');
  assert.equal(pdf.renderDesignVersion, 'template-render-design-v12-reference-premium-families');
  const main = pdf.geometry.columns.find((x) => x.id === 'main');
  const rail = pdf.geometry.columns.find((x) => x.id === 'sidebar');
  assert.ok(main.w > rail.w * 2.4, `${main.w}/${rail.w}`);
  const panel = pdf.geometry.sidebarPanels[0];
  assert.ok(panel, 'expected right rail panel');
  assert.equal(panel.mode, 'content');
  assert.ok(panel.height > 150 && panel.height < 430, `unexpected rail height ${panel.height}`);
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  assert.match(raw, /STACK/);
  assert.match(raw, /AWS DevOps Engineer/);
  assert.match(raw, /Professional/);
  assert.match(raw, /kube-sentry/);
});
