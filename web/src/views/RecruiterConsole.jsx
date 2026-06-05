import { useEffect, useMemo, useState } from 'react';
import { Search, Filter, Github, Globe, Mail, Target, Award, Eye, Star, TrendingUp } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Modal, EmptyState, Input } from '../components/ui/kit.jsx';
import { ScoreRing, BadgePill, BadgeModal, StatusBadge } from '../components/proof/ProofViews.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { getPublishedProjects, proofScoreBreakdown } from '../lib/projectStore.js';
import { buildCandidates, rankCandidates } from '../lib/roleFit.js';
import { calculateProjectStatus } from '../lib/projectStatus.js';
import { getAccessForUser } from '../lib/access.js';
import { toggleShortlist, markContacted, engagementFor } from '../lib/engagement.js';
import { ALL_ROLES } from '../lib/roles.js';

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
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [skills, setSkills] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [open, setOpen] = useState(null);
  const [badgeOpen, setBadgeOpen] = useState(null);

  useEffect(() => {
    const sync = () => setPublished(getPublishedProjects());
    window.addEventListener('career-projects-updated', sync);
    window.addEventListener('career-engagement-updated', sync);
    return () => {
      window.removeEventListener('career-projects-updated', sync);
      window.removeEventListener('career-engagement-updated', sync);
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
    return r;
  }, [candidates, q, role, skills, minScore]);

  const rolesPresent = Array.from(new Set(candidates.map((c) => c.targetRole).filter(Boolean)));

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
      </SectionCard>

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
    </>
  );
}
