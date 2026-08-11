import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTION_KEYS, validateTemplateDefinition } from '../web/src/lib/templateOs/dsl.js';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { compileTemplate, buildLayoutHTML, CANONICAL_ORDER, normalizeStructuredContent, LAYOUT_COMPILER_VERSION } from '../web/src/lib/templateOs/compiler.js';
import { renderTemplatePdf, PDF_WRITER_VERSION } from '../web/src/lib/templateOs/pdfWriter.js';
import { analyzeResumeShape, expectedOrderAnchors, RESUME_SHAPE_VERSION } from '../web/src/lib/templateOs/shape.js';
import { normalizeResumeDocument, toRendererStructured } from '../server/utils/resume/resumeDocument.js';
import { VERB_DICTIONARY, verbAlternatives, verbInfo } from '../server/utils/resume/grammarLibrary.js';
import { actionVerbsFor } from '../server/utils/resume/roleDictionaries.js';
import { toRegistryCard } from '../web/src/lib/templateOs/adapter.js';

function richDocument() {
  return normalizeResumeDocument({
    id:'phase21-rich', targetRole:'Principal Platform Engineer',
    contact:{
      name:'Aarav Mehta', title:'Principal Platform Engineer', email:'aarav@example.com', phone:'+91 98000 11111',
      location:'Pune, India', linkedin:'linkedin.com/in/aaravmehta', github:'github.com/aaravmehta',
      portfolio:'aaravmehta.dev', links:['speakerdeck.com/aaravmehta'],
    },
    summary:'Platform engineer focused on reliable cloud delivery, Kubernetes operations and infrastructure automation across enterprise environments.',
    skills:[
      {name:'AWS',group:'Cloud'},{name:'Kubernetes',group:'Cloud'},{name:'Terraform',group:'Infrastructure'},{name:'GitLab CI',group:'Delivery'},
      {name:'Prometheus',group:'Observability'},{name:'Python',group:'Languages'},
    ],
    experience:[
      {company:'Northstar Systems',role:'Principal Platform Engineer',dates:'2022 – Present',current:true,bullets:[
        {text:'Standardized Kubernetes delivery across 28 services using Terraform and GitLab CI.'},
        {text:'Instrumented platform health with Prometheus and service-level dashboards.'},
      ]},
      {company:'CloudForge',role:'Senior DevOps Engineer',dates:'2019 – 2022',bullets:[{text:'Migrated production workloads to managed Kubernetes with documented rollback controls.'}]},
    ],
    projects:[{name:'Release Evidence Platform',techStack:'Node.js, Kubernetes, PostgreSQL',link:'github.com/aarav/release-evidence',verified:true,bullets:[{text:'Built deterministic release evidence capture for deployment audits.'}]}],
    education:[{school:'BITS Pilani',degree:'M.Tech Software Systems',dates:'2020 – 2022',details:['Work-integrated programme']}],
    certifications:[{text:'AWS Certified Solutions Architect – Professional'}],
    achievements:[{text:'Recognized for cross-team production release leadership.'}],
    publications:[
      {text:'“Operational evidence for progressive delivery”, Platform Engineering Review, 2025.'},
      {text:'“Practical rollback design for Kubernetes releases”, Internal Engineering Journal, 2024.'},
    ],
    patents:[{text:'IN-2025-PLT-1042 — Policy-aware deployment evidence correlation (filed).'}],
    volunteer:[{text:'Mentor, Cloud Native Pune — monthly infrastructure workshops for early-career engineers.'}],
    languages:[{text:'English — Professional'},{text:'Hindi — Native'},{text:'Marathi — Conversational'}],
    customSections:[
      {title:'Speaking',items:[{text:'Platform Engineering Summit 2025 — “Designing auditable delivery pipelines”.'}]},
      {title:'Professional Memberships',items:[{text:'Cloud Native Computing Foundation — community participant.'}]},
    ],
  });
}

const editorial = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'editorial-professional');

test('Phase 21 DSL and canonical compiler cover every canonical ResumeDocument section', () => {
  for (const key of ['publications','patents','volunteer','languages','customSections']) assert.ok(SECTION_KEYS.includes(key), key);
  for (const key of ['publications','patents','volunteer','languages','customSections']) assert.ok(CANONICAL_ORDER.includes(key), key);
  const compiled = compileTemplate(editorial);
  assert.equal(compiled.ok, true);
  assert.equal(LAYOUT_COMPILER_VERSION, 'layout-compiler-v18-reference-premium-families');
  const keys = compiled.tree.sections.map((s) => s.key);
  for (const key of CANONICAL_ORDER) assert.ok(keys.includes(key), `${key} missing from compiled tree`);
  assert.equal(new Set(keys).size, keys.length, 'compiler must not duplicate appended canonical sections');
});

test('TemplateDefinition can explicitly place new sections in approved regions', () => {
  const def = structuredClone(TEMPLATE_OS_BUILTINS.find((d) => d.id === 'balanced-two-column'));
  assert.equal(validateTemplateDefinition(def).ok, true);
  for (const key of ['publications','patents','volunteer','customSections']) assert.equal(def.sectionPlacement[key], 'right');
  assert.equal(def.sectionPlacement.languages, 'left');
});

