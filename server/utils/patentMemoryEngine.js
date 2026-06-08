/* ============================================================
   PATENT MEMORY / SELF-LEARNING ENGINE  (no model training)
   ------------------------------------------------------------
   "Learning" via stored history + retrieval, not training. These functions
   are PURE: the route fetches the user's ideas/feedback from the DB and
   passes them in; the engine derives generation context and next actions.
   ============================================================ */
const lc = (s) => String(s || '').toLowerCase();

/* Summarize a user's patent history into a reusable memory object. */
export function getUserPatentMemory({ ideas = [], feedback = [] } = {}) {
  const saved = ideas.filter((i) => !i.archived);
  const rejected = [];
  const weaknessTally = {};
  const domainStrength = {};
  const rejectedTitles = [];

  for (const fb of feedback) {
    const idea = ideas.find((i) => String(i._id || i.id) === String(fb.ideaId));
    const type = lc(fb.feedbackType);
    if (['not useful', 'too generic', 'already exists', 'technically weak'].includes(type)) {
      rejected.push(fb.ideaId);
      if (idea?.title) rejectedTitles.push(idea.title);
      weaknessTally[type] = (weaknessTally[type] || 0) + 1;
    }
    if (['patent-worthy', 'commercially strong', 'useful'].includes(type) && idea?.domain) {
      domainStrength[idea.domain] = (domainStrength[idea.domain] || 0) + 1;
    }
  }
  for (const i of saved) {
    if ((i.score?.overall ?? i.scoreSummary?.overall ?? 0) >= 70 && i.domain) {
      domainStrength[i.domain] = (domainStrength[i.domain] || 0) + 1;
    }
  }

  const strongDomains = Object.entries(domainStrength).sort((a, b) => b[1] - a[1]).map(([d]) => d).slice(0, 3);
  const commonWeaknesses = Object.entries(weaknessTally).sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 3);

  return {
    totalIdeas: ideas.length,
    savedStrong: saved.filter((i) => (i.score?.overall ?? i.scoreSummary?.overall ?? 0) >= 70).length,
    rejectedCount: rejected.length,
    rejectedTitles: rejectedTitles.slice(0, 10),
    strongDomains,
    commonWeaknesses,
  };
}

/* Build a text context block to feed the AI generator (and a "why" note). */
export function buildGenerationContext(memory = {}, domain = '') {
  const lines = [];
  if (memory.rejectedTitles?.length) lines.push(`Avoid ideas similar to previously rejected ones: ${memory.rejectedTitles.slice(0, 6).join('; ')}.`);
  if (memory.commonWeaknesses?.length) lines.push(`The user often rejects ideas that are: ${memory.commonWeaknesses.join(', ')} — make mechanisms concrete and specific.`);
  if (memory.strongDomains?.length) lines.push(`The user has saved strong ideas in: ${memory.strongDomains.join(', ')} — lean into adjacent technical depth.`);
  if (domain && memory.strongDomains?.includes(domain)) lines.push(`${domain} is a proven-strong domain for this user.`);
  const why = lines.length
    ? `Generated using your history: ${[
        memory.strongDomains?.length ? `favoring strong domains (${memory.strongDomains.join(', ')})` : '',
        memory.commonWeaknesses?.length ? `avoiding past weaknesses (${memory.commonWeaknesses.join(', ')})` : '',
        memory.rejectedTitles?.length ? 'steering clear of rejected ideas' : '',
      ].filter(Boolean).join(', ')}.`
    : 'Generated fresh (no prior history yet).';
  return { context: lines.join('\n'), why };
}

/* Recommend next actions from the current portfolio state. */
export function suggestNextActions({ ideas = [] } = {}) {
  const actions = [];
  const active = ideas.filter((i) => !i.archived);
  const weak = active.filter((i) => (i.score?.overall ?? i.scoreSummary?.overall ?? 0) < 55);
  const strongNoDisclosure = active.filter((i) => (i.score?.overall ?? 0) >= 70 && !i.disclosureId);
  const noPriorArt = active.filter((i) => (i.score?.overall ?? 0) >= 55 && !(i.priorArtSearchPlan && Object.keys(i.priorArtSearchPlan).length));
  const noProject = active.filter((i) => (i.score?.overall ?? 0) >= 70 && !i.linkedProjectId && !i.linkedProjectPlan);

  if (!active.length) actions.push({ action: 'generate', label: 'Generate your first invention ideas', count: 0 });
  if (weak.length) actions.push({ action: 'strengthen', label: `Refine ${weak.length} weak idea(s)`, count: weak.length });
  if (noPriorArt.length) actions.push({ action: 'prior_art', label: `Generate prior-art plan for ${noPriorArt.length} idea(s)`, count: noPriorArt.length });
  if (strongNoDisclosure.length) actions.push({ action: 'disclosure', label: `Create disclosure for ${strongNoDisclosure.length} strong idea(s)`, count: strongNoDisclosure.length });
  if (noProject.length) actions.push({ action: 'convert', label: `Convert ${noProject.length} idea(s) to a buildable project`, count: noProject.length });
  if (active.length) actions.push({ action: 'feedback', label: 'Add feedback to improve future generations', count: active.length });
  return actions.slice(0, 5);
}

export default { getUserPatentMemory, buildGenerationContext, suggestNextActions };
