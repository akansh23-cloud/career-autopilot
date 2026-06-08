import { normalizeSignal } from '../utils.js';

export function buildManualSignals(input = {}) {
  const problem = input.problem || `Students need source-backed, buildable innovation projects in ${input.domain || 'technology'}.`;
  const target = input.targetUser || 'students and faculty';
  const tech = input.technology || 'software';
  return [
    normalizeSignal({
      source: 'manual', sourceId: `manual-${Date.now()}`,
      title: `${input.domain || 'Innovation'} problem submitted by user`,
      contentSummary: `${target} face this problem: ${problem}. Current solutions are often generic, hard to build, or not backed by real implementation evidence. A ${tech} based project should make the pain measurable and demo-ready.`,
      tags: [input.domain, input.technology, input.goal, 'manual'].filter(Boolean),
      engagement: { manual: 1 }, domain: input.domain, technology: input.technology, targetUser: input.targetUser,
    })
  ];
}
