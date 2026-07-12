import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from './hooks/useAuth.jsx';
import { syncPlanFromServer, getPlan } from './lib/plan.js';
import { hydrateProfileFromServer, needsOnboarding, PROFILE_EVENT, setProfileUser, getProfile } from './lib/userProfile.js';
import { getEffectiveRole, canSeeScreen, defaultScreenForUser } from './lib/roleCapabilities.js';
import { clearAccessContext, getAccessContext, refreshAccessContext, useAccountAccessContext } from './lib/accessContext.js';
import { clearAppCache, purgeLegacyUnscopedKeys } from './lib/userCache.js';
import Atmosphere from './components/Atmosphere.jsx';
import Landing from './components/landing/Landing.jsx';
import SignInModal from './components/SignInModal.jsx';
import Shell, { NAV } from './components/app/Shell.jsx';
import { Spinner } from './components/ui/kit.jsx';
import PricingModal from './components/PricingModal.jsx';
import ConsentModal from './components/ConsentModal.jsx';
import LegalView from './views/LegalView.jsx';
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
import ProjectBuilder from './views/ProjectBuilder.jsx';
import Sandbox from './views/Sandbox.jsx';
import PartnerMatch from './views/PartnerMatch.jsx';
import RecruiterConsole from './views/RecruiterConsole.jsx';
import CollegeWorkspace from './views/CollegeWorkspace.jsx';
import VerificationStatus from './views/VerificationStatus.jsx';
import CareerProfile, { PublicProfile } from './views/CareerProfile.jsx';
import Leaderboards from './views/Leaderboards.jsx';
import ReferralExchange from './views/ReferralExchange.jsx';
import ProjectCreator from './views/ProjectCreator.jsx';
import AdminUsers from './views/AdminUsers.jsx';
import SkillsXp from './views/SkillsXp.jsx';
import MarketplaceView from './views/Marketplace.jsx';
import InspirationsView from './views/Inspirations.jsx';
import ArchitectureView from './views/ArchitectureView.jsx';
import PatentDashboard from './views/patent/PatentDashboard.jsx';
import PatentIdeaGenerator from './views/patent/PatentIdeaGenerator.jsx';
import PatentIdeaWorkspace from './views/patent/PatentIdeaWorkspace.jsx';
import PatentPortfolio from './views/patent/PatentPortfolio.jsx';
import PriorArtResearch from './views/patent/PriorArtResearch.jsx';
import PatentDisclosures from './views/patent/PatentDisclosures.jsx';
import InnovationOS from './views/innovation/InnovationOS.jsx';
import ApplicationsView from './views/ApplicationsView.jsx';
import ReadinessView from './views/ReadinessView.jsx';
import ProjectWorkspace from './views/ProjectWorkspace.jsx';

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
  projectbuilder: ProjectBuilder,
  sandbox: Sandbox,
  partners: PartnerMatch,
  recruiter: RecruiterConsole,
  college: CollegeWorkspace,
  verification: VerificationStatus,
  growth: Growth,
  settings: Settings,
  adminusers: AdminUsers,
  skillsxp: SkillsXp,
  marketplace: MarketplaceView,
  inspirations: InspirationsView,
  architecture: ArchitectureView,
  patents: PatentDashboard,
  patentgenerate: PatentIdeaGenerator,
  patentworkspace: PatentIdeaWorkspace,
  patentportfolio: PatentPortfolio,
  priorart: PriorArtResearch,
  patentdisclosures: PatentDisclosures,
  innovation: InnovationOS,
  applications: ApplicationsView,
  readiness: ReadinessView,
  projectworkspace: ProjectWorkspace,
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

// Minimal unauthorized fallback. This is a BACKSTOP only — it renders solely
// when a blocked screen is reached by direct hash/URL tampering. Normal UX never
// lands here because every nav surface is capability-filtered upstream.
function AccessFallback({ onHome }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-6">
      <Atmosphere variant="app" />
      <div className="relative flex max-w-md flex-col items-center gap-4 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-300">
          <span className="font-display text-xl font-bold">403</span>
        </div>
        <h1 className="font-display text-xl font-semibold text-white">This workspace isn’t available for your account</h1>
        <p className="text-sm text-muted">You don’t have access to that screen. Let’s take you back to your dashboard.</p>
        <button onClick={onHome} className="mt-1 rounded-xl btn-primary px-4 py-2 text-sm font-semibold text-ink-950">
          Go to my dashboard
        </button>
      </div>
    </div>
  );
}

