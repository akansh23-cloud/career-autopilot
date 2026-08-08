/* ============================================================
   THEME — light / dark / system
   ------------------------------------------------------------
   Sets `class="light"` (or removes it) on <html> plus the matching
   `color-scheme`, so the CSS custom properties in index.css switch
   the whole surface. Persisted per browser; defaults to `system`
   so a student in a bright classroom gets light automatically.

   Wire in main.jsx BEFORE React renders (prevents a dark flash):
       import { initTheme } from './lib/theme.js';
       initTheme();

   Toggle anywhere:
       import { useTheme } from './lib/theme.js';
       const { theme, setTheme, resolved } = useTheme();
   ============================================================ */
import { useEffect, useState } from 'react';

const KEY = 'careerAutopilot.theme.v1';
export const THEMES = ['system', 'light', 'dark'];
const listeners = new Set();

function media() {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;
}

export function getTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(theme = getTheme()) {
  if (theme === 'light' || theme === 'dark') return theme;
  return media()?.matches ? 'light' : 'dark';
}

function apply(theme) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.classList.toggle('light', resolved === 'light');
  root.style.colorScheme = resolved;
  root.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#F7F8F6' : '#070908');
}

export function setTheme(theme) {
  const next = THEMES.includes(theme) ? theme : 'system';
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  apply(next);
  listeners.forEach((fn) => { try { fn(next); } catch { /* ignore */ } });
}

/** Call once, synchronously, before React mounts. */
export function initTheme() {
  apply(getTheme());
  const mq = media();
  if (mq) {
    const onChange = () => { if (getTheme() === 'system') apply('system'); };
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
  }
}

export function useTheme() {
  const [theme, setLocal] = useState(getTheme);
  useEffect(() => {
    const fn = (t) => setLocal(t);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return {
    theme,
    resolved: resolveTheme(theme),
    setTheme,
    cycle: () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]),
  };
}

export default { THEMES, getTheme, setTheme, initTheme, useTheme, resolveTheme };
