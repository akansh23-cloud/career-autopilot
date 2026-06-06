import { useEffect, useState } from 'react';
import { Save, Check, Linkedin, Plug, LogOut, User, Briefcase, AlertTriangle, ShieldCheck, Trash2, Calendar, Clock, BadgeCheck } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Input, Field, Badge, Avatar, Spinner } from '../components/ui/kit.jsx';
import { Profile, Auth } from '../lib/api.js';
import { ROLE_GROUPS } from '../lib/roles.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { useSupport } from '../support/SupportProvider.jsx';

const MODES = ['Any', 'Remote', 'On-site', 'Hybrid'];
const ROLE_SUGGESTIONS = Object.values(ROLE_GROUPS).flat();
const LOCATION_SUGGESTIONS = ['Remote', 'Hybrid', 'Bengaluru', 'Hyderabad', 'Pune', 'Mumbai', 'Delhi NCR', 'Chennai', 'Kolkata', 'London', 'New York', 'San Francisco', 'Berlin', 'Singapore', 'Dubai', 'Toronto'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'AED'];
const SALARY_SUGGESTIONS = ['600000', '900000', '1200000', '1800000', '2400000', '3600000'];
// Accepts linkedin.com/in/handle, /pub/, company pages, with or without www/https.
const LINKEDIN_RE = /^(https?:\/\/)?(www\.)?([a-z]{2,3}\.)?linkedin\.com\/(in|pub|company|school)\/[^\s/]+\/?.*$/i;
const fmtDate = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return '—'; } };

