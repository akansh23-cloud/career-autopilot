import { buildEvidenceGraph } from '../../utils/resume/narrative/evidenceGraph.js';
import { classifyActionProvenance } from '../../utils/resume/narrative/actionProvenance.js';
import { validateAgainstEvidence } from '../../utils/resume/narrative/truthValidator.js';
import { ceilingForSeniority } from '../../utils/resume/narrative/responsibilityScale.js';
import { scoreEvidence, scoreSpecificity, scoreNaturalness } from '../../utils/resume/narrative/bulletScoring.js';
import { normalizeResumeDocument } from '../../utils/resume/resumeDocument.js';
import { runOutsideTailoringBoundary } from '../resumeTailoring/aiBoundary.js';

export const GEMINI_POLISH_VERSION = 'gemini-wording-polish-v1';
export const DEFAULT_GEMINI_POLISH_MODEL = 'gemini-3.6-flash';

function extractText(payload) {
  return (payload?.candidates || []).flatMap((c) => c?.content?.parts || []).map((p) => p?.text || '').join('').trim();
}

function safeJson(text) {
  try { return JSON.parse(text); } catch {
    const a = text.indexOf('{'); const b = text.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* no-op */ } }
    return null;
  }
}

function quality(text, evidence) {
  return scoreEvidence(text, evidence) * 0.5 + scoreSpecificity(text, evidence) * 0.25 + scoreNaturalness(text) * 0.25;
}

function updateBullet(doc, bulletId, text) {
  const d = normalizeResumeDocument(doc);
  const update = (items) => items.map((item) => ({ ...item, bullets: (item.bullets || []).map((b) => b.id === bulletId ? { ...b, text, generatedByRule: `${GEMINI_POLISH_VERSION}:truth-gated` } : b) }));
  return normalizeResumeDocument({ ...d, experience: update(d.experience), projects: update(d.projects) });
}

export async function requestGeminiWordingCandidates(units, {
  env = process.env, fetchImpl = globalThis.fetch, model = '', maxCandidates = 3,
} = {}) {
  const apiKey = String(env.GEMINI_API_KEY || '').trim();
  if (!apiKey || !units.length) return { available: false, reason: apiKey ? 'no_units' : 'not_configured', units: [], calls: 0 };
  const resolvedModel = String(model || env.GEMINI_RESUME_MODEL || env.GEMINI_MODEL || DEFAULT_GEMINI_POLISH_MODEL).trim();
  const bounded = units.slice(0, 8).map((u) => ({
    bulletId: u.bulletId,
    originalText: u.originalText,
    currentText: u.currentText,
    allowedFacts: u.allowedFacts,
    allowedActions: u.allowedActions,
    allowedSkills: u.allowedSkills,
    allowedMetrics: u.allowedMetrics,
    allowedEntities: u.allowedEntities,
    responsibilityCeiling: u.responsibilityCeiling,
    targetRequirements: u.targetRequirements || [],
  }));
  const responseSchema = {
    type: 'object',
    properties: {
      units: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            bulletId: { type: 'string' },
            candidates: { type: 'array', items: { type: 'string' }, maxItems: maxCandidates },
          },
          required: ['bulletId', 'candidates'],
        },
      },
    },
    required: ['units'],
  };
  const prompt = `You are a bounded resume wording editor. You do not decide facts. For each unit, produce at most ${maxCandidates} wording alternatives using ONLY the supplied allowed facts/actions/skills/metrics/entities. Preserve factual action, responsibility level, scope and meaning. Never add a tool, metric, employer, credential, responsibility, result or action. Return JSON only matching the schema.\n\n${JSON.stringify({ units: bounded })}`;

  return runOutsideTailoringBoundary(async () => {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolvedModel)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.25, maxOutputTokens: 2200, responseMimeType: 'application/json', responseJsonSchema: responseSchema },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { available: true, reason: 'provider_error', error: body?.error?.message || `Gemini ${response.status}`, units: [], calls: 1, model: resolvedModel };
    const parsed = safeJson(extractText(body));
    return { available: true, reason: parsed ? '' : 'invalid_response', units: Array.isArray(parsed?.units) ? parsed.units : [], calls: 1, model: resolvedModel, usage: body?.usageMetadata || null };
  });
}

