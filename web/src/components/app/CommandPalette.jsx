import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, CornerDownLeft, ArrowUp, ArrowDown, Command as CommandIcon,
  Sparkles, FileText, Wand2, Briefcase, Rocket, Send, LifeBuoy,
} from 'lucide-react';
import { NAV } from './Shell.jsx';
import { useSupport } from '../../support/SupportProvider.jsx';
import { getPlan } from '../../lib/plan.js';

/* ============================================================
   Global command palette / AI action bar (⌘K · Ctrl K).
   Purely additive: navigates via the existing onPick(id) flow
   and the existing NAV table — touches no business logic, no
   API, no state stores. Only uses deps already in package.json
   (react, framer-motion, lucide-react).

   Body-scroll handling mirrors the documented SupportWidget fix:
   every close path restores body styles, and the effect cleanup
   runs on unmount too, so no scroll-lock can ever be left behind.
   ============================================================ */

// Quick "do" actions that jump straight into a workspace's primary task.
// All targets are real NAV ids, so they can never dangle.
const QUICK_ACTIONS = [
  { id: 'qa-resume', label: 'Tailor / analyze my resume', target: 'resume', icon: FileText, hint: 'Resume Studio' },
  { id: 'qa-project', label: 'Start a new project with AI', target: 'projectcreator', icon: Wand2, hint: 'Project Creator' },
  { id: 'qa-jobs', label: 'Find matching jobs', target: 'jobs', icon: Briefcase, hint: 'Job Hunt' },
  { id: 'qa-roadmap', label: 'Open my project roadmap', target: 'projectstudio', icon: Rocket, hint: 'Project Studio' },
  { id: 'qa-outreach', label: 'Draft recruiter outreach', target: 'contacts', icon: Send, hint: 'Outreach' },
];

// Lightweight subsequence fuzzy match — good enough for a nav palette,
// zero dependencies. Returns true if every char of q appears in order in s.
function fuzzy(q, s) {
  if (!q) return true;
  q = q.toLowerCase();
  s = s.toLowerCase();
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) i++;
  }
  return i === q.length;
}

export default function CommandPalette({ open, setOpen, onPick }) {
  const support = useSupport();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const close = useCallback(() => {
    setOpen(false);
    if (typeof document !== 'undefined') document.body.style.overflow = '';
  }, [setOpen]);

  // Build the flat, filtered, grouped result list.
  const groups = useMemo(() => {
    // Admin-only workspaces (e.g. the User Directory) must never surface in the
    // palette for non-admins — the server still enforces access, this keeps the
    // UI honest too.
    const isAdmin = !!getPlan().isAdmin;
    const navItems = NAV
      .filter((n) => !n.adminOnly || isAdmin)
      .filter((n) => fuzzy(q, n.label) || fuzzy(q, n.id))
      .map((n) => ({ key: `nav-${n.id}`, label: n.label, icon: n.icon, hint: 'Workspace', run: () => onPick(n.id) }));

    const quick = QUICK_ACTIONS
      .filter((a) => fuzzy(q, a.label) || fuzzy(q, a.hint))
      .map((a) => ({ key: a.id, label: a.label, icon: a.icon, hint: a.hint, run: () => onPick(a.target) }));

    const help = [{ key: 'open-support', label: 'Open support assistant', icon: LifeBuoy, hint: 'Help', run: () => support?.openSupport?.({ tab: 'chat' }) }]
      .filter((a) => fuzzy(q, a.label) || fuzzy(q, a.hint));

    const out = [];
    if (quick.length) out.push({ heading: 'Quick actions', items: quick });
    if (navItems.length) out.push({ heading: 'Go to', items: navItems });
    if (help.length) out.push({ heading: 'Help', items: help });
    return out;
  }, [q, onPick, support]);

  // Flat list for keyboard navigation.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Reset cursor whenever the result set changes.
  useEffect(() => { setCursor(0); }, [q, open]);

  // Focus the input + lock body scroll while open; always restore on close/unmount.
  useEffect(() => {
    if (!open) { document.body.style.overflow = ''; return undefined; }
    setQ('');
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(t); document.body.style.overflow = ''; };
  }, [open]);

  const choose = useCallback((item) => {
    if (!item) return;
    close();
    // run after close so navigation isn't fighting the unmount animation
    requestAnimationFrame(() => item.run());
  }, [close]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); choose(flat[cursor]); }
  };

  // keep the highlighted row in view
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  let runningIndex = -1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-start justify-center p-3 pt-[12vh] sm:p-4 sm:pt-[14vh]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} aria-hidden="true" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="panel relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden p-0 shadow-lift"
          >
            {/* search row */}
            <div className="flex items-center gap-3 border-b border-white/10 px-4">
              <Search size={18} className="shrink-0 text-aurora-cyan" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search workspaces or type a command…"
                className="h-14 flex-1 bg-transparent text-[15px] text-slate-100 placeholder:text-slate-500 outline-none"
              />
              <kbd className="hidden shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-slate-400 sm:flex">
                ESC
              </kbd>
            </div>

            {/* results */}
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
              {flat.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                  <Sparkles size={22} className="text-slate-600" />
                  <p className="text-sm text-slate-400">No matches for “{q}”.</p>
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.heading} className="px-2 pb-1">
                    <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g.heading}</p>
                    {g.items.map((item) => {
                      runningIndex += 1;
                      const active = runningIndex === cursor;
                      const idx = runningIndex;
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.key}
                          data-active={active}
                          onMouseEnter={() => setCursor(idx)}
                          onClick={() => choose(item)}
                          className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                            active ? 'bg-aurora-violet/15 text-white ring-1 ring-aurora-violet/25' : 'text-slate-300 hover:bg-white/[0.04]'
                          }`}
                        >
                          {Icon && <Icon size={17} className={active ? 'text-aurora-cyan' : 'text-slate-500'} />}
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.hint && <span className="shrink-0 text-[11px] text-slate-500">{item.hint}</span>}
                          {active && <CornerDownLeft size={14} className="shrink-0 text-slate-500" />}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* footer hints */}
            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-2.5 text-[11px] text-slate-500">
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1"><ArrowUp size={11} /><ArrowDown size={11} /> navigate</span>
                <span className="flex items-center gap-1"><CornerDownLeft size={11} /> select</span>
              </span>
              <span className="flex items-center gap-1"><CommandIcon size={11} /> Career Autopilot</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
