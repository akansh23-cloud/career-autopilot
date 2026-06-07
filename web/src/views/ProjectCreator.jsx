import { useEffect, useMemo, useState } from 'react';
import {
  Compass, ShieldCheck, Boxes, ListChecks, BadgeCheck, Rocket, Sparkles, Lightbulb,
  Github, Globe, ChevronDown, ChevronRight, Target, Award, AlertTriangle, Scale,
  Users, ArrowRight, Check, Circle, FileText, Wand2, RefreshCw, TrendingUp, Star, Lock,
} from 'lucide-react';
import { PageIntro, SectionCard, StatCard } from './common.jsx';
import { Button, Badge, Modal, EmptyState, Spinner, Input, Field } from '../components/ui/kit.jsx';
import { ScoreRing, ArchitectureDiagram, StatusBadge } from '../components/proof/ProofViews.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { getAccessForUser } from '../lib/access.js';
import { canUse, useMeter, remaining, promptUpgrade } from '../lib/plan.js';
import { getProjects, getProject, saveProject } from '../lib/projectStore.js';
import {
  CREATOR_STEPS, START_SOURCES, DIFFICULTIES, DURATIONS, CREATOR_TYPES, CATEGORY_ORDER,
  IDEA_BANK, MARKETPLACE_TABS, FIT_LABELS, VAL_LABELS, IP_DISCLAIMER,
  assembleContext, discover, projectFitScore, createProjectFromRec, validateIdea,
  buildBlueprint, buildAdaptiveRoadmap, roadmapProgress, toggleTask, creatorStatus,
  buildIpReadiness, buildCollabDraft, publishCollabDraft, fetchTrends, deterministicValidation,
  getCreatorState, saveCreatorState, persistProjectStep, getCreatorProjects,
  PATENT_STAGES, canRegisterPatent, startPatentRegistration, advancePatentStage,
  recordPatentFiling, recordPriorArtFindings,
} from '../lib/projectCreator.js';
import {
  analyzeGithub, applyGithubAnalysis, verifyLiveLink, applyLiveVerification, buildRecruiterSummary,
} from '../lib/githubSync.js';
import { generateReadme, generateResumeBullets, generateInterviewPrep } from '../lib/projectGen.js';

/* ----------------------------- helpers ----------------------------- */
const STEP_ICONS = { discover: Compass, validate: ShieldCheck, blueprint: Boxes, build: ListChecks, verify: BadgeCheck, publish: Rocket };

function useProjectsLive() {
  const [list, setList] = useState(getProjects());
  useEffect(() => {
    const sync = () => setList(getProjects());
    window.addEventListener('career-projects-updated', sync);
    return () => window.removeEventListener('career-projects-updated', sync);
  }, []);
  return list;
}

function Accordion({ title, icon: Icon, defaultOpen = false, badge, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]">
        {Icon && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-aurora-violet/12 text-aurora-cyan"><Icon size={15} /></span>}
        <span className="flex-1 text-sm font-medium text-white">{title}</span>
        {badge}
        {open ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronRight size={16} className="text-slate-500" />}
      </button>
      {open && <div className="border-t border-white/8 px-4 py-3 text-[13px] leading-relaxed text-slate-300">{children}</div>}
    </div>
  );
}

function List({ items, tone = 'cyan' }) {
  if (!items || !items.length) return <p className="text-[13px] text-slate-500">Not available.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-[13px] text-slate-300">
          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'mint' ? 'bg-aurora-mint' : tone === 'amber' ? 'bg-amber-glow' : 'bg-aurora-cyan'}`} />
          <span>{typeof it === 'string' ? it : (it.feature ? `${it.feature} — ${it.priority}` : JSON.stringify(it))}</span>
        </li>
      ))}
    </ul>
  );
}

function Loading({ msg }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <Spinner />
      <p className="text-sm text-muted">{msg}</p>
    </div>
  );
}

function ScoreBars({ rows, labels }) {
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3 text-[12px]">
          <span className="w-40 shrink-0 text-slate-400">{labels[r.key] || r.key}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full bg-aurora-cta" style={{ width: `${Math.round((r.score / (r.weight || r.max || 20)) * 100)}%` }} />
          </div>
          <span className="w-12 text-right font-mono text-slate-300">{r.score}/{r.weight || r.max}</span>
        </div>
      ))}
    </div>
  );
}

/* Deterministic checks panel (#6). These are objective and reproducible — they
   are the authoritative gate, NOT AI output. */
function DeterministicChecks({ result, onOpenDuplicate }) {
  if (!result) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck size={16} className="text-aurora-cyan" />
        <p className="text-sm font-semibold text-white">Deterministic checks</p>
        <Badge tone={result.requiredOk ? 'mint' : 'amber'}>{result.passed}/{result.total} passed</Badge>
        <span className="ml-auto text-[11px] text-slate-500">Objective · not AI-generated</span>
      </div>
      <div className="space-y-1.5">
        {result.checks.map((c) => (
          <div key={c.id} className="flex items-start gap-2 text-[13px]">
            {c.ok
              ? <Check size={15} className="mt-0.5 shrink-0 text-aurora-mint" />
              : <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-glow" />}
            <span className={c.ok ? 'text-slate-300' : 'text-slate-200'}>
              {c.label}
              {!c.ok && c.detail && <span className="block text-[12px] text-amber-100/80">{c.detail}</span>}
            </span>
          </div>
        ))}
      </div>
      {result.duplicate && onOpenDuplicate && (
        <Button size="sm" variant="soft" className="mt-3" onClick={() => onOpenDuplicate(result.duplicate.id)}>
          Open existing project instead
        </Button>
      )}
    </div>
  );
}

/* Reusable "complete required fields" gate for blueprint/roadmap steps (#7/#8). */
function RequiredFieldsGate({ result }) {
  return (
    <div className="rounded-2xl border border-amber-glow/30 bg-amber-glow/10 p-4">
      <div className="flex items-center gap-2 text-amber-100">
        <AlertTriangle size={16} className="text-amber-glow" />
        <p className="text-sm font-semibold">Complete the required fields first</p>
      </div>
      <p className="mt-1 text-[13px] text-amber-100/80">This step uses your actual project context. Add the missing items below, then come back:</p>
      <ul className="mt-2 space-y-1">
        {result.blocking.map((c) => (
          <li key={c.id} className="text-[13px] text-amber-100">• {c.detail || c.label}</li>
        ))}
      </ul>
    </div>
  );
}

/* =================================================================== */
/* Main view                                                           */
/* =================================================================== */
export default function ProjectCreator({ go }) {
  const { user } = useAuth();
  const access = getAccessForUser(user);
  const isPremium = access.isAdmin || access.effectivePlan === 'premium';
  const isPaid = access.isAdmin || access.effectivePlan === 'pro' || access.effectivePlan === 'premium';
  const projects = useProjectsLive();

  const [step, setStep] = useState('discover');
  const [state, setState] = useState(getCreatorState());
  const selected = useMemo(() => (state.selectedId ? projects.find((p) => p.id === state.selectedId) : null), [projects, state.selectedId]);

  useEffect(() => {
    const sync = () => setState(getCreatorState());
    window.addEventListener('career-creator-updated', sync);
    return () => window.removeEventListener('career-creator-updated', sync);
  }, []);

  // jump to validate if a project is selected but we're still on discover after picking
  const pickProject = (id, gotoStep = 'validate') => { const s = saveCreatorState({ selectedId: id }); setState(s); setStep(gotoStep); };

  return (
    <>
      <PageIntro
        title="Project Creator"
        sub="From “I don’t know what to build” to a validated, built, verified and published product — your Product Building OS."
        action={selected ? <Badge tone="violet"><Target size={11} /> {selected.title.slice(0, 40)}{selected.title.length > 40 ? '…' : ''}</Badge> : null}
      />

      <Stepper step={step} setStep={setStep} selected={selected} />

      <div className="mt-5">
        {step === 'discover' && <DiscoverStep {...{ user, access, isPremium, state, setState, pickProject, projects }} />}
        {step === 'validate' && <ValidateStep {...{ selected, isPremium, setStep, pickProject }} />}
        {step === 'blueprint' && <BlueprintStep {...{ selected, setStep }} />}
        {step === 'build' && <BuildStep {...{ selected, setStep }} />}
        {step === 'verify' && <VerifyStep {...{ selected, user, isPremium, setStep }} />}
        {step === 'publish' && <PublishStep {...{ selected, access, isPaid, go }} />}
      </div>
    </>
  );
}

/* ----------------------------- Stepper ----------------------------- */
function Stepper({ step, setStep, selected }) {
  return (
    <div className="flex flex-wrap gap-2">
      {CREATOR_STEPS.map((s, i) => {
        const Icon = STEP_ICONS[s.id];
        const on = step === s.id;
        const locked = s.id !== 'discover' && !selected;
        return (
          <button
            key={s.id}
            onClick={() => !locked && setStep(s.id)}
            disabled={locked}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium transition ${
              on ? 'border-aurora-violet/40 bg-aurora-violet/15 text-white'
                : locked ? 'border-white/8 bg-white/[0.02] text-slate-600'
                : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/8'
            }`}
          >
            <span className={`grid h-6 w-6 place-items-center rounded-lg text-[11px] ${on ? 'bg-aurora-cta text-white' : 'bg-white/8 text-slate-400'}`}>{i + 1}</span>
            <Icon size={14} className={on ? 'text-aurora-cyan' : ''} /> {s.label}
            {locked && <Lock size={11} className="text-slate-600" />}
          </button>
        );
      })}
    </div>
  );
}