export async function applyOptionalGeminiPolish({ sourceDoc, deterministicResult, jobDescription = '', context = {}, enabled = false, env = process.env, fetchImpl } = {}) {
  const initialDoc = normalizeResumeDocument(deterministicResult?.doc || sourceDoc);
  if (!enabled) return { doc: initialDoc, applied: [], rejected: [], available: false, calls: 0, source: 'deterministic' };

  const graph = buildEvidenceGraph(sourceDoc, context);
  const byBullet = new Map(graph.records.filter((r) => r.type === 'achievement').map((r) => [r.bulletId, r]));
  const units = (deterministicResult?.bullets || []).filter((b) => b?.bulletId && byBullet.has(b.bulletId)).slice(0, 8).map((b) => {
    const evidence = byBullet.get(b.bulletId);
    const provenance = classifyActionProvenance(evidence);
    return {
      bulletId: b.bulletId,
      originalText: evidence.rawText,
      currentText: b.text,
      allowedFacts: [evidence.object, evidence.method, evidence.scope, evidence.outcome, evidence.purpose].filter(Boolean),
      allowedActions: provenance.authorized || [],
      allowedSkills: evidence.skillsDisplay || [],
      allowedMetrics: (evidence.numericEvidence || []).map((n) => n.raw || n.value).filter(Boolean),
      allowedEntities: [evidence.company, evidence.role, evidence.projectName].filter(Boolean),
      responsibilityCeiling: evidence.rawText,
      targetRequirements: deterministicResult?.jobIntelligence?.mandatory?.slice(0, 5).map((r) => r.text || r.skill || '').filter(Boolean) || [],
    };
  });

  const provider = await requestGeminiWordingCandidates(units, { env, fetchImpl });
  if (!provider.available || !provider.units.length) return { doc: initialDoc, applied: [], rejected: [], available: provider.available, error: provider.error || provider.reason, calls: provider.calls || 0, model: provider.model, source: 'deterministic' };

  let doc = initialDoc;
  const applied = []; const rejected = [];
  for (const unit of provider.units) {
    const evidence = byBullet.get(unit.bulletId);
    const current = (deterministicResult?.bullets || []).find((b) => b.bulletId === unit.bulletId)?.text || evidence?.rawText || '';
    if (!evidence) continue;
    const seniority = deterministicResult?.intelligence?.seniority?.level || deterministicResult?.intelligence?.seniority || 'mid';
    const ceiling = ceilingForSeniority(seniority);
    let best = { text: current, score: quality(current, evidence), verdict: null };
    for (const raw of Array.isArray(unit.candidates) ? unit.candidates.slice(0, 4) : []) {
      const candidate = String(raw || '').trim();
      if (!candidate || candidate === current) continue;
      const verdict = validateAgainstEvidence(candidate, evidence, { ownershipCeiling: ceiling, globalPermittedSkills: graph.permittedSkills, kind: 'bullet', seniority });
      if (!verdict.ok) { rejected.push({ bulletId: unit.bulletId, text: candidate, violations: verdict.violations, truthChecks: verdict.verdicts }); continue; }
      const s = quality(candidate, evidence);
      if (s > best.score + 0.015) best = { text: candidate, score: s, verdict };
    }
    if (best.text !== current) {
      doc = updateBullet(doc, unit.bulletId, best.text);
      applied.push({ bulletId: unit.bulletId, before: current, after: best.text, source: 'gemini-polish', truthChecks: best.verdict?.verdicts || {} });
    }
  }
  return { doc, applied, rejected, available: true, calls: provider.calls || 1, model: provider.model, usage: provider.usage, source: applied.length ? 'gemini-polish' : 'deterministic' };
}

export default { GEMINI_POLISH_VERSION, DEFAULT_GEMINI_POLISH_MODEL, requestGeminiWordingCandidates, applyOptionalGeminiPolish };
