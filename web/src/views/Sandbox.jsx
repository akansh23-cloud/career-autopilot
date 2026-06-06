import { useEffect, useMemo, useState } from 'react';
import {
  Rocket, Github, Globe, Target, Award, Eye, Mail, Copy, Users, Star, Filter, Search,
  ShieldCheck, BadgeCheck, BookOpen, Database, Lightbulb, Bookmark, Sparkles, Loader2,
  AlertTriangle, Gauge, Clock,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Modal, EmptyState, Input } from '../components/ui/kit.jsx';
import { ScoreRing, BadgePill, BadgeModal, StatusBadge, ArchitectureDiagram } from '../components/proof/ProofViews.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import {
  getPublishedProjects, getProjects, saveProject, savePartnerRequest, saveStudioSeed, uid, proofScoreBreakdown,
} from '../lib/projectStore.js';
import { getStoredResume, getStoredJobResults } from '../lib/resumeStore.js';
import { getProfile, getUserRole } from '../lib/userProfile.js';
import { api } from '../lib/api.js';
import {
  CURATED_IDEAS, normalizeCandidate, scoreCandidate, saveIdea, getSavedIdeas, FIT_WEIGHTS,
} from '../lib/projectRecommend.js';
import { deriveBadges } from '../lib/badges.js';
import { rankProjects } from '../lib/roleFit.js';
import { calculateProjectStatus } from '../lib/projectStatus.js';
import { getAccessForUser } from '../lib/access.js';
import { toggleShortlist, markContacted, engagementFor } from '../lib/engagement.js';


const STARTUP_PROBLEMS = [
  { title: 'Campus Skill Exchange Marketplace', problem: 'Students have skills but no structured way to trade help, form teams, and prove contributions across projects.', businessUseCase: 'College SaaS for collaboration, peer tutoring and placement-cell proof tracking.', targetRole: 'Full Stack Developer', projectType: 'Full Stack', skillsCovered: ['React', 'Node.js', 'MongoDB', 'Matching Algorithm', 'Payments'], difficulty: 'Intermediate', estimatedDuration: '1 month', startupPotential: 0.8, proofOutputs: ['GitHub repo', 'README', 'live demo', 'deployment'] },
  { title: 'AI CRM for Local Shops & Clinics', problem: 'Small businesses lose repeat customers because they do not track follow-ups, reminders, service history or leads.', businessUseCase: 'Subscription SaaS for shops, clinics, tutors, salons and repair businesses.', targetRole: 'Backend Engineer', projectType: 'Full Stack', skillsCovered: ['Auth', 'CRM', 'WhatsApp', 'Analytics', 'AI'], difficulty: 'Intermediate', estimatedDuration: '1 month', startupPotential: 0.9, proofOutputs: ['GitHub repo', 'README', 'live demo', 'deployment'] },
  { title: 'Cloud Cost Guardrail Dashboard', problem: 'Students and startups deploy cloud projects but do not understand cost, idle resources, alerts or budget limits.', businessUseCase: 'A lightweight FinOps tool to avoid cloud bill shocks.', targetRole: 'DevOps Engineer', projectType: 'DevOps', skillsCovered: ['AWS', 'Docker', 'CI/CD', 'Terraform', 'Monitoring'], difficulty: 'Advanced', estimatedDuration: '1 month', startupPotential: 0.85, proofOutputs: ['GitHub repo', 'README', 'live demo', 'CI/CD', 'deployment'] },
];

const MARKET_TABS = [
  ['ideas', 'Project Ideas', Lightbulb],
  ['startup', 'Startup Problems', Rocket],
  ['github', 'Trending from GitHub', Github],
  ['data', 'Data / AI Ideas', Database],
  ['hackathon', 'Hackathon Style', Award],
];

