import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Auth } from '../lib/api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [providers, setProviders] = useState({ google: { enabled: false }, dev: { enabled: false } });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await Auth.me();
      setUser(me.authenticated ? me.user : null);
      if (me.providers) setProviders(me.providers);
    } catch {
      setUser(null);
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
    <AuthCtx.Provider value={{ user, providers, loading, refresh, logout, devLogin }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
