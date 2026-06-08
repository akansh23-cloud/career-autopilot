import { useEffect, useState } from 'react';
import {
  Loader2, ArrowLeft, TrendingUp, Search, FileText, Rocket, ShieldAlert, History, MessageSquarePlus,
  ChevronDown, Plus, Trash2, ExternalLink, Sparkles,
} from 'lucide-react';
import { SectionCard } from '../common.jsx';
import { Button, Badge, Field, Input, EmptyState } from '../../components/ui/kit.jsx';
import { PatentOS } from '../../lib/api.js';
import { STATUS_LABELS, STATUS_ORDER, LOCKED_STATUSES, FEEDBACK_TYPES, ScorePill, riskTone, gradeTone, Disclaimer } from './shared.jsx';

const TABS = [
  ['overview', 'Overview'], ['problem', 'Problem'], ['invention', 'Invention'], ['score', 'Score'],
  ['risks', 'Risks'], ['strengthen', 'Strengthen'], ['priorart', 'Prior-Art'], ['disclosure', 'Disclosure'],
  ['poc', 'POC'], ['versions', 'Versions'], ['feedback', 'Feedback'],
];
const FACTOR_LABELS = { novelty: 'Novelty', technicalDepth: 'Technical depth', specificity: 'Specificity', priorArtDistance: 'Prior-art distance', marketUtility: 'Market utility', feasibility: 'Feasibility', enforceability: 'Enforceability' };

function Bar({ label, value }) {
  const tone = value >= 75 ? '#46E6A6' : value >= 50 ? '#37D6C4' : '#FFC85A';
  return (
    <div><div className="mb-1 flex justify-between text-[12px]"><span className="text-slate-300">{label}</span><span className="tabular-nums text-slate-400">{value}</span></div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full" style={{ width: `${value}%`, background: tone }} /></div></div>
  );
}
function Detail({ label, value }) {
  if (!value) return null;
  return <div><div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div><p className="mt-0.5 whitespace-pre-wrap text-[13px] text-slate-300">{value}</p></div>;
}

