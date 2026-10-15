"use client";

import { SiteBackdrop } from "@impulza/blocks-renderer";
import type { ResolvedSiteBackground, ThemeTokens } from "@impulza/validation";

export type Device = "phone" | "desktop";

/**
 * Estilo de un botón de la página según el `buttonStyle` del tema, con los mismos pares de color que `stackSurfaceClass` del sitio
 * público: el contorno usa el color de enlace **de la página** (cambia con el fondo) y la superficie usa la paleta **del tema**
 * (`--site-theme-*`, que el fondo no toca), así un tema claro sobre un fondo oscuro no deja texto claro sobre una tarjeta clara.
 * Fuera de `SiteBackdrop` (muestras sueltas) cae a las variables de siempre.
 */
export function previewButtonStyle(buttonStyle: ThemeTokens["buttonStyle"]): React.CSSProperties {
  switch (buttonStyle) {
    case "outline":
      return { border: "2px solid var(--site-color-link, var(--site-color-primary))", color: "var(--site-color-link, var(--site-color-primary))" };
    case "mono":
      return {
        border: "1px solid var(--site-theme-border, var(--site-color-border))",
        background: "var(--site-color-surface)",
        color: "var(--site-theme-foreground, var(--site-color-foreground))",
      };
    case "glass":
      return {
        border: "1px solid color-mix(in srgb, var(--site-color-foreground) 24%, transparent)",
        background: "color-mix(in srgb, var(--site-color-foreground) 12%, transparent)",
        color: "var(--site-color-foreground)",
      };
    default:
      return { background: "var(--site-color-primary)", color: "var(--site-color-primary-foreground)", border: "1px solid transparent" };
  }
}

/** Marco de teléfono (o de navegador) con la página tal como se vería: tema + fondo elegidos, en vivo. */
export function PagePreview({
  theme,
  background,
  device,
}: {
  theme: ThemeTokens;
  background: ResolvedSiteBackground | null;
  device: Device;
}): React.JSX.Element {
  const button = previewButtonStyle(theme.buttonStyle);
  const screen = (
    <SiteBackdrop theme={theme} background={background} fixed={false} showModeToggle={false} className="h-full w-full">
      <div className="mx-auto flex h-full w-full max-w-xs flex-col items-center justify-center gap-3 px-5 py-6 text-center" style={{ fontFamily: "var(--site-font-family)" }}>
        <span
          className="flex size-16 items-center justify-center rounded-full border-4 text-xl font-semibold"
          // Como el monograma real (PP8): el par primario del tema, verificado AA, sobre cualquier fondo.
          style={{ background: "var(--site-color-primary)", color: "var(--site-color-primary-foreground)", borderColor: "var(--site-color-background)", fontFamily: "var(--site-font-heading)" }}
        >
          T
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-base font-semibold text-[var(--site-color-foreground)]" style={{ fontFamily: "var(--site-font-heading)" }}>
            Tu nombre
          </span>
          <span className="text-xs text-[var(--site-color-muted-foreground)]">Una frase que cuenta lo que haces.</span>
        </span>
        <div className="flex w-full flex-col gap-2">
          {["Escríbeme por WhatsApp", "Reserva una hora", "Mira mi trabajo"].map((label, index) => (
            <span
              key={label}
              className="flex h-10 w-full items-center justify-center px-3 text-sm font-medium"
              style={{ ...(index === 0 ? button : previewButtonStyle(theme.buttonStyle === "solid" ? "mono" : theme.buttonStyle)), borderRadius: "var(--site-radius)", boxShadow: "var(--site-shadow)" }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </SiteBackdrop>
  );

  if (device === "phone") {
    return (
      <div role="img" aria-label="Vista previa de la apariencia" data-device="phone" className="mx-auto w-[16.5rem] max-w-full rounded-[2.25rem] border-[9px] border-[#0f172a] bg-[#0f172a] shadow-xl">
        <div className="relative h-[28rem] overflow-hidden rounded-[1.6rem]">
          <div aria-hidden="true" className="absolute left-1/2 top-1.5 z-10 h-4 w-16 -translate-x-1/2 rounded-full bg-[#0f172a]" />
          {screen}
        </div>
      </div>
    );
  }
  return (
    <div role="img" aria-label="Vista previa de la apariencia" data-device="desktop" className="w-full overflow-hidden rounded-xl border border-[#0f172a] bg-[#0f172a] shadow-xl">
      <div aria-hidden="true" className="flex items-center gap-1.5 px-3 py-2">
        <span className="size-2.5 rounded-full bg-[#ef4444]" />
        <span className="size-2.5 rounded-full bg-[#f59e0b]" />
        <span className="size-2.5 rounded-full bg-[#22c55e]" />
      </div>
      <div className="h-[22rem] overflow-hidden">{screen}</div>
    </div>
  );
}
