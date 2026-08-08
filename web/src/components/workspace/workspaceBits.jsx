// Guided Project Workspace — small shared UI bits.
import { Badge } from '../ui/kit.jsx';
import { STATUS_TONE, statusLabel } from '../../lib/workspaceSelectors.js';

export function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONE[status] || 'default'}>{statusLabel(status)}</Badge>;
}

export function KeyVal({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">{label}</span>
      <div className="text-[13px] leading-relaxed text-fg-secondary">{children || <span className="text-fg-muted">—</span>}</div>
    </div>
  );
}

export function ChipList({ items = [], empty = '—' }) {
  if (!items?.length) return <span className="text-[12px] text-fg-muted">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((x, i) => (
        <span key={i} className="rounded-full border border-subtle bg-surface-1 px-2 py-0.5 text-[11px] text-fg-secondary">{String(x)}</span>
      ))}
    </div>
  );
}

export function ItemRow({ title, sub, badge, selected, onClick, right }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition
        ${selected ? 'border-aurora-violet/40 bg-aurora-violet/10' : 'border-subtle bg-surface-1 hover:border-strong hover:bg-surface-1'}`}
    >
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-fg">{title}</div>
        {sub && <div className="mt-0.5 truncate text-[12px] text-fg-muted">{sub}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {right}
        {badge}
      </div>
    </button>
  );
}

export function SectionTitle({ children, hint }) {
  return (
    <div className="mb-4">
      <h3 className="font-display text-lg font-bold text-fg">{children}</h3>
      {hint && <p className="mt-1 text-[12.5px] text-fg-muted">{hint}</p>}
    </div>
  );
}

export function NoticeBar({ tone = 'default', children }) {
  const cls = tone === 'warn'
    ? 'border-amber-glow/30 bg-amber-glow/8 text-[#F3E3B2]'
    : 'border-subtle bg-surface-1 text-fg-secondary';
  return <div className={`rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-relaxed ${cls}`}>{children}</div>;
}
