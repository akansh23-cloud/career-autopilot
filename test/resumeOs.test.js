// Unit tests for the rebuilt Resume OS. Everything here is pure logic from
// web/src/lib — no browser, DB or network — so it runs under `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RESUME_TEMPLATES, getResumeTemplate, LEGACY_TEMPLATE_MAP,
  recommendResumeTemplate, recommendTemplateId, isTemplateAtsSafe,
  STANDARD_SECTIONS, setCustomResumeTemplate,
} from '../web/src/lib/resumeTemplateRegistry.js';
import {
  parseResumeText, toStructuredResume, structuredFromText, groupSkills,
  flattenSkills, devopsSkillGroups, classifySkill, estimateContentUnits,
} from '../web/src/lib/resumeDataModel.js';
import {
  packBlocksIntoPages, buildResumeBlocks, DENSITIES, MIN_BODY_FONT_PX, DENSITY_STEPS,
  VALIDATION_HOST_STYLE, canExportLayout,
} from '../web/src/lib/resumeRenderer.js';
import {
  rectsOverlap, rectContains, findOverlaps, findOrphanHeadings, isHiddenForValidation,
} from '../web/src/lib/resumeLayoutValidator.js';
import { buildEditorHandoff } from '../web/src/lib/resumeEditorHandoff.js';
import { scoreResume, SCORING_VERSION } from '../server/utils/resume/scoringEngine.js';
import {
  planOnePageFit, densityIsReadable, sectionOrderForRole, analyzeContentQuality,
  recommendForJobDescription, ONE_PAGE_OVERFLOW_MESSAGE,
} from '../web/src/lib/resumeSectionOptimizer.js';
import { RESUME_FIXTURES, getResumeFixture } from '../web/src/lib/resumeFixtures.js';
import { buildCustomTemplate, atsEstimate } from '../web/src/lib/resumeTemplates.js';

/* ------------------------------ registry ------------------------------ */

test('registry ships the 8 required legacy templates (V3 set is additive) with full metadata', () => {
  const legacy = RESUME_TEMPLATES.filter((t) => t.set !== 'v3');
  assert.equal(legacy.length, 8);
  assert.equal(RESUME_TEMPLATES.length, 20); // 8 legacy + 12 Resume OS V3
  const ids = RESUME_TEMPLATES.map((t) => t.id);
  for (const id of ['jake-ats-classic', 'clean-ats-pro', 'modern-pro', 'cloud-devops',
    'senior-engineer', 'fresher-project-first', 'executive-leadership', 'visual-creative']) {
    assert.ok(ids.includes(id), `missing template ${id}`);
  }
  for (const t of RESUME_TEMPLATES) {
    for (const k of ['id', 'name', 'category', 'bestFor', 'atsSafe', 'layoutType', 'pageMode',
      'supportsOnePage', 'supportsMultiPage', 'riskLevel', 'description', 'sections', 'previewType']) {
      assert.ok(k in t, `${t.id} missing ${k}`);
    }
    assert.ok(Array.isArray(t.badges) && t.badges.length > 0, `${t.id} needs label badges`);
  }
});

test('no template carries a fake ATS score number anywhere', () => {
  const json = JSON.stringify(RESUME_TEMPLATES);
  assert.ok(!/atsScore/.test(json), 'atsScore fields are banned');
  for (const t of RESUME_TEMPLATES) {
    assert.equal(typeof t.atsSafe, 'boolean');
  }
});

test('visual template is honestly flagged non-ATS-first; ATS templates carry the label', () => {
  const visual = getResumeTemplate('visual-creative');
  assert.equal(visual.atsSafe, false);
  assert.equal(visual.riskLevel, 'visual');
  assert.ok(visual.badges.some((b) => /visual, not ats-first/i.test(b)));
  const jake = getResumeTemplate('jake-ats-classic');
  assert.equal(jake.atsSafe, true);
  assert.ok(jake.badges.some((b) => /ats-safe/i.test(b)));
  assert.equal(isTemplateAtsSafe(jake), true);
  assert.equal(isTemplateAtsSafe(visual), false);
});

