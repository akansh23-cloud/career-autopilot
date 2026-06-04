import { useEffect, useState } from 'react';
import {
  FileText, Briefcase, Send, MessageSquare, ArrowUpRight, Sparkles,
  Target, KanbanSquare, Trophy, Plus,
} from 'lucide-react';
import { PageIntro, StatCard, SectionCard, BarChart } from './common.jsx';
import { Badge, Button, Skeleton, EmptyState } from '../components/ui/kit.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { Jobs } from '../lib/api.js';

const timeline = [
  ['Tailored resume for Senior DevOps role', '2h ago', 'cyan'],
  ['18 new verified matches found', '5h ago', 'violet'],
  ['Outreach sent to 3 recruiters', 'Yesterday', 'mint'],
  ['Resume score improved to 92', 'Yesterday', 'amber'],
];

export default function Dashboard({ go }) {
  const { user } = useAuth();
  const [matches, setMatches] = useState(null);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  useEffect(() => {
    let live = true;
    Jobs.search({ role: 'devops engineer', verify: '0', limit: '4' })
      .then((d) => live && setMatches((d.jobs || d.items || []).slice(0, 4)))
      .catch(() => live && setMatches([]));
    return () => { live = false; };
  }, []);

  return (
    <>
      <PageIntro
        title={`${greet}, ${user?.name?.split(' ')[0] || 'there'} 👋`}
        sub="Here’s your career command centre for today."
        action={<Button onClick={() => go('resume')}><Sparkles size={16} /> Tailor a resume</Button>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard i={0} icon={FileText} tone="cyan" label="Resume score" value="92" delta="+6" />
        <StatCard i={1} icon={Briefcase} tone="violet" label="Live applications" value="12" delta="+3" />
        <StatCard i={2} icon={MessageSquare} tone="mint" label="Recruiter replies" value="6" delta="+2" />
        <StatCard i={3} icon={Send} tone="amber" label="Outreach sent" value="24" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Application funnel" className="lg:col-span-2"
          action={<Badge tone="mint">This week</Badge>}>
          <BarChart data={[8, 14, 10, 18, 12, 22, 16]} labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']} />
          <div className="mt-4 grid grid-cols-4 gap-3 border-t border-white/8 pt-4">
            {[['Saved', '34'], ['Applied', '12'], ['Interview', '4'], ['Offer', '1']].map(([l, v]) => (
              <div key={l}>
                <div className="font-display text-xl text-white">{v}</div>
                <div className="text-[11px] text-slate-500">{l}</div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Activity">
          <ol className="space-y-4">
            {timeline.map(([t, when, tone], i) => (
              <li key={i} className="flex gap-3">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-aurora-${tone}`} />
                <div>
                  <p className="text-[13px] leading-snug text-slate-200">{t}</p>
                  <p className="text-[11px] text-slate-500">{when}</p>
                </div>
              </li>
            ))}
          </ol>
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Top matches for you" className="lg:col-span-2"
          action={<button onClick={() => go('jobs')} className="text-xs text-aurora-cyan hover:underline">View all</button>}>
          {matches === null ? (
            <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : matches.length === 0 ? (
            <EmptyState icon={Target} title="No matches yet" hint="Run a job search to see roles ranked by fit."
              action={<Button size="sm" onClick={() => go('jobs')}>Find jobs</Button>} />
          ) : (
            <div className="space-y-2.5">
              {matches.map((j, i) => (
                <a key={i} href={j.url || '#'} target="_blank" rel="noreferrer"
                  className="lift flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 hover:border-white/20">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{j.title || 'Role'}</p>
                    <p className="truncate text-xs text-slate-500">{j.company || '—'} · {j.location || j.source || ''}</p>
                  </div>
                  <ArrowUpRight size={16} className="shrink-0 text-slate-500" />
                </a>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Quick actions">
          <div className="grid gap-2.5">
            {[[Briefcase, 'Find verified jobs', 'jobs'], [KanbanSquare, 'Open tracker', 'tracker'], [Send, 'Draft outreach', 'contacts'], [Trophy, 'Browse arena', 'opportunities']].map(([Icon, label, id]) => (
              <button key={id} onClick={() => go(id)}
                className="lift flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-sm text-slate-200 hover:border-white/20">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-aurora-violet/12 text-aurora-cyan"><Icon size={16} /></span>
                {label}
                <Plus size={15} className="ml-auto text-slate-600" />
              </button>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
