import crypto from 'node:crypto';
import { normalizeResumeDocument, toPlainText } from '../../utils/resume/resumeDocument.js';

export const OPTIMIZATION_HISTORY_VERSION = 'resume-optimization-history-v1';
export const MAX_OPTIMIZATION_HISTORY = 24;

export function resumeStateHash(doc) {
  const d = normalizeResumeDocument(doc);
  const stable = JSON.stringify({ text: toPlainText(d), targetRole: d.targetRole, targetJobDescription: d.targetJobDescription, overrides: d.overrides, sectionOrder: d.sectionOrder });
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 24);
}

export function readOptimizationHistory(doc) {
  const raw = doc?.metadata?.optimizationHistory;
  const passes = Array.isArray(raw?.passes) ? raw.passes.slice(-MAX_OPTIMIZATION_HISTORY) : [];
  return { version: OPTIMIZATION_HISTORY_VERSION, passes, visitedHashes: Array.from(new Set([...(raw?.visitedHashes || []), ...passes.flatMap((p) => [p.beforeHash, p.afterHash]).filter(Boolean)])).slice(-60) };
}

export function appendOptimizationPass(doc, pass) {
  const d = normalizeResumeDocument(doc);
  const history = readOptimizationHistory(d);
  const nextPass = { ...pass, at: new Date().toISOString() };
  const passes = [...history.passes, nextPass].slice(-MAX_OPTIMIZATION_HISTORY);
  const visitedHashes = Array.from(new Set([...history.visitedHashes, pass.beforeHash, pass.afterHash].filter(Boolean))).slice(-60);
  return normalizeResumeDocument({ ...d, metadata: { ...(d.metadata || {}), optimizationHistory: { version: OPTIMIZATION_HISTORY_VERSION, passes, visitedHashes } } });
}

export function attemptedObjectives(doc) {
  return new Set(readOptimizationHistory(doc).passes.map((p) => p.objective).filter(Boolean));
}

export function hasVisited(doc, hash) {
  return readOptimizationHistory(doc).visitedHashes.includes(hash);
}

export default { OPTIMIZATION_HISTORY_VERSION, resumeStateHash, readOptimizationHistory, appendOptimizationPass, attemptedObjectives, hasVisited };
