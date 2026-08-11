import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATE_DSL_VERSION, TEMPLATE_SECURITY_VERSION, TEMPLATE_SECURITY_LIMITS, TEMPLATE_LICENSE_STATES,
  validateTemplateDefinition, sanitizeTemplateDefinition,
} from '../web/src/lib/templateOs/dsl.js';
import { PRIMITIVES } from '../web/src/lib/templateOs/primitives.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { compileTemplate, buildLayoutHTML, balancePageComposition, PAGE_COMPOSITION_VERSION } from '../web/src/lib/templateOs/compiler.js';
import { sanitizePackageCss, sanitizePackageMetadata, sanitizePackageText, unsafePackagePath, imageSignatureMatches, PACKAGE_SECURITY_VERSION } from '../server/utils/templateOs/packageSecurity.js';
import { assembleMasterProfile, seedResumeDocument, projectEvidenceBullets, PROJECT_BULLET_ENRICHMENT_VERSION } from '../server/utils/resume/masterProfileEngine.js';
import { toRendererStructured } from '../server/utils/resume/resumeDocument.js';
import { VERB_DICTIONARY, verbInfo, verbAlternatives } from '../server/utils/resume/grammarLibrary.js';
import { ROLE_ACTION_VERBS } from '../server/utils/resume/roleDictionaries.js';

const base = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');
const clone = (v) => structuredClone(v);

function sanitize(def) { return sanitizeTemplateDefinition(def, { primitives: PRIMITIVES }); }

test('Phase 22 strict DSL security validates all builtins against a closed allowlist', () => {
  assert.equal(TEMPLATE_DSL_VERSION, 'template-dsl-v2-strict');
  assert.equal(TEMPLATE_SECURITY_VERSION, 'template-security-v2-allowlist');
  assert.ok(TEMPLATE_SECURITY_LIMITS.maxDepth <= 10);
  for (const def of TEMPLATE_OS_BUILTINS) {
    const v = validateTemplateDefinition(def, { primitives: PRIMITIVES });
    assert.equal(v.ok, true, `${def.id}: ${v.errors.join('; ')}`);
    assert.equal(sanitize(def).ok, true, def.id);
  }
  assert.deepEqual(TEMPLATE_LICENSE_STATES, ['INTERNAL_ORIGINAL', 'OWNED', 'OPEN_SOURCE', 'LICENSED', 'LICENSE_PENDING', 'DEVELOPMENT_REFERENCE']);
  for (const state of TEMPLATE_LICENSE_STATES) {
    const def = clone(base); def.license = { ...def.license, licenseStatus: state, productionEnabled: state !== 'LICENSE_PENDING' && state !== 'DEVELOPMENT_REFERENCE' };
    assert.equal(sanitize(def).ok, true, `valid builder license state rejected: ${state}`);
  }
});

test('strict sanitizer rejects unknown fields and every CSS-reachable injection path', () => {
  const attacks = [
    (d) => { d.typography.font = 'Arial;position:fixed;inset:0'; },
    (d) => { d.colors.accent = '#fff;--tpl-text:#000'; },
    (d) => { d.spacing.marginMm = '10;display:none'; },
    (d) => { d.headerStyle.contactLayout = 'url(https://evil.example)'; },
    (d) => { d.visualStyle.sidebarPanel = 'not-a-real-primitive'; },
    (d) => { d.layout.columns[0].id = 'sidebar]{}body{display:none'; },
    (d) => { d.sectionOrder = ['summary', 'summary']; },
    (d) => { d.unknownRendererHook = 'anything'; },
    (d) => { d.description = 'safe\u202Eevil'; },
  ];
  for (const mutate of attacks) {
    const def = clone(base); mutate(def);
    const out = sanitize(def);
    assert.equal(out.ok, false, JSON.stringify(def));
    assert.ok(out.rejected.length > 0);
  }
});