export default function Settings() {
  const { user, logout } = useAuth();
  const support = useSupport();
  const [prefs, setPrefs] = useState({ titles: '', locations: '', workMode: 'Any', salaryMin: '', salaryMax: '', salaryCurrency: 'INR' });
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [conn, setConn] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    Profile.getCareer().then((d) => {
      if (d.preferences) setPrefs((p) => ({
        ...p,
        titles: (d.preferences.titles || []).join(', '),
        locations: (d.preferences.locations || []).join(', '),
        workMode: d.preferences.workMode || 'Any',
        salaryMin: d.preferences.salaryMin ?? '',
        salaryMax: d.preferences.salaryMax ?? '',
        salaryCurrency: d.preferences.salaryCurrency || 'INR',
      }));
      if (d.linkedin?.url) setLinkedinUrl(d.linkedin.url);
      setConn(d.oauth || {});
    }).catch(() => setConn({}));
  }, []);

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false);
    const lk = linkedinUrl.trim();
    if (lk && !LINKEDIN_RE.test(lk)) {
      setErr('Enter a valid LinkedIn URL, e.g. https://linkedin.com/in/your-handle');
      setSaving(false);
      return;
    }
    try {
      await Profile.saveCareer({
        linkedinUrl: lk || undefined,
        preferences: {
          titles: prefs.titles.split(',').map((s) => s.trim()).filter(Boolean),
          locations: prefs.locations.split(',').map((s) => s.trim()).filter(Boolean),
          workMode: prefs.workMode,
          salaryMin: prefs.salaryMin, salaryMax: prefs.salaryMax, salaryCurrency: prefs.salaryCurrency,
        },
      });
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <>
      <PageIntro title="Settings" sub="Tune your job preferences, connections and account." />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <SectionCard title="Job preferences">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Target roles" hint="comma separated · pick from suggestions or type your own"><Input list="role-suggestions" value={prefs.titles} onChange={(e) => setPrefs({ ...prefs, titles: e.target.value })} placeholder="DevOps Engineer, Platform Engineer" /></Field>
              <Field label="Locations" hint="comma separated · suggestions allowed"><Input list="location-suggestions" value={prefs.locations} onChange={(e) => setPrefs({ ...prefs, locations: e.target.value })} placeholder="Remote, Bengaluru" /></Field>
            </div>
            <datalist id="role-suggestions">{ROLE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}</datalist>
            <datalist id="location-suggestions">{LOCATION_SUGGESTIONS.map((l) => <option key={l} value={l} />)}</datalist>
            <datalist id="salary-suggestions">{SALARY_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
            <div className="mt-3">
              <span className="mb-1.5 block text-[13px] font-medium text-slate-300">Work mode</span>
              <div className="flex flex-wrap gap-2">
                {MODES.map((m) => (
                  <button key={m} onClick={() => setPrefs({ ...prefs, workMode: m })}
                    className={`rounded-lg px-3 py-1.5 text-xs transition ${prefs.workMode === m ? 'bg-aurora-violet/15 text-white ring-1 ring-aurora-violet/30' : 'text-slate-400 hover:bg-white/5'}`}>{m}</button>
                ))}
              </div>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Field label="Min salary" hint="annual"><Input list="salary-suggestions" type="number" value={prefs.salaryMin} onChange={(e) => setPrefs({ ...prefs, salaryMin: e.target.value })} placeholder="1200000" /></Field>
              <Field label="Max salary" hint="annual"><Input list="salary-suggestions" type="number" value={prefs.salaryMax} onChange={(e) => setPrefs({ ...prefs, salaryMax: e.target.value })} placeholder="2400000" /></Field>
              <Field label="Currency">
                <select value={CURRENCIES.includes(prefs.salaryCurrency) ? prefs.salaryCurrency : 'INR'} onChange={(e) => setPrefs({ ...prefs, salaryCurrency: e.target.value })} className="h-11 w-full rounded-xl border border-white/10 bg-ink-950 px-3 text-sm text-slate-100 outline-none">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="LinkedIn profile">
            <Field label="Profile URL">
              <div className="relative">
                <Linkedin size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/your-handle" className="pl-10" />
              </div>
            </Field>
          </SectionCard>

          {err && <p className="flex items-center gap-1.5 text-sm text-amber-glow"><AlertTriangle size={14} /> {err}</p>}
          <Button onClick={save} disabled={saving}>{saving ? <Spinner /> : saved ? <Check size={16} /> : <Save size={16} />} {saved ? 'Saved' : 'Save preferences'}</Button>
        </div>

        <div className="space-y-4">
          <SectionCard title="Account">
            <div className="flex items-center gap-3">
              <Avatar src={user?.picture} name={user?.name} size={48} />
              <div className="min-w-0">
                <p className="truncate font-medium text-white">{user?.name}</p>
                <p className="truncate text-xs text-slate-500">{user?.email || '—'}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2 border-t border-white/8 pt-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-400"><BadgeCheck size={14} /> Provider</span>
                <Badge tone="violet" className="capitalize">{user?.provider || '—'}</Badge>
              </div>
              {user?.role && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-slate-400"><User size={14} /> Role</span>
                  <span className="capitalize text-slate-200">{user.role}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-400"><Calendar size={14} /> Joined</span>
                <span className="text-slate-200">{fmtDate(user?.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-400"><Clock size={14} /> Last login</span>
                <span className="text-slate-200">{fmtDate(user?.lastLoginAt)}</span>
              </div>
            </div>
            <Button variant="danger" className="mt-4 w-full" onClick={logout}><LogOut size={15} /> Sign out</Button>
          </SectionCard>

          <SectionCard title="Data & Privacy">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-400">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-aurora-mint" />
              We store only safe profile fields (name, email, avatar, provider). We never store your Google password or access tokens. Resume text is used only to generate your analysis.
            </p>
            <button
              onClick={() => support?.openTicket({
                category: 'privacy',
                subject: 'Data deletion request',
                message: `Please delete the account and stored data associated with ${user?.email || '(my email)'}.`,
                priority: 'high',
              })}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-glow/30 bg-amber-glow/10 px-3 py-2.5 text-sm font-medium text-amber-glow transition hover:bg-amber-glow/20"
            >
              <Trash2 size={15} /> Request data deletion
            </button>
            <button
              onClick={() => support?.openSupport({ tab: 'help' })}
              className="mt-2 w-full text-center text-xs text-aurora-cyan hover:underline"
            >
              Visit Help Center
            </button>
          </SectionCard>

          <SectionCard title="Connectors">
            <div className="space-y-2.5">
              {[['LinkedIn', 'linkedin'], ['Indeed', 'indeed']].map(([label, key]) => {
                const c = conn?.[key];
                return (
                  <div key={key} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                    <span className="flex items-center gap-2 text-sm text-slate-200"><Plug size={15} className="text-aurora-cyan" /> {label}</span>
                    {!conn ? <Spinner /> : c?.connected ? <Badge tone="mint">Connected</Badge> : c?.enabled ? <Badge tone="cyan">Available</Badge> : <Badge>Off</Badge>}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-slate-500">Connectors are configured server-side via OAuth keys in <code className="font-mono">.env</code>.</p>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
