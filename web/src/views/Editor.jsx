import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Wand2, Copy, Check, PenLine, AlertTriangle, Download, FileText, Briefcase,
  Star, Plus, Upload, ImagePlus, Loader2, X, FileType2, Eye, Sparkles, Shield, Lock, RefreshCw,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Field } from '../components/ui/kit.jsx';
import { AI } from '../lib/api.js';
import {
  getSelectedJob, getStoredResume, getSelectedTemplate, saveSelectedTemplate,
  getCustomTemplateSpec, saveCustomTemplateSpec,
} from '../lib/resumeStore.js';
import {
  parseResume, TEMPLATES, getTemplate, recommendTemplateId, exportResumePDF,
  exportResumeDOCX, buildCustomTemplate, setCustomTemplate, atsEstimate,
} from '../lib/resumeTemplates.js';
import { TemplateGallery, TemplatePreviewModal, ResumePaper } from '../components/ResumeTemplates.jsx';
import { analyzeTemplateImage } from '../lib/templateAnalyze.js';
import { canUploadCustom, canExportDocx, useMeter, canUse, promptUpgrade, templateAllowance } from '../lib/plan.js';
import { describeApiError } from '../lib/quota.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

/* ------------------------------------------------------------------ */
/* Section editor (unchanged behaviour, kept intact)                   */
/* ------------------------------------------------------------------ */
const PRESET_SECTIONS = ['Certifications', 'Languages', 'Awards', 'Publications', 'Volunteer Work', 'Interests', 'References', 'Patents'];

