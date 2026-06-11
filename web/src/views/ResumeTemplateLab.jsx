import { useEffect, useMemo, useState } from 'react';
import {
  FlaskConical, Check, AlertTriangle, Loader2, Eye, Shield, RefreshCw, Lock,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Badge, Button } from '../components/ui/kit.jsx';
import { isAdmin } from '../lib/plan.js';
import { RESUME_TEMPLATES } from '../lib/resumeTemplateRegistry.js';
import { RESUME_FIXTURES } from '../lib/resumeFixtures.js';
import { renderAndValidate } from '../lib/resumeRenderer.js';
import { TemplatePreviewModal } from '../components/ResumeTemplates.jsx';

/* ------------------------------------------------------------------ */
/* Resume Template Lab — internal QA page (admin only, not in nav).    */
/* Renders ALL templates against ALL fixtures with the production       */
/* renderer + validator and shows export readiness per cell.            */
/* Deep link: #/resume-template-lab                                     */
/* ------------------------------------------------------------------ */

function statusOf(cell) {
  if (!cell) return 'pending';
  if (cell.error) return 'crash';
  if (!cell.report.valid) return 'fail';
  if (cell.report.warnings.length > 0) return 'warn';
  return 'pass';
}

const STATUS_UI = {
  pass: { label: 'PASS', cls: 'bg-aurora-mint/12 text-aurora-mint ring-aurora-mint/30' },
  warn: { label: 'WARN', cls: 'bg-amber-glow/12 text-amber-glow ring-amber-glow/30' },
  fail: { label: 'FAIL', cls: 'bg-red-500/12 text-red-300 ring-red-400/30' },
  crash: { label: 'ERR', cls: 'bg-red-500/20 text-red-200 ring-red-400/40' },
  pending: { label: '…', cls: 'bg-white/5 text-slate-500 ring-white/10' },
};

