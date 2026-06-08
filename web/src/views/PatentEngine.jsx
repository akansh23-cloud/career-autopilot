import { useEffect, useState } from 'react';
import {
  ScrollText, Sparkles, Loader2, AlertTriangle, Gauge, ShieldAlert, Search, FileText,
  Plus, Trash2, ChevronDown, Save, ListChecks,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Field, Input, EmptyState, Modal } from '../components/ui/kit.jsx';
import { Patents } from '../lib/api.js';

const READINESS_LABELS = {
  technicalNovelty: ['Technical novelty', 25], problemSolutionClarity: ['Problem-solution clarity', 15],
  implementationDepth: ['Implementation depth', 15], differentiation: ['Differentiation', 15],
  priorArtRisk: ['Prior-art risk (higher = safer)', 15], evidenceMaturity: ['Evidence / prototype maturity', 10],
  inventorContributionClarity: ['Inventor contribution clarity', 5],
};
const STATUS_LABELS = {
  idea_identified: 'Idea identified', invention_disclosure_drafted: 'Disclosure drafted',
  prior_art_search_started: 'Prior-art search started', prior_art_reviewed: 'Prior-art reviewed',
  patent_attorney_review: 'Attorney review', provisional_filed: 'Provisional filed',
  non_provisional_filed: 'Non-provisional filed', published: 'Published', office_action: 'Office action',
  granted: 'Granted', rejected_abandoned: 'Rejected / abandoned', licensed_commercialized: 'Licensed / commercialized',
};
const BADGE_TONE = { patent_ready: 'mint', disclosure_drafted: 'cyan', patent_filed: 'violet', patent_granted: 'amber', not_assessed: 'default' };

function Bar({ label, value, max }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  const tone = pct >= 80 ? '#46E6A6' : pct >= 50 ? '#37D6C4' : '#FFC85A';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]"><span className="text-slate-300">{label}</span><span className="tabular-nums text-slate-400">{value}/{max}</span></div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} /></div>
    </div>
  );
}
function StatCard({ label, value }) {
  return <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4"><div className="text-[12px] text-slate-400">{label}</div><div className="mt-1 font-display text-2xl text-white">{value}</div></div>;
}

