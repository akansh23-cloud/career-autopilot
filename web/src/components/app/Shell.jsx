import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FileText, PenLine, Briefcase, KanbanSquare, Send,
  Trophy, TrendingUp, Settings, Zap, Menu, X, LogOut, ChevronDown, Search,
  Rocket, Globe2, Users, UserSearch,
} from 'lucide-react';
import { Avatar, Dropdown, MenuItem } from '../ui/kit.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import { openPricing } from '../PricingModal.jsx';
import { getPlan, PLAN_LABELS, PLAN_EVENT } from '../../lib/plan.js';

function usePlanId() {
  const [p, setP] = useState(getPlan());
  useEffect(() => {
    const f = () => setP(getPlan());
    window.addEventListener(PLAN_EVENT, f);
    return () => window.removeEventListener(PLAN_EVENT, f);
  }, []);
  return p;
}

export const NAV = [
  { id: 'dash', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'resume', label: 'Resume', icon: FileText },
  { id: 'editor', label: 'Editor', icon: PenLine },
  { id: 'jobs', label: 'Jobs', icon: Briefcase },
  { id: 'tracker', label: 'Tracker', icon: KanbanSquare },
  { id: 'contacts', label: 'Outreach', icon: Send },
  { id: 'opportunities', label: 'Opportunity Arena', icon: Trophy },
  { id: 'projectstudio', label: 'Career Project Studio', icon: Rocket },
  { id: 'sandbox', label: 'Project Sandbox', icon: Globe2 },
  { id: 'partners', label: 'Find Project Partner', icon: Users },
  { id: 'recruiter', label: 'Recruiter Console', icon: UserSearch },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function NavList({ active, onPick }) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.map(({ id, label, icon: Icon }) => {
        const on = active === id;
        return (
          <button
            key={id}
            onClick={() => onPick(id)}
            className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${
              on ? 'text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            {on && (
              <motion.span layoutId="navActive" className="absolute inset-0 -z-0 rounded-xl bg-aurora-violet/15 ring-1 ring-aurora-violet/25" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />
            )}
            <Icon size={18} className={`relative z-10 ${on ? 'text-aurora-cyan' : ''}`} />
            <span className="relative z-10 truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function SidebarInner({ active, onPick }) {
  const plan = usePlanId();
  const paid = plan.planId !== 'free';
  return (
    <>
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl btn-primary text-white shadow-glow">
          <Zap size={18} strokeWidth={2.5} />
        </span>
        <span className="font-display text-[16px] font-semibold tracking-tight text-white">Career Autopilot</span>
      </div>
      <NavList active={active} onPick={onPick} />
      <div className="mt-auto p-4">
        <div className="gradient-border p-4">
          {paid ? (
            <>
              <p className="text-[13px] font-medium text-white">{PLAN_LABELS[plan.planId]} plan active</p>
              <p className="mt-1 text-xs text-muted">Manage your plan and usage.</p>
              <button onClick={() => openPricing()} className="mt-3 w-full rounded-lg border border-white/12 bg-white/[0.04] py-2 text-xs font-semibold text-slate-200 hover:bg-white/10">Manage plan</button>
            </>
          ) : (
            <>
              <p className="text-[13px] font-medium text-white">Pro workspace</p>
              <p className="mt-1 text-xs text-muted">Unlock unlimited tailoring & outreach.</p>
              <button onClick={() => openPricing('pro')} className="btn-primary mt-3 w-full rounded-lg py-2 text-xs font-semibold text-white">Upgrade</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default function Shell({ active, onPick, title, children }) {
  const { user, logout } = useAuth();
  const plan = usePlanId();
  const [drawer, setDrawer] = useState(false);
  const pick = (id) => { onPick(id); setDrawer(false); };

  return (
    <div className="min-h-screen">
      {/* Fixed sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--shell-sidebar)] flex-col border-r border-white/8 bg-ink-900/70 backdrop-blur-xl lg:flex">
        <SidebarInner active={active} onPick={pick} />
      </aside>

      {/* Mobile drawer — keyed children so AnimatePresence always removes the backdrop on close */}
      <AnimatePresence>
        {drawer && [
          <motion.div key="nav-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setDrawer(false)} />,
          <motion.aside
            key="nav-panel"
            initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-white/8 bg-ink-900 lg:hidden"
          >
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 rounded-lg p-2 text-slate-400 hover:bg-white/6"><X size={18} /></button>
            <SidebarInner active={active} onPick={pick} />
          </motion.aside>,
        ]}
      </AnimatePresence>

      {/* Main column — offset by sidebar, uses the page scroll (single scrollbar) */}
      <div className="lg:pl-[var(--shell-sidebar)]">
        <header className="sticky top-0 z-20 flex h-[var(--shell-topbar)] items-center gap-3 border-b border-white/8 bg-ink-950/70 px-4 backdrop-blur-xl sm:px-6">
          <button onClick={() => setDrawer(true)} className="rounded-lg p-2 text-slate-300 hover:bg-white/6 lg:hidden"><Menu size={20} /></button>
          <h1 className="font-display text-lg font-semibold text-white">{title}</h1>
          <div className="ml-auto flex items-center gap-2">
            {plan.planId === 'free' ? (
              <button
                onClick={() => openPricing('pro')}
                className="hidden items-center gap-1.5 rounded-xl border border-aurora-violet/30 bg-aurora-violet/10 px-3 py-2 text-xs font-semibold text-[#C2BBFF] transition hover:bg-aurora-violet/20 sm:flex"
              >
                <Zap size={14} /> Upgrade
              </button>
            ) : (
              <button
                onClick={() => openPricing()}
                className="hidden items-center gap-1.5 rounded-xl border border-aurora-mint/30 bg-aurora-mint/10 px-3 py-2 text-xs font-semibold text-[#A7F2DD] transition hover:bg-aurora-mint/20 sm:flex"
              >
                <Zap size={14} /> {PLAN_LABELS[plan.planId]} · Manage
              </button>
            )}
            <div className="hidden items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-slate-400 md:flex">
              <Search size={15} /> <span className="text-slate-500">Search…</span>
            </div>
            <Dropdown
              trigger={
                <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] py-1 pl-1 pr-2 transition hover:bg-white/6">
                  <Avatar src={user?.picture} name={user?.name} size={32} />
                  <span className="hidden text-sm text-slate-200 sm:block">{user?.name?.split(' ')[0] || 'You'}</span>
                  <ChevronDown size={15} className="text-slate-500" />
                </div>
              }
            >
              <div className="border-b border-white/8 px-3 py-2.5">
                <p className="truncate text-sm font-medium text-white">{user?.name || 'You'}</p>
                <p className="truncate text-xs text-slate-500">{user?.email || 'Signed in'}</p>
              </div>
              <div className="py-1">
                <MenuItem icon={Settings} onClick={() => pick('settings')}>Settings</MenuItem>
                <MenuItem icon={LogOut} danger onClick={logout}>Sign out</MenuItem>
              </div>
            </Dropdown>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
