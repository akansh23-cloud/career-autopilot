// Client helpers for the live comprehension viva (top verification tier).
// The candidate answers code-grounded questions under time pressure; scoring is
// deterministic server-side. The client never receives answer keys.
import { api } from './api.js';

export const Viva = {
  // Requires an authorship-verified, analyzed repo. Returns { sessionId, probes, budgetMs, threshold }.
  start: (repoFullName, skills) => api.post('/api/viva/start', { repoFullName, skills }),
  // answers: { [probeId]: { text, timingMs } }
  submit: (sessionId, answers, totalElapsedMs) => api.post('/api/viva/submit', { sessionId, answers, totalElapsedMs }),
};

export const PROBE_TYPE_LABEL = {
  factual: 'Quick recall',
  explain: 'Explain',
  modify: 'Modify your code',
};

export function probeHint(type) {
  return ({
    factual: 'Answer from memory of your repo — fast lookups are flagged.',
    explain: 'One or two clear sentences in your own words.',
    modify: 'Paste the full updated function.',
  })[type] || '';
}