export default function PatentEngine() {
  const [form, setForm] = useState({ title: '', problemStatement: '', technicalSolution: '', techStack: '', inventors: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [narrative, setNarrative] = useState('');
  const [stats, setStats] = useState(null);
  const [records, setRecords] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [disclaimer, setDisclaimer] = useState('');
  const [toast, setToast] = useState('');
  const [showDisclosure, setShowDisclosure] = useState(false);
  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const load = async () => {
    try { const [d, r] = await Promise.all([Patents.dashboard(), Patents.records()]); setStats(d.stats); setRecords(r.records || []); setStatuses(r.statuses || []); setDisclaimer(r.disclaimer || d.disclaimer || ''); } catch { /* */ }
  };
  useEffect(() => { load(); }, []);

  const assess = async () => {
    if (form.title.trim().length < 2) { setErr('Add an invention/project title.'); return; }
    setBusy(true); setErr(''); setResult(null); setNarrative('');
    try {
      const data = await Patents.assess({
        ...form,
        techStack: form.techStack.split(',').map((s) => s.trim()).filter(Boolean),
        inventors: form.inventors.split(',').map((s) => s.trim()).filter(Boolean),
        enrich: true,
      });
      setResult(data); setNarrative(data.narrative || ''); setDisclaimer(data.disclaimer || '');
    } catch (e) { setErr(e?.message || 'Assessment failed.'); } finally { setBusy(false); }
  };

  const trackThis = async () => {
    if (!result) return;
    const rec = {
      patentTitle: form.title, inventors: form.inventors.split(',').map((s) => s.trim()).filter(Boolean),
      status: 'idea_identified', readinessScore: result.assessment.patentReadinessScore,
      readinessBreakdown: result.assessment.breakdown, classification: result.assessment.classification,
      priorArt: result.priorArt.suggestedQueries, disclosure: result.disclosure, badge: result.assessment.badge,
    };
    try { const r = await Patents.save(rec); if (r.ok) { flash('Added to patent tracker'); load(); } else flash('Saved (DB off — preview)'); } catch { flash('Save failed'); }
  };

  const updateStatus = async (rec, status) => { try { await Patents.save({ ...rec, status }); load(); } catch { flash('Update failed'); } };
  const remove = async (id) => { try { await Patents.remove(id); load(); } catch { flash('Delete failed'); } };

  return (
    <>
      <PageIntro title="Patent Engine" sub="Assess patent readiness, generate prior-art search keywords and an invention-disclosure draft, and track patent lifecycle by project." />

      {disclaimer && <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-glow/30 bg-amber-glow/10 px-3 py-2 text-[12px] text-amber-glow"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {disclaimer}</div>}

      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Assessed" value={stats.totalAssessed} />
          <StatCard label="Patent-ready" value={stats.patentReady} />
          <StatCard label="Disclosures" value={stats.disclosuresDrafted} />
          <StatCard label="Filed" value={stats.filed} />
          <StatCard label="Granted" value={stats.granted} />
          <StatCard label="High prior-art risk" value={stats.highPriorArtRisk} />
        </div>
      )}

      {toast && <div className="mb-3 rounded-lg border border-aurora-mint/30 bg-aurora-mint/10 px-3 py-2 text-xs text-aurora-mint">{toast}</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <SectionCard title="Assess an invention / project">
          <Field label="Title"><Input value={form.title} onChange={f('title')} placeholder="e.g. Adaptive anomaly-detection pipeline" /></Field>
          <div className="mt-3"><Field label="Technical problem">
            <textarea value={form.problemStatement} onChange={f('problemStatement')} className="h-20 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50" />
          </Field></div>
          <div className="mt-3"><Field label="Technical solution / novelty">
            <textarea value={form.technicalSolution} onChange={f('technicalSolution')} className="h-20 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50" />
          </Field></div>
          <div className="mt-3"><Field label="Tech stack (comma-separated)"><Input value={form.techStack} onChange={f('techStack')} placeholder="Python, Kafka" /></Field></div>
          <div className="mt-3"><Field label="Inventors (comma-separated)"><Input value={form.inventors} onChange={f('inventors')} placeholder="You, co-inventor" /></Field></div>
          {err && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
          <Button className="mt-3" onClick={assess} disabled={busy}>{busy ? <><Loader2 size={16} className="animate-spin" /> Assessing…</> : <><Sparkles size={16} /> Assess readiness</>}</Button>
        </SectionCard>

        <div className="space-y-4">
          {!result ? (
            <SectionCard><div className="py-10 text-center text-sm text-slate-500"><ScrollText size={28} className="mx-auto mb-2 text-slate-600" /> Readiness score, prior-art keywords and disclosure draft appear here.</div></SectionCard>
          ) : (
            <>
              <SectionCard title="Patent readiness">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone={result.assessment.patentReadinessScore >= 75 ? 'mint' : result.assessment.patentReadinessScore >= 55 ? 'cyan' : 'amber'}><Gauge size={11} /> {result.assessment.patentReadinessScore}/100</Badge>
                  <Badge tone="violet">{result.assessment.classification}</Badge>
                  <Badge tone={BADGE_TONE[result.assessment.badge]}>{result.assessment.badge.replace(/_/g, ' ')}</Badge>
                </div>
                <div className="space-y-3">{Object.entries(READINESS_LABELS).map(([k, [label, max]]) => <Bar key={k} label={label} value={result.assessment.breakdown[k] ?? 0} max={max} />)}</div>
                {narrative && <p className="mt-3 whitespace-pre-wrap border-t border-white/8 pt-3 text-[13px] text-slate-300">{narrative}</p>}
                {result.assessment.risks?.length > 0 && (
                  <div className="mt-3 border-t border-white/8 pt-3">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500"><ShieldAlert size={12} /> Risks</div>
                    <ul className="space-y-1">{result.assessment.risks.map((r, i) => <li key={i} className="text-[13px] text-slate-300">• {r}</li>)}</ul>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={trackThis}><Plus size={14} /> Add to tracker</Button>
                  <Button size="sm" variant="soft" onClick={() => setShowDisclosure(true)}><FileText size={14} /> View disclosure draft</Button>
                </div>
              </SectionCard>

              <SectionCard title="Prior-art search">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500"><Search size={12} /> Suggested queries</div>
                <div className="flex flex-wrap gap-2">{result.priorArt.suggestedQueries.map((q) => <Badge key={q} tone="default">{q}</Badge>)}</div>
                <div className="mt-3 flex flex-wrap gap-2">{result.priorArt.searchTargets.map((t) => <span key={t} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">{t}</span>)}</div>
              </SectionCard>
            </>
          )}
        </div>
      </div>

      <SectionCard title={`Patent tracker (${records.length})`} className="mt-4">
        {records.length === 0 ? (
          <EmptyState icon={ScrollText} title="No tracked patents yet" hint="Assess an invention and add it to the tracker to manage its lifecycle." />
        ) : (
          <div className="space-y-2">
            {records.map((rec) => (
              <div key={rec.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm text-slate-200"><span className="truncate">{rec.patentTitle || 'Untitled'}</span>{rec.readinessScore != null && <Badge tone="cyan">{rec.readinessScore}/100</Badge>}{rec.badge && <Badge tone={BADGE_TONE[rec.badge]}>{rec.badge.replace(/_/g, ' ')}</Badge>}</div>
                  {rec.classification && <div className="mt-0.5 text-[11px] text-slate-500">{rec.classification}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="relative">
                    <select value={rec.status} onChange={(e) => updateStatus(rec, e.target.value)} className="h-8 cursor-pointer appearance-none rounded-lg border border-white/10 bg-white/[0.03] pl-2.5 pr-7 text-[11px] text-slate-100 outline-none">
                      {(statuses.length ? statuses : Object.keys(STATUS_LABELS)).map((s) => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
                    </select>
                    <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-500" />
                  </div>
                  <button onClick={() => remove(rec.id)} className="rounded-md p-1.5 text-slate-500 hover:text-rose-300" title="Delete"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {showDisclosure && result && (
        <Modal open onClose={() => setShowDisclosure(false)} title="Invention disclosure draft" width="max-w-2xl">
          <div className="space-y-3 text-sm text-slate-300">
            <div><span className="text-[11px] uppercase tracking-wide text-slate-500">Technical field</span><p>{result.disclosure.technicalField}</p></div>
            <div><span className="text-[11px] uppercase tracking-wide text-slate-500">Background / problem</span><p>{result.disclosure.backgroundProblem}</p></div>
            <div><span className="text-[11px] uppercase tracking-wide text-slate-500">Summary of invention</span><p>{result.disclosure.summaryOfInvention}</p></div>
            <div><span className="text-[11px] uppercase tracking-wide text-slate-500">Detailed description outline</span><ul className="mt-1 space-y-1">{result.disclosure.detailedDescriptionOutline.map((x, i) => <li key={i}>• {x}</li>)}</ul></div>
            {result.disclosure.noveltyPoints?.length > 0 && <div><span className="text-[11px] uppercase tracking-wide text-slate-500">Novelty points</span><ul className="mt-1 space-y-1">{result.disclosure.noveltyPoints.map((x, i) => <li key={i}>• {x}</li>)}</ul></div>}
            <div><span className="text-[11px] uppercase tracking-wide text-slate-500">Claims preparation notes</span><ul className="mt-1 space-y-1">{result.disclosure.claimsPreparationNotes.map((x, i) => <li key={i}>• {x}</li>)}</ul></div>
            <div><span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500"><ListChecks size={12} /> Documentation checklist</span><ul className="mt-1 space-y-1">{result.disclosure.documentationChecklist.map((x, i) => <li key={i}>◇ {x}</li>)}</ul></div>
            <p className="border-t border-white/8 pt-2 text-[11px] text-amber-glow">{result.disclaimer}</p>
            <Button size="sm" variant="soft" onClick={() => { trackThis(); setShowDisclosure(false); }}><Save size={14} /> Save to tracker</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
