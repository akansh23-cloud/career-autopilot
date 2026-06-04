import { useEffect, useState } from 'react';
import { Rocket, Github, Globe, Target, Award, Eye, Mail, X } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Modal, EmptyState } from '../components/ui/kit.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { getPublishedProjects } from '../lib/projectStore.js';

function recruiterSummary(p) {
  const top = (p.skillsCovered || []).slice(0, 4).join(', ');
  return `${p.targetRole} candidate with a deployed ${p.type} project demonstrating ${top}. Proof score ${p.proofScore}/100 — includes ${p.githubUrl ? 'public code' : 'code (pending)'}, ${p.liveDemoUrl ? 'a live demo' : 'demo (pending)'} and documentation.`;
}

function ScoreRing({ score }) {
  const tone = score >= 70 ? 'text-aurora-mint' : score >= 40 ? 'text-aurora-cyan' : 'text-amber-glow';
  return (
    <div className="flex flex-col items-center">
      <div className={`grid h-12 w-12 place-items-center rounded-full border-2 ${score >= 70 ? 'border-aurora-mint/50' : score >= 40 ? 'border-aurora-cyan/50' : 'border-amber-glow/40'}`}>
        <span className={`font-display text-base font-bold ${tone}`}>{score}</span>
      </div>
      <span className="mt-1 font-mono text-[8px] uppercase tracking-widest text-slate-500">Proof</span>
    </div>
  );
}

function ProjectModal({ p, open, onClose, userName }) {
  if (!p) return null;
  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" title={p.title}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="violet"><Target size={11} /> {p.targetRole}</Badge>
          <Badge tone="mint"><Award size={11} /> Proof {p.proofScore}/100</Badge>
          <Badge tone="cyan">{p.type}</Badge>
          <Badge>{userName}</Badge>
        </div>
        <p className="text-sm leading-relaxed text-slate-300">{p.useCase}</p>
        <div><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Skills covered</div><div className="flex flex-wrap gap-1.5">{(p.skillsCovered || []).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div></div>
        <div><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Tech stack</div><div className="flex flex-wrap gap-1.5">{(p.techStack || []).map((s, i) => <Badge key={i} tone="violet">{s}</Badge>)}</div></div>
        <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3"><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Recruiter summary</div><p className="text-[13px] text-slate-300">{recruiterSummary(p)}</p></div>
        <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
          {p.githubUrl && <a href={p.githubUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Github size={14} /> Code</Button></a>}
          {p.liveDemoUrl && <a href={p.liveDemoUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Globe size={14} /> Live demo</Button></a>}
          <Button size="sm" variant="soft" onClick={() => alert('Contact candidate — available once the public sandbox is live.')}><Mail size={14} /> Contact candidate</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function Sandbox() {
  const { user } = useAuth();
  const userName = user?.name || user?.displayName || 'You';
  const [list, setList] = useState(getPublishedProjects());
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const sync = () => setList(getPublishedProjects());
    window.addEventListener('career-projects-updated', sync);
    return () => window.removeEventListener('career-projects-updated', sync);
  }, []);

  return (
    <>
      <PageIntro title="Proof-of-Work Sandbox" sub="Your published projects, presented the way a recruiter would see them." />
      <SectionCard title="Published projects" action={<Badge tone="mint">{list.length}</Badge>}>
        {list.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((p) => (
              <div key={p.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/25">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate font-medium text-white">{p.title}</h4>
                    <p className="mt-0.5 truncate text-xs text-slate-400">{userName} · {p.targetRole}</p>
                  </div>
                  <ScoreRing score={p.proofScore} />
                </div>
                <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-slate-400">{p.useCase}</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">{(p.skillsCovered || []).slice(0, 5).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div>
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  <Button size="sm" onClick={() => setOpen(p)}><Eye size={13} /> View project</Button>
                  {p.githubUrl && <a href={p.githubUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Github size={13} /></Button></a>}
                  {p.liveDemoUrl && <a href={p.liveDemoUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Globe size={13} /></Button></a>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Rocket} title="No published projects yet" hint="Build a project in Career Project Studio, save it as a workspace, then click “Publish to Sandbox”." />
        )}
      </SectionCard>
      <ProjectModal p={open} open={!!open} onClose={() => setOpen(null)} userName={userName} />
    </>
  );
}
