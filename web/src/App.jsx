import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from './hooks/useAuth.jsx';
import { syncPlanFromServer } from './lib/plan.js';
import { hydrateProfileFromServer, needsOnboarding, PROFILE_EVENT, setProfileUser } from './lib/userProfile.js';
import { clearAppCache, purgeLegacyUnscopedKeys } from './lib/userCache.js';
import Atmosphere from './components/Atmosphere.jsx';
import Landing from './components/landing/Landing.jsx';
import SignInModal from './components/SignInModal.jsx';
import Shell, { NAV } from './components/app/Shell.jsx';
import { Spinner } from './components/ui/kit.jsx';
import PricingModal from './components/PricingModal.jsx';
import { hydrateResumeFromServer, setResumeStoreUser } from './lib/resumeStore.js';
import { hydrateProjectsFromServer, setProjectStoreUser } from './lib/projectStore.js';
import { setMissionUser } from './lib/missions.js';
import { setNetworkUser, hydrateNetworkFromServer } from './lib/network.js';
import { setCreatorUser, hydrateCreatorFromServer } from './lib/projectCreator.js';
import { setTrackerStoreUser, hydrateTrackerFromServer } from './lib/trackerStore.js';

import RoleDashboard from './views/RoleDashboard.jsx';
import Onboarding from './views/Onboarding.jsx';
import Resume from './views/Resume.jsx';
import Editor from './views/Editor.jsx';
import JobsView from './views/Jobs.jsx';
import Tracker from './views/Tracker.jsx';
import Outreach from './views/Outreach.jsx';
import Arena from './views/Arena.jsx';
import Growth from './views/Growth.jsx';
import Settings from './views/Settings.jsx';
import ProjectStudio from './views/ProjectStudio.jsx';
import Sandbox from './views/Sandbox.jsx';
import PartnerMatch from './views/PartnerMatch.jsx';
import RecruiterConsole from './views/RecruiterConsole.jsx';
import CareerProfile, { PublicProfile } from './views/CareerProfile.jsx';
import Leaderboards from './views/Leaderboards.jsx';
import ReferralExchange from './views/ReferralExchange.jsx';
import ProjectCreator from './views/ProjectCreator.jsx';
import AdminUsers from './views/AdminUsers.jsx';
import SkillsXp from './views/SkillsXp.jsx';
import MarketplaceView from './views/Marketplace.jsx';
import InspirationsView from './views/Inspirations.jsx';
import ArchitectureView from './views/ArchitectureView.jsx';
import PatentEngine from './views/PatentEngine.jsx';
import ApplicationsView from './views/ApplicationsView.jsx';
import ReadinessView from './views/ReadinessView.jsx';

const VIEWS = {
  dash: RoleDashboard,
  careerprofile: CareerProfile,
  projectcreator: ProjectCreator,
  resume: Resume,
  editor: Editor,
  jobs: JobsView,
  tracker: Tracker,
  contacts: Outreach,
  referralexchange: ReferralExchange,
  leaderboards: Leaderboards,
  opportunities: Arena,
  projectstudio: ProjectStudio,
  sandbox: Sandbox,
  partners: PartnerMatch,
  recruiter: RecruiterConsole,
  growth: Growth,
  settings: Settings,
  adminusers: AdminUsers,
  skillsxp: SkillsXp,
  marketplace: MarketplaceView,
  inspirations: InspirationsView,
  architecture: ArchitectureView,
  patents: PatentEngine,
  applications: ApplicationsView,
  readiness: ReadinessView,
};

function Splash() {
  return (
    <div className="relative flex min-h-screen items-center justify-center">
      <Atmosphere variant="app" />
      <div className="flex flex-col items-center gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-aurora-cta shadow-glow">
          <span className="font-display text-2xl font-bold text-white">C</span>
        </div>
        <Spinner />
        <p className="text-sm text-muted">Loading your workspace…</p>
      </div>
    </div>
  );
}