test('broken legacy ids (incl. two-column) map to safe new templates', () => {
  assert.ok(Object.keys(LEGACY_TEMPLATE_MAP).length >= 4);
  assert.notEqual(getResumeTemplate('two-col-tech').id, 'two-col-tech');
  assert.equal(getResumeTemplate('two-col-tech').layoutType, 'single-column');
  for (const legacy of Object.keys(LEGACY_TEMPLATE_MAP)) {
    const t = getResumeTemplate(legacy);
    assert.ok(RESUME_TEMPLATES.some((r) => r.id === t.id) || t.custom, `legacy ${legacy} resolves`);
  }
  // unknown id falls back to a real template, never undefined
  assert.ok(getResumeTemplate('does-not-exist').id);
});

test('role/JD recommendation picks sensible templates with a reason', () => {
  assert.equal(recommendResumeTemplate('DevOps Engineer').templateId, 'cloud-devops');
  assert.equal(recommendResumeTemplate('', 'Looking for a fresher / recent graduate, strong projects').templateId, 'fresher-project-first');
  const senior = recommendResumeTemplate('Staff Software Architect');
  assert.equal(senior.templateId, 'senior-engineer');
  assert.ok(senior.reason.length > 5);
  assert.equal(typeof recommendTemplateId('designer'), 'string');
});

/* ----------------------------- data model ----------------------------- */

test('parseResumeText + toStructuredResume produce the structured model', () => {
  const text = `Ravi Kumar
Senior Backend Engineer
ravi@example.com | +91 90000 11111 | Bengaluru | github.com/ravik

SUMMARY
Backend engineer with 6 years building payment systems.

SKILLS
Python, Go, AWS, Docker, Kubernetes, PostgreSQL, Terraform

EXPERIENCE
Senior Engineer — PayCo (2021 – Present)
• Cut p99 latency 38% by rewriting the ledger service in Go.
• Led a team of 4 engineers across two quarters.

EDUCATION
B.Tech CSE, NIT Trichy (2014 – 2018)`;
  const s = structuredFromText(text);
  assert.equal(s.personalInfo.name, 'Ravi Kumar');
  assert.ok(s.personalInfo.email.includes('ravi@'));
  assert.ok(s.summary.toLowerCase().includes('payment'));
  assert.ok(flattenSkills(s.skills).includes('Kubernetes'));
  assert.ok(s.experience.length >= 1);
  assert.ok(s.experience[0].bullets.some((b) => b.includes('38%')));
  assert.ok(s.education.length >= 1);
  // structured input passes through unchanged shape
  const again = toStructuredResume(s);
  assert.equal(again.personalInfo.name, 'Ravi Kumar');
  assert.ok(estimateContentUnits(s) > 5);
});

test('skill grouping buckets correctly, incl. DevOps grouped categories', () => {
  assert.equal(classifySkill('Kubernetes'), 'devops');
  assert.equal(classifySkill('React'), 'frontend');
  const grouped = groupSkills(['Python', 'React', 'AWS', 'Docker', 'MongoDB', 'Excalidraw']);
  assert.ok(grouped.languages.includes('Python'));
  assert.ok(grouped.frontend.includes('React'));
  assert.ok(grouped.cloud.includes('AWS'));
  assert.ok(grouped.databases.includes('MongoDB'));
  const dg = devopsSkillGroups({ cloud: ['AWS', 'GCP'], devops: ['Docker', 'Kubernetes', 'Jenkins', 'Terraform', 'Prometheus'], languages: ['Python', 'Bash'], databases: ['PostgreSQL'], other: ['Vault'] });
  const names = dg.map((g) => g.label);
  for (const required of ['Cloud', 'Containers', 'CI/CD', 'IaC', 'Monitoring', 'Scripting', 'Databases']) {
    assert.ok(names.includes(required), `devops groups missing ${required}`);
  }
  assert.ok(dg.find((g) => g.label === 'Containers').skills.includes('Docker'));
  assert.ok(dg.find((g) => g.label === 'IaC').skills.includes('Terraform'));
  // Security group materialises when security tooling is present
  assert.ok(dg.find((g) => g.label === 'Security').skills.includes('Vault'));
});

