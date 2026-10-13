import { type HTMLAttributes, useId } from "react";
import { cn } from "../lib/cn.js";

// Marca de fábrica de la plataforma. Es solo el RESPALDO: donde una organización o la plataforma ya configuró su
// propio logo (F9.1/F9.2, marca blanca de agencias) se muestra ese, nunca este. Colores desde los tokens del tema
// (`--color-primary`/`--color-primary-hover`, con el verde de DEFAULT_PLATFORM_BRANDING como respaldo) para que la
// sobreescritura de marca siga funcionando; los PNG de favicon usan los mismos hexadecimales fijos.

export const IMPULZA_LOGO_PRIMARY = "#0f6f6b";
export const IMPULZA_LOGO_SECONDARY = "#0b5450";

export interface ImpulzaLogoProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** `icon`: solo el isotipo (menú plegado, favicon). `full`: isotipo + nombre (menú expandido, acceso). */
  variant?: "icon" | "full";
  /** Texto del nombre en la variante `full`. Por defecto «Impulza One». */
  name?: string;
  /** Alto del isotipo en píxeles. */
  size?: number;
}

/** Isotipo: un cuadrado de esquinas suaves con una «I» coronada por un impulso ascendente. Sin dependencias ni texto rasterizado. */
function Isotype({ size }: { size: number }): React.JSX.Element {
  const gradientId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="shrink-0">
      <defs>
        <linearGradient id={gradientId} x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: `var(--color-primary, ${IMPULZA_LOGO_PRIMARY})` }} />
          <stop offset="1" style={{ stopColor: `var(--color-primary-hover, ${IMPULZA_LOGO_SECONDARY})` }} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gradientId})`} />
      {/* Una «I» coronada por un impulso ascendente. */}
      <path d="M9.5 13.5 L16 7 L22.5 13.5" fill="none" stroke="#ffffff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="13.4" y="17.4" width="5.2" height="8.6" rx="2.6" fill="#ffffff" />
    </svg>
  );
}

export function ImpulzaLogo({ variant = "full", name = "Impulza One", size = 28, className, ...props }: ImpulzaLogoProps): React.JSX.Element {
  if (variant === "icon") {
    return (
      <span className={cn("inline-flex", className)} role="img" aria-label={name} {...props}>
        <Isotype size={size} />
      </span>
    );
  }
  // El nombre por defecto lleva «One» en el color de marca; un nombre propio (marca renombrada) va en un solo tono.
  const parts = name === "Impulza One" ? (["Impulza", "One"] as const) : null;
  return (
    <span className={cn("inline-flex items-center gap-2", className)} {...props}>
      <Isotype size={size} />
      <span className="truncate text-sm font-semibold tracking-tight text-foreground">
        {parts ? (
          <>
            {parts[0]} <span className="text-primary">{parts[1]}</span>
          </>
        ) : (
          name
        )}
      </span>
    </span>
  );
}
