/* ============================================================
   Atmosphere (v4) — retired as a decorative layer.
   The old component painted cursor-reactive foil light, drifting
   gradient blobs, guilloché rosettes, grain and a vignette behind
   every screen. The redesigned product uses clean solid surfaces,
   so this now renders only the base page background. The component
   and its `variant` prop are kept so all call-sites (App, Landing,
   Onboarding, LegalView) keep working unchanged.
   ============================================================ */
export default function Atmosphere() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 bg-base" aria-hidden />
  );
}