function FitModal({ open, onClose, cand }) {
  if (!cand) return null;
  const b = cand.scoreBreakdown || {};
  const rows = [['Role match', b.targetRoleMatch, FIT_WEIGHTS.targetRoleMatch], ['Missing skills', b.missingSkillCoverage, FIT_WEIGHTS.missingSkillCoverage], ['Resume gaps', b.resumeGapImprovement, FIT_WEIGHTS.resumeGapImprovement], ['Job market', b.jobMarketRelevance, FIT_WEIGHTS.jobMarketRelevance], ['Level fit', b.userLevelFit, FIT_WEIGHTS.userLevelFit], ['Proof potential', b.proofPotential, FIT_WEIGHTS.proofPotential]];
  return (
    <Modal open={open} onClose={onClose} width="max-w-lg" title={`Recommendation fit · ${cand.fitScore}/100`}>
      <div className="space-y-3">
        <p className="text-[12px] text-slate-400">How this idea fits your profile, resume gaps and matched jobs. Estimated based on skill overlap and available project/job data.</p>
        <div className="grid grid-cols-2 gap-2">
          {rows.map(([l, v, m]) => (
            <div key={l}><div className="flex justify-between text-[10px] text-slate-400"><span>{l}</span><span>{v ?? 0}/{m}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-aurora-cta" style={{ width: `${Math.round(((v ?? 0) / m) * 100)}%` }} /></div></div>
          ))}
        </div>
        <ul className="space-y-1 rounded-xl border border-white/8 bg-ink-950/55 p-3 text-[12px] text-slate-300">
          {(cand.whyRecommended || []).slice(0, 5).map((w, i) => <li key={i}>• {w}</li>)}
        </ul>
      </div>
    </Modal>
  );
}

function IdeaCard({ cand, onBuild, onSave, onFit, saved }) {
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-aurora-violet/35">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-medium leading-tight text-white">{cand.title}</h4>
        <Badge tone={cand.fitScore >= 80 ? 'mint' : cand.fitScore >= 60 ? 'cyan' : 'amber'}>{cand.fitScore}/100</Badge>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge tone="violet">{cand.sourceLabel}</Badge>
        <Badge tone="amber"><Gauge size={10} /> {cand.difficulty}</Badge>
        <Badge tone="cyan"><Clock size={10} /> {cand.estimatedDuration}</Badge>
        {cand.startupPotential >= 0.6 && <Badge tone="amber"><Rocket size={10} /> Startup {Math.round(cand.startupPotential * 100)}%</Badge>}
      </div>
      <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-slate-400">{cand.summary}</p>
      {cand.businessUseCase && <div className="mt-2 rounded-xl border border-white/8 bg-ink-950/55 p-2 text-[11px] leading-relaxed text-slate-500"><span className="text-slate-300">Business use case:</span> {cand.businessUseCase}</div>}
      <div className="mt-2 flex flex-wrap gap-1.5">{cand.skillsCovered.slice(0, 6).map((t) => <Badge key={t} tone="cyan">{t}</Badge>)}</div>
      {cand.sourceUrl && <a href={cand.sourceUrl} target="_blank" rel="noreferrer" className="mt-1.5 text-[10px] text-aurora-cyan underline">inspiration source ↗</a>}
      <div className="mt-auto flex flex-wrap gap-2 pt-3">
        <Button size="sm" onClick={() => onBuild(cand)}><Rocket size={13} /> Build this</Button>
        <Button size="sm" variant="soft" onClick={() => onSave(cand)}><Bookmark size={13} /> {saved ? 'Saved' : 'Save idea'}</Button>
        <Button size="sm" variant="soft" onClick={() => onFit(cand)}><Sparkles size={13} /> View fit</Button>
      </div>
    </div>
  );
}

