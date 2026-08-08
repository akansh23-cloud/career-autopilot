import { useState } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { Modal, Button } from './ui/kit.jsx';
import { My } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.jsx';

/* ============================================================
   DPDP CONSENT MODAL  (blocking; version-tracked)
   ------------------------------------------------------------
   Shown whenever the signed-in user has not accepted the CURRENT
   consent version (/auth/me → consentRequired). The user cannot
   dismiss it without deciding — DPDP consent must be explicit, not
   implied. The college-visibility choice is a real, separate toggle:
   declining it keeps the account fully usable but keeps readiness
   data OUT of any placement-cell dashboard (enforced server-side).
   ============================================================ */
export default function ConsentModal() {
  const { user, consentRequired, consentVersion, refresh } = useAuth();
  const [collegeVisibility, setCollegeVisibility] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!user || !consentRequired) return null;

  const accept = async () => {
    setBusy(true); setErr('');
    try {
      const r = await My.consent({ accept: true, collegeVisibility });
      if (!r?.ok) throw new Error(r?.message || 'Could not record consent — please try again.');
      await refresh();
    } catch (e) {
      setErr(e?.message || 'Could not record consent — please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={() => {}} title="Your data, your call" width="max-w-xl">
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-subtle bg-surface-1 p-3">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-aurora-mint" />
          <p className="text-[13px] leading-relaxed text-fg-secondary">
            Before you continue, here is exactly what Career Autopilot does with your data — in plain language, as India's DPDP Act expects.
          </p>
        </div>

        <ul className="space-y-2 text-[13px] leading-relaxed text-fg-secondary">
          <li><span className="text-fg">What we store:</span> your profile, resumes and their scores, projects and verification evidence, skill XP, patent-workspace drafts, and activity needed to compute your readiness.</li>
          <li><span className="text-fg">Why:</span> to score, verify and improve your placement readiness — nothing is sold, and there are no ads.</li>
          <li><span className="text-fg">Your rights, built in:</span> download everything from Settings → “Export my data”, and delete your account any time (7-day grace window; signing back in cancels it).</li>
          <li><span className="text-fg">Recruiters:</span> see your profile only if you explicitly publish it — that is a separate opt-in, off by default.</li>
        </ul>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-subtle bg-surface-1 p-3 transition hover:bg-surface-1">
          <input
            type="checkbox"
            checked={collegeVisibility}
            onChange={(e) => setCollegeVisibility(e.target.checked)}
            className="mt-1 h-4 w-4 accent-violet-400"
          />
          <span className="text-[13px] leading-relaxed text-fg-secondary">
            <span className="font-medium text-fg">Share my readiness with my college's placement cell.</span>{' '}
            If you link a college, its verified placement staff can see your readiness score, resume score, verified projects and activity — so they can support you before placement season. You can turn this off later in Settings; unlinking your college also removes access.
          </span>
        </label>

        {err && <p className="text-[12px] text-amber-glow">{err}</p>}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[11px] text-fg-muted">Consent version {consentVersion}. Full policy: <a href="#/legal/privacy" className="text-fg-secondary underline underline-offset-2 hover:text-fg">Privacy</a> · <a href="#/legal/terms" className="text-fg-secondary underline underline-offset-2 hover:text-fg">Terms</a></p>
          <Button onClick={accept} disabled={busy}>
            {busy ? <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Saving…</span> : 'I agree — continue'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
