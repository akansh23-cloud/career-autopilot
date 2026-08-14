import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FileText, PenLine, Briefcase, KanbanSquare, Send,
  Trophy, TrendingUp, Settings, Zap, Menu, X, LogOut, ChevronDown, Search,
  Rocket, Globe2, Users, UserSearch, ShieldCheck, User, BadgeCheck, Medal, Handshake, Wand2,
  LifeBuoy, Award, Store, Lightbulb, Boxes, ScrollText, FileStack, Gauge, Sparkles, GraduationCap,
  PanelLeftClose, PanelLeftOpen, LayoutTemplate, ServerCog,
} from 'lucide-react';
import { Avatar, Dropdown, MenuItem } from '../ui/kit.jsx';
import { useSupport } from '../../support/SupportProvider.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import { openPricing } from '../PricingModal.jsx';
import NotificationsBell from './NotificationsBell.jsx';
import { getPlan, PLAN_LABELS, PLAN_EVENT } from '../../lib/plan.js';
import { getProfile, PROFILE_EVENT } from '../../lib/userProfile.js';
import { getEffectiveRole } from '../../lib/roleCapabilities.js';
import { buildNavForRole } from '../../lib/navGroups.js';
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
  { id: 'patentgenerate', label: 'Generate Ideas', icon: Lightbulb },
  { id: 'patentportfolio', label: 'My Inventions', icon: Store },
  { id: 'priorart', label: 'Prior-Art Research', icon: Search },
  { id: 'patentdisclosures', label: 'Disclosures', icon: FileStack },
  { id: 'applications', label: 'Application Package', icon: FileStack },
  { id: 'readiness', label: 'Readiness', icon: Gauge },
  { id: 'skillsxp', label: 'Skills & XP', icon: Award },
  { id: 'studio', label: 'Resume Studio', icon: FileText },
  { id: 'resume', label: 'Resume Check', icon: FileText },
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
  { id: 'teamproject', label: 'Team Project', icon: Users },
  { id: 'recruiter', label: 'Recruiter Console', icon: UserSearch },
  { id: 'college', label: 'Placement Cell', icon: GraduationCap },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'adminusers', label: 'User Directory', icon: ShieldCheck, adminOnly: true },
  { id: 'adminjobs', label: 'Job Discovery', icon: ServerCog, adminOnly: true },
  { id: 'templatebuilder', label: 'Template Builder', icon: LayoutTemplate, adminOnly: true },
];

// Navigation visibility is driven entirely by the centralized capability layer
// (roleCapabilities.canSeeScreen) via lib/navGroups.js — the same checks used
// by the command palette and the App navigation guard. The sidebar renders
// EVERY group a role may see (primary + overflow), each under its own label,
// so nothing is hidden behind an extra hover menu.

const COLLAPSE_KEY = 'careerAutopilot.sidebarCollapsed.v1';

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

function openCommandPalette() {
  window.dispatchEvent(new CustomEvent('career-command-palette'));
}

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
const SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K';

/* ---------------- Brand mark ---------------- */
function Brand({ collapsed, onHome }) {
  return (
    <button onClick={onHome} className="flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1 text-left" title="Career Autopilot">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-aurora-violet text-white shadow-card">
        <ShieldCheck size={17} strokeWidth={2.4} />
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold tracking-tight text-fg">Career Autopilot</span>
          <span className="block text-[10px] font-medium uppercase tracking-wide text-fg-muted">Placement OS</span>
        </span>
      )}
    </button>
  );
}

/* ---------------- Sidebar nav item ---------------- */
function NavItem({ it, active, collapsed, onPick }) {
  const on = active === it.id;
  return (
    <button
      onClick={() => onPick(it.id)}
      title={collapsed ? it.label : undefined}
      aria-current={on ? 'page' : undefined}
      className={`group relative flex w-full items-center gap-2.5 rounded-lg py-[7px] text-[13px] font-medium transition-colors ${
        collapsed ? 'justify-center px-0' : 'px-2.5'
      } ${on ? 'text-brand' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'}`}
      style={on ? { backgroundColor: 'var(--brand-soft)' } : undefined}
    >
      {on && <span aria-hidden className="absolute inset-y-1 left-0 w-[2.5px] rounded-full bg-aurora-violet" style={{ display: collapsed ? 'none' : undefined }} />}
      <it.icon size={16} className={`shrink-0 ${on ? 'text-aurora-violet' : 'text-fg-muted group-hover:text-fg-secondary'}`} />
      {!collapsed && <span className="truncate">{it.label}</span>}
    </button>
  );
}

