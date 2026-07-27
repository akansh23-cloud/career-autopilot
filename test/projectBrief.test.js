// Tests for the project-brief layer:
//   - discipline detection (web app vs sensor rig vs lab protocol vs …)
//   - the deterministic brief (must be complete with NO AI key set)
//   - convertToProject producing discipline-shaped output instead of the
//     old one-size-fits-all MERN template
//
// These run with no API key configured, which is the important case: the
// brief must be complete and honest about being templated.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectDiscipline, DISCIPLINES, hasSoftwareComponent } from '../server/services/projectBrief/disciplineProfiles.js';
import { buildProjectBrief, deterministicBrief } from '../server/services/projectBrief/projectBriefService.js';
import { convertToProject, convertToProjectDeterministic } from '../server/utils/disclosureEngine.js';

const SENSOR_RIG = {
  title: 'Soil moisture sensor grid for smallholder farms',
  domain: 'Agriculture',
  targetUser: 'Small farmer',
  problem: 'Farmers irrigate on a fixed schedule and waste water',
  technicalMechanism: 'ESP32 microcontroller nodes with capacitive soil sensors over LoRa, calibrated per plot',
};

const LAB_PROTOCOL = {
  title: 'Rapid biomarker assay for early sepsis',
  domain: 'Healthcare',
  problem: 'Sepsis is detected too late in district hospitals',
  technicalMechanism: 'An in vitro assay using an enzyme reagent and a colourimetric readout, validated against PCR',
};

const WEB_APP = {
  title: 'Resume screening fairness auditor',
  domain: 'HRTech',
  targetUser: 'Recruiter',
  problem: 'Screening tools silently encode bias',
  technicalMechanism: 'A web app with a React frontend, REST API and a database of candidate records',
};

const ML_PROJECT = {
  title: 'Crop disease classifier from phone photos',
  problem: 'Farmers cannot identify leaf disease early',
  technicalMechanism: 'A computer vision deep learning classifier trained on a labelled dataset, reporting precision and recall',
};

const BRIDGE = {
  title: 'Crack detection in RC bridge girders',
  problem: 'Manual bridge inspection misses early cracks',
  technicalMechanism: 'Structural assessment of reinforced concrete against IS code seismic load cases using geotechnical survey data',
};

/* ---------------- discipline detection ---------------- */

test('sensor / embedded projects are classified as hardware, not software', () => {
  const d = detectDiscipline(SENSOR_RIG);
  assert.equal(d.id, 'hardware');
  assert.equal(d.confidence, 'high');
});

test('lab protocols are classified as bio_chem', () => {
  assert.equal(detectDiscipline(LAB_PROTOCOL).id, 'bio_chem');
});

test('web apps are still classified as software', () => {
  assert.equal(detectDiscipline(WEB_APP).id, 'software');
});

test('ML projects are separated from generic software', () => {
  assert.equal(detectDiscipline(ML_PROJECT).id, 'data_ml');
});

test('structural / civil projects are classified as civil_infra', () => {
  assert.equal(detectDiscipline(BRIDGE).id, 'civil_infra');
});

test('an unrecognisable project falls back to software with LOW confidence', () => {
  const d = detectDiscipline({ title: 'A thing', problem: 'Something is annoying' });
  assert.equal(d.id, 'software');
  assert.equal(d.confidence, 'low');
});

test('an explicit discipline override always wins', () => {
  const d = detectDiscipline({ ...WEB_APP, discipline: 'mechanical' });
  assert.equal(d.id, 'mechanical');
  assert.equal(d.source, 'explicit');
});

test('every discipline profile is complete', () => {
  for (const [id, p] of Object.entries(DISCIPLINES)) {
    assert.equal(p.id, id);
    for (const key of ['label', 'buildUnit', 'runMeans', 'validation', 'costNote']) {
      assert.ok(String(p[key] || '').length > 5, `${id}.${key} missing`);
    }
    for (const key of ['toolchain', 'firstWeek', 'proofArtifacts']) {
      assert.ok(Array.isArray(p[key]) && p[key].length >= 3, `${id}.${key} too thin`);
    }
  }
});

test('hasSoftwareComponent is true for software and ML, false for a pure rig', () => {
  assert.equal(hasSoftwareComponent(detectDiscipline(WEB_APP), WEB_APP), true);
  assert.equal(hasSoftwareComponent(detectDiscipline(ML_PROJECT), ML_PROJECT), true);
  assert.equal(hasSoftwareComponent(detectDiscipline(SENSOR_RIG), SENSOR_RIG), false);
});

/* ---------------- deterministic brief ---------------- */

