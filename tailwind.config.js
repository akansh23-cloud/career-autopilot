/** @type {import('tailwindcss').Config} */
export default {
  content: ['./web/index.html', './web/src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Clash Display"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Satoshi', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: {
          950: '#070912',
          900: '#0B0F1C',
          850: '#0F1322',
          800: '#141A2C',
          700: '#1B2236',
          600: '#252E47',
        },
        aurora: {
          violet: '#7C6CFF',
          indigo: '#5B6BFF',
          cyan: '#3DD6F5',
          mint: '#52E6C2',
        },
        amber: { glow: '#FFB454' },
        muted: '#8A92A8',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(124,108,255,0.18), 0 18px 50px -12px rgba(124,108,255,0.35)',
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 24px 60px -28px rgba(0,0,0,0.85)',
        lift: '0 30px 70px -30px rgba(0,0,0,0.9)',
      },
      backgroundImage: {
        'aurora-text': 'linear-gradient(110deg,#A9B6FF 0%,#7C6CFF 35%,#3DD6F5 70%,#52E6C2 100%)',
        'aurora-cta': 'linear-gradient(110deg,#7C6CFF 0%,#5B6BFF 45%,#3DD6F5 100%)',
      },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-14px)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        float: 'float 7s ease-in-out infinite',
        shimmer: 'shimmer 1.6s infinite',
        'spin-slow': 'spin-slow 22s linear infinite',
      },
    },
  },
  plugins: [],
};