/* ------------------------------ paginator ----------------------------- */

const A = (id, h, extra = {}) => ({ id, kind: 'paragraph', h, ...extra });
const S = (id, unitHeights, extra = {}) => ({
  id, kind: 'bullets', h: unitHeights.reduce((a, b) => a + b, 0), splittable: true,
  unitHeights, unitOverhead: 0, ...extra,
});

test('paginator: everything fits on one page when it fits', () => {
  const { pages, overflowBlocks } = packBlocksIntoPages([A('a', 100), A('b', 200), S('c', [50, 50])], 1000);
  assert.equal(pages.length, 1);
  assert.equal(overflowBlocks.length, 0);
  assert.equal(pages[0].length, 3);
});

test('paginator: keepWithNext headings never strand at a page bottom', () => {
  const blocks = [
    A('body', 900),
    A('head', 40, { kind: 'section-heading', keepWithNext: true }),
    S('list', [40, 40, 40]),
  ];
  const { pages } = packBlocksIntoPages(blocks, 1000);
  assert.equal(pages.length, 2);
  // heading moved to page 2 with its content, page 1 only has body
  assert.deepEqual(pages[0].map((p) => p.id), ['body']);
  assert.equal(pages[1][0].id, 'head');
});

test('paginator: bullet lists split with orphan/widow control and lose nothing', () => {
  const units = Array(10).fill(60); // 600 total
  const { pages, overflowBlocks } = packBlocksIntoPages([A('intro', 850), S('list', units)], 1000);
  assert.equal(overflowBlocks.length, 0);
  const chunks = pages.flat().filter((p) => p.id === 'list');
  // first chunk holds at least 2 bullets (minLead), final chunk at least 2 (minTail)
  assert.ok(chunks.length >= 2);
  const first = chunks[0];
  assert.ok((first.to - first.from + 1) >= 2, 'lead chunk respects minLead');
  const lastC = chunks[chunks.length - 1];
  assert.ok((lastC.to - lastC.from + 1) >= 2, 'tail chunk respects minTail');
  // continuity: all 10 units present exactly once, in order
  const seen = chunks.flatMap((c) => Array.from({ length: c.to - c.from + 1 }, (_, i) => c.from + i));
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('paginator: oversize atomic blocks are reported, never silently dropped', () => {
  const { pages, overflowBlocks } = packBlocksIntoPages([A('huge', 2500)], 1000);
  assert.deepEqual(overflowBlocks, ['huge']);
  assert.equal(pages.flat().filter((p) => p.id === 'huge').length, 1);
});

test('buildResumeBlocks uses standard ATS section names and marks headings keepWithNext', () => {
  const fix = getResumeFixture('mid-developer');
  const { blocks } = buildResumeBlocks(fix.data, 'clean-ats-pro');
  const headings = blocks.filter((b) => b.kind === 'section-heading');
  assert.ok(headings.length >= 4);
  assert.ok(headings.every((h) => h.keepWithNext === true));
  const html = blocks.map((b) => b.html).join('');
  assert.ok(html.includes('Technical Skills'));
  assert.ok(STANDARD_SECTIONS.includes('Technical Skills'));
  assert.ok(!/atsScore/.test(html));
});

/* ------------------------- validator geometry ------------------------- */

test('validator geometry: overlap, containment and orphan headings', () => {
  const r = (x, y, w, h, id) => ({ id, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h });
  assert.equal(rectsOverlap(r(0, 0, 100, 100), r(50, 50, 100, 100)), true);
  assert.equal(rectsOverlap(r(0, 0, 100, 100), r(101, 0, 50, 50)), false);
  assert.equal(rectContains(r(0, 0, 200, 200), r(10, 10, 50, 50)), true);
  assert.equal(rectContains(r(0, 0, 200, 200), r(190, 10, 50, 50)), false);
  const overlaps = findOverlaps([
    r(0, 0, 100, 40, 'a'),
    r(0, 30, 100, 40, 'b'),
    r(0, 200, 100, 40, 'c'),
  ]);
  assert.equal(overlaps.length, 1);
  assert.deepEqual([overlaps[0].a, overlaps[0].b].sort(), ['a', 'b']);
  // stacked blocks that merely touch are NOT overlaps
  assert.equal(findOverlaps([r(0, 0, 100, 40, 'x'), r(0, 40, 100, 40, 'y')]).length, 0);
  const orphans = findOrphanHeadings([
    [{ kind: 'paragraph' }, { kind: 'section-heading', keepNext: true }],
    [{ kind: 'bullets' }],
  ]);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].page, 1);
  // a heading at the end of the FINAL page is fine
  assert.equal(findOrphanHeadings([[{ kind: 'section-heading' }]]).length, 0);
});