// Public legal pages: #/legal or #/legal/<terms|privacy|refunds|contact>.
// Renders for signed-out visitors (payment reviewers, college admin offices)
// and signed-in users alike — a truly public route, like #/profile/:id.
function parseLegalHash() {
  if (typeof window === 'undefined') return null;
  const m = (window.location.hash || '').match(/^#\/legal(?:\/([a-z]+))?/);
  return m ? (m[1] || 'terms') : null;
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
  const [viewParams, setViewParams] = useState({});
  const [onboarded, setOnboarded] = useState(!needsOnboarding());
  // Bumped on every profile change so App re-resolves the effective role,
  // navigation and default landing immediately when the persona is switched.
  const [, setProfileTick] = useState(0);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [publicId, setPublicId] = useState(() => parseProfileHash());
  const [legalSection, setLegalSection] = useState(() => parseLegalHash());
  const prevUserIdRef = useRef(null);

  // One-time cleanup of any pre-scoping legacy keys left by older builds.
  useEffect(() => { purgeLegacyUnscopedKeys(); }, []);

  useEffect(() => {
    const f = () => { setPublicId(parseProfileHash()); setLegalSection(parseLegalHash()); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  // Honor a #/admin/users deep link: route to the admin view on load + on change
  // — but ONLY if the effective role may see it. Non-admins are redirected to
  // their default landing (the deep link is a convenience, never a bypass).
  useEffect(() => {
    const f = () => {
      if (!isAdminUsersHash()) return;
      const role = getEffectiveRole(getProfile(), { isAdmin: getPlan().isAdmin, accessContext: getAccessContext() });
      if (canSeeScreen(role, 'adminusers')) setActive('adminusers');
      else setActive(defaultScreenForUser(getProfile(), { isAdmin: getPlan().isAdmin, accessContext: getAccessContext() }));
    };
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
      clearAccessContext();
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
    Promise.all([refreshAccessContext(), hydrateProfileFromServer(), hydrateResumeFromServer(), hydrateProjectsFromServer(), hydrateNetworkFromServer(), hydrateCreatorFromServer(), hydrateTrackerFromServer()])
      .finally(() => { if (live) { setOnboarded(!needsOnboarding()); setWorkspaceReady(true); } });
    return () => { live = false; };
  }, [user]);
  useEffect(() => {
    const f = () => { setOnboarded(!needsOnboarding()); setProfileTick((t) => t + 1); };
    window.addEventListener(PROFILE_EVENT, f);
    return () => window.removeEventListener(PROFILE_EVENT, f);
  }, []);
  // profile updates after onboarding/settings should refresh the gate
  const accessContextState = useAccountAccessContext(!!user && workspaceReady);

  if (loading || (user && !workspaceReady)) return <Splash />;

  // Public legal pages render for everyone, before any auth gating.
  if (legalSection) {
    const back = () => { window.location.hash = ''; setLegalSection(null); };
    return <LegalView section={legalSection} onBack={back} />;
  }

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

  const effectiveRole = getEffectiveRole(getProfile(), { isAdmin: getPlan().isAdmin, accessContext: accessContextState.context });
  const defaultActive = defaultScreenForUser(getProfile(), { isAdmin: getPlan().isAdmin, accessContext: accessContextState.context });
  const renderActive = canSeeScreen(effectiveRole, active) ? active : defaultActive;
  const ViewCmp = VIEWS[renderActive] || RoleDashboard;
  const TITLE_OVERRIDES = { projectbuilder: 'Project Builder', projectworkspace: 'Project Workspace' };
  const title = TITLE_OVERRIDES[renderActive] || (NAV.find((n) => n.id === renderActive) || {}).label || 'Dashboard';

  const goHome = () => setActive(defaultActive);

  // Guarded navigation: only switch to a real, registered view id THAT THE
  // CURRENT ROLE MAY SEE. Unknown/stale ids are ignored; blocked ids redirect to
  // the role's default landing instead of rendering the wrong workspace. This is
  // the single choke point every internal go()/navigate() call flows through.
  const navigate = (id, params = {}) => {
    // Canonical Career Profile route (legacy "profile" → careerprofile).
    if (id === 'profile') id = 'careerprofile';
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(VIEWS, id)) {
      if (id != null && typeof console !== 'undefined') console.warn(`[nav] ignored unknown view id: ${String(id)}`);
      return;
    }
    if (!canSeeScreen(effectiveRole, id)) {
      if (typeof console !== 'undefined') console.warn(`[nav] blocked view id for role ${effectiveRole}: ${id}`);
      goHome();
      return;
    }
    setActive(id);
    setViewParams(params && typeof params === 'object' ? params : {});
  };

  // Backstop is redirect-by-render: if active becomes invalid after a role/context
  // change, render the role default instead of the blocked workspace.

  return (
    <Shell active={renderActive} onPick={navigate} title={title}>
      <AnimatePresence mode="wait">
        <motion.div
          key={renderActive}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          <ViewCmp go={navigate} {...(renderActive === active ? viewParams : {})} />
        </motion.div>
      </AnimatePresence>
      <PricingModal />
      <ConsentModal />
    </Shell>
  );
}