test('deterministic brief is complete with no AI key', () => {
  const b = deterministicBrief(SENSOR_RIG);
  for (const key of ['oneLine', 'inPlainEnglish', 'whoIsItFor', 'problemInOneParagraph', 'whatSuccessLooksLike', 'howYouKnowItWorks', 'commonFailureMode']) {
    assert.ok(String(b[key] || '').length > 20, `${key} is empty or too short`);
  }
  assert.ok(b.howItWorks.length >= 3);
  assert.ok(b.firstWeek.length >= 3);
  assert.ok(b.glossary.length >= 1);
});

test('brief never claims AI authorship when templated', async () => {
  const b = await buildProjectBrief({ project: SENSOR_RIG });
  assert.ok(['deterministic', 'fallback'].includes(b.generatedBy), `unexpected provider: ${b.generatedBy}`);
  assert.equal(b.confidence, 'low');
});

test('a non-software brief warns that generic web-app steps do not apply', () => {
  const b = deterministicBrief(SENSOR_RIG);
  assert.ok(b.note && /not a web app/i.test(b.note));
  assert.equal(b.softwareComponent, false);
});

test('a software brief carries no such warning', () => {
  const b = deterministicBrief(WEB_APP);
  assert.equal(b.note, null);
});

test('discipline-specific first-week guidance differs per discipline', () => {
  const hw = deterministicBrief(SENSOR_RIG).firstWeek.join(' ');
  const ml = deterministicBrief(ML_PROJECT).firstWeek.join(' ');
  const bio = deterministicBrief(LAB_PROTOCOL).firstWeek.join(' ');
  assert.match(hw, /bill of materials|BOM/i);
  assert.match(ml, /baseline/i);
  assert.match(bio, /hypothesis/i);
  assert.notEqual(hw, ml);
  assert.notEqual(ml, bio);
});

test('brief generation never throws on junk input', async () => {
  await assert.doesNotReject(() => buildProjectBrief({ project: {} }));
  await assert.doesNotReject(() => buildProjectBrief({}));
  assert.doesNotThrow(() => deterministicBrief());
});

/* ---------------- convertToProject ---------------- */

test('convertToProject attaches a brief', async () => {
  const p = await convertToProject(SENSOR_RIG);
  assert.ok(p.brief, 'no brief attached');
  assert.ok(p.brief.inPlainEnglish.length > 40);
});

test('a hardware invention gets NO frontend screens, APIs or DB schema', async () => {
  const p = await convertToProject(SENSOR_RIG);
  assert.equal(p.discipline, 'hardware');
  assert.equal(p.hasSoftwareComponent, false);
  assert.equal(p.frontendScreens, undefined);
  assert.equal(p.backendApis, undefined);
  assert.equal(p.databaseSchema, undefined);
  assert.ok(p.workProducts.some((w) => /bill of materials/i.test(w)), 'expected a BOM work product');
});

test('a software invention still gets the software scaffolding', async () => {
  const p = await convertToProject(WEB_APP);
  assert.equal(p.discipline, 'software');
  assert.ok(Array.isArray(p.backendApis) && p.backendApis.length);
  assert.ok(Array.isArray(p.databaseSchema) && p.databaseSchema.length);
});

test('different inventions no longer produce identical core features', () => {
  const a = convertToProjectDeterministic(SENSOR_RIG);
  const b = convertToProjectDeterministic(LAB_PROTOCOL);
  const c = convertToProjectDeterministic(BRIDGE);
  assert.notDeepEqual(a.coreFeatures, b.coreFeatures);
  assert.notDeepEqual(b.coreFeatures, c.coreFeatures);
  assert.notDeepEqual(a.testPlan, b.testPlan);
  assert.notEqual(a.technicalArchitecture, b.technicalArchitecture);
});

test('the POC plan explains what the project actually is', async () => {
  for (const idea of [SENSOR_RIG, LAB_PROTOCOL, BRIDGE, WEB_APP, ML_PROJECT]) {
    const p = await convertToProject(idea);
    assert.ok(String(p.whatYouAreBuilding || '').length > 40, `${idea.title}: no explanation`);
    assert.ok(p.howYouKnowItWorks, `${idea.title}: no validation criterion`);
    assert.ok(p.toolchain?.length, `${idea.title}: no toolchain`);
  }
});

test('convertToProject keeps its legacy fields for existing consumers', async () => {
  const p = await convertToProject(WEB_APP);
  for (const key of ['projectTitle', 'mvpDescription', 'userPersonas', 'coreFeatures', 'technicalArchitecture', 'testPlan', 'demoScript', 'evidenceChecklist', 'resumeBullets', 'readmeOutline', 'disclaimer']) {
    assert.ok(p[key] !== undefined, `legacy field "${key}" was dropped`);
  }
});

test('convertToProject never throws on an empty idea', async () => {
  await assert.doesNotReject(() => convertToProject({}));
  assert.doesNotThrow(() => convertToProjectDeterministic({}));
});
