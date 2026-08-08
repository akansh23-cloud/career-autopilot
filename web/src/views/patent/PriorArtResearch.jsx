import { useEffect, useState } from 'react';
import { Loader2, Search, ArrowRight } from 'lucide-react';
import { PageIntro, SectionCard } from '../common.jsx';
import { Button, Badge, EmptyState } from '../../components/ui/kit.jsx';
import { PatentOS } from '../../lib/api.js';
import { ScorePill, riskTone, Disclaimer } from './shared.jsx';

export default function PriorArtResearch({ go }) {
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    setLoading(true);
    try { const d = await PatentOS.ideas({}); setIdeas(d.ideas || []); } catch { setIdeas([]); } finally { setLoading(false); }
  })(); }, []);

  const active = ideas.filter((i) => !i.archived);
  const withPlan = active.filter((i) => i.priorArtSearchPlan && Object.keys(i.priorArtSearchPlan).length);
  const needPlan = active.filter((i) => !(i.priorArtSearchPlan && Object.keys(i.priorArtSearchPlan).length));

  return (
    <>
      <PageIntro title="Prior-art research" sub="Generate suggested prior-art search plans per idea and record what you find. Open an idea to run its plan and log records." />
      <div className="mb-4 rounded-xl border border-amber-glow/25 bg-amber-glow/5 px-3 py-2"><Disclaimer /></div>

      {loading ? (
        <SectionCard><div className="flex items-center gap-2 py-8 text-fg-secondary"><Loader2 size={16} className="animate-spin" /> Loading…</div></SectionCard>
      ) : active.length === 0 ? (
        <EmptyState icon={Search} title="No inventions to research" hint="Generate ideas first, then build prior-art plans for the strong ones." action={<Button size="sm" onClick={() => go?.('patentgenerate')}>Generate ideas</Button>} />
      ) : (
        <div className="space-y-4">
          {needPlan.length > 0 && (
            <SectionCard title={`Needs a prior-art plan (${needPlan.length})`}>
              <div className="space-y-2">{needPlan.map((i) => (
                <button key={i.id} onClick={() => go?.('patentworkspace', { ideaId: i.id })} className="flex w-full items-center justify-between gap-3 rounded-lg border border-subtle bg-surface-1 px-3 py-2 text-left transition hover:border-strong">
                  <span className="min-w-0 truncate text-[13px] text-fg">{i.title}</span>
                  <span className="flex shrink-0 items-center gap-2"><ScorePill score={i.score?.overall || 0} /><Search size={14} className="text-aurora-cyan" /></span>
                </button>
              ))}</div>
            </SectionCard>
          )}
          {withPlan.length > 0 && (
            <SectionCard title={`Plan generated (${withPlan.length})`}>
              <div className="space-y-2">{withPlan.map((i) => (
                <button key={i.id} onClick={() => go?.('patentworkspace', { ideaId: i.id })} className="flex w-full items-center justify-between gap-3 rounded-lg border border-subtle bg-surface-1 px-3 py-2 text-left transition hover:border-strong">
                  <span className="min-w-0"><span className="block truncate text-[13px] text-fg">{i.title}</span><span className="text-[11px] text-fg-muted">{(i.priorArtSearchPlan.keywords || []).slice(0, 5).join(', ')}</span></span>
                  <span className="flex shrink-0 items-center gap-2"><Badge tone={riskTone(i.score?.riskLevel)}>{i.score?.riskLevel || 'Med'} risk</Badge><ArrowRight size={14} className="text-fg-muted" /></span>
                </button>
              ))}</div>
            </SectionCard>
          )}
        </div>
      )}
    </>
  );
}
