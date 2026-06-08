import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, BrainCircuit, CheckCircle2, Database, FileText, GitBranch, IndianRupee, Layers3, Loader2, Rocket, Search, ShieldAlert, Sparkles } from 'lucide-react';
import { PageIntro, SectionCard } from '../common.jsx';
import { Button, Badge, Field, Input, EmptyState } from '../../components/ui/kit.jsx';
import { ProblemIntelligence } from '../../lib/api.js';
import { DOMAINS, TARGET_USERS, TECHNOLOGIES, GOALS, Disclaimer } from './shared.jsx';

function Select({ label, value, onChange, options, placeholder }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-slate-100 outline-none focus:border-aurora-violet/50">
        <option value="">{placeholder || 'Select…'}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </Field>
  );
}
function Score({ label, value }) {
  return <div className="rounded-lg bg-white/[0.03] px-2.5 py-2"><div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div><div className="font-display text-lg text-white">{Math.round(value || 0)}</div></div>;
}
function BulletList({ items = [], empty = 'No data yet.' }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return <p className="text-[12px] text-slate-500">{empty}</p>;
  return <ul className="space-y-1.5 text-[13px] text-slate-300">{list.map((x, i) => <li key={i} className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-aurora-cyan/70" />{typeof x === 'string' ? x : x.phase ? <span><b className="text-white">{x.phase}: </b>{(x.tasks || []).join(', ')}</span> : JSON.stringify(x)}</li>)}</ul>;
}

function ClusterCard({ cluster, selected, onSelect, onGenerate }) {
  return (
    <div className={`rounded-2xl border p-4 transition ${selected ? 'border-aurora-violet/60 bg-aurora-violet/5' : 'border-white/8 bg-white/[0.02] hover:border-white/20'}`}>
      <div className="flex items-start justify-between gap-3">
        <button onClick={onSelect} className="min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{cluster.title}</h3>
            <Badge tone={cluster.sourceBacked ? 'mint' : 'amber'}>{cluster.sourceBacked ? 'Source-backed' : 'Fallback draft'}</Badge>
          </div>
          <p className="mt-1.5 line-clamp-3 text-[13px] text-slate-400">{cluster.refinedSummary || cluster.summary}</p>
        </button>
        <Badge tone="cyan">{cluster.recommendedRoute || 'portfolio'}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <Score label="Evidence" value={cluster.evidenceStrengthScore} />
        <Score label="Severity" value={cluster.severityScore} />
        <Score label="Build" value={cluster.buildFeasibilityScore} />
        <Score label="IP" value={cluster.patentPotentialScore} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(cluster.keywords || []).slice(0, 6).map((k) => <span key={k} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">{k}</span>)}
      </div>
      <div className="mt-3 flex gap-2 border-t border-white/8 pt-3">
        <Button size="sm" variant="soft" onClick={onSelect}><Search size={13} /> Evidence</Button>
        <Button size="sm" onClick={onGenerate}><Sparkles size={13} /> Generate project</Button>
      </div>
    </div>
  );
}

function EvidencePanel({ cluster }) {
  if (!cluster) return null;
  return (
    <SectionCard title="Source evidence" eyebrow={cluster.sourceBacked ? `${cluster.signals?.length || cluster.signalIds?.length || 0} signals` : 'Fallback'}>
      <p className="mb-3 text-[13px] text-slate-400">{cluster.hook || cluster.summary}</p>
      <div className="space-y-2">
        {(cluster.signals || []).slice(0, 6).map((s, i) => (
          <div key={s.rawTextHash || i} className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <div className="flex items-center gap-2"><Badge tone={s.source === 'github' ? 'violet' : s.source === 'arxiv' ? 'cyan' : s.source === 'stackexchange' ? 'amber' : 'slate'}>{s.source}</Badge><div className="truncate text-[13px] font-medium text-white">{s.title}</div></div>
            <p className="mt-1 line-clamp-2 text-[12px] text-slate-500">{s.contentSummary}</p>
            {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] text-aurora-cyan hover:underline">Open source</a>}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function ProjectWorkspace({ project, onConvertProject, onConvertPatent, converting, go }) {
  if (!project) return null;
  const cost = project.costEstimate || {};
  const ip = project.ipReadiness || {};
  return (
    <div className="space-y-4">
      <SectionCard title={project.title} eyebrow={project.sourceMode === 'source-backed' ? 'Source-backed generated project' : 'Fallback draft'} action={<Badge tone={project.sourceMode === 'source-backed' ? 'mint' : 'amber'}>{project.confidence || 'low'} confidence</Badge>}>
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-[15px] font-medium text-white">{project.hook}</p>
            <div className="mt-3 space-y-2 text-[13px] text-slate-300">
              <p><span className="text-slate-500">Pain point: </span>{project.painPoint}</p>
              <p><span className="text-slate-500">Current workaround: </span>{project.currentWorkaround}</p>
              <p><span className="text-slate-500">What to build: </span>{project.proposedSolution}</p>
              <p><span className="text-slate-500">Innovation angle: </span>{project.noveltyAngle}</p>
            </div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white"><IndianRupee size={15} /> MVP realism</div>
            <div className="space-y-1 text-[12px] text-slate-400">
              <p><b className="text-slate-200">Difficulty:</b> {cost.difficulty}</p>
              <p><b className="text-slate-200">Team:</b> {cost.teamSize}</p>
              <p><b className="text-slate-200">Cost:</b> {cost.indiaMvpCostBand}</p>
              <p><b className="text-slate-200">Timeline:</b> {cost.timeline}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/8 pt-3">
          <Button size="sm" onClick={onConvertProject} disabled={converting}><Rocket size={13} /> Convert to project</Button>
          <Button size="sm" variant="soft" onClick={onConvertPatent} disabled={converting}><FileText size={13} /> Convert to Patent OS</Button>
          {project.convertedPatentIdeaId && <Button size="sm" variant="soft" onClick={() => go?.('patentworkspace', { ideaId: project.convertedPatentIdeaId })}>Open Patent workspace <ArrowRight size={13} /></Button>}
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Build blueprint" eyebrow="How to build">
          <div className="mb-4 rounded-xl bg-white/[0.02] p-3"><div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-white"><Layers3 size={14} /> MVP scope</div><BulletList items={project.mvpScope} /></div>
          <div className="mb-4 rounded-xl bg-white/[0.02] p-3"><div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-white"><GitBranch size={14} /> Repo structure</div><BulletList items={project.githubRepoStructure} /></div>
          <div className="rounded-xl bg-white/[0.02] p-3"><div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-white"><Rocket size={14} /> Roadmap</div><BulletList items={project.buildRoadmap} /></div>
        </SectionCard>

        <SectionCard title="IP readiness" eyebrow="Not legal advice">
          <div className="mb-3 flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <div><div className="text-[12px] text-slate-500">Review priority</div><div className="text-sm font-medium text-white">{ip.label}</div></div>
            <Badge tone={ip.overall >= 65 ? 'mint' : ip.overall >= 45 ? 'amber' : 'rose'}>{ip.overall || 0}/100</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Score label="Technical" value={ip.technicalContribution} />
            <Score label="Novelty" value={ip.noveltyPotential} />
            <Score label="Prior-art" value={ip.priorArtConfidence} />
            <Score label="Prototype" value={ip.prototypeEvidenceScore} />
          </div>
          <div className="mt-3 rounded-xl border border-amber-glow/20 bg-amber-glow/5 p-3 text-[12px] text-amber-glow/90">
            <div className="mb-1 flex items-center gap-1.5 font-medium"><ShieldAlert size={13} /> Guardrails</div>
            <BulletList items={ip.capsApplied || ['External prior-art risk unknown until records are added.']} />
          </div>
          <div className="mt-3"><div className="mb-2 text-[12px] font-medium text-white">Required evidence</div><BulletList items={ip.requiredEvidence} /></div>
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Test plan"><BulletList items={project.testPlan} /></SectionCard>
        <SectionCard title="Demo script"><BulletList items={project.demoScript} /></SectionCard>
      </div>
    </div>
  );
}

export default function PatentIdeaGenerator({ go }) {
  const [form, setForm] = useState({ domain: '', targetUser: '', problem: '', existingSolutions: '', technology: '', goal: '', purpose: 'patent-review', difficulty: 'Intermediate', skills: '', limit: 24, sources: ['github', 'stackexchange', 'arxiv', 'manual'] });
  const [config, setConfig] = useState(null);
  const [clusters, setClusters] = useState([]);
  const [selected, setSelected] = useState(null);
  const [project, setProject] = useState(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [converting, setConverting] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => { ProblemIntelligence.config().then(setConfig).catch(() => setConfig(null)); }, []);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const inputPayload = () => ({ ...form, skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean), count: undefined });

  async function discover() {
    if (!form.domain && !form.problem) { setErr('Choose a domain or describe the problem you want to solve.'); return; }
    setBusy(true); setErr(''); setNotice(''); setClusters([]); setProject(null); setSelected(null);
    try {
      const res = await ProblemIntelligence.discover(inputPayload());
      setClusters(res.clusters || []);
      if ((res.clusters || []).length) setSelected(res.clusters[0]);
      setNotice(`${res.signalsCount || 0} signals analyzed. ${res.skippedDuplicates || 0} duplicates skipped. Mode: ${res.mode}.`);
    } catch (e) { setErr(e?.message || 'Problem discovery failed.'); }
    finally { setBusy(false); }
  }

  async function generate(cluster = selected) {
    if (!cluster) return;
    setGenerating(true); setErr(''); setNotice(''); setProject(null); setSelected(cluster);
    try {
      const res = await ProblemIntelligence.generateProject(cluster.id || cluster.dedupeFingerprint, { input: inputPayload(), cluster });
      setProject(res.project);
      setNotice('Source-backed build blueprint generated.');
    } catch (e) { setErr(e?.message || 'Project generation failed.'); }
    finally { setGenerating(false); }
  }

  async function convert(type) {
    if (!project?.projectRecordId && !project?.id) { setErr('Project was not persisted. Check MongoDB connection.'); return; }
    setConverting(true); setErr(''); setNotice('');
    try {
      const id = project.projectRecordId || project.id;
      const res = type === 'project' ? await ProblemIntelligence.convertToProject(id, { project }) : await ProblemIntelligence.convertToPatent(id, { project });
      if (type === 'patent' && res.patentIdeaId) setProject((p) => ({ ...p, convertedPatentIdeaId: res.patentIdeaId }));
      setNotice(type === 'project' ? `Created project submission ${res.projectId || ''}` : `Created Patent OS workspace ${res.patentIdeaId || ''}`);
    } catch (e) { setErr(e?.message || 'Conversion failed.'); }
    finally { setConverting(false); }
  }

  return (
    <>
      <PageIntro title="Innovation & Patent Intelligence OS" sub="Discover real problems from public signals, generate buildable projects, estimate MVP cost/team/resources, and route strong ideas into Patent OS review." />
      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-xl border border-aurora-cyan/20 bg-aurora-cyan/5 px-3 py-2 text-[12px] text-slate-300"><span className="text-aurora-cyan">Engine:</span> GitHub issues + Stack Exchange + arXiv + manual problem fallback. No blind scraping.</div>
        <div className="rounded-xl border border-amber-glow/25 bg-amber-glow/5 px-3 py-2 text-[12px] text-slate-300"><span className="text-amber-glow">AI mode:</span> {config?.aiProvider || 'checking'} · GitHub token {config?.githubConfigured ? 'configured' : 'optional'} · StackExchange key {config?.stackExchangeConfigured ? 'configured' : 'optional'}</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.45fr]">
        <SectionCard title="Discovery inputs" eyebrow="Find real problems first">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Domain / industry" value={form.domain} onChange={(v) => set('domain', v)} options={DOMAINS} />
            <Select label="Target user" value={form.targetUser} onChange={(v) => set('targetUser', v)} options={TARGET_USERS} />
          </div>
          <div className="mt-3"><Field label="Problem statement"><textarea value={form.problem} onChange={(e) => set('problem', e.target.value)} placeholder="Specific pain point, e.g. DevOps teams waste time debugging deployment failures" className="h-24 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50" /></Field></div>
          <div className="mt-3"><Field label="Existing solution / workaround"><Input value={form.existingSolutions} onChange={(e) => set('existingSolutions', e.target.value)} placeholder="What do people use today?" /></Field></div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Select label="Technology" value={form.technology} onChange={(v) => set('technology', v)} options={TECHNOLOGIES} />
            <Select label="Goal" value={form.goal} onChange={(v) => set('goal', v)} options={GOALS} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Select label="Purpose" value={form.purpose} onChange={(v) => set('purpose', v)} options={['portfolio', 'research', 'startup', 'patent-review']} />
            <Select label="Difficulty" value={form.difficulty} onChange={(v) => set('difficulty', v)} options={['Beginner', 'Intermediate', 'Advanced', 'Research-grade']} />
          </div>
          <div className="mt-3"><Field label="Student/team skills"><Input value={form.skills} onChange={(e) => set('skills', e.target.value)} placeholder="React, Node.js, Kubernetes, Python" /></Field></div>
          {err && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
          {notice && <p className="mt-2 flex items-center gap-1.5 text-xs text-aurora-cyan"><CheckCircle2 size={13} /> {notice}</p>}
          <Button className="mt-3" onClick={discover} disabled={busy}>{busy ? <><Loader2 size={16} className="animate-spin" /> Discovering…</> : <><Database size={16} /> Discover real problems</>}</Button>
          <div className="mt-3"><Disclaimer /></div>
        </SectionCard>

        <div className="space-y-3">
          {!clusters.length && !busy && !project && <EmptyState icon={BrainCircuit} title="No problem clusters yet" hint="Run discovery to find source-backed problem clusters before generating a project." />}
          {busy && <SectionCard><div className="flex items-center gap-2 py-8 text-slate-400"><Loader2 size={16} className="animate-spin" /> Fetching and clustering public problem signals…</div></SectionCard>}
          {clusters.length > 0 && (
            <SectionCard title="Problem clusters" eyebrow="Source-backed opportunities">
              <div className="grid gap-3 xl:grid-cols-2">
                {clusters.map((c) => <ClusterCard key={c.id || c.dedupeFingerprint} cluster={c} selected={(selected?.id || selected?.dedupeFingerprint) === (c.id || c.dedupeFingerprint)} onSelect={() => setSelected(c)} onGenerate={() => generate(c)} />)}
              </div>
            </SectionCard>
          )}
          {selected && <EvidencePanel cluster={selected} />}
          {generating && <SectionCard><div className="flex items-center gap-2 py-8 text-slate-400"><Loader2 size={16} className="animate-spin" /> Creating pain story, build blueprint, cost estimate and IP-readiness…</div></SectionCard>}
          <ProjectWorkspace project={project} onConvertProject={() => convert('project')} onConvertPatent={() => convert('patent')} converting={converting} go={go} />
        </div>
      </div>
    </>
  );
}
