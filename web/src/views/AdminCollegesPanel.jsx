import { useCallback, useEffect, useState } from 'react';
import { Building2, CheckCircle2, Loader2, RefreshCw, Sparkles, Globe } from 'lucide-react';
import { SectionCard } from './common.jsx';
import { Badge, Button, EmptyState, Spinner } from '../components/ui/kit.jsx';
import { AdminColleges } from '../lib/api.js';

/* ============================================================
   ADMIN · COLLEGE REGISTRY  (platform-admin only)
   ------------------------------------------------------------
   The activation gate for multi-college tenancy: every registered
   college starts `pending` and is invisible/unjoinable until a
   platform admin approves it here. Approving also verifies the
   registrant as that college's placement-cell (college_admin).
   Includes the one-click demo-college seeder used for sales demos.
   ============================================================ */
export default function AdminCollegesPanel() {
  const [state, setState] = useState({ loading: true, error: '', colleges: [] });
  const [busy, setBusy] = useState('');
  const [seedMsg, setSeedMsg] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await AdminColleges.list();
      setState({ loading: false, error: '', colleges: r?.colleges || [] });
    } catch (e) {
      setState({ loading: false, error: e?.status === 403 ? 'Admin access required.' : (e?.message || 'Could not load colleges.'), colleges: [] });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const approve = async (key) => {
    setBusy(key);
    try { const r = await AdminColleges.approve(key); if (r?.ok) load(); }
    finally { setBusy(''); }
  };

  const seedDemo = async (reset = false) => {
    setBusy('seed'); setSeedMsg('');
    try {
      const r = await AdminColleges.seedDemo(reset);
      setSeedMsg(r?.ok
        ? `Demo college ready: “${r.collegeKey}” with ${Array.isArray(r.students) ? r.students : r.students ?? 0} students · join code ${r.joinCode}. Sign in as a college admin bound to it (or approve one) to demo the command center.`
        : (r?.message || r?.reason === 'db_off' ? 'A database connection is required to seed the demo college.' : 'Seeding failed.'));
      if (r?.ok) load();
    } catch (e) { setSeedMsg(e?.message || 'Seeding failed.'); }
    finally { setBusy(''); }
  };

  const { loading, error, colleges } = state;
  const pending = colleges.filter((c) => c.status === 'pending');
  const active = colleges.filter((c) => c.status !== 'pending');

  return (
    <SectionCard className="mb-6" title="College registry" eyebrow="Multi-tenant activation gate — approvals also verify the registering TPO"
      icon={Building2}
      action={<div className="flex items-center gap-2">
        <Button size="sm" variant="soft" onClick={() => seedDemo(false)} disabled={busy === 'seed'}>
          {busy === 'seed' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Seed demo college
        </Button>
        <Button size="sm" variant="soft" onClick={load}><RefreshCw size={13} /></Button>
      </div>}>
      {seedMsg && <p className="mb-3 rounded-xl border border-aurora-violet/30 bg-aurora-violet/[0.07] p-3 text-[12.5px] text-slate-200">{seedMsg}</p>}
      {loading ? <Spinner /> : error ? (
        <EmptyState icon={Building2} title="Couldn't load the registry" hint={error} />
      ) : colleges.length === 0 ? (
        <p className="text-[12.5px] text-slate-500">No colleges registered yet. TPOs register from Settings → My College; new registrations land here for activation.</p>
      ) : (
        <div className="space-y-1">
          {[...pending, ...active].map((c) => (
            <div key={c.key} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 py-2 last:border-0">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13.5px] font-medium text-white">
                  {c.name}
                  <Badge tone={c.status === 'active' ? 'mint' : c.status === 'pending' ? 'amber' : 'default'}>{c.status}</Badge>
                  {c.demo && <Badge tone="violet">demo</Badge>}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500">
                  <span className="font-mono">{c.key}</span>
                  {c.city && <span>{c.city}</span>}
                  {(c.domains || []).length > 0 && <span className="inline-flex items-center gap-1"><Globe size={10} /> {(c.domains || []).join(', ')}</span>}
                  {c.createdByEmail && <span>by {c.createdByEmail}</span>}
                  <span>{c.memberCounts?.bound ?? 0} member{(c.memberCounts?.bound ?? 0) === 1 ? '' : 's'}</span>
                </p>
              </div>
              {c.status === 'pending' && (
                <Button size="sm" onClick={() => approve(c.key)} disabled={busy === c.key}>
                  {busy === c.key ? <Loader2 size={13} className="animate-spin" /> : <><CheckCircle2 size={13} /> Activate</>}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