/* ------------------------------ optimizer ----------------------------- */

test('density floor respects 9.5px minimum readability', () => {
  for (const d of DENSITY_STEPS) {
    assert.ok(DENSITIES[d].fontPx >= MIN_BODY_FONT_PX);
    assert.equal(densityIsReadable(d), true);
  }
});

test('one-page fit plan steps density first, then content, never silent cropping', () => {
  const plan = planOnePageFit({ pageCount: 2, density: 'comfortable', requestedOnePage: true });
  assert.ok(plan.steps.length >= 2);
  assert.equal(plan.steps[0].type, 'density');
  const types = plan.steps.map((s) => s.type);
  assert.ok(types.includes('two-page'));
  assert.ok(!types.includes('crop'));
  const hide = plan.steps.find((s) => s.type === 'hide-optional');
  if (hide) assert.equal(hide.requiresConfirmation, true);
  assert.equal(plan.message, ONE_PAGE_OVERFLOW_MESSAGE);
  assert.ok(/two-page mode or remove lower-priority sections/i.test(plan.message));
});

test('fresher section order leads with education and projects', () => {
  const order = sectionOrderForRole('fresher');
  assert.ok(order.indexOf('education') < order.indexOf('experience'));
  assert.ok(order.indexOf('projects') < order.indexOf('experience'));
  const senior = sectionOrderForRole('staff engineer');
  assert.ok(senior.indexOf('experience') < senior.indexOf('education'));
});

test('content quality flags weak phrases, skill dumps and missing metrics', () => {
  const dump = getResumeFixture('overlong-skill-dump');
  const issues = analyzeContentQuality(dump.data);
  assert.ok(Array.isArray(issues));
  assert.ok(issues.some((i) => i.type === 'weak-phrase'), 'flags "highly motivated"');
  assert.ok(issues.some((i) => i.type === 'too-many-skills'), 'flags the skill dump');
  assert.ok(issues.some((i) => i.type === 'no-action-verb'), 'flags weak bullets');
  assert.ok(issues.some((i) => i.type === 'no-metrics'), 'flags missing metrics');
  const clean = analyzeContentQuality(getResumeFixture('mid-developer').data);
  assert.equal(clean.filter((i) => i.type === 'weak-phrase').length, 0);
});