/* =================================================================== */
/* STEP 1 — Discover                                                   */
/* =================================================================== */
function DiscoverStep({ access, isPremium, state, setState, pickProject, projects }) {
  const [source, setSource] = useState(state.lastSource || 'role');
  const [targetRole, setTargetRole] = useState(state.context?.targetRole || '');
  const [difficulty, setDifficulty] = useState(state.context?.difficulty || 'Intermediate');
  const [duration, setDuration] = useState(state.context?.duration || '2 weeks');
  const [preferredType, setPreferredType] = useState(state.context?.preferredType || '');
  const [customIdea, setCustomIdea] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [recs, setRecs] = useState(state.recommendations || []);
  const [tab, setTab] = useState('recommendations');
  const [trends, setTrends] = useState(null);

  const recLeft = remaining('creatorRecs');

  const run = async () => {
    if (!access.isAdmin && !canUse('creatorRecs')) {
      promptUpgrade('You’ve used all your project recommendations for this month. Upgrade for more.', 'pro');
      return;
    }
    setLoading(true);
    const ctx = assembleContext({ targetRole, difficulty, duration, preferredType, startFrom: source, customIdea });
    try {
      const salt = (state.discoverSalt || 0) + 1;
      const { recommendations } = await discover(ctx, { salt });
      useMeter('creatorRecs');
      setRecs(recommendations);
      const s = saveCreatorState({ recommendations, context: ctx, lastSource: source, discoverSalt: salt });
      setState(s);
    } finally { setLoading(false); }
  };

  const loadTrends = async () => { if (trends) return; const t = await fetchTrends(); setTrends(t); };

  const build = async (rec) => {
    setBusyId(rec.id);
    try {
      const ctx = state.context && Object.keys(state.context).length ? state.context : assembleContext({ targetRole, difficulty, duration });
      const p = await createProjectFromRec(rec, ctx);
      pickProject(p.id, 'validate');
    } finally { setBusyId(null); }
  };

  const byCategory = useMemo(() => {
    const map = {};
    (recs || []).forEach((r) => { (map[r.category] = map[r.category] || []).push(r); });
    return map;
  }, [recs]);

  return (
    <div className="space-y-5">
      <SectionCard title="Where do you want to start?" action={<Badge tone={recLeft === Infinity ? 'mint' : recLeft > 0 ? 'cyan' : 'amber'}>{recLeft === Infinity ? 'Unlimited' : `${recLeft} left`}</Badge>}>
        <div className="flex flex-wrap gap-2">
          {START_SOURCES.map((s) => (
            <button key={s.id} onClick={() => { setSource(s.id); if (s.id === 'github' || s.id === 'producthunt') { setTab('marketplace'); loadTrends(); } }}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${source === s.id ? 'border-aurora-cyan/50 bg-aurora-cyan/15 text-[#A7ECF8]' : 'border-white/12 bg-white/[0.03] text-slate-300 hover:bg-white/8'}`}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Target role"><Input value={targetRole} onChange={(e) => setTargetRole(e.target.value)} placeholder="e.g. Backend Developer" /></Field>
          <Field label="Difficulty">
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-ink-950 px-3 text-sm text-slate-100">
              {DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Duration">
            <select value={duration} onChange={(e) => setDuration(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-ink-950 px-3 text-sm text-slate-100">
              {DURATIONS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Preferred type">
            <select value={preferredType} onChange={(e) => setPreferredType(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-ink-950 px-3 text-sm text-slate-100">
              <option value="">Any</option>
              {CREATOR_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
        </div>

        {source === 'custom' && (
          <div className="mt-3">
            <Field label="Describe your idea" hint="A sentence or two — we’ll validate and shape it into a buildable product.">
              <textarea value={customIdea} onChange={(e) => setCustomIdea(e.target.value)} rows={3}
                className="w-full rounded-xl border border-white/10 bg-ink-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600" placeholder="e.g. A tool that turns lecture recordings into searchable notes…" />
            </Field>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={run} disabled={loading}><Wand2 size={16} /> {loading ? 'Finding opportunities…' : 'Generate recommendations'}</Button>
          <Button variant="soft" onClick={() => { setTab(tab === 'marketplace' ? 'recommendations' : 'marketplace'); loadTrends(); }}><Lightbulb size={15} /> Browse idea marketplace</Button>
        </div>
      </SectionCard>

      {loading && <SectionCard title="Discovery"><Loading msg="Finding project opportunities…" /></SectionCard>}

      {!loading && tab === 'recommendations' && (
        recs && recs.length ? (
          <div className="space-y-5">
            {CATEGORY_ORDER.filter((c) => byCategory[c]?.length).map((cat) => (
              <div key={cat}>
                <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500"><Star size={12} className="text-amber-glow" /> {cat}</p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {byCategory[cat].map((rec) => <RecCard key={rec.id} rec={rec} onBuild={build} busy={busyId === rec.id} />)}
                </div>
              </div>
            ))}
            {/* any uncategorised */}
            {(recs.filter((r) => !CATEGORY_ORDER.includes(r.category))).length > 0 && (
              <div className="grid gap-3 lg:grid-cols-2">
                {recs.filter((r) => !CATEGORY_ORDER.includes(r.category)).map((rec) => <RecCard key={rec.id} rec={rec} onBuild={build} busy={busyId === rec.id} />)}
              </div>
            )}
          </div>
        ) : (
          <SectionCard title="Recommendations">
            <EmptyState icon={Compass} title="No recommendations yet" hint="Pick a starting point and generate 3–5 ranked, fit-scored project ideas tailored to your role, skills and goals." />
          </SectionCard>
        )
      )}

      {!loading && tab === 'marketplace' && <Marketplace projects={projects} trends={trends} onBuild={build} busyId={busyId} isPremium={isPremium} />}
    </div>
  );
}

function RecCard({ rec, onBuild, busy }) {
  const fit = rec.fit || projectFitScore(rec, {});
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="violet">{rec.type}</Badge>
            <Badge tone={fit.confidence === 'High' ? 'mint' : fit.confidence === 'Medium' ? 'cyan' : 'amber'}>{fit.confidence} confidence</Badge>
          </div>
          <p className="mt-2 font-medium text-white">{rec.title}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{rec.summary}</p>
        </div>
        <ScoreRing score={fit.score} label="Fit" />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2"><p className="font-display text-base font-semibold text-white">{rec.difficulty}</p><p className="text-slate-500">Level</p></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2"><p className="font-display text-base font-semibold text-white">{rec.estimatedDuration}</p><p className="text-slate-500">Duration</p></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2"><p className="font-display text-base font-semibold text-white">{rec.startupPotential}</p><p className="text-slate-500">Startup</p></div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">{(rec.skillsCovered || []).slice(0, 6).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div>

      <div className="mt-3 space-y-2">
        <Accordion title="Why recommended + fit breakdown" icon={Target}>
          <p className="mb-3">{rec.whyRecommended}</p>
          <ScoreBars rows={fit.rows} labels={FIT_LABELS} />
          {rec.sourceSignals?.length > 0 && <p className="mt-3 text-[12px] text-slate-500">Signals: {rec.sourceSignals.join(', ')}.</p>}
        </Accordion>
        <Accordion title="Skills & impact" icon={Award}>
          <p className="text-slate-400">Covers gaps: <span className="text-slate-200">{(rec.missingSkillsCovered || []).join(', ') || '—'}</span></p>
          <p className="mt-1 text-slate-400">Still missing: <span className="text-slate-200">{(rec.stillMissingSkills || []).join(', ') || 'none'}</span></p>
          <p className="mt-2 text-slate-400">Target users: <span className="text-slate-200">{rec.targetUsers}</span></p>
          <p className="mt-2 text-aurora-cyan/90">{rec.resumeImpactPreview}</p>
          <p className="mt-1 text-aurora-mint/90">{rec.recruiterImpactPreview}</p>
          {rec.expectedProofOutputs?.length > 0 && <div className="mt-2"><span className="text-slate-400">Expected proof: </span>{rec.expectedProofOutputs.map((o, i) => <Badge key={i} tone="mint">{o}</Badge>)}</div>}
        </Accordion>
      </div>

      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={() => onBuild(rec)} disabled={busy}>{busy ? 'Creating…' : <>Build this <ArrowRight size={14} /></>}</Button>
      </div>
    </div>
  );
}

function Marketplace({ projects, trends, onBuild, busyId, isPremium }) {
  const [tab, setTab] = useState('Product Ideas');
  const published = (projects || []).filter((p) => p.published);
  const ideasFor = (cat) => IDEA_BANK.filter((i) => i.category === cat);
  const ideaToRec = (i) => ({ id: i.id, title: i.title, summary: i.problem, type: i.type, category: 'Best Portfolio Impact', targetUsers: 'Users who feel this problem', targetRoleFit: '', skillsCovered: i.skills, missingSkillsCovered: [], stillMissingSkills: [], difficulty: i.difficulty, estimatedDuration: '2 weeks', weeklyTime: '6–10 hrs', startupPotential: i.startupPotential, proofPotential: 78, whyRecommended: i.problem, sourceSignals: ['curated idea bank'], expectedProofOutputs: ['GitHub repo', 'Live demo', 'README'], resumeImpactPreview: `Built ${i.title}.`, recruiterImpactPreview: 'Demonstrates a real, deployed product.' });

  return (
    <SectionCard title="Idea marketplace" action={<Lightbulb size={16} className="text-amber-glow" />}>
      <div className="mb-4 flex flex-wrap gap-2">
        {MARKETPLACE_TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${tab === t ? 'border-aurora-violet/40 bg-aurora-violet/15 text-white' : 'border-white/12 bg-white/[0.03] text-slate-300 hover:bg-white/8'}`}>{t}</button>
        ))}
      </div>

      {tab === 'Published Projects' && (
        published.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {published.map((p) => (
              <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between"><p className="font-medium text-white">{p.title}</p><StatusBadge status={creatorStatus(p).status} /></div>
                <p className="mt-1 text-[13px] text-slate-400">{p.summary || p.problemStatement}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">{(p.skillsCovered || []).slice(0, 5).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div>
              </div>
            ))}
          </div>
        ) : <EmptyState icon={Rocket} title="No published projects yet" hint="Real user-published projects appear here once they’re shipped. No placeholder projects are shown." />
      )}

      {(tab === 'Product Ideas' || tab === 'Startup Problems' || tab === 'Data/AI Ideas' || tab === 'Hackathon Style') && (
        <div className="grid gap-3 md:grid-cols-2">
          {ideasFor(tab).length ? ideasFor(tab).map((i) => (
            <IdeaCard key={i.id} idea={i} onBuild={() => onBuild(ideaToRec(i))} busy={busyId === i.id} />
          )) : <EmptyState icon={Lightbulb} title="No ideas in this category yet" hint="Try another tab — these are clearly-labelled inspiration ideas, not user projects." />}
        </div>
      )}

      {tab === 'Trending from GitHub' && (
        trends?.github?.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {trends.github.map((g) => (
              <div key={g.name} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between"><a href={g.url} target="_blank" rel="noreferrer" className="font-medium text-white hover:text-aurora-cyan">{g.name}</a><Badge tone="amber"><Star size={11} /> {g.stars}</Badge></div>
                <p className="mt-1 text-[13px] text-slate-400">{g.description || 'No description.'}</p>
                {g.language && <Badge tone="violet">{g.language}</Badge>}
              </div>
            ))}
          </div>
        ) : <EmptyState icon={Github} title="GitHub trends unavailable" hint="Live GitHub trending requires network access on the server. Curated ideas are always available in the other tabs." />
      )}

      {tab === 'Product Hunt Inspired' && (
        <EmptyState icon={TrendingUp} title={trends?.sources?.productHunt ? 'Product Hunt connected' : 'Product Hunt not configured'} hint={trends?.sources?.productHunt ? 'Trending launches appear here when available.' : 'Set PRODUCTHUNT_TOKEN on the server to surface trending launches. Curated ideas remain available.'} />
      )}
    </SectionCard>
  );
}

