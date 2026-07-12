import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Auth } from '../lib/api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [providers, setProviders] = useState({ google: { enabled: false }, dev: { enabled: false } });
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false); // true when /auth/me itself is unreachable (500/503/network)
  const [consentRequired, setConsentRequired] = useState(false); // DPDP: current consent version not yet accepted
  const [consentVersion, setConsentVersion] = useState('');

  const refresh = useCallback(async () => {
    try {
      const me = await Auth.me();
      setUser(me.authenticated ? me.user : null);
      setConsentRequired(!!me.authenticated && !!me.consentRequired);
      setConsentVersion(me.consentVersion || '');
      if (me.providers) setProviders(me.providers);
      setAuthError(false);
    } catch (e) {
      // Distinguish "no user / not configured" (handled above) from the auth
      // server actually being down, so the UI can show the correct message.
      setUser(null);
      setAuthError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // After Google redirect (?login=success) clean the URL and re-check session.
    const p = new URLSearchParams(window.location.search);
    if (p.get('login')) {
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(refresh, 200);
    }
  }, [refresh]);

  const logout = useCallback(async () => {
    await Auth.logout().catch(() => {});
    setUser(null);
  }, []);

  const devLogin = useCallback(async (name, email) => {
    const r = await Auth.devLogin(name, email);
    if (r?.user) setUser(r.user);
    return r;
  }, []);

  return (
    <AuthCtx.Provider value={{ user, providers, loading, authError, consentRequired, consentVersion, refresh, logout, devLogin }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
