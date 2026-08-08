import { useEffect } from 'react';
import { motion } from 'framer-motion';

// PROVENANCE atmosphere (v3): archival ink base, a cursor-reactive foil
// light-table, drifting lilac/jade facet blobs, engraved guilloché
// rosettes (banknote-style concentric line-work), a fine technical grid,
// a slow press-roller light pass, grain and a vignette. Pointer-events
// none, fixed, behind content, GPU-friendly (transform/opacity + CSS vars).
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
    /* `atmosphere-layer` is the hook index.css already had a rule for
       (the additive foil effects are dimmed on paper) — the class was never
       actually applied to anything, so that rule was dead. It is applied now. */
    <div className="atmosphere-layer pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {/* Was bg-ink-950 — a near-black plate painted behind the ENTIRE app,
          under every token-driven surface. No amount of light tokens could
          survive it. It reads --bg-base now, like everything else. */}
      <div className="absolute inset-0 bg-base" />

      {/* cursor-reactive foil light-table */}
      <div className="absolute inset-0 aurora-field" />

      {/* drifting foil-facet blobs */}
      <motion.div
        className="glow-blob absolute -left-44 -top-48 h-[560px] w-[560px] bg-aurora-violet/22"
        animate={{ x: [0, 64, 0], y: [0, 44, 0], scale: [1, 1.08, 1] }}
        transition={{ duration: 21, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="glow-blob absolute right-[-14%] top-[-10%] h-[500px] w-[500px] bg-aurora-indigo/20"
        animate={{ x: [0, -56, 0], y: [0, 56, 0], scale: [1, 1.12, 1] }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
      />
      {variant === 'landing' && (
        <motion.div
          className="glow-blob absolute bottom-[-20%] left-1/3 h-[520px] w-[520px] bg-aurora-mint/10"
          animate={{ x: [0, 48, 0], y: [0, -36, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: 29, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* engraved guilloché rosettes — the security line-work signature */}
      <motion.div
        className="guilloche absolute left-1/2 top-[-38%] h-[1200px] w-[1200px] -translate-x-1/2 opacity-70"
        animate={{ rotate: 360 }}
        transition={{ duration: 240, repeat: Infinity, ease: 'linear' }}
        style={{ transformOrigin: '50% 50%' }}
      />
      {variant === 'landing' && (
        <motion.div
          className="guilloche absolute bottom-[-34%] right-[-18%] h-[900px] w-[900px] opacity-50"
          animate={{ rotate: -360 }}
          transition={{ duration: 300, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: '50% 50%' }}
        />
      )}

      {/* fine technical grid + dot field */}
      <div className="absolute inset-0 bg-grid opacity-90" />
      {variant === 'landing' && (
        <div className="dotgrid absolute inset-x-0 top-0 h-[60vh] opacity-[0.5]" style={{ WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 50% 0%, #000, transparent 70%)', maskImage: 'radial-gradient(ellipse 70% 70% at 50% 0%, #000, transparent 70%)' }} />
      )}

      {/* slow press-roller light pass — marketing only, keeps the app calm */}
      {variant === 'landing' && (
        <div className="absolute inset-0 overflow-hidden">
          <div className="scanline animate-scan h-[42%]" />
        </div>
      )}

      <div className="noise absolute inset-0" />
      <div className="vignette absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base/25 to-base" />
    </div>
  );
}
