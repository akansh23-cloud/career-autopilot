import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, KeyRound, Building2, Loader2, LogOut, CheckCircle2, Clock } from 'lucide-react';
import { SectionCard } from '../views/common.jsx';
import { Badge, Button, Input, Field, Spinner } from './ui/kit.jsx';
import { My } from '../lib/api.js';

/* ============================================================
   MY COLLEGE CARD  (student self-service binding)
   ------------------------------------------------------------
   States, mirroring the server truth exactly:
   - unbound          → join-by-code input (+ one-tap domain suggestion)
                        and a "register your college" path for TPOs
   - pending          → joined by code, awaiting placement-cell approval
   - active           → bound; readiness visible to the placement cell
                        (per the consent choice); leave any time
   ============================================================ */
export default function MyCollegeCard() {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [reg, setReg] = useState({ name: '', city: '', domains: '' });

  const load = useCallback(async () => {
    try {
      const r = await My.college();
      setState({ loading: false, data: r, error: '' });
    } catch (e) {
      setState({ loading: false, data: null, error: e?.message || 'Failed to load' });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const join = async (joinCode) => {
    setBusy('join'); setMsg(null);
    try {
      const r = await My.joinCollege(joinCode);
      if (r?.ok) { setMsg({ tone: 'ok', text: r.message || 'Joined!' }); setCode(''); load(); }
      else setMsg({ tone: 'warn', text: r?.message || (r?.reason === 'db_off' ? 'A database connection is required to join a college.' : 'That code didn\'t work — check it with your placement cell.') });
    } catch (e) { setMsg({ tone: 'warn', text: e?.message || 'Join failed.' }); }
    finally { setBusy(''); }
  };

  const leave = async () => {
    if (!window.confirm('Leave your college? Your readiness data immediately stops being visible to its placement cell.')) return;
    setBusy('leave'); setMsg(null);
    try { const r = await My.leaveCollege(); if (r?.ok) load(); else setMsg({ tone: 'warn', text: r?.message || 'Could not leave.' }); }
    finally { setBusy(''); }
  };

  const register = async () => {
    setBusy('register'); setMsg(null);
    try {
      const domains = reg.domains.split(/[,\s]+/).map((d) => d.trim()).filter(Boolean);
      const r = await My.registerCollege({ name: reg.name.trim(), city: reg.city.trim(), domains });
      if (r?.ok) {
        setMsg({ tone: 'ok', text: `“${r.college?.name}” submitted. A platform admin reviews it; once activated you get the join code and roster tools, and your account is upgraded to placement-cell access.` });
        setShowRegister(false); load();
      } else setMsg({ tone: 'warn', text: r?.message || (r?.reason === 'db_off' ? 'A database connection is required to register a college.' : r?.error === 'already_exists' ? 'A college with this name is already registered — join it with its code instead.' : 'Registration failed.') });
    } catch (e) { setMsg({ tone: 'warn', text: e?.message || 'Registration failed.' }); }
    finally { setBusy(''); }
  };

  const { loading, data } = state;
  const college = data?.college || null;
  const membership = data?.membership || null;
  const suggestion = data?.domainSuggestion || null;

  return (
    <SectionCard title="My college" eyebrow="Link your account to your placement cell" icon={GraduationCap}>
      {loading ? <Spinner /> : college ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 size={16} className="text-aurora-cyan" />
            <span className="text-[14px] font-medium text-white">{college.name}</span>
            {membership?.status === 'pending'
              ? <Badge tone="amber"><Clock size={11} /> Awaiting placement-cell approval</Badge>
              : <Badge tone="mint"><CheckCircle2 size={11} /> Linked{membership?.via ? ` · via ${membership.via}` : ''}</Badge>}
            {college.demo && <Badge tone="violet">Demo</Badge>}
          </div>
          <p className="text-[12px] leading-relaxed text-slate-500">
            {membership?.status === 'pending'
              ? 'Your placement cell will approve your membership; you\'ll get a notification here the moment it happens.'
              : 'Your readiness score, resume score and verified projects are visible to your college\'s placement cell (you control this in the consent settings). Leaving removes their access immediately.'}
          </p>
          <Button size="sm" variant="soft" onClick={leave} disabled={busy === 'leave'}>
            {busy === 'leave' ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />} Leave college
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {suggestion && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-aurora-cyan/30 bg-aurora-cyan/5 p-3">
              <p className="text-[13px] text-slate-200">Your email domain matches <b>{suggestion.name}</b>.</p>
              <Button size="sm" onClick={() => join('')} disabled>Auto-links on next sign-in</Button>
            </div>
          )}
          <div>
            <Field label="Join with your college code" hint="Your placement cell shares this in class groups or orientation.">
              <div className="flex gap-2">
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. DEMO2026"
                  className="max-w-[190px] font-mono tracking-widest" onKeyDown={(e) => e.key === 'Enter' && code.trim() && join(code)} />
                <Button size="sm" onClick={() => join(code)} disabled={busy === 'join' || code.trim().length < 4}>
                  {busy === 'join' ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} Join
                </Button>
              </div>
            </Field>
          </div>

          <button onClick={() => setShowRegister((v) => !v)} className="text-[12px] text-aurora-cyan underline-offset-2 hover:underline">
            {showRegister ? 'Hide college registration' : 'Placement-cell staff? Register your college →'}
          </button>

          {showRegister && (
            <div className="space-y-3 rounded-xl border border-white/8 bg-white/[0.03] p-3">
              <Field label="College name"><Input value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} placeholder="e.g. Pune Institute of Computer Technology" /></Field>
              <Field label="City"><Input value={reg.city} onChange={(e) => setReg({ ...reg, city: e.target.value })} placeholder="Pune" /></Field>
              <Field label="Official email domains" hint="Comma-separated, e.g. pict.edu, students.pict.edu — public providers like gmail.com are rejected.">
                <Input value={reg.domains} onChange={(e) => setReg({ ...reg, domains: e.target.value })} placeholder="yourcollege.ac.in" />
              </Field>
              <Button size="sm" onClick={register} disabled={busy === 'register' || reg.name.trim().length < 3}>
                {busy === 'register' ? <Loader2 size={13} className="animate-spin" /> : 'Submit for activation'}
              </Button>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Registration creates a pending workspace and requests placement-cell (TPO) access for your account. A platform admin verifies and activates both together — you'll be notified here.
              </p>
            </div>
          )}
        </div>
      )}
      {msg && <p className={`mt-3 text-[12.5px] ${msg.tone === 'ok' ? 'text-aurora-mint' : 'text-amber-glow'}`}>{msg.text}</p>}
    </SectionCard>
  );
}
