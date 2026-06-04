import { motion } from 'framer-motion';

// Layered atmosphere: drifting aurora blobs + grid + grain. Pointer-events none,
// fixed behind content, GPU-friendly (transform/opacity only) so scrolling stays smooth.
export default function Atmosphere({ variant = 'landing' }) {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-ink-950" />
      <motion.div
        className="glow-blob absolute -left-40 -top-40 h-[520px] w-[520px] bg-aurora-violet/40"
        animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="glow-blob absolute right-[-10%] top-[-5%] h-[460px] w-[460px] bg-aurora-cyan/30"
        animate={{ x: [0, -50, 0], y: [0, 50, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      {variant === 'landing' && (
        <motion.div
          className="glow-blob absolute bottom-[-15%] left-1/3 h-[480px] w-[480px] bg-aurora-mint/20"
          animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
          transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <div className="absolute inset-0 bg-grid opacity-70" />
      <div className="noise absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-ink-950/30 to-ink-950" />
    </div>
  );
}
