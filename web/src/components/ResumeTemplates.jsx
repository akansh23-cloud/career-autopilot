import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye, Check, Star, Download, FileType2, Shield, AlertTriangle, Loader2,
  ZoomIn, ZoomOut, FileWarning, ListChecks,
} from 'lucide-react';
import { Modal, Badge, Button } from './ui/kit.jsx';
import { getTemplate, TEMPLATES } from '../lib/resumeTemplates.js';
import {
  composePagedDocumentHTML, renderAndValidate,
  exportResumePDF, exportResumeSnapshotPDF, exportResumeDOCX, PAGE_SIZES,
} from '../lib/resumeRenderer.js';

/* legacy mode names (Editor) → paginator pageMode */
const MODE_MAP = { single: 'one-page', multi: 'multi', auto: 'auto' };
const toPageMode = (m) => MODE_MAP[m] || m || 'auto';

/* ================================================================== */
/* Paginated, validated preview — THE renderer (same as export)        */
/* ================================================================== */
export function PaginatedResumePreview({
  data, templateId, mode = 'auto', size = 'a4', scale = 0.52,
  className = '', title = 'resume preview', maxPages = 0, onReport,
}) {
  const [doc, setDoc] = useState(null); // { html, pageCount }
  const [loading, setLoading] = useState(true);
  const reportRef = useRef(onReport);
  reportRef.current = onReport;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const { paged, report } = await renderAndValidate(data, templateId, {
          pageMode: toPageMode(mode), size,
        });
        if (!alive) return;
        const shown = maxPages > 0 ? { ...paged, pages: paged.pages.slice(0, maxPages) } : paged;
        setDoc({ html: composePagedDocumentHTML(shown), pageCount: paged.pageCount });
        reportRef.current?.(report, paged);
      } catch {
        if (alive) setDoc(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [data, templateId, mode, size, maxPages]);

  const pg = PAGE_SIZES[size] || PAGE_SIZES.a4;
  const pages = doc ? (maxPages > 0 ? Math.min(doc.pageCount, maxPages) : doc.pageCount) : 1;
  const w = Math.round(pg.width * scale);
  const h = Math.round((pg.height + 32) * pages * scale + 16);

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ width: w, height: h }}>
      {doc && (
        <iframe
          title={title}
          srcDoc={doc.html}
          scrolling="no"
          style={{
            width: pg.width, height: Math.round(h / scale),
            transform: `scale(${scale})`, transformOrigin: 'top left',
            border: 0, pointerEvents: 'none', background: '#e9edf5',
          }}
        />
      )}
      {loading && (
        <div className="absolute inset-0 grid place-items-center bg-[#0d1018]/40">
          <Loader2 size={18} className="animate-spin text-slate-300" />
        </div>
      )}
    </div>
  );
}

/* Back-compat wrapper used by Editor's live preview. */
export function ResumePaper({ data, templateId, mode = 'auto', scale = 1, className = '', title = 'preview', onReport }) {
  return (
    <PaginatedResumePreview
      data={data} templateId={templateId} mode={mode} scale={scale}
      className={className} title={title} onReport={onReport}
    />
  );
}

