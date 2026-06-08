import { useEffect, useState } from 'react';
import {
  Lightbulb, Loader2, Sparkles, TrendingUp, ShieldCheck, FileText, Search, Rocket, Trophy,
  Activity as ActivityIcon, ArrowRight, Layers,
} from 'lucide-react';
import { PageIntro, SectionCard } from '../common.jsx';
import { Button, Badge, EmptyState } from '../../components/ui/kit.jsx';
import { PatentOS } from '../../lib/api.js';
import { STATUS_LABELS, STATUS_ORDER, Disclaimer } from './shared.jsx';

const ACTION_ICON = { generate: Sparkles, strengthen: TrendingUp, prior_art: Search, disclosure: FileText, convert: Rocket, feedback: ActivityIcon };

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex items-center gap-1.5 text-[12px] text-slate-400">{Icon && <Icon size={13} />} {label}</div>
      <div className="mt-1 font-display text-2xl text-white">{value ?? 0}</div>
    </div>
  );
}

export default function PatentDashboard({ go }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    setLoading(true);
    try { setData(await PatentOS.dashboard()); } catch { setData(null); } finally { setLoading(false); }
  })(); }, []);

  const totals = data?.totals || {};
  const pipeline = data?.pipeline || {};
  const hasIdeas = (totals.totalIdeas || 0) > 0;

  return (
    <>
      <PageIntro title="Innovation & Patent OS" sub="Source-backed problem discovery, buildable project blueprints, MVP realism, and safer IP-readiness workflow." action={<Button onClick={() => go?.('patentgenerate')}><Sparkles size={16} /> Discover Problems</Button>} />

      <div className="mb-4 rounded-xl border border-amber-glow/25 bg-amber-glow/5 px-3 py-2"><Disclaimer /></div>

      {loading ? (
        <SectionCard><div className="flex items-center gap-2 py-8 text-slate-400"><Loader2 size={16} className="animate-spin" /> Loading Patent OS…</div></SectionCard>
      ) : !hasIdeas ? (
        <EmptyState icon={Lightbulb} title="No inventions yet" hint="Start by discovering real problem signals, then generate a buildable innovation project." action={<Button onClick={() => go?.('patentgenerate')}><Sparkles size={14} /> Discover Problems</Button>} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Total ideas" value={totals.totalIdeas} icon={Lightbulb} />
            <Stat label="Strong candidates" value={totals.strongCandidates} icon={Trophy} />
            <Stat label="Disclosure-ready" value={totals.disclosureReady} icon={FileText} />
            <Stat label="Prior-art review" value={totals.underPriorArtReview} icon={Search} />
            <Stat label="Attorney / filed" value={totals.attorneyOrFiled} icon={ShieldCheck} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {data?.topIdea && (
              <SectionCard title="Highest-scoring idea">
                <button onClick={() => go?.('patentworkspace', { ideaId: data.topIdea.id })} className="group flex w-full items-center justify-between gap-3 text-left">
                  <div className="min-w-0"><div className="truncate text-sm font-medium text-white">{data.topIdea.title}</div><div className="text-[11px] text-slate-500">{data.topIdea.grade}</div></div>
                  <div className="flex items-center gap-2"><Badge tone="mint">{data.topIdea.score}/100</Badge><ArrowRight size={15} className="text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-white" /></div>
                </button>
                {data?.topDomain && <div className="mt-3 border-t border-white/8 pt-3 text-[12px] text-slate-400">Top domain: <span className="text-slate-200">{data.topDomain}</span></div>}
              </SectionCard>
            )}

            <SectionCard title="Recommended next actions">
              {(data?.nextActions || []).length === 0 ? (
                <p className="text-[13px] text-slate-500">You're all caught up.</p>
              ) : (
                <div className="space-y-2">
                  {data.nextActions.map((a, i) => {
                    const Icon = ACTION_ICON[a.action] || Sparkles;
                    return (
                      <button key={i} onClick={() => go?.(a.action === 'generate' ? 'patentgenerate' : a.action === 'prior_art' ? 'priorart' : a.action === 'disclosure' ? 'patentdisclosures' : 'patentportfolio')}
                        className="flex w-full items-center gap-2.5 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-left text-[13px] text-slate-300 transition hover:border-white/20">
                        <Icon size={14} className="text-aurora-cyan" /> {a.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          <SectionCard title="Pipeline overview" action={<Button size="sm" variant="soft" onClick={() => go?.('patentportfolio')}><Layers size={14} /> Open pipeline</Button>}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {STATUS_ORDER.map((s) => (
                <div key={s} className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-center">
                  <div className="font-display text-xl text-white">{pipeline[s] || 0}</div>
                  <div className="text-[10px] text-slate-500">{STATUS_LABELS[s]}</div>
                </div>
              ))}
            </div>
          </SectionCard>

          {(data?.activity || []).length > 0 && (
            <SectionCard title="Recent activity">
              <div className="space-y-1.5">
                {data.activity.slice(0, 10).map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-[13px] text-slate-400">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-aurora-violet/60" /> {a.message}
                    <span className="ml-auto shrink-0 text-[10px] text-slate-600">{new Date(a.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {data?.memory && (data.memory.strongDomains?.length > 0 || data.memory.commonWeaknesses?.length > 0) && (
            <SectionCard title="What Patent OS has learned" eyebrow="Self-learning">
              <div className="flex flex-wrap gap-2 text-[12px]">
                {data.memory.strongDomains?.map((d) => <Badge key={d} tone="mint">Strong: {d}</Badge>)}
                {data.memory.commonWeaknesses?.map((w) => <Badge key={w} tone="amber">Avoids: {w}</Badge>)}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Future idea generation uses this history to avoid rejected directions and lean into your strengths.</p>
            </SectionCard>
          )}
        </div>
      )}
    </>
  );
}
