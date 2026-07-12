import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyRound, Copy, RefreshCw, Globe, Upload, Users, CheckCircle2,
  XCircle, Loader2, ShieldAlert, Mail, FileSpreadsheet, Check,
} from 'lucide-react';
import { SectionCard, StatCard } from '../../views/common.jsx';
import { Badge, Button, EmptyState, Input, Spinner } from '../ui/kit.jsx';
import { College } from '../../lib/api.js';

/* ============================================================
   COLLEGE ONBOARDING PANEL  (placement-cell setup & roster)
   ------------------------------------------------------------
   Everything a TPO needs to bring their college onto the platform:
   1. Join code — share with students; copy / rotate.
   2. Verified email domains — auto-binds matching sign-ins.
   3. Roster import — paste or upload the placement-cell CSV; rows
      auto-link the moment a matching student signs in.
   4. Pending memberships — approve/remove code-joins when
      auto-approve is off.
   All figures come from the server; nothing here is simulated.
   ============================================================ */

function useLoad(fn) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    Promise.resolve().then(fn)
      .then((data) => setState({ loading: false, error: '', data }))
      .catch((e) => setState({ loading: false, error: e?.message || 'Failed to load', data: null }));
  }, [fn]);
  useEffect(() => { run(); }, [run]);
  return [state, run];
}

