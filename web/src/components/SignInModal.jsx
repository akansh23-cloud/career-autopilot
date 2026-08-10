import { useState } from 'react';
import { Modal, Button, Input, Field, Spinner } from './ui/kit.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { Auth } from '../lib/api.js';
import { Sparkles, ShieldCheck } from 'lucide-react';

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-23.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C39.9 41 44 33.9 44 24c0-1.2-.1-2.3-.4-3.5z"/>
    </svg>
  );
}

export default function SignInModal({ open, onClose }) {
  const { providers, devLogin, authError } = useAuth();
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState({ name: '', email: '' });
  const [showDemo, setShowDemo] = useState(false);

  const google = () => { setBusy(true); window.location.href = Auth.googleStart(window.location.pathname); };
  const runDemo = async () => {
    setBusy(true);
    try { await devLogin(demo.name || 'Demo User', demo.email || 'demo@careerautopilot.local'); onClose?.(); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} width="max-w-md">
      <div className="text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full btn-primary ring-1 ring-strong">
          <Sparkles size={26} className="relative z-[2] text-ink-950" />
        </div>
        <h3 className="font-display text-2xl font-semibold text-fg">Welcome to Career Autopilot</h3>
        <p className="mt-1.5 text-sm text-muted">Sign in to launch your AI career workspace.</p>
      </div>

      <div className="mt-6 space-y-3">
        <button
          onClick={google}
          disabled={busy || (!authError && !providers?.google?.enabled)}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-subtle bg-white text-[15px] font-medium text-slate-800 transition hover:brightness-95 disabled:opacity-50"
        >
          {busy ? <Spinner className="border-slate-400 border-t-slate-700" /> : <GoogleMark />}
          Continue with Google
        </button>
        {authError ? (
          <p className="text-center text-xs text-warn/90">
            Auth server is unavailable. Check MongoDB/session configuration (see <code className="font-mono">/health/db</code>).
          </p>
        ) : !providers?.google?.enabled && (
          <p className="text-center text-xs text-warn/90">
            Google OAuth isn’t configured on this server yet — add the keys in <code className="font-mono">.env</code>.
          </p>
        )}

        {providers?.dev?.enabled && (
          <>
            <div className="flex items-center gap-3 py-1 text-xs text-fg-muted">
              <span className="h-px flex-1 bg-surface-2" /> or <span className="h-px flex-1 bg-surface-2" />
            </div>
            {!showDemo ? (
              <Button variant="soft" className="w-full" onClick={() => setShowDemo(true)}>
                Use demo sign-in
              </Button>
            ) : (
              <div className="space-y-3">
                <Field label="Name"><Input value={demo.name} onChange={(e) => setDemo({ ...demo, name: e.target.value })} placeholder="Lavesh" /></Field>
                <Field label="Email"><Input value={demo.email} onChange={(e) => setDemo({ ...demo, email: e.target.value })} placeholder="you@example.com" /></Field>
                <Button className="w-full" onClick={runDemo} disabled={busy}>{busy ? <Spinner /> : 'Enter workspace'}</Button>
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-fg-muted">
        <ShieldCheck size={13} /> Secured by Google OAuth · session cookies · no passwords stored
      </p>
    </Modal>
  );
}
