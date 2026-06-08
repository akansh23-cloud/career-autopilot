import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck, Target, Rocket, Award, Github, Globe, TrendingUp, User, Linkedin,
  Link2, Copy, Eye, Check, Flame, Briefcase, MapPin, Lock, Sparkles, Star,
} from 'lucide-react';
import { PageIntro, SectionCard, StatCard } from './common.jsx';
import { Badge, Button, EmptyState, Modal, Input, Field, Spinner } from '../components/ui/kit.jsx';
import { ScoreRing, XpBar, BadgeModal, VerifiedBadgePanel, nextStepFor } from '../components/proof/ProofViews.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { getProjects, proofScoreBreakdown } from '../lib/projectStore.js';
import { deriveSkillXP } from '../lib/xp.js';
import { deriveBadges } from '../lib/badges.js';
import { getAccessForUser } from '../lib/access.js';
import { getProfile, patchProfile, ROLE_LABELS } from '../lib/userProfile.js';
import { PLAN_LABELS_FULL } from '../lib/plan.js';
import {
  assembleMyProfile, getNetworkProfileLocal, saveNetworkProfileLocal, shareLink,
  adoptionSuggestions, fetchPublicProfile, requestCareerProfileEditor,
  consumePendingProfileEditor, PROFILE_EDITOR_EVENT,
} from '../lib/network.js';
import GithubIntegrationPanel from '../components/proof/GithubIntegrationPanel.jsx';

const VISIBILITY_OPTIONS = [
  { id: 'private', label: 'Private', hint: 'Hidden from everyone but you.' },
  { id: 'published_only', label: 'Only published projects visible', hint: 'Others can see your published proof-of-work only.' },
  { id: 'public', label: 'Public profile', hint: 'Discoverable on leaderboards and recruiter search.' },
];
const AVAILABILITY = [
  ['openToInternships', 'Open to internships'],
  ['openToJobs', 'Open to jobs'],
  ['openToReferrals', 'Open to referrals'],
  ['openToCollaboration', 'Open to collaboration'],
  ['openToRecruiters', 'Open to recruiters'],
];

function trustTone(level) {
  return { 'New': 'default', 'Building Trust': 'cyan', 'Trusted': 'violet', 'Highly Trusted': 'mint' }[level] || 'default';
}

/* Recruiter-safe presentation used by the preview modal and the public route. */
function ProofCard({ p, isPrivate }) {
  if (isPrivate) {
    return <EmptyState icon={Lock} title="This profile is private" hint="You can view published projects only when the member makes them visible." />;
  }
  const m = p.metrics || {};
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-white">{p.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {p.targetRole && <Badge tone="cyan"><Target size={11} /> {p.targetRole}</Badge>}
            {p.location && <Badge tone="default"><MapPin size={11} /> {p.location}</Badge>}
            <Badge tone={trustTone(p.trustLevel)}><ShieldCheck size={11} /> {p.trustLevel} · {p.trustScore}</Badge>
          </div>
        </div>
        <ScoreRing score={m.readiness || 0} label="Readiness" size={54} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Badge tone="violet">{m.level || 'Beginner'} · {m.careerXP || 0} XP</Badge>
        <Badge tone="mint"><Award size={11} /> {m.verifiedBadges || 0} verified</Badge>
        <Badge tone="cyan"><Rocket size={11} /> {m.publishedCount || 0} published</Badge>
        <Badge tone="amber"><Target size={11} /> {m.avgProofScore || 0} proof</Badge>
      </div>
      {(m.topSkills || []).length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Top skills</div>
          <div className="flex flex-wrap gap-1.5">{m.topSkills.map((s) => <Badge key={s.name} tone="cyan">{s.name} · {s.xp}xp</Badge>)}</div>
        </div>
      )}
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Recruiter-ready summary</div>
        <p className="text-sm leading-relaxed text-slate-300">{p.recruiterSummary}</p>
      </div>
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Best published projects</div>
        {(m.bestProjects || []).length ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {m.bestProjects.map((b) => (
              <div key={b.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium text-white">{b.title}</p>
                  <Badge tone={b.proofScore >= 70 ? 'mint' : b.proofScore >= 40 ? 'cyan' : 'amber'}>{b.proofScore}</Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">{(b.skills || []).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div>
                <div className="mt-2 flex gap-2">
                  {b.github && <a href={b.github} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Github size={13} /> Code</Button></a>}
                  {b.live && <a href={b.live} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Globe size={13} /> Live</Button></a>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No published projects yet.</p>
        )}
      </div>
      {(p.links?.github || p.links?.linkedin || p.links?.portfolio) && (
        <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
          {p.links.github && <a href={p.links.github} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Github size={14} /> GitHub</Button></a>}
          {p.links.linkedin && <a href={p.links.linkedin} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Linkedin size={14} /> LinkedIn</Button></a>}
          {p.links.portfolio && <a href={p.links.portfolio} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Globe size={14} /> Portfolio</Button></a>}
        </div>
      )}
    </div>
  );
}

/* Public / share-link view (rendered by App for /#/profile/:id). */
export function PublicProfile({ userId, onBack }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    fetchPublicProfile(userId).then((r) => { if (live) setState({ loading: false, ...r }); });
    return () => { live = false; };
  }, [userId]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold text-white">Career Proof Profile</h1>
        {onBack && <Button variant="soft" size="sm" onClick={onBack}>Back to app</Button>}
      </div>
      <SectionCard>
        {state.loading ? (
          <div className="grid place-items-center py-16"><Spinner /></div>
        ) : !state.ok ? (
          <EmptyState icon={Lock} title="Profile not available" hint="This profile is private or could not be found." />
        ) : (
          <ProofCard p={state.profile} isPrivate={!!state.private} />
        )}
      </SectionCard>
    </div>
  );
}