/* ---------------- Grouped sidebar navigation ---------------- */
function SidebarNav({ sections, active, collapsed, onPick }) {
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-2.5 pb-4 pt-1" aria-label="Primary">
      {sections.map((g, gi) => (
        <div key={g.label || gi}>
          {!collapsed && g.label && (
            <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-muted">{g.label}</p>
          )}
          {collapsed && gi > 0 && <div className="mx-3 mb-2 border-t border-subtle" />}
          <div className="space-y-0.5">
            {g.items.map((it) => (
              <NavItem key={it.id} it={it} active={active} collapsed={collapsed} onPick={onPick} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/* ---------------- Plan chip ---------------- */
function PlanChip({ plan, collapsed }) {
  const label = plan.isAdmin ? 'Full access' : plan.planId === 'free' ? 'Upgrade plan' : PLAN_LABELS[plan.planId];
  const upgrade = !plan.isAdmin && plan.planId === 'free';
  if (collapsed) {
    return (
      <button
        onClick={() => openPricing(upgrade ? 'pro' : undefined)}
        title={label}
        className="mx-auto grid h-8 w-8 place-items-center rounded-lg border border-subtle text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
      >
        {plan.isAdmin ? <ShieldCheck size={15} /> : <Zap size={15} className={upgrade ? 'text-aurora-violet' : 'text-ok'} />}
      </button>
    );
  }
  return (
    <button
      onClick={() => openPricing(upgrade ? 'pro' : undefined)}
      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
        upgrade
          ? 'border-indigo-200 bg-indigo-50 text-brand hover:bg-indigo-100'
          : 'border-subtle bg-elevated text-fg-secondary hover:bg-surface-hover'
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        {plan.isAdmin ? <ShieldCheck size={14} className="text-ok" /> : <Zap size={14} className={upgrade ? 'text-aurora-violet' : 'text-ok'} />}
        {label}
      </span>
      {upgrade && <span className="text-[10px] font-semibold uppercase tracking-wide">Pro</span>}
    </button>
  );
}

/* ---------------- Sidebar user block ---------------- */
function UserBlock({ user, collapsed, onPick, onSupport, onLogout }) {
  return (
    <Dropdown
      align="left"
      direction="up"
      trigger={
        <div
          className={`flex w-full items-center gap-2.5 rounded-lg border border-transparent py-1.5 transition-colors hover:bg-surface-hover ${collapsed ? 'justify-center px-0' : 'px-2'}`}
          title={collapsed ? (user?.name || 'Account') : undefined}
        >
          <Avatar src={user?.picture} name={user?.name} size={30} />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] font-medium text-fg">{user?.name || 'You'}</span>
                <span className="block truncate text-[11px] text-fg-muted">{user?.email || 'Signed in'}</span>
              </span>
              <ChevronDown size={14} className="shrink-0 text-fg-muted" />
            </>
          )}
        </div>
      }
    >
      <div className="border-b border-subtle px-3 py-2.5">
        <p className="truncate text-sm font-medium text-fg">{user?.name || 'You'}</p>
        <p className="truncate text-xs text-fg-muted">{user?.email || 'Signed in'}</p>
      </div>
      <div className="py-1">
        <MenuItem icon={User} onClick={() => onPick('careerprofile')}>Career Profile</MenuItem>
        <MenuItem icon={Settings} onClick={() => onPick('settings')}>Settings</MenuItem>
        <MenuItem icon={LifeBuoy} onClick={onSupport}>Support</MenuItem>
        <MenuItem icon={LogOut} danger onClick={onLogout}>Sign out</MenuItem>
      </div>
    </Dropdown>
  );
}

/* ---------------- Search trigger (opens command palette) ---------------- */
function SearchTrigger({ collapsed }) {
  if (collapsed) {
    return (
      <button
        onClick={openCommandPalette}
        title={`Search (${SHORTCUT})`}
        className="mx-auto grid h-8 w-8 place-items-center rounded-lg border border-subtle text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <Search size={15} />
      </button>
    );
  }
  return (
    <button
      onClick={openCommandPalette}
      className="flex w-full items-center gap-2 rounded-lg border border-subtle bg-sunken px-2.5 py-2 text-[13px] text-fg-muted transition-colors hover:border-strong hover:text-fg-secondary"
    >
      <Search size={14} />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="hidden rounded border border-subtle bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-muted md:flex">{SHORTCUT}</kbd>
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
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { primary, moreGroups } = buildNavForRole(role, NAV);
  const sections = [...primary, ...moreGroups];
  const pick = (id) => { onPick(id); setDrawer(false); };
  const openSupportChat = () => { support?.openSupport?.({ tab: 'chat' }); setDrawer(false); };
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const sidebarWidth = collapsed ? 'var(--shell-sidebar-rail)' : 'var(--shell-sidebar)';

  return (
    <div className="min-h-screen bg-base" style={{ '--shell-current-sidebar': sidebarWidth }}>
      {/* ---------------- Desktop sidebar ---------------- */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-subtle bg-elevated lg:flex"
        style={{ width: sidebarWidth }}
      >
        <div className={`flex items-center gap-1 py-3 ${collapsed ? 'flex-col px-2' : 'justify-between pl-2.5 pr-2'}`}>
          <Brand collapsed={collapsed} onHome={() => pick('dash')} />
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>
        <div className={collapsed ? 'px-2 pb-3' : 'px-2.5 pb-3'}>
          <SearchTrigger collapsed={collapsed} />
        </div>
        <SidebarNav sections={sections} active={active} collapsed={collapsed} onPick={pick} />
        <div className={`space-y-2 border-t border-subtle py-3 ${collapsed ? 'px-2' : 'px-2.5'}`}>
          {!collapsed && (
            <button
              onClick={openSupportChat}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <LifeBuoy size={16} className="text-fg-muted" /> Support
            </button>
          )}
          <PlanChip plan={plan} collapsed={collapsed} />
          <UserBlock user={user} collapsed={collapsed} onPick={pick} onSupport={openSupportChat} onLogout={logout} />
        </div>
      </aside>

      {/* ---------------- Mobile drawer ---------------- */}
      <AnimatePresence>
        {drawer && [
          <motion.div key="nav-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-scrim lg:hidden" onClick={() => setDrawer(false)} />,
          <motion.aside
            key="nav-panel"
            initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'tween', duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
            className="fixed inset-y-0 left-0 z-50 flex w-[286px] flex-col border-r border-subtle bg-elevated lg:hidden"
          >
            <div className="flex items-center justify-between border-b border-subtle py-3 pl-3 pr-2">
              <Brand collapsed={false} onHome={() => pick('dash')} />
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg"><X size={18} /></button>
            </div>
            <div className="px-3 py-3">
              <SearchTrigger collapsed={false} />
            </div>
            <SidebarNav sections={sections} active={active} collapsed={false} onPick={pick} />
            <div className="space-y-2 border-t border-subtle px-3 py-3">
              <button
                onClick={openSupportChat}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <LifeBuoy size={16} className="text-fg-muted" /> Support
              </button>
              <PlanChip plan={plan} collapsed={false} />
              <UserBlock user={user} collapsed={false} onPick={pick} onSupport={openSupportChat} onLogout={logout} />
            </div>
          </motion.aside>,
        ]}
      </AnimatePresence>

      {/* ---------------- Main column ---------------- */}
      <div className="flex min-h-screen flex-col lg:pl-[var(--shell-current-sidebar)]">
        {/* Topbar */}
        <header className="sticky top-0 z-30 border-b border-subtle bg-elevated">
          <div className="flex h-[var(--shell-topbar)] items-center gap-3 px-4 sm:px-6">
            <button onClick={() => setDrawer(true)} className="grid h-9 w-9 place-items-center rounded-lg border border-subtle text-fg-secondary hover:bg-surface-hover lg:hidden" aria-label="Open menu"><Menu size={18} /></button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-fg">{title}</h1>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={openCommandPalette}
                title={`Search (${SHORTCUT})`}
                className="grid h-9 w-9 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg lg:hidden"
                aria-label="Search"
              >
                <Search size={17} />
              </button>
              <NotificationsBell onPick={pick} />
              <div className="lg:hidden">
                <Dropdown
                  trigger={<div className="ml-1"><Avatar src={user?.picture} name={user?.name} size={30} /></div>}
                >
                  <div className="border-b border-subtle px-3 py-2.5">
                    <p className="truncate text-sm font-medium text-fg">{user?.name || 'You'}</p>
                    <p className="truncate text-xs text-fg-muted">{user?.email || 'Signed in'}</p>
                  </div>
                  <div className="py-1">
                    <MenuItem icon={User} onClick={() => pick('careerprofile')}>Career Profile</MenuItem>
                    <MenuItem icon={Settings} onClick={() => pick('settings')}>Settings</MenuItem>
                    <MenuItem icon={LifeBuoy} onClick={openSupportChat}>Support</MenuItem>
                    <MenuItem icon={LogOut} danger onClick={logout}>Sign out</MenuItem>
                  </div>
                </Dropdown>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6 lg:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}
