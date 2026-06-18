import { useEffect, useMemo, useState } from 'react';
import { Search, Filter, Github, Globe, Mail, Target, Award, Eye, Star, TrendingUp, ShieldCheck, BadgeCheck, ExternalLink, LockKeyhole } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Modal, EmptyState, Input } from '../components/ui/kit.jsx';
import { ScoreRing, BadgePill, BadgeModal, StatusBadge } from '../components/proof/ProofViews.jsx';
import { VerificationReport } from '../components/proof/VerificationReport.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { getPublishedProjects, proofScoreBreakdown } from '../lib/projectStore.js';
import { buildCandidates, rankCandidates } from '../lib/roleFit.js';
import { calculateProjectStatus } from '../lib/projectStatus.js';
import { getAccessForUser } from '../lib/access.js';
import { toggleShortlist, markContacted, engagementFor } from '../lib/engagement.js';
import { ALL_ROLES } from '../lib/roles.js';
import { fetchCandidates, roleFitForProfile, toggleShortlistCandidate, isShortlisted, sendReferralRequest } from '../lib/network.js';

function FitBars({ parts }) {
  return (
    <div className="space-y-1">
      {Object.entries(parts).map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-[11px]">
          <span className="w-28 shrink-0 text-slate-400">{k}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-aurora-cta" style={{ width: `${Math.min(100, v * 3)}%` }} /></div>
          <span className="w-6 text-right font-mono text-slate-300">{v}</span>
        </div>
      ))}
    </div>
  );
}

