/** @type {import('tailwindcss').Config} */
export default {
  content: ['./web/index.html', './web/src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // "Solar Flight Deck" type system — distinctive Fontshare faces.
        display: ['"Cabinet Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"General Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Warm near-black charcoals (token names kept for drop-in compatibility).
        ink: {
          950: '#08080A',
          900: '#0C0C0F',
          850: '#111114',
          800: '#17171C',
          700: '#212128',
          600: '#2D2D36',
        },
        // Brand/signal ramp (names kept; values are the new solar palette).
        aurora: {
          violet: '#FFB23E', // PRIMARY — cockpit solar amber
          indigo: '#FF7A2F', // deep ember
          cyan: '#37D6C4',   // cool accent / verified-info teal
          mint: '#46E6A6',   // success / "go" green-teal
        },
        amber: { glow: '#FFC85A' },
        muted: '#968F84',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,178,62,0.20), 0 22px 60px -18px rgba(255,122,47,0.45)',
        card: '0 1px 0 0 rgba(255,255,255,0.05) inset, 0 30px 70px -34px rgba(0,0,0,0.9)',
        lift: '0 40px 90px -34px rgba(0,0,0,0.95)',
      },
      backgroundImage: {
        'aurora-text': 'linear-gradient(100deg,#FFE2A8 0%,#FFB23E 38%,#FF7A2F 72%,#FFC85A 100%)',
        'aurora-cta': 'linear-gradient(100deg,#FFC85A 0%,#FFB23E 46%,#FF7A2F 100%)',
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
        scan: 'scan 7s linear infinite',
        sweep: 'sweep 14s linear infinite',
        ticker: 'ticker 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
