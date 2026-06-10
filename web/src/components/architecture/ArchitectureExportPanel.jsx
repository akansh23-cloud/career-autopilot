// Architecture Diagram OS — export panel for the active view.
// JSON + Mermaid are produced client-side (instant copy, works offline).
// SVG comes from the deterministic backend exporter so the downloaded file
// matches the server-rendered layout exactly.
import { useState } from 'react';
import { Copy, Check, Download, Loader2 } from 'lucide-react';
import { Button } from '../ui/kit.jsx';
import { viewToMermaid } from '../../lib/architectureSpec.js';
import { Architecture } from '../../lib/api.js';

export default function ArchitectureExportPanel({ spec, view }) {
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!spec || !view) return null;

  const copy = async (kind, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(''), 1800);
    } catch {
      setErr('Clipboard unavailable — select and copy from the source below.');
    }
  };

  const downloadSvg = async () => {
    setBusy(true); setErr('');
    try {
      const data = await Architecture.exportView(spec, view.id || view.type, 'svg');
      const blob = new Blob([data.content], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename || `${view.type}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e?.message || 'SVG export failed.');
    } finally {
      setBusy(false);
    }
  };

  const mermaid = viewToMermaid(view);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => copy('json', JSON.stringify(view, null, 2))}>
          {copied === 'json' ? <Check size={14} /> : <Copy size={14} />} Copy JSON
        </Button>
        <Button variant="ghost" onClick={() => copy('mermaid', mermaid)}>
          {copied === 'mermaid' ? <Check size={14} /> : <Copy size={14} />} Copy Mermaid
        </Button>
        <Button variant="ghost" onClick={downloadSvg} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download SVG
        </Button>
      </div>
      {err && <p className="text-[12px] text-amber-glow">{err}</p>}
      <details>
        <summary className="cursor-pointer text-[11px] text-slate-500">Mermaid source</summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-white/8 bg-ink-950/60 p-3 text-[11px] text-slate-400">{mermaid}</pre>
      </details>
    </div>
  );
}
