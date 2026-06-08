import { normalizeSignal, sanitizeText } from '../utils.js';

export async function fetchStackExchangeSignals(input = {}, { limit = 10, timeoutMs = 9000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const q = [input.problem, input.domain, input.technology, input.goal].filter(Boolean).join(' ') || 'software engineering automation problem';
    const params = new URLSearchParams({
      order: 'desc', sort: 'activity', site: 'stackoverflow', q,
      pagesize: String(Math.min(30, Math.max(5, limit))), filter: 'withbody',
    });
    if (process.env.STACKEXCHANGE_KEY) params.set('key', process.env.STACKEXCHANGE_KEY);
    const res = await fetch(`https://api.stackexchange.com/2.3/search/advanced?${params}`, { signal: controller.signal, headers: { 'User-Agent': 'career-autopilot-problem-intelligence' } });
    if (!res.ok) throw new Error(`stackexchange_${res.status}`);
    const data = await res.json();
    return (data.items || []).slice(0, limit).map((it) => normalizeSignal({
      source: 'stackexchange',
      sourceId: String(it.question_id || it.link),
      sourceUrl: it.link,
      title: it.title,
      contentSummary: sanitizeText(it.body || '', 1400),
      tags: it.tags || [],
      engagement: { score: it.score || 0, answers: it.answer_count || 0, views: it.view_count || 0, accepted: !!it.accepted_answer_id },
      sourceCreatedAt: it.creation_date ? new Date(it.creation_date * 1000).toISOString() : null,
      lastActivityAt: it.last_activity_date ? new Date(it.last_activity_date * 1000).toISOString() : null,
      domain: input.domain,
      technology: input.technology,
      targetUser: input.targetUser,
    }));
  } finally { clearTimeout(timer); }
}
