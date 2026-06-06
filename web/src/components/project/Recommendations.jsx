import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, Target, Gauge, Clock, Github, Database, Trophy, Rocket, Lightbulb,
  ChevronDown, ChevronUp, Scale, Bookmark, Check, AlertTriangle, ThumbsUp,
  TrendingUp, X, Layers, ShieldQuestion, Loader2,
} from 'lucide-react';
import { Button, Badge, Modal, EmptyState } from '../ui/kit.jsx';
import {
  recommendProjects, saveRecommendations, getSavedRecommendations, clearRecommendations,
  saveIdea, getSavedIdeas, removeSavedIdea, recordFeedback, FIT_WEIGHTS,
} from '../../lib/projectRecommend.js';
import { canUse, useMeter, promptUpgrade } from '../../lib/plan.js';

const LOADING_STEPS = [
  'Finding real project inspiration…',
  'Analyzing your resume and skill gaps…',
  'Scoring project fit…',
  'Preparing recommendations…',
];

const CATEGORY_META = {
  'Best Career Fit': { tone: 'violet', Icon: Target },
  'Best Quick Win': { tone: 'cyan', Icon: Clock },
  'Best Portfolio Impact': { tone: 'mint', Icon: Trophy },
  'Best Startup Potential': { tone: 'amber', Icon: Rocket },
  'Best Beginner-Friendly': { tone: 'cyan', Icon: Lightbulb },
};

function confTone(c) { return c === 'High' ? 'mint' : c === 'Medium' ? 'cyan' : 'amber'; }
function fitTone(s) { return s >= 80 ? 'mint' : s >= 60 ? 'cyan' : 'amber'; }

