/** @type {import('tailwindcss').Config} */
export default {
  content: ['./web/index.html', './web/src/**/*.{js,jsx}'],
  theme: {
    /* ------------------------------------------------------------------
       RADIUS SCALE — overridden globally (not extended) so the whole
       product shares one restrained radius rhythm. Existing markup that
       says `rounded-2xl` now resolves to 12px instead of 16px, `rounded-xl`
       to 10px, etc. One decision, applied everywhere at once.
       ------------------------------------------------------------------ */
    borderRadius: {
      none: '0px',
      sm: '4px',
      DEFAULT: '6px',
      md: '6px',
      lg: '8px',
      xl: '10px',
      '2xl': '12px',
      '3xl': '14px',
      full: '9999px',
    },
    extend: {
      fontFamily: {
        /* One professional sans throughout. `font-display` is kept as a
           NAME for drop-in compatibility across 30+ views, but it now
           resolves to the same Inter stack — headings differentiate by
           size/weight/tracking, not by a second (serif) family. */
        display: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        /* THEME TOKENS — read the CSS custom properties in index.css. */
        fg: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          inverse: 'var(--text-inverse)',
        },
        base: 'var(--bg-base)',
        elevated: 'var(--bg-elevated)',
        sunken: 'var(--bg-sunken)',
        surface: {
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          hover: 'var(--surface-hover)',
        },
        subtle: 'var(--border-subtle)',
        strong: 'var(--border-strong)',

        /* FORM CONTROLS — opaque by contract (menus/popovers must never
           show what is behind them). */
        field: {
          DEFAULT: 'var(--field-bg)',
          subtle: 'var(--field-bg-subtle)',
          hover: 'var(--field-bg-hover)',
          border: 'var(--field-border)',
        },
        menu: 'var(--menu-bg)',
        scrim: 'var(--scrim)',

        /* Semantic signal inks. */
        ok: 'var(--ok)',
        info: 'var(--info)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
        brand: 'var(--brand-text)',

        /* ------------------------------------------------------------------
           LEGACY ACCENT NAMES → PROFESSIONAL PALETTE
           ~60 files reference `aurora-*` / `amber-glow` (usually as /10–/40
           washes for chips, rings and tints). The NAMES are kept so nothing
           breaks; the VALUES are now the product palette:
             aurora-violet — primary indigo (brand)
             aurora-indigo — primary hover/deep
             aurora-cyan   — informational blue
             aurora-mint   — success green
             amber-glow    — warning amber
           ------------------------------------------------------------------ */
        aurora: {
          violet: '#4F46E5',
          indigo: '#4338CA',
          cyan: '#0284C7',
          mint: '#059669',
        },
        amber: { glow: '#D97706' },
        muted: '#64748B',

        /* Legacy "ink" ramp. 950 was only ever used as ON-ACCENT text over
           the old pale foil gradient; accents are now solid indigo, so
           on-accent ink is white. Names kept for drop-in compatibility. */
        ink: {
          950: '#FFFFFF',
          900: '#0F172A',
          850: '#1E293B',
          800: '#1E293B',
          700: '#334155',
          600: '#475569',
        },
      },
      boxShadow: {
        /* `glow` used to be a violet halo; it now reads as one quiet
           elevation step so the 10 legacy call-sites stay subtle. */
        glow: 'var(--shadow-lift)',
        card: 'var(--shadow-card)',
        lift: 'var(--shadow-lift)',
      },
      backgroundImage: {
        /* Old holographic gradients — now flat brand fills, which converts
           every `bg-aurora-cta` progress bar / chip / avatar to the solid
           primary without touching the call-sites. */
        'aurora-text': 'linear-gradient(0deg,#4F46E5,#4F46E5)',
        'aurora-cta': 'linear-gradient(0deg,#4F46E5,#4F46E5)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        /* Legacy names kept as no-ops so stray `animate-*` classes are inert. */
        float: { '0%,100%': { transform: 'none' }, '50%': { transform: 'none' } },
        scan: { '0%,100%': { opacity: '0' } },
        sweep: { to: { transform: 'none' } },
        ticker: { '0%,100%': { opacity: '1' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        'spin-slow': 'spin-slow 22s linear infinite',
        float: 'none',
        scan: 'none',
        sweep: 'none',
        ticker: 'none',
      },
    },
  },
  plugins: [],
};
