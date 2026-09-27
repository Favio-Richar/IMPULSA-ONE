// Fondo decorativo compartido para las secciones "hero" del sitio comercial (home, /producto,
// /plantillas, /planes): mesh de gradientes + patrón de puntos, inspirado en el lenguaje visual de
// las apps de enlace en bio (Linktree/Beacons) pero con paleta y formas propias de Impulza One —
// nunca se reutiliza en los sitios de los tenants (F2.5).
export function MarketingHeroBackground() {
  return (
    <>
      <div
        aria-hidden="true"
        className="bg-dot-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_65%_65%_at_50%_0%,#000_40%,transparent_100%)]"
      />
      <div
        aria-hidden="true"
        className="animate-marketing-float pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[#c7d2fe] opacity-40 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="animate-marketing-float pointer-events-none absolute -right-16 top-32 h-64 w-64 rounded-full bg-[#ddd6fe] opacity-40 blur-3xl [animation-delay:-3s]"
      />
      <div
        aria-hidden="true"
        className="animate-marketing-float pointer-events-none absolute left-1/3 top-0 h-56 w-56 rounded-full bg-[#fbcfe8] opacity-30 blur-3xl [animation-delay:-5s]"
      />
    </>
  );
}

// Mismo tratamiento pero para secciones oscuras (CTA final de cada página): grid de puntos claros
// + resplandor de color de marca, sobre el fondo #0f172a existente.
export function MarketingCtaBackground() {
  return (
    <>
      <div
        aria-hidden="true"
        className="bg-dot-grid-dark pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_70%_at_50%_50%,#000_40%,transparent_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#4338ca] opacity-30 blur-3xl"
      />
    </>
  );
}