function parseProfileHash() {
  if (typeof window === 'undefined') return null;
  const m = (window.location.hash || '').match(/^#\/profile\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Direct deep-link to the admin User Directory (#/admin/users). The view itself
// re-checks admin status and renders Access Denied for non-admins, so this is a
// convenience entry point — never an authorization bypass.
function isAdminUsersHash() {
  if (typeof window === 'undefined') return false;
  return /^#\/admin\/users\b/.test(window.location.hash || '');
}

export default function App() {
  const { user, loading } = useAuth();
  const [signIn, setSignIn] = useState(false);
  const [active, setActive] = useState('dash');
  const [onboarded, setOnboarded] = useState(!needsOnboarding());
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [publicId, setPublicId] = useState(() => parseProfileHash());
  const prevUserIdRef = useRef(null);

  // One-time cleanup of any pre-scoping legacy keys left by older builds.
  useEffect(() => { purgeLegacyUnscopedKeys(); }, []);

  useEffect(() => {
    const f = () => setPublicId(parseProfileHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  // Honor a #/admin/users deep link: route to the admin view on load + on change.
  // (The view enforces admin access; this only selects which workspace to show.)
  useEffect(() => {
    const f = () => { if (isAdminUsersHash()) setActive('adminusers'); };
    f();
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  useEffect(() => {
    let live = true;
    if (!user) {
      // Signed out: wipe ALL client cache so nothing survives for the next user.
      if (prevUserIdRef.current) clearAppCache();
      prevUserIdRef.current = null;
      setProfileUser(null);
      setResumeStoreUser(null);
      setProjectStoreUser(null);
      setMissionUser(null);
      setNetworkUser(null);
      setCreatorUser(null);
      setTrackerStoreUser(null);
      setWorkspaceReady(false);
      return () => { live = false; };
    }
    // A different user signed in on this browser → clear the previous user's cache
    // before wiring up the new identity, then rehydrate from the server.
    if (prevUserIdRef.current && prevUserIdRef.current !== user.id) clearAppCache();
    prevUserIdRef.current = user.id;
    setWorkspaceReady(false);
    setProfileUser(user);
    setResumeStoreUser(user);
    setProjectStoreUser(user);
    setMissionUser(user);
    setNetworkUser(user);
    setCreatorUser(user);
    setTrackerStoreUser(user);
    syncPlanFromServer();
    Promise.all([hydrateProfileFromServer(), hydrateResumeFromServer(), hydrateProjectsFromServer(), hydrateNetworkFromServer(), hydrateCreatorFromServer(), hydrateTrackerFromServer()])
      .finally(() => { if (live) { setOnboarded(!needsOnboarding()); setWorkspaceReady(true); } });
    return () => { live = false; };
  }, [user]);
  useEffect(() => {
    const f = () => setOnboarded(!needsOnboarding());
    window.addEventListener(PROFILE_EVENT, f);
    return () => window.removeEventListener(PROFILE_EVENT, f);
  }, []);
  // profile updates after onboarding/settings should refresh the gate

  if (loading || (user && !workspaceReady)) return <Splash />;

  if (!user) {
    return (
      <>
        <Landing onSignIn={() => setSignIn(true)} />
        <SignInModal open={signIn} onClose={() => setSignIn(false)} />
      </>
    );
  }

  // Shareable recruiter-safe profile route: #/profile/:userId (works for any signed-in user).
  if (publicId) {
    const back = () => { window.location.hash = ''; setPublicId(null); };
    return (
      <div className="relative min-h-screen">
        <Atmosphere variant="app" />
        <main className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <PublicProfile userId={publicId} onBack={back} />
        </main>
      </div>
    );
  }

  if (!onboarded) {
    return <Onboarding onDone={() => setOnboarded(true)} />;
  }

  const ViewCmp = VIEWS[active] || RoleDashboard;
  const title = (NAV.find((n) => n.id === active) || {}).label || 'Dashboard';

  // Guarded navigation: only switch to a real, registered view id. Unknown or
  // stale ids are ignored (instead of silently rendering the dashboard or a
  // blank page), so internal links can never land on the wrong workspace.
  const navigate = (id) => {
    // Canonical Career Profile route. The old standalone "Profile" view was a
    // duplicate of Career Profile, so any legacy link/CTA pointing at it now
    // redirects here instead of crashing or opening a second profile page.
    if (id === 'profile') id = 'careerprofile';
    if (typeof id === 'string' && Object.prototype.hasOwnProperty.call(VIEWS, id)) setActive(id);
    else if (id != null && typeof console !== 'undefined') console.warn(`[nav] ignored unknown view id: ${String(id)}`);
  };

  return (
    <Shell active={active} onPick={navigate} title={title}>
      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          <ViewCmp go={navigate} />
        </motion.div>
      </AnimatePresence>
      <PricingModal />
    </Shell>
  );
}