export default function RecruiterConsole() {
  const { user } = useAuth();
  const access = getAccessForUser(user);
  const [published, setPublished] = useState(getPublishedProjects());
  const [netCandidates, setNetCandidates] = useState([]);
  const [candidateError, setCandidateError] = useState(null);
  const [shortlistTick, setShortlistTick] = useState(0);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [skills, setSkills] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [minXP, setMinXP] = useState(0);
  const [reqGithub, setReqGithub] = useState(false);
  const [reqLive, setReqLive] = useState(false);
  const [reqAvail, setReqAvail] = useState(false);
  const [minTrust, setMinTrust] = useState(0);
  const [open, setOpen] = useState(null);
  const [badgeOpen, setBadgeOpen] = useState(null);
  const [verifyTarget, setVerifyTarget] = useState(null);

  useEffect(() => {
    const sync = () => setPublished(getPublishedProjects());
    const loadNet = () => { fetchCandidates().then((list) => { setCandidateError(null); setNetCandidates(Array.isArray(list) ? list : []); }).catch((e) => { setCandidateError(e?.status || 'error'); setNetCandidates([]); }); };
    loadNet();
    window.addEventListener('career-projects-updated', sync);
    window.addEventListener('career-engagement-updated', sync);
    window.addEventListener('career-network-updated', loadNet);
    return () => {
      window.removeEventListener('career-projects-updated', sync);
      window.removeEventListener('career-engagement-updated', sync);
      window.removeEventListener('career-network-updated', loadNet);
    };
  }, []);

  const candidates = useMemo(() => buildCandidates(published, access), [published, access]);
  const ranked = useMemo(() => {
    const query = {
      role,
      skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
      minScore,
    };
    let r = rankCandidates(candidates, query);
    const term = q.trim().toLowerCase();
    if (term) r = r.filter(({ candidate }) => [candidate.name, candidate.targetRole, candidate.topSkillNames.join(' ')].join(' ').toLowerCase().includes(term));
    if (minXP) r = r.filter(({ candidate }) => (candidate.career?.total || 0) >= minXP);
    if (reqGithub) r = r.filter(({ candidate }) => candidate.hasGithub);
    if (reqLive) r = r.filter(({ candidate }) => candidate.hasDemo);
    return r;
  }, [candidates, q, role, skills, minScore, minXP, reqGithub, reqLive]);

  // Career Proof Profiles (network layer) — opted-in, privacy-respecting, backend-or-self.
  const rankedProfiles = useMemo(() => {
    const wantSkills = skills.split(',').map((s) => s.trim()).filter(Boolean);
    const term = q.trim().toLowerCase();
    let list = (netCandidates || []).map((p) => ({ p, fit: roleFitForProfile(p, { role, skills: wantSkills }) }));
    list = list.filter(({ p, fit }) => {
      const m = p.metrics || {};
      if (fit < minScore) return false;
      if (minXP && (m.careerXP || 0) < minXP) return false;
      if (reqGithub && !m.hasGithub) return false;
      if (reqLive && !m.hasLive) return false;
      if (reqAvail && !(p.openToRecruiters || p.visibility === 'public')) return false;
      if (minTrust && (p.trustScore || 0) < minTrust) return false;
      if (role && p.targetRole && !(`${p.targetRole}`.toLowerCase().includes(role.toLowerCase()) || role.toLowerCase().includes(`${p.targetRole}`.toLowerCase()))) return false;
      if (term && ![p.name, p.targetRole, (m.skillNames || []).join(' ')].join(' ').toLowerCase().includes(term)) return false;
      return true;
    });
    return list.sort((a, b) => b.fit - a.fit || (b.p.trustScore || 0) - (a.p.trustScore || 0));
  }, [netCandidates, q, role, skills, minScore, minXP, reqGithub, reqLive, reqAvail, minTrust, shortlistTick]);

  const viewProfile = (userId) => { if (userId) window.location.hash = `#/profile/${encodeURIComponent(userId)}`; };
  const onShortlistProfile = async (userId) => { await toggleShortlistCandidate(userId); setShortlistTick((t) => t + 1); };
  // Consent rule: a direct "Contact candidate" is only offered when the
  // candidate has opted in (openToRecruiters). Everyone else can only be sent a
  // softer "Request introduction" — never a direct contact. The backend applies
  // the same opt-in/visibility filtering, so this keeps the UI honest.
  const [reqState, setReqState] = useState({});
  const onContactOrIntro = async (p) => {
    const kind = p.openToRecruiters ? 'contact' : 'intro';
    setReqState((s) => ({ ...s, [p.userId]: 'sending' }));
    const res = await sendReferralRequest({
      toUserId: p.userId, kind,
      message: '', effectivePlan: access.effectivePlan, isAdmin: access.isAdmin,
    });
    setReqState((s) => ({ ...s, [p.userId]: res?.ok ? 'sent' : (res?.error || 'error') }));
  };

  const rolesPresent = Array.from(new Set([...candidates.map((c) => c.targetRole), ...netCandidates.map((c) => c.targetRole)].filter(Boolean)));

  // Saved searches (simple, per-browser). Lets a recruiter store a filter set
  // and re-apply it later. Client-side only — no private data leaves the device.
  const SS_KEY = 'ca_recruiter_saved_searches';
  const [savedSearches, setSavedSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SS_KEY) || '[]'); } catch { return []; }
  });
  const persistSaved = (list) => { setSavedSearches(list); try { localStorage.setItem(SS_KEY, JSON.stringify(list)); } catch { /* ignore */ } };
  const saveCurrentSearch = () => {
    const name = String(q || role || skills || 'Search').slice(0, 40);
    const entry = { id: 'ss_' + Date.now(), name, query: { q, role, skills, minScore, minXP, minTrust, reqGithub, reqLive, reqAvail } };
    persistSaved([entry, ...savedSearches].slice(0, 12));
  };
  const applySaved = (s) => {
    const x = s.query || {};
    setQ(x.q || ''); setRole(x.role || ''); setSkills(x.skills || '');
    setMinScore(x.minScore || 0); setMinXP(x.minXP || 0); setMinTrust(x.minTrust || 0);
    setReqGithub(!!x.reqGithub); setReqLive(!!x.reqLive); setReqAvail(!!x.reqAvail);
  };
  const removeSaved = (id) => persistSaved(savedSearches.filter((s) => s.id !== id));

  if (candidateError === 401 || candidateError === 403) {
    return (
      <>
        <PageIntro title="Recruiter verification required" sub="Candidate discovery unlocks only after admin-approved recruiter verification." />
        <SectionCard title="Access locked">
          <EmptyState
            icon={LockKeyhole}
            title="Recruiter access is not verified"
            hint="Your onboarding role is treated as intent only. Request verification before opening candidate search, shortlists, or contact actions."
          />
        </SectionCard>
      </>
    );
  }

  return (
    <>
      <PageIntro title="Recruiter Talent Console" sub="Search proven candidates ranked by Role Fit Score — built from real proof-of-work, not self-reported skills." />

      <SectionCard title="Search candidates" action={<Filter size={16} className="text-aurora-cyan" />}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, role, skills…" className="pl-9" />
          </div>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-ink-950 px-3 text-sm text-slate-100">
            <option value="">Any role</option>
            {(rolesPresent.length ? rolesPresent : ALL_ROLES).map((r) => <option key={r}>{r}</option>)}
          </select>
          <Input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Required skills (comma separated)" />
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3">
            <span className="whitespace-nowrap text-[11px] text-slate-400">Min fit</span>
            <input type="range" min="0" max="100" step="10" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="flex-1 accent-violet-500" />
            <span className="w-8 text-right font-mono text-xs text-slate-300">{minScore}</span>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3">
            <span className="whitespace-nowrap text-[11px] text-slate-400">Min Skill XP</span>
            <input type="range" min="0" max="3000" step="100" value={minXP} onChange={(e) => setMinXP(Number(e.target.value))} className="flex-1 accent-cyan-500" />
            <span className="w-10 text-right font-mono text-xs text-slate-300">{minXP}</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3">
            <span className="whitespace-nowrap text-[11px] text-slate-400">Min trust</span>
            <input type="range" min="0" max="100" step="5" value={minTrust} onChange={(e) => setMinTrust(Number(e.target.value))} className="flex-1 accent-emerald-500" />
            <span className="w-8 text-right font-mono text-xs text-slate-300">{minTrust}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ['GitHub verified', reqGithub, () => setReqGithub((v) => !v)],
            ['Live demo verified', reqLive, () => setReqLive((v) => !v)],
            ['Open to recruiters', reqAvail, () => setReqAvail((v) => !v)],
          ].map(([label, on, toggle]) => (
            <button key={label} onClick={toggle} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${on ? 'border-aurora-cyan/50 bg-aurora-cyan/15 text-[#A7ECF8]' : 'border-white/12 bg-white/[0.03] text-slate-300 hover:bg-white/8'}`}>{label}</button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/8 pt-3">
          <Button size="sm" variant="soft" onClick={saveCurrentSearch}>Save search</Button>
          {savedSearches.length === 0
            ? <span className="text-xs text-slate-500">No saved searches yet</span>
            : savedSearches.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.03] px-2.5 py-1 text-xs text-slate-300">
                <button onClick={() => applySaved(s)} className="hover:text-white">{s.name}</button>
                <button onClick={() => removeSaved(s.id)} className="text-slate-500 hover:text-rose-300" aria-label="Remove saved search">×</button>
              </span>
            ))}
        </div>
      </SectionCard>

      <div className="mt-4">
        <SectionCard title="Career Proof Profiles" action={<Badge tone="cyan">{rankedProfiles.length}</Badge>}>
          <p className="mb-3 text-xs text-slate-400">Opted-in candidates with verified proof-of-work. Private profiles and hidden contact details are never shown.</p>
          {netCandidates.length === 0 ? (
            <EmptyState icon={BadgeCheck} title="No proof profiles yet" hint="Candidates appear here once they make their Career Proof Profile visible to recruiters and publish verified projects. No placeholder profiles are shown." />
          ) : rankedProfiles.length === 0 ? (
            <EmptyState icon={Search} title="No matches" hint="Try clearing filters or lowering the minimum fit / trust." />
          ) : (
            <div className="space-y-3">
              {rankedProfiles.map(({ p, fit }, idx) => {
                const m = p.metrics || {};
                const sl = isShortlisted(p.userId);
                return (
                  <div key={p.userId} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/25">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-aurora-cyan/15 font-display text-sm font-bold text-aurora-cyan">#{idx + 1}</span>
                        <div>
                          <p className="font-medium text-white">{p.name}</p>
                          <p className="text-xs text-slate-400">{p.targetRole || 'Open role'} · {m.level || 'Builder'} · {m.careerXP || 0} XP</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone="mint"><ShieldCheck size={11} /> {p.trustScore || 0} · {p.trustLevel || 'New'}</Badge>
                        <ScoreRing score={fit} label="Role fit" />
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Top skills</div>
                        <div className="flex flex-wrap gap-1.5">{(m.topSkills || []).slice(0, 5).map((s) => <Badge key={s.skillName} tone="cyan">{s.skillName} · {s.xp}xp</Badge>)}</div>
                        {!(m.topSkills || []).length && <p className="text-xs text-slate-500">No skill XP yet.</p>}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2"><p className="font-display text-lg font-semibold text-white">{m.avgProofScore || 0}</p><p className="text-[10px] text-slate-500">Proof</p></div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2"><p className="font-display text-lg font-semibold text-white">{m.verifiedBadges || 0}</p><p className="text-[10px] text-slate-500">Badges</p></div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2"><p className="font-display text-lg font-semibold text-white">{m.publishedCount || 0}</p><p className="text-[10px] text-slate-500">Projects</p></div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                      {m.hasGithub && <Badge tone="violet"><Github size={11} /> Code</Badge>}
                      {m.hasLive && <Badge tone="mint"><Globe size={11} /> Live</Badge>}
                      {p.openToRecruiters && <Badge tone="cyan">Open to recruiters</Badge>}
                      <div className="ml-auto flex gap-2">
                        <Button size="sm" variant="soft" onClick={() => setVerifyTarget(p)}><ShieldCheck size={13} /> Verification report</Button>
                        <Button size="sm" variant="soft" onClick={() => viewProfile(p.userId)}><ExternalLink size={13} /> View profile</Button>
                        <Button size="sm" variant="soft" onClick={() => onContactOrIntro(p)} disabled={reqState[p.userId] === 'sending' || reqState[p.userId] === 'sent'}>
                          <Mail size={13} /> {reqState[p.userId] === 'sent' ? (p.openToRecruiters ? 'Contact sent' : 'Intro requested') : (p.openToRecruiters ? 'Contact candidate' : 'Request intro')}
                        </Button>
                        <Button size="sm" onClick={() => onShortlistProfile(p.userId)}><Star size={13} /> {sl ? 'Shortlisted' : 'Shortlist'}</Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard title="Ranked candidates" action={<Badge tone="mint">{ranked.length}</Badge>}>
          {candidates.length === 0 ? (
            <EmptyState icon={Award} title="No published candidates yet" hint="When candidates publish proof-of-work projects to the Sandbox, they appear here ranked by Role Fit Score. No placeholder candidates are shown." />
          ) : ranked.length === 0 ? (
            <EmptyState icon={Search} title="No matches" hint="Try clearing filters or lowering the minimum fit score." />
          ) : (
            <div className="space-y-3">
              {ranked.map(({ candidate, fit }, idx) => (
                <div key={candidate.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/25">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-aurora-violet/15 font-display text-sm font-bold text-aurora-cyan">#{idx + 1}</span>
                      <div>
                        <p className="font-medium text-white">{candidate.name}</p>
                        <p className="text-xs text-slate-400">{candidate.targetRole} · {candidate.career.level} · {candidate.career.total} XP</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2"><StatusBadge status={candidate.bestStatus} /><ScoreRing score={fit.score} label="Role fit" /></div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Top skills</div>
                      <div className="flex flex-wrap gap-1.5">{candidate.skillXP.slice(0, 5).map((s) => <Badge key={s.skillName} tone="cyan">{s.skillName} · {s.xp}xp</Badge>)}</div>
                      {candidate.badges.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{candidate.badges.slice(0, 4).map((b) => <BadgePill key={b.skillName + b.level} badge={b} onClick={setBadgeOpen} />)}</div>}
                    </div>
                    <div><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Fit breakdown</div><FitBars parts={fit.parts} /></div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                    <Button size="sm" variant="soft" onClick={() => setOpen(candidate)}><Eye size={13} /> Best projects</Button>
                    {candidate.hasGithub && <Badge tone="violet"><Github size={11} /> Code</Badge>}
                    {candidate.hasDemo && <Badge tone="mint"><Globe size={11} /> Live</Badge>}
                    <div className="ml-auto flex gap-2">
                      <Button size="sm" variant="soft" onClick={() => { candidate.projects.forEach((p) => toggleShortlist(p.id)); setPublished(getPublishedProjects()); }}><Star size={13} /> Shortlist</Button>
                      <Button size="sm" onClick={() => { candidate.projects.forEach((p) => markContacted(p.id)); setPublished(getPublishedProjects()); }}><Mail size={13} /> Contact</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.name} — best projects` : ''} width="max-w-2xl">
        {open && (
          <div className="space-y-3">
            {open.projects.slice(0, 5).map((p) => {
              const score = proofScoreBreakdown(p).score;
              const eng = engagementFor(p.id);
              return (
                <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{p.title}</p>
                      <p className="truncate text-xs text-slate-400">{p.targetRole} · {p.type}</p>
                    </div>
                    <Badge tone={score >= 70 ? 'mint' : score >= 40 ? 'cyan' : 'amber'}><Award size={11} /> {score}</Badge>
                  </div>
                  <div className="mt-1.5"><StatusBadge status={calculateProjectStatus(p).status} /></div>
                  <div className="mt-2 flex flex-wrap gap-1.5">{(p.skillsCovered || []).slice(0, 5).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {p.githubUrl && <a href={p.githubUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Github size={13} /> Code</Button></a>}
                    {p.liveDemoUrl && <a href={p.liveDemoUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Globe size={13} /> Demo</Button></a>}
                    {eng.shortlisted && <Badge tone="amber"><Star size={11} /> Shortlisted</Badge>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
      <BadgeModal badge={badgeOpen} open={!!badgeOpen} onClose={() => setBadgeOpen(null)} />
      <VerificationReport
        open={!!verifyTarget}
        onClose={() => setVerifyTarget(null)}
        subjectName={verifyTarget?.name || 'Candidate'}
        credentials={verifyTarget?.metrics?.credentials || verifyTarget?.credentials || []}
      />
    </>
  );
}
