/** @type {import('tailwindcss').Config} */
export default {
  content: ['./web/index.html', './web/src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // "PROVENANCE" type system — certificate-grade serif display,
        // Swiss-precision body, mono for serials & telemetry.
        display: ['"Zodiak"', 'Georgia', 'ui-serif', 'serif'],
        sans: ['"Switzer"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        /* THEME TOKENS. These read the CSS custom properties in index.css, so
           `text-fg` / `bg-elevated` / `border-subtle` resolve differently in
           light and dark without any conditional class logic in components.
           The codemod (scripts/theme-codemod.mjs) rewrites the old hardcoded
           `text-white` / `bg-white/5` / `border-white/10` usages to these. */
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

        /* FORM CONTROLS — opaque by contract.
           `surface-1`/`surface-2` are translucent tints, which is correct for
           panels stacked on the page but wrong for anything that opens over
           other content (selects, popovers, menus, command palette). Those use
           these instead so they never show what is behind them. */
        field: {
          DEFAULT: 'var(--field-bg)',
          subtle: 'var(--field-bg-subtle)',
          hover: 'var(--field-bg-hover)',
          border: 'var(--field-border)',
        },
        menu: 'var(--menu-bg)',

        /* Modal / overlay scrim. Was a fixed bg-black/72 everywhere, which is
           correct behind a dark plate and a heavy blackout over paper. */
        scrim: 'var(--scrim)',

        /* Semantic signal inks. These already existed as CSS vars but nothing
           could reach them from a class, so views fell back to fixed
           rose-300 / mint-ish literals that lose contrast on white. */
        ok: 'var(--ok)',
        info: 'var(--info)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
        brand: 'var(--brand-text)',

        // Archival green-cast inks (token names kept for drop-in compatibility).
        ink: {
          950: '#070908',
          900: '#0B0E0C',
          850: '#101413',
          800: '#161B19',
          700: '#212824',
          600: '#2C3530',
        },
        // Brand/signal ramp (names kept; values are the new foil palette).
        aurora: {
          violet: '#BCA8FF', // PRIMARY — holographic foil lilac
          indigo: '#7C6BF2', // deep violet, secondary
          cyan: '#6EE0F2',   // ice — informational
          mint: '#57E6A8',   // jade — verified / success
        },
        amber: { glow: '#EAC97C' }, // champagne gold foil — premium/warn, sparing
        muted: '#8A958D',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(188,168,255,0.22), 0 22px 60px -18px rgba(124,107,242,0.45)',
        /* Were pinned to rgba(0,0,0,.9)/.95 — a bruise under every card on
           paper. Both now read theme tokens (index.css), so light gets a soft
           archival drop and dark keeps the deep plate shadow. */
        card: 'var(--shadow-card)',
        lift: 'var(--shadow-lift)',
      },
      backgroundImage: {
        'aurora-text': 'linear-gradient(105deg,#A9F0CE 0%,#8FE3F7 32%,#C9B8FF 62%,#F2B5DF 100%)',
        'aurora-cta': 'linear-gradient(105deg,#8DE8C0 0%,#7DDCF5 30%,#BCA8FF 62%,#F0A6D8 100%)',
      },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-14px)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        scan: { '0%': { transform: 'translateY(-100%)' }, '100%': { transform: 'translateY(100%)' } },
        sweep: { to: { transform: 'rotate(360deg)' } },
        ticker: { '0%,100%': { opacity: '0.25' }, '50%': { opacity: '1' } },
      },
      animation: {
        float: 'float 7s ease-in-out infinite',
        shimmer: 'shimmer 1.6s infinite',
        'spin-slow': 'spin-slow 22s linear infinite',
        scan: 'scan 9s linear infinite',
        sweep: 'sweep 16s linear infinite',
        ticker: 'ticker 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
