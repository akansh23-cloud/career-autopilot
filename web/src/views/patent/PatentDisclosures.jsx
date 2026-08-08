import { useEffect, useState } from 'react';
import { Loader2, FileText, ArrowRight } from 'lucide-react';
import { PageIntro, SectionCard } from '../common.jsx';
import { Button, Badge, EmptyState } from '../../components/ui/kit.jsx';
import { PatentOS } from '../../lib/api.js';
import { Disclaimer } from './shared.jsx';

export default function PatentDisclosures({ go }) {
  const [disclosures, setDisclosures] = useState([]);
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    setLoading(true);
    try {
      const [d, i] = await Promise.all([PatentOS.disclosures(), PatentOS.ideas({})]);
      setDisclosures(d.disclosures || []); setIdeas((i.ideas || []).filter((x) => !x.archived));
    } catch { /* */ } finally { setLoading(false); }
  })(); }, []);

  const titleFor = (ideaId) => ideas.find((i) => i.id === ideaId)?.title || disclosures.find((d) => d.ideaId === ideaId)?.payload?.title || 'Untitled invention';
  const strongNoDisclosure = ideas.filter((i) => (i.score?.overall || 0) >= 70 && !i.disclosureId);

  return (
    <>
      <PageIntro title="Invention disclosures" sub="Structured disclosure drafts for your inventions. Open an idea to generate, regenerate or review its disclosure." />
      <div className="mb-4 rounded-xl border border-amber-glow/25 bg-amber-glow/5 px-3 py-2"><Disclaimer /></div>

      {loading ? (
        <SectionCard><div className="flex items-center gap-2 py-8 text-slate-400"><Loader2 size={16} className="animate-spin" /> Loading…</div></SectionCard>
      ) : disclosures.length === 0 && strongNoDisclosure.length === 0 ? (
        <EmptyState icon={FileText} title="No disclosures yet" hint="Open a strong idea and generate its invention-disclosure draft." action={<Button size="sm" onClick={() => go?.('patentportfolio')}>Open portfolio</Button>} />
      ) : (
        <div className="space-y-4">
          {disclosures.length > 0 && (
            <SectionCard title={`Drafted disclosures (${disclosures.length})`}>
              <div className="space-y-2">{disclosures.map((d) => (
                <button key={d.id} onClick={() => go?.('patentworkspace', { ideaId: d.ideaId })} className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-left transition hover:border-white/20">
                  <span className="min-w-0 truncate text-[13px] text-slate-200">{titleFor(d.ideaId)}</span>
                  <span className="flex shrink-0 items-center gap-2"><Badge tone="cyan">v{d.version}</Badge><ArrowRight size={14} className="text-slate-500" /></span>
                </button>
              ))}</div>
            </SectionCard>
          )}
          {strongNoDisclosure.length > 0 && (
            <SectionCard title={`Strong ideas without a disclosure (${strongNoDisclosure.length})`}>
              <div className="space-y-2">{strongNoDisclosure.map((i) => (
                <button key={i.id} onClick={() => go?.('patentworkspace', { ideaId: i.id })} className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-left transition hover:border-white/20">
                  <span className="min-w-0 truncate text-[13px] text-slate-200">{i.title}</span>
                  <span className="flex shrink-0 items-center gap-2"><Badge tone="mint">{i.score?.overall || 0}/100</Badge><FileText size={14} className="text-aurora-cyan" /></span>
                </button>
              ))}</div>
            </SectionCard>
          )}
        </div>
      )}
    </>
  );
}
