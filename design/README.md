# Design assets

## landing-preview.html
A standalone, self-contained marketing landing page for Career Autopilot
("Where Talent Meets Opportunity"). Open it directly in any browser — no build
step or dependencies to install (three.js loads from a CDN at runtime).

Highlights:
- Interactive three.js "talent network" sphere in the hero
- Clash Display + Satoshi typography (Fontshare)
- Warm-paper / deep-ink palette with a violet→cyan accent and gold CTA
- Scroll-reveal animations, animated stat counters, bento feature grid
- Fully responsive, respects prefers-reduced-motion, graceful WebGL fallback

NOTE: This is a design preview and is NOT yet wired into the React/Vite app
(the live app still serves web/src/components/landing/Landing.jsx). The stat
figures are illustrative placeholders — replace with real numbers before
publishing. Ask to have this ported into the React app when ready.