export default function ResumeTemplateLab() {
  const admin = isAdmin();
  const [results, setResults] = useState({}); // `${tplId}::${fixId}` -> { report, paged } | { error }
  const [running, setRunning] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [detail, setDetail] = useState(null); // { tplId, fixId }
  const [preview, setPreview] = useState(null); // { tplId, fixId }

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    setRunning(true);
    setResults({});
    (async () => {
      for (const tpl of RESUME_TEMPLATES) {
        for (const fix of RESUME_FIXTURES) {
          if (!alive) return;
          const key = `${tpl.id}::${fix.id}`;
          try {
            // sequential on purpose: each run mounts a hidden DOM host
            // eslint-disable-next-line no-await-in-loop
            const { paged, report } = await renderAndValidate(fix.data, tpl.id, { pageMode: 'auto' });
            if (!alive) return;
            setResults((r) => ({ ...r, [key]: { report, pageCount: paged.pageCount, fit: paged.fit } }));
          } catch (e) {
            if (!alive) return;
            setResults((r) => ({ ...r, [key]: { error: e?.message || String(e) } }));
          }
          // yield to keep the UI responsive
          // eslint-disable-next-line no-await-in-loop
          await new Promise((res) => setTimeout(res, 10));
        }
      }
      if (alive) setRunning(false);
    })();
    return () => { alive = false; };
  }, [admin, runKey]);

  const totals = useMemo(() => {
    const t = { pass: 0, warn: 0, fail: 0, crash: 0, total: RESUME_TEMPLATES.length * RESUME_FIXTURES.length };
    Object.values(results).forEach((cell) => { const s = statusOf(cell); if (t[s] !== undefined) t[s] += 1; });
    return t;
  }, [results]);

  if (!admin) {
    return (
      <div className="grid place-items-center py-24 text-center">
        <Lock size={26} className="mb-3 text-slate-500" />
        <p className="text-sm font-semibold text-white">Resume Template Lab is admin-only</p>
        <p className="mt-1 max-w-sm text-xs text-slate-500">This internal QA page verifies every template against every sample resume before release.</p>
      </div>
    );
  }

  const detailCell = detail ? results[`${detail.tplId}::${detail.fixId}`] : null;
  const previewFix = preview ? RESUME_FIXTURES.find((f) => f.id === preview.fixId) : null;

  return (
    <>
      <PageIntro
        title="Resume Template Lab"
        sub="Internal QA: every template rendered against every sample resume with the production renderer, validated for overlap, cropping, page breaks and export readiness."
      />

      <SectionCard
        title={<span className="flex items-center gap-2"><FlaskConical size={15} className="text-aurora-violet" /> Validation matrix</span>}
        action={
          <div className="flex items-center gap-2">
            {running
              ? <span className="flex items-center gap-1.5 text-[11px] text-aurora-cyan"><Loader2 size={12} className="animate-spin" /> Validating… {Object.keys(results).length}/{totals.total}</span>
              : <span className="text-[11px] text-slate-400">
                  <span className="text-aurora-mint">{totals.pass} pass</span> · <span className="text-amber-glow">{totals.warn} warn</span> · <span className="text-red-300">{totals.fail + totals.crash} fail</span>
                </span>}
            <Button size="sm" variant="soft" onClick={() => setRunKey((k) => k + 1)} disabled={running}><RefreshCw size={12} /> Re-run</Button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className="sticky left-0 bg-[#0b0e16] px-2 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Template</th>
                {RESUME_FIXTURES.map((f) => (
                  <th key={f.id} className="px-1.5 py-2 text-[9.5px] font-medium leading-tight text-slate-500">{f.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RESUME_TEMPLATES.map((tpl) => (
                <tr key={tpl.id} className="border-t border-white/5">
                  <td className="sticky left-0 bg-[#0b0e16] px-2 py-1.5">
                    <p className="text-[12px] font-medium text-white">{tpl.name}</p>
                    <p className="text-[9.5px] text-slate-500">
                      {tpl.atsSafe ? <span className="text-aurora-mint"><Shield size={8} className="inline" /> ATS-safe</span> : <span className="text-amber-glow">Visual, not ATS-first</span>}
                    </p>
                  </td>
                  {RESUME_FIXTURES.map((fix) => {
                    const key = `${tpl.id}::${fix.id}`;
                    const cell = results[key];
                    const s = statusOf(cell);
                    const ui = STATUS_UI[s];
                    return (
                      <td key={fix.id} className="px-1 py-1.5">
                        <button
                          onClick={() => cell && setDetail({ tplId: tpl.id, fixId: fix.id })}
                          className={`flex w-full flex-col items-center gap-0.5 rounded-lg px-1.5 py-1.5 ring-1 transition hover:brightness-125 ${ui.cls}`}
                          title={cell?.error || (cell ? `${cell.report.errors.length} errors / ${cell.report.warnings.length} warnings` : 'pending')}
                        >
                          <span className="text-[10px] font-bold">{ui.label}</span>
                          {cell && !cell.error && <span className="text-[9px] opacity-80">{cell.pageCount} pg</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          PASS = export-ready, no overlap/crop/page-break errors. WARN = exportable with non-critical notes (e.g. one-page request rendered as two pages). FAIL = export blocked. Click any cell for details + live preview.
        </p>
      </SectionCard>

      {/* detail drawer */}
      {detail && detailCell && (
        <SectionCard
          title={`${RESUME_TEMPLATES.find((t) => t.id === detail.tplId)?.name} × ${RESUME_FIXTURES.find((f) => f.id === detail.fixId)?.name}`}
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="soft" onClick={() => setPreview(detail)}><Eye size={12} /> Open preview</Button>
              <Button size="sm" variant="soft" onClick={() => setDetail(null)}>Close</Button>
            </div>
          }
        >
          {detailCell.error ? (
            <p className="flex items-center gap-1.5 text-[12px] text-red-300"><AlertTriangle size={13} /> Render crashed: {detailCell.error}</p>
          ) : (
            <div className="grid gap-3 text-[12px] sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-slate-300">
                  {detailCell.report.valid
                    ? <span className="flex items-center gap-1.5 text-aurora-mint"><Check size={13} /> Export-ready · {detailCell.pageCount} page{detailCell.pageCount > 1 ? 's' : ''}</span>
                    : <span className="flex items-center gap-1.5 text-red-300"><AlertTriangle size={13} /> Export blocked · {detailCell.pageCount} page{detailCell.pageCount > 1 ? 's' : ''}</span>}
                </p>
                <p className="text-[11px] text-slate-500">
                  Overflow sections: {detailCell.report.overflowSections.length} · Clipped: {detailCell.report.clippedElements.length} · Overlapping: {detailCell.report.overlappingElements.length}
                </p>
                {detailCell.fit?.message && <p className="text-[11px] text-amber-glow">{detailCell.fit.message}</p>}
              </div>
              <div className="space-y-1">
                {detailCell.report.errors.map((e, i) => <p key={`e${i}`} className="flex items-start gap-1.5 text-red-300"><AlertTriangle size={12} className="mt-[2px] shrink-0" /> {e}</p>)}
                {detailCell.report.warnings.map((w, i) => <p key={`w${i}`} className="flex items-start gap-1.5 text-amber-glow"><AlertTriangle size={12} className="mt-[2px] shrink-0" /> {w}</p>)}
                {detailCell.report.recommendations.map((r, i) => <p key={`r${i}`} className="text-slate-400">→ {r}</p>)}
                {detailCell.report.valid && detailCell.report.warnings.length === 0 && (
                  <p className="text-slate-500">No issues — header, sections, bullets and page breaks all validated.</p>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {previewFix && (
        <TemplatePreviewModal
          open={!!preview}
          onClose={() => setPreview(null)}
          data={previewFix.data}
          templateId={preview.tplId}
          onUse={() => setPreview(null)}
        />
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {RESUME_FIXTURES.map((f) => <Badge key={f.id} tone="default" className="text-[10px]">{f.name}</Badge>)}
      </div>
    </>
  );
}
