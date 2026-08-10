import { forwardRef, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

const cx = (...a) => a.filter(Boolean).join(' ');

/* ============================================================
   UI KIT — shared primitives (v4, enterprise light)
   Same exported names/props as before so every view keeps
   working; the visual system is now restrained and consistent:
   9px control heights on a 4px grid, 1px borders, 6–12px radii,
   one indigo primary, quiet hover states, visible focus.
   ============================================================ */

/* ---------------- Button ---------------- */
export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', className, children, ...props }, ref) {
  const base =
    'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-elevated';
  const sizes = {
    xs: 'h-7 px-2.5 text-xs',
    sm: 'h-8 px-3 text-[13px]',
    md: 'h-9 px-3.5 text-sm',
    lg: 'h-10 px-4 text-sm',
  };
  const variants = {
    primary: 'btn-primary font-semibold',
    secondary: 'bg-sunken text-fg border border-subtle hover:bg-surface-hover hover:border-strong',
    soft: 'bg-sunken text-fg border border-subtle hover:bg-surface-hover hover:border-strong',
    outline: 'border border-strong bg-elevated text-fg hover:bg-surface-hover',
    ghost: 'text-fg-secondary hover:text-fg hover:bg-surface-hover',
    danger: 'bg-elevated text-danger border border-red-200 hover:bg-red-50 hover:border-red-300',
  };
  return (
    <button ref={ref} className={cx(base, sizes[size] || sizes.md, variants[variant] || variants.primary, className)} {...props}>
      {children}
    </button>
  );
});

/* ---------------- Card ---------------- */
export function Card({ className, hover, glow, spotlight, children, ...p }) {
  return (
    <div
      className={cx(
        'panel p-5',
        hover && 'lift cursor-default',
        className
      )}
      {...p}
    >
      {children}
    </div>
  );
}

/* ---------------- Badge ---------------- */
export function Badge({ tone = 'default', className, children }) {
  const tones = {
    default: 'bg-sunken text-fg-secondary border-subtle',
    violet: 'bg-indigo-50 text-brand border-indigo-200',
    cyan: 'bg-sky-50 text-info border-sky-200',
    mint: 'bg-emerald-50 text-ok border-emerald-200',
    amber: 'bg-amber-50 text-warn border-amber-200',
    rose: 'bg-red-50 text-danger border-red-200',
  };
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', tones[tone] || tones.default, className)}>
      {children}
    </span>
  );
}

/* ---------------- Spinner ---------------- */
export function Spinner({ className }) {
  return (
    <span className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-aurora-violet', className)} />
  );
}

/* ---------------- Skeleton ---------------- */
export function Skeleton({ className }) {
  return (
    <div className={cx('relative overflow-hidden rounded-md bg-sunken', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-elevated to-transparent opacity-70" />
    </div>
  );
}

/* ---------------- Avatar ---------------- */
export function Avatar({ src, name = '', size = 36 }) {
  const initials = name.split(' ').map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'U';
  const [err, setErr] = useState(false);
  const style = { width: size, height: size };
  if (src && !err)
    return <img src={src} alt={name} style={style} onError={() => setErr(true)} className="rounded-full border border-subtle object-cover" />;
  return (
    <div style={style} className="grid place-items-center rounded-full border border-indigo-200 bg-indigo-50 text-[12px] font-semibold text-brand">
      {initials}
    </div>
  );
}

/* ---------------- Dropdown ---------------- */
export function Dropdown({ trigger, children, align = 'right', direction = 'down' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="outline-none">{trigger}</button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: direction === 'up' ? -4 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: direction === 'up' ? -4 : 4 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            onClick={() => setOpen(false)}
            className={cx(
              'absolute z-50 min-w-[220px] overflow-hidden rounded-xl border border-subtle bg-menu p-1 shadow-lift',
              direction === 'up' ? 'bottom-full mb-1.5' : 'mt-1.5',
              align === 'right' ? 'right-0' : 'left-0'
            )}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
export function MenuItem({ icon: Icon, children, danger, ...p }) {
  return (
    <button
      className={cx(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
        danger ? 'text-danger hover:bg-red-50' : 'text-fg hover:bg-surface-hover'
      )}
      {...p}
    >
      {Icon && <Icon size={15} className="shrink-0 text-fg-muted" />}
      {children}
    </button>
  );
}

/* ---------------- Modal ---------------- */
export function Modal({ open, onClose, title, children, width = 'max-w-lg' }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', k);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', k);
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center overflow-hidden p-3 sm:p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-scrim" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
            role="dialog"
            aria-modal="true"
            className={cx('relative flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-xl border border-subtle bg-elevated shadow-lift sm:max-h-[calc(100dvh-2rem)]', width)}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-subtle bg-elevated px-5 py-3.5">
                <h3 className="pr-4 text-[15px] font-semibold text-fg">{title}</h3>
                <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg">
                  <X size={17} />
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------- EmptyState ---------------- */
export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-strong bg-sunken/50 px-6 py-12 text-center">
      {Icon && (
        <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg border border-subtle bg-elevated text-fg-muted">
          <Icon size={19} />
        </div>
      )}
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-fg-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------------- Input ---------------- */
export function Input({ className, ...p }) {
  return (
    <input
      className={cx(
        'h-9 w-full rounded-lg border border-field-border bg-field px-3 text-sm text-fg placeholder:text-fg-muted outline-none transition-colors focus:border-aurora-violet focus:ring-2 focus:ring-indigo-100',
        className
      )}
      {...p}
    />
  );
}
export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-fg-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-fg-muted">{hint}</span>}
    </label>
  );
}
