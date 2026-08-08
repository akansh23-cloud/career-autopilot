import { useEffect, useRef, useState } from 'react';
import { Brain, Clock, ShieldCheck, ShieldAlert, Loader2, ChevronRight, Send } from 'lucide-react';
import { Badge, Button, Modal, Input } from '../ui/kit.jsx';
import { Viva, PROBE_TYPE_LABEL, probeHint } from '../../lib/viva.js';

/* Live comprehension viva: timed, one probe at a time, per-probe timing captured
   client-side (the server is the source of truth and re-checks). Paste-speed and
   over-budget answers are flagged/blocked server-side, so this UI doesn't need to
   police — it just runs the clock and collects answers. */
export function VivaSession({ open, onClose, repoFullName, skills = [], onResult }) {
  const [phase, setPhase] = useState('intro'); // intro | running | done | error
  const [probes, setProbes] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [budgetMs, setBudgetMs] = useState(0);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(0);
  const probeShownAt = useRef(0);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (phase !== 'running' || !budgetMs) return;
    const t = setInterval(() => {
      const left = Math.max(0, budgetMs - (Date.now() - startedAt.current));
      setRemaining(left);
      if (left <= 0) clearInterval(t);
    }, 500);
    return () => clearInterval(t);
  }, [phase, budgetMs]);

  async function begin() {
    setBusy(true); setError('');
    try {
      const res = await Viva.start(repoFullName, skills);
      if (!res.ok) {
        setError(res.message || 'Could not start the viva.');
        setPhase('error');
      } else {
        setProbes(res.probes || []);
        setSessionId(res.sessionId);
        setBudgetMs(res.budgetMs || 0);
        startedAt.current = Date.now();
        probeShownAt.current = Date.now();
        setPhase('running');
      }
    } catch {
      setError('Could not start the viva.'); setPhase('error');
    } finally { setBusy(false); }
  }

  function recordAndNext(isLast) {
    const p = probes[idx];
    const timingMs = Date.now() - probeShownAt.current;
    const next = { ...answers, [p.id]: { text: draft, timingMs } };
    setAnswers(next);
    setDraft('');
    if (isLast) submit(next);
    else { setIdx(idx + 1); probeShownAt.current = Date.now(); }
  }

  async function submit(finalAnswers) {
    setBusy(true);
    try {
      const totalElapsedMs = Date.now() - startedAt.current;
      const res = await Viva.submit(sessionId, finalAnswers, totalElapsedMs);
      setResult(res);
      setPhase('done');
      onResult?.(res);
    } catch {
      setError('Could not submit the viva.'); setPhase('error');
    } finally { setBusy(false); }
  }

  const p = probes[idx];
  const isLast = idx === probes.length - 1;
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);

  return (
    <Modal open={open} onClose={onClose} title="Live comprehension viva" width="max-w-2xl">
      {phase === 'intro' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Brain size={16} className="text-aurora-cyan" /> Prove you understand the code you committed.
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            You'll answer a short set of questions drawn from <span className="text-slate-200">{repoFullName}</span>,
            one at a time and on the clock. Answers are scored deterministically on the server — there's no AI judge.
            Passing earns a <span className="text-[#BDF5DC]">HIGH-confidence</span> credential, the tier recruiters
            trust most. Answering implausibly fast (looking things up / pasting) is flagged and can block a pass.
          </p>
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <Button onClick={begin} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />} Start viva
          </Button>
        </div>
      )}

      {phase === 'running' && p && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Badge tone="cyan">{PROBE_TYPE_LABEL[p.type] || p.type}</Badge>
            <Badge tone={remaining < 60000 ? 'rose' : 'default'}><Clock size={11} /> {mm}:{String(ss).padStart(2, '0')}</Badge>
          </div>
          <div className="text-xs text-slate-500">Question {idx + 1} of {probes.length}</div>
          <p className="text-white font-medium leading-relaxed">{p.prompt}</p>
          <p className="text-[11px] text-slate-500">{probeHint(p.type)}</p>
          {p.type === 'factual' ? (
            <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Your answer" />
          ) : (
            <textarea
              autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              rows={p.type === 'modify' ? 8 : 3}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white font-mono focus:border-aurora-cyan/40 focus:outline-none"
              placeholder={p.type === 'modify' ? 'Paste the full updated function' : 'Your explanation'}
            />
          )}
          <div className="flex justify-end">
            <Button onClick={() => recordAndNext(isLast)} disabled={busy || !draft.trim()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : isLast ? <Send size={14} /> : <ChevronRight size={14} />}
              {isLast ? 'Submit viva' : 'Next'}
            </Button>
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="space-y-4 text-center">
          {result.passed
            ? <ShieldCheck size={40} className="mx-auto text-[#BDF5DC]" />
            : <ShieldAlert size={40} className="mx-auto text-[#F3E3B2]" />}
          <div>
            <p className="font-display text-2xl font-semibold text-white">{result.comprehensionScore}/100</p>
            <p className="text-sm text-slate-400">{result.passed ? 'Passed' : 'Not passed'} · threshold {result.threshold}</p>
          </div>
          {result.passed
            ? <p className="text-xs text-[#BDF5DC]">Minted {result.credentials?.length || 0} HIGH-confidence credential(s).</p>
            : <p className="text-xs text-slate-400">{(result.sessionFlags || []).includes('many_fast_answers') ? 'Too many answers came in implausibly fast.' : 'Review the code and try again later.'}</p>}
          <Button variant="soft" onClick={onClose}>Close</Button>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-3">
          <p className="text-sm text-rose-300">{error}</p>
          <Button variant="soft" onClick={onClose}>Close</Button>
        </div>
      )}
    </Modal>
  );
}

export default { VivaSession };
