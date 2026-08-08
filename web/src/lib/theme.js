/* ============================================================
   THEME — Career Autopilot ships LIGHT.
   ------------------------------------------------------------
   PRODUCT DECISION (v4.1): light is the product default and the
   only theme the app currently ships. The previous default was
   `system`, which meant a student on a dark-themed Windows/macOS
   install — or any browser reporting `prefers-color-scheme: dark`
   — silently got the dark surface even though nothing in the UI
   ever offered them that choice.

   Two things follow from that, and both are deliberate:

   1. `THEME_PREFERENCE_ENABLED` is false. While it is false,
      getTheme() ALWAYS resolves to 'light' — a stale 'dark' or
      'system' value left in localStorage from an older build is
      ignored (and cleaned up), so upgrading users start light.
   2. The OS media query is not observed. A dark desktop no
      longer flips the app.

   Nothing else changed shape: the same getTheme/setTheme/
   initTheme/useTheme surface is exported, so the day a real theme
   switcher is added to Settings it is a one-line flip of
   THEME_PREFERENCE_ENABLED to true — at which point stored
   preferences are honoured again.

   The CSS side matches this: index.css now defines the LIGHT
   token set on `:root`, with dark scoped to `html.dark`. Even if
   this module never runs (JS error, no-JS first paint) the app
   still paints light. There is no dark flash left to prevent.

   Wire in main.jsx BEFORE React renders:
       import { initTheme } from './lib/theme.js';
       initTheme();
   ============================================================ */
import { useEffect, useState } from 'react';

const KEY = 'careerAutopilot.theme.v1';

/** The product default, and the only theme shipped today. */
export const DEFAULT_THEME = 'light';

/** Flip to true ONLY when a real, reachable theme control exists in the UI. */
export const THEME_PREFERENCE_ENABLED = false;

export const THEMES = ['system', 'light', 'dark'];

const listeners = new Set();

function media() {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;
}

/** Read the stored preference. Returns null when there is none / it is invalid. */
export function getStoredTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * The active theme setting.
 * While no theme control is exposed this is always DEFAULT_THEME, regardless of
 * what an older build persisted — that is the "existing users still start in
 * light" requirement.
 */
export function getTheme() {
  if (!THEME_PREFERENCE_ENABLED) return DEFAULT_THEME;
  return getStoredTheme() || DEFAULT_THEME;
}

/**
 * Collapse a setting to a concrete theme.
 * 'system' only consults the OS while a preference control is exposed; with the
 * control disabled it resolves to the product default like everything else.
 */
export function resolveTheme(theme = getTheme()) {
  if (theme === 'light' || theme === 'dark') return theme;
  if (!THEME_PREFERENCE_ENABLED) return DEFAULT_THEME;
  return media()?.matches ? 'light' : 'dark';
}

function apply(theme) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  /* `dark` is the opt-in class now; `light` is kept in sync so any selector
     still written as `html.light .x` keeps working. */
  root.classList.toggle('dark', resolved === 'dark');
  root.classList.toggle('light', resolved !== 'dark');
  root.style.colorScheme = resolved;
  root.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#070908' : '#F7F8F6');
}

export function setTheme(theme) {
  const next = THEMES.includes(theme) ? theme : DEFAULT_THEME;
  if (!THEME_PREFERENCE_ENABLED) {
    // No control is exposed; refuse to persist a preference the user cannot see
    // or undo. Still apply, so a dev/console call is not silently a no-op.
    apply(DEFAULT_THEME);
    listeners.forEach((fn) => { try { fn(DEFAULT_THEME); } catch { /* ignore */ } });
    return;
  }
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  apply(next);
  listeners.forEach((fn) => { try { fn(next); } catch { /* ignore */ } });
}

/** Call once, synchronously, before React mounts. */
export function initTheme() {
  /* Drop a stale 'dark'/'system' value written by a pre-4.1 build so the
     browser does not carry a preference the product no longer offers. */
  if (!THEME_PREFERENCE_ENABLED) {
    try { if (getStoredTheme()) localStorage.removeItem(KEY); } catch { /* ignore */ }
  }

  apply(getTheme());

  /* Only follow the OS while a real preference control exists AND the user has
     actually chosen 'system'. Otherwise a dark desktop must not touch the app. */
  if (!THEME_PREFERENCE_ENABLED) return;
  const mq = media();
  if (mq) {
    const onChange = () => { if (getTheme() === 'system') apply('system'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
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
    /** True when the UI may offer a theme switcher. */
    canChange: THEME_PREFERENCE_ENABLED,
    setTheme,
    cycle: () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]),
  };
}

export default {
  THEMES, DEFAULT_THEME, THEME_PREFERENCE_ENABLED,
  getTheme, getStoredTheme, setTheme, initTheme, useTheme, resolveTheme,
};
