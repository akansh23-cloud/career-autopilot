import { useEffect, useMemo, useState } from 'react';
import {
  Rocket, Github, Globe, Target, Award, Eye, Mail, Copy, Users, Star, Filter, Search,
  ShieldCheck, BadgeCheck, BookOpen,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Modal, EmptyState, Input } from '../components/ui/kit.jsx';
import { ScoreRing, BadgePill, BadgeModal, StatusBadge, ArchitectureDiagram } from '../components/proof/ProofViews.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import {
  getPublishedProjects, getProjects, saveProject, savePartnerRequest, uid, proofScoreBreakdown,
} from '../lib/projectStore.js';
import { deriveBadges } from '../lib/badges.js';
import { rankProjects } from '../lib/roleFit.js';
import { calculateProjectStatus } from '../lib/projectStatus.js';
import { getAccessForUser } from '../lib/access.js';
import { toggleShortlist, markContacted, engagementFor } from '../lib/engagement.js';


const MARKET_IDEAS = [
  {
    id: 'idea-campus-skill-market',
    title: 'Campus Skill Exchange Marketplace',
    targetRole: 'Full Stack Developer',
    type: 'Full Stack',
    tags: ['React', 'Node.js', 'MongoDB', 'Matching Algorithm', 'Payments'],
    problem: 'Students have skills but no structured way to trade help, form teams, and prove contributions across projects.',
    businessAngle: 'Can become a college SaaS for project collaboration, peer tutoring, and placement-cell proof tracking.',
    difficulty: 'Intermediate',
  },
  {
    id: 'idea-local-business-ai',
    title: 'AI CRM for Local Shops and Clinics',
    targetRole: 'Backend Developer',
    type: 'Full Stack',
    tags: ['Auth', 'CRM', 'WhatsApp', 'Analytics', 'AI Summaries'],
    problem: 'Small businesses lose repeat customers because they do not track follow-ups, reminders, service history or leads properly.',
    businessAngle: 'Subscription SaaS for local shops, clinics, tutors, salons and repair businesses.',
    difficulty: 'Intermediate',
  },
  {
    id: 'idea-devops-cost-guard',
    title: 'Cloud Cost Guardrail Dashboard',
    targetRole: 'DevOps Engineer',
    type: 'DevOps',
    tags: ['AWS', 'Docker', 'CI/CD', 'Terraform', 'Monitoring'],
    problem: 'Students and startups deploy cloud projects but do not understand cost, idle resources, alerts or budget limits.',
    businessAngle: 'A lightweight FinOps tool for student builders and early startups to avoid cloud bill shocks.',
    difficulty: 'Advanced',
  },
  {
    id: 'idea-placement-readiness',
    title: 'Placement Readiness Operating System',
    targetRole: 'Product Engineer',
    type: 'Full Stack',
    tags: ['Roadmaps', 'XP', 'Resume', 'Analytics', 'Recruiter Console'],
    problem: 'Students do random learning without a measurable path from projects to resume to interviews to recruiter discovery.',
    businessAngle: 'Can become a B2B college placement platform plus student subscription product.',
    difficulty: 'Advanced',
  },
];

