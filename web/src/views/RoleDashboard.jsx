import { useEffect, useMemo, useState } from 'react';
import {
  Rocket, Award, TrendingUp, Target, Building2, UserSearch, GraduationCap,
  Briefcase, KanbanSquare, Send, ArrowRight, Sparkles,
} from 'lucide-react';
import { PageIntro, SectionCard, StatCard } from './common.jsx';
import { Badge, Button, EmptyState } from '../components/ui/kit.jsx';
import { ScoreRing, XpBar, BadgePill, BadgeModal, nextStepFor } from '../components/proof/ProofViews.jsx';
import Dashboard from './Dashboard.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { getProjects, getPublishedProjects, proofScoreBreakdown } from '../lib/projectStore.js';
import { deriveSkillXP, careerXP } from '../lib/xp.js';
import { deriveBadges } from '../lib/badges.js';
import { roleConsistency, buildCandidates } from '../lib/roleFit.js';
import { getAccessForUser } from '../lib/access.js';
import { getProfile, ROLE_LABELS } from '../lib/userProfile.js';

function useProjectsLive() {
  const [projects, setProjects] = useState(getProjects());
  useEffect(() => {
    const sync = () => setProjects(getProjects());
    window.addEventListener('career-projects-updated', sync);
    window.addEventListener('career-engagement-updated', sync);
    return () => {
      window.removeEventListener('career-projects-updated', sync);
      window.removeEventListener('career-engagement-updated', sync);
    };
  }, []);
  return projects;
}

