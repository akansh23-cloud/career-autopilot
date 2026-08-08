import { useEffect, useMemo, useState } from 'react';
import { Award, ShieldCheck, Clock, XCircle, ChevronDown, ChevronRight, Plus, Loader2, AlertTriangle, CheckCircle2, Github, Globe } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, EmptyState, Field, Input } from '../components/ui/kit.jsx';
import { Skills } from '../lib/api.js';

const COMPLEXITY = ['beginner', 'basic', 'intermediate', 'advanced', 'expert'];
const LEVEL_TONE = { Beginner: 'default', Basic: 'cyan', Intermediate: 'cyan', Advanced: 'violet', Expert: 'mint' };

function StatCard({ icon: Icon, label, value, tone }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-[12px] text-slate-400"><Icon size={14} className={tone} /> {label}</div>
      <div className="mt-1 font-display text-2xl text-white">{value}</div>
    </div>
  );
}

function SkillRow({ s }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
        <div className="flex min-w-0 items-center gap-2">
          {open ? <ChevronDown size={15} className="shrink-0 text-slate-500" /> : <ChevronRight size={15} className="shrink-0 text-slate-500" />}
          <span className="truncate text-sm text-slate-200 capitalize">{s.skillName}</span>
          <Badge tone={LEVEL_TONE[s.level] || 'default'}>{s.level}</Badge>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[11px]">
          <span className="text-aurora-mint">{s.verifiedXp} XP</span>
          {s.pendingXp > 0 && <span className="text-amber-glow">+{s.pendingXp} pending</span>}
        </div>
      </button>
      {open && (
        <div className="border-t border-white/8 px-3 py-2.5 text-[12px] text-slate-400">
          <div className="grid grid-cols-3 gap-2">
            <div><span className="text-aurora-mint">{s.verifiedXp}</span> verified XP</div>
            <div><span className="text-amber-glow">{s.pendingXp}</span> pending XP</div>
            <div><span className="text-rose-300">{s.rejectedXp}</span> rejected XP</div>
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            <span>Verified projects: {s.verifiedProjectIds?.length || 0}</span>
            <span>Pending projects: {s.pendingProjectIds?.length || 0}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SkillsXp() {
  const [xp, setXp] = useState(null);
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', roleInProject: '', githubUrl: '', liveDemoUrl: '', certificateUrl: '', complexityLevel: 'intermediate', contributionType: '', outcome: '', claimedSkills: '', proofUrls: '' });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [lastResult, setLastResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [x, s] = await Promise.all([Skills.xp(), Skills.listSubmissions()]);
      setXp(x); setSubs(s.submissions || []);
    } catch { /* keep empties */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (form.title.trim().length < 2) { setErr('Add a project title.'); return; }
    setSubmitting(true); setErr(''); setLastResult(null);
    try {
      const payload = {
        ...form,
        claimedSkills: form.claimedSkills.split(',').map((s) => s.trim()).filter(Boolean),
        proofUrls: form.proofUrls.split(',').map((s) => s.trim()).filter(Boolean),
      };
      const data = await Skills.submitProject(payload);
      setLastResult(data);
      await load();
      setShowForm(false);
      setForm({ title: '', description: '', roleInProject: '', githubUrl: '', liveDemoUrl: '', certificateUrl: '', complexityLevel: 'intermediate', contributionType: '', outcome: '', claimedSkills: '', proofUrls: '' });
    } catch (e) { setErr(e?.message || 'Submission failed.'); } finally { setSubmitting(false); }
  };

  const verifiedSkills = useMemo(() => (xp?.skills || []).filter((s) => s.verifiedXp > 0), [xp]);
  const pendingSkills = useMemo(() => (xp?.skills || []).filter((s) => s.verifiedXp === 0 && s.pendingXp > 0), [xp]);
  const needsProofSkills = useMemo(() => (xp?.skills || []).filter((s) => s.verifiedXp === 0 && s.pendingXp === 0 && (s.rejectedXp || 0) > 0), [xp]);

  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <>
      <PageIntro title="Verified skills & XP" sub="XP is earned only after a project is submitted with proof and verified. Pending skills never count toward your resume score, job match or recruiter visibility." action={<Button onClick={() => setShowForm((v) => !v)}><Plus size={16} /> Submit a project</Button>} />

      {showForm && (
        <SectionCard title="Submit project for verification" className="mb-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project title"><Input value={form.title} onChange={f('title')} placeholder="e.g. CI/CD platform" /></Field>
            <Field label="Your role"><Input value={form.roleInProject} onChange={f('roleInProject')} placeholder="e.g. Backend lead" /></Field>
            <Field label="GitHub URL"><Input value={form.githubUrl} onChange={f('githubUrl')} placeholder="https://github.com/you/repo" /></Field>
            <Field label="Live demo URL"><Input value={form.liveDemoUrl} onChange={f('liveDemoUrl')} placeholder="https://your-demo.app" /></Field>
            <Field label="Certificate/proof URL"><Input value={form.certificateUrl} onChange={f('certificateUrl')} placeholder="https://…" /></Field>
            <Field label="Other proof URLs (comma-sep)"><Input value={form.proofUrls} onChange={f('proofUrls')} placeholder="screenshots, docs…" /></Field>
            <Field label="Contribution type"><Input value={form.contributionType} onChange={f('contributionType')} placeholder="solo / team / open-source" /></Field>
            <Field label="Complexity">
              <div className="relative">
                <select value={form.complexityLevel} onChange={f('complexityLevel')} className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 pr-10 text-sm text-slate-100 outline-none focus:border-aurora-violet/50">
                  {COMPLEXITY.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              </div>
            </Field>
          </div>
          <div className="mt-3"><Field label="Claimed skills (comma-separated)"><Input value={form.claimedSkills} onChange={f('claimedSkills')} placeholder="docker, kubernetes, terraform" /></Field></div>
          <div className="mt-3"><Field label="What you built / outcome">
            <textarea value={form.outcome} onChange={f('outcome')} placeholder="Describe what you built and measurable impact…" className="h-24 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50" />
          </Field></div>
          {err && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
          <div className="mt-3 flex gap-2">
            <Button onClick={submit} disabled={submitting}>{submitting ? <><Loader2 size={16} className="animate-spin" /> Verifying…</> : <><ShieldCheck size={16} /> Submit for verification</>}</Button>
            <Button variant="soft" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </SectionCard>
      )}

      {lastResult && (
        <SectionCard title="Latest verification result" className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={lastResult.projectVerificationStatus === 'verified' ? 'mint' : lastResult.projectVerificationStatus === 'needs_review' ? 'amber' : 'cyan'}>
              {lastResult.projectVerificationStatus.replace('_', ' ')}
            </Badge>
            <span className="text-sm text-slate-300">+{lastResult.xpAwarded} verified XP · {lastResult.xpPending} pending</span>
          </div>
          {lastResult.verifiedSkills?.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{lastResult.verifiedSkills.map((s) => <Badge key={s} tone="mint"><ShieldCheck size={11} /> {s}</Badge>)}</div>}
          {lastResult.pendingSkills?.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{lastResult.pendingSkills.map((s) => <Badge key={s} tone="amber"><Clock size={11} /> {s}</Badge>)}</div>}
          {lastResult.verificationNotes?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {lastResult.verificationNotes.map((n, i) => <li key={i} className="text-[12px] text-slate-400">• {n}</li>)}
            </ul>
          )}
          {!lastResult.db && <p className="mt-2 text-[11px] text-slate-500">Preview only — connect a database to persist XP.</p>}
        </SectionCard>
      )}

      {loading ? (
        <SectionCard><div className="flex items-center gap-2 py-6 text-slate-400"><Loader2 size={16} className="animate-spin" /> Loading skill XP…</div></SectionCard>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={Award} label="Total verified XP" value={xp?.totalVerifiedXp ?? 0} tone="text-aurora-mint" />
            <StatCard icon={Clock} label="Total pending XP" value={xp?.totalPendingXp ?? 0} tone="text-amber-glow" />
            <StatCard icon={ShieldCheck} label="Verified skills" value={verifiedSkills.length} tone="text-aurora-cyan" />
            <StatCard icon={XCircle} label="Rejected XP" value={xp?.totalRejectedXp ?? 0} tone="text-rose-300" />
          </div>

          <SectionCard title="Verified skills (count toward resume, jobs & recruiters)">
            {verifiedSkills.length === 0
              ? <EmptyState icon={ShieldCheck} title="No verified skills yet" hint="Submit a project with GitHub/live proof to earn verified XP. Only verified skills count anywhere in the app." />
              : <div className="space-y-2">{verifiedSkills.map((s) => <SkillRow key={s.skillName} s={s} />)}</div>}
          </SectionCard>

          {pendingSkills.length > 0 && (
            <SectionCard title="Pending skills (do not count yet)" className="mt-4">
              <div className="space-y-2">{pendingSkills.map((s) => <SkillRow key={s.skillName} s={s} />)}</div>
            </SectionCard>
          )}

          {needsProofSkills.length > 0 && (
            <SectionCard title="Needs proof (rejected — resubmit with evidence)" className="mt-4">
              <div className="space-y-2">{needsProofSkills.map((s) => <SkillRow key={s.skillName} s={s} />)}</div>
            </SectionCard>
          )}

          <SectionCard title={`My submissions (${subs.length})`} className="mt-4">
            {subs.length === 0
              ? <EmptyState icon={Plus} title="No submissions yet" hint="Submit your first project above to start earning verified XP." />
              : (
                <div className="space-y-2">
                  {subs.map((s) => (
                    <div key={s.id} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm text-slate-200">{s.title}</span>
                        <Badge tone={s.verificationStatus === 'verified' ? 'mint' : s.verificationStatus === 'needs_review' ? 'amber' : s.verificationStatus === 'rejected' ? 'rose' : 'cyan'}>
                          {String(s.verificationStatus).replace('_', ' ')}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                        <span className="text-aurora-mint">+{s.xpAwarded} XP</span>
                        {s.xpPending > 0 && <span className="text-amber-glow">{s.xpPending} pending</span>}
                        {s.githubUrl && <span className="inline-flex items-center gap-1"><Github size={11} /> repo</span>}
                        {s.liveDemoUrl && <span className="inline-flex items-center gap-1"><Globe size={11} /> live</span>}
                        {s.verifiedSkills?.length > 0 && <span><CheckCircle2 size={11} className="mb-0.5 inline text-aurora-mint" /> {s.verifiedSkills.length} verified</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </SectionCard>
        </>
      )}
    </>
  );
}
