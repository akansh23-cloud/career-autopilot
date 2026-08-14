import fs from 'node:fs';
import { FIXTURES } from '../test/fixtures/resumeNarrativeFixtures.js';
import { enhance } from '../server/services/resumeOs/resumeOsApplicationService.js';
import { toPlainText } from '../server/utils/resume/resumeDocument.js';

const strong = FIXTURES.find((x) => x.id === 'devops_engineer');
const fresher = FIXTURES.find((x) => x.id === 'fresher_software_engineer');
if (!strong || !fresher) throw new Error('fixtures missing');

function mockedFetch(payloadText) {
  return async () => ({
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: payloadText }] } }] }),
  });
}

const deterministic = await enhance({ doc: strong.doc, targetRole: strong.doc.targetRole, aiPolish: false });
const safePayload = JSON.stringify({ units: [{ bulletId: 'b1', candidates: [
  'Configured Java 17 service deployments across OpenShift environments with Helm and ConfigMaps.',
] }] });
const polished = await enhance({
  doc: strong.doc, targetRole: strong.doc.targetRole, aiPolish: true,
  env: { GEMINI_API_KEY: 'contract-test-key', GEMINI_RESUME_MODEL: 'gemini-3.6-flash' },
  fetchImpl: mockedFetch(safePayload),
});

const unsafePayload = JSON.stringify({ units: [{ bulletId: 'b1', candidates: [
  'Successfully designed a Spring Boot service for internal ticket routing.',
] }] });
const unsafe = await enhance({
  doc: fresher.doc, targetRole: fresher.doc.targetRole, aiPolish: true,
  env: { GEMINI_API_KEY: 'contract-test-key', GEMINI_RESUME_MODEL: 'gemini-3.6-flash' },
  fetchImpl: mockedFetch(unsafePayload),
});

const report = {
  generatedAt: new Date().toISOString(),
  provider: 'Gemini contract test with mocked HTTP response; no external network call performed',
  deterministic: {
    aiCalls: deterministic.aiPolish.calls,
    quality: deterministic.quality.overall,
  },
  safePolish: {
    aiCalls: polished.aiPolish.calls,
    applied: polished.aiPolish.applied,
    rejected: polished.aiPolish.rejected,
    quality: polished.quality.overall,
    containsAcceptedWording: /Configured Java 17 service deployments across OpenShift environments with Helm and ConfigMaps\./.test(toPlainText(polished.resumeDocument)),
    truthFailures: polished.quality.hardFailures.length,
  },
  unsafePolish: {
    aiCalls: unsafe.aiPolish.calls,
    applied: unsafe.aiPolish.applied,
    rejected: unsafe.aiPolish.rejected,
    containsUnsafeWording: /Successfully designed a Spring Boot service/.test(toPlainText(unsafe.resumeDocument)),
    truthFailures: unsafe.quality.hardFailures.length,
  },
};
report.passed = report.deterministic.aiCalls === 0
  && report.safePolish.aiCalls === 1
  && report.safePolish.applied === 1
  && report.safePolish.containsAcceptedWording
  && report.safePolish.truthFailures === 0
  && report.unsafePolish.aiCalls === 1
  && report.unsafePolish.applied === 0
  && report.unsafePolish.rejected >= 1
  && !report.unsafePolish.containsUnsafeWording;

fs.writeFileSync('reports/resume-os-gemini-polish-contract-audit.json', JSON.stringify(report, null, 2));
fs.writeFileSync('reports/resume-os-gemini-polish-contract-audit.md', `# Gemini wording-polish contract audit\n\n**${report.passed ? 'PASS' : 'FAIL'}**\n\nThis is a mocked provider contract test; no external Gemini request was made because no production API key is bundled.\n\n- AI OFF calls: ${report.deterministic.aiCalls}\n- Safe polish: ${report.safePolish.applied} applied, ${report.safePolish.rejected} rejected, truth failures ${report.safePolish.truthFailures}\n- Unsafe action candidate: ${report.unsafePolish.applied} applied, ${report.unsafePolish.rejected} rejected\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
