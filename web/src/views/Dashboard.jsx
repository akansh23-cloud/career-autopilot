import { useEffect, useState, useCallback } from 'react';
import {
  FileText, Briefcase, Send, MessageSquare, ArrowUpRight, Sparkles,
  Target, KanbanSquare, Trophy, Plus, Activity as ActivityIcon, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { PageIntro, StatCard, SectionCard, BarChart } from './common.jsx';
import { Badge, Button, Skeleton, EmptyState } from '../components/ui/kit.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { Dashboard as DashboardApi } from '../lib/api.js';

const TONE_BG = {
  cyan: 'bg-aurora-cyan', violet: 'bg-aurora-violet', mint: 'bg-aurora-mint', amber: 'bg-amber-glow',
};

function StatSkeletons() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[116px] w-full rounded-2xl" />)}
    </div>
  );
}

export default function Dashboard({ go }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);     // { summary, demo }
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const load = useCallback(() => {
    let live = true;
    setStatus('loading');
    DashboardApi.summary()
      .then((d) => { if (live) { setData(d); setStatus('ready'); } })
      .catch(() => { if (live) setStatus('error'); });
    return () => { live = false; };
  }, []);

  useEffect(() => load(), [load]);

  const intro = (
    <PageIntro
      title={`${greet}, ${user?.name?.split(' ')[0] || 'there'} 👋`}
      sub="Here’s your career command centre for today."
      action={<Button onClick={() => go('resume')}><Sparkles size={16} /> Tailor a resume</Button>}
    />
  );

  // ---- Loading ----
  if (status === 'loading') {
    return (
      <>
        {intro}
        <StatSkeletons />
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 w-full rounded-2xl lg:col-span-2" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </>
    );
  }

  // ---- Error (with retry) ----
  if (status === 'error') {
    return (
      <>
        {intro}
        <SectionCard title="Dashboard">
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-glow/12 text-amber-glow ring-1 ring-amber-glow/25">
              <AlertTriangle size={22} />
            </span>
            <p className="text-sm text-slate-300">We couldn’t load your dashboard.</p>
            <Button variant="outline" size="sm" onClick={load}><RefreshCw size={15} /> Retry</Button>
          </div>
        </SectionCard>
      </>
    );
  }

  // ---- Ready ----
  const s = data?.summary || {};
  const demo = !!data?.demo;
  const funnel = s.funnel || { saved: 0, applied: 0, interview: 0, offer: 0 };
  const weekly = s.weekly || { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], values: [0, 0, 0, 0, 0, 0, 0] };
  const activity = s.activity || [];
  const matches = s.matches || [];
  const funnelEmpty = !Object.values(funnel).some((v) => v > 0);

  return (
    <>
      {intro}

      {demo && (
        <div className="mb-4">
          <Badge tone="amber">Demo data — sign in with Google for your own dashboard</Badge>
        </div>
      )}

      {/* ---- Stat cards (user-specific; empty for a new user) ---- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {s.resumeScore == null ? (
          <StatCard i={0} icon={FileText} tone="cyan" label="Resume score" value="—"
            hint="Upload your resume to get your first ATS score" onClick={() => go('resume')} />
        ) : (
          <StatCard i={0} icon={FileText} tone="cyan" label="Resume score" value={String(s.resumeScore)}
            delta={s.resumeDelta ? `+${s.resumeDelta}` : undefined} />
        )}
        <StatCard i={1} icon={Briefcase} tone="violet" label="Live applications" value={String(s.liveApplications ?? 0)}
          hint={!s.liveApplications ? 'Start tracking applications' : undefined}
          onClick={!s.liveApplications ? () => go('tracker') : undefined} />
        <StatCard i={2} icon={MessageSquare} tone="mint" label="Recruiter replies" value={String(s.recruiterReplies ?? 0)}
          hint={!s.recruiterReplies ? 'Replies show up as recruiters respond' : undefined} />
        <StatCard i={3} icon={Send} tone="amber" label="Outreach sent" value={String(s.outreachSent ?? 0)}
          hint={!s.outreachSent ? 'Send your first outreach' : undefined}
          onClick={!s.outreachSent ? () => go('contacts') : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* ---- Application funnel ---- */}
        <SectionCard title="Application funnel" className="lg:col-span-2"
          action={<Badge tone="mint">This week</Badge>}>
          {funnelEmpty ? (
            <EmptyState icon={KanbanSquare} title="No applications yet"
              hint="Track jobs you apply to and your funnel will fill in here."
              action={<Button size="sm" onClick={() => go('tracker')}>Start tracking</Button>} />
          ) : (
            <>
              <BarChart data={weekly.values} labels={weekly.labels} />
              <div className="mt-4 grid grid-cols-4 gap-3 border-t border-white/8 pt-4">
                {[['Saved', funnel.saved], ['Applied', funnel.applied], ['Interview', funnel.interview], ['Offer', funnel.offer]].map(([l, v]) => (
                  <div key={l}>
                    <div className="font-display text-xl text-white">{v}</div>
                    <div className="text-[11px] text-slate-500">{l}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </SectionCard>

        {/* ---- Activity ---- */}
        <SectionCard title="Activity">
          {activity.length === 0 ? (
            <EmptyState icon={ActivityIcon} title="No activity yet"
              hint="Your tailoring, searches and outreach will appear here." />
          ) : (
            <ol className="space-y-4">
              {activity.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${TONE_BG[a.tone] || 'bg-aurora-cyan'}`} />
                  <div>
                    <p className="text-[13px] leading-snug text-slate-200">{a.text}</p>
                    <p className="text-[11px] text-slate-500">{a.when}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* ---- Top matches ---- */}
        <SectionCard title="Top matches for you" className="lg:col-span-2"
          action={<button onClick={() => go('jobs')} className="text-xs text-aurora-cyan hover:underline">View all</button>}>
          {matches.length === 0 ? (
            <EmptyState icon={Target} title="No matches yet" hint="Search jobs to see matches here, ranked by fit."
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

        {/* ---- Quick actions (always available) ---- */}
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
