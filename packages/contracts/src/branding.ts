import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

/** Marca pública de la plataforma (leída por web, dashboard, login y correos). */
export const publicPlatformBrandingResponse = z.object({
  name: z.string(),
  logoLightUrl: z.string().nullable(),
  logoDarkUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  primaryColor: z.string(),
  secondaryColor: z.string(),
  supportUrl: z.string().nullable(),
  privacyUrl: z.string().nullable(),
  termsUrl: z.string().nullable(),
  footerText: z.string().nullable(),
});

export type PublicPlatformBrandingResponse = z.infer<typeof publicPlatformBrandingResponse>;

/** Detalle completo de la marca de plataforma (solo superadministración). */
export const platformBrandingResponse = publicPlatformBrandingResponse.extend({
  id: uuid,
  senderName: z.string(),
  senderEmail: z.string(),
  updatedByAdminId: uuid.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export type PlatformBrandingResponse = z.infer<typeof platformBrandingResponse>;

export const uploadBrandingAssetResponse = z.object({
  url: z.string(),
});

export type UploadBrandingAssetResponse = z.infer<typeof uploadBrandingAssetResponse>;
