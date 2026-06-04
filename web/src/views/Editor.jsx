import { useEffect, useMemo, useState } from 'react';
import { Wand2, Copy, Check, PenLine, AlertTriangle, Download, FileText, Briefcase } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Field } from '../components/ui/kit.jsx';
import { AI } from '../lib/api.js';
import { getSelectedJob, getStoredResume } from '../lib/resumeStore.js';

const TEMPLATES = [
  { name: 'Jake Tech Compact', fit: 'Best for DevOps/SDE', ats: 'High', tone: 'cyan', desc: 'Single-column Overleaf-style technical resume.' },
  { name: 'Modern Dark Header', fit: 'Best for startups', ats: 'High', tone: 'violet', desc: 'Clean premium header with strong skills grouping.' },
  { name: 'ATS Minimal One Page', fit: 'Best for portals', ats: 'Very high', tone: 'mint', desc: 'No graphics, dense, recruiter-friendly.' },
  { name: 'Executive Clean', fit: 'Best for experienced', ats: 'High', tone: 'amber', desc: 'Impact-first profile and leadership layout.' },
  { name: 'Cloud Engineer Pro', fit: 'Best for cloud roles', ats: 'High', tone: 'cyan', desc: 'Cloud, CI/CD and infrastructure sections upfront.' },
  { name: 'Fresher Project Focus', fit: 'Best for students', ats: 'High', tone: 'violet', desc: 'Projects, internships and hackathons emphasized.' },
  { name: 'Product Analyst Clean', fit: 'Best for analyst roles', ats: 'High', tone: 'mint', desc: 'Metrics, tools and business impact focused.' },
  { name: 'Two Page Detailed', fit: 'Best for deep experience', ats: 'Medium-high', tone: 'amber', desc: 'Keeps full context without splitting sections.' },
];
const LENGTHS = ['Auto', 'Single page', 'Multi page'];
const OUT_KEY = 'careerAutopilot.editor.lastTailor.v1';