function MarketplaceIdeas({ go, flash }) {
  const startIdea = (idea) => {
    // Turn the marketplace idea into a real, saved student project and open its
    // workspace directly — no Studio "seed" handoff, so it can never bounce to
    // Profile / a default screen. ProjectWorkspace shows its "Generate Workspace"
    // CTA when the project has no plan yet, which is the expected next step.
    const saved = saveProject({
      id: uid('proj'),
      title: idea.title,
      targetRole: idea.targetRole,
      type: idea.type,
      difficulty: idea.difficulty,
      problemStatement: idea.problem,
      useCase: idea.businessAngle,
      businessAngle: idea.businessAngle,
      skillsCovered: idea.tags || [],
      tags: idea.tags || [],
      techStack: [],
      sourceIdea: { id: idea.id, title: idea.title, source: 'marketplace' },
      sourceJob: { title: idea.title, company: 'Marketplace idea' },
      published: false,
    });
    flash('Project created — opening your workspace.');
    go?.('projectworkspace', { projectId: saved.id });
  };
  return (
    <SectionCard title="Startup-grade project ideas" action={<Badge tone="amber">Marketplace ideas</Badge>} className="mb-4">
      <p className="mb-3 text-[13px] leading-relaxed text-fg-secondary">Use this marketplace not only to show finished projects, but also to discover serious project/problem statements that can become portfolio proof, hackathon entries, or startup experiments.</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {MARKET_IDEAS.map((idea) => (
          <div key={idea.id} className="flex flex-col rounded-2xl border border-subtle bg-surface-1 p-4 transition hover:border-aurora-violet/35">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-medium leading-tight text-fg">{idea.title}</h4>
              <Badge tone={idea.difficulty === 'Advanced' ? 'amber' : 'cyan'}>{idea.difficulty}</Badge>
            </div>
            <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-fg-secondary">{idea.problem}</p>
            <div className="mt-2 rounded-xl border border-subtle bg-base/55 p-2 text-[11px] leading-relaxed text-fg-muted"><span className="text-fg-secondary">Business angle:</span> {idea.businessAngle}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">{idea.tags.slice(0, 5).map((t) => <Badge key={t} tone="violet">{t}</Badge>)}</div>
            <Button size="sm" className="mt-auto pt-3" onClick={() => startIdea(idea)}><Rocket size={13} /> Build this idea</Button>
          </div>
        ))}
      </div>
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
          <p className="text-sm leading-relaxed text-fg-secondary">{p.useCase}</p>
          {badges.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">Skills proven</div>
              <div className="flex flex-wrap gap-1.5">{badges.map((b) => <BadgePill key={b.skillName + b.level} badge={b} onClick={setBadgeOpen} />)}</div>
            </div>
          )}
          <div><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">Tech stack</div><div className="flex flex-wrap gap-1.5">{(p.techStack || []).map((s, i) => <Badge key={i} tone="violet">{s}</Badge>)}</div></div>
          {(p.architectureDiagram || p.architecture) && (
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">Architecture</div>
              {p.architectureDiagram ? <ArchitectureDiagram mermaid={p.architectureDiagram} height={240} /> : <div className="rounded-xl border border-subtle bg-base/55 p-3"><p className="text-[13px] text-fg-secondary">{p.architecture}</p></div>}
            </div>
          )}
          {(p.screenshots || []).length > 0 && (
            <div><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">Screenshots</div><div className="flex flex-wrap gap-2">{p.screenshots.map((s, i) => <span key={i} className="rounded-lg border border-dashed border-strong bg-surface-1 px-3 py-2 text-[11px] text-fg-secondary">{s.label || `Screenshot ${i + 1}`}</span>)}</div></div>
          )}
          <div className="rounded-xl border border-subtle bg-base/55 p-3"><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">Recruiter summary</div><p className="text-[13px] text-fg-secondary">{recruiterSummary(p, userName)}</p></div>
          <div className="flex flex-wrap gap-2 border-t border-subtle pt-4">
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

      {toast && <div className="mb-4 rounded-xl border border-aurora-mint/30 bg-aurora-mint/10 px-4 py-2.5 text-sm text-fg">{toast}</div>}

      <SectionCard title="Filters" action={<Filter size={16} className="text-aurora-cyan" />} className="mb-4">
        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, skills, stack…" className="pl-9" />
          </div>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="h-11 w-full rounded-xl border border-subtle bg-base px-3 text-sm text-fg">
            <option value="">All roles</option>
            {rolesPresent.map((r) => <option key={r}>{r}</option>)}
          </select>
          <div className="flex items-center gap-2 rounded-xl border border-subtle bg-surface-1 px-3">
            <span className="whitespace-nowrap text-[11px] text-fg-secondary">Min proof</span>
            <input type="range" min="0" max="100" step="10" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="flex-1 accent-violet-500" />
            <span className="w-8 text-right font-mono text-xs text-fg-secondary">{minScore}</span>
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
                <div key={p.id} className="flex flex-col rounded-2xl border border-subtle bg-surface-1 p-4 transition hover:border-strong">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="truncate font-medium text-fg">{p.title}</h4>
                      <p className="mt-0.5 truncate text-xs text-fg-secondary">{userName} · {p.targetRole}</p>
                    </div>
                    <ScoreRing score={score} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5"><StatusBadge status={calculateProjectStatus(p).status} /><VerifiedIcons p={p} /></div>
                  <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-fg-secondary">{p.useCase}</p>
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