/* ================================================================== */
/* Structural thumbnail — generated from template METADATA, never from */
/* real resume text squeezed tiny.                                     */
/* ================================================================== */
export function TemplateThumb({ template }) {
  const t = template.theme || {};
  const accent = t.accent || '#334155';
  const band = t.headerBand;
  const center = t.headerAlign === 'center';
  const chips = t.skillsStyle === 'chips';
  const sections = (template.sections || []).filter((s) => s !== 'Header').slice(0, 5);

  const Bar = ({ w = '100%', h = 3, c = '#cbd5e1', r = 2, style }) => (
    <div style={{ width: w, height: h, background: c, borderRadius: r, ...style }} />
  );

  return (
    <div className="flex h-[176px] items-center justify-center border-b border-white/8 bg-[#0d1018] p-3">
      <div className="flex h-full w-[118px] flex-col overflow-hidden rounded-[3px] bg-white shadow-[0_2px_14px_rgba(0,0,0,.45)]">
        {/* header */}
        <div
          className="flex flex-col gap-[3px] px-2.5 pt-2.5 pb-1.5"
          style={band ? { background: band.bg || accent, alignItems: center ? 'center' : 'flex-start' } : { alignItems: center ? 'center' : 'flex-start' }}
        >
          <Bar w="58%" h={5} c={band ? '#fff' : '#0f172a'} />
          <Bar w="76%" h={2.5} c={band ? 'rgba(255,255,255,.7)' : '#94a3b8'} />
        </div>
        {/* sections */}
        <div className="flex flex-1 flex-col gap-[7px] px-2.5 py-1.5">
          {sections.map((s, i) => (
            <div key={s} className="flex flex-col gap-[3px]">
              <div className="flex items-center gap-[3px]">
                {t.sectionStyle === 'bar' && <Bar w={3} h={6} c={accent} r={1} />}
                <Bar w={i % 2 ? '40%' : '34%'} h={3.5} c={accent} />
              </div>
              {t.sectionStyle === 'rule' && <Bar h={1} c="#e2e8f0" r={0} />}
              {chips && i === 1 ? (
                <div className="flex flex-wrap gap-[3px]">
                  {[22, 16, 26, 18].map((cw, j) => <Bar key={j} w={cw} h={5} c="#e2e8f0" r={3} />)}
                </div>
              ) : (
                <>
                  <Bar w="96%" h={2.2} c="#cbd5e1" />
                  <Bar w={i % 2 ? '78%' : '88%'} h={2.2} c="#cbd5e1" />
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Template card + gallery — labels, never fake ATS numbers            */
/* ================================================================== */
function badgeTone(b) {
  if (/ats-safe/i.test(b)) return 'mint';
  if (/visual/i.test(b)) return 'amber';
  if (/two-page|multi/i.test(b)) return 'violet';
  return 'cyan';
}

export function TemplateCard({ template, selected, recommended, locked, onSelect, onPreview }) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border transition ${selected ? 'border-aurora-violet/60 ring-1 ring-aurora-violet/30 bg-aurora-violet/5' : 'border-white/10 bg-white/[0.02] hover:border-white/20'}`}>
      <button type="button" className="relative text-left" onClick={() => onPreview?.(template.id)} title="Open full preview">
        <TemplateThumb template={template} />
        {recommended && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-aurora-mint/15 px-1.5 py-0.5 text-[9px] font-semibold text-aurora-mint ring-1 ring-aurora-mint/30">
            <Star size={8} fill="#46E6A6" /> Recommended
          </span>
        )}
        {locked && (
          <span className="absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-amber-glow ring-1 ring-amber-glow/30">Pro</span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <p className="text-[13px] font-semibold text-white">{template.name}</p>
          <p className="mt-0.5 line-clamp-1 text-[10.5px] text-slate-500">
            Best for {(template.bestFor || []).slice(0, 3).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {(template.badges || []).slice(0, 3).map((b) => (
            <Badge key={b} tone={badgeTone(b)} className="text-[9px]">
              {/ats-safe/i.test(b) && <Shield size={8} className="mr-0.5 inline" />}{b}
            </Badge>
          ))}
        </div>
        <div className="mt-auto flex gap-2 pt-1">
          <button onClick={() => onPreview?.(template.id)} className="flex-1 rounded-lg border border-white/12 py-1.5 text-[11px] font-medium text-slate-300 transition hover:bg-white/8">
            <Eye size={11} className="mr-1 inline" /> Preview
          </button>
          <button onClick={() => onSelect?.(template.id)} className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition ${selected ? 'bg-aurora-violet/25 text-white ring-1 ring-aurora-violet/40' : 'btn-primary text-white hover:brightness-110'}`}>
            {selected ? <><Check size={11} className="mr-1 inline" /> Selected</> : 'Use'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TemplateGallery({ selectedId, recommendedId, onSelect, onPreview, customCard, allowance = Infinity }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {TEMPLATES.map((tpl, idx) => (
        <TemplateCard
          key={tpl.id}
          template={tpl}
          selected={selectedId === tpl.id}
          recommended={recommendedId === tpl.id}
          locked={allowance !== Infinity && idx >= allowance}
          onSelect={onSelect}
          onPreview={onPreview}
        />
      ))}
      {customCard}
    </div>
  );
}

/* ================================================================== */
/* Validation summary panel (modal + editor reuse)                     */
/* ================================================================== */
export function ValidationSummary({ report, compact = false }) {
  if (!report) return null;
  const ok = report.valid && report.errors.length === 0;
  return (
    <div className={`rounded-xl border p-3 text-[11px] leading-snug ${ok ? 'border-aurora-mint/25 bg-aurora-mint/8 text-slate-200' : 'border-amber-glow/30 bg-amber-glow/8 text-slate-200'}`}>
      <p className="flex items-center gap-1.5 font-semibold text-white">
        {ok ? <><Check size={12} className="text-aurora-mint" /> Layout validated — {report.pageCount} page{report.pageCount > 1 ? 's' : ''}, no overlap or cropping</>
          : <><FileWarning size={12} className="text-amber-glow" /> Layout check: {report.errors.length} error{report.errors.length === 1 ? '' : 's'}, {report.warnings.length} warning{report.warnings.length === 1 ? '' : 's'}</>}
      </p>
      {!compact && report.errors.slice(0, 4).map((e, i) => (
        <p key={`e${i}`} className="mt-1 flex items-start gap-1.5 text-red-300"><AlertTriangle size={11} className="mt-[1px] shrink-0" /> {e}</p>
      ))}
      {!compact && report.warnings.slice(0, 3).map((w, i) => (
        <p key={`w${i}`} className="mt-1 flex items-start gap-1.5 text-amber-glow"><AlertTriangle size={11} className="mt-[1px] shrink-0" /> {w}</p>
      ))}
      {!compact && report.recommendations.slice(0, 2).map((r, i) => (
        <p key={`r${i}`} className="mt-1 text-slate-400">→ {r}</p>
      ))}
    </div>
  );
}

/* ================================================================== */
/* Full preview modal — A4/Letter, zoom, page count, validation,       */
/* ATS label, section list, exports gated on validation.               */
/* ================================================================== */
const ZOOMS = [0.45, 0.6, 0.75, 0.9];

export function TemplatePreviewModal({ open, onClose, data, templateId, onUse, canDocx = true, onDocxBlocked }) {
  const tpl = getTemplate(templateId);
  const [size, setSize] = useState('a4');
  const [mode, setMode] = useState('auto');
  const [zoomIdx, setZoomIdx] = useState(1);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState('');
  const [exportErr, setExportErr] = useState('');

  useEffect(() => { if (open) { setReport(null); setExportErr(''); setMode('auto'); } }, [open, templateId]);

  const hasErrors = !!report && !report.valid;
  const sections = (tpl.sections || []).filter((s) => s !== 'Header');

  const guardedExport = async (kind) => {
    setExportErr('');
    if (hasErrors) {
      setExportErr('Export blocked — fix the layout errors above (switch to multi-page or reduce content). Content is never silently cropped.');
      return;
    }
    if (report && report.warnings.length > 0 && kind !== 'docx') {
      // warn but allow — warnings are non-critical by definition
    }
    setBusy(kind);
    try {
      const fileBase = `${(data?.personalInfo?.name || data?.name || 'resume').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'resume'}-${tpl.id}`;
      if (kind === 'pdf') await exportResumePDF(data, tpl.id, { pageMode: toPageMode(mode), size, fileName: `${fileBase}.pdf` });
      else if (kind === 'snapshot') await exportResumeSnapshotPDF(data, tpl.id, { pageMode: toPageMode(mode), size, fileName: `${fileBase}.pdf` });
      else if (kind === 'docx') {
        if (!canDocx) { onDocxBlocked?.(); return; }
        exportResumeDOCX(data, tpl.id, { fileName: `${fileBase}.doc` });
      }
    } catch (e) {
      setExportErr('Export failed: ' + (e?.message || e));
    } finally { setBusy(''); }
  };

  return (
    <Modal open={open} onClose={onClose} title={tpl.name} width="max-w-5xl">
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* left rail: meta + controls + validation */}
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={tpl.atsSafe ? 'mint' : 'amber'} className="text-[10px]">
              <Shield size={9} className="mr-0.5 inline" /> {tpl.atsSafe ? 'ATS-safe' : 'Visual, not ATS-first'}
            </Badge>
            {(tpl.badges || []).filter((b) => !/ats-safe|visual/i.test(b)).map((b) => (
              <Badge key={b} tone={badgeTone(b)} className="text-[10px]">{b}</Badge>
            ))}
          </div>
          <p className="text-[12px] leading-relaxed text-slate-400">{tpl.description}</p>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Page size</p>
            <div className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-[11px]">
              {['a4', 'letter'].map((s) => (
                <button key={s} onClick={() => setSize(s)} className={`flex-1 rounded-md px-2 py-1 transition ${size === s ? 'bg-aurora-cyan/20 text-white' : 'text-slate-400'}`}>{s.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Page mode</p>
            <div className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-[11px]">
              {[['auto', 'Auto'], ['single', 'One page'], ['multi', 'Multi']].map(([v, l]) => (
                <button key={v} onClick={() => setMode(v)} className={`flex-1 rounded-md px-2 py-1 transition ${mode === v ? 'bg-aurora-violet/25 text-white' : 'text-slate-400'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Zoom</p>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setZoomIdx((z) => Math.max(0, z - 1))} className="rounded-md border border-white/12 p-1 text-slate-300 hover:bg-white/8"><ZoomOut size={12} /></button>
              <span className="w-9 text-center text-[11px] text-slate-300">{Math.round(ZOOMS[zoomIdx] * 100)}%</span>
              <button onClick={() => setZoomIdx((z) => Math.min(ZOOMS.length - 1, z + 1))} className="rounded-md border border-white/12 p-1 text-slate-300 hover:bg-white/8"><ZoomIn size={12} /></button>
            </div>
          </div>

          <ValidationSummary report={report} />
          {report?.fit?.message && (
            <p className="rounded-xl border border-amber-glow/30 bg-amber-glow/8 p-2.5 text-[11px] text-amber-glow">{report.fit.message}</p>
          )}

          <div>
            <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500"><ListChecks size={11} /> Sections</p>
            <div className="flex flex-wrap gap-1">
              {sections.map((s) => <span key={s} className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-slate-400 ring-1 ring-white/8">{s}</span>)}
            </div>
          </div>

          {exportErr && <p className="flex items-start gap-1.5 text-[11px] text-amber-glow"><AlertTriangle size={12} className="mt-[1px] shrink-0" /> {exportErr}</p>}

          <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
            <Button onClick={() => { onUse?.(tpl.id); onClose?.(); }}><Check size={14} /> Use this template</Button>
            <div className="flex gap-2">
              <Button variant="soft" className="flex-1" disabled={busy === 'pdf' || hasErrors} onClick={() => guardedExport('pdf')} title={hasErrors ? 'Fix layout errors first' : 'Print-quality PDF with selectable text'}>
                <Download size={13} /> {busy === 'pdf' ? 'Opening…' : 'PDF'}
              </Button>
              <Button variant="soft" className="flex-1" disabled={busy === 'docx' || hasErrors} onClick={() => guardedExport('docx')}>
                <FileType2 size={13} /> DOCX
              </Button>
            </div>
            {hasErrors && <p className="text-[10px] text-amber-glow">Exports are blocked while the layout has errors — content is never silently cropped.</p>}
          </div>
        </div>

        {/* right: real rendered, paginated preview */}
        <div className="max-h-[72vh] overflow-auto rounded-xl border border-white/10 bg-[#e9edf5] p-3">
          <div className="flex justify-center">
            <PaginatedResumePreview
              data={data}
              templateId={tpl.id}
              mode={mode}
              size={size}
              scale={ZOOMS[zoomIdx]}
              onReport={(r) => setReport(r)}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