function MarketplaceIdeas({ go, flash }) {
  const [tab, setTab] = useState('ideas');
  const [remote, setRemote] = useState({}); // tab -> { status, items, warning }
  const [fit, setFit] = useState(null);
  const [savedIds, setSavedIds] = useState(getSavedIdeas().map((i) => i.id));

  const ctx = useMemo(() => {
    const profile = getProfile(); const r = getStoredResume(); const jobsState = getStoredJobResults();
    return {
      userRole: getUserRole(), yearSem: profile.yearSem || '',
      targetRole: profile.targetRole || r.targetRole || r.analysis?.recommendedRole || 'Software Engineer',
      currentSkills: String(profile.skills || '').split(',').map((s) => s.trim()).filter(Boolean),
      resumeAnalysis: r.analysis || null, resumeText: r.text || '',
      missingSkills: (r.analysis?.missingKeywords) || [],
      savedJobs: Array.isArray(jobsState.jobs) ? jobsState.jobs : [],
    };
  }, []);

  const score = (raw, sourceType) => scoreCandidate(normalizeCandidate(raw, sourceType), ctx);

  const localIdeas = useMemo(() => CURATED_IDEAS.map((i) => score(i, 'curated')).sort((a, b) => b.fitScore - a.fitScore), [ctx]);
  const startupIdeas = useMemo(() => STARTUP_PROBLEMS.map((i) => score({ ...i, summary: i.problem }, 'curated')).sort((a, b) => b.startupPotential - a.startupPotential), [ctx]);

  const ENDPOINT = { github: '/api/projects/discover/github', data: '/api/projects/discover/kaggle', hackathon: '/api/projects/discover/devpost' };
  useEffect(() => {
    if (!ENDPOINT[tab] || remote[tab]) return;
    setRemote((m) => ({ ...m, [tab]: { status: 'loading', items: [] } }));
    api.post(ENDPOINT[tab], { targetRole: ctx.targetRole, skills: ctx.currentSkills, missingSkills: ctx.missingSkills })
      .then((r) => {
        const items = (r?.candidates || []).map((c) => score(c, c.sourceType || tab)).sort((a, b) => b.fitScore - a.fitScore);
        setRemote((m) => ({ ...m, [tab]: { status: items.length ? 'done' : 'empty', items, warning: r?.warning || r?.message } }));
      })
      .catch(() => setRemote((m) => ({ ...m, [tab]: { status: 'error', items: [], warning: 'This source is unavailable right now — try curated Project Ideas.' } })));
  }, [tab]);

  const buildIdea = (cand) => {
    saveStudioSeed({
      idea: { title: cand.title, problem: cand.summary, difficulty: cand.difficulty, businessAngle: cand.businessUseCase },
      targetRole: cand.targetRoles?.[0] || ctx.targetRole, type: cand.projectType,
      missingSkills: cand.skillsCovered,
      jd: `${cand.title}\n\nProblem: ${cand.summary}\n\n${cand.businessUseCase ? 'Business use case: ' + cand.businessUseCase : ''}\n\nBuild an original, recruiter-ready project (not a clone) with architecture, GitHub, live demo, README, tests and interview prep.`,
    });
    flash('Idea loaded into Career Project Studio.');
    go?.('projectstudio');
  };
  const onSave = (cand) => { saveIdea(cand); setSavedIds(getSavedIdeas().map((i) => i.id)); flash('Saved to your ideas.'); };

  const current = tab === 'ideas' ? { status: 'done', items: localIdeas } : tab === 'startup' ? { status: 'done', items: startupIdeas } : (remote[tab] || { status: 'loading', items: [] });

  return (
    <SectionCard title="Project ideas & inspiration" action={<Badge tone="amber">Inspiration · not user-published</Badge>} className="mb-4">
      <p className="mb-3 text-[13px] leading-relaxed text-slate-400">Discover original, source-backed project and startup ideas, scored against your profile. These are inspiration — they are <span className="text-slate-300">not</span> projects published by users. Build any one to generate a full roadmap.</p>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {MARKET_TABS.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition ${tab === id ? 'bg-aurora-violet/20 text-white ring-1 ring-aurora-violet/40' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {current.status === 'loading' && <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Finding real project inspiration…</div>}
      {(current.status === 'error' || current.status === 'empty') && (
        <div className="rounded-xl border border-amber-glow/25 bg-amber-glow/10 p-3 text-[12px] text-amber-glow"><AlertTriangle size={13} className="mr-1 inline" />{current.warning || 'No ideas found for this source — try curated Project Ideas.'}</div>
      )}
      {current.status === 'done' && (
        <>
          {remote[tab]?.warning && <div className="mb-3 rounded-xl border border-white/10 bg-ink-950/55 p-2.5 text-[11px] text-slate-400">{remote[tab].warning}</div>}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {current.items.map((cand) => <IdeaCard key={cand.id} cand={cand} onBuild={buildIdea} onSave={onSave} onFit={setFit} saved={savedIds.includes(cand.id)} />)}
          </div>
        </>
      )}
      <FitModal open={!!fit} onClose={() => setFit(null)} cand={fit} />
    </SectionCard>
  );
}

function recruiterSummary(p, userName) {
  if (p.recruiterSummary && p.recruiterSummary.trim()) return p.recruiterSummary;
  const top = (p.skillsCovered || []).slice(0, 4).join(', ');
  const score = proofScoreBreakdown(p).score;
  return `${userName} — ${p.targetRole} candidate with a ${p.type} project demonstrating ${top}. Proof score ${score}/100, including ${p.github?.success ? 'verified GitHub' : p.githubUrl ? 'public code' : 'code (pending)'} and ${p.liveVerification?.reachable ? 'a verified live demo' : p.liveDemoUrl ? 'a live demo' : 'demo (pending)'}.`;
}
function VerifiedIcons({ p }) {
  return (
    <>
      {p.github?.success && <Badge tone="violet" title={`GitHub verified ${p.github.githubScore}/100`}><BadgeCheck size={11} /> GitHub</Badge>}
      {p.liveVerification?.reachable && <Badge tone="mint" title="Live demo verified"><BadgeCheck size={11} /> Live</Badge>}
    </>
  );
}

function ProjectModal({ p, open, onClose, userName, access, onContact, onShortlist, onClone, onCollab }) {
  const [badgeOpen, setBadgeOpen] = useState(null);
  if (!p) return null;
  const badges = deriveBadges([p], access);
  const eng = engagementFor(p.id);
  const score = proofScoreBreakdown(p).score;
  const st = calculateProjectStatus(p);
  return (
    <>
      <Modal open={open} onClose={onClose} width="max-w-2xl" title={p.title}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={st.status} />
            <Badge tone="violet"><Target size={11} /> {p.targetRole}</Badge>
            <Badge tone="mint"><Award size={11} /> Proof {score}/100</Badge>
            <Badge tone="cyan">{p.type}</Badge>
            <VerifiedIcons p={p} />
            <Badge>{userName}</Badge>
          </div>
          <p className="text-sm leading-relaxed text-slate-300">{p.useCase}</p>
          {badges.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Skills proven</div>
              <div className="flex flex-wrap gap-1.5">{badges.map((b) => <BadgePill key={b.skillName + b.level} badge={b} onClick={setBadgeOpen} />)}</div>
            </div>
          )}
          <div><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Tech stack</div><div className="flex flex-wrap gap-1.5">{(p.techStack || []).map((s, i) => <Badge key={i} tone="violet">{s}</Badge>)}</div></div>
          {(p.architectureDiagram || p.architecture) && (
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Architecture</div>
              {p.architectureDiagram ? <ArchitectureDiagram mermaid={p.architectureDiagram} height={240} /> : <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3"><p className="text-[13px] text-slate-300">{p.architecture}</p></div>}
            </div>
          )}
          {(p.screenshots || []).length > 0 && (
            <div><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Screenshots</div><div className="flex flex-wrap gap-2">{p.screenshots.map((s, i) => <span key={i} className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] px-3 py-2 text-[11px] text-slate-400">{s.label || `Screenshot ${i + 1}`}</span>)}</div></div>
          )}
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3"><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Recruiter summary</div><p className="text-[13px] text-slate-300">{recruiterSummary(p, userName)}</p></div>
          <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
            {p.githubUrl && <a href={p.githubUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Github size={14} /> Code</Button></a>}
            {p.liveDemoUrl && <a href={p.liveDemoUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Globe size={14} /> Live demo</Button></a>}
            <Button size="sm" variant="soft" onClick={() => onClone(p)}><Copy size={14} /> Clone roadmap</Button>
            <Button size="sm" variant="soft" onClick={() => onClone(p)}><BookOpen size={14} /> View build guide</Button>
            <Button size="sm" variant="soft" onClick={() => onCollab(p)}><Users size={14} /> Request collaboration</Button>
            <Button size="sm" variant="soft" onClick={() => onShortlist(p)}><Star size={14} /> {eng.shortlisted ? 'Shortlisted' : 'Shortlist'}</Button>
            <Button size="sm" onClick={() => onContact(p)}><Mail size={14} /> Contact candidate</Button>
          </div>
        </div>
      </Modal>
      <BadgeModal badge={badgeOpen} open={!!badgeOpen} onClose={() => setBadgeOpen(null)} />
    </>
  );
}

export default function Sandbox({ go }) {
  const { user } = useAuth();
  const access = getAccessForUser(user);
  const userName = user?.name || user?.displayName || 'You';
  const [list, setList] = useState(getPublishedProjects());
  const [open, setOpen] = useState(null);
  const [toast, setToast] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [minScore, setMinScore] = useState(0);

  useEffect(() => {
    const sync = () => setList(getPublishedProjects());
    window.addEventListener('career-projects-updated', sync);
    window.addEventListener('career-engagement-updated', sync);
    return () => {
      window.removeEventListener('career-projects-updated', sync);
      window.removeEventListener('career-engagement-updated', sync);
    };
  }, []);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2400); };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const f = list.filter((p) => {
      if (role && p.targetRole !== role) return false;
      if (proofScoreBreakdown(p).score < minScore) return false;
      if (!term) return true;
      const hay = [p.title, p.targetRole, (p.skillsCovered || []).join(' '), (p.techStack || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(term);
    });
    return rankProjects(f);
  }, [list, q, role, minScore]);

  const rolesPresent = Array.from(new Set(list.map((p) => p.targetRole)));

  const onClone = (p) => {
    const copy = {
      ...p,
      id: uid('proj'),
      title: `${p.title} (cloned)`,
      published: false,
      githubUrl: '', liveDemoUrl: '', screenshots: [],
      tasks: (p.tasks || []).map((t) => ({ ...t, status: 'todo' })),
      checklist: (p.checklist || []).map((c) => ({ ...c, done: false })),
      createdAt: undefined, updatedAt: undefined,
    };
    saveProject(copy);
    flash('Roadmap cloned to your workspaces.');
    setOpen(null);
    go?.('projectstudio');
  };
  const onCollab = (p) => {
    savePartnerRequest({ id: uid('req'), projectId: p.id, projectTitle: p.title, role: p.targetRole, skills: p.skillsCovered || [], note: 'Collaboration requested from Sandbox', status: 'open' });
    flash('Collaboration request sent.');
  };
  const onShortlist = (p) => { toggleShortlist(p.id); flash('Shortlist updated.'); };
  const onContact = (p) => { markContacted(p.id); flash('Marked as contacted — candidate notified once recruiter backend is live.'); };

  return (
    <>
      <PageIntro title="Proof-of-Work Sandbox" sub="Published projects ranked by real proof — the way a recruiter would see them." />

      {toast && <div className="mb-4 rounded-xl border border-aurora-mint/30 bg-aurora-mint/10 px-4 py-2.5 text-sm text-slate-100">{toast}</div>}

      <SectionCard title="Filters" action={<Filter size={16} className="text-aurora-cyan" />} className="mb-4">
        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, skills, stack…" className="pl-9" />
          </div>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-ink-950 px-3 text-sm text-slate-100">
            <option value="">All roles</option>
            {rolesPresent.map((r) => <option key={r}>{r}</option>)}
          </select>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3">
            <span className="whitespace-nowrap text-[11px] text-slate-400">Min proof</span>
            <input type="range" min="0" max="100" step="10" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="flex-1 accent-violet-500" />
            <span className="w-8 text-right font-mono text-xs text-slate-300">{minScore}</span>
          </div>
        </div>
      </SectionCard>

      <MarketplaceIdeas go={go} flash={flash} />

      <SectionCard title="Published projects" action={<Badge tone="mint">{filtered.length}</Badge>}>
        {list.length === 0 ? (
          <EmptyState icon={Rocket} title="No published projects yet" hint="Build a project in Career Project Studio, save it as a workspace, then click “Publish to Sandbox”." action={<Button size="sm" onClick={() => go?.('projectstudio')}>Build a project</Button>} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Search} title="No matches" hint="Try clearing filters or lowering the minimum proof score." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => {
              const score = proofScoreBreakdown(p).score;
              const badges = deriveBadges([p], access).slice(0, 3);
              return (
                <div key={p.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/25">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="truncate font-medium text-white">{p.title}</h4>
                      <p className="mt-0.5 truncate text-xs text-slate-400">{userName} · {p.targetRole}</p>
                    </div>
                    <ScoreRing score={score} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5"><StatusBadge status={calculateProjectStatus(p).status} /><VerifiedIcons p={p} /></div>
                  <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-slate-400">{p.useCase}</p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">{(p.skillsCovered || []).slice(0, 5).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div>
                  {badges.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{badges.map((b) => <BadgePill key={b.skillName + b.level} badge={b} onClick={() => setOpen(p)} />)}</div>}
                  <div className="mt-auto flex flex-wrap gap-2 pt-3">
                    <Button size="sm" onClick={() => setOpen(p)}><Eye size={13} /> View project</Button>
                    {p.githubUrl && <a href={p.githubUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Github size={13} /></Button></a>}
                    {p.liveDemoUrl && <a href={p.liveDemoUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Globe size={13} /></Button></a>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
      <ProjectModal
        p={open} open={!!open} onClose={() => setOpen(null)} userName={userName} access={access}
        onContact={onContact} onShortlist={onShortlist} onClone={onClone} onCollab={onCollab}
      />
    </>
  );
}
