import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from './hooks/useAuth.jsx';
import Atmosphere from './components/Atmosphere.jsx';
import Landing from './components/landing/Landing.jsx';
import SignInModal from './components/SignInModal.jsx';
import Shell, { NAV } from './components/app/Shell.jsx';
import { Spinner } from './components/ui/kit.jsx';
import PricingModal from './components/PricingModal.jsx';

import Dashboard from './views/Dashboard.jsx';
import Resume from './views/Resume.jsx';
import Editor from './views/Editor.jsx';
import JobsView from './views/Jobs.jsx';
import Tracker from './views/Tracker.jsx';
import Outreach from './views/Outreach.jsx';
import Arena from './views/Arena.jsx';
import Growth from './views/Growth.jsx';
import Settings from './views/Settings.jsx';

const VIEWS = {
  dash: Dashboard,
  resume: Resume,
  editor: Editor,
  jobs: JobsView,
  tracker: Tracker,
  contacts: Outreach,
  opportunities: Arena,
  growth: Growth,
  settings: Settings,
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

export default function App() {
  const { user, loading } = useAuth();
  const [signIn, setSignIn] = useState(false);
  const [active, setActive] = useState('dash');

  if (loading) return <Splash />;

  if (!user) {
    return (
      <>
        <Landing onSignIn={() => setSignIn(true)} />
        <SignInModal open={signIn} onClose={() => setSignIn(false)} />
      </>
    );
  }

  const ViewCmp = VIEWS[active] || Dashboard;
  const title = (NAV.find((n) => n.id === active) || {}).label || 'Dashboard';

  return (
    <Shell active={active} onPick={setActive} title={title}>
      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          <ViewCmp go={setActive} />
        </motion.div>
      </AnimatePresence>
      <PricingModal />
    </Shell>
  );
}