export default function CareerProfile({ go, publicUserId }) {
  if (publicUserId) return <PublicProfile userId={publicUserId} />;

  const { user } = useAuth();
  const [projects, setProjects] = useState(getProjects());
  const [badgeOpen, setBadgeOpen] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, force] = useState(0);
  const githubPanelRef = useRef(null);
  const scrollToGithub = () => githubPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Deep-link from "Add your GitHub" etc.: open the editor focused on links.
  useEffect(() => {
    if (consumePendingProfileEditor()) setEditOpen(true);
    const onReq = () => setEditOpen(true);
    window.addEventListener(PROFILE_EDITOR_EVENT, onReq);
    return () => window.removeEventListener(PROFILE_EDITOR_EVENT, onReq);
  }, []);

  useEffect(() => {
    const sync = () => { setProjects(getProjects()); force((n) => n + 1); };
    ['career-projects-updated', 'career-plan-updated', 'career-profile-updated', 'career-engagement-updated', 'career-network-updated', 'career-missions-updated']
      .forEach((e) => window.addEventListener(e, sync));
    return () => ['career-projects-updated', 'career-plan-updated', 'career-profile-updated', 'career-engagement-updated', 'career-network-updated', 'career-missions-updated']
      .forEach((e) => window.removeEventListener(e, sync));
  }, []);

  const access = getAccessForUser(user);
  const me = useMemo(() => assembleMyProfile(), [projects, user]);
  const skillXP = useMemo(() => deriveSkillXP(projects), [projects]);
  const badges = useMemo(() => deriveBadges(projects, access), [projects, access]);
  const published = projects.filter((p) => p.published);
  const suggestions = useMemo(() => adoptionSuggestions(me), [me]);
  const m = me.metrics;

  const copy = () => {
    const link = shareLink();
    try { navigator.clipboard?.writeText(link); } catch {}
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  return (
    <>
      <PageIntro
        title="Career Proof Profile"
        sub="Your verified proof-of-work, skills, trust and recruiter-ready summary."
        action={<Button onClick={() => setEditOpen(true)}><User size={15} /> Edit profile</Button>}
      />

      <SectionCard className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-aurora-violet/15 text-aurora-cyan ring-1 ring-white/10"><User size={22} /></span>
            <div>
              <p className="text-lg font-semibold text-white">{user?.name || 'You'}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone="violet">{ROLE_LABELS[access.role] || 'Member'}</Badge>
                {me.targetRole && <Badge tone="cyan"><Target size={11} /> {me.targetRole}</Badge>}
                {me.track !== 'General' && <Badge tone="default">{me.track}</Badge>}
                {access.isAdmin
                  ? <Badge tone="mint"><ShieldCheck size={11} /> Admin · Full Access</Badge>
                  : <Badge tone={access.effectivePlan === 'premium' ? 'amber' : 'default'}>{PLAN_LABELS_FULL[access.effectivePlan]} plan</Badge>}
                <Badge tone={trustTone(me.trustLevel)}><ShieldCheck size={11} /> {me.trustLevel} · {me.trustScore}</Badge>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ScoreRing score={me.completeness} label="Complete" size={52} />
            <ScoreRing score={m.readiness} label="Readiness" size={52} />
            <ScoreRing score={m.jobSwitchReadiness} label="Switch" size={52} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
          <Button size="sm" variant="soft" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy public link'}</Button>
          <Button size="sm" variant="soft" onClick={() => setPreviewOpen(true)}><Eye size={14} /> Preview recruiter view</Button>
          <Button size="sm" variant="soft" onClick={() => setEditOpen(true)}><Sparkles size={14} /> Update availability</Button>
          <Button size="sm" variant="soft" onClick={() => setEditOpen(true)}><Linkedin size={14} /> Connect LinkedIn</Button>
          <Button size="sm" variant="soft" onClick={scrollToGithub}><Github size={14} /> Connect GitHub</Button>
        </div>
      </SectionCard>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard i={0} icon={TrendingUp} tone="violet" label="Career XP" value={String(m.careerXP)} hint={`${m.level}`} />
        <StatCard i={1} icon={Award} tone="mint" label="Verified badges" value={String(m.verifiedBadges)} />
        <StatCard i={2} icon={ShieldCheck} tone="cyan" label="Trust score" value={String(me.trustScore)} hint={me.trustLevel} />
        <StatCard i={3} icon={Flame} tone="amber" label="Mission streak" value={`${m.missionStreak}w`} />
      </div>

      <div className="mt-4" ref={githubPanelRef}>
        <GithubIntegrationPanel
          projects={projects}
          onProofChanged={() => { setProjects(getProjects()); force((n) => n + 1); }}
        />
      </div>

      {suggestions.length > 0 && (
        <div className="mt-4">
          <SectionCard title="Boost your profile" action={<Badge tone="violet">{me.completeness}% complete</Badge>}>
            <div className="space-y-2">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => { if (s.editor) setEditOpen(true); else go?.(s.cta); }} className="flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-2.5 text-left text-[13px] text-slate-200 hover:border-white/20">
                  <Sparkles size={15} className="shrink-0 text-aurora-cyan" /> {s.text}
                </button>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Top skill XP" action={skillXP[0] && <Badge tone="violet">{skillXP.length} skills</Badge>}>
          {skillXP.length ? (
            <div className="space-y-2.5">
              {skillXP.slice(0, 6).map((s) => <XpBar key={s.skillName} skill={s} />)}
              <p className="pt-1 text-[12px] text-slate-400">{nextStepFor(skillXP[0])}</p>
            </div>
          ) : (
            <EmptyState icon={TrendingUp} title="No XP yet" hint="Complete project tasks, add a GitHub repo and a live demo to earn Skill XP from real proof." />
          )}
        </SectionCard>

        <SectionCard title="Verified skill badges">
          <VerifiedBadgePanel badges={badges} onOpen={setBadgeOpen} onViewAll={() => go?.('skillsxp')} limit={16} />
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Availability & visibility">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-slate-400">Profile visibility</span><Badge tone={me.visibility === 'public' ? 'mint' : me.visibility === 'published_only' ? 'cyan' : 'default'}>{VISIBILITY_OPTIONS.find((v) => v.id === me.visibility)?.label}</Badge></div>
            {AVAILABILITY.map(([k, label]) => (
              <div key={k} className="flex items-center justify-between"><span className="text-slate-400">{label}</span>{me[k] ? <Badge tone="mint"><Check size={11} /> Yes</Badge> : <Badge tone="default">No</Badge>}</div>
            ))}
            <div className="flex items-center justify-between"><span className="text-slate-400">Show email</span>{me.showEmail ? <Badge tone="amber">Visible</Badge> : <Badge tone="default">Hidden</Badge>}</div>
          </div>
          <Button size="sm" variant="soft" className="mt-3" onClick={() => setEditOpen(true)}>Manage settings</Button>
        </SectionCard>

        <SectionCard title="Recruiter-ready summary">
          <p className="text-sm leading-relaxed text-slate-300">{me.recruiterSummary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {me.links.github && <Badge tone="violet"><Github size={11} /> GitHub linked</Badge>}
            {me.links.linkedin && <Badge tone="cyan"><Linkedin size={11} /> LinkedIn linked</Badge>}
            {me.links.portfolio && <Badge tone="mint"><Globe size={11} /> Portfolio linked</Badge>}
          </div>
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
                      <div className="min-w-0"><h4 className="truncate font-medium text-white">{p.title}</h4><p className="mt-0.5 truncate text-xs text-slate-400">{p.targetRole}</p></div>
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

      <EditProfileModal open={editOpen} onClose={() => setEditOpen(false)} />
      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Recruiter view (preview)" width="max-w-2xl">
        <ProofCard p={me} isPrivate={me.visibility === 'private'} />
        {me.visibility === 'private' && <p className="mt-3 rounded-xl border border-amber-glow/30 bg-amber-glow/10 px-3 py-2 text-xs text-amber-100">Your profile is private — recruiters cannot see it. Set visibility to Public to be discoverable.</p>}
      </Modal>
      <BadgeModal badge={badgeOpen} open={!!badgeOpen} onClose={() => setBadgeOpen(null)} />
    </>
  );
}

function isValidUrl(v) {
  const s = String(v || '').trim();
  if (!s) return true; // empty is allowed (optional field)
  try { const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); return !!u.hostname && u.hostname.includes('.'); } catch { return false; }
}

function EditProfileModal({ open, onClose }) {
  const [np, setNp] = useState(getNetworkProfileLocal());
  const [prof, setProf] = useState(getProfile());
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (open) { setNp(getNetworkProfileLocal()); setProf(getProfile()); setErrors({}); setSaved(false); } }, [open]);

  const setLink = (k, v) => { setNp((s) => ({ ...s, links: { ...s.links, [k]: v } })); setSaved(false); };
  const save = () => {
    const errs = {};
    ['github', 'linkedin', 'portfolio'].forEach((k) => { if (!isValidUrl(np.links?.[k])) errs[k] = 'Enter a valid URL (https://…)'; });
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    saveNetworkProfileLocal({
      visibility: np.visibility, location: np.location, showEmail: !!np.showEmail,
      openToInternships: !!np.openToInternships, openToJobs: !!np.openToJobs,
      openToReferrals: !!np.openToReferrals, openToCollaboration: !!np.openToCollaboration,
      openToRecruiters: !!np.openToRecruiters, links: np.links,
    });
    if (prof.targetRole !== getProfile().targetRole) patchProfile({ targetRole: prof.targetRole });
    setSaved(true);
    setTimeout(() => onClose?.(), 700);
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit Career Proof Profile" width="max-w-xl">
      <div className="space-y-4">
        <Field label="Target role"><Input value={prof.targetRole || ''} onChange={(e) => setProf({ ...prof, targetRole: e.target.value })} placeholder="e.g. Backend Engineer" /></Field>
        <Field label="Location" hint="optional · shown only on public profiles"><Input value={np.location || ''} onChange={(e) => setNp({ ...np, location: e.target.value })} placeholder="Pune, India" /></Field>

        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-slate-300">Profile visibility</span>
          <div className="space-y-2">
            {VISIBILITY_OPTIONS.map((v) => (
              <button key={v.id} onClick={() => setNp({ ...np, visibility: v.id })} className={`flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition ${np.visibility === v.id ? 'border-aurora-violet/50 bg-aurora-violet/[0.08]' : 'border-white/10 bg-white/[0.02] hover:border-white/20'}`}>
                <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border ${np.visibility === v.id ? 'border-aurora-cyan bg-aurora-cyan/40' : 'border-white/30'}`} />
                <span><span className="block text-sm font-medium text-white">{v.label}</span><span className="block text-xs text-slate-400">{v.hint}</span></span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-slate-300">Availability</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {AVAILABILITY.map(([k, label]) => (
              <button key={k} onClick={() => setNp({ ...np, [k]: !np[k] })} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition ${np[k] ? 'border-aurora-mint/40 bg-aurora-mint/10 text-white' : 'border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/20'}`}>
                <span>{label}</span>{np[k] && <Check size={15} className="text-aurora-mint" />}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-1" id="career-profile-links">
          <Field label="GitHub URL" hint={errors.github}><Input value={np.links.github || ''} onChange={(e) => setLink('github', e.target.value)} placeholder="https://github.com/you" className={errors.github ? 'border-rose-400/50' : ''} /></Field>
          <Field label="LinkedIn URL" hint={errors.linkedin}><Input value={np.links.linkedin || ''} onChange={(e) => setLink('linkedin', e.target.value)} placeholder="https://linkedin.com/in/you" className={errors.linkedin ? 'border-rose-400/50' : ''} /></Field>
          <Field label="Portfolio URL" hint={errors.portfolio}><Input value={np.links.portfolio || ''} onChange={(e) => setLink('portfolio', e.target.value)} placeholder="https://yoursite.dev" className={errors.portfolio ? 'border-rose-400/50' : ''} /></Field>
        </div>

        <button onClick={() => setNp({ ...np, showEmail: !np.showEmail })} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition ${np.showEmail ? 'border-amber-glow/40 bg-amber-glow/10 text-white' : 'border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/20'}`}>
          <span>Show my email on public profile <span className="text-xs text-slate-500">(hidden by default)</span></span>{np.showEmail && <Check size={15} className="text-amber-glow" />}
        </button>

        <p className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          XP, badges, proof score, role-fit and trust are computed from your real project evidence and cannot be edited directly. Your profile syncs across devices when a backend database is configured.
        </p>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-4">
          {saved && <span className="mr-auto inline-flex items-center gap-1.5 text-[13px] text-aurora-mint"><Check size={15} /> Saved</span>}
          <Button variant="soft" onClick={onClose}>Cancel</Button>
          <Button onClick={save}><Check size={15} /> Save profile</Button>
        </div>
      </div>
    </Modal>
  );
}
