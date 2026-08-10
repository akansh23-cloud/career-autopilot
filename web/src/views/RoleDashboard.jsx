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
import { fetchNextBestActions, fetchReadiness } from '../lib/nextBestAction.js';
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
      <div className="mb-4 rounded-xl border border-subtle bg-surface-1 p-3">
        <div className="flex items-center justify-between gap-3 text-xs text-fg-secondary">
          <span>Weekly progress</span><span>{stats.percent}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-1"><div className="h-full rounded-full bg-aurora-cta" style={{ width: `${stats.percent}%` }} /></div>
        <p className="mt-2 text-[12px] leading-relaxed text-fg-secondary">A balanced mix of building, coding, interview practice and market alignment so students return weekly and improve with visible proof.</p>
      </div>
      <div className="space-y-2.5">
        {visibleMissions.map((m) => {
          const meta = MISSION_STYLE[m.type] || MISSION_STYLE.project;
          const Icon = meta.icon;
          return (
            <div key={m.id} className={`rounded-xl border p-3 transition ${m.done ? 'border-aurora-mint/25 bg-aurora-mint/10' : 'border-subtle bg-surface-1 hover:border-strong'}`}>
              <div className="flex items-start gap-3">
                <button onClick={() => toggle(m)} className={`mt-0.5 ${m.done ? 'text-aurora-mint' : 'text-fg-muted hover:text-fg'}`}>{m.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}</button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={meta.tone}><Icon size={10} /> {meta.label}</Badge>
                    <span className="text-[11px] text-fg-muted">{m.minutes} min · +{m.xp} XP</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-fg">{m.title}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-fg-secondary">{m.detail}</p>
                  <p className="mt-1 text-[11px] text-fg-muted">Why: {m.why}</p>
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
      action={<button onClick={() => go('careerprofile')} className="text-xs text-brand hover:underline">Open profile</button>}
    >
      <div className="grid gap-4 md:grid-cols-[auto,1fr] md:items-center">
        <div className="flex items-center gap-4">
          <ScoreRing score={profile.completeness} label="Complete" />
          <div className="text-xs text-fg-secondary">
            <p className="text-sm font-medium text-fg">{profile.trustLevel} · {profile.trustScore}/100 trust</p>
            <p className="mt-0.5">{eligible ? 'Eligible for leaderboards' : 'Publish a project to rank'}</p>
            <p className="mt-0.5">{m.missionStreak ? `${m.missionStreak}-week mission streak` : 'Start a weekly streak'}</p>
          </div>
        </div>
        <div className="space-y-2">
          {suggestions.length ? suggestions.map((s, i) => (
            <button key={i} onClick={() => { go(s.cta); if (s.editor) requestCareerProfileEditor(s.editor); }} className="lift flex w-full items-center gap-3 rounded-xl border border-subtle bg-surface-1 px-3 py-2.5 text-left text-[13px] text-fg hover:border-strong">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-indigo-50 text-aurora-violet"><Sparkles size={14} /></span>
              <span className="flex-1">{s.text}</span>
              <ArrowRight size={14} className="text-fg-muted" />
            </button>
          )) : (
            <div className="rounded-xl border border-aurora-mint/25 bg-aurora-mint/10 px-3 py-2.5 text-[13px] text-ok">Your profile is fully set up — keep your streak going and stay on the leaderboards.</div>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
        {[[BadgeCheck, 'Career Profile', 'careerprofile'], [Medal, 'Leaderboards', 'leaderboards'], [Handshake, 'Referral Exchange', 'referralexchange']]
          .filter(([, , id]) => canSeeScreen(getCurrentEffectiveRole(), id))
          .map(([Icon, label, id]) => (
          <button key={id} onClick={() => go(id)} className="lift flex items-center gap-2.5 rounded-xl border border-subtle bg-surface-1 px-3 py-2.5 text-sm text-fg hover:border-strong">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-aurora-violet"><Icon size={15} /></span>
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

  /* ---- Phase 2: the dashboard answers "what should I do today?" ----
     Server-first (readiness v2 + platform Next Best Action), honest local
     fallback when the DB is off. Nothing below renders fabricated state. */
  const [nba, setNba] = useState(null);
  const [readinessData, setReadinessData] = useState(null);
  useEffect(() => {
    let alive = true;
    const role = getProfile().targetRole || '';
    fetchNextBestActions({ targetRole: role }).then((r) => { if (alive) setNba(r); });
    fetchReadiness({ targetRole: role }).then((r) => { if (alive) setReadinessData(r); });
    return () => { alive = false; };
  }, []);
  const roleReadiness = readinessData?.roleReadiness || nba?.roleReadiness || null;
  const readinessChange = readinessData?.change || null;

  const skillXP = useMemo(() => deriveSkillXP(projects), [projects]);
  const badges = useMemo(() => deriveBadges(projects, access), [projects, access]);
  const verifiedBadges = useMemo(() => classifyBadges(badges).verified, [badges]);
  const career = useMemo(() => careerXP(projects), [projects]);
  const published = projects.filter((p) => p.published);
  const avgProof = projects.length ? Math.round(projects.reduce((s, p) => s + proofScoreBreakdown(p).score, 0) / projects.length) : 0;
  const warnings = projects.map((p) => ({ p, c: roleConsistency(p) })).filter((x) => !x.c.ok);

  /* Highest-impact action from the engine (server or local). */
  const top = nba?.highestImpact || null;
  const goCta = (a) => go(a?.cta?.view || 'projectstudio');
  const verificationActions = (nba?.actions || []).filter((a) => a.actionType === 'submit_evidence').slice(0, 2);
  const resumeAction = (nba?.actions || []).find((a) => a.actionType === 'resume_add_evidence') || null;

  /* Active project: prefer one with a real workspace plan. */
  const activeProject = projects.find((p) => p.workspacePlan && (p.workspacePlan.tasks || []).length) || projects[0] || null;
  const activeProg = activeProject?.workspacePlan?.progress || null;

  const gapChips = (roleReadiness?.topActions || []).flatMap((a) => a.skills || []).slice(0, 6);

  return (
    <>
      <PageIntro
        title={`Hi ${user?.name?.split(' ')[0] || 'there'} 👋`}
        sub={`${ROLE_LABELS[access.role]}${profile.targetRole ? ` · targeting ${profile.targetRole}` : ''} — the plan below is computed from your real evidence state.`}
      />

      {/* 1 ── TARGET-ROLE READINESS (readiness-v2: role dimensions, explainable) */}
      {roleReadiness && (
        <SectionCard title={`${roleReadiness.targetRole} readiness — ${roleReadiness.score}%`}
          action={readinessChange?.hasBaseline && readinessChange.delta ? (
            <span className={`text-xs font-semibold ${readinessChange.delta > 0 ? 'text-ok' : 'text-danger'}`}>
              {readinessChange.delta > 0 ? '+' : ''}{readinessChange.delta} since last check
            </span>
          ) : null}
        >
          <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {roleReadiness.dimensions.slice(0, 8).map((d) => (
              <div key={d.id}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="text-fg-secondary">{d.label}</span>
                  <span className="font-semibold text-fg">{d.score}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-1">
                  <div className={`h-full rounded-full ${d.score >= 70 ? 'bg-aurora-mint' : d.score >= 40 ? 'bg-aurora-cta' : 'bg-amber-glow'}`} style={{ width: `${d.score}%` }} />
                </div>
              </div>
            ))}
          </div>
          {readinessChange?.hasBaseline && (readinessChange.reasons || []).length > 0 && (
            <p className="mt-3 text-[12px] text-fg-secondary">
              Why it moved: {readinessChange.reasons.slice(0, 2).map((r) => `${r.dimension} — ${r.detail}`).join(' · ')}
            </p>
          )}
        </SectionCard>
      )}

      {/* 2 ── HIGHEST-IMPACT NEXT ACTION (real engine output, never a slogan) */}
      {top && (
        <div className="mt-4">
          <NextBestAction
            title={top.title}
            description={`${top.explanation}${top.estimatedEffort && top.estimatedEffort !== 'varies' ? ` Estimated effort: ${top.estimatedEffort}.` : ''}`}
            primary={{ label: top.cta?.label || 'Open', icon: Rocket, onClick: () => goCta(top) }}
            secondary={(nba?.actions || []).slice(1, 3).map((a) => ({
              label: a.cta?.label || a.title.slice(0, 28), icon: a.actionType === 'resume_add_evidence' ? Briefcase : ArrowRight,
              onClick: () => goCta(a), screen: a.cta?.view,
            })).filter((sBtn) => canSeeScreen(effRole, sBtn.screen))}
            score={roleReadiness ? roleReadiness.score : (projects.length ? avgProof : 0)}
            scoreLabel={roleReadiness ? 'Ready' : 'Proof'}
          />
        </div>
      )}

      {/* 3+4 ── ACTIVE PROJECT (built vs verified) + VERIFICATION ATTENTION */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Active project" action={activeProject ? <button onClick={() => go('projectworkspace')} className="text-xs text-brand hover:underline">Open workspace</button> : null}>
          {activeProject ? (
            <div>
              <p className="text-sm font-semibold text-fg">{activeProject.title}</p>
              {activeProg ? (
                <>
                  <div className="mt-2 flex items-center gap-4 text-[12px] text-fg-secondary">
                    <span><span className="font-semibold text-fg">{activeProg.weightedPercentDone ?? activeProg.percentDone ?? 0}%</span> built</span>
                    <span><span className="font-semibold text-ok">{activeProg.weightedPercentVerified ?? activeProg.percentVerified ?? 0}%</span> verified</span>
                  </div>
                  <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-surface-1">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-aurora-cta" style={{ width: `${activeProg.weightedPercentDone ?? activeProg.percentDone ?? 0}%` }} />
                    <div className="absolute inset-y-0 left-0 rounded-full bg-aurora-mint" style={{ width: `${activeProg.weightedPercentVerified ?? activeProg.percentVerified ?? 0}%` }} />
                  </div>
                  {activeProject.workspacePlan?.nextAction?.title && (
                    <p className="mt-2.5 text-[12px] text-fg-secondary"><span className="font-medium text-fg">Next:</span> {activeProject.workspacePlan.nextAction.title}</p>
                  )}
                </>
              ) : (
                <p className="mt-1.5 text-[12.5px] text-fg-secondary">No guided workspace yet — open it to generate the build plan.</p>
              )}
            </div>
          ) : (
            <EmptyState icon={Rocket} title="No active project" hint="Your readiness gaps are best closed with a matched guided project." action={<Button size="sm" onClick={() => go('projectstudio')}>Start now</Button>} />
          )}
        </SectionCard>

        <SectionCard title="Verification needing attention">
          {verificationActions.length ? (
            <div className="space-y-2">
              {verificationActions.map((a, i) => (
                <button key={i} onClick={() => goCta(a)} className="lift block w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-left">
                  <p className="text-[13px] font-medium text-fg">{a.title}</p>
                  <p className="mt-0.5 text-[11.5px] text-warn">{a.explanation}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-fg-secondary">Nothing waiting on evidence right now. When a verification run needs something from you, it appears here with the exact item to submit.</p>
          )}
        </SectionCard>
      </div>

      {/* 5+6 ── CRITICAL SKILL GAPS + RESUME ACTION */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Critical skill gaps" action={<button onClick={() => go('projectstudio')} className="text-xs text-brand hover:underline">Build evidence</button>}>
          {gapChips.length ? (
            <div className="flex flex-wrap gap-1.5">
              {gapChips.map((sk) => (
                <button key={sk} onClick={() => go('projectstudio')} className="rounded-full border border-subtle bg-surface-1 px-3 py-1 text-[12px] text-fg hover:border-strong">
                  {sk}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-fg-secondary">{roleReadiness ? 'No critical gaps detected for your target role — keep converting built work into verified evidence.' : 'Set a target role in your profile to see role-specific gaps.'}</p>
          )}
          {roleReadiness?.topActions?.[0] && (
            <p className="mt-3 text-[12px] text-fg-secondary">{roleReadiness.topActions[0].why}</p>
          )}
        </SectionCard>

        <SectionCard title="Resume action" action={<button onClick={() => go('resume')} className="text-xs text-brand hover:underline">Open Resume OS</button>}>
          {resumeAction ? (
            <button onClick={() => goCta(resumeAction)} className="lift block w-full rounded-xl border border-subtle bg-surface-1 px-4 py-2.5 text-left hover:border-strong">
              <p className="text-[13px] font-medium text-fg">{resumeAction.title}</p>
              <p className="mt-0.5 text-[11.5px] text-fg-secondary">{resumeAction.explanation}</p>
            </button>
          ) : (
            <p className="text-[12.5px] text-fg-secondary">Analyze your resume to surface evidence-backed improvements — verified skills that are missing from the document appear here automatically.</p>
          )}
        </SectionCard>
      </div>

      {warnings.length > 0 && (
        <div className="mt-4 space-y-2">
          {warnings.slice(0, 2).map(({ p, c }) => (
            <div key={p.id} className="rounded-xl border border-amber-glow/30 bg-amber-glow/10 px-4 py-2.5 text-[13px] text-warn">
              <span className="font-medium text-fg">{p.title}:</span> {c.warning}
            </div>
          ))}
        </div>
      )}

      {/* 7 ── applications / deadlines shortcuts */}
      <div className="mt-4">
        <SectionCard title="Applications & next steps">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {[[KanbanSquare, 'Track applications', 'tracker'], [Briefcase, 'Find matching jobs', 'jobs'], [Rocket, 'Project Studio', 'projectstudio'], [Award, 'Career Profile', 'careerprofile']]
              .filter(([, , id]) => canSeeScreen(effRole, id))
              .map(([Icon, label, id]) => (
              <button key={id} onClick={() => go(id)} className="lift flex items-center gap-3 rounded-xl border border-subtle bg-surface-1 px-4 py-3 text-sm text-fg hover:border-strong">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-50 text-aurora-violet"><Icon size={16} /></span>
                {label}<ArrowRight size={15} className="ml-auto text-fg-muted" />
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* 8 ── XP / badges / missions — deliberately BELOW employability actions */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard i={0} icon={TrendingUp} tone="violet" label="Career XP" value={String(career.total)} hint={career.next ? `${career.toNext} XP to ${career.next}` : 'Max level'} onClick={() => go('careerprofile')} />
        <StatCard i={1} icon={Award} tone="mint" label="Verified badges" value={String(verifiedBadges.length)} onClick={() => go('skillsxp')} />
        <StatCard i={2} icon={Rocket} tone="cyan" label="Published" value={String(published.length)} hint={!published.length ? 'Publish your first project' : undefined} onClick={() => go('sandbox')} />
        <StatCard i={3} icon={Target} tone="amber" label="Avg proof" value={projects.length ? String(avgProof) : '—'} hint={!projects.length ? 'Build a project' : undefined} />
      </div>

      <div className="mt-4">
        <WeeklyMissionPanel go={go} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Top skill XP" action={<button onClick={() => go('skillsxp')} className="text-xs text-brand hover:underline">View all</button>}>
          {skillXP.length ? (
            <div className="space-y-2.5">
              {skillXP.slice(0, 4).map((s) => <XpBar key={s.skillName} skill={s} />)}
              <p className="pt-1 text-[12px] text-fg-secondary">{nextStepFor(skillXP[0])}</p>
            </div>
          ) : (
            <EmptyState icon={TrendingUp} title="No XP yet" hint="XP is earned from real project proof — start a project to begin." action={<Button size="sm" onClick={() => go('projectstudio')}>Start now</Button>} />
          )}
        </SectionCard>

        <SectionCard title="Verified skill badges" action={<button onClick={() => go('careerprofile')} className="text-xs text-brand hover:underline">Career Profile</button>}>
          <VerifiedBadgePanel badges={badges} onOpen={setBadgeOpen} onViewAll={() => go('skillsxp')} limit={16} />
        </SectionCard>
      </div>

      <div className="mt-4">
        <ProfileAdoptionPanel go={go} />
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
                <button key={c.id} onClick={() => go('recruiter')} className="lift flex w-full items-center justify-between rounded-xl border border-subtle bg-surface-1 px-4 py-3 text-left hover:border-strong">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{c.name}</p>
                    <p className="truncate text-xs text-fg-muted">{c.targetRole} · {c.topSkillNames.slice(0, 3).join(', ')}</p>
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
