import { z } from "zod";
import { AA_NORMAL_TEXT, contrastRatio } from "../contrast.js";
import { hexColorSchema } from "./common.js";
import { assetUrlSchema, emptyToNull, linkEmailSchema } from "./brand-profile.js";

/**
 * Marca blanca de una agencia (F9.7a, ADR-028 §4). La agencia pone su nombre, logos, colores, contacto y pie para lo que ve el equipo de los
 * clientes que la tienen activada. Mismas reglas que la marca de una organización: colores con contraste AA, logos solo subidos por la
 * propia agencia (lo comprueba el servidor), y además un nombre que no pueda hacerse pasar por otro.
 */

export const WHITE_LABEL_FOOTER_MAX = 200;

export const updateWhiteLabelSchema = z
  .object({
    displayName: z.preprocess(
      emptyToNull,
      z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres.").max(100).nullable().optional(),
    ),
    logoLightUrl: assetUrlSchema,
    logoDarkUrl: assetUrlSchema,
    faviconUrl: assetUrlSchema,
    primaryColor: z.preprocess(emptyToNull, hexColorSchema.nullable().optional()),
    secondaryColor: z.preprocess(emptyToNull, hexColorSchema.nullable().optional()),
    supportEmail: linkEmailSchema,
    footerText: z.preprocess(
      emptyToNull,
      z.string().trim().max(WHITE_LABEL_FOOTER_MAX, `Máximo ${WHITE_LABEL_FOOTER_MAX} caracteres.`).nullable().optional(),
    ),
  })
  .superRefine((data, ctx) => {
    for (const field of ["primaryColor", "secondaryColor"] as const) {
      const value = data[field];
      if (value == null) continue;
      const ratio = contrastRatio(value, "#ffffff");
      if (ratio < AA_NORMAL_TEXT) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `Contraste insuficiente (${ratio.toFixed(2)}:1). WCAG 2.2 AA exige al menos ${AA_NORMAL_TEXT}:1 sobre fondo claro (#ffffff).`,
        });
      }
    }
  });
export type UpdateWhiteLabelDto = z.infer<typeof updateWhiteLabelSchema>;

/** Activar o desactivar la marca blanca de la agencia para UN cliente. */
export const setClientWhiteLabelSchema = z.object({ enabled: z.boolean() });
export type SetClientWhiteLabelDto = z.infer<typeof setClientWhiteLabelSchema>;

/**
 * Clave para comparar nombres de marca: sin tildes, sin mayúsculas, sin espacios ni signos. «Café  Aroma!» y «cafe aroma» son el mismo nombre.
 * El servidor la usa para rechazar un nombre de marca blanca que ya es de la plataforma o de otra organización (suplantación).
 */
export function brandNameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Lo que se muestra del pie: el que la agencia escribió, o nada (nunca el de la plataforma). */
export function whiteLabelFooter(footerText: string | null | undefined): string | null {
  const text = footerText?.trim();
  return text ? text.slice(0, WHITE_LABEL_FOOTER_MAX) : null;
}