function safeRead() {
  try { return JSON.parse(localStorage.getItem(OUT_KEY) || '{}'); } catch { return {}; }
}
function safeWrite(v) {
  try { localStorage.setItem(OUT_KEY, JSON.stringify(v)); } catch {}
}
function downloadText(name, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Editor() {
  const storedResume = getStoredResume();
  const selectedJob = getSelectedJob();
  const last = safeRead();
  const [resume, setResume] = useState(storedResume.text || last.resume || '');
  const [jd, setJd] = useState(selectedJob ? [selectedJob.title, selectedJob.company, selectedJob.location, selectedJob.summary, (selectedJob.requiredSkills || []).join(', ')].filter(Boolean).join('\n') : last.jd || '');
  const [tpl, setTpl] = useState(last.tpl || TEMPLATES[0].name);
  const [len, setLen] = useState(last.len || 'Auto');
  const [out, setOut] = useState(last.out || '');
  const [status, setStatus] = useState('idle');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sync = () => {
      const r = getStoredResume();
      const j = getSelectedJob();
      if (r.text) setResume(r.text);
      if (j) setJd([j.title, j.company, j.location, j.summary, (j.requiredSkills || []).join(', ')].filter(Boolean).join('\n'));
    };
    window.addEventListener('career-resume-updated', sync);
    window.addEventListener('career-selected-job-updated', sync);
    return () => {
      window.removeEventListener('career-resume-updated', sync);
      window.removeEventListener('career-selected-job-updated', sync);
    };
  }, []);

  const selectedTemplate = useMemo(() => TEMPLATES.find((t) => t.name === tpl) || TEMPLATES[0], [tpl]);

  const tailor = async () => {
    if (resume.trim().length < 40 || jd.trim().length < 20) { setErr('Add both your resume and the job description.'); return; }
    setStatus('loading'); setErr(''); setOut('');
    const prompt = `Rewrite and tailor the resume below to the job description. Keep it truthful — never invent experience, companies, dates, certifications, metrics or tools.
Use template style: ${tpl}. Length preference: ${len}. If Single page, compress bullets and remove weaker content. If Multi page, keep sections complete and do not split section content.
Optimise for ATS, lead with quantified impact, mirror the JD language, and output clean plain-text resume only.
JOB DESCRIPTION:\n"""${jd.slice(0, 5000)}"""\nRESUME:\n"""${resume.slice(0, 8000)}"""`;
    try {
      const d = await AI.message({ model: 'claude-sonnet-4-20250514', max_tokens: 2600, messages: [{ role: 'user', content: prompt }] });
      const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const next = text.trim();
      setOut(next); setStatus('done');
      safeWrite({ resume, jd, tpl, len, out: next, updatedAt: new Date().toISOString() });
    } catch (e) { setErr(e.message || 'Tailoring failed.'); setStatus('error'); }
  };
  const copy = () => { navigator.clipboard?.writeText(out); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <>
      <PageIntro title="Resume editor" sub="Tailor your saved resume to any selected job with premium ATS-friendly templates." />

      {selectedJob && (
        <div className="mb-4 rounded-2xl border border-aurora-cyan/20 bg-aurora-cyan/10 px-4 py-3 text-sm text-slate-200">
          <Briefcase size={15} className="mr-1.5 inline text-aurora-cyan" /> Tailoring for <span className="font-medium text-white">{selectedJob.title}</span> at <span className="font-medium text-white">{selectedJob.company}</span>.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.05fr]">
        <div className="space-y-4">
          <SectionCard title="Base resume" action={storedResume.fileName && <Badge tone="mint"><FileText size={11} /> {storedResume.fileName}</Badge>}>
            <textarea value={resume} onChange={(e) => setResume(e.target.value)} placeholder="Paste your current resume…"
              className="h-44 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50" />
          </SectionCard>
          <SectionCard title="Target job description">
            <textarea value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the job description or choose Tailor from a job card…"
              className="h-44 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50" />
          </SectionCard>
          <SectionCard title="Resume length">
            <div className="flex flex-wrap items-center gap-2">
              {LENGTHS.map((l) => (
                <button key={l} onClick={() => setLen(l)} className={`rounded-lg px-3 py-1.5 text-xs transition ${len === l ? 'bg-aurora-cyan/15 text-white ring-1 ring-aurora-cyan/30' : 'text-slate-400 hover:bg-white/5'}`}>{l}</button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Single page compresses weak content. Multi page keeps sections intact instead of splitting content awkwardly.</p>
          </SectionCard>
          <SectionCard title="Templates">
            <Field label="Selected style">
              <div className="grid gap-2 sm:grid-cols-2">
                {TEMPLATES.map((t) => (
                  <button key={t.name} onClick={() => setTpl(t.name)} className={`rounded-xl border p-3 text-left transition ${tpl === t.name ? 'border-aurora-violet/50 bg-aurora-violet/12' : 'border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.04]'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white">{t.name}</p>
                      <Badge tone={t.tone}>{t.ats}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{t.fit}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{t.desc}</p>
                  </button>
                ))}
              </div>
            </Field>
            {err && <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
            <Button className="mt-4 w-full" onClick={tailor} disabled={status === 'loading'}>
              <Wand2 size={16} /> {status === 'loading' ? 'Tailoring…' : 'Tailor with AI'}
            </Button>
          </SectionCard>
        </div>

        <SectionCard title="Tailored result" action={out && <div className="flex gap-2"><Button size="sm" variant="soft" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</Button><Button size="sm" onClick={() => downloadText('tailored-resume.txt', out)}><Download size={14} /> TXT</Button></div>}>
          {!out && status !== 'loading' && (
            <div className="grid place-items-center rounded-xl border border-dashed border-white/10 py-20 text-center">
              <PenLine size={26} className="mb-3 text-aurora-cyan" />
              <p className="text-sm text-slate-300">Your tailored resume will appear here</p>
              <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-500">Use <span className="text-slate-300">{selectedTemplate.name}</span>. {selectedTemplate.desc}</p>
              <p className="mt-2 text-xs text-slate-500">Template: <Badge tone={selectedTemplate.tone}>{selectedTemplate.name}</Badge></p>
            </div>
          )}
          {status === 'loading' && (
            <div className="space-y-2.5 py-2">
              {Array.from({ length: 10 }).map((_, i) => <div key={i} className="h-3 animate-pulse rounded bg-white/5" style={{ width: `${55 + (i % 5) * 9}%` }} />)}
            </div>
          )}
          {out && <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap rounded-xl border border-white/8 bg-ink-950/60 p-4 font-mono text-[12.5px] leading-relaxed text-slate-200">{out}</pre>}
        </SectionCard>
      </div>
    </>
  );
}
