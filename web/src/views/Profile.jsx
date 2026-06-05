import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Target, Rocket, Award, Github, Globe, TrendingUp, User } from 'lucide-react';
import { PageIntro, SectionCard, StatCard } from './common.jsx';
import { Badge, Button, EmptyState } from '../components/ui/kit.jsx';
import { ScoreRing, XpBar, BadgePill, BadgeModal, nextStepFor } from '../components/proof/ProofViews.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { getProjects, getPublishedProjects, proofScoreBreakdown } from '../lib/projectStore.js';
import { deriveSkillXP, careerXP, levelFor } from '../lib/xp.js';
import { deriveBadges } from '../lib/badges.js';
import { getAccessForUser } from '../lib/access.js';
import { getProfile, ROLE_LABELS } from '../lib/userProfile.js';
import { PLAN_LABELS_FULL } from '../lib/plan.js';

function placementReadiness(projects, career, badges) {
  if (!projects.length) return 0;
  const avgProof = projects.reduce((s, p) => s + proofScoreBreakdown(p).score, 0) / projects.length;
  const xpPart = Math.min(100, (career.total / 1500) * 100);
  const badgePart = Math.min(100, badges.reduce((s, b) => s + b.confidence, 0) / Math.max(1, badges.length));
  const publishedPart = Math.min(100, getPublishedProjects().length * 25);
  return Math.round(avgProof * 0.4 + xpPart * 0.25 + badgePart * 0.2 + publishedPart * 0.15);
}

export default function Profile({ go }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState(getProjects());
  const [badgeOpen, setBadgeOpen] = useState(null);
  const [, force] = useState(0);

  useEffect(() => {
    const sync = () => { setProjects(getProjects()); force((n) => n + 1); };
    window.addEventListener('career-projects-updated', sync);
    window.addEventListener('career-plan-updated', sync);
    window.addEventListener('career-profile-updated', sync);
    window.addEventListener('career-engagement-updated', sync);
    return () => {
      window.removeEventListener('career-projects-updated', sync);
      window.removeEventListener('career-plan-updated', sync);
      window.removeEventListener('career-profile-updated', sync);
      window.removeEventListener('career-engagement-updated', sync);
    };
  }, []);

  const access = getAccessForUser(user);
  const profile = getProfile();
  const published = useMemo(() => projects.filter((p) => p.published), [projects]);
  const skillXP = useMemo(() => deriveSkillXP(projects), [projects]);
  const badges = useMemo(() => deriveBadges(projects, access), [projects, access]);
  const career = useMemo(() => careerXP(projects), [projects]);
  const avgProof = projects.length ? Math.round(projects.reduce((s, p) => s + proofScoreBreakdown(p).score, 0) / projects.length) : 0;
  const readiness = placementReadiness(projects, career, badges);
  const topSkill = skillXP[0];

  const recruiterSummary = published.length
    ? `${ROLE_LABELS[access.role] || 'Candidate'} targeting ${profile.targetRole || profile.hiringRole || 'their next role'} with ${published.length} published proof-of-work project(s), ${badges.length} verified skill badge(s) and an average proof score of ${avgProof}/100.`
    : 'Publish a project to generate a recruiter-ready summary.';

  return (
    <>
      <PageIntro
        title="Your Profile"
        sub="Your proof-of-work, skills and recruiter-ready summary."
        action={<Button variant="soft" onClick={() => go?.('projectstudio')}><Rocket size={15} /> Build a project</Button>}
      />

      <SectionCard className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-aurora-violet/15 text-aurora-cyan ring-1 ring-white/10"><User size={22} /></span>
            <div>
              <p className="text-lg font-semibold text-white">{user?.name || 'You'}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone="violet">{ROLE_LABELS[access.role] || 'Member'}</Badge>
                {(profile.targetRole || profile.hiringRole) && <Badge tone="cyan"><Target size={11} /> {profile.targetRole || profile.hiringRole}</Badge>}
                {access.isAdmin
                  ? <Badge tone="mint"><ShieldCheck size={11} /> Admin · Full Access</Badge>
                  : <Badge tone={access.effectivePlan === 'premium' ? 'amber' : 'default'}>{PLAN_LABELS_FULL[access.effectivePlan]} plan</Badge>}
                <Badge tone="mint">{career.level} · {career.total} XP</Badge>
              </div>
            </div>
          </div>
          <ScoreRing score={readiness} label="Readiness" size={56} />
        </div>
      </SectionCard>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard i={0} icon={TrendingUp} tone="violet" label="Career XP" value={String(career.total)} hint={career.next ? `${career.toNext} XP to ${career.next}` : 'Max level'} />
        <StatCard i={1} icon={Award} tone="mint" label="Verified badges" value={String(badges.length)} />
        <StatCard i={2} icon={Rocket} tone="cyan" label="Published projects" value={String(published.length)} />
        <StatCard i={3} icon={Target} tone="amber" label="Avg proof score" value={projects.length ? `${avgProof}` : '—'} hint={!projects.length ? 'Build a project' : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Top skill XP" action={topSkill && <Badge tone="violet">{skillXP.length} skills</Badge>}>
          {skillXP.length ? (
            <div className="space-y-2.5">
              {skillXP.slice(0, 6).map((s) => <XpBar key={s.skillName} skill={s} />)}
              {topSkill && <p className="pt-1 text-[12px] text-slate-400">{nextStepFor(topSkill)}</p>}
            </div>
          ) : (
            <EmptyState icon={TrendingUp} title="No XP yet" hint="Complete project tasks, add a GitHub repo and a live demo to earn Skill XP from real proof." />
          )}
        </SectionCard>

        <SectionCard title="Verified skill badges">
          {badges.length ? (
            <div className="flex flex-wrap gap-2">
              {badges.map((b) => <BadgePill key={b.skillName + b.level} badge={b} onClick={setBadgeOpen} />)}
            </div>
          ) : (
            <EmptyState icon={Award} title="No verified badges yet" hint="Badges come from project evidence — add a repo, deploy, README and interview prep to earn them." />
          )}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard title="Recruiter-ready summary">
          <p className="text-sm leading-relaxed text-slate-300">{recruiterSummary}</p>
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard title="Published projects" action={<Badge tone="mint">{published.length}</Badge>}>
          {published.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {published.map((p) => {
                const bd = proofScoreBreakdown(p);
                return (
                  <div key={p.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="truncate font-medium text-white">{p.title}</h4>
                        <p className="mt-0.5 truncate text-xs text-slate-400">{p.targetRole}</p>
                      </div>
                      <ScoreRing score={bd.score} />
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">{(p.skillsCovered || []).slice(0, 4).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div>
                    <div className="mt-auto flex flex-wrap gap-2 pt-3">
                      {p.githubUrl && <a href={p.githubUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Github size={13} /></Button></a>}
                      {p.liveDemoUrl && <a href={p.liveDemoUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Globe size={13} /></Button></a>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={Rocket} title="No published projects yet" hint="Publish a project from the Sandbox to show it here." action={<Button size="sm" onClick={() => go?.('projectstudio')}>Build a project</Button>} />
          )}
        </SectionCard>
      </div>

      <BadgeModal badge={badgeOpen} open={!!badgeOpen} onClose={() => setBadgeOpen(null)} />
    </>
  );
}
