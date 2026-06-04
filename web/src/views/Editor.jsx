import { useState } from 'react';
import { Wand2, Copy, Check, PenLine, AlertTriangle } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Field } from '../components/ui/kit.jsx';
import { AI } from '../lib/api.js';

const TEMPLATES = ['Modern Blue Sidebar', 'Executive Clean', 'Jake Tech Compact', 'ATS Compact', 'Modern Professional', 'Technical Detailed'];
const LENGTHS = ['Auto', 'Single page', 'Multi page'];

export default function Editor() {
  const [resume, setResume] = useState('');
  const [jd, setJd] = useState('');
  const [tpl, setTpl] = useState(TEMPLATES[0]);
  const [len, setLen] = useState('Auto');
  const [out, setOut] = useState('');
  const [status, setStatus] = useState('idle');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const tailor = async () => {
    if (resume.trim().length < 40 || jd.trim().length < 20) { setErr('Add both your resume and the job description.'); return; }
    setStatus('loading'); setErr(''); setOut('');
    const prompt = `Rewrite and tailor the resume below to the job description. Keep it truthful — never invent experience.
Optimise for ATS, lead with quantified impact, mirror the JD's language. Length preference: ${len}. Output clean plain-text resume only.
JOB DESCRIPTION:\n"""${jd.slice(0, 4000)}"""\nRESUME:\n"""${resume.slice(0, 6000)}"""`;
    try {
      const d = await AI.message({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
      const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      setOut(text.trim()); setStatus('done');
    } catch (e) { setErr(e.message || 'Tailoring failed.'); setStatus('error'); }
  };
  const copy = () => { navigator.clipboard?.writeText(out); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <>
      <PageIntro title="Resume editor" sub="Tailor your resume to any job in seconds — ATS-aware, achievement-first." />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <SectionCard title="Base resume">
            <textarea value={resume} onChange={(e) => setResume(e.target.value)} placeholder="Paste your current resume…"
              className="h-44 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50" />
          </SectionCard>
          <SectionCard title="Target job description">
            <textarea value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the job description…"
              className="h-44 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50" />
          </SectionCard>
          <SectionCard title="Style">
            <Field label="Template">
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map((t) => (
                  <button key={t} onClick={() => setTpl(t)} className={`rounded-lg px-3 py-1.5 text-xs transition ${tpl === t ? 'bg-aurora-violet/15 text-white ring-1 ring-aurora-violet/30' : 'text-slate-400 hover:bg-white/5'}`}>{t}</button>
                ))}
              </div>
            </Field>
            <div className="mt-3 flex items-center gap-2">
              {LENGTHS.map((l) => (
                <button key={l} onClick={() => setLen(l)} className={`rounded-lg px-3 py-1.5 text-xs transition ${len === l ? 'bg-aurora-cyan/15 text-white ring-1 ring-aurora-cyan/30' : 'text-slate-400 hover:bg-white/5'}`}>{l}</button>
              ))}
            </div>
            {err && <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
            <Button className="mt-4 w-full" onClick={tailor} disabled={status === 'loading'}>
              <Wand2 size={16} /> {status === 'loading' ? 'Tailoring…' : 'Tailor with AI'}
            </Button>
          </SectionCard>
        </div>

        <SectionCard title="Tailored result" action={out && <Button size="sm" variant="soft" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</Button>}>
          {!out && status !== 'loading' && (
            <div className="grid place-items-center rounded-xl border border-dashed border-white/10 py-20 text-center">
              <PenLine size={26} className="mb-3 text-aurora-cyan" />
              <p className="text-sm text-slate-300">Your tailored resume will appear here</p>
              <p className="mt-1 text-xs text-slate-500">Template: <Badge tone="violet">{tpl}</Badge></p>
            </div>
          )}
          {status === 'loading' && (
            <div className="space-y-2.5 py-2">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-3 animate-pulse rounded bg-white/5" style={{ width: `${60 + (i % 4) * 10}%` }} />)}
            </div>
          )}
          {out && <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-xl border border-white/8 bg-ink-950/60 p-4 font-mono text-[12.5px] leading-relaxed text-slate-200">{out}</pre>}
        </SectionCard>
      </div>
    </>
  );
}
