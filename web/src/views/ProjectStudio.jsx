import { useEffect, useMemo, useState } from 'react';
import {
  Rocket, Wand2, Sparkles, FileText, PenLine, UploadCloud, Github, Globe,
  CheckCircle2, Circle, Plus, Trash2, Copy, Check, ListChecks, Layers,
  Target, Gauge, Clock, Boxes, AlertTriangle, X, Image as ImageIcon, BookOpen,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Modal, EmptyState, Input, Field, Spinner } from '../components/ui/kit.jsx';
import { ROLE_GROUPS, ALL_ROLES } from '../lib/roles.js';
import { getStoredResume, saveStoredResume, getResumeSearchRole } from '../lib/resumeStore.js';
import {
  getProjects, saveProject, deleteProject, consumeStudioSeed, peekStudioSeed,
  computeProofScore, taskProgress, proofScoreBreakdown, getPublishedProjects,
} from '../lib/projectStore.js';
import {
  LEVELS, DURATIONS, TYPES, generateRoadmap, generateResumeBullets,
  generateLinkedinPost, generateInterviewPrep, generateReadme,
} from '../lib/projectGen.js';
import { projectXP } from '../lib/xp.js';
import { deriveBadges } from '../lib/badges.js';
import { roleConsistency } from '../lib/roleFit.js';
import { getAccessForUser } from '../lib/access.js';
import { isUnlimited, promptUpgrade } from '../lib/plan.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { BadgePill } from '../components/proof/ProofViews.jsx';

/* publish-readiness gate (Part 6) */
function publishReadiness(p) {
  const missing = [];
  if (!p.title) missing.push('a title');
  if (!(p.useCase || p.problemStatement)) missing.push('a description');
  if (!(p.techStack || []).length) missing.push('a tech stack');
  if (!(p.githubUrl && p.githubUrl.trim()) && !(p.screenshots || []).length) missing.push('a GitHub link or uploaded proof');
  if (taskProgress(p) < 60) missing.push('roadmap progress above 60%');
  if (!(p.readme && p.readme.trim().length > 40)) missing.push('a generated README');
  return { ready: missing.length === 0, missing };
}

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="soft" onClick={() => { navigator.clipboard?.writeText(text || ''); setDone(true); setTimeout(() => setDone(false), 1400); }}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copied' : label}
    </Button>
  );
}

function Chips({ items, tone = 'cyan' }) {
  if (!items?.length) return <span className="text-xs text-slate-500">—</span>;
  return <div className="flex flex-wrap gap-1.5">{items.map((s, i) => <Badge key={i} tone={tone}>{s}</Badge>)}</div>;
}

