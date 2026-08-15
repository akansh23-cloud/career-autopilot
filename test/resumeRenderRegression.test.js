/* ============================================================
   RESUME RENDER — REGRESSION GATE
   ------------------------------------------------------------
   These lock down two failures that reached a user's screen at
   the same time, and that between them explain everything wrong
   with the reported preview:

     "AKANSH MOWAR Pune, India | +91 ... | ...gmail.com lin"
     "Early-career engineer with project experience in."

   1. EVERY registered template must compile.

      fromLegacyTemplate() stamps a `migration` provenance block
      onto each adapted definition, but the DSL allowlist did not
      include `migration` — so 28 of 51 templates failed
      validation, and the preview silently fell back to the legacy
      renderer, which is what produced the run-together header.

      A template that does not compile is not a styling problem.
      It is a template that is not being used at all.

   2. A summary structure with an empty slot must be SKIPPED.

      joinList() returns '' for an empty list, so a structure that
      interpolated it after a preposition emitted a sentence
      ending in a dangling "in." — grammatically broken text on
      the most-read line of a resume.

   Both are cheap to assert and were expensive to miss.
   ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileTemplate, buildLayoutHTML, fromLegacyTemplate, adaptTreeToShape,
  balancePageComposition, normalizeResumeDensityToTemplateMode, analyzeResumeShape,
} from '../web/src/lib/templateOs/index.js';
import { RESUME_TEMPLATES, getResumeTemplate } from '../web/src/lib/resumeTemplateRegistry.js';
import { fromStructuredResume, toRendererStructured } from '../server/utils/resume/resumeDocument.js';
import { composeSummary } from '../server/utils/resume/narrative/summaryComposer.js';

function templateList() {
  return Array.isArray(RESUME_TEMPLATES) ? RESUME_TEMPLATES : Object.values(RESUME_TEMPLATES || {});
}

function definitionFor(id) {
  const tpl = getResumeTemplate(id);
  return tpl.engine === 'template-os' ? tpl.definition : fromLegacyTemplate(tpl);
}

const SAMPLE = {
  personalInfo: {
    name: 'Akansh Mowar',
    email: 'mowar23akansh@gmail.com',
    phone: '+91 8077192012',
    location: 'Pune, India',
    linkedin: 'https://linkedin.com/in/akansh',
  },
  summary: 'Platform engineer focused on CI/CD and Kubernetes.',
  skills: ['Docker', 'Kubernetes', 'Terraform'],
  experience: [{
    company: 'Barclays', role: 'DevOps Engineer', dates: '2022 — present',
    bullets: ['Automated deployment pipelines across 12 services'],
  }],
  projects: [],
  education: [{ degree: 'B.Tech', school: 'UPES Dehradun' }],
};

/* ==================== template compilation ==================== */

