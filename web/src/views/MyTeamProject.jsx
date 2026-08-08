/* ============================================================
   My Team Project — the student side of a placement-cell assignment
   ------------------------------------------------------------
   A student who has been put on a team lands here and sees three
   things, in this order, because that is the order they need them:

     1. What YOU own. Their own role and modules come first — the
        single most common failure mode of group work is a member who
        does not know which part is theirs.
     2. What the team is building, and by when.
     3. What has to be submitted, and a submit box for the live
        hosted URL, with a self-check button that runs exactly the
        same verification the coordinator runs.

   The self-check matters: a student should find out their free-tier
   deployment is asleep BEFORE it is graded, not after. The check is
   the real one — it fetches the URL — so it cannot flatter them.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import {
  Users2, Globe, Github, ShieldCheck, CalendarClock, AlertTriangle, CheckCircle2,
  Clock, Target, ListChecks, Layers, HelpCircle, Send, UserCircle2,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Spinner, EmptyState, Input, Field } from '../components/ui/kit.jsx';
import { My } from '../lib/api.js';

const STATUS_TONE = {
  assigned: 'cyan', in_progress: 'cyan', submitted: 'amber',
  verified: 'mint', needs_work: 'amber', overdue: 'amber', closed: 'default',
};
const STATUS_LABEL = {
  assigned: 'Assigned to you', in_progress: 'In progress', submitted: 'Submitted — awaiting check',
  verified: 'Verified', needs_work: 'Needs work', overdue: 'Overdue', closed: 'Closed',
};
const CHECK_ICON = { pass: CheckCircle2, fail: AlertTriangle, unavailable: Clock, not_submitted: HelpCircle };
const CHECK_TONE = { pass: 'mint', fail: 'amber', unavailable: 'default', not_submitted: 'default' };

const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

function ProjectCard({ project, onRefresh }) {
  const p = project;
  const mine = p.myAssignment;
  const sub = p.submission || {};
  const brief = p.brief || {};

  const [liveUrl, setLiveUrl] = useState(sub.liveUrl || '');
  const [repoUrl, setRepoUrl] = useState(sub.repoUrl || '');
  const [notes, setNotes] = useState(sub.notes || '');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setLiveUrl(sub.liveUrl || ''); setRepoUrl(sub.repoUrl || ''); setNotes(sub.notes || '');
  }, [sub.liveUrl, sub.repoUrl, sub.notes]);

  const submit = async () => {
    setBusy('submit'); setError(''); setMsg('');
    try {
      const r = await My.submitTeamProject(p.id, { liveUrl: liveUrl.trim(), repoUrl: repoUrl.trim(), notes });
      if (r.ok) { setMsg('Submitted. Your placement cell can see it now.'); onRefresh?.(); }
      else setError(r.message || 'Could not submit that.');
    } catch (e) { setError(e?.message || 'Could not submit that.'); }
    setBusy('');
  };

  const selfCheck = async () => {
    setBusy('verify'); setError(''); setMsg('');
    try {
      const r = await My.verifyTeamProject(p.id);
      if (r.ok) { onRefresh?.(); } else setError('The check could not run.');
    } catch (e) { setError(e?.message || 'The check could not run.'); }
    setBusy('');
  };

  return (
    <SectionCard title={p.title} eyebrow={p.teamName || 'Team project'}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[p.summary?.status] || 'default'}>{STATUS_LABEL[p.summary?.status] || p.summary?.status}</Badge>
        {p.dueAt && <span className="flex items-center gap-1 text-xs text-slate-500"><CalendarClock size={12} /> Due {fmtDate(p.dueAt)}</span>}
        {p.summary?.daysLeft != null && p.summary.daysLeft >= 0 && (
          <span className="text-xs text-slate-500">{p.summary.daysLeft} day{p.summary.daysLeft === 1 ? '' : 's'} left</span>
        )}
        <span className="flex items-center gap-1 text-xs text-slate-500"><Users2 size={12} /> {p.members?.length || 0} in the team</span>
      </div>

      {/* ---- What YOU own — first, deliberately ---- */}
      {mine && (
        <div className="mb-5 rounded-xl border border-violet-400/25 bg-violet-400/[0.05] p-4">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-violet-200">
            <Target size={13} /> Your part
          </p>
          <p className="text-base font-medium text-white">{mine.role}</p>
          <ul className="mt-2 space-y-1">
            {(mine.modules || []).map((m, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-300"><span className="text-slate-600">•</span>{m}</li>
            ))}
          </ul>
          {mine.matchedSkills?.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-400">You were given this because you listed: {mine.matchedSkills.join(', ')}.</p>
          )}
          {mine.stretch && (
            <p className="mt-2 text-[11px] text-amber-200">
              This is outside what you have listed so far — it was assigned deliberately. Budget the first week for learning it.
            </p>
          )}
        </div>
      )}

      {/* ---- Submission ---- */}
      <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <Globe size={13} /> Submit your live hosted link
        </p>
        <p className="mb-3 text-xs text-slate-400">
          Your placement cell verifies this by actually fetching it, so the URL has to be publicly reachable —
          no login wall, no localhost. Free tiers (Vercel, Render, Railway, Netlify) are fine.
          Any team member can submit or update this on behalf of the team.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Live hosted URL">
            <Input value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} placeholder="https://your-app.vercel.app" />
          </Field>
          <Field label="Public GitHub repository">
            <Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/team/project" />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Note for your coordinator" hint="Optional">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Login with demo/demo to see the dashboard." />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={submit} disabled={busy === 'submit' || (!liveUrl.trim() && !repoUrl.trim())}>
            {busy === 'submit' ? <Spinner /> : <Send size={14} />} Submit for the team
          </Button>
          <Button size="sm" variant="soft" onClick={selfCheck} disabled={busy === 'verify' || (!sub.liveUrl && !sub.repoUrl)}>
            {busy === 'verify' ? <Spinner /> : <ShieldCheck size={14} />} Check it myself first
          </Button>
        </div>
        {msg && <p className="mt-2 text-sm text-emerald-300">{msg}</p>}
        {error && <p className="mt-2 text-sm text-amber-300">{error}</p>}

        {p.verification && (
          <div className="mt-4 border-t border-white/8 pt-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone={p.verification.passed ? 'mint' : p.verification.pending ? 'cyan' : 'amber'}>
                {p.verification.passed ? 'Verified' : p.verification.pending ? 'Could not complete' : 'Not verified yet'}
              </Badge>
              <span className="text-xs text-slate-500">checked {fmtDate(p.verification.checkedAt)}</span>
            </div>
            <p className="mb-2 text-xs text-slate-400">{p.verification.summary}</p>
            <div className="space-y-1">
              {(p.verification.checks || []).map((c) => {
                const Icon = CHECK_ICON[c.state] || HelpCircle;
                return (
                  <div key={c.key} className="flex items-start gap-2 rounded-lg border border-white/8 bg-white/[0.02] p-2">
                    <Icon size={13} className="mt-0.5 shrink-0 text-slate-500" />
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-slate-200">{c.label}</span>
                        <Badge tone={CHECK_TONE[c.state] || 'default'}>{c.state.replace(/_/g, ' ')}</Badge>
                      </div>
                      {c.note && <p className="mt-0.5 text-[11px] text-slate-500">{c.note}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ---- The brief ---- */}
      <div className="space-y-5">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">What you're building</p>
          <p className="text-sm text-slate-300">{brief.problem}</p>
          <p className="mt-1 text-xs text-slate-500">For: {brief.targetUsers}</p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Must build</p>
          <ul className="space-y-1.5">
            {(brief.mustBuild || []).map((x, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-300"><span className="text-slate-600">{i + 1}.</span>{x}</li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Users2 size={13} /> Your teammates
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(brief.assignments || []).map((a) => (
              <div key={a.studentId} className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                <div className="flex items-center gap-2">
                  <UserCircle2 size={14} className="text-slate-500" />
                  <span className="text-sm text-white">{a.name}</span>
                  {mine && a.studentId === mine.studentId && <Badge tone="violet">You</Badge>}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{a.role} · {a.modules.join(' · ')}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <ListChecks size={13} /> Milestones
          </p>
          <div className="space-y-1.5">
            {(brief.milestones || []).map((m) => (
              <div key={m.key} className="flex gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-2.5">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/[0.06] text-[10px] text-slate-400">{m.index}</span>
                <div>
                  <p className="text-sm text-slate-200">{m.title}</p>
                  <p className="text-xs text-slate-500">{m.detail}</p>
                  <p className="mt-0.5 text-[10px] text-slate-600">{fmtDate(m.dueAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Layers size={13} /> Suggested stack
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(brief.stack || {}).map(([area, list]) => (
              <span key={area} className="rounded-lg border border-white/8 bg-white/[0.02] px-2 py-1 text-[11px] text-slate-400">
                <span className="text-slate-500">{area}:</span> {list.join(', ')}
              </span>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Accepted when</p>
          <ul className="space-y-1">
            {(brief.acceptanceCriteria || []).map((c, i) => <li key={i} className="text-xs text-slate-400">{c}</li>)}
          </ul>
        </div>

        {brief.outOfScope?.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Deliberately out of scope</p>
            <ul className="space-y-1">
              {brief.outOfScope.map((c, i) => <li key={i} className="text-xs text-slate-500">{c}</li>)}
            </ul>
          </div>
        )}

        {brief.notes && (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Note from your placement cell</p>
            <p className="text-sm text-slate-300">{brief.notes}</p>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

export default function MyTeamProject({ go }) {
  const [state, setState] = useState({ loading: true, error: '', projects: [] });

  const load = useCallback(async () => {
    setState((p) => ({ ...p, loading: true }));
    try {
      const r = await My.teamProjects();
      setState({ loading: false, error: r.ok ? '' : 'Could not load your team projects.', projects: r.projects || [] });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Could not load your team projects.', projects: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageIntro
        eyebrow="Placement cell"
        title="Team project"
        sub="Group work assigned by your placement cell, matched to your team's combined skills. Verified on a live hosted URL, not on your word for it."
      />

      {state.loading && <div className="flex items-center gap-2 py-10 text-sm text-muted"><Spinner /> Loading…</div>}
      {!state.loading && state.error && <p className="text-sm text-amber-300">{state.error}</p>}

      {!state.loading && !state.error && state.projects.length === 0 && (
        <EmptyState
          icon={Users2}
          title="No team project assigned yet"
          hint="Your placement cell assigns these to groups of students. When one arrives you'll get a notification, and your role and modules will appear here."
          action={<Button size="sm" variant="soft" onClick={() => go?.('projectstudio')}>Build a solo project meanwhile</Button>}
        />
      )}

      <div className="space-y-4">
        {state.projects.map((p) => <ProjectCard key={p.id} project={p} onRefresh={load} />)}
      </div>
    </div>
  );
}
