import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, buildLayoutHTML, layoutCSS } from '../web/src/lib/templateOs/compiler.js';
import { resolveRenderDesign } from '../web/src/lib/templateOs/renderDesign.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';

const technical = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');
const cloud = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'cloud-infrastructure-pro');
const campus = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'campus-portfolio');
const devops = structuredDevops();

function structuredDevops() {
  const data = structuredClone(getResumeFixture('devops-cloud').data);
  data.experience[0].stack = 'AWS · EKS · Terraform · Helm · GitHub Actions';
  data.experience[1].stack = 'AWS · Ansible · Jenkins · Trivy';
  return data;
}

test('shared experience contract defines premium stacked role/date/company hierarchy', () => {
  const c = compileTemplate(technical);
  const d = resolveRenderDesign(c);
  assert.equal(d.experience.headerLayout, 'stacked');
  assert.equal(d.experience.dateAlign, 'right');
  assert.equal(d.experience.companyTone, 'accent');
  assert.equal(d.experience.stackFont, 'mono');
  assert.ok(d.experience.bulletIndentPx >= 16);
  assert.ok(d.experience.itemGapPx > c.tokens.spacing.itemGapPx);
});

test('HTML experience separates role/date from company/location and applies hanging bullet rhythm', () => {
  const c = compileTemplate(cloud);
  const html = buildLayoutHTML(c, devops);
  const css = layoutCSS(c);
  assert.match(html, /t-jobtop[^>]*><span class="t-role">Senior DevOps Engineer<\/span><span class="t-dates">Mar 2023 – Present<\/span>/);
  assert.match(html, /t-jobmeta[^>]*><span class="t-company">SkyLattice<\/span><span class="t-meta-sep">·<\/span><span class="t-location">Hyderabad<\/span>/);
  assert.match(html, /t-exp-stack"><span class="t-stack-label">STACK<\/span><span class="t-stack-value">AWS · EKS · Terraform · Helm · GitHub Actions<\/span>/);
  assert.match(css, /\.t-exp-bullets\{margin-top:/);
  assert.match(css, /\.t-jobtop \ .t-role|\.t-jobtop \.t-role/);
});

test('vector PDF keeps dates on the role line and company/location immediately below in semantic stream', () => {
  const c = compileTemplate(cloud);
  const pdf = renderTemplatePdf(c, devops, { sizeId: 'a4' });
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  assert.equal(pdf.pageCount, 1);
  assert.equal(pdf.renderDesignVersion, 'template-render-design-v12-reference-premium-families');
  const role = raw.indexOf('Senior DevOps Engineer');
  const date = raw.indexOf('Mar 2023');
  const company = raw.indexOf('SkyLattice');
  const location = raw.indexOf('Hyderabad', company);
  assert.ok(role >= 0 && date > role && company > date && location > company, { role, date, company, location });
  assert.match(raw, /Terraform/);
  assert.match(raw, /\/Courier /); // technical stack/contact accents stay deterministic
});

test('compact student experience remains an explicit inline mode instead of inheriting senior spacing', () => {
  const c = compileTemplate(campus);
  const d = resolveRenderDesign(c);
  assert.equal(d.experience.headerLayout, 'inline');
  assert.equal(d.experience.tight, true);
  assert.ok(d.experience.itemGapPx < c.tokens.spacing.itemGapPx);
});