function detectSections(text) {
  if (!text || text.trim().length < 30) return [];
  const seen = new Set();
  return text.split('\n').filter((line) => {
    const t = line.trim();
    if (t.length < 3 || t.length > 40) return false;
    if (!/^[A-Z][A-Z\s&/\-]{1,38}[A-Z]$/.test(t)) return false;
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

function SectionAdder({ resume, onChange }) {
  const [active, setActive] = useState(null);
  const [bullet, setBullet] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [custom, setCustom] = useState('');
  const sections = useMemo(() => detectSections(resume), [resume]);

  const appendBullet = (sectionName, text) => {
    if (!text.trim()) return;
    const entry = `• ${text.trim()}`;
    const lines = resume.split('\n');
    const idx = lines.findIndex((l) => l.trim() === sectionName);
    if (idx < 0) { onChange(resume.trimEnd() + `\n${entry}`); }
    else {
      let insertAt = lines.length;
      for (let i = idx + 1; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t.length >= 3 && t.length <= 40 && /^[A-Z][A-Z\s&/\-]{1,38}[A-Z]$/.test(t) && t !== sectionName) { insertAt = i; break; }
      }
      lines.splice(insertAt, 0, entry);
      onChange(lines.join('\n'));
    }
    setBullet(''); setActive(null);
  };
  const addSection = (name) => {
    if (!name.trim()) return;
    onChange(resume.trimEnd() + `\n\n${name.trim().toUpperCase()}\n• `);
    setShowNew(false); setCustom('');
  };
  if (!resume || resume.trim().length < 30) return null;

  return (
    <div className="mt-3 rounded-xl border border-subtle bg-surface-1 p-3">
      <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">Edit sections</p>
      {sections.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {sections.map((s) => (
            <button key={s} onClick={() => { setActive(active === s ? null : s); setBullet(''); setShowNew(false); }}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] transition ${active === s ? 'border-aurora-violet/50 bg-aurora-violet/12 text-fg' : 'border-subtle text-fg-secondary hover:border-strong hover:text-fg'}`}>
              <Plus size={9} /> {s[0] + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      )}
      {active && (
        <div className="mb-2.5 flex gap-2">
          <input autoFocus value={bullet} onChange={(e) => setBullet(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') appendBullet(active, bullet); if (e.key === 'Escape') setActive(null); }}
            placeholder={`Add bullet to ${active[0] + active.slice(1).toLowerCase()}…`}
            className="h-8 flex-1 rounded-lg border border-field-border bg-field px-3 text-xs text-fg outline-none placeholder:text-fg-muted focus:border-aurora-violet/50" />
          <button onClick={() => appendBullet(active, bullet)} disabled={!bullet.trim()} className="h-8 rounded-lg bg-aurora-violet/20 px-3 text-[11px] font-medium text-fg hover:bg-aurora-violet/30 disabled:opacity-40">Add</button>
          <button onClick={() => setActive(null)} className="h-8 rounded-lg bg-surface-1 px-3 text-[11px] text-fg-secondary hover:bg-surface-hover">✕</button>
        </div>
      )}
      {showNew ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {PRESET_SECTIONS.filter((s) => !sections.includes(s.toUpperCase())).map((s) => (
              <button key={s} onClick={() => addSection(s)} className="rounded-lg border border-dashed border-aurora-cyan/30 px-2.5 py-1 text-[11px] text-aurora-cyan transition hover:bg-aurora-cyan/10">+ {s}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input autoFocus value={custom} onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addSection(custom); if (e.key === 'Escape') setShowNew(false); }}
              placeholder="Custom section name…"
              className="h-8 flex-1 rounded-lg border border-field-border bg-field px-3 text-xs text-fg outline-none placeholder:text-fg-muted focus:border-aurora-violet/50" />
            <button onClick={() => addSection(custom)} disabled={!custom.trim()} className="h-8 rounded-lg bg-aurora-cyan/15 px-3 text-[11px] text-aurora-cyan hover:bg-aurora-cyan/25 disabled:opacity-40">Add</button>
            <button onClick={() => { setShowNew(false); setCustom(''); }} className="h-8 rounded-lg bg-surface-1 px-3 text-[11px] text-fg-secondary hover:bg-surface-hover">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setShowNew(true); setActive(null); }} className="flex items-center gap-1.5 rounded-lg border border-dashed border-subtle px-3 py-1.5 text-[11px] text-fg-muted transition hover:border-aurora-cyan/40 hover:text-aurora-cyan">
          <Plus size={11} /> Add new section
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Custom-template upload (PNG/JPG/JPEG/WEBP + PDF) with AI + fallback  */
/* ------------------------------------------------------------------ */
async function fileToImage(file) {
  const name = (file.name || '').toLowerCase();
  if (file.type.startsWith('image/') && !name.endsWith('.pdf')) {
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    return { dataUrl, mime: file.type };
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return { dataUrl: canvas.toDataURL('image/png'), mime: 'image/png' };
  }
  throw new Error('Unsupported file. Upload PNG, JPG, JPEG, WEBP or PDF.');
}

function CustomTemplatePanel({ data, customSpec, onBuilt, onClear, onSelectCustom, selected }) {
  const allowed = canUploadCustom();
  const [preview, setPreview] = useState(customSpec?.imageDataUrl || null);
  const [mime, setMime] = useState('image/png');
  const [status, setStatus] = useState(customSpec ? 'done' : 'idle'); // idle|reading|analyzing|done|error
  const [err, setErr] = useState('');
  const [analysis, setAnalysis] = useState(customSpec || null);
  const [source, setSource] = useState(customSpec?.source || 'ai');
  const [atsSafe, setAtsSafe] = useState(!!customSpec?.atsSafe);
  const inputRef = useRef(null);

  const tpl = analysis ? buildCustomTemplate({ ...analysis, atsSafe }) : null;
  const twoCol = tpl?.layout === 'twocol';

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!allowed) { promptUpgrade('Custom template upload is a Pro feature.', 'pro'); return; }
    setErr(''); setStatus('reading');
    try {
      const { dataUrl, mime: m } = await fileToImage(file);
      setPreview(dataUrl); setMime(m);
      await runAnalyze(dataUrl, m, file.name, atsSafe);
    } catch (ex) { setErr(ex.message || 'Could not read that file.'); setStatus('error'); }
  };

  const runAnalyze = async (dataUrl, m, name, safe) => {
    setStatus('analyzing'); setErr('');
    try {
      const { analysis: a, source: src } = await analyzeTemplateImage(dataUrl, m, name);
      const spec = { ...a, imageDataUrl: dataUrl, source: src, atsSafe: safe, selectedAt: new Date().toISOString() };
      setAnalysis(spec); setSource(src);
      finishBuild(spec, safe);
    } catch (ex) { setErr('Analysis failed. Try another file.'); setStatus('error'); }
  };

  const finishBuild = (spec, safe) => {
    const built = buildCustomTemplate({ ...spec, atsSafe: safe });
    setCustomTemplate(built);
    saveCustomTemplateSpec({ ...spec, atsSafe: safe });
    setStatus('done');
    onBuilt({ ...spec, atsSafe: safe }, built);
  };

  const toggleAtsSafe = (safe) => {
    setAtsSafe(safe);
    if (analysis) finishBuild(analysis, safe);
  };
  const reAnalyze = () => { if (preview) runAnalyze(preview, mime, analysis?.templateName, atsSafe); };
  const clear = () => { setPreview(null); setStatus('idle'); setErr(''); setAnalysis(null); onClear(); };

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-strong bg-surface-1 p-5 text-center">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-surface-1 text-aurora-violet ring-1 ring-strong"><Lock size={18} /></div>
        <p className="text-[13px] font-semibold text-fg">Custom template upload</p>
        <p className="text-[11px] leading-snug text-fg-muted">Upload a resume template image/PDF and we’ll rebuild your resume in that design. Available on Pro & Premium.</p>
        <Button size="sm" className="mt-1" onClick={() => promptUpgrade('Custom template upload is a Pro feature.', 'pro')}><Sparkles size={13} /> Upgrade to unlock</Button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border transition ${selected ? 'border-aurora-violet/60 ring-1 ring-aurora-violet/30 bg-aurora-violet/5' : 'border-dashed border-strong bg-surface-1'}`}>
      <div className="relative flex h-[176px] items-center justify-center border-b border-subtle bg-[#e9edf5] p-2">
        {preview ? (
          <>
            <img src={preview} alt="uploaded template" className="max-h-full max-w-full rounded object-contain" />
            {status === 'analyzing' && <div className="absolute inset-0 grid place-items-center bg-scrim"><span className="flex items-center gap-1.5 text-[11px] text-fg"><Loader2 size={13} className="animate-spin" /> Analysing layout…</span></div>}
          </>
        ) : (
          <label className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 text-center">
            <Upload size={20} className="text-fg-muted" />
            <span className="text-xs font-medium text-fg-secondary">My Uploaded Template</span>
            <span className="px-3 text-[10px] leading-snug text-fg-muted">PNG · JPG · JPEG · PDF — we read the layout and rebuild your resume in it</span>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf,.pdf" className="hidden" onChange={onPick} />
          </label>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-fg">My Uploaded Template</p>
          {tpl ? <Badge tone={tpl.atsSafe ? 'mint' : 'amber'} className="text-[9px]">{tpl.atsLabel || (tpl.atsSafe ? 'ATS-safe' : 'Visual')}</Badge> : <Badge tone="violet" className="text-[9px]">From upload</Badge>}
        </div>

        {status === 'reading' && <p className="flex items-center gap-1.5 text-[11px] text-aurora-cyan"><Loader2 size={12} className="animate-spin" /> Reading file…</p>}
        {status === 'error' && <p className="flex items-center gap-1.5 text-[11px] text-amber-glow"><AlertTriangle size={12} /> {err}</p>}
        {status === 'done' && (
          <>
            <p className="flex items-center gap-1.5 text-[11px] text-aurora-mint"><Check size={12} /> Matched: {tpl.layout === 'twocol' ? 'two-column' : tpl.layout === 'darkheader' ? 'banner header' : 'single-column'} layout.</p>
            {source === 'fallback' && <p className="text-[10px] text-fg-muted">Template matched using fallback mode — try “Re-analyse”.</p>}
            {twoCol && !atsSafe && <p className="flex items-center gap-1.5 text-[10px] text-amber-glow"><AlertTriangle size={11} /> Two-column may lower ATS parsing. Use ATS-safe for applications.</p>}
            <div className="mt-0.5 flex items-center gap-1 rounded-lg border border-subtle bg-surface-1 p-0.5 text-[10px]">
              <button onClick={() => toggleAtsSafe(false)} className={`flex-1 rounded-md px-2 py-1 transition ${!atsSafe ? 'bg-aurora-violet/25 text-fg' : 'text-fg-secondary'}`}>Visual</button>
              <button onClick={() => toggleAtsSafe(true)} className={`flex-1 rounded-md px-2 py-1 transition ${atsSafe ? 'bg-aurora-mint/20 text-fg' : 'text-fg-secondary'}`}><Shield size={9} className="mr-0.5 inline" />ATS-safe</button>
            </div>
          </>
        )}

        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {status === 'done' ? (
            <>
              <button onClick={() => onSelectCustom()} className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition ${selected ? 'bg-indigo-50 text-brand ring-1 ring-indigo-200' : 'btn-primary hover:brightness-105'}`}>
                {selected ? <><Check size={11} className="mr-1 inline" /> Selected</> : 'Use this custom template'}
              </button>
              <button onClick={reAnalyze} title="Re-analyse template" className="rounded-lg border border-subtle px-2.5 py-1.5 text-[11px] text-fg-secondary hover:bg-surface-2"><RefreshCw size={12} /></button>
              <button onClick={clear} className="rounded-lg border border-subtle px-2.5 py-1.5 text-[11px] text-fg-secondary hover:text-red-400">Remove</button>
            </>
          ) : preview ? (
            <button onClick={clear} className="flex-1 rounded-lg border border-subtle py-1.5 text-[11px] text-fg-secondary hover:text-red-400">Remove upload</button>
          ) : (
            <button onClick={() => inputRef.current?.click()} className="flex-1 rounded-lg border border-subtle bg-surface-1 py-1.5 text-[11px] font-medium text-fg hover:bg-surface-2">Choose file</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Persistence for the deterministic tailoring output                  */
/* ------------------------------------------------------------------ */
const OUT_KEY = 'careerAutopilot.editor.lastTailor.v1';
function safeRead() { try { return JSON.parse(localStorage.getItem(OUT_KEY) || '{}'); } catch { return {}; } }
function safeWrite(v) { try { localStorage.setItem(OUT_KEY, JSON.stringify(v)); } catch {} }
function downloadText(name, text) {
  const blob = new Blob([text || ''], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}
const LENGTHS = ['Auto', 'Single page', 'Multi page'];
const lenToMode = (l) => (l === 'Single page' ? 'single' : l === 'Multi page' ? 'multi' : 'auto');

/* ------------------------------------------------------------------ */
/* Main view                                                            */
/* ------------------------------------------------------------------ */
export default function Editor() {
  const storedResume = getStoredResume();
  const selectedJob = getSelectedJob();
  const last = safeRead();

  const activeRole = storedResume.targetRole || storedResume.analysis?.recommendedRole || '';
  const recommendedId = recommendTemplateId(activeRole);

  const [resume, setResume] = useState(last.out || last.resume || storedResume.text || '');
  const [jd, setJd] = useState(selectedJob
    ? [selectedJob.title, selectedJob.company, selectedJob.location, selectedJob.summary, (selectedJob.requiredSkills || []).join(', ')].filter(Boolean).join('\n')
    : last.jd || '');
  const [len, setLen] = useState(last.len || 'Auto');
  const [out, setOut] = useState(last.out || '');
  const [status, setStatus] = useState('idle');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  // template selection (persisted)
  const [tplId, setTplId] = useState(() => getTemplate(getSelectedTemplate() || last.tpl || recommendedId).id);
  const [previewId, setPreviewId] = useState(null);
  const [customSpec, setCustomSpec] = useState(getCustomTemplateSpec());
  const [busy, setBusy] = useState('');

  // rebuild a saved custom template on mount so it survives refresh
  useEffect(() => {
    const spec = getCustomTemplateSpec();
    if (spec) setCustomTemplate(buildCustomTemplate(spec));
  }, []);

  useEffect(() => {
    const sync = () => {
      const r = getStoredResume();
      const j = getSelectedJob();
      if (r.text && !out) setResume(r.text);
      if (j) setJd([j.title, j.company, j.location, j.summary, (j.requiredSkills || []).join(', ')].filter(Boolean).join('\n'));
    };
    window.addEventListener('career-resume-updated', sync);
    window.addEventListener('career-selected-job-updated', sync);
    return () => {
      window.removeEventListener('career-resume-updated', sync);
      window.removeEventListener('career-selected-job-updated', sync);
    };
  }, [out]);

  const activeText = out || resume;
  const data = useMemo(() => parseResume(activeText), [activeText]);
  const selectedTpl = getTemplate(tplId);

  const pickTemplate = (id) => {
    const allow = templateAllowance();
    if (id !== 'custom' && allow !== Infinity) {
      const idx = TEMPLATES.findIndex((t) => t.id === id);
      if (idx >= allow) { promptUpgrade('Unlock all 8 resume templates with Pro.', 'pro'); return; }
    }
    setTplId(id); saveSelectedTemplate(id);
  };

  const tailor = async () => {
    if (resume.trim().length < 40 || jd.trim().length < 20) { setErr('Add both your resume and the job description.'); return; }
    if (!canUse('tailoring')) { promptUpgrade('You’ve used all your resume tailoring this month. Upgrade for more.', 'pro'); return; }
    setStatus('loading'); setErr(''); setOut('');
    const prompt = `Rewrite and tailor the resume below to the job description. Keep it truthful — never invent experience, companies, dates, certifications, metrics or tools.
Length preference: ${len}. If Single page, compress bullets and remove weaker content. If Multi page, keep sections complete and do not split section content.
Optimise for ATS, lead with quantified impact, mirror the JD language, and output a clean plain-text resume only (no markdown).
Keep clear ALL-CAPS section headings (e.g. SUMMARY, EXPERIENCE, SKILLS, EDUCATION, PROJECTS) and use "•" for bullets.
JOB DESCRIPTION:\n"""${jd.slice(0, 5000)}"""\nRESUME:\n"""${resume.slice(0, 8000)}"""`;
    try {
      const d = await AI.message({ max_tokens: 2600, messages: [{ role: 'user', content: prompt }] });
      const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const next = text.trim();
      setOut(next); setStatus('done');
      useMeter('tailoring');
      safeWrite({ resume, jd, tpl: tplId, len, out: next, updatedAt: new Date().toISOString() });
    } catch (e) {
      // Every failure used to collapse into one "temporarily unavailable"
      // string, so a bad key, a retired model, an hourly rate limit and a
      // stale CSRF cookie all looked identical — to the student AND to us.
      // describeApiError() is the shared classifier Jobs.jsx already uses.
      const d = describeApiError(e, 'Resume tailoring');
      if (d.kind === 'quota') {
        setErr(d.message);
        promptUpgrade(d.message, d.suggestPlan || 'pro');
      } else if (d.kind === 'config') {
        setErr('AI rewrite isn’t enabled on this account yet. Use the deterministic “Tailor resume for a job” tool in Resume OS — it works without AI.');
      } else if (d.kind === 'rate') {
        setErr(`${d.message} You can use the deterministic “Tailor resume for a job” tool in Resume OS meanwhile — it works without AI.`);
      } else {
        setErr(`${d.message || 'Tailoring could not run just now.'} You can use the deterministic “Tailor resume for a job” tool in Resume OS meanwhile — it works without AI.`);
      }
      // Full detail for the browser console so the cause is one F12 away.
      console.error('[tailor] failed', { status: e?.status, code: e?.code, message: e?.message, body: e?.data });
      setStatus('error');
    }
  };

  const copy = () => { navigator.clipboard?.writeText(activeText); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const safeName = (data?.name || 'resume').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'resume';

  const doPDF = async () => {
    if (activeText.trim().length < 30) { setErr('Add resume content first.'); return; }
    setBusy('pdf'); setErr('');
    try { await exportResumePDF(data, tplId, { mode: lenToMode(len), fileName: `${safeName}-${selectedTpl.id}.pdf` }); }
    catch (e) { setErr('PDF export failed: ' + (e.message || e)); }
    finally { setBusy(''); }
  };
  const doDOCX = () => {
    if (activeText.trim().length < 30) { setErr('Add resume content first.'); return; }
    if (!canExportDocx()) { promptUpgrade('DOCX export is available on Pro & Premium. Free plan exports PDF.', 'pro'); return; }
    setBusy('docx');
    try { exportResumeDOCX(data, tplId, { fileName: `${safeName}-${selectedTpl.id}.doc` }); }
    finally { setBusy(''); }
  };

  return (
    <>
      <PageIntro title="Resume editor" sub="Edit your resume, pick a template, preview it as a real A4 page, then export a clean PDF or DOCX." />

      {selectedJob && (
        <div className="mb-4 rounded-2xl border border-aurora-cyan/20 bg-aurora-cyan/10 px-4 py-3 text-sm text-fg">
          <Briefcase size={15} className="mr-1.5 inline text-aurora-cyan" />
          Editing package for <span className="font-medium text-fg">{selectedJob.title}</span> at <span className="font-medium text-fg">{selectedJob.company}</span>.
          {last.out && <span className="ml-1 text-fg-secondary">Tailored resume loaded from Jobs.</span>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.05fr]">
        {/* ── Left: edit ── */}
        <div className="space-y-4">
          <SectionCard
            title={out ? 'Editable tailored resume' : 'Base resume'}
            action={storedResume.fileName && <Badge tone="mint"><FileText size={11} /> {storedResume.fileName}</Badge>}
          >
            {out && (
              <div className="mb-3 rounded-xl border border-aurora-mint/25 bg-aurora-mint/10 p-3 text-xs text-fg">
                Job-specific resume loaded. Edit here — the preview and downloads update live.
              </div>
            )}
            <textarea
              value={activeText}
              onChange={(e) => { if (out) setOut(e.target.value); else setResume(e.target.value); }}
              placeholder="Paste your current resume… keep ALL-CAPS section headings and • bullets for the cleanest template output."
              className="h-52 w-full resize-y rounded-xl border border-field-border bg-field p-3.5 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-aurora-violet/50"
            />
            <SectionAdder resume={activeText} onChange={(v) => { if (out) setOut(v); else setResume(v); }} />
          </SectionCard>

          <SectionCard title="Target job description">
            <textarea value={jd} onChange={(e) => setJd(e.target.value)}
              placeholder="Paste the job description or choose Tailor from a job card…"
              className="h-40 w-full resize-none rounded-xl border border-field-border bg-field p-3.5 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-aurora-violet/50" />
          </SectionCard>

          <SectionCard title="Resume length">
            <div className="flex flex-wrap items-center gap-2">
              {LENGTHS.map((l) => (
                <button key={l} onClick={() => setLen(l)} className={`rounded-lg px-3 py-1.5 text-xs transition ${len === l ? 'bg-aurora-cyan/15 text-fg ring-1 ring-aurora-cyan/30' : 'text-fg-secondary hover:bg-surface-hover'}`}>{l}</button>
              ))}
            </div>
            <p className="mt-2 text-xs text-fg-muted">Single page fits everything cleanly on one A4. Multi page keeps sections intact across pages.</p>
            {err && <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
            <Button className="mt-3 w-full" onClick={tailor} disabled={status === 'loading'}>
              <Wand2 size={16} /> {status === 'loading' ? 'Tailoring…' : 'Tailor for This Job'}
            </Button>
          </SectionCard>
        </div>

        {/* ── Right: templates + live preview + export ── */}
        <div className="space-y-4">
          <SectionCard
            title="Resume template"
            action={recommendedId && activeRole && tplId !== 'custom'
              ? <span className="flex items-center gap-1 text-[11px] text-aurora-mint"><Star size={10} fill="#57E6A8" /> Best for {activeRole}</span>
              : tplId === 'custom' ? <span className="flex items-center gap-1 text-[11px] text-aurora-violet"><ImagePlus size={10} /> Custom active</span> : null}
          >
            <TemplateGallery
              data={data}
              selectedId={tplId}
              recommendedId={recommendedId}
              onSelect={pickTemplate}
              onPreview={(id) => setPreviewId(id)}
              customCard={
                <CustomTemplatePanel
                  data={data}
                  customSpec={customSpec}
                  selected={tplId === 'custom'}
                  onBuilt={(spec) => { setCustomSpec(spec); pickTemplate('custom'); }}
                  onClear={() => { setCustomSpec(null); saveCustomTemplateSpec(null); if (tplId === 'custom') pickTemplate(recommendedId); }}
                  onSelectCustom={() => pickTemplate('custom')}
                />
              }
            />
          </SectionCard>

          <SectionCard
            title="Live preview"
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="soft" onClick={() => setPreviewId(tplId)}><Eye size={13} /> Expand</Button>
                <Button size="sm" variant="soft" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}</Button>
              </div>
            }
          >
            {activeText.trim().length < 30 ? (
              <div className="grid place-items-center rounded-xl border border-dashed border-subtle py-16 text-center">
                <PenLine size={24} className="mb-3 text-aurora-cyan" />
                <p className="text-sm text-fg-secondary">Add resume content to see the live A4 preview</p>
                <p className="mt-1 text-xs text-fg-muted">Using template: <span className="text-fg-secondary">{selectedTpl.name}</span></p>
              </div>
            ) : (
              <div className="flex justify-center rounded-xl border border-subtle bg-[#e9edf5] p-3">
                <ResumePaper key={tplId + len} data={data} templateId={tplId} mode={lenToMode(len)} scale={0.52} className="rounded shadow-lift" />
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2 border-t border-subtle pt-4">
              <Button onClick={doPDF} disabled={busy === 'pdf'}>
                <Download size={15} /> {busy === 'pdf' ? 'Building PDF…' : 'Download PDF'}
              </Button>
              <Button variant="soft" onClick={doDOCX} disabled={busy === 'docx'}>
                <FileType2 size={15} /> DOCX
              </Button>
              <Button variant="soft" onClick={() => downloadText(`${safeName}.txt`, activeText)}>
                <Download size={15} /> TXT
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-fg-muted">
              PDF is generated directly (no browser headers/footers) at A4 with smart page breaks. Downloads use the selected template: <span className="text-fg-secondary">{selectedTpl.name}</span>.
            </p>
          </SectionCard>
        </div>
      </div>

      <TemplatePreviewModal
        open={!!previewId}
        onClose={() => setPreviewId(null)}
        data={data}
        templateId={previewId || tplId}
        onUse={(id) => pickTemplate(id)}
      />
    </>
  );
}
