import { useEffect, useMemo, useState } from 'react';
import {
  Rocket, Award, TrendingUp, Target, Building2, UserSearch, GraduationCap,
  Briefcase, KanbanSquare, Send, ArrowRight, Sparkles, CheckCircle2, Circle, Code2, Mic, CalendarCheck,
} from 'lucide-react';
import { PageIntro, SectionCard, StatCard, NextBestAction } from './common.jsx';
import { Badge, Button, EmptyState } from '../components/ui/kit.jsx';
import { ScoreRing, XpBar, BadgeModal, VerifiedBadgePanel, nextStepFor } from '../components/proof/ProofViews.jsx';
import Dashboard from './Dashboard.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { getProjects, getPublishedProjects, proofScoreBreakdown } from '../lib/projectStore.js';
import { deriveSkillXP, careerXP } from '../lib/xp.js';
import { deriveBadges } from '../lib/badges.js';
import { classifyBadges } from '../lib/skillBadges.js';
import { roleConsistency, buildCandidates } from '../lib/roleFit.js';
import { getAccessForUser } from '../lib/access.js';
import { getProfile, ROLE_LABELS } from '../lib/userProfile.js';
import { getCurrentEffectiveRole, canSeeScreen } from '../lib/roleCapabilities.js';
import { getWeeklyMissions, setMissionDone, missionStats } from '../lib/missions.js';
import { assembleMyProfile, adoptionSuggestions, requestCareerProfileEditor } from '../lib/network.js';
import { BadgeCheck, Medal, Handshake } from 'lucide-react';

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


const MISSION_STYLE = {
  project: { icon: Rocket, tone: 'violet', label: 'Project' },
  coding: { icon: Code2, tone: 'cyan', label: 'Coding' },
  interview: { icon: Mic, tone: 'amber', label: 'Interview' },
  career: { icon: Briefcase, tone: 'mint', label: 'Resume' },
  opportunity: { icon: Target, tone: 'violet', label: 'Market' },
};