test('strict sanitizer rejects prototype-manipulation, deep JSON and oversized arrays fail-closed', () => {
  const proto = JSON.parse(JSON.stringify(base));
  proto.colors.__protoPollutionSafeMarker = 'x'; // ordinary unknown nested key must be rejected
  assert.equal(sanitize(proto).ok, false);

  const parsed = JSON.parse(`{"id":"safe-x","name":"Safe","version":1,"category":"professional","layout":{"type":"single-column"},"__proto__":{"polluted":true}}`);
  assert.equal(sanitize(parsed).ok, false);
  assert.equal({}.polluted, undefined);

  const huge = clone(base);
  huge.tags = Array.from({ length: TEMPLATE_SECURITY_LIMITS.maxArrayItems + 1 }, (_, i) => `tag-${i}`);
  assert.equal(sanitize(huge).ok, false);

  const deep = clone(base);
  deep.certification = { certified: true, label: 'ok' };
  let cursor = deep;
  for (let i = 0; i < TEMPLATE_SECURITY_LIMITS.maxDepth + 2; i += 1) {
    cursor[`x${i}`] = {};
    cursor = cursor[`x${i}`];
  }
  assert.equal(sanitize(deep).ok, false);
});

test('package CSS is palette-only and package path/image guards are fail-closed', () => {
  assert.equal(PACKAGE_SECURITY_VERSION, 'template-package-security-v2-strict');
  const good = sanitizePackageCss(':root{--tpl-accent:#0f766e;--tpl-side:#eef;--tpl-text:#111827;}');
  assert.equal(good.ok, true);
  assert.equal(good.accepted['--tpl-accent'], '#0f766e');

  for (const css of [
    ':root{--tpl-accent:red}',
    ':root{--tpl-accent:#fff;} .t-page{display:none}',
    ':root{--tpl-accent:#fff;background:url(https://evil)}',
    '@import url(https://evil);:root{--tpl-accent:#fff}',
    ':root{--tpl-accent:#fff;--tpl-unknown:#000}',
  ]) assert.equal(sanitizePackageCss(css).ok, false, css);

  assert.equal(unsafePackagePath('../escape.png'), true);
  assert.equal(unsafePackagePath('/absolute.png'), true);
  assert.equal(unsafePackagePath('assets/logo.png'), false);
  assert.equal(imageSignatureMatches('logo.png', new Uint8Array([137,80,78,71,13,10,26,10])), true);
  assert.equal(imageSignatureMatches('logo.png', new TextEncoder().encode('<script>alert(1)</script>')), false);

  const meta = sanitizePackageMetadata({ source: 'Acme Design Co', licenseName: 'CC-BY-4.0', author: 'A. Designer', notes: 'Original package.' });
  assert.equal(meta.ok, true);
  assert.equal(meta.value.source, 'Acme Design Co');
  assert.equal(sanitizePackageMetadata({ source: '<img src=x onerror=alert(1)>' }).ok, false);
  assert.equal(sanitizePackageMetadata({ source: 'Acme', unexpected: 'renderer hook' }).ok, false);
  assert.equal(sanitizePackageText('Plain license text\nhttps://example.com', { maxChars: 100 }).ok, true);
  assert.equal(sanitizePackageText('unsafe\u202Etext', { maxChars: 100 }).ok, false);
});

