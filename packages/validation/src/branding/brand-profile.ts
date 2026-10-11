import { z } from "zod";
import { AA_NORMAL_TEXT, contrastRatio } from "../contrast.js";
import { hexColorSchema, isSafeAssetUrl } from "./common.js";

export const emptyToNull = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? null : value;

export const assetUrlSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(2048)
    .refine(isSafeAssetUrl, { message: "El enlace debe comenzar con https://." })
    .nullable()
    .optional(),
);

export const linkEmailSchema = z.preprocess(
  emptyToNull,
  z.string().trim().email("Debe ser un correo electrónico válido.").max(254).nullable().optional(),
);

export const brandProfileSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(100).nullable().optional(),
  logoLightUrl: assetUrlSchema,
  logoDarkUrl: assetUrlSchema,
  faviconUrl: assetUrlSchema,
  primaryColor: hexColorSchema.nullable().optional(),
  secondaryColor: hexColorSchema.nullable().optional(),
  contactEmail: linkEmailSchema,
  contactPhone: z.string().trim().max(30).nullable().optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  taxId: z.string().trim().max(50).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type BrandProfileDto = z.infer<typeof brandProfileSchema>;

export const updateBrandProfileSchema = z
  .object({
    displayName: z.preprocess(
      emptyToNull,
      z.string().trim().min(1, "El nombre visible es obligatorio si se especifica.").max(100).nullable().optional(),
    ),
    logoLightUrl: assetUrlSchema,
    logoDarkUrl: assetUrlSchema,
    faviconUrl: assetUrlSchema,
    primaryColor: z.preprocess(
      emptyToNull,
      hexColorSchema.nullable().optional(),
    ),
    secondaryColor: z.preprocess(
      emptyToNull,
      hexColorSchema.nullable().optional(),
    ),
    contactEmail: linkEmailSchema,
    contactPhone: z.preprocess(
      emptyToNull,
      z.string().trim().max(30).nullable().optional(),
    ),
    legalName: z.preprocess(
      emptyToNull,
      z.string().trim().max(200).nullable().optional(),
    ),
    taxId: z.preprocess(
      emptyToNull,
      z.string().trim().max(50).nullable().optional(),
    ),
  })
  .superRefine((data, ctx) => {
    // WCAG 2.2 AA: contraste >= 4.5:1 sobre fondo blanco, solo si se especifica el color
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

export type UpdateBrandProfileDto = z.infer<typeof updateBrandProfileSchema>;

/**
 * Resultado de resolveBrand: la marca efectiva de una organización con la cascada aplicada
 * (ADR-028 §4). Los valores son siempre non-null (el respaldo es la marca de la plataforma).
 */
export const resolvedBrandSchema = z.object({
  displayName: z.string(),
  logoLightUrl: z.string().nullable(),
  logoDarkUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  primaryColor: z.string(),
  secondaryColor: z.string(),
  contactEmail: z.string().nullable(),
  senderName: z.string(),
  senderEmail: z.string().nullable(),
  /** Si parte de la marca viene de una agencia con marca blanca: cuál (F9.7a). */
  whiteLabel: z
    .object({ agencyOrganizationId: z.string(), agencyName: z.string(), footerText: z.string().nullable(), platformName: z.string() })
    .nullable(),
});

export type ResolvedBrandDto = z.infer<typeof resolvedBrandSchema>;