/* ---- 1. Join code + auto-approve toggles ---- */
function JoinCodeCard({ college, onChanged }) {
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try { await navigator.clipboard.writeText(college.joinCode); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* noop */ }
  };
  const rotate = async () => {
    if (!window.confirm('Rotate the join code? The old code stops working immediately — students who have it will need the new one.')) return;
    setBusy('rotate');
    try { const r = await College.rotateJoinCode(); if (r?.ok) onChanged(); } finally { setBusy(''); }
  };
  const toggle = async (key, value) => {
    setBusy(key);
    try { const r = await College.updateSettings({ [key]: value }); if (r?.ok) onChanged(); } finally { setBusy(''); }
  };

  const s = college.settings || {};
  return (
    <SectionCard title="Student join code" eyebrow="Share in class groups, orientation decks, notice boards" icon={KeyRound}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-xl border border-aurora-violet/40 bg-aurora-violet/10 px-4 py-2 font-mono text-xl tracking-[0.25em] text-white">
          {college.joinCode || '—'}
        </span>
        <Button size="sm" variant="soft" onClick={copy}>{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</Button>
        <Button size="sm" variant="soft" onClick={rotate} disabled={busy === 'rotate'}>
          {busy === 'rotate' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Rotate
        </Button>
        {college.demo && <Badge tone="violet">Demo college</Badge>}
      </div>
      <div className="mt-4 space-y-2">
        {[
          ['autoApproveCodeJoins', 'Auto-approve students who join with this code', 'Off = code joins land in “Pending memberships” below for your review.'],
          ['autoApproveDomainJoins', 'Auto-bind sign-ins from your verified email domains', 'Students signing in with a listed domain link to your college automatically.'],
        ].map(([key, label, hint]) => (
          <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-3 transition hover:bg-white/[0.05]">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-400"
              checked={!!s[key]} disabled={busy === key}
              onChange={(e) => toggle(key, e.target.checked)} />
            <span>
              <span className="block text-[13px] font-medium text-white">{label}</span>
              <span className="block text-[11.5px] text-slate-500">{hint}</span>
            </span>
          </label>
        ))}
      </div>
    </SectionCard>
  );
}

/* ---- 2. Verified email domains ---- */
function DomainsCard({ college, onChanged }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const save = async (domains) => {
    setBusy(true); setFeedback(null);
    try {
      const r = await College.updateSettings({ domains });
      if (r?.ok) {
        setFeedback(r.rejected?.length ? { rejected: r.rejected } : null);
        setInput('');
        onChanged();
      } else setFeedback({ error: r?.message || 'Could not update domains.' });
    } finally { setBusy(false); }
  };

  const add = () => {
    const d = input.trim();
    if (!d) return;
    save([...(college.domains || []), d]);
  };
  const remove = (d) => save((college.domains || []).filter((x) => x !== d));

  return (
    <SectionCard title="Verified email domains" eyebrow="e.g. yourcollege.ac.in — subdomains match automatically" icon={Globe}>
      <div className="flex flex-wrap gap-2">
        {(college.domains || []).length === 0 && <p className="text-[12px] text-slate-500">No domains yet. Add your institute domain so student sign-ins auto-link.</p>}
        {(college.domains || []).map((d) => (
          <span key={d} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[12px] text-slate-200">
            {d}
            <button onClick={() => remove(d)} className="text-slate-500 transition hover:text-rose-400" aria-label={`Remove ${d}`}><XCircle size={13} /></button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="students.yourcollege.ac.in"
          onKeyDown={(e) => e.key === 'Enter' && add()} className="max-w-xs" />
        <Button size="sm" onClick={add} disabled={busy || !input.trim()}>{busy ? <Loader2 size={13} className="animate-spin" /> : 'Add domain'}</Button>
      </div>
      {feedback?.rejected?.length > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-amber-glow">
          <ShieldAlert size={13} /> Rejected: {feedback.rejected.join(', ')} — public email providers and malformed domains can't be claimed as college domains.
        </p>
      )}
      {feedback?.error && <p className="mt-2 text-[12px] text-amber-glow">{feedback.error}</p>}
    </SectionCard>
  );
}

/* ---- 3. Roster import + table ---- */
const ROSTER_TEMPLATE = 'email,name,branch,batch,rollno\naarav.sharma@college.ac.in,Aarav Sharma,CSE,2027,CS21B001';

function RosterCard({ onImported }) {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const [{ loading, data }, reload] = useLoad(useCallback(() => College.roster(), []));
  const rows = data?.rows || [];
  const counts = data?.counts || { invited: 0, joined: 0 };

  const readFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ''));
    reader.readAsText(file);
  };

  const doImport = async () => {
    setBusy(true); setResult(null);
    try {
      const r = await College.importRoster(csv);
      setResult(r);
      if (r?.ok) { setCsv(''); reload(); onImported?.(); }
    } catch (e) {
      setResult({ ok: false, message: e?.message || 'Import failed.' });
    } finally { setBusy(false); }
  };

  return (
    <SectionCard title="Roster import" eyebrow="Paste or upload your placement-cell student list (CSV)" icon={FileSpreadsheet}>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:max-w-xs">
        <StatCard label="On roster" value={rows.length} icon={Users} />
        <StatCard label="Joined" value={counts.joined || 0} icon={CheckCircle2} />
      </div>

      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={ROSTER_TEMPLATE}
        rows={5}
        className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 font-mono text-[12px] text-slate-200 placeholder:text-slate-600 focus:border-aurora-violet/50 focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={doImport} disabled={busy || csv.trim().length < 3}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Import roster
        </Button>
        <Button size="sm" variant="soft" onClick={() => fileRef.current?.click()}>Upload .csv file</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
        <span className="text-[11px] text-slate-500">Columns: email (required), name, branch, batch, rollno. Header row optional.</span>
      </div>

      {result && (
        <div className={`mt-3 rounded-xl border p-3 text-[12.5px] ${result.ok ? 'border-aurora-mint/30 bg-aurora-mint/5 text-slate-200' : 'border-amber-glow/30 bg-amber-glow/5 text-amber-glow'}`}>
          {result.ok
            ? <>Imported <b>{result.imported ?? 0}</b> row{(result.imported ?? 0) === 1 ? '' : 's'} ({result.updated ?? 0} updated). <b>{result.autoLinked ?? 0}</b> already-registered student{(result.autoLinked ?? 0) === 1 ? '' : 's'} linked instantly. Everyone else links the moment they sign in with their listed email.</>
            : <>{result.message || 'Import failed.'}{result.parseErrors?.length ? ` First issues: ${result.parseErrors.slice(0, 3).join(' · ')}` : ''}</>}
        </div>
      )}

      <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-white/8">
        {loading ? <div className="p-6"><Spinner /></div> : rows.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title="No roster yet" hint="Import your student list above — it's the fastest way to onboard a full batch." />
        ) : (
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 bg-ink-900 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>{['Email', 'Name', 'Branch', 'Batch', 'Status'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5 text-slate-300">
                  <td className="px-3 py-1.5 font-mono text-[11px]">{r.email}</td>
                  <td className="px-3 py-1.5">{r.name || '—'}</td>
                  <td className="px-3 py-1.5">{r.branch || '—'}</td>
                  <td className="px-3 py-1.5">{r.batch || '—'}</td>
                  <td className="px-3 py-1.5">
                    <Badge tone={r.status === 'joined' ? 'mint' : 'default'}>{r.status === 'joined' ? 'Joined' : 'Invited'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </SectionCard>
  );
}

/* ---- 4. Pending memberships ---- */
function PendingCard({ refreshKey }) {
  const [{ loading, data }, reload] = useLoad(useCallback(() => College.members('pending'), []));
  useEffect(() => { reload(); }, [refreshKey, reload]);
  const [busy, setBusy] = useState('');
  const members = data?.members || [];

  const act = async (id, action) => {
    setBusy(id + action);
    try {
      if (action === 'approve') await College.approveMember(id);
      else await College.removeMember(id);
      reload();
    } finally { setBusy(''); }
  };

  return (
    <SectionCard title="Pending memberships" eyebrow="Students who joined by code, awaiting your approval" icon={Users}>
      {loading ? <Spinner /> : members.length === 0 ? (
        <p className="text-[12.5px] text-slate-500">Nothing pending. With auto-approve on, code joins activate instantly and never appear here.</p>
      ) : members.map((m) => (
        <div key={m.id} className="flex items-center justify-between gap-3 border-b border-white/5 py-2 last:border-0">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-white">{m.name || m.email}</p>
            <p className="truncate text-[11px] text-slate-500">{m.email} · via {m.membership?.via || 'code'}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="xs" onClick={() => act(m.id, 'approve')} disabled={busy === m.id + 'approve'}>
              {busy === m.id + 'approve' ? <Loader2 size={12} className="animate-spin" /> : <><CheckCircle2 size={12} /> Approve</>}
            </Button>
            <Button size="xs" variant="soft" onClick={() => act(m.id, 'remove')} disabled={busy === m.id + 'remove'}>Remove</Button>
          </div>
        </div>
      ))}
    </SectionCard>
  );
}

export default function OnboardingPanel() {
  const [{ loading, error, data }, reload] = useLoad(useCallback(() => College.settings(), []));
  const [refreshKey, setRefreshKey] = useState(0);
  const college = data?.college || null;
  const emailConfigured = !!data?.emailConfigured;

  const bump = useMemo(() => () => { reload(); setRefreshKey((k) => k + 1); }, [reload]);

  if (loading) return <div className="py-10"><Spinner /></div>;
  if (error) return <EmptyState icon={XCircle} title="Couldn't load onboarding" hint={error} action={<Button size="sm" variant="soft" onClick={reload}>Retry</Button>} />;
  if (!college) {
    return (
      <EmptyState icon={KeyRound} title="No college workspace bound to this account"
        hint="Register your college from Settings → My College. A platform admin activates it, and this panel unlocks with your join code and roster tools." />
    );
  }

  return (
    <div className="space-y-5">
      {college.status !== 'active' && (
        <div className="rounded-xl border border-amber-glow/30 bg-amber-glow/5 p-3 text-[12.5px] text-amber-glow">
          {college.name} is <b>{college.status}</b> — students can't join until a platform admin activates it. Everything below goes live the moment it's approved.
        </div>
      )}
      {!emailConfigured && (
        <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[12px] text-slate-400">
          <Mail size={14} className="shrink-0" /> Email delivery isn't configured on this deployment — nudges and task assignments are delivered in-app (guaranteed), and email switches on automatically once SMTP is set.
        </div>
      )}
      <JoinCodeCard college={college} onChanged={bump} />
      <DomainsCard college={college} onChanged={bump} />
      <RosterCard onImported={() => setRefreshKey((k) => k + 1)} />
      <PendingCard refreshKey={refreshKey} />
    </div>
  );
}
