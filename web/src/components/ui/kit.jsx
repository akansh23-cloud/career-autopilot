import { forwardRef, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

const cx = (...a) => a.filter(Boolean).join(' ');

/* ---------------- Button ---------------- */
export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', className, children, ...props }, ref) {
  const base =
    'relative inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora-violet/60';
  const sizes = { sm: 'h-9 px-3.5 text-[13px]', md: 'h-11 px-5 text-sm', lg: 'h-12 px-7 text-[15px]' };
  const variants = {
    primary: 'btn-primary hover:brightness-105 hover:-translate-y-0.5',
    ghost: 'text-slate-200/80 hover:text-white hover:bg-white/5',
    outline: 'border border-white/14 text-slate-100 hover:bg-white/5 hover:border-aurora-violet/40',
    soft: 'bg-white/[0.06] text-slate-100 hover:bg-white/10 border border-white/8',
    danger: 'bg-rose-500/15 text-rose-300 border border-rose-400/30 hover:bg-rose-500/25',
  };
  return (
    <button ref={ref} className={cx(base, sizes[size], variants[variant], className)} {...props}>
      {children}
    </button>
  );
});

/* ---------------- Card ---------------- */
export function Card({ className, hover, glow, spotlight, children, onMouseMove, ...p }) {
  const useSpot = spotlight === undefined ? hover : spotlight;
  const move = (e) => {
    if (useSpot) {
      const r = e.currentTarget.getBoundingClientRect();
      e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
      e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
    }
    onMouseMove?.(e);
  };
  return (
    <div
      onMouseMove={move}
      className={cx(
        'gradient-border p-5 shadow-card',
        useSpot && 'spotlight',
        hover && 'lift hover:shadow-lift hover:border-aurora-violet/35 cursor-default',
        glow && 'shadow-glow',
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
    default: 'bg-white/6 text-slate-300 border-white/10',
    violet: 'bg-aurora-violet/14 text-[#FFD49A] border-aurora-violet/35',
    cyan: 'bg-aurora-cyan/12 text-[#9DEDE2] border-aurora-cyan/30',
    mint: 'bg-aurora-mint/12 text-[#A7F2CE] border-aurora-mint/30',
    amber: 'bg-amber-glow/14 text-[#FFE0A0] border-amber-glow/35',
    rose: 'bg-rose-500/12 text-rose-300 border-rose-400/30',
  };
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide', tones[tone], className)}>
      {children}
    </span>
  );
}

/* ---------------- Spinner ---------------- */
export function Spinner({ className }) {
  return (
    <span className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-aurora-violet/30 border-t-aurora-violet', className)} />
  );
}

/* ---------------- Skeleton ---------------- */
export function Skeleton({ className }) {
  return (
    <div className={cx('relative overflow-hidden rounded-lg bg-white/[0.05]', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
    </div>
  );
}

/* ---------------- Avatar ---------------- */
export function Avatar({ src, name = '', size = 36 }) {
  const initials = name.split(' ').map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'U';
  const [err, setErr] = useState(false);
  const style = { width: size, height: size };
  if (src && !err)
    return <img src={src} alt={name} style={style} onError={() => setErr(true)} className="rounded-full object-cover ring-2 ring-aurora-violet/20" />;
  return (
    <div style={style} className="grid place-items-center rounded-full bg-aurora-cta text-[12px] font-bold text-ink-950 ring-2 ring-white/15">
      {initials}
    </div>
  );
}

/* ---------------- Dropdown ---------------- */
export function Dropdown({ trigger, children, align = 'right' }) {
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
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            onClick={() => setOpen(false)}
            className={cx(
              'absolute z-50 mt-2 min-w-[220px] overflow-hidden rounded-2xl border border-white/10 bg-ink-850/95 p-1.5 shadow-lift backdrop-blur-xl',
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
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors',
        danger ? 'text-rose-300 hover:bg-rose-500/10' : 'text-slate-200 hover:bg-white/6'
      )}
      {...p}
    >
      {Icon && <Icon size={16} className="opacity-80" />}
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
        >
          <div className="absolute inset-0 bg-black/72 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 280, damping: 26 }}
            className={cx('relative flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden panel p-0 shadow-lift sm:max-h-[calc(100dvh-2rem)]', width)}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-ink-900/95 px-5 py-4 backdrop-blur-xl sm:px-6">
                <h3 className="pr-4 text-lg font-semibold text-white">{title}</h3>
                <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/8 hover:text-white">
                  <X size={18} />
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
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
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/12 px-6 py-14 text-center">
      {Icon && (
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-aurora-violet/10 text-aurora-violet ring-1 ring-aurora-violet/25">
          <Icon size={24} />
        </div>
      )}
      <p className="text-[15px] font-medium text-slate-200">{title}</p>
      {hint && <p className="mt-1.5 max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ---------------- Input ---------------- */
export function Input({ className, ...p }) {
  return (
    <input
      className={cx(
        'h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-aurora-violet/55 focus:bg-white/[0.05] focus:ring-2 focus:ring-aurora-violet/20',
        className
      )}
      {...p}
    />
  );
}
export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
