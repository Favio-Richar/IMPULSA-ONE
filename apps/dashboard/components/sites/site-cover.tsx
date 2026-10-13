import { themeTokensSchema, themeTokensToCssVariables } from "@impulza/validation";
import type { CSSProperties } from "react";

/**
 * Portada estilizada de un sitio para su tarjeta: no es una captura real, es una representación con la paleta, la tipografía y el
 * radio del tema del sitio (las mismas variables `--site-*` que usa la página pública). Decorativa: el nombre y la dirección del
 * sitio van en texto aparte, así que va oculta a lectores de pantalla.
 */
export function SiteCover({ tokens, name }: { tokens: unknown; name: string }): React.JSX.Element {
  const parsed = themeTokensSchema.safeParse(tokens);
  const variables = parsed.success ? (themeTokensToCssVariables(parsed.data) as unknown as CSSProperties) : undefined;
  const initial = name.trim().charAt(0).toUpperCase() || "·";

  return (
    <div
      aria-hidden="true"
      data-testid="site-cover"
      style={{
        ...variables,
        background: parsed.success ? "var(--site-color-background)" : undefined,
        fontFamily: "var(--site-font-family)",
      }}
      className="relative flex h-40 flex-col items-center overflow-hidden bg-surface"
    >
      {/* Banda de color de marca, como la portada de un perfil. */}
      <div
        className="h-16 w-full"
        style={{
          background: parsed.success
            ? "linear-gradient(135deg, var(--site-color-primary), color-mix(in srgb, var(--site-color-primary) 55%, var(--site-color-background)))"
            : "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
        }}
      />
      <div
        className="-mt-7 flex size-14 items-center justify-center rounded-full border-4 text-lg font-semibold"
        style={{
          background: parsed.success ? "var(--site-color-surface)" : undefined,
          color: parsed.success ? "var(--site-color-foreground)" : undefined,
          borderColor: parsed.success ? "var(--site-color-background)" : undefined,
          boxShadow: parsed.success ? "var(--site-shadow)" : undefined,
          fontFamily: "var(--site-font-heading)",
        }}
      >
        {initial}
      </div>
      <p className="mt-1.5 max-w-[80%] truncate text-sm font-semibold" style={{ color: parsed.success ? "var(--site-color-foreground)" : undefined, fontFamily: "var(--site-font-heading)" }}>
        {name}
      </p>
      {/* Pila de botones en miniatura. */}
      <div className="mt-2 flex w-3/5 flex-col gap-1">
        <span
          className="h-2.5 w-full"
          style={{ background: parsed.success ? "var(--site-color-primary)" : "var(--color-primary)", borderRadius: parsed.success ? "var(--site-radius)" : "0.375rem" }}
        />
        <span
          className="h-2.5 w-full border"
          style={{
            background: parsed.success ? "var(--site-color-surface)" : undefined,
            borderColor: parsed.success ? "var(--site-color-border)" : undefined,
            borderRadius: parsed.success ? "var(--site-radius)" : "0.375rem",
          }}
        />
      </div>
    </div>
  );
}