test('JD recommendation surfaces matched/missing keywords + template', () => {
  const fix = getResumeFixture('devops-cloud');
  const rec = recommendForJobDescription({
    data: fix.data,
    role: 'DevOps Engineer',
    jobDescription: 'We need Kubernetes, Terraform, AWS and Prometheus experience. GraphQL is a plus.',
  });
  assert.ok(rec.matchedKeywords.map((k) => k.toLowerCase()).includes('kubernetes'));
  assert.ok(rec.missingKeywords.map((k) => k.toLowerCase()).includes('graphql'));
  assert.equal(rec.template.id, 'cloud-devops');
  assert.ok(Array.isArray(rec.prioritizeSections));
});

/* ------------------------------ fixtures ------------------------------ */

test('all 8 sample fixtures exist and are structurally valid', () => {
  assert.equal(RESUME_FIXTURES.length, 8);
  for (const id of ['fresher-short', 'mid-developer', 'devops-cloud', 'senior-long',
    'student-project-heavy', 'overlong-skill-dump', 'missing-sections', 'long-names-urls']) {
    const f = getResumeFixture(id);
    assert.ok(f, `fixture ${id} present`);
    const s = toStructuredResume(f.data);
    assert.ok(s.personalInfo.name.length > 0);
  }
  // pathological fixture really is pathological
  const lnu = getResumeFixture('long-names-urls');
  assert.ok(JSON.stringify(lnu.data).length > 400);
});

/* ----------------------- custom template + labels ---------------------- */

test('custom uploaded template builds registry shape with labels, no fake score', () => {
  const built = buildCustomTemplate({
    templateName: 'Uploaded', columnLayout: 2, atsSafe: false,
    colorPalette: { accent: '#7c3aed' }, sectionOrder: ['summary', 'skills', 'experience'],
  });
  assert.equal(built.layoutType, 'single-column'); // never rebuilds the broken two-column
  assert.equal(built.atsSafe, false);
  assert.equal(built.riskLevel, 'visual');
  assert.ok(built.badges.includes('Visual, not ATS-first'));
  assert.ok(!('atsScore' in built));
  setCustomResumeTemplate(built);
  assert.equal(getResumeTemplate('custom-upload').name, 'Uploaded');
  const est = atsEstimate(built);
  assert.equal(typeof est.label, 'string');
  assert.ok(!('score' in est));
  const safe = buildCustomTemplate({ templateName: 'Safe', columnLayout: 1, atsSafe: true });
  assert.equal(safe.atsSafe, true);
  assert.equal(atsEstimate(safe).label, 'ATS-safe');
});

/* -------------------------- score separation -------------------------- */

test('resume score comes from the backend scoring engine, not template metadata', async () => {
  // Template metadata must not expose any numeric score the UI could show.
  for (const t of RESUME_TEMPLATES) {
    for (const [k, v] of Object.entries(t)) {
      if (typeof v === 'number') assert.ok(!/score|ats/i.test(k), `${t.id}.${k} looks like a fake score`);
    }
  }
  // The real deterministic scorer lives server-side and stays untouched.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../server/utils/resume/scoringEngine.js', import.meta.url), 'utf8');
  assert.ok(src.length > 200, 'backend scoring engine present');
});

/* ===================== stabilization-pass regression suite =====================
   Covers: (1) the false "hidden content" export bug — validation hosts must use
   opacity, never visibility:hidden; (2) export gating on pending/invalid
   reports; (3) the tailor→editor handoff contract; (4) the new deterministic
   qualityChecks from the backend scoring engine. Pure logic only. */

test('VALIDATION_HOST_STYLE hides via opacity, never visibility:hidden', () => {
  assert.equal(typeof VALIDATION_HOST_STYLE, 'string');
  assert.ok(/opacity\s*:\s*0/.test(VALIDATION_HOST_STYLE), 'host must use opacity:0');
  assert.ok(!/visibility\s*:\s*hidden/.test(VALIDATION_HOST_STYLE),
    'visibility:hidden on the host inherits into pages and triggers false hidden-content errors');
});

