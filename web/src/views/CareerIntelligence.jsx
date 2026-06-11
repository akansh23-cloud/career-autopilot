/* ============================================================
   Career Intelligence Engine — collective knowledge search.
   One natural-language query → intent detection → auto source
   routing → multi-source evidence → scored ideas → blueprint /
   patent angle / resume value → one-click actions into the
   existing Project OS, Patent OS and Resume OS flows.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BrainCircuit, Search, Sparkles, Rocket, ScrollText, FileText, Save,
  Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Database,
  FlaskConical, TrendingUp, Award, Layers, Target, ShieldCheck, Link2,
  Settings2, PackageOpen,
} from 'lucide-react';
import { Button, Card, Badge, Spinner } from '../components/ui/kit.jsx';
import CareerIntelligence from '../lib/careerIntelligence.js';
import { saveProject as saveClientProject, uid as projUid } from '../lib/projectStore.js';
import { isAdmin } from '../lib/plan.js';

const MODES = [
  { id: 'auto', label: 'Auto' },
  { id: 'project', label: 'Project' },
  { id: 'patent', label: 'Patent' },
  { id: 'resume', label: 'Resume' },
  { id: 'market', label: 'Market' },
  { id: 'career', label: 'Career Roadmap' },
];

const PROGRESS_STEPS = [
  'Understanding request',
  'Selecting sources',
  'Checking public pain points',
  'Finding research papers',
  'Finding datasets',
  'Validating market signals',
  'Generating project / patent / resume outputs',
];

const EXAMPLES = [
  'Create a healthcare AI project that can help my resume and may have patent potential',
  'Build me a DevOps project using real public data',
  'Create a cybersecurity project with real CVE data',
  'Find a SaaS idea for mid-range shop owners',
];

const SOURCE_LABELS = {
  wikipedia: 'Wikipedia', crossref: 'Crossref', openalex: 'OpenAlex', datagov: 'Data.gov',
  census: 'US Census', fda: 'FDA Open Data', nasa: 'NASA', onet: 'O*NET', esco: 'ESCO',
  nvd: 'NVD (CVE)', worldbank: 'World Bank', openmeteo: 'Open-Meteo', openstreetmap: 'OpenStreetMap',
  youtube: 'YouTube', googlemaps: 'Google Maps', github: 'GitHub', stackexchange: 'Stack Exchange',
  arxiv: 'arXiv', hackernews: 'Hacker News', reddit: 'Reddit', devto: 'Dev.to',
  hashnode: 'Hashnode', discourse: 'Discourse', specialized_forum: 'Forums', manual: 'Manual',
};

function srcLabel(s) { return SOURCE_LABELS[s] || s; }

/* Animated progress list shown while the search runs. */
function ProgressPanel({ step }) {
  return (
    <Card className="space-y-2.5">
      {PROGRESS_STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2.5 text-sm">
          {i < step ? <CheckCircle2 size={15} className="text-aurora-mint" />
            : i === step ? <Loader2 size={15} className="animate-spin text-aurora-violet" />
              : <span className="inline-block h-[15px] w-[15px] rounded-full border border-white/15" />}
          <span className={i <= step ? 'text-slate-200' : 'text-slate-500'}>{label}</span>
        </div>
      ))}
    </Card>
  );
}