function Bar({ label, value, max }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div>
      <div className="flex justify-between text-[10px] text-slate-400"><span>{label}</span><span>{value}/{max}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-aurora-cta" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function WhyPanel({ c }) {
  return (
    <div className="space-y-3 rounded-xl border border-aurora-violet/20 bg-aurora-violet/[0.06] p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-aurora-violet"><ShieldQuestion size={13} /> Why this project?</div>
      <ul className="space-y-1.5">
        {c.whyRecommended.map((w, i) => <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-slate-300"><Check size={13} className="mt-0.5 shrink-0 text-aurora-mint" /> {w}</li>)}
      </ul>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-white/8 bg-ink-950/55 p-2">
          <div className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Resume impact</div>
          <p className="mt-1 text-[11px] text-slate-300">{c.resumeImpactPreview}</p>
        </div>
        <div className="rounded-lg border border-white/8 bg-ink-950/55 p-2">
          <div className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Job-match impact</div>
          <p className="mt-1 text-[11px] text-slate-300">{c.jobImpactPreview}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Bar label="Role match" value={c.scoreBreakdown.targetRoleMatch} max={FIT_WEIGHTS.targetRoleMatch} />
        <Bar label="Missing skills" value={c.scoreBreakdown.missingSkillCoverage} max={FIT_WEIGHTS.missingSkillCoverage} />
        <Bar label="Resume gaps" value={c.scoreBreakdown.resumeGapImprovement} max={FIT_WEIGHTS.resumeGapImprovement} />
        <Bar label="Job market" value={c.scoreBreakdown.jobMarketRelevance} max={FIT_WEIGHTS.jobMarketRelevance} />
        <Bar label="Level fit" value={c.scoreBreakdown.userLevelFit} max={FIT_WEIGHTS.userLevelFit} />
        <Bar label="Proof potential" value={c.scoreBreakdown.proofPotential} max={FIT_WEIGHTS.proofPotential} />
      </div>
      {c.risksOrWarnings?.length > 0 && (
        <div className="rounded-lg border border-amber-glow/25 bg-amber-glow/10 p-2 text-[11px] text-amber-glow">
          {c.risksOrWarnings.map((w, i) => <p key={i} className="flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}</p>)}
        </div>
      )}
    </div>
  );
}

function FeedbackBar({ c, onFeedback }) {
  const [sent, setSent] = useState('');
  const fire = (type, label) => { recordFeedback(c, type); setSent(label); onFeedback?.(type); setTimeout(() => setSent(''), 1800); };
  const btn = 'rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-slate-400 transition hover:border-white/25 hover:text-white';
  if (sent) return <p className="text-[11px] text-aurora-mint">Thanks — future recommendations will {sent}.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      <button className={btn} onClick={() => fire('useful', 'reflect this')}><ThumbsUp size={11} className="mr-1 inline" />Useful</button>
      <button className={btn} onClick={() => fire('too_easy', 'aim higher')}>Too easy</button>
      <button className={btn} onClick={() => fire('too_hard', 'ease difficulty')}>Too hard</button>
      <button className={btn} onClick={() => fire('not_relevant', 'down-rank this source')}>Not relevant</button>
      <button className={btn} onClick={() => fire('more_startup', 'favor startup ideas')}><Rocket size={11} className="mr-1 inline" />More startup</button>
      <button className={btn} onClick={() => fire('more_jobs', 'favor job-focused ideas')}><TrendingUp size={11} className="mr-1 inline" />More job-focused</button>
    </div>
  );
}

function RecCard({ c, onGenerate, onCompareToggle, compareOn, onSave, saved, onFeedback }) {
  const [open, setOpen] = useState(false);
  const cat = c.category ? CATEGORY_META[c.category] : null;
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {c.category && <Badge tone={cat?.tone || 'violet'} className="mb-1.5">{cat?.Icon && <cat.Icon size={11} />} {c.category}</Badge>}
          <h4 className="font-medium leading-tight text-white">{c.title}</h4>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{c.summary}</p>
        </div>
        <div className="shrink-0 text-center">
          <Badge tone={fitTone(c.fitScore)} className="text-[13px]">{c.fitScore}/100</Badge>
          <div className="mt-1"><Badge tone={confTone(c.confidence)} className="text-[9px]">{c.confidence}</Badge></div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge tone="violet">{c.sourceType === 'github' ? <Github size={10} /> : c.sourceType === 'kaggle' ? <Database size={10} /> : <Sparkles size={10} />} {c.sourceLabel}</Badge>
        <Badge tone="amber"><Gauge size={10} /> {c.difficulty}</Badge>
        <Badge tone="cyan"><Clock size={10} /> {c.estimatedDuration}</Badge>
        {c.startupPotential >= 0.6 && <Badge tone="amber"><Rocket size={10} /> Startup {Math.round(c.startupPotential * 100)}%</Badge>}
        {c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="text-[10px] text-aurora-cyan underline">inspiration ↗</a>}
      </div>

      <div className="mt-2.5 space-y-1.5">
        <div>
          <span className="text-[10px] uppercase tracking-widest text-slate-500">Skills covered</span>
          <div className="mt-1 flex flex-wrap gap-1">{c.skillsCovered.slice(0, 8).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div>
        </div>
        {c.coveredMissingSkills.length > 0 && (
          <div><span className="text-[10px] uppercase tracking-widest text-slate-500">Missing skills covered</span>
            <div className="mt-1 flex flex-wrap gap-1">{c.coveredMissingSkills.map((s, i) => <Badge key={i} tone="mint">{s}</Badge>)}</div></div>
        )}
        {c.stillMissingSkills.length > 0 && (
          <div><span className="text-[10px] uppercase tracking-widest text-slate-500">Still not covered</span>
            <div className="mt-1 flex flex-wrap gap-1">{c.stillMissingSkills.map((s, i) => <Badge key={i} tone="rose">{s}</Badge>)}</div></div>
        )}
        <div><span className="text-[10px] uppercase tracking-widest text-slate-500">Expected proof outputs</span>
          <div className="mt-1 flex flex-wrap gap-1">{(c.expectedProofOutputs || []).map((s, i) => <Badge key={i}>{s}</Badge>)}</div></div>
      </div>

      <button onClick={() => setOpen((v) => !v)} className="mt-3 flex items-center gap-1 text-[12px] font-medium text-aurora-violet hover:text-white">
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? 'Hide reasoning' : 'Why this project?'}
      </button>
      {open && <div className="mt-2"><WhyPanel c={c} /></div>}

      <div className="mt-3 border-t border-white/8 pt-3"><FeedbackBar c={c} onFeedback={onFeedback} /></div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onGenerate(c)}><Sparkles size={13} /> Generate full roadmap</Button>
        <Button size="sm" variant="soft" onClick={() => onCompareToggle(c)}><Scale size={13} /> {compareOn ? 'In compare' : 'Compare'}</Button>
        <Button size="sm" variant="soft" onClick={() => onSave(c)}><Bookmark size={13} /> {saved ? 'Saved' : 'Save for later'}</Button>
      </div>
    </div>
  );
}

function CompareModal({ open, onClose, items, onGenerate }) {
  if (!items.length) return null;
  const rows = [
    ['Fit score', (c) => `${c.fitScore}/100`],
    ['Confidence', (c) => c.confidence],
    ['Role fit', (c) => `${c.scoreBreakdown.targetRoleMatch}/${FIT_WEIGHTS.targetRoleMatch}`],
    ['Job relevance', (c) => `${c.scoreBreakdown.jobMarketRelevance}/${FIT_WEIGHTS.jobMarketRelevance}`],
    ['Difficulty', (c) => c.difficulty],
    ['Duration', (c) => c.estimatedDuration],
    ['Skills covered', (c) => c.skillsCovered.slice(0, 6).join(', ')],
    ['Proof outputs', (c) => (c.expectedProofOutputs || []).join(', ')],
    ['Startup potential', (c) => `${Math.round(c.startupPotential * 100)}%`],
  ];
  return (
    <Modal open={open} onClose={onClose} width="max-w-4xl" title="Compare projects">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead>
            <tr>
              <th className="border-b border-white/10 p-2 text-[10px] uppercase tracking-widest text-slate-500">Attribute</th>
              {items.map((c) => <th key={c.id} className="border-b border-white/10 p-2 align-top text-white">{c.title}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, fn]) => (
              <tr key={label}>
                <td className="border-b border-white/8 p-2 text-slate-500">{label}</td>
                {items.map((c) => <td key={c.id} className="border-b border-white/8 p-2 text-slate-300">{fn(c)}</td>)}
              </tr>
            ))}
            <tr>
              <td className="p-2" />
              {items.map((c) => <td key={c.id} className="p-2"><Button size="sm" onClick={() => onGenerate(c)}><Sparkles size={12} /> Build this</Button></td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export default function Recommendations({ buildCtx, access, onGenerate, flash }) {
  const restored = useMemo(() => getSavedRecommendations(), []);
  const [status, setStatus] = useState(restored?.recommendations?.length ? 'done' : 'idle'); // idle|loading|done|error
  const [recs, setRecs] = useState(restored?.recommendations || []);
  const [signals, setSignals] = useState(restored?.signalsUsed || null);
  const [explanation, setExplanation] = useState(restored?.explanation || '');
  const [warnings, setWarnings] = useState(restored?.warnings || []);
  const [step, setStep] = useState(0);
  const [compare, setCompare] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [savedIds, setSavedIds] = useState(getSavedIdeas().map((i) => i.id));
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const run = async () => {
    if (!canUse('aiGen')) {
      promptUpgrade(`You’ve used all your project recommendations this month on the ${access.effectivePlan} plan. Upgrade for more.`, 'pro');
      return;
    }
    setStatus('loading'); setStep(0); setWarnings([]);
    clearInterval(timer.current);
    timer.current = setInterval(() => setStep((s) => (s + 1) % LOADING_STEPS.length), 1100);
    try {
      const ctx = buildCtx();
      const out = await recommendProjects(ctx);
      clearInterval(timer.current);
      if (!out.recommendations.length) { setStatus('error'); setWarnings(['No recommendations found. Add a target role, current skills, or analyse your resume, then try again.']); return; }
      useMeter('aiGen');
      setRecs(out.recommendations); setSignals(out.signalsUsed); setExplanation(out.explanation); setWarnings(out.warnings || []);
      saveRecommendations({ recommendations: out.recommendations, signalsUsed: out.signalsUsed, explanation: out.explanation, warnings: out.warnings });
      setStatus('done');
    } catch (e) {
      clearInterval(timer.current);
      setStatus('error'); setWarnings(['Something went wrong while preparing recommendations. Please try again.']);
    }
  };

  const reset = () => { clearRecommendations(); setRecs([]); setStatus('idle'); setCompare([]); };

  const toggleCompare = (c) => {
    setCompare((cur) => {
      if (cur.find((x) => x.id === c.id)) return cur.filter((x) => x.id !== c.id);
      if (cur.length >= 3) { flash?.('Compare up to 3 projects at a time.'); return cur; }
      return [...cur, c];
    });
  };
  const onSave = (c) => { saveIdea(c); setSavedIds(getSavedIdeas().map((i) => i.id)); flash?.('Saved to your ideas.'); };

  const allowedLabel = access.effectivePlan === 'free'
    ? 'Free plan uses curated + job-gap recommendations.'
    : access.effectivePlan === 'pro'
      ? 'Pro unlocks GitHub trend discovery + comparison.'
      : 'Premium unlocks GitHub, Kaggle, Product Hunt & hackathon discovery.';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div>
          <h3 className="font-display text-base font-semibold text-white">Project recommendations</h3>
          <p className="mt-0.5 text-[12px] text-slate-400">Ranked by Project Fit Score from your profile, resume gaps, matched jobs and real-world sources. {allowedLabel}</p>
        </div>
        <div className="flex gap-2">
          {status === 'done' && <Button variant="soft" onClick={reset}>Clear</Button>}
          <Button onClick={run} disabled={status === 'loading'}><Sparkles size={15} /> {status === 'done' ? 'Refresh' : 'Get recommendations'}</Button>
        </div>
      </div>

      {status === 'loading' && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] py-14">
          <Loader2 size={22} className="animate-spin text-aurora-violet" />
          <p className="text-sm text-slate-300">{LOADING_STEPS[step]}</p>
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-2xl border border-amber-glow/30 bg-amber-glow/10 p-4 text-sm text-amber-glow">
          {warnings.map((w, i) => <p key={i} className="flex gap-1.5"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {w}</p>)}
        </div>
      )}

      {status === 'idle' && (
        <EmptyState icon={Layers} title="No recommendations yet" hint="Click “Get recommendations” to rank real, original project ideas by how well they fit your role, skill gaps and matched jobs." />
      )}

      {status === 'done' && recs.length > 0 && (
        <>
          {explanation && <p className="rounded-xl border border-white/8 bg-ink-950/55 p-3 text-[12px] leading-relaxed text-slate-300">{explanation}</p>}
          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-glow/25 bg-amber-glow/10 p-3 text-[11px] text-amber-glow">
              {warnings.map((w, i) => <p key={i} className="flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}</p>)}
            </div>
          )}
          {compare.length >= 2 && (
            <Button size="sm" variant="soft" onClick={() => setCompareOpen(true)}><Scale size={13} /> Compare {compare.length} selected</Button>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {recs.map((c) => (
              <RecCard key={c.id} c={c} compareOn={!!compare.find((x) => x.id === c.id)} saved={savedIds.includes(c.id)}
                onGenerate={onGenerate} onCompareToggle={toggleCompare} onSave={onSave} onFeedback={() => {}} />
            ))}
          </div>
          {signals && (
            <p className="text-[11px] text-slate-500">
              Data sources used: {[signals.curated && 'curated library', signals.jobs ? `${signals.jobs} matched jobs` : null, signals.resume && 'resume analysis', signals.github && 'GitHub', signals.kaggle && 'Kaggle', signals.productHunt && 'Product Hunt', signals.devpost && 'hackathons'].filter(Boolean).join(' · ')}. Estimated based on skill overlap and available project/job data.
            </p>
          )}
        </>
      )}

      <CompareModal open={compareOpen} onClose={() => setCompareOpen(false)} items={compare} onGenerate={(c) => { setCompareOpen(false); onGenerate(c); }} />
    </div>
  );
}
