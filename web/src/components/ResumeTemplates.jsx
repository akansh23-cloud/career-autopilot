import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Check, Star, FileText, Download, Layers, FileType2 } from 'lucide-react';
import { Modal, Badge, Button } from './ui/kit.jsx';
import {
  TEMPLATES, getTemplate, renderResumeHTML, exportResumePDF, exportResumeDOCX,
} from '../lib/resumeTemplates.js';

/* A real, isolated A4 render of the resume in a given template, scaled to fit. */
export function ResumePaper({ data, templateId, mode, width = 794, scale = 1, className = '', title = 'preview' }) {
  const html = useMemo(() => renderResumeHTML(data, templateId, { mode }), [data, templateId, mode]);
  const h = Math.round(1123 * scale);
  return (
    <div className={className} style={{ width: Math.round(width * scale), height: h, overflow: 'hidden' }}>
      <iframe
        title={title}
        srcDoc={html}
        scrolling="no"
        style={{
          width, height: 1123, border: 0, background: '#fff',
          transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none',
        }}
      />
    </div>
  );
}

/* One template card: thumbnail + name + ATS + page support + Preview / Use. */
function TemplateCard({ tpl, data, selected, recommended, onSelect, onPreview }) {
  return (
    <div
      className={`group flex flex-col overflow-hidden rounded-2xl border transition ${
        selected ? 'border-aurora-violet/60 ring-1 ring-aurora-violet/30 bg-aurora-violet/5'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/25'
      }`}
    >
      {/* live thumbnail */}
      <button
        type="button"
        onClick={() => onPreview(tpl.id)}
        className="relative block h-[176px] w-full overflow-hidden border-b border-white/8 bg-[#e9edf5]"
        title="Click to preview"
      >
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2">
          <ResumePaper data={data} templateId={tpl.id} mode={tpl.pages === 'multi' ? 'multi' : 'auto'} scale={0.205} />
        </div>
        <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-ink-950">
            <Eye size={13} /> Preview
          </span>
        </span>
        {recommended && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-aurora-mint/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-950">
            <Star size={9} fill="currentColor" /> Pick
          </span>
        )}
      </button>

      {/* info */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-semibold leading-tight text-white">{tpl.name}</p>
          <Badge tone={tpl.tone} className="shrink-0 text-[9px]">ATS {tpl.atsScore}</Badge>
        </div>
        <p className="text-[10.5px] leading-snug text-slate-500">{tpl.fit}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-[9.5px] text-slate-400">
            {tpl.pages === 'multi' ? <Layers size={9} /> : <FileText size={9} />}
            {tpl.pages === 'multi' ? 'Multi-page' : 'Single-page'}
          </span>
          <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[9.5px] text-slate-400">{tpl.atsLabel} ATS</span>
        </div>
        <div className="mt-auto flex gap-2 pt-1">
          <button
            onClick={() => onPreview(tpl.id)}
            className="flex-1 rounded-lg border border-white/12 bg-white/[0.04] py-1.5 text-[11px] font-medium text-slate-200 transition hover:bg-white/10"
          >
            <Eye size={11} className="mr-1 inline" /> Preview
          </button>
          <button
            onClick={() => onSelect(tpl.id)}
            className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition ${
              selected ? 'bg-aurora-violet/25 text-ink-950 ring-1 ring-aurora-violet/40'
                       : 'btn-primary text-ink-950 hover:brightness-110'
            }`}
          >
            {selected ? <><Check size={11} className="mr-1 inline" /> Selected</> : 'Use this'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TemplateGallery({ data, selectedId, recommendedId, onSelect, onPreview, customCard }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {TEMPLATES.map((tpl) => (
        <TemplateCard
          key={tpl.id}
          tpl={tpl}
          data={data}
          selected={selectedId === tpl.id}
          recommended={recommendedId === tpl.id}
          onSelect={onSelect}
          onPreview={onPreview}
        />
      ))}
      {customCard}
    </div>
  );
}

/* Full A4 preview modal — realistic, uses the user's actual parsed/tailored data. */
export function TemplatePreviewModal({ open, onClose, data, templateId, onUse }) {
  const tpl = getTemplate(templateId);
  const [mode, setMode] = useState(tpl.pages === 'multi' ? 'multi' : 'auto');
  const [busy, setBusy] = useState('');
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0.62);

  useEffect(() => { setMode(tpl.pages === 'multi' ? 'multi' : 'auto'); }, [templateId]); // eslint-disable-line

  // fit preview width to the modal body
  useEffect(() => {
    if (!open) return;
    const fit = () => {
      const w = wrapRef.current?.clientWidth || 700;
      setScale(Math.min(0.9, Math.max(0.35, (w - 8) / 794)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open, templateId]);

  const safeName = (data?.name || 'resume').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'resume';

  const doPDF = async () => {
    setBusy('pdf');
    try { await exportResumePDF(data, templateId, { mode, fileName: `${safeName}-${tpl.id}.pdf` }); }
    catch (e) { alert('PDF export failed: ' + (e.message || e)); }
    finally { setBusy(''); }
  };
  const doDOCX = () => {
    setBusy('docx');
    try { exportResumeDOCX(data, templateId, { fileName: `${safeName}-${tpl.id}.doc` }); }
    finally { setBusy(''); }
  };

  return (
    <Modal open={open} onClose={onClose} width="max-w-4xl" title={`Preview — ${tpl.name}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tpl.tone}>ATS {tpl.atsScore} · {tpl.atsLabel}</Badge>
          <Badge>{tpl.pages === 'multi' ? 'Multi-page' : 'Single-page'} layout</Badge>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {['auto', 'single', 'multi'].map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium capitalize transition ${
                mode === m ? 'bg-aurora-cyan/15 text-white ring-1 ring-aurora-cyan/30' : 'text-slate-400 hover:text-white'
              }`}
            >
              {m === 'auto' ? 'Auto' : m === 'single' ? 'Single page' : 'Multi page'}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-slate-400">{tpl.desc}</p>

      <div ref={wrapRef} className="flex justify-center rounded-2xl border border-white/10 bg-[#e9edf5] p-2">
        <ResumePaper key={mode} data={data} templateId={templateId} mode={mode} scale={scale} className="rounded shadow-lift" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
        {onUse && (
          <Button onClick={() => { onUse(templateId); onClose?.(); }}>
            <Check size={15} /> Use this template
          </Button>
        )}
        <Button variant="soft" onClick={doPDF} disabled={busy === 'pdf'}>
          <Download size={15} /> {busy === 'pdf' ? 'Building PDF…' : 'Download PDF'}
        </Button>
        <Button variant="soft" onClick={doDOCX} disabled={busy === 'docx'}>
          <FileType2 size={15} /> Download DOCX
        </Button>
      </div>
    </Modal>
  );
}