test('isHiddenForValidation truth table is baseline-aware', () => {
  // inherited visibility:hidden (whole page hidden by an offscreen host) = measurement artifact, NOT flagged
  assert.equal(isHiddenForValidation({ visibility: 'hidden' }, { visibility: 'hidden' }), false);
  // display:none always flags, even on a hidden page
  assert.equal(isHiddenForValidation({ display: 'none' }, { visibility: 'hidden' }), true);
  assert.equal(isHiddenForValidation({ display: 'none' }, { visibility: 'visible' }), true);
  // element's OWN visibility:hidden on a visible page = real hidden content
  assert.equal(isHiddenForValidation({ visibility: 'hidden' }, { visibility: 'visible' }), true);
  // visible element never flags
  assert.equal(isHiddenForValidation({ visibility: 'visible', display: 'block' }, { visibility: 'visible' }), false);
  assert.equal(isHiddenForValidation({}, {}), false);
});

test('canExportLayout blocks pending and invalid reports, allows valid ones', () => {
  const pending = canExportLayout(null);
  assert.equal(pending.allowed, false);
  assert.equal(pending.pending, true);
  assert.ok(pending.reason.length > 0);

  const invalid = canExportLayout({ valid: false, errors: ['overlap'] });
  assert.equal(invalid.allowed, false);
  assert.equal(invalid.pending, false);
  assert.ok(invalid.reason.length > 0);

  const valid = canExportLayout({ valid: true, errors: [], warnings: ['minor'] });
  assert.equal(valid.allowed, true);   // warnings never block
  assert.equal(valid.pending, false);
});

test('buildEditorHandoff maps legacy template ids and defaults length to Auto', () => {
  const p = buildEditorHandoff({
    tailoredText: 'TAILORED', originalText: 'ORIGINAL', jobDescription: 'JD',
    templateId: 'two-col-tech', length: 'nonsense',
  });
  assert.equal(p.out, 'TAILORED');
  assert.equal(p.resume, 'ORIGINAL');
  assert.equal(p.jd, 'JD');
  assert.notEqual(p.tpl, 'two-col-tech');                       // legacy id mapped…
  assert.ok(RESUME_TEMPLATES.some((t) => t.id === p.tpl), '…to a registry id');
  assert.equal(p.len, 'Auto');                                  // invalid length -> Auto
  // when only tailored text exists it becomes the editor source too
  assert.equal(buildEditorHandoff({ tailoredText: 'X' }).resume, 'X');
  assert.equal(buildEditorHandoff({ tailoredText: 'X', length: 'Single page' }).len, 'Single page');
});

/* ----------------- backend deterministic quality checks ----------------- */

const BAD_RESUME = `John Doe
john@example.com | 9999999999

Experience
Software Developer, Acme Corp
• Responsible for maintaining the data pipeline
• Worked on various ETL jobs
• Helped with deployments and releases
• Involved in team meetings and planning
`;