test('premium composition never invents optional sections to consume whitespace', () => {
  assert.equal(PAGE_COMPOSITION_VERSION, 'page-composition-v3-intentional-whitespace');
  const doc = {
    personalInfo: { name: 'Nisha Rao', title: 'Software Engineer', email: 'nisha@example.com' },
    summary: 'Software engineer focused on reliable backend systems and delivery automation.',
    skills: [{ group: 'Backend', items: ['Node.js', 'PostgreSQL'] }],
    experience: [{ role: 'Software Engineer', company: 'Acme', dates: '2024 - Present', bullets: ['Built API workflows for internal teams.'] }],
    projects: [{ name: 'Release Tracker', tech: 'Node.js, PostgreSQL', bullets: ['Implemented release status tracking for deployment workflows.', 'Added searchable audit history for release events.', 'Documented rollback evidence for operational review.'] }],
    education: [{ school: 'ABC Institute', degree: 'B.Tech Computer Science', dates: '2020 - 2024' }],
    certifications: [], achievements: [], publications: [], patents: [], volunteer: [], languages: [], customSections: [],
  };
  const before = structuredClone(doc);
  const compiled = compileTemplate(TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional'));
  const composed = balancePageComposition(compiled, doc, { sizeId: 'a4' });
  const html = buildLayoutHTML(composed, doc);
  assert.deepEqual(doc, before, 'composition must not mutate or synthesize resume content');
  for (const key of ['publications', 'patents', 'volunteer', 'languages', 'customSections']) assert.ok(!html.includes(`data-section="${key}"`), key);
  assert.equal(composed.composition?.contentPolicy, 'spacing-only-no-synthetic-sections');
});

test('Project OS seed can preserve up to four distinct source-backed project pointers without inventing text', () => {
  const project = {
    sourceProjectId: 'p1', verified: true, evidenceIds: ['e1', 'e2', 'e3'],
    description: 'Automated release evidence collection across deployment workflows. Added deterministic rollback validation for failed releases. Documented release-state transitions for audit review.',
    outcome: 'Reduced manual release review effort by 40%.',
  };
  const bullets = projectEvidenceBullets(project, { maxBullets: 4 });
  assert.equal(PROJECT_BULLET_ENRICHMENT_VERSION, 'project-bullet-enrichment-v2-source-only-depth');
  assert.deepEqual(bullets.map((b) => b.text), [
    'Automated release evidence collection across deployment workflows.',
    'Reduced manual release review effort by 40%.',
    'Added deterministic rollback validation for failed releases.',
    'Documented release-state transitions for audit review.',
  ]);
  assert.ok(bullets.every((b) => b.verified && b.generatedByRule === PROJECT_BULLET_ENRICHMENT_VERSION));

  const master = assembleMasterProfile({
    profile: { name: 'Nisha Rao', skills: ['Kubernetes', 'GitLab CI'] },
    user: { email: 'nisha@example.com' },
    submissions: [{ _id: 'p1', title: 'Release Evidence Platform', technologies: ['Kubernetes', 'GitLab CI'], githubUrl: 'https://github.com/nisha/release', verificationStatus: 'verified', description: project.description, outcome: project.outcome }],
  });
  const seeded = seedResumeDocument(master, { targetRole: 'DevOps Engineer', templateId: 'cloud-infrastructure-pro' });
  assert.equal(seeded.projects[0].bullets.length, 4);
  const structured = toRendererStructured(seeded);
  assert.equal(structured.projects[0].bullets.length, 4);
});

test('Phase 22 vocabulary expands precise role language while every configured role verb remains recognized', () => {
  assert.ok(Object.keys(VERB_DICTIONARY).length >= 250);
  for (const word of ['rightsized', 'parallelized', 'systematized', 'parameterized', 'isolated', 'encrypted', 'segmented', 'derived', 'anticipated', 'inferred', 'upskilled', 'advocated', 'scaffolded', 'backfilled', 'partitioned', 'ingested', 'baselined', 'smoke-tested', 'load-tested', 'stress-tested', 'contained', 'masked', 'projected', 'simulated']) {
    assert.ok(verbInfo(word), word);
  }
  const optimize = verbAlternatives('optimize', 20);
  assert.ok(optimize.includes('rightsize') && optimize.includes('parallelize'));
  const train = verbAlternatives('train', 20);
  assert.ok(train.includes('upskill') && train.includes('educate'));
  for (const [role, verbs] of Object.entries(ROLE_ACTION_VERBS)) {
    for (const verb of verbs) assert.ok(verbInfo(verb), `${role}: ${verb}`);
  }
});
