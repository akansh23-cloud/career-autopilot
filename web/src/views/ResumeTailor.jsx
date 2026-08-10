import { useEffect, useState } from 'react';
import { Sparkles, AlertTriangle, CheckCircle2, ShieldCheck, ShieldAlert, Save, Trash2, FileText, ChevronDown, Loader2, GitCompare } from 'lucide-react';
import { SectionCard } from './common.jsx';
import { Button, Badge, EmptyState, Field } from '../components/ui/kit.jsx';
import { ResumeApi } from '../lib/api.js';
import { ROLE_GROUPS } from '../lib/roles.js';
import { canUse, useMeter, remaining, promptUpgrade, describeLimit, isUnlimited } from '../lib/plan.js';
import { describeApiError } from '../lib/quota.js';

const MODES = [
  ['conservative', 'Conservative', 'Reorder & light rewrite only'],
  ['balanced', 'Balanced', 'Rewrite bullets/summary/skills from existing facts'],
  ['aggressive', 'Aggressive', 'Restructure heavily — still no fake claims'],
];

function FitDelta({ before, after }) {
  const delta = (after ?? 0) - (before ?? 0);
  const tone = delta > 0 ? 'mint' : delta < 0 ? 'rose' : 'cyan';
  return (
    <div className="flex items-center justify-center gap-3">
      <div className="text-center">
        <div className="font-display text-2xl text-fg">{before ?? '—'}</div>
        <div className="text-[11px] text-fg-muted">Job fit before</div>
      </div>
      <div className="text-fg-muted">→</div>
      <div className="text-center">
        <div className="font-display text-2xl text-fg">{after ?? '—'}</div>
        <div className="text-[11px] text-fg-muted">Job fit after</div>
      </div>
      <Badge tone={tone}>{delta >= 0 ? `+${delta}` : delta}</Badge>
    </div>
  );
}

