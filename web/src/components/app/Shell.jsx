import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FileText, PenLine, Briefcase, KanbanSquare, Send,
  Trophy, TrendingUp, Settings, Zap, Menu, X, LogOut, ChevronDown, Search,
  Rocket, Globe2, Users, UserSearch, ShieldCheck, User, BadgeCheck, Medal, Handshake, Wand2,
  MoreHorizontal, LifeBuoy, ChevronRight,
} from 'lucide-react';
import { Avatar, Dropdown, MenuItem } from '../ui/kit.jsx';
import CommandPalette from './CommandPalette.jsx';
import { useSupport } from '../../support/SupportProvider.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import { openPricing } from '../PricingModal.jsx';
import { getPlan, PLAN_LABELS, PLAN_EVENT } from '../../lib/plan.js';
import { getUserRole, PROFILE_EVENT } from '../../lib/userProfile.js';

function detectShortcut() {
  if (typeof navigator === 'undefined') return { isMac: false, label: 'Ctrl K' };
  const ua = `${navigator.platform || ''} ${navigator.userAgent || ''}`;
  const isMac = /Mac|iPhone|iPad|iPod/i.test(ua);
  return { isMac, label: isMac ? '\u2318K' : 'Ctrl K' };
}

function usePlanId() {
  const [p, setP] = useState(getPlan());
  useEffect(() => {
    const f = () => setP(getPlan());
    window.addEventListener(PLAN_EVENT, f);
    return () => window.removeEventListener(PLAN_EVENT, f);
  }, []);
  return p;
}

function useRole() {
  const compute = () => (getPlan().isAdmin ? 'admin' : getUserRole());
  const [r, setR] = useState(compute());
  useEffect(() => {
    const f = () => setR(compute());
    window.addEventListener(PLAN_EVENT, f);
    window.addEventListener(PROFILE_EVENT, f);
    return () => { window.removeEventListener(PLAN_EVENT, f); window.removeEventListener(PROFILE_EVENT, f); };
  }, []);
  return r;
}

export const NAV = [
  { id: 'dash', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'careerprofile', label: 'Career Profile', icon: BadgeCheck },
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'projectcreator', label: 'Project Creator', icon: Wand2 },
  { id: 'resume', label: 'Resume', icon: FileText },
  { id: 'editor', label: 'Editor', icon: PenLine },
  { id: 'jobs', label: 'Jobs', icon: Briefcase },
  { id: 'tracker', label: 'Tracker', icon: KanbanSquare },
  { id: 'contacts', label: 'Outreach', icon: Send },
  { id: 'referralexchange', label: 'Referral Exchange', icon: Handshake },
  { id: 'leaderboards', label: 'Leaderboards', icon: Medal },
  { id: 'opportunities', label: 'Opportunity Arena', icon: Trophy },
  { id: 'projectstudio', label: 'Career Project Studio', icon: Rocket },
  { id: 'sandbox', label: 'Project Sandbox', icon: Globe2 },
  { id: 'partners', label: 'Find Project Partner', icon: Users },
  { id: 'recruiter', label: 'Recruiter Console', icon: UserSearch },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'adminusers', label: 'User Directory', icon: ShieldCheck, adminOnly: true },
];

const ROLE_NAV = {
  student: ['dash', 'careerprofile', 'projectcreator', 'projectstudio', 'partners', 'sandbox', 'leaderboards', 'referralexchange', 'resume', 'editor', 'opportunities', 'tracker', 'growth', 'settings'],
  professional: ['dash', 'careerprofile', 'projectcreator', 'resume', 'editor', 'jobs', 'contacts', 'referralexchange', 'leaderboards', 'tracker', 'sandbox', 'opportunities', 'growth', 'settings'],
  recruiter: ['dash', 'recruiter', 'leaderboards', 'careerprofile', 'sandbox', 'settings'],
};

const NAV_GROUPS = [
  { label: null, ids: ['dash'] },
  { label: 'Career', ids: ['careerprofile'] },
  { label: 'Resume Studio', ids: ['resume', 'editor'] },
  { label: 'Job Hunt', ids: ['jobs', 'tracker'] },
  { label: 'LinkedIn Growth', ids: ['growth'] },
  { label: 'Project Studio', ids: ['projectstudio', 'projectcreator', 'sandbox', 'partners'] },
  { label: 'Admin', ids: ['adminusers'] },
];
const MORE_IDS = ['opportunities', 'contacts', 'leaderboards', 'referralexchange', 'recruiter', 'profile', 'settings'];

