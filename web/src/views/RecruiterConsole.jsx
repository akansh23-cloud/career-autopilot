import { useEffect, useMemo, useState } from 'react';
import { Search, Filter, Github, Globe, Mail, Target, Award, Eye } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Modal, EmptyState, Input } from '../components/ui/kit.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { getPublishedProjects } from '../lib/projectStore.js';
import { ALL_ROLES } from '../lib/roles.js';

export default function RecruiterConsole() {
  const { user } = useAuth();
  const candidate = user?.name || user?.displayName || 'Candidate';
  const [all, setAll] = useState(getPublishedProjects());
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    const sync = () => setAll(getPublishedProjects());
    window.addEventListener('career-projects-updated', sync);
    return () => window.removeEventListener('career-projects-updated', sync);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((p) => {
      if (role && p.targetRole !== role) return false;
      if ((p.proofScore || 0) < minScore) return false;
      if (!term) return true;
      const hay = [p.title, p.targetRole, (p.skillsCovered || []).join(' '), (p.techStack || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(term);
    });
  }, [all, q, role, minScore]);

  const rolesPresent = Array.from(new Set(all.map((p) => p.targetRole)));

  return (
    <>
      <PageIntro title="Recruiter Talent Console" sub="Search candidate proof-of-work projects by role, skills and proof score." />

      <SectionCard title="Filters" action={<Filter size={16} className="text-aurora-cyan" />}>
        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, skills, stack…" className="pl-9" />
          </div>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-ink-950 px-3 text-sm text-slate-100">
            <option value="">All roles</option>
            {(rolesPresent.length ? rolesPresent : ALL_ROLES).map((r) => <option key={r}>{r}</option>)}
          </select>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3">
            <span className="whitespace-nowrap text-[11px] text-slate-400">Min proof</span>
            <input type="range" min="0" max="100" step="10" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="flex-1 accent-violet-500" />
            <span className="w-8 text-right font-mono text-xs text-slate-300">{minScore}</span>
          </div>
        </div>
      </SectionCard>

      <div className="mt-4">
        <SectionCard title="Candidate projects" action={<Badge tone="mint">{results.length}</Badge>}>
          {all.length === 0 ? (
            <EmptyState icon={Award} title="No published candidate projects yet." hint="Published proof-of-work projects from the Sandbox will appear here for searching and filtering." />
          ) : results.length === 0 ? (
            <EmptyState icon={Search} title="No matches" hint="Try clearing filters or lowering the minimum proof score." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {results.map((p) => (
                <div key={p.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/25">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate font-medium text-white">{candidate}</h4>
                      <p className="truncate text-xs text-slate-400">{p.targetRole}</p>
                    </div>
                    <Badge tone={p.proofScore >= 70 ? 'mint' : p.proofScore >= 40 ? 'cyan' : 'amber'}><Award size={11} /> {p.proofScore}</Badge>
                  </div>
                  <p className="mt-2 line-clamp-1 text-[12px] font-medium text-slate-300">{p.title}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">{(p.skillsCovered || []).slice(0, 5).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div>
                  <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-500">{p.useCase}</p>
                  <div className="mt-auto flex flex-wrap gap-2 pt-3">
                    <Button size="sm" onClick={() => setOpen(p)}><Eye size={13} /> View</Button>
                    {p.githubUrl && <a href={p.githubUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Github size={13} /></Button></a>}
                    {p.liveDemoUrl && <a href={p.liveDemoUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Globe size={13} /></Button></a>}
                    <Button size="sm" variant="soft" onClick={() => alert('Contact candidate — available once the recruiter backend is live.')}><Mail size={13} /> Contact</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title} width="max-w-2xl">
        {open && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{candidate}</Badge><Badge tone="violet"><Target size={11} /> {open.targetRole}</Badge>
              <Badge tone="mint"><Award size={11} /> Proof {open.proofScore}/100</Badge><Badge tone="cyan">{open.type}</Badge>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">{open.useCase}</p>
            <div><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Skills</div><div className="flex flex-wrap gap-1.5">{(open.skillsCovered || []).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div></div>
            <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
              {open.githubUrl && <a href={open.githubUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Github size={14} /> Code</Button></a>}
              {open.liveDemoUrl && <a href={open.liveDemoUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Globe size={14} /> Demo</Button></a>}
              <Button size="sm" onClick={() => alert('Contact candidate — available once the recruiter backend is live.')}><Mail size={14} /> Contact candidate</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