function IdeaCard({ idea, onBuild, busy }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="violet">{idea.type}</Badge>
        <Badge tone="mint">Startup {idea.startupPotential}</Badge>
      </div>
      <p className="mt-2 font-medium text-white">{idea.title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{idea.problem}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">{idea.skills.slice(0, 5).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[12px] text-slate-500">{idea.difficulty}</span>
        <Button size="sm" onClick={onBuild} disabled={busy}>{busy ? 'Creating…' : <>Build this <ArrowRight size={14} /></>}</Button>
      </div>
    </div>
  );
}

/* =================================================================== */
/* STEP 2 — Validate                                                   */
/* =================================================================== */
function ValidateStep({ selected, isPremium, setStep, pickProject }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(selected?.creator?.validation || null);
  useEffect(() => { setData(selected?.creator?.validation || null); }, [selected?.id]);

  const det = useMemo(() => (selected ? deterministicValidation(selected) : null), [selected, selected?.tasks, selected?.architectureDiagram]);

  if (!selected) return <NeedProject />;

  const run = async () => {
    setLoading(true);
    try {
      const idea = { title: selected.title, summary: selected.creator?.summary || selected.problemStatement, type: selected.creator?.productType, targetUsers: selected.creator?.targetUsers, targetRoleFit: selected.targetRole, skillsCovered: selected.skillsCovered, startupPotential: selected.creator?.startupPotential, proofPotential: selected.creator?.proofPotential };
      const result = await validateIdea(idea);
      persistProjectStep(selected.id, { validation: result, step: 'blueprint' });
      setData(result);
    } finally { setLoading(false); }
  };

  const r = data?.report;
  return (
    <div className="space-y-4">
      {/* Authoritative, deterministic gate — always shown, never AI-derived. */}
      <SectionCard title="Validation">
        <DeterministicChecks result={det} onOpenDuplicate={(id) => pickProject?.(id, 'validate')} />
        {det && !det.requiredOk && (
          <p className="mt-3 text-[13px] text-amber-100/80">Resolve the required checks above before generating AI suggestions or moving on.</p>
        )}
        {det && det.requiredOk && (
          <div className="mt-3 flex justify-end"><Button onClick={() => setStep('blueprint')}>Next: Blueprint <ArrowRight size={15} /></Button></div>
        )}
      </SectionCard>

      <SectionCard
        title="AI validation suggestions"
        action={<Button size="sm" variant={data ? 'soft' : 'primary'} onClick={run} disabled={loading || (det && !det.requiredOk)}>{loading ? 'Validating…' : data ? <><RefreshCw size={14} /> Re-run</> : <><Wand2 size={14} /> Get AI suggestions</>}</Button>}
      >
        <div className="mb-3 flex gap-2 rounded-xl border border-aurora-violet/25 bg-aurora-violet/10 px-3 py-2 text-[12px] text-[#FFD49A]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>These are AI-generated <strong>suggestions</strong>, not verified facts. Scores are estimates to guide thinking — treat them as prompts to research, not proof.</span>
        </div>
        {loading ? <Loading msg="Generating validation suggestions…" /> : !data ? (
          <EmptyState icon={ShieldCheck} title="Optional AI suggestions" hint="Generate a structured set of AI suggestions: problem severity, users, alternatives, feasibility, monetization, risks and an estimated score." />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <ScoreRing score={data.total} label="AI estimate" size={64} />
              <div>
                <p className="text-sm font-medium text-white">AI estimated score: {data.total}/100 <span className="text-[12px] font-normal text-slate-500">(suggestion)</span></p>
                <p className="text-[13px] text-slate-400">{data.total >= 75 ? 'AI thinks this is strong — verify with the checks above and real user signal.' : data.total >= 55 ? 'AI sees promise — tighten differentiation and users.' : 'AI suggests sharpening the problem and proof.'}</p>
              </div>
            </div>
            {r?.genericWarning && (
              <div className="flex gap-2 rounded-xl border border-amber-glow/30 bg-amber-glow/10 px-4 py-3 text-[13px] text-amber-100">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-glow" /> <span>{r.genericWarning}</span>
              </div>
            )}
            {r?.score && <ScoreBars rows={Object.keys(VAL_LABELS).map((k) => ({ key: k, score: Math.min(({ problemClarity: 20, userNeed: 20, feasibility: 15, differentiation: 15, careerValue: 10, startupPotential: 12, proofPotential: 13 })[k], Number(r.score[k] || 0)), weight: ({ problemClarity: 20, userNeed: 20, feasibility: 15, differentiation: 15, careerValue: 10, startupPotential: 12, proofPotential: 13 })[k] }))} labels={VAL_LABELS} />}
            <div className="grid gap-3 md:grid-cols-2">
              <Accordion title="Problem & users" icon={Users} defaultOpen><p className="mb-2"><span className="text-slate-400">Severity: </span>{r.problemSeverity}</p><p className="mb-2"><span className="text-slate-400">Users: </span>{r.targetUsers}</p><p className="mb-1 text-slate-400">Pain points:</p><List items={r.userPainPoints} /></Accordion>
              <Accordion title="Alternatives & differentiation" icon={Scale}><p className="mb-1 text-slate-400">Existing alternatives:</p><List items={r.existingAlternatives} /><p className="mb-1 mt-2 text-slate-400">Why they’re weak:</p><List items={r.whyAlternativesWeak} tone="amber" /></Accordion>
              <Accordion title="Feasibility & monetization" icon={TrendingUp}><p className="mb-2"><span className="text-slate-400">MVP feasibility: </span>{r.mvpFeasibility}</p><p className="mb-2"><span className="text-slate-400">Build difficulty: </span>{r.buildDifficulty}</p><p className="mb-1 text-slate-400">Monetization:</p><List items={r.monetization} tone="mint" /></Accordion>
              <Accordion title="Risks & assumptions" icon={AlertTriangle}><p className="mb-1 text-slate-400">Risks:</p><List items={r.risks} tone="amber" /><p className="mb-1 mt-2 text-slate-400">Assumptions:</p><List items={r.assumptions} /></Accordion>
              <Accordion title="Validation questions" icon={ShieldCheck}><List items={r.validationQuestions} /></Accordion>
              <Accordion title="First 10 users & metrics" icon={Rocket}><p className="mb-1 text-slate-400">First 10 users:</p><List items={r.firstTenUsersStrategy} tone="mint" /><p className="mb-1 mt-2 text-slate-400">Success metrics:</p><List items={r.successMetrics} /></Accordion>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* =================================================================== */
/* STEP 3 — Blueprint                                                  */
/* =================================================================== */
function BlueprintStep({ selected, setStep }) {
  const [loading, setLoading] = useState(false);
  const [bp, setBp] = useState(selected?.creator?.blueprint || null);
  useEffect(() => { setBp(selected?.creator?.blueprint || null); }, [selected?.id]);
  const det = useMemo(() => (selected ? deterministicValidation(selected) : null), [selected]);
  if (!selected) return <NeedProject />;

  const run = async () => {
    setLoading(true);
    try {
      const { blueprint } = await buildBlueprint({ title: selected.title, summary: selected.creator?.summary, type: selected.creator?.productType, targetUsers: selected.creator?.targetUsers, skillsCovered: selected.skillsCovered, targetRole: selected.targetRole, techStack: selected.techStack, architecture: selected.architecture, databaseSchema: selected.databaseSchema, repoStructure: selected.repoStructure, problemStatement: selected.problemStatement });
      persistProjectStep(selected.id, { blueprint, step: 'build' });
      setBp(blueprint);
    } finally { setLoading(false); }
  };

  // #7 — architecture/blueprint must use real context; block generic output when
  // required context is missing.
  if (det && !det.requiredOk) {
    return (
      <div className="space-y-4">
        <SectionCard title="Product blueprint">
          <RequiredFieldsGate result={det} />
          <div className="mt-3"><Button size="sm" variant="soft" onClick={() => setStep('validate')}>Back to validation</Button></div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Product blueprint" action={<Button size="sm" variant={bp ? 'soft' : 'primary'} onClick={run} disabled={loading}>{loading ? 'Building…' : bp ? <><RefreshCw size={14} /> Re-run</> : <><Wand2 size={14} /> Generate blueprint</>}</Button>}>
        {loading ? <Loading msg="Building product blueprint…" /> : !bp ? (
          <EmptyState icon={Boxes} title="Design before you build" hint="Generate vision, positioning, MVP scope, architecture, schema, API, screens and a launch checklist." />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3"><p className="text-[11px] uppercase tracking-widest text-slate-500">Vision</p><p className="mt-1 text-[13px] text-slate-200">{bp.productVision}</p></div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3"><p className="text-[11px] uppercase tracking-widest text-slate-500">Positioning</p><p className="mt-1 text-[13px] text-slate-200">{bp.positioning}</p></div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">System architecture</p>
              <ArchitectureDiagram mermaid={selected.architectureDiagram} height={300} />
              <p className="mt-2 text-[12px] text-slate-400">{bp.systemArchitecture}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Accordion title="MVP scope" icon={ListChecks} defaultOpen><List items={bp.mvpScope} tone="mint" /></Accordion>
              <Accordion title="Advanced features" icon={Sparkles}><List items={bp.advancedFeatures} /></Accordion>
              <Accordion title="Feature prioritization" icon={Target}><List items={bp.featurePrioritization} /></Accordion>
              <Accordion title="Personas & journeys" icon={Users}><p className="mb-1 text-slate-400">Personas:</p><List items={bp.personas} /><p className="mb-1 mt-2 text-slate-400">Journeys:</p><List items={bp.userJourneys} /></Accordion>
              <Accordion title="Tech stack & integrations" icon={Boxes}><div className="flex flex-wrap gap-1.5">{(bp.techStack || []).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div><p className="mt-2 text-slate-400">Integrations:</p><List items={bp.integrations} /></Accordion>
              <Accordion title="Database schema" icon={FileText}><List items={bp.databaseSchema} /></Accordion>
              <Accordion title="API design" icon={Globe}><List items={bp.apiDesign} /></Accordion>
              <Accordion title="UI screens & folder structure" icon={Boxes}><List items={bp.uiScreens} /><pre className="mt-2 overflow-x-auto rounded-lg border border-white/10 bg-ink-950 p-3 text-[12px] text-slate-300">{bp.folderStructure}</pre></Accordion>
              <Accordion title="Security & non-functional" icon={ShieldCheck}><p className="mb-1 text-slate-400">Security:</p><List items={bp.securityRequirements} tone="amber" /><p className="mb-1 mt-2 text-slate-400">Non-functional:</p><List items={bp.nonFunctional} /></Accordion>
              <Accordion title="Deployment, testing & analytics" icon={Rocket}><p className="mb-1 text-slate-400">Deployment:</p><List items={bp.deploymentArchitecture} /><p className="mb-1 mt-2 text-slate-400">Testing:</p><List items={bp.testingStrategy} /><p className="mb-1 mt-2 text-slate-400">Analytics:</p><List items={bp.analytics} /></Accordion>
              <Accordion title="Launch checklist" icon={BadgeCheck}><List items={bp.launchChecklist} tone="mint" /></Accordion>
            </div>
            <div className="flex justify-end"><Button onClick={() => setStep('build')}>Next: Build roadmap <ArrowRight size={15} /></Button></div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* =================================================================== */
/* STEP 4 — Build roadmap                                              */
/* =================================================================== */
function BuildStep({ selected, setStep }) {
  const [loading, setLoading] = useState(false);
  const [level, setLevel] = useState(selected?.creator?.roadmapLevel || selected?.difficulty || 'Intermediate');
  const det = useMemo(() => (selected ? deterministicValidation(selected) : null), [selected]);
  if (!selected) return <NeedProject />;
  const tasks = selected.tasks || [];
  const progress = roadmapProgress(selected);

  const run = async () => {
    setLoading(true);
    try { await buildAdaptiveRoadmap(selected, level); } finally { setLoading(false); }
  };

  const grouped = useMemo(() => {
    const m = {};
    tasks.forEach((t) => { const k = t.milestone || 'Tasks'; (m[k] = m[k] || []).push(t); });
    return m;
  }, [tasks]);

  if (det && !det.requiredOk) {
    return (
      <div className="space-y-4">
        <SectionCard title="Build roadmap">
          <RequiredFieldsGate result={det} />
          <div className="mt-3"><Button size="sm" variant="soft" onClick={() => setStep('validate')}>Back to validation</Button></div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Beginner-friendly build roadmap" action={
        <div className="flex items-center gap-2">
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="h-9 rounded-lg border border-white/10 bg-ink-950 px-2 text-[13px] text-slate-100">{DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}</select>
          <Button size="sm" variant={tasks.length ? 'soft' : 'primary'} onClick={run} disabled={loading}>{loading ? 'Building…' : tasks.length ? <><RefreshCw size={14} /> Regenerate</> : <><Wand2 size={14} /> Generate roadmap</>}</Button>
        </div>
      }>
        {loading ? <Loading msg="Creating mentor-level roadmap…" /> : !tasks.length ? (
          <EmptyState icon={ListChecks} title="No roadmap yet" hint="Generate an adaptive, mentor-level roadmap with phases, milestones, verification checkpoints and detailed tasks." />
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
              <div className="flex items-center justify-between text-xs text-slate-400"><span>Roadmap progress</span><span>{progress}%</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-aurora-cta" style={{ width: `${progress}%` }} /></div>
              <p className="mt-2 text-[12px] text-slate-500">Completing tasks raises your proof score and skill XP. GitHub/live proof (next step) gives stronger XP and unlocks verification.</p>
            </div>
            {Object.entries(grouped).map(([milestone, mtasks]) => (
              <div key={milestone}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">{milestone}</p>
                <div className="space-y-2">
                  {mtasks.map((t) => <TaskRow key={t.id} t={t} projectId={selected.id} />)}
                </div>
              </div>
            ))}
            <div className="flex justify-end"><Button onClick={() => setStep('verify')}>Next: Verify <ArrowRight size={15} /></Button></div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function TaskRow({ t, projectId }) {
  const [open, setOpen] = useState(false);
  const done = t.status === 'done';
  return (
    <div className={`rounded-xl border p-3 transition ${done ? 'border-aurora-mint/25 bg-aurora-mint/8' : 'border-white/8 bg-white/[0.02]'}`}>
      <div className="flex items-start gap-3">
        <button onClick={() => toggleTask(projectId, t.id)} className={`mt-0.5 ${done ? 'text-aurora-mint' : 'text-slate-500 hover:text-slate-200'}`}>{done ? <Check size={18} /> : <Circle size={18} />}</button>
        <div className="min-w-0 flex-1">
          <button onClick={() => setOpen((v) => !v)} className="text-left">
            <p className={`text-sm font-medium ${done ? 'text-slate-400 line-through' : 'text-white'}`}>{t.title}</p>
            {t.whyItMatters && <p className="mt-0.5 text-[12px] text-slate-500">Why: {t.whyItMatters}</p>}
          </button>
          {open && (
            <div className="mt-2 space-y-2 border-t border-white/8 pt-2 text-[12px] text-slate-300">
              {t.detailedSteps?.length > 0 && <div><p className="text-slate-400">Steps:</p><List items={t.detailedSteps} /></div>}
              {t.filesToCreateOrEdit?.length > 0 && <p><span className="text-slate-400">Files: </span>{t.filesToCreateOrEdit.join(', ')}</p>}
              {t.expectedOutput && <p><span className="text-slate-400">Expected output: </span>{t.expectedOutput}</p>}
              {t.howToTest && <p><span className="text-slate-400">How to test: </span>{t.howToTest}</p>}
              {t.commonMistakes && <p className="text-amber-100/80"><span className="text-slate-400">Common mistakes: </span>{t.commonMistakes}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {t.estimatedTime && <Badge tone="violet">{t.estimatedTime}</Badge>}
                {(t.skillsPracticed || []).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}
              </div>
            </div>
          )}
        </div>
        <button onClick={() => setOpen((v) => !v)} className="text-slate-500">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
      </div>
    </div>
  );
}

/* =================================================================== */
/* STEP 5 — Verify                                                     */
/* =================================================================== */
function VerifyStep({ selected, user, isPremium, setStep }) {
  const [repoUrl, setRepoUrl] = useState(selected?.githubUrl || '');
  const [liveUrl, setLiveUrl] = useState(selected?.liveDemoUrl || '');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [ipOpen, setIpOpen] = useState(false);
  if (!selected) return <NeedProject />;
  const st = creatorStatus(selected);

  const analyze = async () => {
    if (!repoUrl.trim()) return;
    setBusy('gh'); setMsg('');
    try {
      const result = await analyzeGithub({ repoUrl, projectId: selected.id, expectedSkills: selected.skillsCovered, expectedTechStack: selected.techStack, targetRole: selected.targetRole });
      if (result && result.success !== false) saveProject(applyGithubAnalysis({ ...selected, githubUrl: repoUrl }, result));
      else { saveProject({ ...selected, githubUrl: repoUrl }); setMsg(result?.message || 'GitHub analysis unavailable — your repo URL is saved as manual proof.'); }
    } catch { setMsg('GitHub analysis failed — repo URL saved as manual proof.'); saveProject({ ...selected, githubUrl: repoUrl }); }
    finally { setBusy(''); }
  };
  const verifyLive = async () => {
    if (!liveUrl.trim()) return;
    setBusy('live'); setMsg('');
    try { const result = await verifyLiveLink({ liveUrl, projectId: selected.id }); saveProject(applyLiveVerification({ ...selected, liveDemoUrl: liveUrl }, result || {})); if (!(result && result.reachable)) setMsg('Live link saved, but it could not be verified as reachable yet.'); }
    catch { saveProject({ ...selected, liveDemoUrl: liveUrl }); setMsg('Could not verify the live link right now — URL saved.'); }
    finally { setBusy(''); }
  };
  const genArtifact = async (kind) => {
    setBusy(kind);
    try {
      if (kind === 'readme') saveProject({ ...selected, readme: await generateReadme(selected) });
      else if (kind === 'bullets') saveProject({ ...selected, resumeBullets: await generateResumeBullets(selected) });
      else if (kind === 'interview') saveProject({ ...selected, interviewQuestions: await generateInterviewPrep(selected) });
      else if (kind === 'recruiter') saveProject({ ...selected, recruiterSummary: buildRecruiterSummary(selected, user?.name || 'Candidate') });
    } finally { setBusy(''); }
  };

  return (
    <div className="space-y-4">
      <SectionCard title="Verification" action={<StatusBadge status={st.status} />}>
        <div className="flex flex-wrap items-center gap-3">
          <ScoreRing score={st.proofScore} label="Proof" size={64} />
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge status={st.status} />
            {st.startupReady && <Badge tone="amber"><Rocket size={11} /> Startup Ready</Badge>}
            {st.validationTotal > 0 && <Badge tone="cyan">Validation {st.validationTotal}</Badge>}
          </div>
        </div>

        {st.reasons?.length > 0 && (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <p className="text-[12px] font-medium text-slate-300">To reach {st.next}:</p>
            <List items={st.reasons} tone="amber" />
          </div>
        )}
        {!st.startupReady && st.startupReqs?.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-glow/25 bg-amber-glow/8 p-3">
            <p className="text-[12px] font-medium text-amber-100">For Startup Ready:</p>
            <List items={st.startupReqs} tone="amber" />
          </div>
        )}
      </SectionCard>

      <SectionCard title="Proof of work">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-slate-300">GitHub repository</p>
            <div className="flex gap-2"><Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="github.com/user/repo" /><Button size="sm" onClick={analyze} disabled={busy === 'gh'}>{busy === 'gh' ? '…' : <><Github size={14} /> Analyze</>}</Button></div>
            {selected.github?.success && <p className="mt-1.5 text-[12px] text-aurora-mint">Analyzed · GitHub score {selected.github.githubScore}/100</p>}
          </div>
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-slate-300">Live demo</p>
            <div className="flex gap-2"><Input value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} placeholder="https://your-demo.app" /><Button size="sm" onClick={verifyLive} disabled={busy === 'live'}>{busy === 'live' ? '…' : <><Globe size={14} /> Verify</>}</Button></div>
            {selected.liveVerification?.reachable && <p className="mt-1.5 text-[12px] text-aurora-mint">Live link verified reachable.</p>}
          </div>
        </div>
        {msg && <p className="mt-3 text-[12px] text-amber-100">{msg}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="soft" onClick={() => genArtifact('readme')} disabled={busy === 'readme'}><FileText size={13} /> {selected.readme ? 'Regenerate README' : 'Generate README'}</Button>
          <Button size="sm" variant="soft" onClick={() => genArtifact('bullets')} disabled={busy === 'bullets'}><Award size={13} /> Resume bullets</Button>
          <Button size="sm" variant="soft" onClick={() => genArtifact('interview')} disabled={busy === 'interview'}><ShieldCheck size={13} /> Interview prep</Button>
          <Button size="sm" variant="soft" onClick={() => genArtifact('recruiter')} disabled={busy === 'recruiter'}><BadgeCheck size={13} /> Recruiter summary</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.readme && <Badge tone="mint">README</Badge>}
          {selected.resumeBullets?.length > 0 && <Badge tone="mint">Resume bullets</Badge>}
          {selected.interviewQuestions?.length > 0 && <Badge tone="mint">Interview prep</Badge>}
          {selected.recruiterSummary && <Badge tone="mint">Recruiter summary</Badge>}
        </div>
      </SectionCard>

      {/* Part 8 — IP readiness (optional, premium) */}
      <SectionCard title="IP Readiness" action={<Button size="sm" variant="soft" onClick={() => setIpOpen(true)}><Scale size={14} /> Open IP studio</Button>}>
        <p className="text-[13px] text-slate-400">Optional educational IP-readiness guidance and draft preparation — patent readiness score, novelty points, prior-art keywords and a provisional spec outline.</p>
        {!isPremium && <Badge tone="violet"><Lock size={11} /> Premium</Badge>}
      </SectionCard>
      <IpModal open={ipOpen} onClose={() => setIpOpen(false)} project={selected} isPremium={isPremium} />

      <div className="flex justify-end"><Button onClick={() => setStep('publish')}>Next: Publish <ArrowRight size={15} /></Button></div>
    </div>
  );
}

function Check2({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[13px] text-slate-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-glow" />
      <span>{label}</span>
    </label>
  );
}

function PatentPipeline({ stageId, onSet }) {
  const idx = Math.max(0, PATENT_STAGES.findIndex((s) => s.id === stageId));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PATENT_STAGES.map((s, i) => (
        <button key={s.id} onClick={() => onSet(s.id)}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${i <= idx ? 'border-aurora-mint/40 bg-aurora-mint/12 text-[#A7F2CE]' : 'border-white/12 bg-white/[0.03] text-slate-400 hover:bg-white/8'}`}>
          {i < idx ? <Check size={10} className="mr-1 inline" /> : null}{s.label}
        </button>
      ))}
    </div>
  );
}

function PatentRegistration({ project, rep, attest, setAttest, onReassess }) {
  const [dossier, setDossier] = useState(project?.creator?.patent || null);
  const [appNo, setAppNo] = useState(project?.creator?.patent?.filing?.applicationNumber || '');
  const [jur, setJur] = useState(project?.creator?.patent?.filing?.jurisdiction || 'India (IPO)');
  const [route, setRoute] = useState(project?.creator?.patent?.filing?.route || 'Provisional / priority application');
  useEffect(() => { setDossier(project?.creator?.patent || null); }, [project?.id]);

  const eligible = canRegisterPatent(rep);
  const gate = rep?.gate || {};
  const d = dossier?.dossier || rep?.dossier || {};

  const start = () => { const n = startPatentRegistration(project.id, attest); setDossier(n?.creator?.patent || null); };
  const setStage = (id) => { const n = advancePatentStage(project.id, id); setDossier(n?.creator?.patent || null); };
  const savePriorArt = () => { const n = recordPriorArtFindings(project.id, d?.priorArt?.findings || [], attest); setDossier(n?.creator?.patent || null); onReassess?.(n?.creator?.patent || null); };
  const saveFiling = () => { const n = recordPatentFiling(project.id, { applicationNumber: appNo, jurisdiction: jur, route, filedAt: new Date().toISOString() }); setDossier(n?.creator?.patent || null); };

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Award size={16} className="text-amber-glow" />
        <p className="text-sm font-semibold text-white">Patent registration</p>
        <Badge tone={eligible ? 'mint' : 'amber'}>{rep?.verdict || (eligible ? 'Eligible' : 'Not yet eligible')}</Badge>
        <span className="ml-auto font-mono text-[11px] text-slate-500">criteria-gated · not legal advice</span>
      </div>

      {/* criteria breakdown */}
      <div className="mb-3 space-y-1.5">
        {rep?.criteria && Object.keys(rep.criteria).map((k) => (
          <div key={k} className="flex items-center gap-3 text-[12px]">
            <span className="w-52 shrink-0 text-slate-400">{({ technicalCharacter: 'Technical character', novelty: 'Novelty', inventiveStep: 'Inventive step', industrialApplicability: 'Industrial use', enablement: 'Enablement' })[k]}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/8"><div className={`h-full rounded-full ${rep.criteria[k] >= 55 ? 'bg-aurora-mint' : 'bg-amber-glow'}`} style={{ width: `${rep.criteria[k]}%` }} /></div>
            <span className="w-10 text-right font-mono text-slate-300">{rep.criteria[k]}</span>
          </div>
        ))}
      </div>

      {/* attestations that drive novelty scoring */}
      <div className="mb-3 space-y-1.5 rounded-xl border border-white/8 bg-white/[0.02] p-3">
        <p className="text-[12px] font-medium text-slate-300">Confirm to score novelty accurately:</p>
        <Check2 label="I completed a prior-art search (patent DBs + products/papers)." checked={attest.priorArtSearched} onChange={(v) => setAttest((a) => ({ ...a, priorArtSearched: v }))} />
        <Check2 label="I found no close prior art covering my specific mechanism." checked={attest.noCloseArtFound} onChange={(v) => setAttest((a) => ({ ...a, noCloseArtFound: v }))} />
        <Check2 label="I have NOT publicly disclosed the invention yet (no public repo/demo/post)." checked={!attest.publiclyDisclosed} onChange={(v) => setAttest((a) => ({ ...a, publiclyDisclosed: !v }))} />
        <Button size="sm" variant="soft" className="mt-1" onClick={onReassess}><RefreshCw size={13} /> Re-assess with these</Button>
      </div>

      {!eligible ? (
        <div className="rounded-xl border border-amber-glow/25 bg-amber-glow/8 p-3">
          <p className="text-[13px] font-medium text-amber-100">Not eligible to register yet.</p>
          <List items={[...(gate.reasonsBlocking || []), ...(gate.nextActions || [])]} tone="amber" />
        </div>
      ) : (
        <div className="space-y-3">
          {!dossier?.stageId ? (
            <Button size="sm" onClick={start}><BadgeCheck size={14} /> Start patent registration</Button>
          ) : (
            <>
              <div>
                <p className="mb-1.5 text-[12px] font-medium text-slate-300">Filing pipeline</p>
                <PatentPipeline stageId={dossier.stageId} onSet={setStage} />
              </div>

              <Accordion title="1 · Prior-art search plan" icon={Scale} defaultOpen>
                <p className="mb-1 text-slate-400">Classification hint: <span className="text-slate-200">{d?.priorArt?.classification}</span></p>
                <p className="mb-1 text-slate-400">Search queries:</p>
                <List items={d?.priorArt?.queries} />
                <p className="mb-1 mt-2 text-slate-400">Databases:</p>
                <ul className="space-y-1">
                  {(d?.priorArt?.databases || []).map((db) => (
                    <li key={db.name} className="text-[13px]"><a href={db.url} target="_blank" rel="noreferrer" className="text-aurora-cyan hover:underline">{db.name}</a> <span className="text-slate-500">— {db.note}</span></li>
                  ))}
                </ul>
                <Button size="sm" variant="soft" className="mt-2" onClick={savePriorArt}><Check size={13} /> Mark prior-art done & re-score</Button>
              </Accordion>

              <Accordion title="2 · Invention disclosure" icon={Lightbulb}>
                <p className="mb-1 text-slate-400">Field:</p><p className="mb-2">{d?.disclosure?.fieldOfInvention}</p>
                <p className="mb-1 text-slate-400">Summary of invention:</p><p className="mb-2">{d?.disclosure?.summaryOfInvention}</p>
                <p className="mb-1 text-slate-400">Technical advantages:</p><List items={d?.disclosure?.advantages} tone="mint" />
              </Accordion>

              <Accordion title="3 · Provisional specification + claims" icon={FileText}>
                <p className="mb-1 text-slate-400">Spec outline:</p><List items={d?.provisionalSpecOutline} />
                <p className="mb-1 mt-2 text-slate-400">Independent claim (skeleton):</p>
                <pre className="whitespace-pre-wrap rounded-lg border border-white/8 bg-ink-950/60 p-2.5 text-[12px] text-slate-200">{d?.claims?.independent}</pre>
                <p className="mb-1 mt-2 text-slate-400">Dependent claims:</p><List items={d?.claims?.dependents} />
                <p className="mt-2 text-[12px] text-amber-100/80">{d?.claims?.note}</p>
                <p className="mb-1 mt-2 text-slate-400">Drawings checklist:</p><List items={d?.drawings} />
                <p className="mb-1 mt-2 text-slate-400">Abstract (draft):</p><p className="text-[13px]">{d?.abstract}</p>
              </Accordion>

              <Accordion title="4 · Filing route & jurisdiction" icon={Globe}>
                <p className="mb-1 text-slate-400">Routes:</p>
                <List items={(d?.filing?.routes || []).map((r) => `${r.name} — ${r.when} (${r.note})`)} />
                <p className="mb-1 mt-2 text-slate-400">Jurisdictions:</p>
                {(d?.filing?.jurisdictions || []).map((j) => (
                  <div key={j.id} className="mb-2 rounded-lg border border-white/8 bg-white/[0.02] p-2.5 text-[12px]">
                    <p className="font-medium text-white">{j.name}</p>
                    <p className="text-slate-400">Forms: {j.forms.join(', ')}</p>
                    <p className="text-slate-500">{j.timeline} · {j.feeNote}</p>
                  </div>
                ))}
                <p className="mt-1 text-[12px] text-amber-100/80">{d?.filing?.costDisclaimer}</p>
              </Accordion>

              <Accordion title="5 · Record your filing" icon={BadgeCheck}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Route"><select value={route} onChange={(e) => setRoute(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-ink-950 px-3 text-sm text-slate-100">{(d?.filing?.routes || []).map((r) => <option key={r.id}>{r.name}</option>)}</select></Field>
                  <Field label="Jurisdiction"><select value={jur} onChange={(e) => setJur(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-ink-950 px-3 text-sm text-slate-100">{(d?.filing?.jurisdictions || []).map((j) => <option key={j.id}>{j.name}</option>)}</select></Field>
                </div>
                <Field label="Application / priority number"><Input value={appNo} onChange={(e) => setAppNo(e.target.value)} placeholder="e.g. 2026XXXXXXXX" /></Field>
                <Button size="sm" className="mt-1" onClick={saveFiling}><Check size={14} /> Save filing & mark as Filed</Button>
                {dossier?.filing?.applicationNumber && <p className="mt-2 text-[12px] text-aurora-mint">Recorded: {dossier.filing.applicationNumber} · {dossier.filing.jurisdiction}</p>}
              </Accordion>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function IpModal({ open, onClose, project, isPremium }) {
  const [loading, setLoading] = useState(false);
  const [rep, setRep] = useState(project?.creator?.ipReadiness || project?.creator?.patent || null);
  const [attest, setAttest] = useState({ priorArtSearched: false, noCloseArtFound: false, publiclyDisclosed: false });
  useEffect(() => { setRep(project?.creator?.ipReadiness || project?.creator?.patent || null); }, [project?.id, open]);

  const run = async () => {
    setLoading(true);
    try { const { report } = await buildIpReadiness(project, attest); persistProjectStep(project.id, { ipReadiness: report }); setRep(report); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="IP / Patent Readiness Studio" width="max-w-2xl">
      <div className="rounded-xl border border-amber-glow/25 bg-amber-glow/8 px-3 py-2.5 text-[12px] leading-relaxed text-amber-100">{IP_DISCLAIMER}</div>
      {!isPremium ? (
        <div className="mt-4"><EmptyState icon={Lock} title="Premium feature" hint="IP readiness analysis and draft preparation are available on the Premium plan." action={<Button size="sm" onClick={() => { promptUpgrade('IP Readiness Studio is a Premium feature.', 'premium'); onClose(); }}>Upgrade to Premium</Button>} /></div>
      ) : loading ? <Loading msg="Assessing patentability…" /> : !rep ? (
        <div className="mt-4"><Button onClick={run}><Wand2 size={15} /> Assess patentability</Button></div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-4">
            <ScoreRing score={rep.patentReadinessScore} label="IP score" size={64} />
            <div><p className="text-sm font-medium text-white">{rep.patentReadinessScore}/100</p><Badge tone={rep.classification === 'Patent Review Recommended' ? 'amber' : 'violet'}>{rep.classification}</Badge></div>
          </div>
          <Accordion title="Invention summary & problem" icon={Lightbulb} defaultOpen><p className="mb-2">{rep.inventionSummary}</p><p className="mb-1 text-slate-400">Technical problem:</p><p className="mb-2">{rep.technicalProblem}</p><p className="mb-1 text-slate-400">Technical solution:</p><p>{rep.technicalSolution}</p></Accordion>
          <Accordion title="Novelty & inventive step" icon={Sparkles}><p className="mb-1 text-slate-400">Novelty points:</p><List items={rep.noveltyPoints} /><p className="mt-2"><span className="text-slate-400">Inventive step: </span>{rep.inventiveStepHypothesis}</p><p className="mt-1"><span className="text-slate-400">Industrial use: </span>{rep.industrialUse}</p></Accordion>
          <Accordion title="Prior-art research" icon={Scale}><p className="mb-1 text-slate-400">Keywords:</p><div className="flex flex-wrap gap-1.5">{(rep.priorArtKeywords || []).map((k, i) => <Badge key={i} tone="cyan">{k}</Badge>)}</div><p className="mb-1 mt-2 text-slate-400">Comparables to research:</p><List items={rep.comparableSolutions} /></Accordion>
          <Accordion title="Risks & warnings" icon={AlertTriangle}><List items={rep.risks} tone="amber" /></Accordion>

          {/* criteria-gated, end-to-end patent registration workflow */}
          <PatentRegistration project={project} rep={rep} attest={attest} setAttest={setAttest} onReassess={run} />

          <Button variant="soft" size="sm" onClick={run}><RefreshCw size={13} /> Re-assess</Button>
        </div>
      )}
    </Modal>
  );
}

/* =================================================================== */
/* STEP 6 — Publish + Collaboration                                    */
/* =================================================================== */
function PublishStep({ selected, isPaid, go }) {
  const [collabOpen, setCollabOpen] = useState(false);
  const [published, setPublished] = useState(!!selected?.published);
  useEffect(() => { setPublished(!!selected?.published); }, [selected?.id]);
  if (!selected) return <NeedProject />;
  const st = creatorStatus(selected);
  const canPublish = st.rank >= 2; // Completed or higher

  const togglePublish = () => {
    if (!canPublish) return;
    const next = saveProject({ ...selected, published: !selected.published });
    setPublished(!!next.published);
  };

  return (
    <div className="space-y-4">
      <SectionCard title="Publish to Sandbox marketplace" action={<StatusBadge status={st.status} />}>
        {!canPublish ? (
          <div className="rounded-xl border border-amber-glow/25 bg-amber-glow/8 p-3">
            <p className="text-[13px] font-medium text-amber-100">Not ready to publish yet — reach “Completed”.</p>
            <List items={st.reasons} tone="amber" />
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">{published ? 'Published to the Sandbox marketplace.' : 'Ready to publish.'}</p>
              <p className="text-[13px] text-slate-400">Published projects appear in the recruiter console and your Career Proof Profile.</p>
            </div>
            <Button onClick={togglePublish} variant={published ? 'soft' : 'primary'}>{published ? 'Unpublish' : <><Rocket size={15} /> Publish</>}</Button>
          </div>
        )}
      </SectionCard>

      {/* Part 9 — collaboration draft banner */}
      <div className="rounded-2xl border border-aurora-violet/30 bg-aurora-violet/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-aurora-violet/20 text-aurora-cyan"><Users size={18} /></span>
            <div>
              <p className="text-sm font-medium text-white">Want collaborators for this project?</p>
              <p className="text-[13px] text-slate-300">Your collaboration post draft is ready — review it before anything is posted.</p>
            </div>
          </div>
          <Button variant="soft" onClick={() => setCollabOpen(true)}>Review draft</Button>
        </div>
      </div>

      <SectionCard title="Career impact">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard i={0} icon={Award} tone="violet" label="Proof score" value={String(st.proofScore)} />
          <StatCard i={1} icon={BadgeCheck} tone="mint" label="Status" value={st.status} />
          <StatCard i={2} icon={ShieldCheck} tone="cyan" label="Validation" value={st.validationTotal ? String(st.validationTotal) : '—'} />
          <StatCard i={3} icon={Rocket} tone="amber" label="Startup" value={st.startupReady ? 'Ready' : 'In progress'} onClick={() => go && go('careerprofile')} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="soft" onClick={() => go && go('careerprofile')}><BadgeCheck size={14} /> Career Profile</Button>
          <Button size="sm" variant="soft" onClick={() => go && go('sandbox')}><Globe size={14} /> Sandbox</Button>
          <Button size="sm" variant="soft" onClick={() => go && go('recruiter')}><Users size={14} /> Recruiter console</Button>
        </div>
      </SectionCard>

      <CollabModal open={collabOpen} onClose={() => setCollabOpen(false)} project={selected} isPaid={isPaid} go={go} />
    </div>
  );
}

function CollabModal({ open, onClose, project, isPaid, go }) {
  const draft = useMemo(() => buildCollabDraft(project), [project, open]);
  const [posted, setPosted] = useState(false);
  const publish = () => {
    if (!isPaid) { promptUpgrade('Publishing collaboration posts is a Pro feature.', 'pro'); return; }
    publishCollabDraft(draft); setPosted(true);
  };
  return (
    <Modal open={open} onClose={onClose} title="Collaboration post draft" width="max-w-xl">
      <div className="space-y-3 text-[13px] text-slate-300">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <p className="font-medium text-white">{draft.hook}</p>
          <p className="mt-2">{draft.problemStatement}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div><p className="text-slate-400">Skills involved:</p><div className="mt-1 flex flex-wrap gap-1.5">{draft.skillsInvolved.map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div></div>
          <div><p className="text-slate-400">Skills needed:</p><div className="mt-1 flex flex-wrap gap-1.5">{draft.skillsNeeded.length ? draft.skillsNeeded.map((s, i) => <Badge key={i} tone="amber">{s}</Badge>) : <span className="text-slate-500">—</span>}</div></div>
          <div><p className="text-slate-400">Roles needed:</p><p className="text-slate-200">{draft.rolesNeeded.join(', ')}</p></div>
          <div><p className="text-slate-400">Stage:</p><p className="text-slate-200">{draft.projectStage} · {draft.estimatedDuration} · {draft.weeklyTime}</p></div>
        </div>
        <p><span className="text-slate-400">Collaboration mode: </span>{draft.collaborationMode}</p>
        <p><span className="text-slate-400">Collaborators gain: </span>{draft.collaboratorGain}</p>
        {posted ? (
          <div className="rounded-xl border border-aurora-mint/25 bg-aurora-mint/8 p-3 text-aurora-mint">
            Posted to the Find Project Partner board. <button onClick={() => { onClose(); go && go('partners'); }} className="underline">Open board</button>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="soft" size="sm" onClick={onClose}>Not now</Button>
            <Button size="sm" onClick={publish}><Users size={14} /> Publish to partner board</Button>
          </div>
        )}
        {!isPaid && !posted && <p className="text-[12px] text-slate-500">Publishing collaboration posts requires Pro.</p>}
      </div>
    </Modal>
  );
}

/* ----------------------------- shared ----------------------------- */
function NeedProject() {
  return (
    <SectionCard title="Select a project first">
      <EmptyState icon={Compass} title="No project selected" hint="Go to the Discover step, generate recommendations and click “Build this” to start a project — then this step unlocks." />
    </SectionCard>
  );
}
