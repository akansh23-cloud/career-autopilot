import { useState, useRef } from 'react';
import { FileText, Sparkles, AlertTriangle, CheckCircle2, Gauge, Upload, Loader2, X } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Skeleton, EmptyState, Field } from '../components/ui/kit.jsx';
import { AI } from '../lib/api.js';
import { extractResumeText, ACCEPT } from '../lib/resume.js';

function extractJSON(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : text); } catch { return null; }
}

function Ring({ value }) {
  const r = 52, c = 2 * Math.PI * r, off = c - (value / 100) * c;
  const tone = value >= 80 ? '#52E6C2' : value >= 60 ? '#3DD6F5' : '#FFB454';
  return (
    <div className="relative grid h-36 w-36 place-items-center">
      <svg width="136" height="136" className="-rotate-90">
        <circle cx="68" cy="68" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
        <circle cx="68" cy="68" r={r} fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-3xl font-semibold text-white">{value}</div>
        <div className="text-[11px] text-slate-500">/ 100</div>
      </div>
    </div>
  );
}

export default function Resume() {
  const [resume, setResume] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  const ingestFile = async (file) => {
    if (!file) return;
    setParsing(true); setErr('');
    try {
      const txt = await extractResumeText(file);
      if (!txt || txt.length < 20) throw new Error('Could not read text from that file. Try a text-based PDF or DOCX.');
      setResume(txt); setFileName(file.name);
    } catch (e) {
      setErr(e.message || 'Failed to read file.');
    } finally {
      setParsing(false);
    }
  };

  const onPick = (e) => { const f = e.target.files?.[0]; ingestFile(f); e.target.value = ''; };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); ingestFile(e.dataTransfer.files?.[0]); };
  const clearFile = () => { setFileName(''); setResume(''); };

  const analyze = async () => {
    if (resume.trim().length < 40) { setErr('Paste a bit more of your resume to analyze.'); return; }
    setStatus('loading'); setErr(''); setResult(null);
    const prompt = `You are an expert ATS resume reviewer. Analyze the resume for the target role "${role || 'general'}".
Return ONLY valid JSON, no prose, no markdown fences, shape:
{"score":<0-100 int>,"ats":<0-100>,"impact":<0-100>,"clarity":<0-100>,"summary":"<one sentence>","strengths":["..."],"improvements":["..."],"missingKeywords":["..."]}
Resume:
"""${resume.slice(0, 8000)}"""`;
    try {
      const d = await AI.message({ model: 'claude-sonnet-4-20250514', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] });
      const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const parsed = extractJSON(text);
      if (!parsed) throw new Error('Could not parse AI response.');
      setResult(parsed); setStatus('done');
    } catch (e) {
      setErr(e.message || 'Analysis failed.'); setStatus('error');
    }
  };

  return (
    <>
      <PageIntro title="Resume intelligence" sub="Upload a PDF/DOCX or paste your resume to get an ATS-aware score with concrete fixes." />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <SectionCard title="Your resume">
          <Field label="Target role (optional)">
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior DevOps Engineer"
              className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-100 outline-none focus:border-aurora-violet/50" />
          </Field>

          {/* Upload dropzone */}
          <input ref={fileRef} type="file" accept={ACCEPT} onChange={onPick} className="hidden" />
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={`mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition ${
              drag ? 'border-aurora-violet/60 bg-aurora-violet/10' : 'border-white/12 bg-white/[0.02] hover:border-white/25'
            }`}
          >
            {parsing ? (
              <><Loader2 size={20} className="animate-spin text-aurora-cyan" /><span className="text-sm text-muted">Reading file…</span></>
            ) : fileName ? (
              <div className="flex items-center gap-2 text-sm text-slate-200">
                <FileText size={16} className="text-aurora-mint" /> {fileName}
                <button onClick={(e) => { e.stopPropagation(); clearFile(); }} className="rounded-md p-1 text-slate-500 hover:text-white"><X size={14} /></button>
              </div>
            ) : (
              <>
                <Upload size={20} className="text-slate-400" />
                <span className="text-sm font-medium text-slate-200">Drop resume or click to upload</span>
                <span className="text-[11px] text-slate-500">PDF, DOCX, TXT — parsed in your browser</span>
              </>
            )}
          </div>

          <textarea
            value={resume} onChange={(e) => { setResume(e.target.value); if (fileName) setFileName(''); }}
            placeholder="…or paste your resume text here"
            className="mt-3 h-56 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-slate-200 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50"
          />
          {err && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">{resume.length} chars</span>
            <Button onClick={analyze} disabled={status === 'loading'}>
              <Sparkles size={16} /> {status === 'loading' ? 'Analyzing…' : 'Analyze resume'}
            </Button>
          </div>
        </SectionCard>

        <div className="space-y-4">
          {status === 'idle' && <EmptyState icon={Gauge} title="Score appears here" hint="Run an analysis to see your ATS score, strengths and fixes." />}
          {status === 'error' && <EmptyState icon={AlertTriangle} title="Couldn’t analyze" hint={err} action={<Button size="sm" onClick={analyze}>Retry</Button>} />}
          {status === 'loading' && (
            <SectionCard><div className="flex flex-col items-center gap-4 py-6">
              <Skeleton className="h-36 w-36 rounded-full" />
              <Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" />
            </div></SectionCard>
          )}
          {status === 'done' && result && (
            <>
              <SectionCard>
                <div className="flex flex-col items-center gap-3">
                  <Ring value={Number(result.score) || 0} />
                  <p className="text-center text-sm text-muted">{result.summary}</p>
                  <div className="grid w-full grid-cols-3 gap-2 border-t border-white/8 pt-3">
                    {[['ATS', result.ats], ['Impact', result.impact], ['Clarity', result.clarity]].map(([l, v]) => (
                      <div key={l} className="text-center">
                        <div className="font-display text-lg text-white">{v ?? '—'}</div>
                        <div className="text-[11px] text-slate-500">{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </SectionCard>
              {result.strengths?.length > 0 && (
                <SectionCard title="Strengths">
                  <ul className="space-y-2">
                    {result.strengths.map((s, i) => <li key={i} className="flex gap-2 text-sm text-slate-300"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-aurora-mint" /> {s}</li>)}
                  </ul>
                </SectionCard>
              )}
              {result.improvements?.length > 0 && (
                <SectionCard title="Fix these">
                  <ul className="space-y-2">
                    {result.improvements.map((s, i) => <li key={i} className="flex gap-2 text-sm text-slate-300"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-glow" /> {s}</li>)}
                  </ul>
                </SectionCard>
              )}
              {result.missingKeywords?.length > 0 && (
                <SectionCard title="Missing keywords">
                  <div className="flex flex-wrap gap-2">
                    {result.missingKeywords.map((k) => <Badge key={k} tone="violet">{k}</Badge>)}
                  </div>
                </SectionCard>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