function WeeklyMissionPanel({ go }) {
  const [missions, setMissions] = useState(getWeeklyMissions());
  useEffect(() => {
    const sync = () => setMissions(getWeeklyMissions());
    window.addEventListener('career-missions-updated', sync);
    window.addEventListener('career-projects-updated', sync);
    window.addEventListener('career-resume-updated', sync);
    return () => {
      window.removeEventListener('career-missions-updated', sync);
      window.removeEventListener('career-projects-updated', sync);
      window.removeEventListener('career-resume-updated', sync);
    };
  }, []);
  const stats = missionStats(missions);
  const toggle = (m) => setMissions(setMissionDone(m.id, !m.done));
  // Only surface missions whose target screen the current role may open
  // (e.g. year 1–2 students don't get résumé/jobs missions).
  const role = getCurrentEffectiveRole();
  const visibleMissions = missions.filter((m) => canSeeScreen(role, m.route));
  return (
    <SectionCard title="This week’s skill sprint" action={<Badge tone="mint">{stats.done}/{stats.total} done · {stats.xpEarned}/{stats.xpTotal} XP</Badge>}>
      <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.025] p-3">
        <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
          <span>Weekly progress</span><span>{stats.percent}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-aurora-cta" style={{ width: `${stats.percent}%` }} /></div>
        <p className="mt-2 text-[12px] leading-relaxed text-slate-400">A balanced mix of building, coding, interview practice and market alignment so students return weekly and improve with visible proof.</p>
      </div>
      <div className="space-y-2.5">
        {visibleMissions.map((m) => {
          const meta = MISSION_STYLE[m.type] || MISSION_STYLE.project;
          const Icon = meta.icon;
          return (
            <div key={m.id} className={`rounded-xl border p-3 transition ${m.done ? 'border-aurora-mint/25 bg-aurora-mint/8' : 'border-white/8 bg-white/[0.02] hover:border-white/18'}`}>
              <div className="flex items-start gap-3">
                <button onClick={() => toggle(m)} className={`mt-0.5 ${m.done ? 'text-aurora-mint' : 'text-slate-500 hover:text-slate-200'}`}>{m.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}</button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={meta.tone}><Icon size={10} /> {meta.label}</Badge>
                    <span className="text-[11px] text-slate-500">{m.minutes} min · +{m.xp} XP</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-white">{m.title}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{m.detail}</p>
                  <p className="mt-1 text-[11px] text-slate-500">Why: {m.why}</p>
                </div>
                <Button size="sm" variant="soft" onClick={() => go(m.route)}>{m.cta}</Button>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function ProfileAdoptionPanel({ go }) {
  const [profile, setProfile] = useState(() => assembleMyProfile());
  useEffect(() => {
    const sync = () => setProfile(assembleMyProfile());
    ['career-network-updated', 'career-projects-updated', 'career-profile-updated', 'career-missions-updated'].forEach((e) => window.addEventListener(e, sync));
    return () => ['career-network-updated', 'career-projects-updated', 'career-profile-updated', 'career-missions-updated'].forEach((e) => window.removeEventListener(e, sync));
  }, []);
  const suggestions = adoptionSuggestions(profile);
  const m = profile.metrics;
  const eligible = m.publishedCount > 0;
  return (
    <SectionCard
      title="Grow your Career Proof Profile"
      action={<button onClick={() => go('careerprofile')} className="text-xs text-aurora-cyan hover:underline">Open profile</button>}
    >
      <div className="grid gap-4 md:grid-cols-[auto,1fr] md:items-center">
        <div className="flex items-center gap-4">
          <ScoreRing score={profile.completeness} label="Complete" />
          <div className="text-xs text-slate-400">
            <p className="text-sm font-medium text-white">{profile.trustLevel} · {profile.trustScore}/100 trust</p>
            <p className="mt-0.5">{eligible ? 'Eligible for leaderboards' : 'Publish a project to rank'}</p>
            <p className="mt-0.5">{m.missionStreak ? `${m.missionStreak}-week mission streak` : 'Start a weekly streak'}</p>
          </div>
        </div>
        <div className="space-y-2">
          {suggestions.length ? suggestions.map((s, i) => (
            <button key={i} onClick={() => { go(s.cta); if (s.editor) requestCareerProfileEditor(s.editor); }} className="lift flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-left text-[13px] text-slate-200 hover:border-white/20">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-aurora-violet/12 text-aurora-cyan"><Sparkles size={14} /></span>
              <span className="flex-1">{s.text}</span>
              <ArrowRight size={14} className="text-slate-600" />
            </button>
          )) : (
            <div className="rounded-xl border border-aurora-mint/25 bg-aurora-mint/8 px-3 py-2.5 text-[13px] text-[#BDF5DC]">Your profile is fully set up — keep your streak going and stay on the leaderboards.</div>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
        {[[BadgeCheck, 'Career Profile', 'careerprofile'], [Medal, 'Leaderboards', 'leaderboards'], [Handshake, 'Referral Exchange', 'referralexchange']]
          .filter(([, , id]) => canSeeScreen(getCurrentEffectiveRole(), id))
          .map(([Icon, label, id]) => (
          <button key={id} onClick={() => go(id)} className="lift flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-sm text-slate-200 hover:border-white/20">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-aurora-violet/12 text-aurora-cyan"><Icon size={15} /></span>
            {label}
          </button>
        ))}
      </div>
    </SectionCard>
  );
}

function StudentDashboard({ go }) {
  const { user } = useAuth();
  const access = getAccessForUser(user);
  const profile = getProfile();
  const projects = useProjectsLive();
  const [badgeOpen, setBadgeOpen] = useState(null);
  const effRole = getCurrentEffectiveRole();

  const skillXP = useMemo(() => deriveSkillXP(projects), [projects]);
  const badges = useMemo(() => deriveBadges(projects, access), [projects, access]);
  const verifiedBadges = useMemo(() => classifyBadges(badges).verified, [badges]);
  const career = useMemo(() => careerXP(projects), [projects]);
  const published = projects.filter((p) => p.published);
  const avgProof = projects.length ? Math.round(projects.reduce((s, p) => s + proofScoreBreakdown(p).score, 0) / projects.length) : 0;
  const warnings = projects.map((p) => ({ p, c: roleConsistency(p) })).filter((x) => !x.c.ok);

  const nba = projects.length === 0
    ? { title: 'Build your first proof-of-work project', description: 'Pick a guided project matched to your target role and start earning verified skill XP and badges.', primary: { label: 'Start a project', icon: Rocket, onClick: () => go('projectstudio') } }
    : published.length === 0
    ? { title: 'Publish a project to get discovered', description: 'Publish your strongest project so it counts toward leaderboards and recruiter discovery.', primary: { label: 'Publish to sandbox', icon: Rocket, onClick: () => go('sandbox') } }
    : { title: 'Keep your proof growing', description: 'Add evidence, finish this week’s missions and raise your proof score to stay recruiter-ready.', primary: { label: 'Open Project Studio', icon: Rocket, onClick: () => go('projectstudio') } };

  return (
    <>
      <PageIntro
        title={`Hi ${user?.name?.split(' ')[0] || 'there'} 👋`}
        sub={`${ROLE_LABELS[access.role]}${profile.targetRole ? ` · targeting ${profile.targetRole}` : ''} — build proof, earn XP, get recruiter-ready.`}
      />

      <NextBestAction
        title={nba.title}
        description={nba.description}
        primary={nba.primary}
        secondary={[
          { label: 'Tailor resume', icon: Briefcase, onClick: () => go('resume'), screen: 'resume' },
          { label: 'Track applications', icon: KanbanSquare, onClick: () => go('tracker'), screen: 'tracker' },
        ].filter((s) => canSeeScreen(effRole, s.screen))}
        score={projects.length ? avgProof : 0}
        scoreLabel="Proof"
      />

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard i={0} icon={TrendingUp} tone="violet" label="Career XP" value={String(career.total)} hint={career.next ? `${career.toNext} XP to ${career.next}` : 'Max level'} onClick={() => go('careerprofile')} />
        <StatCard i={1} icon={Award} tone="mint" label="Verified badges" value={String(verifiedBadges.length)} onClick={() => go('skillsxp')} />
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

      <div className="mt-4">
        <ProfileAdoptionPanel go={go} />
      </div>

      <div className="mt-4">
        <WeeklyMissionPanel go={go} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Top skill XP" action={<button onClick={() => go('skillsxp')} className="text-xs text-aurora-cyan hover:underline">View all</button>}>
          {skillXP.length ? (
            <div className="space-y-2.5">
              {skillXP.slice(0, 4).map((s) => <XpBar key={s.skillName} skill={s} />)}
              <p className="pt-1 text-[12px] text-slate-400">{nextStepFor(skillXP[0])}</p>
            </div>
          ) : (
            <EmptyState icon={TrendingUp} title="No XP yet" hint="XP is earned from real project proof — start a project to begin." action={<Button size="sm" onClick={() => go('projectstudio')}>Start now</Button>} />
          )}
        </SectionCard>

        <SectionCard title="Verified skill badges" action={<button onClick={() => go('careerprofile')} className="text-xs text-aurora-cyan hover:underline">Career Profile</button>}>
          <VerifiedBadgePanel badges={badges} onOpen={setBadgeOpen} onViewAll={() => go('skillsxp')} limit={16} />
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard title="Next steps">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {[[Rocket, 'Generate a project roadmap', 'projectstudio'], [KanbanSquare, 'Track applications', 'tracker'], [Briefcase, 'Find matching jobs', 'jobs'], [Award, 'View your Career Profile', 'careerprofile']]
              .filter(([, , id]) => canSeeScreen(effRole, id))
              .map(([Icon, label, id]) => (
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
  // professional + admin keep the original career command-centre dashboard, plus the proof-profile growth panel
  return (
    <>
      <Dashboard go={go} />
      <div className="mt-4">
        <ProfileAdoptionPanel go={go} />
      </div>
    </>
  );
}
