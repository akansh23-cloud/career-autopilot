import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FileText, PenLine, Briefcase, KanbanSquare, Send,
  Trophy, TrendingUp, Settings, Zap, Menu, X, LogOut, ChevronDown, Search,
  Rocket, Globe2, Users, UserSearch, ShieldCheck, User, BadgeCheck, Medal, Handshake, Wand2,
  LifeBuoy, Award, Store, Lightbulb, Boxes, ScrollText, FileStack, Gauge, Sparkles, GraduationCap,
} from 'lucide-react';
import { Avatar, Dropdown, MenuItem } from '../ui/kit.jsx';
import { useSupport } from '../../support/SupportProvider.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import { openPricing } from '../PricingModal.jsx';
import NotificationsBell from './NotificationsBell.jsx';
import { getPlan, PLAN_LABELS, PLAN_EVENT } from '../../lib/plan.js';
import { getProfile, PROFILE_EVENT } from '../../lib/userProfile.js';
import { getEffectiveRole, canSeeScreen } from '../../lib/roleCapabilities.js';
import { ACCESS_CONTEXT_EVENT, getAccessContext, useAccountAccessContext } from '../../lib/accessContext.js';

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
  const compute = () => getEffectiveRole(getProfile(), { isAdmin: getPlan().isAdmin, accessContext: getAccessContext() });
  const [r, setR] = useState(compute());
  useEffect(() => {
    const f = () => setR(compute());
    window.addEventListener(PLAN_EVENT, f);
    window.addEventListener(PROFILE_EVENT, f);
    window.addEventListener(ACCESS_CONTEXT_EVENT, f);
    return () => { window.removeEventListener(PLAN_EVENT, f); window.removeEventListener(PROFILE_EVENT, f); window.removeEventListener(ACCESS_CONTEXT_EVENT, f); };
  }, []);
  return r;
}

export const NAV = [
  { id: 'dash', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'verification', label: 'Verification', icon: ShieldCheck },
  { id: 'careerprofile', label: 'Career Profile', icon: BadgeCheck },
  { id: 'projectcreator', label: 'Project Creator', icon: Wand2 },
  { id: 'marketplace', label: 'Project Marketplace', icon: Store },
  { id: 'inspirations', label: 'Live Inspirations', icon: Lightbulb },
  { id: 'architecture', label: 'Architecture Generator', icon: Boxes },
  { id: 'innovation', label: 'Innovation OS', icon: Sparkles },
  { id: 'patents', label: 'Patent Dashboard', icon: ScrollText },
  { id: 'patentgenerate', label: 'Legacy Generator', icon: Lightbulb },
  { id: 'patentportfolio', label: 'My Inventions', icon: Store },
  { id: 'priorart', label: 'Prior-Art Research', icon: Search },
  { id: 'patentdisclosures', label: 'Disclosures', icon: FileStack },
  { id: 'applications', label: 'Application Package', icon: FileStack },
  { id: 'readiness', label: 'Readiness', icon: Gauge },
  { id: 'skillsxp', label: 'Skills & XP', icon: Award },
  { id: 'resume', label: 'Resume', icon: FileText },
  { id: 'editor', label: 'Editor', icon: PenLine },
  { id: 'jobs', label: 'Jobs', icon: Briefcase },
  { id: 'tracker', label: 'Tracker', icon: KanbanSquare },
  { id: 'contacts', label: 'Outreach', icon: Send },
  { id: 'referralexchange', label: 'Referral Exchange', icon: Handshake },
  { id: 'leaderboards', label: 'Leaderboards', icon: Medal },
  { id: 'opportunities', label: 'Opportunity Arena', icon: Trophy },
  { id: 'projectstudio', label: 'Project OS', icon: Rocket },
  { id: 'sandbox', label: 'Project Sandbox', icon: Globe2 },
  { id: 'partners', label: 'Find Project Partner', icon: Users },
  { id: 'recruiter', label: 'Recruiter Console', icon: UserSearch },
  { id: 'college', label: 'Placement Cell', icon: GraduationCap },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'adminusers', label: 'User Directory', icon: ShieldCheck, adminOnly: true },
];

// Navigation visibility is driven entirely by the centralized capability
// layer (roleCapabilities.canSeeScreen) — the same checks used by the command
// palette, dashboard cards and the App navigation guard. No per-nav role list
// is maintained here, so a screen can never appear in the nav for a role that
// isn't allowed to open it.

