import { useEffect, useState, useCallback } from 'react';
import {
  FileText, Briefcase, Send, MessageSquare, ArrowUpRight, Sparkles,
  Target, KanbanSquare, Trophy, Plus, Activity as ActivityIcon, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { PageIntro, StatCard, SectionCard, BarChart, NextBestAction } from './common.jsx';
import { Badge, Button, Skeleton, EmptyState } from '../components/ui/kit.jsx';
import { WorkspaceOpenButton } from '../components/workspace/WorkspaceCta.jsx';
import PlanUsageStrip from '../components/PlanUsageStrip.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { Dashboard as DashboardApi } from '../lib/api.js';
import { getStoredResume, getStoredJobResults } from '../lib/resumeStore.js';
import { getProjects } from '../lib/projectStore.js';
import { careerXP, topSkills } from '../lib/xp.js';
import { deriveBadges } from '../lib/badges.js';
import { classifyBadges } from '../lib/skillBadges.js';
import { getAccessForUser } from '../lib/access.js';
import { useTracker } from '../hooks/useTracker.js';

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
  // Shared tracker source of truth — the funnel below reflects this live.
  const { funnel: trackerFunnel, total: trackedTotal } = useTracker();

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
  const base = data?.summary || {};
  const localResume = getStoredResume();
  const localJobs = getStoredJobResults();
  const projects = getProjects();
  const access = getAccessForUser(user);
  const career = careerXP(projects);
  const skills = topSkills(projects, 3);
  const badges = deriveBadges(projects, access);
  const verifiedBadges = classifyBadges(badges).verified;
  const resumeScore = base.resumeScore ?? localResume.analysis?.score ?? localResume.analysis?.ats ?? null;
  const s = { ...base, resumeScore };
  const demo = !!data?.demo;
  const serverFunnel = s.funnel || { saved: 0, applied: 0, interview: 0, offer: 0, rejected: 0 };
  // The Application Funnel reads the SAME tracker the user edits. When the
  // tracker has any jobs, it is authoritative; otherwise we fall back to the
  // server summary (demo accounts, or DB-backed applications).
  const funnel = trackedTotal > 0
    ? { saved: trackerFunnel.saved, applied: trackerFunnel.applied, interview: trackerFunnel.interview, offer: trackerFunnel.offer, rejected: serverFunnel.rejected || 0 }
    : serverFunnel;
  const weekly = s.weekly || { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], values: [0, 0, 0, 0, 0, 0, 0] };
  const activity = [...(s.activity || [])];
  if (localResume.analysis && !activity.some((a) => /resume/i.test(a.text || ''))) activity.unshift({ text: `Resume analyzed${localResume.targetRole ? ` for ${localResume.targetRole}` : ''} — score ${resumeScore || 'ready'}`, when: 'Saved locally', tone: 'cyan' });
  if (projects.length && !activity.some((a) => /project/i.test(a.text || ''))) activity.unshift({ text: `${projects.length} project workspace${projects.length === 1 ? '' : 's'} active with ${career.total} Career XP`, when: 'Saved locally', tone: 'violet' });
  const matches = (s.matches && s.matches.length ? s.matches : (localJobs.jobs || []).slice(0, 5));
  const funnelEmpty = trackedTotal === 0 && !Object.values(serverFunnel).some((v) => v > 0);

  // One focal next-best-action, derived from existing signals (no new data).
  const nba = (resumeScore == null)
    ? { title: 'Start with your resume', description: 'Upload and analyze your resume to unlock your ATS score and personalized job matches.', primary: { label: 'Analyze my resume', icon: FileText, onClick: () => go('resume') } }
    : projects.length === 0
    ? { title: 'Turn your gaps into proof', description: 'Build one guided proof-of-work project to strengthen the exact skills your target roles ask for.', primary: { label: 'Start a project', icon: Sparkles, onClick: () => go('projectstudio') } }
    : badges.length === 0
    ? { title: 'Earn your first verified badge', description: 'Finish your project tasks and connect a GitHub repo or live demo to turn work into verified proof.', primary: { label: 'Open project workspace', icon: Sparkles, onClick: () => go('projectstudio') } }
    : { title: 'Publish your strongest project', description: 'Add your best verified project to the public sandbox so recruiters can discover your proof of work.', primary: { label: 'Publish to sandbox', icon: Sparkles, onClick: () => go('sandbox') } };

  return (
    <>
      {intro}

      {demo && (
        <div className="mb-4">
          <Badge tone="amber">Demo data — sign in with Google for your own dashboard</Badge>
        </div>
      )}

      <PlanUsageStrip />

      <NextBestAction
        title={nba.title}
        description={nba.description}
        primary={nba.primary}
        secondary={[
          { label: 'Find jobs', icon: Briefcase, onClick: () => go('jobs') },
          { label: 'Track applications', icon: KanbanSquare, onClick: () => go('tracker') },
        ]}
        score={resumeScore}
        scoreLabel="ATS"
      />

      {/* ---- Stat cards (user-specific; empty for a new user) ---- */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
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

      <div className="mt-4">
        <SectionCard title="Career Proof Progress" action={<Badge tone="violet">Proof-of-work</Badge>}>
          {projects.length === 0 ? (
            <EmptyState icon={Trophy} title="No project workspace yet" hint="Create a guided project to start earning verified skill XP and badges." action={<Button size="sm" onClick={() => go('projectstudio')}>Create project</Button>} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4"><p className="text-xs text-slate-500">Career XP</p><p className="mt-1 font-display text-2xl text-white">{career.total}</p><p className="text-[11px] text-slate-500">{career.level}</p></div>
              <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4"><p className="text-xs text-slate-500">Verified badges</p><p className="mt-1 font-display text-2xl text-white">{verifiedBadges.length}</p><p className="text-[11px] text-slate-500">Proof-based skills</p></div>
              <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4"><p className="text-xs text-slate-500">Top skill</p><p className="mt-1 truncate font-display text-2xl text-white">{skills[0]?.skillName || '—'}</p><p className="text-[11px] text-slate-500">{skills[0] ? `${skills[0].xp} XP · ${skills[0].level}` : 'Add project evidence'}</p></div>
            </div>
          )}
          {projects.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {projects.slice(0, 3).map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-2">
                  <span className="truncate text-[13px] text-slate-200">{p.title}</span>
                  <WorkspaceOpenButton project={p} go={go} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
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
              <div className="mt-4 grid grid-cols-5 gap-3 border-t border-white/8 pt-4">
                {[['Saved', funnel.saved], ['Applied', funnel.applied], ['Interview', funnel.interview], ['Offer', funnel.offer], ['Rejected', funnel.rejected || 0]].map(([l, v]) => (
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
