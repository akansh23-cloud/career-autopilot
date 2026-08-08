// Guided Project Workspace — starter code preview + starter pack preview.
import { useState } from 'react';
import { Copy, Check, Download } from 'lucide-react';
import { Modal, Button, Badge, Spinner } from '../ui/kit.jsx';
import { NoticeBar } from './workspaceBits.jsx';

export function CodePreviewPanel({ open, onClose, loading, generatedFiles = [], warnings = [] }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const file = generatedFiles[Math.min(active, Math.max(0, generatedFiles.length - 1))];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file?.content || '');
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  const downloadFile = () => {
    if (!file) return;
    const blob = new Blob([file.content || ''], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (file.path || 'starter-file.txt').split('/').pop();
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Modal open={open} onClose={onClose} title="Starter code preview" width="max-w-4xl">
      <NoticeBar tone="warn">Template-based <strong>starter code</strong> with TODOs — generated, not verified work. Previewing or downloading it does not complete any task.</NoticeBar>
      {loading ? (
        <div className="grid place-items-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : (
        <>
          {generatedFiles.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {generatedFiles.map((f, i) => (
                <button key={f.path} onClick={() => setActive(i)}
                  className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] transition ${i === active ? 'border-aurora-violet/40 bg-aurora-violet/10 text-fg' : 'border-subtle text-fg-secondary hover:bg-surface-1'}`}>
                  {f.path}
                </button>
              ))}
            </div>
          )}
          {file && (
            <>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[12px] text-fg-secondary">{file.path}</span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} Copy</Button>
                  <Button variant="ghost" size="sm" onClick={downloadFile}><Download size={14} /> Download file</Button>
                </div>
              </div>
              <pre className="mt-2 max-h-[50vh] overflow-auto rounded-xl bg-sunken p-4 font-mono text-[11.5px] leading-relaxed text-fg">{file.content}</pre>
            </>
          )}
          {!generatedFiles.length && <p className="mt-4 text-center text-[13px] text-fg-muted">No template is available for this selection yet.</p>}
          {warnings.length > 0 && (
            <ul className="mt-3 space-y-1">{warnings.map((w, i) => <li key={i} className="text-[12px] text-amber-200/80">• {w}</li>)}</ul>
          )}
        </>
      )}
    </Modal>
  );
}

export function StarterPackPreview({ open, onClose, loading, files = [], setupCommands = [], warnings = [], onDownload, downloading }) {
  return (
    <Modal open={open} onClose={onClose} title="Starter Pack preview" width="max-w-2xl">
      <NoticeBar tone="warn">This is a <strong>starter skeleton, not a completed project</strong>. Downloading it does not mark anything Done or Verified, and grants no XP.</NoticeBar>
      {loading ? (
        <div className="grid place-items-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : (
        <>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Included files ({files.length})</span>
              <Badge tone="cyan">Templates only</Badge>
            </div>
            <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-xl border border-subtle bg-sunken p-3">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between font-mono text-[11.5px]">
                  <span className="truncate text-fg-secondary">{typeof f === 'string' ? f : f.path}</span>
                  {f.bytes != null && <span className="shrink-0 text-fg-muted">{f.bytes} B</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Setup commands</span>
            <pre className="mt-1.5 rounded-xl bg-sunken p-3 font-mono text-[12px] text-fg">{(setupCommands || []).join('\n')}</pre>
          </div>
          {warnings.length > 0 && (
            <ul className="mt-3 space-y-1">{warnings.map((w, i) => <li key={i} className="text-[12px] text-amber-200/80">• {w}</li>)}</ul>
          )}
          {onDownload && (
            <div className="mt-5 flex justify-end">
              <Button onClick={onDownload} disabled={downloading}>
                {downloading ? <Spinner className="h-4 w-4" /> : <Download size={15} />} Download ZIP
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