function StudentDashboard({ go }) {
  const { user } = useAuth();
  const access = getAccessForUser(user);
  const profile = getProfile();
  const projects = useProjectsLive();
  const [badgeOpen, setBadgeOpen] = useState(null);

  const skillXP = useMemo(() => deriveSkillXP(projects), [projects]);
  const badges = useMemo(() => deriveBadges(projects, access), [projects, access]);
  const career = useMemo(() => careerXP(projects), [projects]);
  const published = projects.filter((p) => p.published);
  const avgProof = projects.length ? Math.round(projects.reduce((s, p) => s + proofScoreBreakdown(p).score, 0) / projects.length) : 0;
  const warnings = projects.map((p) => ({ p, c: roleConsistency(p) })).filter((x) => !x.c.ok);

  return (
    <>
      <PageIntro
        title={`Hi ${user?.name?.split(' ')[0] || 'there'} 👋`}
        sub={`${ROLE_LABELS[access.role]}${profile.targetRole ? ` · targeting ${profile.targetRole}` : ''} — build proof, earn XP, get recruiter-ready.`}
        action={<Button onClick={() => go('projectstudio')}><Rocket size={16} /> Build a project</Button>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard i={0} icon={TrendingUp} tone="violet" label="Career XP" value={String(career.total)} hint={career.next ? `${career.toNext} XP to ${career.next}` : 'Max level'} onClick={() => go('profile')} />
        <StatCard i={1} icon={Award} tone="mint" label="Verified badges" value={String(badges.length)} onClick={() => go('profile')} />
        <StatCard i={2} icon={Rocket} tone="cyan" label="Published" value={String(published.length)} hint={!published.length ? 'Publish your first project' : undefined} onClick={() => go('sandbox')} />
        <StatCard i={3} icon={Target} tone="amber" label="Avg proof" value={projects.length ? String(avgProof) : '—'} hint={!projects.length ? 'Build a project' : undefined} />
      </div>

      {warnings.length > 0 && (
        <div className="mt-4 space-y-2">
          {warnings.slice(0, 2).map(({ p, c }) => (
            <div key={p.id} className="rounded-xl border border-amber-glow/30 bg-amber-glow/10 px-4 py-2.5 text-[13px] text-amber-100">
              <span className="font-medium text-white">{p.title}:</span> {c.warning}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Top skill XP" action={<button onClick={() => go('profile')} className="text-xs text-aurora-cyan hover:underline">View all</button>}>
          {skillXP.length ? (
            <div className="space-y-2.5">
              {skillXP.slice(0, 4).map((s) => <XpBar key={s.skillName} skill={s} />)}
              <p className="pt-1 text-[12px] text-slate-400">{nextStepFor(skillXP[0])}</p>
            </div>
          ) : (
            <EmptyState icon={TrendingUp} title="No XP yet" hint="XP is earned from real project proof — start a project to begin." action={<Button size="sm" onClick={() => go('projectstudio')}>Start now</Button>} />
          )}
        </SectionCard>

        <SectionCard title="Verified badges" action={<button onClick={() => go('profile')} className="text-xs text-aurora-cyan hover:underline">Profile</button>}>
          {badges.length ? (
            <div className="flex flex-wrap gap-2">{badges.slice(0, 12).map((b) => <BadgePill key={b.skillName + b.level} badge={b} onClick={setBadgeOpen} />)}</div>
          ) : (
            <EmptyState icon={Award} title="No badges yet" hint="Add a GitHub repo, a live demo and complete the checklist to earn evidence-based badges." />
          )}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard title="Next steps">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {[[Rocket, 'Generate a project roadmap', 'projectstudio'], [KanbanSquare, 'Track applications', 'tracker'], [Briefcase, 'Find matching jobs', 'jobs'], [Award, 'View your profile', 'profile']].map(([Icon, label, id]) => (
              <button key={id} onClick={() => go(id)} className="lift flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-sm text-slate-200 hover:border-white/20">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-aurora-violet/12 text-aurora-cyan"><Icon size={16} /></span>
                {label}<ArrowRight size={15} className="ml-auto text-slate-600" />
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      <BadgeModal badge={badgeOpen} open={!!badgeOpen} onClose={() => setBadgeOpen(null)} />
    </>
  );
}

function RecruiterDashboard({ go }) {
  const { user } = useAuth();
  const access = getAccessForUser(user);
  const profile = getProfile();
  const projects = useProjectsLive();
  const published = getPublishedProjects();
  const candidates = useMemo(() => buildCandidates(published, access), [published, access]);

  return (
    <>
      <PageIntro
        title={`${profile.company || 'Recruiter'} hiring console`}
        sub={`Find proven candidates by role, skills and proof score.${profile.hiringRole ? ` Hiring for ${profile.hiringRole}.` : ''}`}
        action={<Button onClick={() => go('recruiter')}><UserSearch size={16} /> Search candidates</Button>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard i={0} icon={UserSearch} tone="violet" label="Candidates" value={String(candidates.length)} hint={!candidates.length ? 'No published profiles yet' : undefined} onClick={() => go('recruiter')} />
        <StatCard i={1} icon={Rocket} tone="cyan" label="Published projects" value={String(published.length)} onClick={() => go('sandbox')} />
        <StatCard i={2} icon={Award} tone="mint" label="Discovery" value={access.features.recruiterDiscovery ? 'On' : 'Premium'} hint={access.features.recruiterDiscovery ? undefined : 'Upgrade for discovery'} />
      </div>
      <div className="mt-4">
        <SectionCard title="Talent pipeline">
          {candidates.length ? (
            <div className="space-y-2.5">
              {candidates.slice(0, 5).map((c) => (
                <button key={c.id} onClick={() => go('recruiter')} className="lift flex w-full items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-left hover:border-white/20">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{c.name}</p>
                    <p className="truncate text-xs text-slate-500">{c.targetRole} · {c.topSkillNames.slice(0, 3).join(', ')}</p>
                  </div>
                  <Badge tone="mint"><Award size={11} /> {c.avgProof}</Badge>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={UserSearch} title="No candidates yet" hint="Published proof-of-work profiles will appear here. No fake candidates are shown." action={<Button size="sm" onClick={() => go('recruiter')}>Open console</Button>} />
          )}
        </SectionCard>
      </div>
    </>
  );
}

function CollegeDashboard({ go }) {
  const profile = getProfile();
  const published = getPublishedProjects();
  return (
    <>
      <PageIntro title={`${profile.college || 'Placement Cell'} dashboard`} sub={`${profile.department || 'Department'} · placement readiness overview.`} />
      <SectionCard title="Placement readiness">
        <EmptyState
          icon={Building2}
          title="College analytics — coming soon"
          hint={`Student readiness, verified-skill coverage and proof-of-work analytics will appear here. ${published.length} published project(s) in this workspace so far.`}
          action={<Button size="sm" onClick={() => go('sandbox')}><Rocket size={14} /> Browse sandbox</Button>}
        />
      </SectionCard>
    </>
  );
}

export default function RoleDashboard({ go }) {
  const { user } = useAuth();
  const access = getAccessForUser(user);
  if (access.role === 'student') return <StudentDashboard go={go} />;
  if (access.role === 'recruiter') return <RecruiterDashboard go={go} />;
  if (access.role === 'college_admin') return <CollegeDashboard go={go} />;
  // professional + admin keep the original career command-centre dashboard
  return <Dashboard go={go} />;
}