// Journey groups -> top-level website menus. Short labels keep the bar clean.
// Top-level information architecture (spec L). Every existing view id is kept;
// they are regrouped into clean menus. Patents gets its own top-level entry;
// Profile/XP consolidates identity + verified skills + readiness.
const NAV_GROUPS = [
  { label: 'Overview', short: 'Home', ids: ['dash', 'verification'] },
  { label: 'Resume OS', short: 'Résumé', ids: ['resume', 'editor'] },
  { label: 'Job Match', short: 'Jobs', ids: ['jobs', 'tracker', 'contacts', 'referralexchange'] },
  { label: 'Applications', short: 'Apply', ids: ['applications'] },
  { label: 'Project OS', short: 'Project OS', ids: ['projectstudio', 'projectcreator', 'marketplace', 'inspirations', 'architecture', 'sandbox', 'partners'] },
  { label: 'Patent Engine', short: 'Patents', ids: ['innovation', 'patents', 'patentgenerate', 'patentportfolio', 'priorart', 'patentdisclosures'] },
  { label: 'Profile / XP', short: 'Profile', ids: ['careerprofile', 'skillsxp', 'readiness'] },
  { label: 'Community', short: 'Community', ids: ['leaderboards', 'opportunities'] },
  { label: 'Recruiting', short: 'Recruiting', ids: ['recruiter'] },
  { label: 'Placement Cell', short: 'College', ids: ['college'] },
  { label: 'Admin', short: 'Admin', ids: ['adminusers'] },
];
const MORE_IDS = ['growth', 'settings'];

const TOP_NAV_PRIORITIES = {
  admin: ['Overview', 'Admin', 'Recruiting', 'Placement Cell', 'Project OS', 'Profile / XP'],
  recruiter: ['Overview', 'Recruiting', 'Community', 'Verified Projects'],
  college_admin: ['Overview', 'Placement Cell', 'Profile / XP', 'Verified Projects'],
  student_early: ['Overview', 'Project OS', 'Profile / XP', 'Community'],
  student_placement: ['Overview', 'Resume OS', 'Job Match', 'Applications', 'Project OS', 'Profile / XP', 'Community'],
};
// Cap chosen so the primary set fits the inline bar even in the tightest
// case (2xl, where the search control expands to a full pill and the
// centered container is already capped at max-w-7xl). Any extra groups —
// most often for admin / student_placement, which generate the most menus —
// flow into the existing "More" menu instead of overflowing onto the
// right-side controls. Kept role-agnostic so the bar behaves identically
// for every role.
const MAX_TOP_NAV_GROUPS = 6;

function orderGroupsForTopNav(groups, role) {
  const priority = TOP_NAV_PRIORITIES[role] || TOP_NAV_PRIORITIES.student_placement;
  const score = (g) => {
    const idx = priority.indexOf(g.label);
    return idx === -1 ? 100 + NAV_GROUPS.findIndex((x) => x.label === g.label) : idx;
  };
  return groups.slice().sort((a, b) => score(a) - score(b));
}

function groupsForRole(role) {
  const byId = Object.fromEntries(NAV.map((n) => [n.id, n]));
  const keep = (id) => !!byId[id] && canSeeScreen(role, id) && (!byId[id].adminOnly || role === 'admin');

  // College / recruiter staff never get the student "Project OS" surface — the
  // only project view they can reach is the read-only verified-project Sandbox.
  // Relabel that group to "Verified Projects" so the top-level menu never shows
  // a misleading "Project OS" entry for staff that just opens the Sandbox.
  const staffVerifiedProjects = role === 'college_admin' || role === 'recruiter';

  const grouped = NAV_GROUPS
    .map((g) => {
      const relabel = staffVerifiedProjects && g.label === 'Project OS';
      return {
        label: relabel ? 'Verified Projects' : g.label,
        short: relabel ? 'Verified Projects' : g.short,
        items: g.ids.filter(keep).map((id) => byId[id]),
      };
    })
    .filter((g) => g.items.length);

  // Keep the desktop bar readable. Admin in particular has many modules, so
  // low-priority groups are flattened into More instead of overflowing beside
  // the plan chip/search/avatar controls.
  const ordered = orderGroupsForTopNav(grouped, role);
  const primary = ordered.slice(0, MAX_TOP_NAV_GROUPS);
  const placed = new Set(primary.flatMap((g) => g.items.map((it) => it.id)));

  const seen = new Set();
  const more = [];
  const push = (id) => {
    if (seen.has(id) || placed.has(id) || !keep(id)) return;
    seen.add(id);
    more.push(byId[id]);
  };

  // First add hidden top-level groups in the same role-aware order, then the
  // utility ids. This keeps Admin/College/Recruiting prominent while all other
  // features stay reachable from More.
  for (const g of ordered.slice(MAX_TOP_NAV_GROUPS)) {
    for (const it of g.items) push(it.id);
  }
  for (const id of MORE_IDS) push(id);
  for (const n of NAV) push(n.id);

  return { primary, more };
}