test('RESUME_RENDER_GATE — every registered template compiles', () => {
  const failures = [];
  for (const t of templateList()) {
    const compiled = compileTemplate(definitionFor(t.id), {});
    if (!compiled.ok) {
      failures.push(`${t.id}: ${(compiled.validation?.errors || []).slice(0, 3).join('; ')}`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `templates that fail validation silently fall back to the legacy renderer:\n  ${failures.join('\n  ')}`,
  );
  assert.ok(templateList().length >= 40, 'the registry should still hold the full catalogue');
});

test('RESUME_RENDER_GATE — the legacy adapter emits a definition the DSL accepts', () => {
  /* The adapter and the validator are two halves of one contract. This is the
     specific seam that broke: the adapter added a field the validator had
     never been told about. */
  const legacy = templateList().find((t) => getResumeTemplate(t.id).engine !== 'template-os');
  if (!legacy) return; // catalogue is fully native — nothing to check

  const def = fromLegacyTemplate(getResumeTemplate(legacy.id));
  assert.ok(def.migration, 'the adapter records provenance');
  assert.ok(def.migration.sourceTemplateId, 'provenance names the template it came from');

  const compiled = compileTemplate(def, {});
  assert.equal(compiled.ok, true, `adapter output must validate: ${(compiled.validation?.errors || []).join('; ')}`);
});

test('RESUME_RENDER_GATE — provenance is validated, not merely tolerated', () => {
  const def = { ...definitionFor(templateList()[0].id), migration: { classification: 'x', bogusField: 1 } };
  const compiled = compileTemplate(def, {});
  assert.equal(compiled.ok, false, 'an unknown key inside migration must still be rejected');
  assert.ok(compiled.validation.errors.some((e) => /migration.*bogusField/.test(e)));
});

test('RESUME_RENDER_GATE — a failed compile reports its own errors, not second-order noise', () => {
  const failed = { ok: false, validation: { errors: ['definition contains unsupported field "migration"'] } };
  assert.throws(
    () => buildLayoutHTML(failed, {}),
    /unsupported field "migration"/,
    'the error must name the real problem so this class of bug is findable',
  );
});

/* ==================== rendered output ==================== */

function renderWith(templateId, data) {
  const doc = fromStructuredResume(data);
  doc.templateId = templateId;
  doc.pageSize = 'a4';
  const structured = toRendererStructured(doc);
  const compiled = compileTemplate(definitionFor(templateId), {
    density: normalizeResumeDensityToTemplateMode(doc.density),
  });
  assert.equal(compiled.ok, true, `${templateId} failed to compile`);
  const laidOut = balancePageComposition(
    adaptTreeToShape(compiled, analyzeResumeShape(doc)),
    structured,
    { sizeId: doc.pageSize },
  );
  return buildLayoutHTML(laidOut, structured, { sizeId: doc.pageSize });
}

test('RESUME_RENDER_GATE — the header renders as a name and a separated contact line', () => {
  const html = renderWith('fresher-project-first', SAMPLE);

  /* The reported bug was the name and every contact field colliding into one
     run-on line, with the link label truncated to "lin". */
  assert.match(html, /<h1[^>]*>Akansh Mowar<\/h1>/, 'the name is its own heading');

  const header = html.match(/<header[\s\S]*?<\/header>/i);
  assert.ok(header, 'a header element is emitted');
  const headerHtml = header[0];

  for (const field of ['mowar23akansh@gmail.com', '+91 8077192012', 'Pune, India']) {
    assert.ok(headerHtml.includes(field), `header is missing ${field}`);
  }
  /* Each contact field in its own element, with real separators between them —
     not concatenated into the name. */
  const contactSpans = (headerHtml.match(/<span>/g) || []).length;
  assert.ok(contactSpans >= 3, `contact fields must be separate elements, found ${contactSpans}`);
  assert.ok(!/Akansh Mowar\s*Pune/.test(headerHtml), 'the name must not run into the contact line');
});

test('RESUME_RENDER_GATE — body sections render, not just the header', () => {
  const html = renderWith('fresher-project-first', SAMPLE);
  assert.ok(html.includes('Barclays'), 'experience is rendered');
  assert.ok(html.includes('Automated deployment pipelines'), 'bullets are rendered');
  assert.ok(html.includes('UPES Dehradun'), 'education is rendered');
  assert.ok(html.includes('Kubernetes'), 'skills are rendered');
});

test('RESUME_RENDER_GATE — every template renders the same content without throwing', () => {
  const failures = [];
  for (const t of templateList()) {
    try {
      const html = renderWith(t.id, SAMPLE);
      if (!html.includes('Akansh Mowar')) failures.push(`${t.id}: name missing from output`);
    } catch (e) {
      failures.push(`${t.id}: ${e.message}`);
    }
  }
  assert.deepEqual(failures, [], `templates that fail to render:\n  ${failures.join('\n  ')}`);
});

/* ==================== summary slots ==================== */

const DANGLING = /\b(in|on|with|across|for|of|and|to|at|using|including|covering|spanning|combining|from|by)\s*[.,;:]\s*$/i;

function summaryFor({ skills = [], education = [], projects = [] } = {}) {
  const doc = fromStructuredResume({
    personalInfo: { name: 'Akansh Mowar' },
    summary: '', skills, education, projects, experience: [],
  });
  const graph = { records: [], permittedSkills: new Set(), permittedTerms: new Set(), evidence: [] };
  const intelligence = { seniority: 'student', coreTechnologies: skills.map((s) => ({ skill: s })) };
  return composeSummary(doc, graph, intelligence, { userKey: 'regression' });
}

test('RESUME_RENDER_GATE — a summary never ends on a dangling preposition', () => {
  const cases = [
    ['no data at all', {}],
    ['education only', { education: [{ degree: 'B.Tech', school: 'UPES Dehradun' }] }],
    ['a project but no named technologies', { projects: [{ name: 'CI pipeline', bullets: ['Built a deploy pipeline'] }] }],
    ['technologies present', { skills: ['Docker', 'Kubernetes', 'AWS'] }],
  ];

  for (const [label, input] of cases) {
    const out = summaryFor(input);
    const texts = [out?.text, ...(out?.candidates || []).map((c) => c.text)].filter(Boolean);
    for (const text of texts) {
      assert.ok(
        !DANGLING.test(text.trim()),
        `${label}: summary ends on a dangling connector — "${text}"`,
      );
      assert.ok(!/\s{2,}\./.test(text), `${label}: collapsed slot left a gap — "${text}"`);
    }
  }
});

test('RESUME_RENDER_GATE — a sparse profile still gets a usable summary', () => {
  /* Skipping a structure must not mean skipping the summary. The fallback shape
     says only what is known, and says it in a complete sentence. */
  const bare = summaryFor({});
  const bareText = bare?.text || bare?.candidates?.[0]?.text || '';
  assert.ok(bareText.length > 0, 'a profile with nothing on file still gets a sentence');
  assert.match(bareText, /\.$/, 'and it is a complete sentence');

  const grad = summaryFor({ education: [{ degree: 'B.Tech', school: 'UPES Dehradun' }] });
  const gradText = grad?.text || grad?.candidates?.[0]?.text || '';
  assert.match(gradText, /B\.Tech/, 'known facts are used when they exist');
});

test('RESUME_RENDER_GATE — technologies are listed properly when they exist', () => {
  const out = summaryFor({ skills: ['Docker', 'Kubernetes', 'AWS'] });
  const texts = [out?.text, ...(out?.candidates || []).map((c) => c.text)].filter(Boolean);
  const listed = texts.find((t) => /Docker/.test(t));
  assert.ok(listed, 'a real technology list is rendered when the facts support it');
  assert.match(listed, /Docker.*(and|,).*(Kubernetes|AWS)/, 'the list reads as prose, not a fragment');
});

/* ==================== the Editor's own data shape ==================== */

/* The Editor holds PARSED plain-text data; ResumeStudio holds STRUCTURED data.
   Both render through the same component. fromStructuredResume() reads
   `personalInfo`, so handing it the parsed shape does not throw — it yields an
   empty document and a blank A4 page. That is strictly worse than a crash,
   because nothing surfaces it. */

import { parseResume } from '../web/src/lib/resumeTemplates.js';
import { fromParsedResume, isParsedResumeShape } from '../web/src/lib/parsedResumeAdapter.js';

const EDITOR_TEXT = `Akansh Mowar
Pune, India | +91 8077192012 | mowar23akansh@gmail.com | linkedin.com/in/akansh

SUMMARY
Early-career engineer with project experience in Docker and Kubernetes.

SKILLS
Docker, Kubernetes, Terraform, AWS

EXPERIENCE
DevOps Engineer | Barclays | 2022 - present
- Automated deployment pipelines across 12 services
- Reduced release time from 40 minutes to 9

EDUCATION
B.Tech | UPES Dehradun | 2022`;

test('RESUME_RENDER_GATE — the two resume shapes are distinguished', () => {
  assert.equal(isParsedResumeShape(parseResume(EDITOR_TEXT)), true);
  assert.equal(isParsedResumeShape(SAMPLE), false, 'structured input must be left alone');
  /* Idempotent: applying the adapter to structured data returns it unchanged. */
  assert.equal(fromParsedResume(SAMPLE), SAMPLE);
});

test('RESUME_RENDER_GATE — parsed Editor content survives the trip to structured', () => {
  const structured = fromParsedResume(parseResume(EDITOR_TEXT));

  assert.equal(structured.personalInfo.name, 'Akansh Mowar');
  assert.equal(structured.personalInfo.email, 'mowar23akansh@gmail.com');
  assert.equal(structured.personalInfo.phone, '+91 8077192012');
  assert.equal(structured.personalInfo.location, 'Pune, India');
  assert.match(structured.personalInfo.linkedin, /linkedin\.com/, 'LinkedIn must be typed, not dumped into overflow links');

  assert.equal(structured.experience.length, 1);
  assert.equal(structured.experience[0].role, 'DevOps Engineer');
  assert.equal(structured.experience[0].company, 'Barclays');
  assert.equal(structured.experience[0].bullets.length, 2);
  assert.equal(structured.education.length, 1);
  assert.ok(structured.skills.includes('Kubernetes'));
});

test('RESUME_RENDER_GATE — the Editor preview renders a full resume, not a blank page', () => {
  const html = renderWith('fresher-project-first', fromParsedResume(parseResume(EDITOR_TEXT)));
  const plain = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  for (const expected of [
    'Akansh Mowar', 'mowar23akansh@gmail.com', '+91 8077192012', 'Pune, India',
    'Barclays', 'Automated deployment pipelines', 'UPES Dehradun', 'Kubernetes',
  ]) {
    assert.ok(plain.includes(expected), `the rendered preview is missing "${expected}"`);
  }
  assert.ok(plain.length > 200, 'a populated resume must not render as a near-empty page');
});

test('RESUME_RENDER_GATE — an internal skill bucket is never printed as a heading', () => {
  /* Ungrouped skills land in an internal "other" bucket. Printing that bucket
     name puts the literal word "other" on the candidate's resume. */
  const html = renderWith('fresher-project-first', fromParsedResume(parseResume(EDITOR_TEXT)));
  const plain = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(!/\bSkills\s+other\b/i.test(plain), 'the internal group label leaked into the resume');
  assert.ok(plain.includes('Docker'), 'the skills themselves still render');
});

test('RESUME_RENDER_GATE — an unrecognised section is preserved, never dropped', () => {
  const withCustom = parseResume(`${EDITOR_TEXT}

VOLUNTEERING
Mentor | GDG Pune | 2023
- Mentored 20 students through their first deployment`);
  const structured = fromParsedResume(withCustom);
  const custom = JSON.stringify(structured.customSections || []);
  assert.match(custom, /GDG Pune|Mentor/, 'content under an unknown heading must survive the conversion');
});