function groupsForRole(role) {
  const order = ROLE_NAV[role];
  const allowed = order ? new Set(order) : null;
  const byId = Object.fromEntries(NAV.map((n) => [n.id, n]));
  const keep = (id) => !!byId[id] && (!allowed || allowed.has(id)) && (!byId[id].adminOnly || role === 'admin');

  const placed = new Set();
  const primary = NAV_GROUPS
    .map((g) => ({
      label: g.label,
      items: g.ids.filter(keep).map((id) => { placed.add(id); return byId[id]; }),
    }))
    .filter((g) => g.items.length);

  const moreOrder = [...MORE_IDS, ...NAV.map((n) => n.id)];
  const seen = new Set();
  const more = moreOrder.filter((id) => {
    if (seen.has(id) || placed.has(id) || !keep(id)) return false;
    seen.add(id);
    return true;
  }).map((id) => byId[id]);

  return { primary, more };
}

function NavItem({ item, active, onPick }) {
  const { id, label, icon: Icon } = item;
  const on = active === id;
  return (
    <button
      onClick={() => onPick(id)}
      className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${
        on ? 'text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
      }`}
    >
      {on && (
        <motion.span layoutId="navActive" className="absolute inset-0 -z-0 rounded-xl border border-aurora-violet/30 bg-aurora-violet/[0.12]" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />
      )}
      {on && <motion.span layoutId="navBar" className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-aurora-violet shadow-[0_0_12px_rgba(255,178,62,0.7)]" />}
      <Icon size={18} className={`relative z-10 transition-colors ${on ? 'text-aurora-violet' : 'group-hover:text-aurora-violet/80'}`} />
      <span className="relative z-10 truncate">{label}</span>
    </button>
  );
}

function MoreSection({ items, active, onPick, onSupport }) {
  const activeInMore = items.some((it) => it.id === active);
  const [open, setOpen] = useState(activeInMore);
  useEffect(() => { if (activeInMore) setOpen(true); }, [activeInMore]);
  if (!items.length && !onSupport) return null;
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-100"
      >
        <MoreHorizontal size={18} />
        <span className="flex-1 text-left">More</span>
        <ChevronRight size={15} className={`text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden"
          >
            <div className="space-y-1 pl-2">
              {items.map((it) => <NavItem key={it.id} item={it} active={active} onPick={onPick} />)}
              {onSupport && (
                <button
                  onClick={onSupport}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-100"
                >
                  <LifeBuoy size={18} />
                  <span className="truncate">Support</span>
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GroupedNav({ active, onPick, onSupport, role }) {
  const { primary, more } = groupsForRole(role);
  return (
    <nav className="flex flex-col gap-3 px-3">
      {primary.map((g, gi) => (
        <div key={g.label || `g-${gi}`} className="space-y-1">
          {g.label && (
            <p className="px-3 pb-0.5 pt-1 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-slate-600">{g.label}</p>
          )}
          {g.items.map((it) => <NavItem key={it.id} item={it} active={active} onPick={onPick} />)}
        </div>
      ))}
      <MoreSection items={more} active={active} onPick={onPick} onSupport={onSupport} />
    </nav>
  );
}

function SidebarInner({ active, onPick, onSupport }) {
  const plan = usePlanId();
  const role = useRole();
  const isAdmin = !!plan.isAdmin;
  const paid = plan.planId !== 'free';
  return (
    <>
      <div className="flex shrink-0 items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl btn-primary shadow-glow">
          <Zap size={18} strokeWidth={2.6} className="text-ink-950" />
        </span>
        <div className="leading-none">
          <span className="font-display text-[15px] font-bold tracking-tight text-white">Career Autopilot</span>
          <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.28em] text-aurora-violet/70">FLIGHT DECK</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 [scrollbar-width:thin]">
        <GroupedNav active={active} onPick={onPick} onSupport={onSupport} role={role} />
      </div>
      <div className="shrink-0 p-4">
        <div className="gradient-border ticks relative overflow-hidden p-4">
          {isAdmin ? (
            <>
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-white"><ShieldCheck size={14} className="text-aurora-mint" /> Full Access</p>
              <p className="mt-1 text-xs text-muted">Admin account — every system unlocked.</p>
              <button onClick={() => openPricing()} className="mt-3 w-full rounded-lg border border-aurora-mint/30 bg-aurora-mint/10 py-2 text-xs font-semibold text-[#A7F2CE] hover:bg-aurora-mint/20">View access</button>
            </>
          ) : paid ? (
            <>
              <p className="text-[13px] font-semibold text-white">{PLAN_LABELS[plan.planId]} plan active</p>
              <p className="mt-1 text-xs text-muted">Manage your plan and usage.</p>
              <button onClick={() => openPricing()} className="mt-3 w-full rounded-lg border border-white/12 bg-white/[0.04] py-2 text-xs font-semibold text-slate-200 hover:bg-white/10">Manage plan</button>
            </>
          ) : (
            <>
              <p className="text-[13px] font-semibold text-white">Engage full thrust</p>
              <p className="mt-1 text-xs text-muted">Unlimited tailoring, outreach & matching.</p>
              <button onClick={() => openPricing('pro')} className="btn-primary mt-3 w-full rounded-lg py-2 text-xs font-bold">Upgrade</button>
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
  const support = useSupport();
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [shortcut] = useState(detectShortcut);
  const pick = (id) => { onPick(id); setDrawer(false); };
  const openSupportChat = () => { support?.openSupport?.({ tab: 'chat' }); setDrawer(false); };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        const el = document.activeElement;
        const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        if (typing) return;
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--shell-sidebar)] flex-col border-r border-white/[0.07] bg-ink-900/75 backdrop-blur-xl lg:flex">
        <SidebarInner active={active} onPick={pick} onSupport={openSupportChat} />
      </aside>

      <AnimatePresence>
        {drawer && [
          <motion.div key="nav-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setDrawer(false)} />,
          <motion.aside
            key="nav-panel"
            initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-white/[0.07] bg-ink-900 lg:hidden"
          >
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 rounded-lg p-2 text-slate-400 hover:bg-white/6"><X size={18} /></button>
            <SidebarInner active={active} onPick={pick} onSupport={openSupportChat} />
          </motion.aside>,
        ]}
      </AnimatePresence>

      <div className="lg:pl-[var(--shell-sidebar)]">
        <header className="relative sticky top-0 z-20 flex h-[var(--shell-topbar)] items-center gap-3 border-b border-white/[0.07] bg-ink-950/75 px-4 backdrop-blur-xl sm:px-6">
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-px bg-gradient-to-r from-transparent via-aurora-violet/40 to-transparent" />
          <button onClick={() => setDrawer(true)} className="rounded-lg p-2 text-slate-300 hover:bg-white/6 lg:hidden"><Menu size={20} /></button>
          <div className="flex items-center gap-2.5">
            <span className="hidden h-1.5 w-1.5 animate-ticker rounded-full bg-aurora-mint shadow-[0_0_8px_rgba(70,230,166,0.9)] sm:block" />
            <h1 className="font-display text-lg font-bold text-white">{title}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {plan.isAdmin ? (
              <button
                onClick={() => openPricing()}
                className="hidden items-center gap-1.5 rounded-xl border border-aurora-mint/40 bg-aurora-mint/10 px-3 py-2 text-xs font-semibold text-[#A7F2CE] transition hover:bg-aurora-mint/20 sm:flex"
              >
                <ShieldCheck size={14} /> Admin · Full Access
              </button>
            ) : plan.planId === 'free' ? (
              <button
                onClick={() => openPricing('pro')}
                className="hidden items-center gap-1.5 rounded-xl border border-aurora-violet/35 bg-aurora-violet/10 px-3 py-2 text-xs font-semibold text-[#FFD49A] transition hover:bg-aurora-violet/20 sm:flex"
              >
                <Zap size={14} /> Upgrade
              </button>
            ) : (
              <button
                onClick={() => openPricing()}
                className="hidden items-center gap-1.5 rounded-xl border border-aurora-mint/30 bg-aurora-mint/10 px-3 py-2 text-xs font-semibold text-[#A7F2CE] transition hover:bg-aurora-mint/20 sm:flex"
              >
                <Zap size={14} /> {PLAN_LABELS[plan.planId]} · Manage
              </button>
            )}
            <button
              onClick={() => setPalette(true)}
              className="hidden items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-slate-400 transition hover:border-aurora-violet/30 hover:bg-white/[0.06] md:flex"
              aria-label="Open command palette"
            >
              <Search size={15} /> <span className="text-slate-500">Search…</span>
              <kbd className="ml-2 flex items-center gap-0.5 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{shortcut.label}</kbd>
            </button>
            <button
              onClick={() => setPalette(true)}
              className="grid h-9 w-9 place-items-center rounded-xl border border-white/8 bg-white/[0.03] text-slate-300 transition hover:bg-white/6 md:hidden"
              aria-label="Open command palette"
            >
              <Search size={16} />
            </button>
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

      <CommandPalette open={palette} setOpen={setPalette} onPick={pick} />
    </div>
  );
}