/* ---- Calm in-app backdrop (echoes the landing, stays quiet) ---- */
function AppBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-ink-950" />
      <div className="absolute inset-x-0 top-0 h-[420px] bg-grid opacity-50" />
      <div className="glow-blob absolute -top-40 left-1/2 h-[420px] w-[640px] -translate-x-1/2 bg-aurora-violet/12" />
      <div className="noise absolute inset-0" />
    </div>
  );
}

/* ---- Desktop top-nav dropdown menu ---- */
function NavMenu({ group, active, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const tRef = useRef(null);
  const single = group.items.length === 1;
  const activeHere = group.items.some((it) => it.id === active);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const enter = () => { clearTimeout(tRef.current); if (!single) setOpen(true); };
  const leave = () => { tRef.current = setTimeout(() => setOpen(false), 120); };

  if (single) {
    const it = group.items[0];
    return (
      <button
        onClick={() => onPick(it.id)}
        className={`relative rounded-lg px-3 py-2 text-sm font-medium transition ${activeHere ? 'text-white' : 'text-slate-400 hover:text-white'}`}
      >
        {group.short}
        {activeHere && <motion.span layoutId="topnav" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-aurora-violet" />}
      </button>
    );
  }
  return (
    <div ref={ref} className="relative" onMouseEnter={enter} onMouseLeave={leave}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition ${activeHere || open ? 'text-white' : 'text-slate-400 hover:text-white'}`}
      >
        {group.short}
        <ChevronDown size={14} className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
        {activeHere && <motion.span layoutId="topnav" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-aurora-violet" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="absolute left-0 top-full z-50 mt-2 w-[280px] overflow-hidden rounded-2xl border border-white/10 bg-ink-850/95 p-2 shadow-lift backdrop-blur-xl"
          >
            <p className="px-3 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600">{group.label}</p>
            {group.items.map((it) => {
              const on = active === it.id;
              return (
                <button
                  key={it.id}
                  onClick={() => { onPick(it.id); setOpen(false); }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${on ? 'bg-aurora-violet/12 text-white' : 'text-slate-300 hover:bg-white/[0.05] hover:text-white'}`}
                >
                  <span className={`grid h-8 w-8 place-items-center rounded-lg ${on ? 'bg-aurora-violet/20 text-aurora-violet' : 'bg-white/[0.04] text-slate-400'}`}><it.icon size={16} /></span>
                  {it.label}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---- Mobile drawer nav ---- */
function MobileNav({ primary, more, active, onPick, onSupport }) {
  const NavBtn = ({ it }) => {
    const on = active === it.id;
    return (
      <button
        onClick={() => onPick(it.id)}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${on ? 'bg-aurora-violet/12 text-white ring-1 ring-aurora-violet/25' : 'text-slate-300 hover:bg-white/[0.05]'}`}
      >
        <it.icon size={18} className={on ? 'text-aurora-violet' : 'text-slate-400'} /> {it.label}
      </button>
    );
  };
  return (
    <nav className="flex flex-col gap-4 px-3 pb-6">
      {primary.map((g, gi) => (
        <div key={g.label || gi} className="space-y-1">
          <p className="px-3 pb-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600">{g.label}</p>
          {g.items.map((it) => <NavBtn key={it.id} it={it} />)}
        </div>
      ))}
      {(more.length > 0 || onSupport) && (
        <div className="space-y-1">
          <p className="px-3 pb-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600">Tools &amp; settings</p>
          {more.map((it) => <NavBtn key={it.id} it={it} />)}
          {onSupport && (
            <button onClick={onSupport} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-300 transition hover:bg-white/[0.05]">
              <LifeBuoy size={18} className="text-slate-400" /> Support
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

function PlanChip({ plan }) {
  if (plan.isAdmin) {
    return (
      <button onClick={() => openPricing()} className="hidden items-center gap-1.5 rounded-xl border border-aurora-mint/40 bg-aurora-mint/10 px-3 py-2 text-xs font-semibold text-[#BDF5DC] transition hover:bg-aurora-mint/20 sm:flex">
        <ShieldCheck size={14} /> Full Access
      </button>
    );
  }
  if (plan.planId === 'free') {
    return (
      <button onClick={() => openPricing('pro')} className="hidden items-center gap-1.5 rounded-xl border border-aurora-violet/35 bg-aurora-violet/10 px-3 py-2 text-xs font-bold text-[#E4DCFF] transition hover:bg-aurora-violet/20 sm:flex">
        <Zap size={14} /> Upgrade
      </button>
    );
  }
  return (
    <button onClick={() => openPricing()} className="hidden items-center gap-1.5 rounded-xl border border-aurora-mint/30 bg-aurora-mint/10 px-3 py-2 text-xs font-semibold text-[#BDF5DC] transition hover:bg-aurora-mint/20 sm:flex">
      <Zap size={14} /> {PLAN_LABELS[plan.planId]}
    </button>
  );
}

export default function Shell({ active, onPick, title, children }) {
  useAccountAccessContext(true);
  const { user, logout } = useAuth();
  const plan = usePlanId();
  const role = useRole();
  const support = useSupport();
  const [drawer, setDrawer] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { primary, more } = groupsForRole(role);
  const pick = (id) => { onPick(id); setDrawer(false); };
  const openSupportChat = () => { support?.openSupport?.({ tab: 'chat' }); setDrawer(false); };

  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 8);
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <AppBackdrop />

      {/* Website-style top navigation */}
      <header className={`sticky top-0 z-40 border-b transition-colors duration-300 ${scrolled ? 'border-white/[0.07] bg-ink-950/80 backdrop-blur-xl' : 'border-transparent bg-ink-950/40 backdrop-blur-md'}`}>
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-px bg-gradient-to-r from-transparent via-aurora-violet/30 to-transparent" />
        <div className="mx-auto flex h-[var(--shell-topbar)] max-w-7xl items-center gap-3 px-4 sm:px-6">
          <button onClick={() => pick('dash')} className="flex shrink-0 items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full btn-primary shadow-glow ring-1 ring-white/25">
              <ShieldCheck size={17} strokeWidth={2.5} className="relative z-[2] text-ink-950" />
            </span>
            <span className="hidden font-display text-[16px] font-extrabold tracking-tight text-white sm:block">Career Autopilot</span>
          </button>

          <nav className="ml-3 hidden min-w-0 flex-1 items-center gap-0.5 xl:flex">
            {primary.map((g) => <NavMenu key={g.label} group={g} active={active} onPick={pick} />)}
          </nav>

          <div className="ml-3 flex shrink-0 items-center gap-2">
            <NotificationsBell onPick={pick} />
            <PlanChip plan={plan} />
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
                <MenuItem icon={User} onClick={() => pick('careerprofile')}>Career Profile</MenuItem>
                <MenuItem icon={Settings} onClick={() => pick('settings')}>Settings</MenuItem>
                <MenuItem icon={LifeBuoy} onClick={openSupportChat}>Support</MenuItem>
                <MenuItem icon={LogOut} danger onClick={logout}>Sign out</MenuItem>
              </div>
            </Dropdown>
            <button onClick={() => setDrawer(true)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/8 text-slate-300 hover:bg-white/6 xl:hidden" aria-label="Menu"><Menu size={20} /></button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawer && [
          <motion.div key="nav-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm xl:hidden" onClick={() => setDrawer(false)} />,
          <motion.aside
            key="nav-panel"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed inset-y-0 right-0 z-50 flex w-[300px] flex-col overflow-y-auto border-l border-white/[0.07] bg-ink-900 xl:hidden"
          >
            <div className="flex items-center justify-between px-5 py-5">
              <span className="font-display text-[15px] font-extrabold text-white">Menu</span>
              <button onClick={() => setDrawer(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/6"><X size={18} /></button>
            </div>
            <MobileNav primary={primary} more={more} active={active} onPick={pick} onSupport={openSupportChat} />
          </motion.aside>,
        ]}
      </AnimatePresence>

      {/* Page content — spacious, centered, website-like */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 sm:py-12 lg:py-14">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Slim footer for website continuity */}
      <footer className="mt-auto border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="grid h-6 w-6 place-items-center rounded-full btn-primary"><ShieldCheck size={12} className="relative z-[2] text-ink-950" /></span>
            Career Autopilot
          </div>
          <div className="flex items-center gap-5 text-xs text-slate-600">
            <button onClick={() => pick('settings')} className="hover:text-slate-300">Settings</button>
            <button onClick={openSupportChat} className="hover:text-slate-300">Support</button>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
