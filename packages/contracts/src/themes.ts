import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

export const themeResponse = z.object({
  id: uuid,
  name: z.string(),
  /** Identificador estable del catálogo global (`claro-profesional`, …). `null` en un tema propio. */
  code: z.string().nullable(),
  source: z.enum(["catalog", "organization"]),
  /**
   * Línea del catálogo (PP4): `oscuro` (PL2, fondo oscuro de app de enlace en bio), `ejecutivo`
   * (sobrio, serif en títulos), `vibrante` (juvenil, más color) o `clasico` (los primeros temas).
   * `null` en un tema propio de la organización.
   */
  family: z.enum(["oscuro", "ejecutivo", "vibrante", "clasico"]).nullable(),
  /** Los temas del catálogo se ven y se aplican, pero solo se editan duplicándolos. */
  editable: z.boolean(),
  /**
   * Paleta, tipografía, radio, densidad, sombra y estilo de botón. La forma exacta la define
   * `themeTokensSchema` en `@impulza/validation`, que además verifica contraste WCAG 2.2 AA al
   * guardar — no se duplica acá por la misma razón que la configuración de un bloque.
   */
  tokens: z.unknown(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

/**
 * Tema efectivo de un sitio. Nunca es "sin tema": si el sitio no eligió ninguno, `isDefault` es
 * `true` y se devuelve el del catálogo por defecto.
 */
export const siteThemeResponse = themeResponse.extend({
  isDefault: z.boolean(),
});

export type ThemeResponse = z.infer<typeof themeResponse>;
export type SiteThemeResponse = z.infer<typeof siteThemeResponse>;

/**
 * Fondo de la página de un sitio (PP3). `background` es lo guardado (`siteBackgroundSchema`) y
 * `resolved`, lo que pinta el render (`resolvedSiteBackgroundSchema`), ambos en
 * `@impulza/validation` — mismo criterio que `tokens`. `null` en los dos = el fondo del tema.
 */
export const siteBackgroundResponse = z.object({
  background: z.unknown().nullable(),
  resolved: z.unknown().nullable(),
  /** Videos curados disponibles para elegir (vacío mientras la biblioteca esté en revisión). */
  videos: z.array(z.object({ code: z.string(), name: z.string(), posterUrl: z.string() })),
});

export type SiteBackgroundResponse = z.infer<typeof siteBackgroundResponse>;
