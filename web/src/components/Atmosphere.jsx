import { useEffect } from 'react';
import { motion } from 'framer-motion';

// SOLAR FLIGHT DECK atmosphere (v2): warm ink base, a cursor-reactive aurora,
// drifting ember/solar mesh blobs, a fine technical grid + dot field, radar
// sweep + scan line, grain and a vignette. Pointer-events none, fixed, behind
// content, GPU-friendly (transform/opacity + CSS-var driven gradients).
export default function Atmosphere({ variant = 'landing' }) {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return undefined;
    const root = document.documentElement;
    let raf = 0;
    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const x = (e.clientX / window.innerWidth) * 100;
        const y = (e.clientY / window.innerHeight) * 100;
        root.style.setProperty('--cursor-x', `${x}%`);
        root.style.setProperty('--cursor-y', `${y}%`);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); if (raf) cancelAnimationFrame(raf); };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-ink-950" />

      {/* cursor-reactive aurora */}
      <div className="absolute inset-0 aurora-field" />

      {/* drifting mesh blobs */}
      <motion.div
        className="glow-blob absolute -left-44 -top-48 h-[560px] w-[560px] bg-aurora-violet/30"
        animate={{ x: [0, 64, 0], y: [0, 44, 0], scale: [1, 1.08, 1] }}
        transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="glow-blob absolute right-[-14%] top-[-10%] h-[500px] w-[500px] bg-aurora-indigo/28"
        animate={{ x: [0, -56, 0], y: [0, 56, 0], scale: [1, 1.12, 1] }}
        transition={{ duration: 23, repeat: Infinity, ease: 'easeInOut' }}
      />
      {variant === 'landing' && (
        <motion.div
          className="glow-blob absolute bottom-[-20%] left-1/3 h-[520px] w-[520px] bg-aurora-cyan/12"
          animate={{ x: [0, 48, 0], y: [0, -36, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: 27, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* technical grid + dot field */}
      <div className="absolute inset-0 bg-grid opacity-90" />
      {variant === 'landing' && (
        <div className="dotgrid absolute inset-x-0 top-0 h-[60vh] opacity-[0.5]" style={{ WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 50% 0%, #000, transparent 70%)', maskImage: 'radial-gradient(ellipse 70% 70% at 50% 0%, #000, transparent 70%)' }} />
      )}

      {/* radar sweep — marketing only, keeps the app calm */}
      {variant === 'landing' && (
        <div className="absolute left-1/2 top-[-32%] h-[1150px] w-[1150px] -translate-x-1/2 opacity-[0.5]">
          <motion.div
            className="h-full w-full animate-sweep"
            style={{
              background:
                'conic-gradient(from 0deg, rgba(255,178,62,0.18) 0deg, rgba(255,178,62,0.05) 26deg, transparent 58deg, transparent 360deg)',
              borderRadius: '999px',
              maskImage: 'radial-gradient(circle at center, #000 0%, transparent 60%)',
              WebkitMaskImage: 'radial-gradient(circle at center, #000 0%, transparent 60%)',
            }}
          />
        </div>
      )}

      {/* drifting scan line */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="scanline animate-scan h-[42%]" />
      </div>

      <div className="noise absolute inset-0" />
      <div className="vignette absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-ink-950/25 to-ink-950" />
    </div>
  );
}