function ScoreBar({ label, value, reason }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = v >= 70 ? 'bg-aurora-mint' : v >= 45 ? 'bg-aurora-cyan' : 'bg-amber-glow';
  return (
    <div title={reason || ''}>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-slate-400">{label}</span>
        <span className="font-semibold text-slate-200">{v}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/8">
        <div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function EvidenceItem({ e }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium text-slate-100">{e.title}</div>
          {e.summary && <div className="mt-1 line-clamp-2 text-[12.5px] text-slate-400">{e.summary}</div>}
        </div>
        <Badge tone="cyan" className="shrink-0">{srcLabel(e.source)}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-slate-500">
        <span>relevance {e.relevanceScore}</span>
        <span>trust {e.trustScore}</span>
        {e.url && (
          <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-aurora-cyan hover:underline">
            <Link2 size={11} /> source
          </a>
        )}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, count, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <div className="flex items-center gap-2.5">
          <Icon size={17} className="text-aurora-violet" />
          <span className="text-[15px] font-semibold text-slate-100">{title}</span>
          {count != null && <Badge>{count}</Badge>}
        </div>
        {open ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
      </button>
      {open && <div className="mt-4">{children}</div>}
    </Card>
  );
}

/* Admin-only source status panel. Booleans only — never keys. */
function SourcesPanel({ sources, meta, lastRun }) {
  const lastBySource = useMemo(() => {
    const m = {};
    for (const c of lastRun || []) m[c.source] = c;
    return m;
  }, [lastRun]);
  return (
    <Section icon={ShieldCheck} title="Intelligence Sources" count={sources.length} defaultOpen={false}>
      <div className="mb-3 flex flex-wrap gap-2 text-[12px] text-slate-400">
        <Badge tone={meta.networkAllowed ? 'mint' : 'amber'}>{meta.networkAllowed ? 'network on' : 'network off'}</Badge>
        <Badge>max {meta.maxSourcesPerQuery} sources / query</Badge>
        <Badge>cache {Math.round((meta.cacheTtlMinutes || 1440) / 60)}h</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {sources.map((s) => {
          const last = lastBySource[s.name];
          return (
            <div key={s.name} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-slate-100">{srcLabel(s.name)}</div>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  <Badge tone={s.enabled ? 'mint' : 'rose'}>{s.enabled ? 'enabled' : 'disabled'}</Badge>
                  {s.keyRequired && <Badge tone={s.keyConfigured ? 'cyan' : 'amber'}>{s.keyConfigured ? 'key configured' : 'key missing'}</Badge>}
                  <Badge tone={s.quotaRisk === 'high' ? 'rose' : s.quotaRisk === 'medium' ? 'amber' : 'default'}>quota: {s.quotaRisk}</Badge>
                </div>
              </div>
              {last && (
                <Badge tone={last.skipped ? 'default' : last.ok ? 'mint' : 'rose'}>
                  {last.skipped ? 'skipped' : last.ok ? `${last.items ?? 0} ok${last.cached ? ' · cached' : ''}` : 'failed'}
                </Badge>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

export default function CareerIntelligenceView({ go }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('auto');
  const [advanced, setAdvanced] = useState(false);
  const [picked, setPicked] = useState([]); // advanced source selection
  const [sources, setSources] = useState([]);
  const [meta, setMeta] = useState({});
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [resumeOut, setResumeOut] = useState(null);
  const stepTimer = useRef(null);
  const admin = isAdmin();

  useEffect(() => {
    CareerIntelligence.sources()
      .then((d) => { setSources(d.sources || []); setMeta(d); })
      .catch(() => {});
    return () => clearInterval(stepTimer.current);
  }, []);

  const idea = result?.bestIdea || null;
  const actionPayload = () => ({
    idea: idea || {},
    blueprint: result?.projectBlueprint || {},
    patentAngle: result?.patentAngle || {},
    resumeValue: result?.resumeValue || null,
    skillXpMapping: result?.skillXpMapping || null,
    understanding: result?.queryUnderstanding || {},
  });

  const run = async () => {
    const q = query.trim();
    if (q.length < 3 || busy) return;
    setBusy(true); setError(''); setResult(null); setResumeOut(null); setActionMsg(''); setStep(0);
    stepTimer.current = setInterval(() => setStep((s) => Math.min(s + 1, PROGRESS_STEPS.length - 1)), 850);
    try {
      const d = await CareerIntelligence.search({
        query: q, mode,
        selectedSources: advanced ? picked : [],
        createAssets: true,
      });
      if (!d.ok) throw new Error(d.message || 'Search failed');
      setResult(d);
    } catch (e) {
      setError(e?.message || 'Search failed. Please try again.');
    } finally {
      clearInterval(stepTimer.current);
      setBusy(false);
    }
  };

  const doCreateProject = async () => {
    setActionBusy('project'); setActionMsg('');
    try {
      const d = await CareerIntelligence.createProject(actionPayload());
      const clientId = projUid('proj');
      const p = d.projectPayload || d.project || {};
      // Persist through the EXISTING client project store (localStorage + /api/user/state).
      saveClientProject({ ...p, id: clientId, name: p.title, workspacePlan: d.workspacePlan || p.workspacePlan, createdAt: Date.now() });
      setActionMsg('Project workspace created. Opening Project Studio…');
      setTimeout(() => go?.('projectstudio'), 900);
    } catch (e) { setActionMsg(e?.message || 'Create project failed.'); } finally { setActionBusy(''); }
  };

  const doSendToPatent = async () => {
    setActionBusy('patent'); setActionMsg('');
    try {
      const d = await CareerIntelligence.sendToPatent(actionPayload());
      setActionMsg(d.patentIdeaId ? 'Created in Patent OS. Opening…' : (d.note || 'Patent payload ready.'));
      if (d.patentIdeaId) setTimeout(() => go?.('patentportfolio'), 900);
    } catch (e) { setActionMsg(e?.message || 'Send to Patent OS failed.'); } finally { setActionBusy(''); }
  };

  const doResume = async () => {
    setActionBusy('resume'); setActionMsg('');
    try {
      const d = await CareerIntelligence.resumeOutput(actionPayload());
      setResumeOut(d);
      setActionMsg('Resume assets generated below.');
    } catch (e) { setActionMsg(e?.message || 'Resume output failed.'); } finally { setActionBusy(''); }
  };

  const doSaveMemory = async () => {
    setActionBusy('memory'); setActionMsg('');
    try {
      const d = await CareerIntelligence.saveMemory({
        query, idea: idea || {},
        evidence: (result?.evidence || []).slice(0, 30),
        marketSignals: result?.marketSignals || [],
        understanding: result?.queryUnderstanding || {},
      });
      setActionMsg(d.note || 'Saved to Innovation Memory.');
    } catch (e) { setActionMsg(e?.message || 'Save failed.'); } finally { setActionBusy(''); }
  };

  const doStarterPack = async () => {
    // Starter pack is generated from the created workspace — same flow.
    setActionMsg('Starter pack: create the Project Workspace first — the guided workspace includes the GitHub starter structure and tasks.');
    await doCreateProject();
  };

  const u = result?.queryUnderstanding;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* ---- Hero / search ---- */}
      <Card glow className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-aurora-violet/15 p-2.5"><BrainCircuit size={22} className="text-aurora-violet" /></div>
          <div>
            <h1 className="text-xl font-bold text-white">Career Intelligence Engine</h1>
            <p className="text-[13px] text-slate-400">Collective knowledge search across research, datasets, government data, security feeds and developer communities — turned into projects, patents and resume proof.</p>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
              placeholder="Ask Career Autopilot anything…"
              className="h-12 w-full rounded-xl border border-white/12 bg-white/[0.04] pl-10 pr-4 text-[14.5px] text-slate-100 placeholder:text-slate-500 focus:border-aurora-violet/50 focus:outline-none"
            />
          </div>
          <Button size="lg" onClick={run} disabled={busy || query.trim().length < 3}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Search
          </Button>
        </div>

        {/* Mode selector */}
        <div className="flex flex-wrap items-center gap-2">
          {MODES.map((m) => (
            <button
              key={m.id} type="button" onClick={() => setMode(m.id)}
              className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${mode === m.id ? 'border-aurora-violet/60 bg-aurora-violet/15 text-white' : 'border-white/10 text-slate-400 hover:border-white/25 hover:text-slate-200'}`}
            >
              {m.label}
            </button>
          ))}
          <button type="button" onClick={() => setAdvanced((a) => !a)} className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-slate-400 hover:text-slate-200">
            <Settings2 size={13} /> Advanced sources {advanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>

        {/* Advanced source chips (optional — Auto is the default) */}
        {advanced && (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <div className="mb-2 text-[12px] text-slate-500">Leave empty for Auto Source Mode. Pick sources to restrict the search. Disabled sources are skipped automatically.</div>
            <div className="flex flex-wrap gap-1.5">
              {sources.map((s) => {
                const on = picked.includes(s.name);
                const dead = !s.runnable;
                return (
                  <button
                    key={s.name} type="button" disabled={dead}
                    onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.name) : [...p, s.name]))}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${dead ? 'cursor-not-allowed border-white/6 text-slate-600' : on ? 'border-aurora-cyan/55 bg-aurora-cyan/12 text-white' : 'border-white/10 text-slate-400 hover:border-white/25'}`}
                    title={dead ? 'Disabled (flag off, key missing or offline)' : ''}
                  >
                    {srcLabel(s.name)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Example queries */}
        {!result && !busy && (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setQuery(ex)} className="rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-left text-[12px] text-slate-400 hover:border-aurora-violet/35 hover:text-slate-200">
                {ex}
              </button>
            ))}
          </div>
        )}
      </Card>

      {busy && <ProgressPanel step={step} />}
      {error && (
        <Card className="flex items-center gap-2.5 border-rose-400/30">
          <AlertTriangle size={16} className="text-rose-300" />
          <span className="text-sm text-rose-200">{error}</span>
        </Card>
      )}

      {result && !busy && (
        <>
          {/* ---- Query Understanding ---- */}
          <Section icon={Target} title="Query Understanding">
            <div className="flex flex-wrap gap-2">
              <Badge tone="violet">intent: {u?.primaryIntent?.replace(/_/g, ' ')}</Badge>
              {u?.domain && <Badge tone="cyan">domain: {u.domain}</Badge>}
              {u?.targetRole && <Badge>role: {u.targetRole}</Badge>}
              {u?.targetUser && <Badge>for: {u.targetUser}</Badge>}
              {u?.difficulty && <Badge>level: {u.difficulty}</Badge>}
              {u?.country && <Badge>market: {u.country}</Badge>}
              <Badge tone="mint">confidence: {u?.confidence}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(result.sourcesChecked || []).map((c) => (
                <Badge key={c.source} tone={c.skipped ? 'default' : c.ok ? 'mint' : 'rose'}>
                  {srcLabel(c.source)}{c.skipped ? ' · skipped' : c.ok ? ` · ${c.items ?? 0}` : ' · failed'}
                </Badge>
              ))}
            </div>
          </Section>

          {/* ---- Evidence ---- */}
          {result.evidence?.length > 0 && (
            <Section icon={Layers} title="Evidence from Sources" count={result.evidence.length} defaultOpen={false}>
              <div className="grid gap-2 sm:grid-cols-2">
                {result.evidence.slice(0, 12).map((e) => <EvidenceItem key={e.id} e={e} />)}
              </div>
            </Section>
          )}

          {result.painPoints?.length > 0 && (
            <Section icon={AlertTriangle} title="Top Pain Points" count={result.painPoints.length} defaultOpen={false}>
              <div className="grid gap-2 sm:grid-cols-2">{result.painPoints.map((e) => <EvidenceItem key={e.id} e={e} />)}</div>
            </Section>
          )}

          {result.research?.length > 0 && (
            <Section icon={FlaskConical} title="Research / Prior Art Signals" count={result.research.length} defaultOpen={false}>
              <div className="grid gap-2 sm:grid-cols-2">{result.research.map((e) => <EvidenceItem key={e.id} e={e} />)}</div>
            </Section>
          )}

          {result.datasets?.length > 0 && (
            <Section icon={Database} title="Dataset Options" count={result.datasets.length} defaultOpen={false}>
              <div className="grid gap-2 sm:grid-cols-2">{result.datasets.map((e) => <EvidenceItem key={e.id} e={e} />)}</div>
            </Section>
          )}

          {result.marketSignals?.length > 0 && (
            <Section icon={TrendingUp} title="Market Signals" count={result.marketSignals.length} defaultOpen={false}>
              <div className="grid gap-2 sm:grid-cols-2">{result.marketSignals.map((e) => <EvidenceItem key={e.id} e={e} />)}</div>
            </Section>
          )}

          {/* ---- Recommended ideas ---- */}
          {result.recommendedIdeas?.length > 0 && (
            <Section icon={Sparkles} title="Recommended Ideas" count={result.recommendedIdeas.length}>
              <div className="space-y-3">
                {result.recommendedIdeas.map((i, idx) => (
                  <div key={i.id || idx} className={`rounded-xl border p-4 ${idx === 0 ? 'border-aurora-violet/40 bg-aurora-violet/[0.06]' : 'border-white/8 bg-white/[0.02]'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[14.5px] font-semibold text-slate-100">{i.title}</div>
                        <div className="mt-1 text-[13px] text-slate-400">{i.problemStatement}</div>
                      </div>
                      <Badge tone={idx === 0 ? 'violet' : 'default'}>{i.overallScore}/100{idx === 0 ? ' · best' : ''}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ---- Best opportunity (scores) ---- */}
          {idea && (
            <Section icon={Award} title="Best Opportunity">
              <div className="mb-3 text-[14px] font-semibold text-slate-100">{idea.title}</div>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                {Object.entries(idea.scores || {}).map(([k, v]) => (
                  <ScoreBar key={k} label={k.replace(/Score$/, '').replace(/([A-Z])/g, ' $1').trim()} value={v} reason={(idea.scoreReasons || {})[k]} />
                ))}
              </div>
            </Section>
          )}

          {/* ---- Project blueprint ---- */}
          {result.projectBlueprint && (
            <Section icon={Rocket} title="Project Blueprint">
              <div className="space-y-3 text-[13.5px] text-slate-300">
                <div><span className="text-slate-500">Target users:</span> {result.projectBlueprint.targetUsers}</div>
                <div><span className="text-slate-500">Architecture:</span> {result.projectBlueprint.architecture}</div>
                <div className="flex flex-wrap gap-1.5">{(result.projectBlueprint.techStack || []).map((t) => <Badge key={t} tone="cyan">{t}</Badge>)}</div>
                <div>
                  <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">MVP scope</div>
                  <ul className="list-disc space-y-1 pl-5">{(result.projectBlueprint.mvpScope || []).map((m) => <li key={m}>{m}</li>)}</ul>
                </div>
                {result.projectBlueprint.apisAndDataSources?.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">APIs / data sources</div>
                    <ul className="space-y-1">
                      {result.projectBlueprint.apisAndDataSources.map((d, i) => (
                        <li key={i} className="flex items-center gap-1.5">
                          <Database size={12} className="text-slate-500" />
                          {d.url ? <a className="text-aurora-cyan hover:underline" href={d.url} target="_blank" rel="noreferrer">{d.title}</a> : d.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* ---- Patent angle ---- */}
          {result.patentAngle && (
            <Section icon={ScrollText} title="Patent Angle" defaultOpen={false}>
              <div className="space-y-2.5 text-[13.5px] text-slate-300">
                <div><span className="text-slate-500">Problem:</span> {result.patentAngle.problem}</div>
                <div><span className="text-slate-500">Existing limitations:</span> {result.patentAngle.existingLimitations}</div>
                <div><span className="text-slate-500">Novelty angle:</span> {result.patentAngle.noveltyAngle}</div>
                {result.patentAngle.possibleClaimsOutline?.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Possible claims outline</div>
                    <ul className="list-disc space-y-1 pl-5">{result.patentAngle.possibleClaimsOutline.map((c) => <li key={c}>{c}</li>)}</ul>
                  </div>
                )}
                <div className="rounded-lg border border-amber-glow/25 bg-amber-glow/[0.06] p-2.5 text-[12.5px] text-amber-100/90">
                  {(Array.isArray(result.patentAngle.riskAndLimitations) ? result.patentAngle.riskAndLimitations.join(' ') : result.patentAngle.risk) || 'Early-stage research assistance only — not legal advice.'}
                </div>
              </div>
            </Section>
          )}

          {/* ---- Resume value ---- */}
          {result.resumeValue && (
            <Section icon={FileText} title="Resume Value" defaultOpen={false}>
              <div className="space-y-2.5 text-[13.5px] text-slate-300">
                <div>
                  <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Draft bullets (verify to upgrade)</div>
                  <ul className="list-disc space-y-1 pl-5">{(result.resumeValue.draftResumeBullets || result.resumeValue.draftBullets || []).map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
                {result.resumeValue.atsKeywords?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">{result.resumeValue.atsKeywords.map((k) => <Badge key={k}>{k}</Badge>)}</div>
                )}
                {result.resumeValue.note && <div className="text-[12.5px] text-slate-500">{result.resumeValue.note}</div>}
              </div>
            </Section>
          )}

          {/* ---- Skill XP mapping ---- */}
          {result.skillXpMapping && (
            <Section icon={Award} title="Skill XP Mapping" defaultOpen={false}>
              <div className="flex flex-wrap gap-1.5">
                {(result.skillXpMapping.suggestedSkills || result.skillXpMapping.skills || []).map((s) => (
                  <Badge key={s.skill || s} tone="mint">{(s.skill || s)}{s.suggestedXp ? ` · +${s.suggestedXp} XP (suggested)` : ''}</Badge>
                ))}
              </div>
              <div className="mt-2 text-[12.5px] text-slate-500">{result.skillXpMapping.note || 'Suggested only — verified XP is granted through the project verification flow.'}</div>
            </Section>
          )}

          {/* ---- Actions ---- */}
          {idea && (
            <Card glow className="space-y-3">
              <div className="text-[14px] font-semibold text-slate-100">Turn this into real career assets</div>
              <div className="flex flex-wrap gap-2.5">
                <Button onClick={doCreateProject} disabled={!!actionBusy}>{actionBusy === 'project' ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />} Create Project Workspace</Button>
                <Button variant="outline" onClick={doSendToPatent} disabled={!!actionBusy}>{actionBusy === 'patent' ? <Loader2 size={15} className="animate-spin" /> : <ScrollText size={15} />} Send to Patent OS</Button>
                <Button variant="outline" onClick={doResume} disabled={!!actionBusy}>{actionBusy === 'resume' ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} Generate Resume Bullet</Button>
                <Button variant="soft" onClick={doStarterPack} disabled={!!actionBusy}><PackageOpen size={15} /> Generate Starter Pack</Button>
                <Button variant="soft" onClick={doSaveMemory} disabled={!!actionBusy}>{actionBusy === 'memory' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save to Innovation Memory</Button>
              </div>
              {actionMsg && <div className="inline-flex items-center gap-1.5 text-[13px] text-aurora-mint"><CheckCircle2 size={14} /> {actionMsg}</div>}
            </Card>
          )}

          {/* ---- Generated resume assets (after action) ---- */}
          {resumeOut?.resumeOutput && (
            <Section icon={FileText} title="Generated Resume Assets">
              <div className="space-y-3 text-[13.5px] text-slate-300">
                <div>
                  <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Resume bullets (draft)</div>
                  <ul className="list-disc space-y-1 pl-5">{(resumeOut.resumeOutput.draftResumeBullets || resumeOut.resumeOutput.resumeBullets || []).map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
                {resumeOut.resumeOutput.interviewTalkingPoints?.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Interview talking points</div>
                    <ul className="list-disc space-y-1 pl-5">{resumeOut.resumeOutput.interviewTalkingPoints.map((b) => <li key={b}>{b}</li>)}</ul>
                  </div>
                )}
                {resumeOut.resumeOutput.linkedinPost && (
                  <div>
                    <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">LinkedIn post</div>
                    <div className="whitespace-pre-wrap rounded-xl border border-white/8 bg-white/[0.02] p-3 text-[13px]">{resumeOut.resumeOutput.linkedinPost}</div>
                  </div>
                )}
                <div className="text-[12.5px] text-slate-500">{resumeOut.xpNote}</div>
              </div>
            </Section>
          )}

          {/* ---- Limitations ---- */}
          {result.limitations?.length > 0 && (
            <Card className="space-y-1.5">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Limitations & disclosures</div>
              {result.limitations.map((l) => <div key={l} className="text-[12.5px] text-slate-500">• {l}</div>)}
            </Card>
          )}
        </>
      )}

      {/* ---- Admin-only source status panel ---- */}
      {admin && sources.length > 0 && (
        <SourcesPanel sources={sources} meta={meta} lastRun={result?.sourcesChecked} />
      )}

      {!sources.length && !busy && !result && (
        <div className="flex items-center gap-2 text-[12.5px] text-slate-500"><Spinner /> Loading source status…</div>
      )}
    </div>
  );
}
