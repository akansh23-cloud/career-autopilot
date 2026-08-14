import { useEffect, useState } from 'react';
import { Database, ShieldCheck } from 'lucide-react';
import { PageIntro } from './common.jsx';
import AdminJobIngestPanel from './AdminJobIngestPanel.jsx';
import { getPlan, PLAN_EVENT } from '../lib/plan.js';

function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(() => !!getPlan().isAdmin);
  useEffect(() => {
    const sync = () => setIsAdmin(!!getPlan().isAdmin);
    window.addEventListener(PLAN_EVENT, sync);
    return () => window.removeEventListener(PLAN_EVENT, sync);
  }, []);
  return isAdmin;
}

export default function AdminJobDiscovery() {
  const isAdmin = useIsAdmin();

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <div className="rounded-2xl border border-subtle bg-surface-1 p-8 text-center">
          <ShieldCheck className="mx-auto mb-3 text-fg-muted" size={28} />
          <h1 className="text-xl font-semibold text-fg">Admin access required</h1>
          <p className="mt-2 text-sm text-fg-secondary">Job Discovery operations are available only to platform administrators.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageIntro
        title="Job Discovery"
        sub="Fetch, queue, search and audit canonical jobs and direct employer career sources."
        action={
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-aurora-violet/30 bg-aurora-violet/10 px-3 py-2 text-xs font-semibold text-brand">
            <Database size={14} /> Admin ingestion
          </span>
        }
      />
      <AdminJobIngestPanel />
    </div>
  );
}