/* ---------------- Generated project result ---------------- */
function ProjectResult({ project, seed, onSave, onAddBullets, onOpenEditor }) {
  const p = project;
  return (
    <SectionCard
      title="Generated project"
      action={<div className="flex items-center gap-2"><Badge tone={p.generatedBy === 'ai' ? 'violet' : 'cyan'}>{p.generatedBy === 'ai' ? 'AI-tailored' : 'Template'}</Badge><Badge tone="mint">{p.type}</Badge></div>}
    >
      <div className="space-y-4">
        <div>
          <h3 className="font-display text-xl font-semibold text-white">{p.title}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="violet"><Target size={11} /> {p.targetRole}</Badge>
            <Badge tone="amber"><Gauge size={11} /> {p.difficulty}</Badge>
            <Badge tone="cyan"><Clock size={11} /> {p.duration}</Badge>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Problem</div>
            <p className="text-[13px] leading-relaxed text-slate-300">{p.problemStatement}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Real-world use case</div>
            <p className="text-[13px] leading-relaxed text-slate-300">{p.useCase}</p>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Skills covered</div>
          <Chips items={p.skillsCovered} />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Recommended tech stack</div>
            <Chips items={p.techStack} tone="violet" />
          </div>
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Architecture</div>
            <p className="text-[13px] leading-relaxed text-slate-300">{p.architecture}</p>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Step-by-step roadmap</div>
          <ol className="space-y-2">
            {p.steps.map((ph, i) => (
              <li key={i} className="text-[13px] text-slate-300">
                <span className="font-medium text-white">{i + 1}. {ph.phase}</span>
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-slate-400 marker:text-aurora-cyan">
                  {ph.tasks.map((t, j) => <li key={j}>{t}</li>)}
                </ul>
              </li>
            ))}
          </ol>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Repo structure</div>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-slate-400">{p.repoStructure}</pre>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Deployment plan</div>
              <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-slate-400 marker:text-aurora-mint">{p.deploymentPlan.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
            <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Testing plan</div>
              <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-slate-400 marker:text-amber-glow">{p.testingPlan.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          </div>
        </div>

        {p.databaseSchema && (
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Database schema</div>
            <ul className="list-disc space-y-0.5 pl-4 font-mono text-[11px] text-slate-400">{p.databaseSchema.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
          <div className="mb-2 flex items-center justify-between"><div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Resume bullet points</div><CopyBtn text={p.resumeBullets.map((b) => '• ' + b).join('\n')} /></div>
          <ul className="list-disc space-y-1 pl-4 text-[13px] text-slate-300 marker:text-aurora-violet">{p.resumeBullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-2 flex items-center justify-between"><div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">LinkedIn post</div><CopyBtn text={p.linkedinPost} /></div>
            <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-300">{p.linkedinPost}</pre>
          </div>
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Interview Q&A</div>
            <div className="space-y-2">
              {p.interviewQuestions.slice(0, 5).map((qa, i) => (
                <details key={i} className="rounded-lg bg-white/[0.03] p-2 text-[12px]">
                  <summary className="cursor-pointer font-medium text-slate-200">{qa.q}</summary>
                  <p className="mt-1 text-slate-400">{qa.a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
          <div className="mb-2 flex items-center justify-between"><div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">GitHub README</div><CopyBtn text={p.readme} label="Copy README" /></div>
          <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-slate-400">{p.readme}</pre>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
          <Button onClick={onSave}><UploadCloud size={15} /> Save as workspace</Button>
          <Button variant="soft" onClick={onAddBullets}><FileText size={15} /> Add bullets to resume</Button>
          <Button variant="soft" onClick={onOpenEditor}><PenLine size={15} /> Open Resume Editor</Button>
        </div>
      </div>
    </SectionCard>
  );
}

/* ---------------- Workspace card + modal ---------------- */
function WorkspaceModal({ project, open, onClose, onChange, onPublish, onOpenEditor }) {
  const [p, setP] = useState(project);
  const [busy, setBusy] = useState('');
  const [res, setRes] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { setP(project); }, [project]);
  if (!p) return null;

  const patch = (changes) => { const next = { ...p, ...changes }; next.proofScore = computeProofScore(next); setP(next); onChange(next); };
  const toggleCheck = (i) => { const checklist = p.checklist.map((c, idx) => idx === i ? { ...c, done: !c.done } : c); patch({ checklist }); };
  const moveTask = (id, status) => patch({ tasks: p.tasks.map((t) => t.id === id ? { ...t, status } : t) });
  const addResource = () => { if (!res.trim()) return; patch({ resources: [...(p.resources || []), res.trim()] }); setRes(''); };
  const addScreenshot = () => patch({ screenshots: [...(p.screenshots || []), { label: `Screenshot ${(p.screenshots || []).length + 1}`, addedAt: Date.now() }] });

  const regen = async (kind) => {
    setBusy(kind);
    try {
      if (kind === 'bullets') patch({ resumeBullets: await generateResumeBullets(p) });
      if (kind === 'linkedin') patch({ linkedinPost: await generateLinkedinPost(p) });
      if (kind === 'interview') patch({ interviewQuestions: await generateInterviewPrep(p) });
    } finally { setBusy(''); }
  };

  const cols = [['todo', 'To Do', Circle], ['inprogress', 'In Progress', Clock], ['done', 'Done', CheckCircle2]];
  const progress = taskProgress(p);

  return (
    <Modal open={open} onClose={onClose} width="max-w-4xl" title={p.title}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="violet"><Target size={11} /> {p.targetRole}</Badge>
          <Badge tone="amber">{p.difficulty}</Badge>
          <Badge tone="cyan">{p.duration}</Badge>
          <Badge tone="mint">Proof {p.proofScore}/100</Badge>
          {p.published && <Badge tone="mint">Published</Badge>}
        </div>

        {/* progress */}
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-slate-400"><span>Task completion</span><span>{progress}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-aurora-cta transition-all" style={{ width: `${progress}%` }} /></div>
        </div>

        {/* proof score breakdown + XP + badge eligibility + consistency (Parts 3,4,5,8) */}
        {(() => {
          const bd = proofScoreBreakdown(p);
          const xp = projectXP(p);
          const badges = deriveBadges([p]);
          const cons = roleConsistency(p);
          return (
            <div className="space-y-3">
              {!cons.ok && (
                <div className="rounded-xl border border-amber-glow/30 bg-amber-glow/10 px-3 py-2 text-[12px] text-amber-100">
                  <AlertTriangle size={13} className="mr-1.5 inline" /> {cons.warning}
                </div>
              )}
              <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Proof score breakdown</div>
                  <Badge tone={bd.score >= 70 ? 'mint' : bd.score >= 40 ? 'cyan' : 'amber'}>{bd.score}/100 · +{xp.xp} XP</Badge>
                </div>
                <div className="space-y-1">
                  {bd.rows.map((r) => (
                    <div key={r.key} className="flex items-center gap-2 text-[11px]">
                      <span className="w-36 shrink-0 text-slate-400">{r.label}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-aurora-cta" style={{ width: `${(r.score / r.max) * 100}%` }} /></div>
                      <span className="w-10 text-right font-mono text-slate-300">{r.score}/{r.max}</span>
                    </div>
                  ))}
                </div>
                {bd.recommendation && <p className="mt-2 text-[12px] text-aurora-cyan">{bd.recommendation}</p>}
              </div>
              {badges.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Verified skill badges earned</div>
                  <div className="flex flex-wrap gap-1.5">{badges.map((b) => <BadgePill key={b.skillName + b.level} badge={b} />)}</div>
                </div>
              )}
            </div>
          );
        })()}

        {/* links */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="GitHub repo URL"><Input value={p.githubUrl || ''} onChange={(e) => patch({ githubUrl: e.target.value })} placeholder="https://github.com/you/project" /></Field>
          <Field label="Live demo URL"><Input value={p.liveDemoUrl || ''} onChange={(e) => patch({ liveDemoUrl: e.target.value })} placeholder="https://your-demo.app" /></Field>
        </div>

        {/* roadmap checklist */}
        <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Roadmap checklist</div>
          <div className="space-y-1.5">
            {p.checklist.map((c, i) => (
              <button key={i} onClick={() => toggleCheck(i)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-slate-300 hover:bg-white/5">
                {c.done ? <CheckCircle2 size={15} className="text-aurora-mint" /> : <Circle size={15} className="text-slate-600" />}
                <span className={c.done ? 'text-slate-500 line-through' : ''}>{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* task board */}
        <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Task board</div>
          <div className="grid gap-3 md:grid-cols-3">
            {cols.map(([key, label, Icon]) => (
              <div key={key} className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-300"><Icon size={12} /> {label} <span className="text-slate-600">({p.tasks.filter((t) => t.status === key).length})</span></div>
                <div className="space-y-1.5">
                  {p.tasks.filter((t) => t.status === key).map((t) => (
                    <div key={t.id} className="rounded-md bg-ink-950/70 p-2 text-[11px] text-slate-300">
                      <p className="leading-snug">{t.title}</p>
                      <div className="mt-1.5 flex gap-1">
                        {key !== 'todo' && <button onClick={() => moveTask(t.id, key === 'done' ? 'inprogress' : 'todo')} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10">←</button>}
                        {key !== 'done' && <button onClick={() => moveTask(t.id, key === 'todo' ? 'inprogress' : 'done')} className="rounded bg-aurora-violet/20 px-1.5 py-0.5 text-[10px] text-white hover:bg-aurora-violet/30">→</button>}
                      </div>
                    </div>
                  ))}
                  {!p.tasks.filter((t) => t.status === key).length && <p className="px-1 py-2 text-[11px] text-slate-600">Empty</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* resources + screenshots */}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Resources</div>
            <div className="mb-2 flex gap-2">
              <Input value={res} onChange={(e) => setRes(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addResource()} placeholder="Add a link or note…" className="h-9" />
              <Button size="sm" variant="soft" onClick={addResource}><Plus size={14} /></Button>
            </div>
            <ul className="space-y-1">
              {(p.resources || []).map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1 text-[12px] text-slate-300">
                  <span className="truncate">{r}</span>
                  <button onClick={() => patch({ resources: p.resources.filter((_, idx) => idx !== i) })} className="text-slate-500 hover:text-rose-400"><Trash2 size={12} /></button>
                </li>
              ))}
              {!(p.resources || []).length && <li className="text-[11px] text-slate-600">No resources yet.</li>}
            </ul>
          </div>
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-2 flex items-center justify-between"><div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Screenshots</div><Button size="sm" variant="soft" onClick={addScreenshot}><ImageIcon size={13} /> Add</Button></div>
            <div className="flex flex-wrap gap-2">
              {(p.screenshots || []).map((s, i) => (
                <div key={i} className="relative grid h-16 w-20 place-items-center rounded-lg border border-dashed border-white/15 bg-white/[0.02] text-[9px] text-slate-500">
                  {s.label}
                  <button onClick={() => patch({ screenshots: p.screenshots.filter((_, idx) => idx !== i) })} className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-ink-900 text-slate-400 ring-1 ring-white/15 hover:text-rose-400"><X size={10} /></button>
                </div>
              ))}
              {!(p.screenshots || []).length && <p className="text-[11px] text-slate-600">Upload placeholder — add slots to boost proof score.</p>}
            </div>
          </div>
        </div>

        {/* notes */}
        <Field label="Notes">
          <textarea value={p.notes || ''} onChange={(e) => patch({ notes: e.target.value })} placeholder="Working notes, decisions, blockers…" className="h-24 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50" />
        </Field>

        {/* generators */}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="soft" onClick={() => regen('bullets')} disabled={busy === 'bullets'}><FileText size={14} /> {busy === 'bullets' ? 'Generating…' : 'Resume bullets'}</Button>
          <Button size="sm" variant="soft" onClick={() => regen('linkedin')} disabled={busy === 'linkedin'}><Sparkles size={14} /> {busy === 'linkedin' ? 'Generating…' : 'LinkedIn post'}</Button>
          <Button size="sm" variant="soft" onClick={() => regen('interview')} disabled={busy === 'interview'}><BookOpen size={14} /> {busy === 'interview' ? 'Generating…' : 'Interview prep'}</Button>
          <Button size="sm" variant="soft" onClick={onOpenEditor}><PenLine size={14} /> Resume Editor</Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
          <Button onClick={() => onPublish(p)} variant={p.published ? 'soft' : 'primary'}>
            <Rocket size={15} /> {p.published ? 'Published — update sandbox' : 'Publish to Sandbox'}
          </Button>
          <CopyBtn text={p.resumeBullets.map((b) => '• ' + b).join('\n')} label="Copy bullets" />
          {(() => {
            const { ready, missing } = publishReadiness(p);
            if (ready || p.published) return null;
            return <span className="text-[11px] text-amber-100/80"><AlertTriangle size={12} className="mr-1 inline" />To publish, add {missing.join(', ')}.</span>;
          })()}
        </div>
      </div>
    </Modal>
  );
}

function WorkspaceCard({ p, onOpen, onDelete }) {
  const progress = taskProgress(p);
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/25">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-medium leading-tight text-white">{p.title}</h4>
        <button onClick={() => onDelete(p.id)} className="text-slate-600 hover:text-rose-400"><Trash2 size={14} /></button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="violet">{p.targetRole}</Badge>
        <Badge tone="mint">Proof {p.proofScore}/100</Badge>
        {p.published && <Badge tone="cyan">Published</Badge>}
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[10px] text-slate-500"><span>Progress</span><span>{progress}%</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-aurora-cta" style={{ width: `${progress}%` }} /></div>
      </div>
      <Button size="sm" className="mt-3" onClick={() => onOpen(p)}><Layers size={14} /> Open workspace</Button>
    </div>
  );
}

/* ---------------- Main view ---------------- */
export default function ProjectStudio({ go }) {
  const { user } = useAuth();
  const access = useMemo(() => getAccessForUser(user), [user]);
  const resume = getStoredResume();
  const seed = useMemo(() => consumeStudioSeed(), []);
  const [role, setRole] = useState(seed?.job?.title || getResumeSearchRole() || 'Software Engineer');
  const [level, setLevel] = useState('Intermediate');
  const [duration, setDuration] = useState('1 week');
  const [type, setType] = useState(seed?.type || 'Full Stack');
  const [jd, setJd] = useState('');
  const [useGaps, setUseGaps] = useState(Boolean(seed?.missingSkills?.length));
  const gaps = seed?.missingSkills || [];

  const [status, setStatus] = useState('idle');
  const [project, setProject] = useState(null);
  const [projects, setProjects] = useState(getProjects());
  const [openWs, setOpenWs] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const sync = () => setProjects(getProjects());
    window.addEventListener('career-projects-updated', sync);
    return () => window.removeEventListener('career-projects-updated', sync);
  }, []);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const generate = async () => {
    setStatus('loading'); setProject(null);
    const input = {
      targetRole: role, difficulty: level, duration, type,
      sourceMissingSkills: useGaps && gaps.length ? gaps : extractSkillsFromJD(jd),
      jd: jd.trim(), resumeText: resume.text || '',
      sourceJob: seed?.job ? { title: seed.job.title, company: seed.job.company } : null,
    };
    try { const p = await generateRoadmap(input); setProject(p); setStatus('done'); }
    catch { setStatus('error'); }
  };

  const saveWorkspace = () => { const saved = saveProject(project); setProjects(getProjects()); flash('Saved to workspaces.'); setOpenWs(saved); };
  const addBullets = () => {
    const bullets = (project.resumeBullets || []).map((b) => '• ' + b).join('\n');
    const text = (resume.text || '').trimEnd();
    const block = `\n\nKEY PROJECTS\n${bullets}`;
    saveStoredResume({ text: text ? text + block : `KEY PROJECTS\n${bullets}` });
    flash('Project bullets added to your resume.');
  };
  const onWsChange = (next) => { saveProject(next); setProjects(getProjects()); };
  const publish = (p) => {
    const { ready, missing } = publishReadiness(p);
    if (!ready) { flash('Not ready to publish — add ' + missing.join(', ') + '.'); return; }
    if (!p.published) {
      const cap = access.limits.sandboxPublish;
      const publishedCount = getPublishedProjects().filter((x) => x.id !== p.id).length;
      if (!isUnlimited(cap) && publishedCount >= cap) {
        promptUpgrade('sandboxPublish', `Your ${access.effectivePlan} plan allows ${cap} published sandbox project${cap === 1 ? '' : 's'}. Upgrade to publish more.`);
        return;
      }
    }
    const next = saveProject({ ...p, published: true });
    setProjects(getProjects());
    setOpenWs(next);
    flash('Published to Sandbox.');
  };

  return (
    <>
      <PageIntro title="Career Project Studio" sub="Turn missing skills into portfolio projects that prove your skills to recruiters." />

      {toast && <div className="mb-4 rounded-xl border border-aurora-mint/30 bg-aurora-mint/10 px-4 py-2.5 text-sm text-slate-100">{toast}</div>}

      {seed?.job && (
        <div className="mb-4 rounded-2xl border border-aurora-violet/25 bg-aurora-violet/10 px-4 py-3 text-sm text-slate-200">
          <Sparkles size={15} className="mr-1.5 inline text-aurora-violet" />
          Project generated from gaps in <span className="font-medium text-white">{seed.job.title}</span>{seed.job.company ? <> at <span className="font-medium text-white">{seed.job.company}</span></> : null}.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr]">
        {/* form */}
        <div className="space-y-4">
          <SectionCard title="Project setup">
            <div className="space-y-3">
              <Field label="Target role">
                <select value={role} onChange={(e) => setRole(e.target.value)} className="h-10 w-full rounded-xl border border-white/10 bg-ink-950 px-3 text-sm text-slate-100">
                  {!ALL_ROLES.includes(role) && <option>{role}</option>}
                  {Object.entries(ROLE_GROUPS).map(([g, roles]) => <optgroup key={g} label={g}>{roles.map((r) => <option key={r}>{r}</option>)}</optgroup>)}
                </select>
              </Field>
              <Field label="Experience level">
                <div className="flex flex-wrap gap-1.5">{LEVELS.map((l) => <button key={l} onClick={() => setLevel(l)} className={`rounded-lg px-3 py-1.5 text-xs transition ${level === l ? 'bg-aurora-violet/20 text-white ring-1 ring-aurora-violet/40' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>{l}</button>)}</div>
              </Field>
              <Field label="Project duration">
                <div className="flex flex-wrap gap-1.5">{DURATIONS.map((d) => <button key={d} onClick={() => setDuration(d)} className={`rounded-lg px-3 py-1.5 text-xs transition ${duration === d ? 'bg-aurora-cyan/15 text-white ring-1 ring-aurora-cyan/30' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>{d}</button>)}</div>
              </Field>
              <Field label="Project type">
                <div className="flex flex-wrap gap-1.5">{TYPES.map((t) => <button key={t} onClick={() => setType(t)} className={`rounded-lg px-3 py-1.5 text-xs transition ${type === t ? 'bg-aurora-mint/15 text-white ring-1 ring-aurora-mint/30' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>{t}</button>)}</div>
              </Field>
              <Field label="Paste a job description (optional)">
                <textarea value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste a JD to extract target skills…" className="h-24 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50" />
              </Field>
              <Button className="w-full" onClick={generate} disabled={status === 'loading'}>
                <Wand2 size={16} /> {status === 'loading' ? 'Generating roadmap…' : 'Generate Project Roadmap'}
              </Button>
            </div>
          </SectionCard>

          {/* Missing skill → project converter */}
          <SectionCard title="Missing skills → project" action={<Boxes size={16} className="text-aurora-cyan" />}>
            {gaps.length ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <Chips items={gaps} tone="rose" />
                  <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-400"><input type="checkbox" checked={useGaps} onChange={(e) => setUseGaps(e.target.checked)} /> use these</label>
                </div>
                <p className="text-[12px] leading-relaxed text-slate-400">These gaps were detected from the selected job. The generated project will cover them, explain how it strengthens your resume, and what recruiter-visible proof it creates (a deployed app + README + demo).</p>
              </>
            ) : (
              <p className="text-[12px] text-slate-500">No gaps passed in. Open a job in <button onClick={() => go?.('jobs')} className="text-aurora-cyan underline">Jobs</button> and click “Build project for gaps”, or paste a JD above.</p>
            )}
          </SectionCard>
        </div>

        {/* result / placeholder */}
        <div className="space-y-4">
          {status === 'loading' && <SectionCard title="Generating"><div className="flex flex-col items-center gap-3 py-16"><Spinner /><p className="text-sm text-muted">Designing a project around your skills…</p></div></SectionCard>}
          {status === 'idle' && !project && (
            <SectionCard title="Your project">
              <EmptyState icon={Rocket} title="No project yet" hint="Set your role, level, duration and type, then generate a tailored project roadmap with resume bullets, a README, a LinkedIn post and interview prep." />
            </SectionCard>
          )}
          {project && status === 'done' && (
            <ProjectResult project={project} seed={seed} onSave={saveWorkspace} onAddBullets={addBullets} onOpenEditor={() => go?.('editor')} />
          )}
        </div>
      </div>

      {/* saved workspaces */}
      <div className="mt-6">
        <SectionCard title="Your project workspaces" action={<Badge tone="violet">{projects.length}</Badge>}>
          {projects.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => <WorkspaceCard key={p.id} p={p} onOpen={setOpenWs} onDelete={(id) => { deleteProject(id); setProjects(getProjects()); }} />)}
            </div>
          ) : (
            <EmptyState icon={Layers} title="No saved workspaces" hint="Generate a project and click “Save as workspace” to track tasks, links and proof-of-work here." />
          )}
        </SectionCard>
      </div>

      <WorkspaceModal
        project={openWs}
        open={!!openWs}
        onClose={() => setOpenWs(null)}
        onChange={onWsChange}
        onPublish={publish}
        onOpenEditor={() => { setOpenWs(null); go?.('editor'); }}
      />
    </>
  );
}

/* naive skill extraction from a pasted JD (deterministic, no backend) */
function extractSkillsFromJD(jd = '') {
  if (!jd.trim()) return [];
  const known = ['React', 'Node.js', 'Express', 'TypeScript', 'JavaScript', 'Python', 'Java', 'Go', 'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Jenkins', 'PostgreSQL', 'MongoDB', 'Redis', 'GraphQL', 'REST', 'Spark', 'Hadoop', 'Airflow', 'Snowflake', 'Kafka', 'TensorFlow', 'PyTorch', 'Tailwind', 'Next.js', 'FastAPI', 'Spring Boot', 'Prometheus', 'Grafana', 'Helm'];
  const hay = jd.toLowerCase();
  return known.filter((k) => hay.includes(k.toLowerCase())).slice(0, 10);
}