test('ResumeDocument bridge exposes optional sections directly without losing legacy extraSections compatibility', () => {
  const structured = toRendererStructured(richDocument());
  assert.equal(structured.publications.length, 2);
  assert.equal(structured.patents.length, 1);
  assert.equal(structured.volunteer.length, 1);
  assert.equal(structured.languages.length, 3);
  assert.equal(structured.customSections.length, 2);
  assert.ok(structured.extraSections.some((s) => s.title === 'Volunteer'));
  assert.ok(structured.extraSections.some((s) => s.title === 'Languages'));
  const normalized = normalizeStructuredContent(structured);
  assert.equal(normalized.volunteer.length, 1, 'compatibility extraSections must not duplicate direct volunteer content');
  assert.equal(normalized.languages.length, 3, 'compatibility extraSections must not duplicate direct language content');
  assert.equal(normalized.customSections.length, 2);
});

test('HTML renders all optional sections, custom titles and additional contact links with premium semantic markup', () => {
  const structured = toRendererStructured(richDocument());
  const html = buildLayoutHTML(compileTemplate(editorial), structured);
  for (const key of ['publications','patents','volunteer','languages','customSections']) assert.match(html, new RegExp(`data-section="${key}"`));
  assert.match(html, /t-record-publications/);
  assert.match(html, /t-record-patents/);
  assert.match(html, /t-language-list/);
  assert.match(html, />Speaking</);
  assert.match(html, />Professional Memberships</);
  assert.match(html, /speakerdeck\.com\/aaravmehta/);
  assert.match(html, /Programming Languages/i, 'programming-language skills should be distinct from spoken Languages');
  assert.equal((html.match(/Mentor, Cloud Native Pune/g) || []).length, 1);
});

test('vector PDF renders the full optional section surface and stays within the template two-page capability', () => {
  const structured = toRendererStructured(richDocument());
  const pdf = renderTemplatePdf(compileTemplate(editorial), structured, { sizeId:'a4' });
  assert.equal(PDF_WRITER_VERSION, 'template-pdf-writer-v18-owned-pagination-reference-premium-families');
  assert.ok(pdf.pageCount >= 1 && pdf.pageCount <= 2, `unexpected ${pdf.pageCount} pages`);
  const raw = Buffer.from(pdf.bytes).toString('latin1');
  for (const title of ['PUBLICATIONS','PATENTS','VOLUNTEER EXPERIENCE','LANGUAGES','SPEAKING','PROFESSIONAL MEMBERSHIPS']) assert.ok(raw.includes(title), `${title} absent from PDF stream`);
  assert.ok(raw.includes('speakerdeck.com/aaravmehta'));
});

test('ResumeShape v4 counts optional-section pressure and reading-order anchors cover the new content', () => {
  const doc = richDocument();
  const shape = analyzeResumeShape(doc, { targetRole:'Principal Platform Engineer' });
  assert.equal(RESUME_SHAPE_VERSION, 'resume-shape-v4-full-sections');
  assert.equal(shape.publicationCount, 2);
  assert.equal(shape.patentCount, 1);
  assert.equal(shape.volunteerCount, 1);
  assert.equal(shape.languageCount, 3);
  assert.equal(shape.customSectionCount, 2);
  assert.ok(shape.optionalContentUnits > 5);
  const structured = toRendererStructured(doc);
  const anchors = expectedOrderAnchors(structured, CANONICAL_ORDER);
  assert.ok(anchors.some((x) => /Operational evidence/.test(x)));
  assert.ok(anchors.some((x) => /Policy-aware deployment/.test(x)));
  assert.ok(anchors.some((x) => /Speaking/.test(x)));
});

test('registry cards advertise the complete section surface for runtime templates', () => {
  const card = toRegistryCard(editorial);
  for (const title of ['Publications','Patents','Volunteer','Languages','Custom sections']) assert.ok(card.sections.includes(title));
});

test('Phase 21 vocabulary recognizes previously role-listed verbs and adds precise same-meaning families', () => {
  for (const word of ['provision','transform','query','forecast','reproduce','visualize','document','articulate','influence','triage','scale','train','predict','formalize','convey']) assert.ok(VERB_DICTIONARY[word], word);
  assert.equal(verbInfo('Provisioned')?.base, 'provision');
  const transform = verbAlternatives('transform', 10);
  assert.ok(transform.includes('redesign') && transform.includes('overhaul'));
  const document = verbAlternatives('document', 10);
  assert.ok(document.includes('articulate') && document.includes('catalogue'));
  const cloud = actionVerbsFor('Cloud Engineer');
  assert.ok(cloud.includes('provisioned'));
  assert.equal(verbInfo('provisioned')?.group, 'BUILD');
  assert.equal(verbInfo('scaled')?.group, 'SCALE');
  assert.equal(verbInfo('trained')?.group, 'TRAIN');
  assert.equal(verbInfo('predicted')?.group, 'PREDICT');
});