export default function ResumeTailor({ resumeText, fileName, targetRole, resumeScore }) {
  const [jd, setJd] = useState('');
  const [mode, setMode] = useState('balanced');
  const [role, setRole] = useState(targetRole || '');
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [versions, setVersions] = useState([]);
  const [savedMsg, setSavedMsg] = useState('');
  const [blocked, setBlocked] = useState(null); // { message, suggestPlan }

  const tailorsLeft = remaining('tailoring');

  useEffect(() => { setRole(targetRole || ''); }, [targetRole]);
  useEffect(() => { loadVersions(); }, []);

  const loadVersions = async () => {
    try { const d = await ResumeApi.listVersions(); setVersions(d.versions || []); } catch { /* no-op */ }
  };

  const tailor = async () => {
    if (!resumeText || resumeText.trim().length < 40) { setErr('Add your resume above first.'); return; }
    if (jd.trim().length < 30) { setErr('Paste a fuller job description to tailor against.'); return; }

    // Entitlement check FIRST. This screen previously called the API with no
    // plan check at all, so a student out of tailoring runs saw a bare
    // failure instead of an upgrade path.
    if (!canUse('tailoring')) {
      const msg = `${describeLimit('tailoring')} You've used them all for this month.`;
      setBlocked({ message: msg, suggestPlan: 'pro' });
      setErr(''); setStatus('idle');
      promptUpgrade(msg, 'pro');
      return;
    }

    setStatus('loading'); setErr(''); setBlocked(null); setResult(null);
    try {
      const data = await ResumeApi.tailor({ resumeText, jobDescription: jd, fileName, targetRole: role, mode });
      useMeter('tailoring');
      setResult(data);
      setStatus('done');
    } catch (e) {
      const d = describeApiError(e, 'Resume tailoring');
      if (d.kind === 'quota') {
        // Daily server cap, distinct from the monthly entitlement above.
        setBlocked({ message: d.message, suggestPlan: d.suggestPlan });
        setErr('');
        promptUpgrade(d.message, d.suggestPlan || 'pro');
      } else if (d.kind === 'input') {
        setErr(d.message);
      } else {
        setErr(d.message);
      }
      setStatus('error');
    }
  };

  const saveVersion = async (kind) => {
    if (!result && kind === 'job') { setErr('Tailor against a job first.'); return; }
    setSavedMsg('');
    const payload = kind === 'job'
      ? {
          title: `${result.jd?.jobTitle || role || 'Job'} — tailored`,
          kind: 'job', targetRole: role, jobDescription: jd,
          resumeText: result.tailoredResume?.text || resumeText,
          structuredResume: result.tailoredResume || {},
          resumeScore: resumeScore ?? null,
          jobFitScore: result.jobFitScoreAfter ?? null,
          matchedKeywords: result.keywordsAdded || [],
          missingKeywords: result.keywordsMissing || [],
          changeLog: result.changeLog || [],
          fabricationRisks: result.fabricationRisks || [],
        }
      : {
          title: kind === 'role' ? `${role || 'Role'} resume` : 'Base resume',
          kind, targetRole: role, resumeText,
          resumeScore: resumeScore ?? null,
        };
    try {
      const d = await ResumeApi.saveVersion(payload);
      if (d.ok) { setSavedMsg('Version saved.'); loadVersions(); }
      else setErr('Could not save version (database may be off).');
    } catch (e) { setErr(e?.message || 'Save failed.'); }
  };

  const removeVersion = async (id) => {
    try { await ResumeApi.deleteVersion(id); loadVersions(); } catch { /* no-op */ }
  };

  const hasRisks = result?.fabricationRisks?.length > 0;

  return (
    <div className="mt-6 space-y-4">
      <SectionCard title="Tailor resume for a job" eyebrow="Job Fit">
        <Field label="Target role">
          <div className="relative">
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-field-border bg-field px-3.5 pr-10 text-sm text-fg outline-none focus:border-aurora-violet/50">
              <option value="">General (no specific role)</option>
              {Object.entries(ROLE_GROUPS).map(([grp, roles]) => (
                <optgroup key={grp} label={grp}>
                  {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                </optgroup>
              ))}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          </div>
        </Field>

        <textarea value={jd} onChange={(e) => setJd(e.target.value)}
          placeholder="Paste the full job description here…"
          className="mt-3 h-40 w-full resize-none rounded-xl border border-field-border bg-field p-4 text-sm leading-relaxed text-fg outline-none placeholder:text-fg-muted focus:border-aurora-violet/50" />

        <div className="mt-3 flex flex-wrap gap-2">
          {MODES.map(([id, label, hint]) => (
            <button key={id} onClick={() => setMode(id)} title={hint}
              className={`rounded-xl border px-3 py-2 text-left text-xs transition ${mode === id ? 'border-aurora-violet/60 bg-aurora-violet/10 text-fg' : 'border-subtle bg-surface-1 text-fg-secondary hover:border-strong'}`}>
              <div className="font-medium">{label}</div>
              <div className="text-[10px] text-fg-muted">{hint}</div>
            </button>
          ))}
        </div>

        {err && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}

        {blocked && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/30 bg-amber-400/10 p-3.5 text-[13px] text-warn">
            <span className="min-w-0">{blocked.message}</span>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => promptUpgrade(blocked.message, blocked.suggestPlan || 'pro')}>See plans</Button>
              <Button size="sm" variant="soft" onClick={() => setBlocked(null)}>Dismiss</Button>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={tailor} disabled={status === 'loading'}>
            {status === 'loading' ? <><Loader2 size={16} className="animate-spin" /> Tailoring…</> : <><Sparkles size={16} /> Tailor resume</>}
          </Button>
          <Button variant="soft" onClick={() => saveVersion('base')}><Save size={16} /> Save base version</Button>
          {role && <Button variant="soft" onClick={() => saveVersion('role')}><Save size={16} /> Save role version</Button>}
          <span className="ml-auto text-[11.5px] text-fg-muted">
            {isUnlimited(tailorsLeft) ? 'Unlimited tailoring on your plan' : `${tailorsLeft} tailoring run${tailorsLeft === 1 ? '' : 's'} left this month`}
          </span>
        </div>
      </SectionCard>

      {status === 'done' && result && (
        <>
          <SectionCard title="Job fit (separate from resume score)">
            <FitDelta before={result.jobFitScoreBefore} after={result.jobFitScoreAfter} />
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-subtle pt-3 text-center sm:grid-cols-3">
              {Object.entries(result.jobFitBreakdownAfter || {}).map(([k, v]) => (
                <div key={k}>
                  <div className="font-display text-base text-fg">{v}</div>
                  <div className="text-[10px] capitalize text-fg-muted">{k.replace(/([A-Z])/g, ' $1')}</div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={result.fabricationSafe ? 'Integrity check — clean' : 'Integrity check — review needed'}>
            <div className="flex items-center gap-2">
              {result.fabricationSafe
                ? <Badge tone="mint"><ShieldCheck size={12} /> No fabricated claims ({result.integrityScore}/100)</Badge>
                : <Badge tone="rose"><ShieldAlert size={12} /> {result.fabricationRisks.length} risk(s) flagged ({result.integrityScore}/100)</Badge>}
            </div>
            {hasRisks && (
              <ul className="mt-3 space-y-2">
                {result.fabricationRisks.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm text-fg-secondary">
                    <ShieldAlert size={15} className="mt-0.5 shrink-0 text-danger" />
                    <span><span className="text-danger">{r.type?.replace(/_/g, ' ')}:</span> {r.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {result.safeChanges?.length > 0 && (
            <SectionCard title="Safe changes applied">
              <ul className="space-y-2">
                {result.safeChanges.map((s, i) => <li key={i} className="flex gap-2 text-sm text-fg-secondary"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-aurora-mint" /> {s}</li>)}
              </ul>
            </SectionCard>
          )}

          {result.needsReview?.length > 0 && (
            <SectionCard title="Suggestions (add only if true)">
              <ul className="space-y-2">
                {result.needsReview.map((s, i) => <li key={i} className="flex gap-2 text-sm text-fg-secondary"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-glow" /> {s}</li>)}
              </ul>
            </SectionCard>
          )}

          {(result.keywordsAdded?.length > 0 || result.keywordsMissing?.length > 0) && (
            <SectionCard title="Keywords">
              {result.keywordsAdded?.length > 0 && (
                <div className="mb-3">
                  <div className="mb-1 text-[11px] text-fg-muted">Now emphasized</div>
                  <div className="flex flex-wrap gap-2">{result.keywordsAdded.map((k) => <Badge key={k} tone="mint">{k}</Badge>)}</div>
                </div>
              )}
              {result.keywordsMissing?.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] text-fg-muted">Still missing (not inserted)</div>
                  <div className="flex flex-wrap gap-2">{result.keywordsMissing.map((k) => <Badge key={k} tone="violet">{k}</Badge>)}</div>
                </div>
              )}
            </SectionCard>
          )}

          <SectionCard title="Tailored resume (review before use)" action={<Button size="sm" variant="soft" onClick={() => saveVersion('job')}><Save size={14} /> Save job version</Button>}>
            <textarea readOnly value={result.tailoredResume?.text || ''}
              className="h-72 w-full resize-none rounded-xl border border-field-border bg-field p-4 text-xs leading-relaxed text-fg outline-none" />
            {savedMsg && <p className="mt-2 flex items-center gap-1.5 text-xs text-aurora-mint"><CheckCircle2 size={13} /> {savedMsg}</p>}
          </SectionCard>
        </>
      )}

      <SectionCard title={`Saved resume versions (${versions.length})`} eyebrow="Versions">
        {versions.length === 0 ? (
          <EmptyState icon={GitCompare} title="No saved versions yet" hint="Save a base, role, or job-tailored version to compare scores over time." />
        ) : (
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 rounded-xl border border-subtle bg-surface-1 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm text-fg">
                    <FileText size={14} className="shrink-0 text-aurora-cyan" />
                    <span className="truncate">{v.title}</span>
                    <Badge tone={v.kind === 'job' ? 'violet' : v.kind === 'role' ? 'cyan' : 'default'}>{v.kind}</Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-3 text-[11px] text-fg-muted">
                    {v.targetRole && <span>Role: {v.targetRole}</span>}
                    {v.resumeScore != null && <span>Resume: {v.resumeScore}/100</span>}
                    {v.jobFitScore != null && <span>Job fit: {v.jobFitScore}/100</span>}
                  </div>
                </div>
                <button onClick={() => removeVersion(v.id)} className="rounded-md p-1.5 text-fg-muted hover:text-danger" title="Delete version"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