export default function PatentIdeaWorkspace({ ideaId, go }) {
  const [idea, setIdea] = useState(null);
  const [priorArt, setPriorArt] = useState([]);
  const [disclosure, setDisclosure] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [strengthenResult, setStrengthenResult] = useState(null);
  const [paForm, setPaForm] = useState({ source: '', title: '', link: '', summary: '', overlap: '', differences: '', riskLevel: 'Medium', notes: '' });

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2200); };
  const load = async () => {
    setLoading(true);
    try { const d = await PatentOS.idea(ideaId); setIdea(d.idea); setPriorArt(d.priorArt || []); setDisclosure(d.disclosure || null); }
    catch { setIdea(null); } finally { setLoading(false); }
  };
  useEffect(() => { if (ideaId) load(); /* eslint-disable-next-line */ }, [ideaId]);

  const setStatus = async (status) => { try { const r = await PatentOS.patch(ideaId, { status }); if (r.idea) setIdea(r.idea); flash('Status updated'); } catch { flash('Update failed'); } };
  const doStrengthen = async () => { setBusy('strengthen'); try { const r = await PatentOS.strengthen(ideaId); if (r.idea) setIdea(r.idea); setStrengthenResult(r.result); flash('Idea strengthened'); } catch { flash('Failed'); } finally { setBusy(''); } };
  const doPriorArtPlan = async () => { setBusy('plan'); try { const r = await PatentOS.priorArtPlan(ideaId); setIdea((p) => ({ ...p, priorArtSearchPlan: r.plan })); flash('Prior-art plan generated'); } catch { flash('Failed'); } finally { setBusy(''); } };
  const doDisclosure = async () => { setBusy('disclosure'); try { const r = await PatentOS.disclosure(ideaId); setDisclosure({ payload: r.disclosure, version: r.version }); flash(`Disclosure v${r.version} generated`); } catch { flash('Failed'); } finally { setBusy(''); } };
  const doConvert = async () => { setBusy('convert'); try { const r = await PatentOS.convert(ideaId); setIdea((p) => ({ ...p, linkedProjectPlan: r.plan })); flash('Project plan created'); } catch { flash('Failed'); } finally { setBusy(''); } };
  const addPriorArt = async () => { if (!paForm.source && !paForm.title) { flash('Add a source or title'); return; } try { const r = await PatentOS.addPriorArt(ideaId, paForm); if (r.record) setPriorArt((p) => [r.record, ...p]); setPaForm({ source: '', title: '', link: '', summary: '', overlap: '', differences: '', riskLevel: 'Medium', notes: '' }); flash('Prior-art saved'); } catch { flash('Failed'); } };
  const delPriorArt = async (rid) => { try { await PatentOS.removePriorArt(rid); setPriorArt((p) => p.filter((r) => r.id !== rid)); } catch { flash('Failed'); } };
  const sendFeedback = async (feedbackType) => { try { await PatentOS.feedback(ideaId, { feedbackType }); flash(`Feedback: ${feedbackType}`); } catch { flash('Failed'); } };

  if (loading) return <SectionCard><div className="flex items-center gap-2 py-8 text-slate-400"><Loader2 size={16} className="animate-spin" /> Loading idea…</div></SectionCard>;
  if (!idea) return <EmptyState icon={ShieldAlert} title="Idea not found" hint="It may have been deleted or belongs to another account." action={<Button size="sm" onClick={() => go?.('patentportfolio')}>Back to portfolio</Button>} />;

  const score = idea.score || {};
  const plan = idea.priorArtSearchPlan && Object.keys(idea.priorArtSearchPlan).length ? idea.priorArtSearchPlan : null;
  const proj = idea.linkedProjectPlan;

  return (
    <>
      <button onClick={() => go?.('patentportfolio')} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-slate-400 hover:text-white"><ArrowLeft size={15} /> Portfolio</button>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-white">{idea.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {idea.domain && <Badge tone="default">{idea.domain}</Badge>}
            <ScorePill score={score.overall || 0} grade={score.grade} />
            <Badge tone={riskTone(score.riskLevel)}>{score.riskLevel || 'Medium'} risk</Badge>
          </div>
        </div>
        <div className="relative">
          <select value={idea.status} onChange={(e) => setStatus(e.target.value)} className="h-9 cursor-pointer appearance-none rounded-lg border border-white/10 bg-white/[0.03] pl-3 pr-8 text-xs text-slate-100 outline-none">
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        </div>
      </div>

      {toast && <div className="mb-3 rounded-lg border border-aurora-mint/30 bg-aurora-mint/10 px-3 py-2 text-xs text-aurora-mint">{toast}</div>}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${tab === id ? 'border-aurora-violet/60 bg-aurora-violet/10 text-white' : 'border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/25'}`}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <SectionCard>
          <div className="grid gap-3 sm:grid-cols-2">
            <Detail label="Domain" value={idea.domain} /><Detail label="Target user" value={idea.targetUser} />
            <Detail label="Status" value={STATUS_LABELS[idea.status]} /><Detail label="Created" value={idea.createdAt ? new Date(idea.createdAt).toLocaleDateString() : ''} />
          </div>
          <div className="mt-3"><Detail label="Proposed solution" value={idea.proposedSolution} /></div>
          {idea.generationWhy && <p className="mt-3 border-t border-white/8 pt-3 text-[12px] text-slate-500">{idea.generationWhy}</p>}
          <div className="mt-3"><Disclaimer /></div>
        </SectionCard>
      )}
      {tab === 'problem' && <SectionCard><div className="space-y-3"><Detail label="Problem / pain point" value={idea.problem} /><Detail label="Existing solutions" value={idea.existingSolutions} /><Detail label="Why current solutions fall short" value={idea.noveltyAngle} /></div></SectionCard>}
      {tab === 'invention' && <SectionCard><div className="space-y-3"><Detail label="Solution summary" value={idea.proposedSolution} /><Detail label="Technical mechanism" value={idea.technicalMechanism} /><Detail label="Inputs" value={idea.inputData} /><Detail label="Processing logic" value={idea.processingLogic} /><Detail label="Outputs" value={idea.outputResult} /><Detail label="Feedback loop" value={idea.feedbackLoop} /><Detail label="Market use case" value={idea.marketUseCase} /></div></SectionCard>}

      {tab === 'score' && (
        <SectionCard title="Patent-readiness estimate">
          <div className="mb-3 flex items-center gap-2"><Badge tone={gradeTone(score.overall || 0)}>{score.overall || 0}/100</Badge><span className="text-sm text-slate-300">{score.grade}</span></div>
          <div className="space-y-3">{Object.entries(FACTOR_LABELS).map(([k, label]) => <Bar key={k} label={label} value={score[k] ?? 0} />)}</div>
          <Button className="mt-3" size="sm" variant="soft" onClick={async () => { const r = await PatentOS.rescore(ideaId); setIdea((p) => ({ ...p, score: { ...r.score.factors, overall: r.score.overall, grade: r.score.grade, riskLevel: r.score.riskLevel } })); flash('Re-scored'); }}>Re-score</Button>
        </SectionCard>
      )}

      {tab === 'risks' && (
        <SectionCard title="Risk warnings">
          {(idea.riskWarnings || []).length ? <ul className="space-y-2">{idea.riskWarnings.map((r, i) => <li key={i} className="flex gap-2 text-[13px] text-slate-300"><ShieldAlert size={15} className="mt-0.5 shrink-0 text-amber-glow" /> {r}</li>)}</ul> : <p className="text-[13px] text-slate-500">No major risks flagged. Prior-art review still recommended.</p>}
        </SectionCard>
      )}

      {tab === 'strengthen' && (
        <SectionCard title="Strengthen this idea">
          <p className="text-[13px] text-slate-400">Inject the technical pieces the scorer rewards (mechanism, data fusion, feedback loop, measurable advantage) and re-score. Creates a new version.</p>
          {(idea.strengtheningSuggestions || []).length > 0 && <ul className="mt-3 space-y-1">{idea.strengtheningSuggestions.map((s, i) => <li key={i} className="text-[13px] text-slate-300">• {s}</li>)}</ul>}
          <Button className="mt-3" onClick={doStrengthen} disabled={busy === 'strengthen'}>{busy === 'strengthen' ? <><Loader2 size={15} className="animate-spin" /> Strengthening…</> : <><TrendingUp size={15} /> Strengthen idea</>}</Button>
          {strengthenResult && (
            <div className="mt-3 rounded-lg border border-aurora-mint/25 bg-aurora-mint/5 p-3">
              <div className="flex items-center gap-2 text-sm"><Badge tone="amber">{strengthenResult.scoreBefore}</Badge><ArrowLeftRight /><Badge tone="mint">{strengthenResult.scoreAfter}</Badge><span className="text-slate-400">{strengthenResult.gradeBefore} → {strengthenResult.gradeAfter}</span></div>
              <ul className="mt-2 space-y-1">{strengthenResult.changes.map((c, i) => <li key={i} className="text-[12px] text-slate-300">• {c}</li>)}</ul>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'priorart' && (
        <div className="space-y-4">
          <SectionCard title="Prior-art search plan" action={<Button size="sm" onClick={doPriorArtPlan} disabled={busy === 'plan'}>{busy === 'plan' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Generate plan</Button>}>
            {!plan ? <p className="text-[13px] text-slate-500">Generate a suggested prior-art research plan (queries, classes, differentiation angles).</p> : (
              <div className="space-y-3">
                <p className="text-[12px] text-amber-glow/80">{plan.note}</p>
                <div><div className="text-[11px] uppercase tracking-wide text-slate-500">Keywords</div><div className="mt-1 flex flex-wrap gap-1.5">{(plan.keywords || []).map((k) => <span key={k} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">{k}</span>)}</div></div>
                {plan.queries?.googlePatents?.length > 0 && <Detail label="Google Patents queries" value={plan.queries.googlePatents.join('  •  ')} />}
                {plan.classificationHints?.length > 0 && <Detail label="Classification hints" value={plan.classificationHints.join('  •  ')} />}
                <div className="flex flex-wrap gap-2">{(plan.sources || []).map((s) => <a key={s.name} href={s.url} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><ExternalLink size={13} /> {s.name}</Button></a>)}</div>
              </div>
            )}
          </SectionCard>
          <SectionCard title={`Prior-art records (${priorArt.length})`}>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={paForm.source} onChange={(e) => setPaForm((p) => ({ ...p, source: e.target.value }))} placeholder="Source (e.g. Google Patents)" />
              <Input value={paForm.title} onChange={(e) => setPaForm((p) => ({ ...p, title: e.target.value }))} placeholder="Title" />
              <Input value={paForm.link} onChange={(e) => setPaForm((p) => ({ ...p, link: e.target.value }))} placeholder="Link" />
              <div className="relative"><select value={paForm.riskLevel} onChange={(e) => setPaForm((p) => ({ ...p, riskLevel: e.target.value }))} className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 pr-10 text-sm text-slate-100 outline-none"><option>Low</option><option>Medium</option><option>High</option></select><ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500" /></div>
            </div>
            <textarea value={paForm.summary} onChange={(e) => setPaForm((p) => ({ ...p, summary: e.target.value }))} placeholder="Summary / overlap / differences" className="mt-2 h-16 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none" />
            <Button className="mt-2" size="sm" onClick={addPriorArt}><Plus size={14} /> Add record</Button>
            <div className="mt-3 space-y-2">
              {priorArt.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
                  <div className="min-w-0"><div className="text-[13px] text-slate-200">{r.title || r.source} <Badge tone={riskTone(r.riskLevel)}>{r.riskLevel}</Badge></div>{r.summary && <div className="text-[12px] text-slate-500">{r.summary}</div>}{r.link && <a href={r.link} target="_blank" rel="noreferrer" className="text-[11px] text-aurora-cyan">{r.link}</a>}</div>
                  <button onClick={() => delPriorArt(r.id)} className="shrink-0 rounded-md p-1.5 text-slate-500 hover:text-rose-300"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {tab === 'disclosure' && (
        <SectionCard title="Invention disclosure draft" action={<Button size="sm" onClick={doDisclosure} disabled={busy === 'disclosure'}>{busy === 'disclosure' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} {disclosure ? 'Regenerate' : 'Generate'}</Button>}>
          {!disclosure ? <p className="text-[13px] text-slate-500">Generate a structured invention-disclosure draft (field, background, components, workflow, claim directions, drawings).</p> : (
            <div className="space-y-3">
              <Badge tone="cyan">Version {disclosure.version}</Badge>
              {[['field', 'Field'], ['background', 'Background'], ['problemStatement', 'Problem'], ['summary', 'Summary'], ['workflow', 'Workflow'], ['priorArtDistinction', 'Prior-art distinction'], ['attorneyNotes', 'Attorney notes']].map(([k, l]) => <Detail key={k} label={l} value={disclosure.payload?.[k]} />)}
              {disclosure.payload?.systemComponents?.length > 0 && <Detail label="System components" value={disclosure.payload.systemComponents.join('  •  ')} />}
              {disclosure.payload?.claimDirections?.length > 0 && <div><div className="text-[11px] uppercase tracking-wide text-slate-500">Possible claim directions</div><ul className="mt-1 space-y-1">{disclosure.payload.claimDirections.map((c, i) => <li key={i} className="text-[12px] text-slate-300">• {c}</li>)}</ul></div>}
              <Disclaimer className="border-t border-white/8 pt-2" />
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'poc' && (
        <SectionCard title="POC / project plan" action={<Button size="sm" onClick={doConvert} disabled={busy === 'convert'}>{busy === 'convert' ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />} {proj ? 'Regenerate' : 'Convert to project'}</Button>}>
          {!proj ? <p className="text-[13px] text-slate-500">Convert this invention into a buildable POC: architecture, APIs, schema, demo script, evidence checklist and resume bullets.</p> : (
            <div className="space-y-3">
              <Detail label="Project" value={proj.projectTitle} /><Detail label="MVP" value={proj.mvpDescription} /><Detail label="Architecture" value={proj.technicalArchitecture} />
              {proj.coreFeatures?.length > 0 && <Detail label="Core features" value={proj.coreFeatures.join('  •  ')} />}
              {proj.backendApis?.length > 0 && <Detail label="APIs" value={proj.backendApis.join('  •  ')} />}
              {proj.databaseSchema?.length > 0 && <Detail label="Schema" value={proj.databaseSchema.join('  •  ')} />}
              {proj.resumeBullets?.length > 0 && <div><div className="text-[11px] uppercase tracking-wide text-slate-500">Resume bullets</div><ul className="mt-1 space-y-1">{proj.resumeBullets.map((b, i) => <li key={i} className="text-[12px] text-slate-300">• {b}</li>)}</ul></div>}
              <Button size="sm" variant="soft" onClick={() => go?.('marketplace')}><Sparkles size={13} /> Build & publish in Marketplace</Button>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'versions' && (
        <SectionCard title="Version history">
          {(idea.versionHistory || []).length ? (
            <div className="space-y-2">{[...idea.versionHistory].reverse().map((v, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
                <History size={14} className="mt-0.5 shrink-0 text-aurora-violet" />
                <div><div className="text-[13px] text-slate-200">v{v.version} — {v.change}</div><div className="text-[11px] text-slate-500">score {v.scoreOverall ?? '—'} · {v.at ? new Date(v.at).toLocaleString() : ''}</div></div>
              </div>
            ))}</div>
          ) : <p className="text-[13px] text-slate-500">No versions yet.</p>}
        </SectionCard>
      )}

      {tab === 'feedback' && (
        <SectionCard title="Feedback" eyebrow="Improves future generations">
          <p className="text-[13px] text-slate-400">Your feedback trains the retrieval memory — future ideas avoid rejected directions and favor what you mark strong.</p>
          <div className="mt-3 flex flex-wrap gap-2">{FEEDBACK_TYPES.map((ft) => <Button key={ft} size="sm" variant="soft" onClick={() => sendFeedback(ft)}><MessageSquarePlus size={13} /> {ft}</Button>)}</div>
        </SectionCard>
      )}
    </>
  );
}

function ArrowLeftRight() { return <span className="text-slate-500">→</span>; }