const GOOD_RESUME = `Jane Smith
jane@example.com | 8888888888 | linkedin.com/in/janesmith | github.com/janesmith | Pune

Summary
Cloud Data Engineer with 4 years of experience designing and operating AWS data platforms for banking and financial services. Strong background in distributed batch and streaming processing with Spark and Kafka, lakehouse architecture with Iceberg, warehouse modelling on Snowflake, and infrastructure automation with Terraform. Known for owning pipelines end to end, from ingestion contracts and orchestration through cost optimization, observability and on-call operations.

Skills
AWS, Spark, PySpark, Python, SQL, Airflow, Snowflake, Iceberg, Kafka, Docker, Terraform, Glue, EMR, S3, Lambda, Redshift, dbt, Git, Linux

Experience
Data Engineer, FinBank (2021–present)
• Migrated a 12 TB on-premise Hadoop warehouse to AWS EMR and S3, reducing nightly batch runtime by 40% and retiring 6 legacy clusters
• Built PySpark pipelines processing 5 million transaction records daily with a 99.9% SLA, with idempotent reruns and automated data quality gates
• Automated environment provisioning with Terraform modules and CI pipelines, cutting setup time for new data products by 60%
• Optimized Snowflake warehouses and clustering keys, saving $18,000 per year in compute while improving p95 query latency by 35%
• Designed Airflow DAG standards adopted by 4 teams, reducing failed runs by 30% through retries, SLAs and alerting conventions
• Mentored 3 junior engineers on Spark performance tuning and code review practices

Associate Data Engineer, RetailCo (2020–2021)
• Developed incremental ingestion jobs in Python and SQL for 20+ source systems, replacing fragile full reloads
• Reduced warehouse storage costs by 25% by introducing partitioning, lifecycle policies and columnar formats
• Implemented dbt models and tests covering 150+ tables, improving data trust and cutting reconciliation effort by half
• Established CloudWatch and Grafana dashboards for pipeline health, bringing mean time to detection for data incidents down from hours to under 15 minutes
• Partnered with risk and compliance teams to implement column-level masking and audit logging across regulated datasets

Projects
• Designed a Kafka streaming pipeline handling 50,000 events per second with exactly-once semantics into an Iceberg lakehouse
• Built an open-source Airflow operator for Snowflake cost reporting used by 200+ downloads per month

Education
B.Tech Computer Science, Pune University

Certifications
AWS Solutions Architect Associate
Snowflake SnowPro Core
`;

test('scoreResume returns 0–100 score/ats plus a deterministic qualityChecks array', () => {
  const r = scoreResume({ resumeText: GOOD_RESUME, targetRole: 'Data Engineer' });
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(r.ats >= 0 && r.ats <= 100);
  assert.ok(Array.isArray(r.qualityChecks));
  for (const c of r.qualityChecks) {
    assert.equal(typeof c.type, 'string');
    assert.ok(['high', 'medium', 'info'].includes(c.severity), `bad severity ${c.severity}`);
    assert.equal(typeof c.detail, 'string');
  }
  assert.equal(SCORING_VERSION, 'resume-score-v3'); // cache invalidation for the new checks
  // determinism: identical input -> identical checks
  const r2 = scoreResume({ resumeText: GOOD_RESUME, targetRole: 'Data Engineer' });
  assert.deepEqual(r.qualityChecks, r2.qualityChecks);
});

test('qualityChecks flags weak bullets and missing metrics on a bad sample', () => {
  const r = scoreResume({ resumeText: BAD_RESUME, targetRole: 'Data Engineer' });
  const types = r.qualityChecks.map((c) => c.type);
  assert.ok(types.includes('weak_bullets'), 'weak openers must be flagged');
  const weak = r.qualityChecks.find((c) => c.type === 'weak_bullets');
  assert.equal(weak.severity, 'high'); // 3+ weak bullets
  assert.ok(/responsible for/.test(weak.detail), 'detail cites an example bullet');
  assert.ok(types.includes('no_metrics') || types.includes('few_metrics'), 'metric absence must be flagged');
  assert.ok(types.includes('missing_section'), 'missing skills/education must be flagged');
});

test('qualityChecks stays clean of bullet/metric flags on a strong resume', () => {
  const r = scoreResume({ resumeText: GOOD_RESUME, targetRole: 'Data Engineer' });
  const types = r.qualityChecks.map((c) => c.type);
  assert.ok(!types.includes('weak_bullets'), 'no weak openers in the good sample');
  assert.ok(!types.includes('no_metrics'), 'good sample is fully quantified');
  assert.ok(!types.includes('keyword_stuffing'), 'evidenced skills are not stuffing');
  assert.ok(!types.includes('length_risk'));
  // only info-level findings (if any) remain
  assert.ok(r.qualityChecks.every((c) => c.severity === 'info'),
    `unexpected non-info findings: ${JSON.stringify(r.qualityChecks)}`);
});
